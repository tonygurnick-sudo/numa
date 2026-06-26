/**
 * `numa integrations <action>` — wraps both integration families under one
 * roof. User-facing language is always "integrations"; under the hood the
 * CLI routes to either Pipedream-backed (workspace-chat-tools) or native
 * (oauth_workspace_tools) tooling based on each slug's method.
 *
 * Routing model:
 *   - Per-user, each slug has EXACTLY ONE method active at a time
 *     (catalog can list a service on both rows, but enabled state picks one).
 *   - The CLI reads `[{slug, method, name}]` from the resolved scope —
 *     workspace inherits NUMA_ENABLED_INTEGRATIONS + NUMA_ENABLED_NATIVE_
 *     CONNECTORS (combined into one list); locally derived from bootstrap.
 *   - `numa integrations request <slug>` auto-routes by the slug's method.
 *   - `numa integrations pipedream-*` commands error helpfully when run
 *     against a native-only slug.
 *
 * Tool gating:
 *   - Pipedream tools require `event.allowed_tools` to include the integration
 *     slug (e.g. `"gmail"` for `gmail-send-email`). The CLI auto-injects the
 *     slug into `enabled_tools` per call — same pattern as memories_tool /
 *     create_agent_tool.
 *   - Native tools have no `allowed_tools` gate at the workspace-chat-tools
 *     dispatcher level — `oauth_workspace_tools` enforces per-`user_sub`
 *     ownership.
 *
 * Docs:
 *   - `numa integrations docs <slug>` lists local file paths the caller
 *     can Read directly. In-workspace, points at /workdir/{tools/integrations,
 *     api-docs}/<slug>/ (already synced by the workspace agent). Outside
 *     workspace, fetches via /api/cli/integrations/<slug>/docs and writes
 *     to ~/.cache/numa/integrations/<slug>/.
 */

import { Command } from 'commander';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { getValidTokens } from '../../auth/tokens.js';
import { activeProfile } from '../../context/store.js';
import { resolveScopingContext, type EnabledIntegration, type ScopingContext } from '../../context/resolve.js';
import { invokeTool, type ToolInvokeRequest } from '../../api/tools.js';
import { atomicDownload, atomicWriteFile, IntegrityError, verifyBufferSha256 } from '../../api/integrity.js';
import { fetchIntegrationDocs } from '../../api/integrations-docs.js';
import { tryWorkspaceDocs, writeCachedDocs, type ResolvedDocs } from '../../context/integrations-cache.js';
import type {
  ConnectorDownloadResult,
  ConnectorFileMetadataResult,
  ConnectorListResult,
  ParamsForTool,
  PipedreamActionIndexEntry,
  ToolName,
} from '../../metadata/tool-types.js';
import { fail, info } from '../../output/pretty.js';
import { emitResult, prettyOrSpill } from '../../output/emit.js';
import { splitExtraArgs, parseJsonBlob, requireUserMessage, type StandardOptions } from '../../output/cli-args.js';
import { requiresLocalApprovalForIntegration } from '../../context/approval.js';
import { deliverIntegrationFiles } from './_integration-files.js';
import { gateWriteOp } from './_hitl.js';

// ─── shared helpers ─────────────────────────────────────────────────────────

/**
 * Look up a slug in the enabled-integrations list, returning the method
 * tag. Returns undefined when the slug isn't enabled in the current scope
 * — the CLI uses this for the routing decision in `request` and for the
 * method-mismatch errors in `pipedream-*` commands.
 *
 * A slug is supposed to carry exactly ONE method per conversation (the
 * workspace agent dedupes the env vars; the frontend sends the connected
 * method). If a stale/duplicated context presents BOTH, never pick silently
 * — the two methods hit different backends with different auth — fail and
 * ask for `--via`. An explicit `method` argument (the `--via` flag)
 * bypasses the ambiguity check.
 */
const findIntegration = (
  scope: ScopingContext,
  slug: string,
  method?: 'pipedream' | 'native'
): EnabledIntegration | undefined => {
  const matches = scope.enabled_integrations.filter((i) => i.slug === slug);
  if (method) return matches.find((i) => i.method === method);
  if (matches.length > 1) {
    fail(
      `'${slug}' appears with multiple connection methods in this context ` +
        `(${matches.map((m) => m.method).join(', ')}). ` +
        `Pass --via pipedream|native to disambiguate.`
    );
  }
  return matches[0];
};

/** Validate the optional `--via` flag value. */
const parseMethodFlag = (v: string | undefined): 'pipedream' | 'native' | undefined => {
  if (v === undefined) return undefined;
  if (v === 'pipedream' || v === 'native') return v;
  fail(`invalid --via '${v}' — use 'pipedream' or 'native'`);
};

/**
 * Pipedream tools require the integration slug in `event.allowed_tools`.
 * Workspace context inherits NUMA_ENABLED_TOOLS; locally we auto-merge the
 * slug being targeted so commands work without prior dev-context setup.
 * Same pattern as memories_tool / create_agent_tool.
 */
const resolveEnabledToolsWithSlug = (scope: ScopingContext, slug: string): string[] => {
  const base = scope.enabled_tools ?? [];
  if (scope.source === 'workspace-env') return base;
  return base.includes(slug) ? base : [...base, slug];
};

interface BuildRequestOpts<T extends ToolName> {
  account: string;
  tool: T;
  params: ParamsForTool<T>;
  /** Slug to add to enabled_tools (Pipedream calls only — native ignores this). */
  toolSlug?: string;
  /** Required user-facing caption; rides on the top-level request. */
  userMessage?: string;
}

async function buildIntegrationsRequest<T extends ToolName>(
  opts: BuildRequestOpts<T>
): Promise<{ accessToken: string; request: ToolInvokeRequest<T>; scope: ScopingContext }> {
  requireUserMessage({ userMessage: opts.userMessage });
  const tokens = await getValidTokens(opts.account);
  const scope = resolveScopingContext(opts.account);
  const enabledTools = opts.toolSlug ? resolveEnabledToolsWithSlug(scope, opts.toolSlug) : scope.enabled_tools;
  const request: ToolInvokeRequest<T> = {
    tool: opts.tool,
    params: opts.params,
    context: {
      allowed_kbs: scope.allowed_kbs,
      allowed_kb_operations: scope.allowed_kb_operations,
      enabled_tools: enabledTools,
      conversation_id: scope.conversation_id || undefined,
    },
    id_token: tokens.idToken,
    user_message: opts.userMessage,
  };
  return { accessToken: tokens.accessToken, request, scope };
}

/** Fail with a helpful method-mismatch message when a Pipedream cmd hits a native slug. */
const requirePipedreamSlug = (scope: ScopingContext, slug: string): void => {
  // pipedream-* commands are method-specific, so match on the pipedream
  // entry directly — a dual-method context must not shadow it behind a
  // native row (or vice versa).
  if (findIntegration(scope, slug, 'pipedream')) return;
  if (findIntegration(scope, slug, 'native')) {
    fail(
      `'${slug}' uses the native integration method, which doesn't expose pre-built actions. ` +
        `Use \`numa integrations request ${slug} <method> <url>\` for direct API calls. ` +
        `Or \`numa integrations docs ${slug}\` to see the API reference.`
    );
  }
  fail(
    `'${slug}' is not in your enabled integrations. ` +
      `Run \`numa integrations list\` to see what's available. ` +
      `If it's connected but disabled for this conversation, enable it in your chat settings.`
  );
};

/**
 * Point-of-failure pointer to the connector's reference docs — the SOURCE OF
 * TRUTH for its HTTP API. Emitted when a native `request` fails, so the agent
 * re-derives the call from the docs instead of re-guessing the URL/path/params
 * (the failure mode that produced the invented `/v1/` prefix). Goes to stderr,
 * the same channel as the other `numa:` status lines.
 *
 * The pointer is keyed on the upstream status so it names the RIGHT doc for the
 * failure (auth vs path vs body vs rate-limit) instead of a generic catch-all
 * that would misdirect — e.g. pointing at query-patterns on a 401.
 */
const emitNativeDocHint = (slug: string, status?: number): void => {
  const docs = `/workdir/api-docs/${slug}/`;
  let focus: string;
  if (status === 401 || status === 403) {
    focus =
      `auth/scope looks wrong — check the auth section of ${docs}01-llm-api-rules.md and ${docs}04-connection-and-reauth.md; ` +
      `if the token has expired the user must reconnect the connector`;
  } else if (status === 404) {
    focus =
      `the endpoint/path is likely wrong — verify the exact route and base path in ${docs}01-llm-api-rules.md and ${docs}01b-query-patterns.md; ` +
      `do NOT invent path segments (e.g. a /v1/ prefix)`;
  } else if (status === 400 || status === 422) {
    focus = `the request shape is likely wrong — check the required params/body in ${docs}01b-query-patterns.md (reads) or ${docs}01c-mutation-patterns.md (writes)`;
  } else if (status === 429) {
    focus = `rate limited — see the rate-limit guidance in ${docs}01-llm-api-rules.md and back off before retrying`;
  } else {
    focus = `re-check the base path, version segment, headers, and pagination in ${docs}01-llm-api-rules.md before retrying`;
  }
  process.stderr.write(
    `numa: this request failed${typeof status === 'number' ? ` (HTTP ${status})` : ''} — ` +
      `the connector's API docs are the source of truth. ${focus}. Don't guess the call; ` +
      `if the docs aren't synced run \`numa integrations docs ${slug}\`.\n`
  );
};

// ─── list ───────────────────────────────────────────────────────────────────

function createIntegrationsListCommand(): Command {
  return new Command('list')
    .description('List enabled integrations with their method (pipedream | native)')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa Integrations: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action((options: StandardOptions) => {
      const scope = resolveScopingContext();
      emitResult({
        tool: 'list_integrations',
        result: { integrations: scope.enabled_integrations, source: scope.source },
        options,
        pretty: ({ integrations, source }) => {
          if (integrations.length === 0) {
            process.stdout.write('(no integrations enabled)\n');
            process.stderr.write(`numa: scope source: ${source}\n`);
            return;
          }
          const slugWidth = Math.max(...integrations.map((i) => i.slug.length), 4);
          const methodWidth = Math.max(...integrations.map((i) => i.method.length), 6);
          process.stdout.write(`${'slug'.padEnd(slugWidth)}  ${'method'.padEnd(methodWidth)}  name\n`);
          process.stdout.write(`${'-'.repeat(slugWidth)}  ${'-'.repeat(methodWidth)}  ----\n`);
          for (const i of integrations) {
            process.stdout.write(`${i.slug.padEnd(slugWidth)}  ${i.method.padEnd(methodWidth)}  ${i.name ?? ''}\n`);
          }
          if (process.env['NUMA_DEBUG']) {
            process.stderr.write(`numa: scope source: ${source}\n`);
          }
        },
      });
    });
}

// ─── docs ───────────────────────────────────────────────────────────────────

function createIntegrationsDocsCommand(): Command {
  return new Command('docs')
    .description('Show paths to the integration reference docs (read them directly with your file tool)')
    .argument('<slug>', 'Integration slug')
    .option('--via <method>', "Connection method ('pipedream' | 'native') when a slug is enabled via both")
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa Integrations: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (slug: string, options: { via?: string } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);

      const entry = findIntegration(scope, slug, parseMethodFlag(options.via));
      if (!entry) {
        fail(
          `'${slug}' is not in your enabled integrations` +
            (options.via ? ` via the ${options.via} method` : '') +
            `. Run \`numa integrations list\` to see what's available.`
        );
      }

      // In workspace? Use what's already synced locally. No network.
      let resolved: ResolvedDocs | undefined = tryWorkspaceDocs(slug, entry.method);
      if (!resolved) {
        // Outside workspace OR no local files yet — fetch via API + cache.
        const tokens = await getValidTokens(account);
        const docs = await fetchIntegrationDocs(account, tokens.accessToken, slug, entry.method);
        if (entry.method === 'pipedream' && docs.method === 'pipedream' && docs.index.length === 0) {
          fail(`no actions returned for ${slug}. Is the integration connected upstream?`);
        }
        if (entry.method === 'native' && docs.method === 'native' && docs.files.length === 0) {
          fail(
            `no reference docs published for '${slug}'. ` +
              `Native integrations need an admin to upload markdown to ` +
              `s3://numa-<client>-outputs/tools/api-docs/${slug}/. ` +
              `In the meantime, use \`numa integrations request ${slug} <method> <url>\` directly.`
          );
        }
        resolved = writeCachedDocs(slug, docs);
      }

      emitResult({
        tool: 'integration_docs',
        result: resolved,
        options,
        pretty: (r) => {
          process.stdout.write(`Documentation for ${slug} (${r.method} integration)\n`);
          process.stdout.write(`Source: ${r.source === 'workspace' ? 'workspace (live)' : 'local cache'}\n\n`);
          process.stdout.write(`Reference files (read directly):\n`);
          for (const f of r.files) {
            process.stdout.write(`  ${f.path}\n`);
          }
          if (r.method === 'pipedream') {
            process.stdout.write(
              `\nWorkflow:\n` +
                `  1. Read _index.json above to find the right action\n` +
                `  2. Read /workdir/tools/integrations/${slug}/<action-key>.json (in-workspace only) for prop schema\n` +
                `  3. Resolve dynamic dropdowns:\n` +
                `       numa integrations pipedream-props-options ${slug} <action> <prop> --${slug} '{"authProvisionId":"auto"}'\n` +
                `  4. Execute (ad-hoc flags or --props JSON):\n` +
                `       numa integrations pipedream-call ${slug} <action> --${slug} '{"authProvisionId":"auto"}' --<prop> <value> ... -m "..."\n` +
                `       numa integrations pipedream-call ${slug} <action> --props '{"${slug}":{"authProvisionId":"auto"},"<prop>":"<val>"}' -m "..."\n`
            );
          } else {
            process.stdout.write(
              `\nTo make API calls (ad-hoc body fields or --body JSON):\n` +
                `  numa integrations request ${slug} <METHOD> <URL> --<field> <value> ... -m "..."\n` +
                `  numa integrations request ${slug} <METHOD> <URL> --body '{...}' -m "..."\n` +
                `Start by reading 01-llm-api-rules.md — it has auth, headers, and rate-limit info.\n`
            );
          }
        },
      });
    });
}

// ─── search ─────────────────────────────────────────────────────────────────

function createIntegrationsSearchCommand(): Command {
  return new Command('search')
    .description('Fuzzy-search Pipedream action names across your enabled integrations')
    .argument('<query>', 'Search text (matched against action name + description)')
    .option('--max <n>', 'Max results to return (default 20)', (v) => parseInt(v, 10))
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa Integrations: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (query: string, options: { max?: number } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);

      const pipedreamSlugs = scope.enabled_integrations.filter((i) => i.method === 'pipedream').map((i) => i.slug);
      if (pipedreamSlugs.length === 0) {
        fail('no pipedream integrations enabled — search only matches Pipedream actions today');
      }

      // Fetch indices for each enabled pipedream integration (workspace-local
      // file if available, else API). Aggregate + filter.
      const tokens = await getValidTokens(account);
      type Hit = { slug: string; action: PipedreamActionIndexEntry; score: number };
      const lowerQuery = query.toLowerCase();
      const allHits: Hit[] = [];

      for (const slug of pipedreamSlugs) {
        let entries: PipedreamActionIndexEntry[] = [];
        const wsDocs = tryWorkspaceDocs(slug, 'pipedream');
        if (wsDocs) {
          // Read _index.json from workspace.
          const indexPath = wsDocs.files.find((f) => f.name === '_index.json')?.path;
          if (indexPath && existsSync(indexPath)) {
            try {
              entries = JSON.parse(readFileSync(indexPath, 'utf-8')) as PipedreamActionIndexEntry[];
            } catch {
              /* skip malformed */
            }
          }
        } else {
          try {
            const docs = await fetchIntegrationDocs(account, tokens.accessToken, slug, 'pipedream');
            if (docs.method === 'pipedream') {
              entries = docs.index;
              writeCachedDocs(slug, docs);
            }
          } catch (err) {
            if (process.env['NUMA_DEBUG']) {
              info(`search: failed to load actions for ${slug}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }

        for (const a of entries) {
          const haystack = `${a.name} ${a.description ?? ''}`.toLowerCase();
          if (haystack.includes(lowerQuery)) {
            // Trivial score: earlier-in-name = better.
            const idx = a.name.toLowerCase().indexOf(lowerQuery);
            const score = idx >= 0 ? idx : 1000;
            allHits.push({ slug, action: a, score });
          }
        }
      }

      allHits.sort((a, b) => a.score - b.score);
      const max = options.max ?? 20;
      const trimmed = allHits.slice(0, max);

      emitResult({
        tool: 'search_integrations',
        result: { query, total: allHits.length, hits: trimmed },
        options,
        pretty: ({ hits, total }) => {
          if (hits.length === 0) {
            process.stdout.write(`(no actions matched "${query}")\n`);
            return;
          }
          for (const h of hits) {
            process.stdout.write(`${h.slug}  ${h.action.key}\n`);
            process.stdout.write(`  ${h.action.name}\n`);
            if (h.action.description) {
              const d =
                h.action.description.length > 100 ? h.action.description.slice(0, 99) + '…' : h.action.description;
              process.stdout.write(`  ${d}\n`);
            }
            process.stdout.write('\n');
          }
          if (total > hits.length) {
            process.stderr.write(`numa: showing ${hits.length} of ${total} (use --max to see more)\n`);
          }
        },
      });
    });
}

// ─── pipedream-actions ──────────────────────────────────────────────────────

function createIntegrationsPipedreamActionsCommand(): Command {
  return new Command('pipedream-actions')
    .description('List pre-built Pipedream actions for an integration')
    .argument('<slug>', 'Integration slug')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa Integrations: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (slug: string, options: StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);
      requirePipedreamSlug(scope, slug);

      const params: ParamsForTool<'pipedream_list_actions'> = { app_slug: slug };
      const { accessToken, request } = await buildIntegrationsRequest({
        account,
        tool: 'pipedream_list_actions',
        params,
        toolSlug: slug,
        userMessage: options.userMessage,
      });
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`pipedream-actions failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'pipedream_list_actions',
        result: res.result,
        options,
        pretty: (r) => {
          const actions = r?.actions ?? [];
          if (actions.length === 0) {
            process.stdout.write(`(no actions for ${slug})\n`);
            return;
          }
          for (const a of actions) {
            process.stdout.write(`${a.key}\n`);
            process.stdout.write(`  ${a.name}\n`);
            if (a.description) {
              const d = a.description.length > 120 ? a.description.slice(0, 119) + '…' : a.description;
              process.stdout.write(`  ${d}\n`);
            }
            process.stdout.write('\n');
          }
          process.stderr.write(`numa: ${actions.length} action${actions.length === 1 ? '' : 's'}\n`);
        },
      });
    });
}

// ─── pipedream-props ────────────────────────────────────────────────────────

function createIntegrationsPipedreamPropsCommand(): Command {
  return new Command('pipedream-props')
    .description('Show the prop schema for a Pipedream action (props.json under /workdir/tools/integrations/<slug>/)')
    .argument('<slug>', 'Integration slug')
    .argument('<action-key>', 'Action key from `pipedream-actions` (e.g. gmail-send-email)')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa Integrations: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (slug: string, actionKey: string, options: StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);
      requirePipedreamSlug(scope, slug);

      // In workspace, the per-action schema is on disk — read it directly.
      const inWorkspace = scope.source === 'workspace-env';
      const wsActionPath = `/workdir/tools/integrations/${slug}/${actionKey.replace(/\//g, '_')}.json`;
      if (inWorkspace && existsSync(wsActionPath)) {
        try {
          const schema = JSON.parse(readFileSync(wsActionPath, 'utf-8'));
          emitResult({
            tool: 'pipedream_list_actions',
            result: { actions: [schema] },
            options,
            pretty: () => {
              process.stdout.write(JSON.stringify(schema, null, 2) + '\n');
            },
          });
          return;
        } catch {
          /* fall through to API fetch */
        }
      }

      // Outside workspace OR no local file — fetch the full action list +
      // pluck the one we want. The API doesn't have a single-action endpoint;
      // pipedream_list_actions is the only path.
      const params: ParamsForTool<'pipedream_list_actions'> = { app_slug: slug };
      const { accessToken, request } = await buildIntegrationsRequest({
        account,
        tool: 'pipedream_list_actions',
        params,
        toolSlug: slug,
        userMessage: options.userMessage,
      });
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`pipedream-props failed: ${res.error ?? '<no message>'}`);

      const actions = (res.result?.actions ?? []) as unknown as Array<{ key?: string; [k: string]: unknown }>;
      const found = actions.find((a) => a.key === actionKey);
      if (!found) {
        fail(
          `action '${actionKey}' not found for ${slug}. ` +
            `Run \`numa integrations pipedream-actions ${slug}\` to see available keys.`
        );
      }

      emitResult({
        tool: 'pipedream_list_actions',
        result: { actions: [found as unknown as PipedreamActionIndexEntry] },
        options,
        pretty: () => {
          process.stdout.write(JSON.stringify(found, null, 2) + '\n');
        },
      });
    });
}

// ─── pipedream-props-options ────────────────────────────────────────────────

function createIntegrationsPipedreamPropsOptionsCommand(): Command {
  return new Command('pipedream-props-options')
    .description('Resolve dynamic dropdown options for a prop (wraps pipedream_configure_props)')
    .argument('<slug>', 'Integration slug')
    .argument('<action-key>', 'Action key')
    .argument('<prop-name>', 'Prop to resolve options for')
    .argument(
      '[args...]',
      'Ad-hoc --kebab-case prop flags for the configured-props set. ' +
        'Example: --gmail \'{"authProvisionId":"auto"}\' --to \'["alice@x.com"]\''
    )
    .allowUnknownOption(true)
    .option(
      '--configured <json>',
      'JSON of props configured so far (alternative / extension to ad-hoc flags). Merged with ad-hoc — ' +
        '--configured wins on conflict. Always include the auth prop, e.g. \'{"gmail":{"authProvisionId":"auto"}}\'.'
    )
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa Integrations: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        slug: string,
        actionKey: string,
        propName: string,
        extra: string[],
        options: { configured?: string } & StandardOptions
      ) => {
        const account = activeProfile();
        if (!account) fail('no active profile — run `numa login` first');
        const scope = resolveScopingContext(account);
        requirePipedreamSlug(scope, slug);

        const { positionals, adHoc } = splitExtraArgs(extra ?? []);
        if (positionals.length > 0) {
          process.stderr.write(
            `numa: warning — ignored ${positionals.length} positional arg(s) (${positionals.join(', ')}). ` +
              `configure-props takes named props — use --key value flags or --configured '{...}'.\n`
          );
        }

        let configured: Record<string, unknown> = { ...adHoc };
        if (options.configured !== undefined) {
          try {
            const fromJson = parseJsonBlob<Record<string, unknown>>(options.configured, 'configured');
            configured = { ...configured, ...fromJson };
          } catch (err) {
            fail(`--configured must be valid JSON: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (Object.keys(configured).length === 0) {
          fail(
            'No configured props supplied. Pass props via ad-hoc flags (e.g. ' +
              `--${slug} '{"authProvisionId":"auto"}') or --configured '{...}'. ` +
              'Auth prop is always required so the upstream knows whose data to fetch.'
          );
        }

        const params: ParamsForTool<'pipedream_configure_props'> = {
          action_key: actionKey,
          prop_name: propName,
          configured_props: configured,
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'pipedream_configure_props',
          params,
          toolSlug: slug,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(`pipedream-props-options failed: ${res.error ?? '<no message>'}`);

        emitResult({
          tool: 'pipedream_configure_props',
          result: res.result,
          options,
          pretty: (r) => {
            // Two-shape result — render whichever fields are populated.
            if (r?.stringOptions && r.stringOptions.length > 0) {
              for (const s of r.stringOptions) process.stdout.write(`${s}\n`);
              process.stderr.write(`numa: ${r.stringOptions.length} option(s)\n`);
              return;
            }
            if (r?.options && r.options.length > 0) {
              for (const o of r.options) {
                const label = o.label ?? (typeof o.value === 'string' ? o.value : JSON.stringify(o.value));
                process.stdout.write(`${label}\n`);
              }
              process.stderr.write(`numa: ${r.options.length} option(s)\n`);
              return;
            }
            process.stdout.write('(no options returned)\n');
          },
        });
      }
    );
}

// ─── pipedream-call ─────────────────────────────────────────────────────────

function createIntegrationsPipedreamCallCommand(): Command {
  return new Command('pipedream-call')
    .description('Execute a Pipedream action (HITL-gated server-side)')
    .argument('<slug>', 'Integration slug')
    .argument('<action-key>', 'Action key from `pipedream-actions`')
    .argument(
      '[args...]',
      'Ad-hoc --kebab-case prop flags (auto-camelized + value-coerced). ' +
        'Example: --to \'["a@b.com"]\' --subject "Hi" --body "..." --gmail \'{"authProvisionId":"auto"}\''
    )
    .allowUnknownOption(true)
    .option(
      '--props <json>',
      'JSON props blob (alternative / extension to ad-hoc flags). Merged with ad-hoc — --props wins on conflict. ' +
        "Required if you don't supply enough props via ad-hoc flags."
    )
    .option('--stash-id <id>', "Optional file-stash id (use 'NEW' for first file download)")
    .option('-y, --yes', 'Skip the local confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa Integrations: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        slug: string,
        actionKey: string,
        extra: string[],
        options: { props?: string; userMessage: string; stashId?: string; yes?: boolean } & StandardOptions
      ) => {
        const account = activeProfile();
        if (!account) fail('no active profile — run `numa login` first');
        const scope = resolveScopingContext(account);
        requirePipedreamSlug(scope, slug);

        // Parse ad-hoc --<key> <value> pairs out of the variadic bucket.
        // Positionals are unexpected here (action takes named props) —
        // warn but don't fail. Reserved flags (--props/-m/--user-message/etc.)
        // are stripped by commander before we see them.
        const { positionals, adHoc } = splitExtraArgs(extra ?? []);
        if (positionals.length > 0) {
          process.stderr.write(
            `numa: warning — ignored ${positionals.length} positional arg(s) (${positionals.join(', ')}). ` +
              `Pipedream actions take named props — use --key value flags or --props '{...}'.\n`
          );
        }

        let configured: Record<string, unknown> = { ...adHoc };
        if (options.props !== undefined) {
          try {
            const fromJson = parseJsonBlob<Record<string, unknown>>(options.props, 'props');
            configured = { ...configured, ...fromJson };
          } catch (err) {
            fail(`--props must be valid JSON: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (Object.keys(configured).length === 0) {
          fail(
            'No props supplied. Pass props via ad-hoc flags (e.g. --subject Hi --body "...") ' +
              'or --props \'{...}\'. Most actions also need an auth prop, e.g. --gmail \'{"authProvisionId":"auto"}\'.'
          );
        }

        const { requestId, autoApproved } = await gateWriteOp({
          requiresApproval: requiresLocalApprovalForIntegration({ slug, actionKey, account }),
          yes: !!options.yes,
          confirmOpts: {
            title: `Run ${actionKey} (${slug}) — ${options.userMessage}`,
            requireWord: 'yes',
          },
          emit: {
            actionKey: `integration-${slug}`,
            toolName: 'pipedream_run_action',
            description: options.userMessage,
            propsPreview: configured,
            approvalCategory: 'integration',
          },
        });

        const params: ParamsForTool<'pipedream_run_action'> = {
          action_key: actionKey,
          configured_props: configured,
          description: options.userMessage,
          ...(options.stashId ? { stash_id: options.stashId } : {}),
          auto_approved: autoApproved,
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'pipedream_run_action',
          params,
          toolSlug: slug,
          userMessage: options.userMessage,
        });
        if (requestId) request.request_id = requestId;

        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(`pipedream-call failed: ${res.error ?? '<no message>'}`);

        // Auto-deliver any file payloads (attachments, stash uploads, staged
        // binaries) into the workspace — the model gets real paths instead of
        // having to fish presigned URLs out of the JSON.
        const downloaded = await deliverIntegrationFiles(res.result, actionKey);
        const resultWithFiles =
          downloaded.length > 0 ? { ...(res.result as object), downloaded_files: downloaded } : res.result;

        prettyOrSpill({
          tool: 'pipedream_run_action',
          result: resultWithFiles as typeof res.result,
          options,
          render: (r) => {
            const status = r?.status ?? 'success';
            if (status === 'denied') {
              process.stderr.write(`numa: action denied${r?.deny_reason ? ` — "${r.deny_reason}"` : ''}\n`);
              return;
            }
            if (status === 'timeout') {
              process.stderr.write(`numa: approval timed out\n`);
              return;
            }
            if (status !== 'success') {
              process.stderr.write(`numa: ${status} — ${r?.message ?? 'no message'}\n`);
              return;
            }
            // Small result — dump raw; actions return wildly different shapes.
            process.stdout.write(JSON.stringify(r?.result ?? {}, null, 2) + '\n');
          },
          headline: (_r, size, count) =>
            `${slug}/${actionKey} returned (${size}${count > 0 ? `, ${count} entries` : ''})`,
        });
      }
    );
}

// ─── request (universal) ────────────────────────────────────────────────────

function createIntegrationsRequestCommand(): Command {
  return new Command('request')
    .description(
      'Make an authenticated HTTP request — auto-routes to Pipedream proxy or native connector based on the slug'
    )
    .argument('<slug>', 'Integration slug')
    .argument('<http-method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE)')
    .argument('<url>', 'Full upstream URL')
    .argument(
      '[args...]',
      'Ad-hoc --kebab-case body fields (auto-camelized + value-coerced). ' +
        'Example: --name Alice --email alice@x.com (becomes body {"name":"Alice","email":"alice@x.com"})'
    )
    .allowUnknownOption(true)
    .option(
      '--body <json>',
      'JSON body for POST/PUT/PATCH (alternative / extension to ad-hoc flags). Merged with ad-hoc — ' +
        '--body wins on conflict.'
    )
    .option(
      '--headers <json>',
      'JSON object of extra headers (stays as JSON — header values often contain `:` and special chars)'
    )
    .option('--via <method>', "Connection method ('pipedream' | 'native') when a slug is enabled via both")
    .option('-y, --yes', 'Skip the local confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa Integrations: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        slug: string,
        httpMethod: string,
        url: string,
        extra: string[],
        options: {
          userMessage: string;
          body?: string;
          headers?: string;
          via?: string;
          yes?: boolean;
        } & StandardOptions
      ) => {
        const account = activeProfile();
        if (!account) fail('no active profile — run `numa login` first');
        const scope = resolveScopingContext(account);
        const entry = findIntegration(scope, slug, parseMethodFlag(options.via));
        if (!entry) {
          fail(
            `'${slug}' is not in your enabled integrations` +
              (options.via ? ` via the ${options.via} method` : '') +
              `. Run \`numa integrations list\` to see what's available.`
          );
        }

        const methodUpper = httpMethod.toUpperCase();
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(methodUpper)) {
          fail(`Invalid HTTP method '${httpMethod}'. Use GET, POST, PUT, PATCH, or DELETE.`);
        }
        const httpMethodTyped = methodUpper as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

        // Build the body from ad-hoc flags first, then layer --body JSON on
        // top (it wins on conflict). Headers stay JSON only.
        const { positionals, adHoc } = splitExtraArgs(extra ?? []);
        if (positionals.length > 0) {
          process.stderr.write(
            `numa: warning — ignored ${positionals.length} positional arg(s) (${positionals.join(', ')}). ` +
              `Use --key value flags for body fields or --body '{...}' for the full JSON body.\n`
          );
        }

        let body: unknown = Object.keys(adHoc).length > 0 ? adHoc : undefined;
        if (options.body !== undefined) {
          try {
            const fromJson = parseJsonBlob(options.body, 'body');
            // If both ad-hoc and --body are provided, merge — but only when
            // --body is an object. If it's an array/primitive, --body wins
            // outright (ad-hoc can't represent non-object bodies anyway).
            if (body !== undefined && fromJson !== null && typeof fromJson === 'object' && !Array.isArray(fromJson)) {
              body = { ...(body as Record<string, unknown>), ...(fromJson as Record<string, unknown>) };
            } else {
              body = fromJson;
            }
          } catch (err) {
            fail(`--body must be valid JSON: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        let headers: Record<string, string> | undefined;
        if (options.headers !== undefined) {
          try {
            headers = parseJsonBlob<Record<string, string>>(options.headers, 'headers');
          } catch (err) {
            fail(`--headers must be valid JSON: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const { requestId, autoApproved } = await gateWriteOp({
          requiresApproval: requiresLocalApprovalForIntegration({ slug, httpMethod: methodUpper, account }),
          yes: !!options.yes,
          confirmOpts: {
            title: `${methodUpper} ${url} via ${slug} (${entry.method}) — ${options.userMessage}`,
            requireWord: 'yes',
          },
          emit: {
            actionKey: `proxy_${methodUpper}`,
            toolName: 'pipedream_proxy_request',
            description: options.userMessage,
            propsPreview: { method: methodUpper, url },
            approvalCategory: 'integration',
          },
        });

        if (entry.method === 'pipedream') {
          const params: ParamsForTool<'pipedream_proxy_request'> = {
            method: httpMethodTyped,
            upstream_url: url,
            integration_slug: slug,
            description: options.userMessage,
            ...(body !== undefined ? { body } : {}),
            ...(headers ? { headers } : {}),
            auto_approved: autoApproved,
          };
          const { accessToken, request } = await buildIntegrationsRequest({
            account,
            tool: 'pipedream_proxy_request',
            params,
            toolSlug: slug,
            userMessage: options.userMessage,
          });
          if (requestId) request.request_id = requestId;
          const res = await invokeTool(account, accessToken, request);
          if (res.status === 'error') fail(`request failed: ${res.error ?? '<no message>'}`);
          // Binary responses (inline base64 or proxy-staged presigned) land
          // as real files; the JSON result reports the paths.
          const downloaded = await deliverIntegrationFiles(res.result, `proxy-${slug}`);
          const resultWithFiles =
            downloaded.length > 0 ? { ...(res.result as object), downloaded_files: downloaded } : res.result;
          prettyOrSpill({
            tool: 'pipedream_proxy_request',
            result: resultWithFiles as typeof res.result,
            options,
            render: (r) => {
              if (r?.status && r.status !== 'success') {
                process.stderr.write(`numa: ${r.status} — ${r?.message ?? 'no message'}\n`);
                return;
              }
              process.stdout.write(JSON.stringify(r?.result ?? {}, null, 2) + '\n');
            },
            headline: (_r, size, count) =>
              `${methodUpper} ${url} via ${slug} (pipedream) — ${size}${count > 0 ? `, ${count} entries` : ''}`,
          });
          return;
        }

        // native — connect_request via oauth_workspace_tools
        const params: ParamsForTool<'connect_request'> = {
          connector: slug,
          method: httpMethodTyped,
          url,
          description: options.userMessage,
          ...(body !== undefined ? { body } : {}),
          ...(headers ? { headers } : {}),
          auto_approved: autoApproved,
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_request',
          params,
          // Native side doesn't gate on allowed_tools — pass through but
          // don't auto-inject the slug.
          userMessage: options.userMessage,
        });
        if (requestId) request.request_id = requestId;
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(`request failed: ${res.error ?? '<no message>'}`);

        // Native request failure (a non-2xx upstream status, or a connector-
        // level error in the result) → point the agent at the source-of-truth
        // docs. Emitted here (not inside the pretty render) so it reaches the
        // agent in ALL output modes — the workspace agent gets --standard/--json,
        // where the render callback never runs.
        const nativeStatus = res.result?.result?.status_code;
        const nativeFailed = typeof nativeStatus === 'number' && nativeStatus >= 400;
        if (res.result?.error || res.result?.error_code || nativeFailed) {
          emitNativeDocHint(slug, nativeFailed ? nativeStatus : undefined);
        }

        prettyOrSpill({
          tool: 'connect_request',
          result: res.result,
          options,
          render: (r) => {
            if (r?.error || r?.error_code) {
              process.stderr.write(`numa: error — ${r?.error_code ?? ''} ${r?.error ?? ''}\n`);
              return;
            }
            const sc = r?.result?.status_code;
            if (typeof sc === 'number') {
              process.stderr.write(`numa: HTTP ${sc}\n`);
            }
            const body = r?.result?.body;
            process.stdout.write(typeof body === 'string' ? body + '\n' : JSON.stringify(body ?? {}, null, 2) + '\n');
          },
          headline: (r, size, count) => {
            const sc = r?.result?.status_code;
            return `${methodUpper} ${url} via ${slug} (native)${typeof sc === 'number' ? ` — HTTP ${sc}` : ''} — ${size}${count > 0 ? `, ${count} entries` : ''}`;
          },
        });
      }
    );
}

// ─── native connector — AutoPlay SOAP credential passthrough ─────────────────
//
// `soap-credentials <connector>` (default `autoplay`). Hands the agent the
// company-level SOAP credentials AutoPlay's Lead API needs — its auth must be
// embedded inside the SOAP <Authentication> envelope, not sent as an HTTP
// header, so the generic `request` path can't do it and the model has to build
// the envelope itself. This is a DELIBERATE credential disclosure, hard-gated
// SERVER-SIDE (oauth_workspace_tools) on TWO admin opt-ins on the AutoPlay
// connector config — `soap_token_passthrough` AND `lead_api_enabled` — and
// pinned to the `autoplay` slug. When a gate is off the handler returns an auth
// error and exposes nothing; the CLI just surfaces that message. user_sub is
// injected by numa-cli-api. Read-only credential read → no local HITL gate.

function createIntegrationsSoapCredentialsCommand(): Command {
  return new Command('soap-credentials')
    .description(
      'AutoPlay only: fetch the gated SOAP credentials (base URL, API key/token, dealer IDs) ' +
        'for building Lead API envelopes. Requires the admin soap_token_passthrough + lead_api_enabled opt-ins.'
    )
    .argument('[connector]', 'Native connector slug — only autoplay is supported', 'autoplay')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (connector: string, options: StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const slug = (connector || 'autoplay').trim();
      const params: ParamsForTool<'connect_soap_credentials'> = { connector: slug };
      const { accessToken, request } = await buildIntegrationsRequest({
        account,
        tool: 'connect_soap_credentials',
        params,
        userMessage: options.userMessage,
      });
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(connectorFailure('soap-credentials', slug, res));
      emitResult({ tool: 'connect_soap_credentials', result: res.result, options, pretty: writeJson });
    });
}

// ─── native connector file browsing ──────────────────────────────────────────
//
// list-files / search-files / download-file / file-info. Restores the file ops
// the MCP `connect.py` tool exposed before the MCP→CLI migration (6bebe5603)
// deleted them. Two backends behind one surface:
//   - Synergy 12d → `connect_synergy_{list,search,download}` (jobs modelled as
//     folders; folder_id uses `job:{id}` / `folder:{id}` prefixes).
//   - OAuth cloud storage (Google Drive / Gmail / OneDrive / Dropbox) →
//     `oauth_{list_files,search_files,download_file,get_file_metadata}`, keyed
//     by a `provider` param (== the slug).
// All read-only → no HITL gate. The numa-cli-api Lambda injects user_sub.

const CAPTION_HELP = 'Short caption shown to the user in chat ("Numa Integrations: <msg>")';

/**
 * The native connectors that support file browsing, mapped to their backend
 * routing: `synergy` uses the Synergy-specific handlers; the OAuth cloud-
 * storage providers share the generic `oauth_*` ops (keyed by `provider`).
 *
 * This is the authoritative file-browse allow-list for the CLI — it mirrors
 * the connectors flagged `surfaces: ['files']` in the frontend
 * `connectorRegistry.ts`. KEEP IN SYNC: when a new file-browsing connector is
 * added (registry surfaces + a backend provider), add it here too, otherwise
 * the CLI fails it fast as "not a file-browse connector".
 */
const FILE_BROWSE_ROUTING = new Map<string, 'synergy' | 'oauth'>([
  ['synergy', 'synergy'],
  ['googledrive', 'oauth'],
  ['gmail', 'oauth'],
  ['onedrive', 'oauth'],
  ['dropbox', 'oauth'],
]);

const FILE_BROWSE_NAMES = 'Synergy, Google Drive, Gmail, OneDrive, Dropbox';

/** Compact byte-size formatter for file listings. */
const fmtSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/** commander coercion: parse `--page-size` to a positive integer, failing loudly. */
const parsePageSize = (v: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) fail(`--page-size must be a positive integer, got '${v}'`);
  return n;
};

/**
 * Defensive basename for a server-supplied filename used to build a local
 * write path — strip directory components and traversal so a hostile/odd
 * `filename` can't escape the intended directory.
 */
const safeBasename = (name: string): string => {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[^\w.\- ]/g, '_').trim();
  return !base || /^\.+$/.test(base) ? 'download' : base;
};

/**
 * Build a clear failure message for a native-connector tool error. Surfaces
 * the backend `error_code` and turns credential failures into an actionable
 * connect/reconnect hint so the model tells the user what to do instead of
 * blindly retrying.
 */
const connectorFailure = (op: string, slug: string, res: { error?: string; error_code?: string }): string => {
  const detail = res.error ?? '<no message>';
  if (res.error_code === 'needs_credential') {
    return `${op} failed: '${slug}' isn't connected. Connect it under Integrations (or ask the user to), then retry. (${detail})`;
  }
  if (res.error_code === 'auth_error') {
    return `${op} failed: '${slug}' credentials have expired — reconnect ${slug} under Integrations, then retry. (${detail})`;
  }
  return `${op} failed: ${detail}${res.error_code ? ` [${res.error_code}]` : ''}`;
};

/**
 * Resolve a slug to its file-browse backend, failing fast with actionable
 * guidance when the connector can't (or isn't enabled to) browse files. File
 * browsing is inherently native, so there's no `--via` ambiguity — we always
 * want the native row.
 */
const resolveFileConnector = (scope: ScopingContext, slug: string): { kind: 'synergy' | 'oauth' } => {
  const kind = FILE_BROWSE_ROUTING.get(slug);
  if (kind) {
    if (!findIntegration(scope, slug, 'native')) {
      fail(
        `'${slug}' supports file browsing but isn't enabled for this conversation. ` +
          `Connect/enable it under Integrations (or in your chat settings), then retry.`
      );
    }
    return { kind };
  }
  // Not a file-browse connector — give a targeted reason.
  if (findIntegration(scope, slug, 'native')) {
    fail(
      `'${slug}' is a native connector but doesn't support file browsing. ` +
        `File browsing works for ${FILE_BROWSE_NAMES}. ` +
        `For API calls use \`numa integrations request ${slug} <method> <url>\`.`
    );
  }
  if (findIntegration(scope, slug, 'pipedream')) {
    fail(
      `'${slug}' is connected via Pipedream, which doesn't expose file browsing. ` +
        `Use \`numa integrations pipedream-actions ${slug}\` for its pre-built actions.`
    );
  }
  return fail(
    `'${slug}' is not an enabled connector. Run \`numa integrations list\` to see what's available — ` +
      `file browsing works for ${FILE_BROWSE_NAMES}.`
  );
};

/** Shared renderer for list-files / search-files (both return a ConnectorListResult). */
const emitConnectorListResult = (
  slug: string,
  toolName: string,
  result: ConnectorListResult | undefined,
  options: StandardOptions
): void => {
  prettyOrSpill({
    tool: toolName,
    result,
    options,
    render: (r) => {
      if (!r) {
        process.stdout.write('(no result)\n');
        return;
      }
      const folders = r.folders ?? [];
      const files = r.files ?? [];
      if (folders.length === 0 && files.length === 0) {
        process.stdout.write('(empty)\n');
      }
      if (folders.length > 0) {
        process.stdout.write('folders:\n');
        for (const f of folders) {
          const sub = typeof f.no_of_subfolders === 'number' ? ` (${f.no_of_subfolders} subfolders)` : '';
          process.stdout.write(`  ${f.folder_id}\t${f.name}${sub}\n`);
        }
      }
      if (files.length > 0) {
        process.stdout.write('files:\n');
        for (const f of files) {
          const size = typeof f.size === 'number' ? `  ${fmtSize(f.size)}` : '';
          process.stdout.write(`  ${f.file_id}\t${f.name}${size}\n`);
        }
      }
      const more = r.next_page_token ? ` — more with --page-token ${r.next_page_token}` : '';
      process.stderr.write(`numa: ${folders.length} folder(s), ${files.length} file(s)${more}\n`);
      if (r.truncated) {
        process.stderr.write(
          `numa: result truncated at a safety cap — more items exist than were returned (total ~${r.total_count}). ` +
            `Narrow with --query if you need a specific item.\n`
        );
      }
    },
    headline: (r, size) => `${slug}: ${r?.folders?.length ?? 0} folder(s), ${r?.files?.length ?? 0} file(s) (${size})`,
  });
};

function createIntegrationsListFilesCommand(): Command {
  return new Command('list-files')
    .description('List folders/files from a native connector (Synergy jobs, Google Drive, OneDrive, Dropbox, Gmail)')
    .argument('<slug>', 'Native connector slug (e.g. synergy, googledrive, onedrive, dropbox, gmail)')
    .option(
      '--folder-id <id>',
      'Folder/job to open (omit for the connector root). Synergy uses job:<id> / folder:<id> ids from a prior list.'
    )
    .option('--query <text>', 'Narrow the list by name (for Synergy, finds jobs by name)')
    .option('--page-size <n>', 'Max items to return', parsePageSize)
    .option('--page-token <token>', 'Pagination token from a previous page (OAuth connectors)')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        slug: string,
        options: { folderId?: string; query?: string; pageSize?: number; pageToken?: string } & StandardOptions
      ) => {
        const account = activeProfile();
        if (!account) fail('no active profile — run `numa login` first');
        const scope = resolveScopingContext(account);
        const { kind } = resolveFileConnector(scope, slug);

        if (kind === 'synergy') {
          const params: ParamsForTool<'connect_synergy_list'> = {
            ...(options.folderId ? { folder_id: options.folderId } : {}),
            ...(options.query ? { query: options.query } : {}),
            ...(options.pageSize !== undefined ? { page_size: options.pageSize } : {}),
          };
          const { accessToken, request } = await buildIntegrationsRequest({
            account,
            tool: 'connect_synergy_list',
            params,
            userMessage: options.userMessage,
          });
          const res = await invokeTool(account, accessToken, request);
          if (res.status === 'error') fail(connectorFailure('list-files', slug, res));
          emitConnectorListResult(slug, 'connect_synergy_list', res.result, options);
          return;
        }

        const params: ParamsForTool<'oauth_list_files'> = {
          provider: slug,
          ...(options.folderId ? { folder_id: options.folderId } : {}),
          ...(options.pageSize !== undefined ? { page_size: options.pageSize } : {}),
          ...(options.pageToken ? { page_token: options.pageToken } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'oauth_list_files',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('list-files', slug, res));
        emitConnectorListResult(slug, 'oauth_list_files', res.result, options);
      }
    );
}

function createIntegrationsSearchFilesCommand(): Command {
  return new Command('search-files')
    .description('Search files/jobs by name in a native connector')
    .argument('<slug>', 'Native connector slug')
    .argument('<query>', 'Search text (matched against file / job names)')
    .option('--folder-id <id>', 'Limit the search to a folder (OAuth connectors; ignored by Synergy)')
    .option('--page-size <n>', 'Max items to return', parsePageSize)
    .option('--page-token <token>', 'Pagination token from a previous page (OAuth connectors)')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        slug: string,
        query: string,
        options: { folderId?: string; pageSize?: number; pageToken?: string } & StandardOptions
      ) => {
        const account = activeProfile();
        if (!account) fail('no active profile — run `numa login` first');
        const scope = resolveScopingContext(account);
        const { kind } = resolveFileConnector(scope, slug);

        if (kind === 'synergy') {
          const params: ParamsForTool<'connect_synergy_search'> = {
            query,
            ...(options.pageSize !== undefined ? { page_size: options.pageSize } : {}),
          };
          const { accessToken, request } = await buildIntegrationsRequest({
            account,
            tool: 'connect_synergy_search',
            params,
            userMessage: options.userMessage,
          });
          const res = await invokeTool(account, accessToken, request);
          if (res.status === 'error') fail(connectorFailure('search-files', slug, res));
          emitConnectorListResult(slug, 'connect_synergy_search', res.result, options);
          return;
        }

        const params: ParamsForTool<'oauth_search_files'> = {
          provider: slug,
          query,
          ...(options.folderId ? { folder_id: options.folderId } : {}),
          ...(options.pageSize !== undefined ? { page_size: options.pageSize } : {}),
          ...(options.pageToken ? { page_token: options.pageToken } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'oauth_search_files',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('search-files', slug, res));
        emitConnectorListResult(slug, 'oauth_search_files', res.result, options);
      }
    );
}

function createIntegrationsDownloadFileCommand(): Command {
  return new Command('download-file')
    .description('Download a file from a native connector by file id')
    .argument('<slug>', 'Native connector slug')
    .argument('<file-id>', 'File id from `list-files` / `search-files`')
    .option('-o, --output <path>', 'Local path to write to. Defaults to the in-workspace path, else ./<filename>')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Write file + print status (default in TTY)')
    .option('--standard', 'Skip file write — emit metadata in standard envelope')
    .option('--json', 'Skip file write — emit raw metadata JSON')
    .action(async (slug: string, fileId: string, options: { output?: string } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);
      const { kind } = resolveFileConnector(scope, slug);
      const dlTool = kind === 'synergy' ? 'connect_synergy_download' : 'oauth_download_file';

      let result: ConnectorDownloadResult;
      if (kind === 'synergy') {
        const params: ParamsForTool<'connect_synergy_download'> = { file_id: fileId };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_download',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('download-file', slug, res));
        result = res.result ?? ({} as ConnectorDownloadResult);
      } else {
        const params: ParamsForTool<'oauth_download_file'> = { provider: slug, file_id: fileId };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'oauth_download_file',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('download-file', slug, res));
        result = res.result ?? ({} as ConnectorDownloadResult);
      }

      // --json / --standard mean "metadata only, don't fetch/write the bytes".
      if (options.json || options.standard) {
        emitResult({ tool: dlTool, result, options });
        return;
      }

      // Default destination: in-workspace, honour the handler's suggested
      // /workdir path so the file lands where the agent expects (validated to
      // stay under /workdir so a bad server value can't escape); on a laptop
      // (no /workdir) fall back to a sanitized name in the current directory.
      const inWorkspace = scope.source === 'workspace-env';
      const wsPath = result.workspace_path;
      const useWsPath = inWorkspace && typeof wsPath === 'string' && wsPath.startsWith('/workdir/');
      const outPath =
        options.output ?? (useWsPath ? wsPath! : `./${safeBasename(result.filename || `download-${fileId}`)}`);

      try {
        mkdirSync(dirname(outPath), { recursive: true });
      } catch (e) {
        fail(`download-file: could not create directory for ${outPath}: ${e instanceof Error ? e.message : String(e)}`);
      }

      try {
        if (result.file_content_url) {
          // Large files are staged to S3 — stream from the presigned URL and
          // verify sha256 (+ byte count) end-to-end.
          const written = await atomicDownload(result.file_content_url, outPath, {
            ...(result.content_sha256 ? { expectedSha256: result.content_sha256 } : {}),
            ...(typeof result.size === 'number' && result.size > 0 ? { expectedSize: result.size } : {}),
          });
          info(`downloaded ${written} bytes${result.content_sha256 ? ' (sha256 verified)' : ''} → ${outPath}`);
        } else if (result.file_content) {
          // Small files arrive inline as hex.
          const buf = Buffer.from(result.file_content, 'hex');
          if (result.content_sha256) verifyBufferSha256(buf, result.content_sha256, 'download-file');
          await atomicWriteFile(outPath, buf);
          info(`downloaded ${buf.length} bytes${result.content_sha256 ? ' (sha256 verified)' : ''} → ${outPath}`);
        } else {
          fail(
            `download-file: '${slug}' returned no file content (neither inline bytes nor a download URL). ` +
              `The file may be empty, a folder, or unsupported for direct download.`
          );
        }
      } catch (e) {
        if (e instanceof IntegrityError) fail(`download-file failed integrity check: ${e.message}`);
        throw e;
      }
    });
}

function createIntegrationsFileInfoCommand(): Command {
  return new Command('file-info')
    .description('Show details for a single file — size, type, dates and version (Synergy + cloud storage)')
    .argument('<slug>', 'Native connector slug (synergy or OAuth cloud storage)')
    .argument('<file-id>', 'File id from `list-files` / `search-files`')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (slug: string, fileId: string, options: StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);
      const { kind } = resolveFileConnector(scope, slug);

      // Shared renderer — Synergy + OAuth both return ConnectorFileMetadataResult.
      const prettyFileMetadata = (r: ConnectorFileMetadataResult | null | undefined) => {
        if (!r) {
          process.stdout.write('(no result)\n');
          return;
        }
        const rows: Array<[string, string | undefined]> = [
          ['Name', r.name],
          ['Path', r.path],
          ['Size', typeof r.size === 'number' ? fmtSize(r.size) : undefined],
          ['Type', r.content_type],
          ['Created', r.created_at],
          ['Modified', r.modified_at],
          ['Checksum', r.checksum],
          ['Version', r.version],
          ['File ID', r.file_id],
        ];
        for (const [k, v] of rows) if (v) process.stdout.write(`${k}: ${v}\n`);
      };

      if (kind === 'synergy') {
        const params: ParamsForTool<'connect_synergy_file_info'> = { file_id: fileId };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_file_info',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('file-info', slug, res));
        emitResult({
          tool: 'connect_synergy_file_info',
          result: res.result,
          options,
          pretty: prettyFileMetadata,
        });
        return;
      }

      const params: ParamsForTool<'oauth_get_file_metadata'> = { provider: slug, file_id: fileId };
      const { accessToken, request } = await buildIntegrationsRequest({
        account,
        tool: 'oauth_get_file_metadata',
        params,
        userMessage: options.userMessage,
      });
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(connectorFailure('file-info', slug, res));

      emitResult({
        tool: 'oauth_get_file_metadata',
        result: res.result,
        options,
        pretty: prettyFileMetadata,
      });
    });
}

// --- Synergy read-only metadata commands (Phase 1) -------------------------
// Structure/stats/schema the file-browse ops don't surface. All read-only, no
// HITL, on the per-user-PAT native path (connect_synergy_* → oauth-workspace-tools).
const writeJson = (r: unknown) => process.stdout.write((r ? JSON.stringify(r, null, 2) : '(no result)') + '\n');

/**
 * Shared preamble for the Synergy metadata commands: resolve the active
 * profile + scope, then run the same connector-enabled scope guard the
 * file-browse commands use (`resolveFileConnector(scope, 'synergy')`). This
 * turns an unconnected user's late, generic credential error into the
 * actionable "enable it under Integrations" guidance up front. Returns the
 * resolved account for the subsequent request build.
 */
const requireSynergyScope = (): string => {
  const account = activeProfile();
  if (!account) fail('no active profile — run `numa login` first');
  const scope = resolveScopingContext(account);
  resolveFileConnector(scope, 'synergy');
  return account;
};

function createSynergyJobMetaCommand(): Command {
  return new Command('synergy-job')
    .description("Synergy: a job's details — its folders, how many files it has, and info like type, status and dates")
    .argument('<job-id>', 'Job IDString from list-files / search (e.g. 8_1)')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (jobId: string, options: StandardOptions) => {
      const account = requireSynergyScope();
      const params: ParamsForTool<'connect_synergy_job_meta'> = { job_id: jobId };
      const { accessToken, request } = await buildIntegrationsRequest({
        account,
        tool: 'connect_synergy_job_meta',
        params,
        userMessage: options.userMessage,
      });
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(connectorFailure('synergy-job', 'synergy', res));
      emitResult({ tool: 'connect_synergy_job_meta', result: res.result, options, pretty: writeJson });
    });
}

function createSynergyFolderSummaryCommand(): Command {
  return new Command('synergy-folder')
    .description('Synergy: how many folders and files are inside one folder')
    .argument('<folder-id>', 'Folder id from a job folder listing')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (folderId: string, options: StandardOptions) => {
      const account = requireSynergyScope();
      const params: ParamsForTool<'connect_synergy_folder_summary'> = { folder_id: folderId };
      const { accessToken, request } = await buildIntegrationsRequest({
        account,
        tool: 'connect_synergy_folder_summary',
        params,
        userMessage: options.userMessage,
      });
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(connectorFailure('synergy-folder', 'synergy', res));
      emitResult({ tool: 'connect_synergy_folder_summary', result: res.result, options, pretty: writeJson });
    });
}

// synergy-schema vocabulary modes/entities (the Wave-2 extension). The default
// (mode omitted) keeps the original zero-arg behaviour — job standard + search
// attributes — so existing callers/tests are unchanged.
const SCHEMA_MODES = ['job', 'file', 'contact', 'types', 'categories', 'find', 'choices'] as const;
type SchemaMode = (typeof SCHEMA_MODES)[number];
const parseSchemaMode = (v: string | undefined): SchemaMode | undefined => {
  if (v === undefined) return undefined;
  if ((SCHEMA_MODES as readonly string[]).includes(v)) return v as SchemaMode;
  fail(`invalid --mode '${v}' — use ${SCHEMA_MODES.join(' | ')}`);
};

const SCHEMA_ENTITIES = ['job', 'file', 'contact'] as const;
type SchemaEntity = (typeof SCHEMA_ENTITIES)[number];
const parseSchemaEntity = (v: string | undefined): SchemaEntity | undefined => {
  if (v === undefined) return undefined;
  if ((SCHEMA_ENTITIES as readonly string[]).includes(v)) return v as SchemaEntity;
  fail(`invalid --entity '${v}' — use ${SCHEMA_ENTITIES.join(' | ')}`);
};

function createSynergySchemaCommand(): Command {
  return new Command('synergy-schema')
    .description(
      'Synergy: the attribute/type/enum vocabulary you can search, filter, group or report on. ' +
        'Default (no --mode) returns the job standard + search attributes. Other modes expose the file/contact ' +
        'attribute sets, the decode enums (--mode types: attribute/match-operation/entity/file/folder/folder-state/' +
        'note-target types), the category taxonomy (--mode categories), a single attribute by name (--mode find --name), ' +
        "and an attribute's valid enum choices (--mode choices --name)."
    )
    .option(
      '--mode <mode>',
      "Vocabulary slice: 'job' (default) | 'file' | 'contact' | 'types' | 'categories' | 'find' | 'choices'"
    )
    .option(
      '--entity <entity>',
      "Attribute scope for mode=file/contact and the find search context: 'job' | 'file' | 'contact' (default job)"
    )
    .option('--name <name>', 'Attribute name to resolve (required for --mode find / --mode choices)')
    .option(
      '--type-name <name>',
      'Named enum to resolve via /types?type_name=... (--mode types; omit for the fixed decode-enum set)'
    )
    .option(
      '--extension <ext>',
      "File extension for system file attributes, e.g. 'dwg' (--mode file; skipped when omitted)"
    )
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          mode?: string;
          entity?: string;
          name?: string;
          typeName?: string;
          extension?: string;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const mode = parseSchemaMode(options.mode);
        const entity = parseSchemaEntity(options.entity);
        const params: ParamsForTool<'connect_synergy_schema'> = {
          ...(mode ? { mode } : {}),
          ...(entity ? { entity } : {}),
          ...(options.name ? { name: options.name } : {}),
          ...(options.typeName ? { type_name: options.typeName } : {}),
          ...(options.extension ? { extension: options.extension } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_schema',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-schema', 'synergy', res));
        emitResult({ tool: 'connect_synergy_schema', result: res.result, options, pretty: writeJson });
      }
    );
}

function createSynergyJobStatsCommand(): Command {
  return new Command('synergy-stats')
    .description('Synergy: a summary of a job — how many files, what kinds, how big, and how the folders are arranged')
    .argument('<job-id>', 'Job IDString from list-files / search')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (jobId: string, options: StandardOptions) => {
      const account = requireSynergyScope();
      const params: ParamsForTool<'connect_synergy_job_stats'> = { job_id: jobId };
      const { accessToken, request } = await buildIntegrationsRequest({
        account,
        tool: 'connect_synergy_job_stats',
        params,
        userMessage: options.userMessage,
      });
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(connectorFailure('synergy-stats', 'synergy', res));
      emitResult({ tool: 'connect_synergy_job_stats', result: res.result, options, pretty: writeJson });
    });
}

function createSynergyJobTreeCommand(): Command {
  return new Command('synergy-tree')
    .description("Synergy: a job's folder layout, with the number of files in each folder")
    .argument('<job-id>', 'Job id from list-files / search')
    .option('--max-depth <n>', 'How many folder levels deep to look (default 10)', (v) => parseInt(v, 10))
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (jobId: string, options: { maxDepth?: number } & StandardOptions) => {
      const account = requireSynergyScope();
      const params: ParamsForTool<'connect_synergy_job_tree'> = {
        job_id: jobId,
        ...(options.maxDepth !== undefined ? { max_depth: options.maxDepth } : {}),
      };
      const { accessToken, request } = await buildIntegrationsRequest({
        account,
        tool: 'connect_synergy_job_tree',
        params,
        userMessage: options.userMessage,
      });
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(connectorFailure('synergy-tree', 'synergy', res));
      emitResult({ tool: 'connect_synergy_job_tree', result: res.result, options, pretty: writeJson });
    });
}

// "Name" → the stamped key: a fixed field stays as-is, otherwise attr_<snake>
// (matches the crawler's _attr_key + the synergy-text-crawler stamping).
const synergyStampedKey = (name: string): string => {
  const snake = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ['is_template', 'created_date', 'parent_job_id'].includes(snake) ? snake : `attr_${snake}`;
};

function createSynergyPortfolioCommand(): Command {
  return new Command('synergy-portfolio')
    .description(
      'Synergy: count or list jobs across your whole Synergy account by their details — e.g. every council job, or jobs created this year. Use this when you want a total or a complete list (only jobs the user is allowed to see). To find a few jobs like a description instead, use "find similar jobs".'
    )
    .option(
      '--attr <name=value>',
      'Only jobs where a field matches, e.g. --attr "Job Type=Council". Repeat for more; see field names with synergy-schema.',
      (val: string, acc: string[] = []) => {
        acc.push(val);
        return acc;
      },
      [] as string[]
    )
    .option('--created-after <date>', 'Only jobs created on or after this date (YYYY-MM-DD)')
    .option('--created-before <date>', 'Only jobs created on or before this date (YYYY-MM-DD)')
    .option('--exclude-templates', 'Leave out template jobs')
    .option('--group-by <name>', 'Break the totals down by a field, e.g. --group-by "Status"')
    .option('--limit <n>', 'How many jobs to list (the total count is always complete)', (v) => parseInt(v, 10))
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          attr?: string[];
          createdAfter?: string;
          createdBefore?: string;
          excludeTemplates?: boolean;
          groupBy?: string;
          limit?: number;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const attrs: Record<string, string> = {};
        for (const kv of options.attr ?? []) {
          const eq = kv.indexOf('=');
          if (eq > 0) attrs[synergyStampedKey(kv.slice(0, eq))] = kv.slice(eq + 1).trim();
        }
        const params: ParamsForTool<'connect_synergy_portfolio'> = {
          ...(Object.keys(attrs).length ? { attrs } : {}),
          ...(options.createdAfter ? { created_after: options.createdAfter } : {}),
          ...(options.createdBefore ? { created_before: options.createdBefore } : {}),
          ...(options.excludeTemplates ? { exclude_templates: true } : {}),
          ...(options.groupBy ? { group_by: synergyStampedKey(options.groupBy) } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_portfolio',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-portfolio', 'synergy', res));
        emitResult({ tool: 'connect_synergy_portfolio', result: res.result, options, pretty: writeJson });
      }
    );
}

function createSynergyExactTermCommand(): Command {
  return new Command('synergy-exact-term')
    .description(
      'Synergy: find every job that contains these exact words/codes (e.g. a supplier name, drawing number, or standard like AS3500). Exhaustive and literal — for "jobs like a description" use "find similar jobs" instead.'
    )
    .argument('<terms...>', 'One or more literal words/codes; all must match unless --or')
    .option('--or', 'Match jobs containing ANY of the terms (default: all)')
    .option('--limit <n>', 'Max jobs to list (default 100)', (v) => parseInt(v, 10))
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (terms: string[], options: { or?: boolean; limit?: number } & StandardOptions) => {
      const account = requireSynergyScope();
      const params: ParamsForTool<'connect_synergy_exact_term'> = {
        terms,
        ...(options.or ? { mode: 'OR' as const } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      };
      const { accessToken, request } = await buildIntegrationsRequest({
        account,
        tool: 'connect_synergy_exact_term',
        params,
        userMessage: options.userMessage,
      });
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(connectorFailure('synergy-exact-term', 'synergy', res));
      emitResult({ tool: 'connect_synergy_exact_term', result: res.result, options, pretty: writeJson });
    });
}

// --- Synergy read-only API tools (Wave 1) ----------------------------------
// 6 NEW connect_synergy_* tools on the per-user-PAT native path
// (oauth-workspace-tools). 12d enforces permissions on the user's PAT → these
// are live reads, NOT crawl-table queries → no Numa ACL layer, NO metering.
// Same shape as the Phase-1 metadata commands above: requireSynergyScope()
// guard, build snake_case params, invokeTool with the matching tool_id, emit
// with writeJson. job:/folder:-prefixed ids are stripped server-side
// (_bare_synergy_id) — pass them through verbatim.

// Validating parsers for the literal-union enum flags (mirrors parseMethodFlag):
// the tool param types pin these to string-literal unions, so fail loudly on a
// bad value rather than shipping a string the handler would have to re-reject.
// Wave 3 folds in two account-wide modes (directory / global-lists) alongside
// the original job/search/get job-scoped lookups.
const CONTACTS_MODES = ['job', 'search', 'get', 'directory', 'global-lists'] as const;
type ContactsMode = (typeof CONTACTS_MODES)[number];
const parseContactsMode = (v: string | undefined): ContactsMode | undefined => {
  if (v === undefined) return undefined;
  if ((CONTACTS_MODES as readonly string[]).includes(v)) return v as ContactsMode;
  fail(`invalid --mode '${v}' — use ${CONTACTS_MODES.join(' | ')}`);
};

// Wave 3 fold-in: single-task detail + task vocab on top of the default list.
const TASKS_MODES = ['list', 'detail', 'vocab'] as const;
type TasksMode = (typeof TASKS_MODES)[number];
const parseTasksMode = (v: string | undefined): TasksMode | undefined => {
  if (v === undefined) return undefined;
  if ((TASKS_MODES as readonly string[]).includes(v)) return v as TasksMode;
  fail(`invalid --mode '${v}' — use ${TASKS_MODES.join(' | ')}`);
};

// Wave 3 fold-in: connect_synergy_file_info gains permission/access/by-name/
// version reads alongside the default info read.
const FILE_INFO_MODES = ['info', 'permission', 'access', 'by-name', 'version'] as const;
type FileInfoMode = (typeof FILE_INFO_MODES)[number];
const parseFileInfoMode = (v: string | undefined): FileInfoMode | undefined => {
  if (v === undefined) return undefined;
  if ((FILE_INFO_MODES as readonly string[]).includes(v)) return v as FileInfoMode;
  fail(`invalid --mode '${v}' — use ${FILE_INFO_MODES.join(' | ')}`);
};

// Wave 3 NEW tool connect_synergy_resolve: turn a pasted 12d link/path into an
// entity ref (+ clickable URL). All three modes are non-mutating admin reads.
const RESOLVE_MODES = ['link', 'path', 'weblink'] as const;
type ResolveMode = (typeof RESOLVE_MODES)[number];
const parseResolveMode = (v: string | undefined): ResolveMode | undefined => {
  if (v === undefined) return undefined;
  if ((RESOLVE_MODES as readonly string[]).includes(v)) return v as ResolveMode;
  fail(`invalid --mode '${v}' — use ${RESOLVE_MODES.join(' | ')}`);
};

const WORKFLOW_MODES = ['definitions', 'definition', 'instance', 'transition_log', 'diagram'] as const;
type WorkflowMode = (typeof WORKFLOW_MODES)[number];
const parseWorkflowMode = (v: string | undefined): WorkflowMode | undefined => {
  if (v === undefined) return undefined;
  if ((WORKFLOW_MODES as readonly string[]).includes(v)) return v as WorkflowMode;
  fail(`invalid --mode '${v}' — use ${WORKFLOW_MODES.join(' | ')}`);
};

const ENTITY_TYPES = ['job', 'issue', 'task'] as const;
type EntityType = (typeof ENTITY_TYPES)[number];
const parseEntityType = (v: string | undefined): EntityType | undefined => {
  if (v === undefined) return undefined;
  if ((ENTITY_TYPES as readonly string[]).includes(v)) return v as EntityType;
  fail(`invalid --entity-type '${v}' — use ${ENTITY_TYPES.join(' | ')}`);
};

function createSynergyTasksCommand(): Command {
  return (
    new Command('synergy-tasks')
      .description(
        "Synergy: a job's tasks — who owns each one, its state, due date and priority (default list mode). " +
          '--task-id reads one task in full (its children + history); --mode vocab (with --task-type-id) reads the ' +
          'task-type / task-state vocabulary.'
      )
      // job-id is required only for the default list mode; detail (--task-id) and
      // vocab (--task-type-id) modes are not job-scoped, so make it optional.
      .argument('[job-id]', 'Job IDString from list-files / search (accepts job:/folder: prefix, e.g. 8_1) — list mode')
      .option('--mode <mode>', "What to read: 'list' (default) | 'detail' (--task-id) | 'vocab' (--task-type-id)")
      .option('--task-id <id>', 'A single task id → detail mode (one task with its children + history)')
      .option('--task-type-id <id>', 'A task-type id → vocab mode (its states; omit for the full task-type catalogue)')
      .option('--assignee-id <id>', 'list mode: only tasks assigned to this contact/user id (forces the search path)')
      .option('--include-closed', 'list mode: include closed tasks as well as open ones (default: open only)')
      .option('--limit <n>', 'list mode: max tasks to return (default 200)', (v) => parseInt(v, 10))
      .option('-m, --user-message <text>', CAPTION_HELP)
      .option('--pretty', 'Force human-readable output')
      .option('--standard', 'Force standard envelope output (LLM-friendly)')
      .option('--json', 'Force raw JSON output')
      .action(
        async (
          jobId: string | undefined,
          options: {
            mode?: string;
            taskId?: string;
            taskTypeId?: string;
            assigneeId?: string;
            includeClosed?: boolean;
            limit?: number;
          } & StandardOptions
        ) => {
          const account = requireSynergyScope();
          const mode = parseTasksMode(options.mode);
          const params: ParamsForTool<'connect_synergy_tasks'> = {
            ...(mode ? { mode } : {}),
            ...(jobId ? { job_id: jobId } : {}),
            ...(options.taskId ? { task_id: options.taskId } : {}),
            ...(options.taskTypeId ? { task_type_id: options.taskTypeId } : {}),
            ...(options.assigneeId ? { assignee_id: options.assigneeId } : {}),
            ...(options.includeClosed ? { include_closed: true } : {}),
            ...(options.limit !== undefined ? { limit: options.limit } : {}),
          };
          const { accessToken, request } = await buildIntegrationsRequest({
            account,
            tool: 'connect_synergy_tasks',
            params,
            userMessage: options.userMessage,
          });
          const res = await invokeTool(account, accessToken, request);
          if (res.status === 'error') fail(connectorFailure('synergy-tasks', 'synergy', res));
          emitResult({ tool: 'connect_synergy_tasks', result: res.result, options, pretty: writeJson });
        }
      )
  );
}

function createSynergyContactsCommand(): Command {
  return new Command('synergy-contacts')
    .description(
      'Synergy: people on a job or in the directory — contact lists for a job, a free-text/structured search, or one ' +
        "contact's details. --mode directory walks the full account address book (paged); --mode global-lists reads " +
        "the global contact lists. (For a job's PM/foreman, the job's PM attribute via synergy-job may answer too.)"
    )
    .option(
      '--mode <mode>',
      "How to look up contacts: 'job' | 'search' | 'get' | 'directory' | 'global-lists' (inferred from the other flags if omitted)"
    )
    .option('--job-id <id>', 'Job id for mode=job (accepts job:/folder: prefix)')
    .option('--contact-id <id>', 'Contact id for mode=get (a contact id, NOT a job:/folder: id)')
    .option('--query <text>', 'Free-text search term for mode=search')
    .option('--first-name <name>', 'Structured search: first name')
    .option('--last-name <name>', 'Structured search: last name')
    .option('--email <email>', 'Structured search: email')
    .option('--users-only', 'Restrict the search to Synergy users (default: all contacts)')
    .option('--page <n>', 'First page for mode=directory, 1-based (default 1)', (v) => parseInt(v, 10))
    .option('--page-size <n>', 'Page size for structured search and mode=directory (default 50)', (v) =>
      parseInt(v, 10)
    )
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          mode?: string;
          jobId?: string;
          contactId?: string;
          query?: string;
          firstName?: string;
          lastName?: string;
          email?: string;
          usersOnly?: boolean;
          page?: number;
          pageSize?: number;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const mode = parseContactsMode(options.mode);
        const params: ParamsForTool<'connect_synergy_contacts'> = {
          ...(mode ? { mode } : {}),
          ...(options.jobId ? { job_id: options.jobId } : {}),
          ...(options.contactId ? { contact_id: options.contactId } : {}),
          ...(options.query ? { query: options.query } : {}),
          ...(options.firstName ? { first_name: options.firstName } : {}),
          ...(options.lastName ? { last_name: options.lastName } : {}),
          ...(options.email ? { email: options.email } : {}),
          ...(options.usersOnly ? { users_only: true } : {}),
          ...(options.page !== undefined ? { page: options.page } : {}),
          ...(options.pageSize !== undefined ? { page_size: options.pageSize } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_contacts',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-contacts', 'synergy', res));
        emitResult({ tool: 'connect_synergy_contacts', result: res.result, options, pretty: writeJson });
      }
    );
}

function createSynergyIssuesCommand(): Command {
  return new Command('synergy-issues')
    .description("Synergy: issues / RFIs on a job — list them for a job, or get one issue's full detail with comments")
    .option(
      '--job-id <id>',
      'List issues for this job (accepts job:/folder: prefix). Use this OR --issue-id, not both.'
    )
    .option('--issue-id <id>', 'Get the full detail for one issue. Use this OR --job-id, not both.')
    .option('--page <n>', 'First page of results in list mode (default 1)', (v) => parseInt(v, 10))
    .option('--page-size <n>', 'Page size in list mode (default 50, the walk is bounded)', (v) => parseInt(v, 10))
    .option('--no-details', 'In detail mode, skip the expanded issue details')
    .option('--include-changes', 'In detail mode, also fetch the issue change log (best-effort)')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          jobId?: string;
          issueId?: string;
          page?: number;
          pageSize?: number;
          details?: boolean;
          includeChanges?: boolean;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const params: ParamsForTool<'connect_synergy_issues'> = {
          ...(options.jobId ? { job_id: options.jobId } : {}),
          ...(options.issueId ? { issue_id: options.issueId } : {}),
          ...(options.page !== undefined ? { page: options.page } : {}),
          ...(options.pageSize !== undefined ? { page_size: options.pageSize } : {}),
          // commander sets `details: false` when --no-details is passed; only
          // forward the explicit override (default true is the server default).
          ...(options.details === false ? { retrieve_details: false } : {}),
          ...(options.includeChanges ? { include_changes: true } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_issues',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-issues', 'synergy', res));
        emitResult({ tool: 'connect_synergy_issues', result: res.result, options, pretty: writeJson });
      }
    );
}

function createSynergyWorkflowCommand(): Command {
  return new Command('synergy-workflow')
    .description(
      'Synergy: workflow status (read-only) — list workflow definitions, view one definition, get the live state of a workflow on a job/issue/task, read a transition log, or fetch a workflow diagram image'
    )
    .option(
      '--mode <mode>',
      "What to read: 'definitions' | 'definition' | 'instance' | 'transition_log' | 'diagram' (defaults to definitions, or instance when --entity-id is given)"
    )
    .option('--workflow-id <id>', 'Workflow id (required for definition / instance / diagram modes)')
    .option('--entity-id <id>', 'The job/issue/task the workflow runs on (instance mode)')
    .option('--entity-type <type>', "Entity kind for instance mode: 'job' | 'issue' | 'task'")
    .option('--instance-id <id>', 'Workflow instance id (transition_log mode, or to skip instance lookup)')
    .option('--current-state-id <id>', 'Current state id to highlight in the diagram (diagram mode)')
    .option('--no-return-all', 'In definition mode, return only the summary (default: return everything)')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          mode?: string;
          workflowId?: string;
          entityId?: string;
          entityType?: string;
          instanceId?: string;
          currentStateId?: string;
          returnAll?: boolean;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const mode = parseWorkflowMode(options.mode);
        const entityType = parseEntityType(options.entityType);
        const params: ParamsForTool<'connect_synergy_workflow'> = {
          ...(mode ? { mode } : {}),
          ...(options.workflowId ? { workflow_id: options.workflowId } : {}),
          ...(options.entityId ? { entity_id: options.entityId } : {}),
          ...(entityType ? { entity_type: entityType } : {}),
          ...(options.instanceId ? { instance_id: options.instanceId } : {}),
          ...(options.currentStateId ? { current_state_id: options.currentStateId } : {}),
          // commander sets `returnAll: false` only when --no-return-all is passed.
          ...(options.returnAll === false ? { return_all: false } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_workflow',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-workflow', 'synergy', res));
        emitResult({ tool: 'connect_synergy_workflow', result: res.result, options, pretty: writeJson });
      }
    );
}

function createSynergyFileHistoryCommand(): Command {
  return new Command('synergy-file-history')
    .description("Synergy: a file's version history — who changed it, when, and how (versions list)")
    .argument('<file-id>', 'File id from list-files / search-files (must be a FILE id, not a job:/folder: id)')
    .option('--page <n>', 'Page of history to fetch, 1-based (default 1)', (v) => parseInt(v, 10))
    .option('--page-size <n>', 'Max history rows per page (default 50)', (v) => parseInt(v, 10))
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (fileId: string, options: { page?: number; pageSize?: number } & StandardOptions) => {
      const account = requireSynergyScope();
      const params: ParamsForTool<'connect_synergy_file_history'> = {
        file_id: fileId,
        ...(options.page !== undefined ? { page: options.page } : {}),
        ...(options.pageSize !== undefined ? { page_size: options.pageSize } : {}),
      };
      const { accessToken, request } = await buildIntegrationsRequest({
        account,
        tool: 'connect_synergy_file_history',
        params,
        userMessage: options.userMessage,
      });
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(connectorFailure('synergy-file-history', 'synergy', res));
      emitResult({ tool: 'connect_synergy_file_history', result: res.result, options, pretty: writeJson });
    });
}

function createSynergyRecentCommand(): Command {
  return new Command('synergy-recent')
    .description(
      'Synergy: what changed recently in a job or folder — recently modified files, who changed them and when. Polling-based (no webhooks): re-run periodically, do not tight-loop.'
    )
    .option('--job-id <id>', 'Look at recent changes in this job (accepts job:/folder: prefix). Use job OR folder.')
    .option('--folder-id <id>', 'Look at recent changes in this folder (wins if both are given).')
    .option('--days <n>', 'How many days back to look (default 7; ignored if --since is set)', (v) => parseInt(v, 10))
    .option('--since <iso>', 'Only changes on or after this ISO-UTC timestamp (overrides --days)')
    .option('--limit <n>', 'Max changes to return (default 100)', (v) => parseInt(v, 10))
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: { jobId?: string; folderId?: string; days?: number; since?: string; limit?: number } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const params: ParamsForTool<'connect_synergy_recent'> = {
          ...(options.jobId ? { job_id: options.jobId } : {}),
          ...(options.folderId ? { folder_id: options.folderId } : {}),
          ...(options.days !== undefined ? { days: options.days } : {}),
          ...(options.since ? { since: options.since } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_recent',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-recent', 'synergy', res));
        emitResult({ tool: 'connect_synergy_recent', result: res.result, options, pretty: writeJson });
      }
    );
}

// --- Synergy read-only API tools (Wave 2) ----------------------------------
// 9 NEW connect_synergy_* tools on the per-user-PAT native path
// (oauth-workspace-tools). Same shape as Wave 1: requireSynergyScope() guard,
// snake_case params, invokeTool with the matching tool_id, emit with writeJson.
// job:/folder:-prefixed ids are stripped server-side (_bare_synergy_id). All
// read-only, PAT-scoped, no Numa ACL, no metering. Most response schemas are
// [UNKNOWN] (12d Swagger 200-only) → defensive parsing happens server-side.

// Validating parsers for the literal-union mode/section flags (mirror
// parseContactsMode/parseWorkflowMode): the tool param types pin these to
// string-literal unions, so fail loudly on a bad value up front.
const FORUMS_MODES = ['list', 'forum', 'categories', 'category', 'topics', 'topic', 'posts'] as const;
type ForumsMode = (typeof FORUMS_MODES)[number];
const parseForumsMode = (v: string | undefined): ForumsMode | undefined => {
  if (v === undefined) return undefined;
  if ((FORUMS_MODES as readonly string[]).includes(v)) return v as ForumsMode;
  fail(`invalid --mode '${v}' — use ${FORUMS_MODES.join(' | ')}`);
};

const PROJECTS_MODES = [
  'find',
  'list',
  'get',
  'folders',
  'file-info',
  'associations',
  'notes',
  'permission',
  'history',
  'changed-elements',
  'latest-change',
  'preview',
] as const;
type ProjectsMode = (typeof PROJECTS_MODES)[number];
const parseProjectsMode = (v: string | undefined): ProjectsMode | undefined => {
  if (v === undefined) return undefined;
  if ((PROJECTS_MODES as readonly string[]).includes(v)) return v as ProjectsMode;
  fail(`invalid --mode '${v}' — use ${PROJECTS_MODES.join(' | ')}`);
};

const TRANSMITTALS_MODES = ['types', 'sets', 'set', 'issue', 'discover', 'attributes'] as const;
type TransmittalsMode = (typeof TRANSMITTALS_MODES)[number];
const parseTransmittalsMode = (v: string | undefined): TransmittalsMode | undefined => {
  if (v === undefined) return undefined;
  if ((TRANSMITTALS_MODES as readonly string[]).includes(v)) return v as TransmittalsMode;
  fail(`invalid --mode '${v}' — use ${TRANSMITTALS_MODES.join(' | ')}`);
};

const COMPANIES_MODES = ['list', 'get', 'jobs', 'staff', 'schema'] as const;
type CompaniesMode = (typeof COMPANIES_MODES)[number];
const parseCompaniesMode = (v: string | undefined): CompaniesMode | undefined => {
  if (v === undefined) return undefined;
  if ((COMPANIES_MODES as readonly string[]).includes(v)) return v as CompaniesMode;
  fail(`invalid --mode '${v}' — use ${COMPANIES_MODES.join(' | ')}`);
};

const WEBFORMS_MODES = ['enabled', 'definitions', 'fills'] as const;
type WebformsMode = (typeof WEBFORMS_MODES)[number];
const parseWebformsMode = (v: string | undefined): WebformsMode | undefined => {
  if (v === undefined) return undefined;
  if ((WEBFORMS_MODES as readonly string[]).includes(v)) return v as WebformsMode;
  fail(`invalid --mode '${v}' — use ${WEBFORMS_MODES.join(' | ')}`);
};

const JOB_EXTRAS_SECTIONS = [
  'team',
  'roles',
  'reports',
  'report',
  'report_inputs',
  'clashes',
  'clash_items',
  'clash_report',
  // Wave 3 fold-in: lightweight job-header reads.
  'dashboard',
  // Per-job role assignments (jobs/{id}/roles) — distinct from the GLOBAL
  // `roles` reference above; honours --users-only.
  'job-roles',
  'categories',
  'job-file-attributes',
] as const;
type JobExtrasSection = (typeof JOB_EXTRAS_SECTIONS)[number];
const parseJobExtrasSection = (v: string | undefined): JobExtrasSection | undefined => {
  if (v === undefined) return undefined;
  if ((JOB_EXTRAS_SECTIONS as readonly string[]).includes(v)) return v as JobExtrasSection;
  fail(`invalid --section '${v}' — use ${JOB_EXTRAS_SECTIONS.join(' | ')}`);
};

const NOTES_SECTIONS = ['notes', 'associations'] as const;
type NotesSection = (typeof NOTES_SECTIONS)[number];
const parseNotesSection = (v: string | undefined): NotesSection | undefined => {
  if (v === undefined) return undefined;
  if ((NOTES_SECTIONS as readonly string[]).includes(v)) return v as NotesSection;
  fail(`invalid --section '${v}' — use ${NOTES_SECTIONS.join(' | ')}`);
};

const NOTES_SCOPES = ['job', 'file', 'folder', 'project'] as const;
type NotesScope = (typeof NOTES_SCOPES)[number];
const parseNotesScope = (v: string | undefined): NotesScope | undefined => {
  if (v === undefined) return undefined;
  if ((NOTES_SCOPES as readonly string[]).includes(v)) return v as NotesScope;
  fail(`invalid --scope '${v}' — use ${NOTES_SCOPES.join(' | ')}`);
};

const USERS_MODES = ['lookup', 'checkouts', 'module'] as const;
type UsersMode = (typeof USERS_MODES)[number];
const parseUsersMode = (v: string | undefined): UsersMode | undefined => {
  if (v === undefined) return undefined;
  if ((USERS_MODES as readonly string[]).includes(v)) return v as UsersMode;
  fail(`invalid --mode '${v}' — use ${USERS_MODES.join(' | ')}`);
};

function createSynergyForumsCommand(): Command {
  return new Command('synergy-forums')
    .description(
      "Synergy: a job's forums / discussion threads (read-only) — list a job's forums, open a forum, walk its " +
        'categories -> topics -> posts to read a thread. Pass the deepest id you have: --topic-id reads a thread, ' +
        '--category-id lists its threads, --forum-id lists its categories, --job-id lists the forums.'
    )
    .option(
      '--mode <mode>',
      "What to read: 'list' | 'forum' | 'categories' | 'category' | 'topics' | 'topic' | 'posts' (inferred from the ids you pass)"
    )
    .option('--job-id <id>', 'Job IDString for mode=list (accepts job:/folder: prefix, e.g. 12051_1)')
    .option('--forum-id <id>', 'Forum id for mode=forum/categories/category (a forum id, NOT a job:/folder: id)')
    .option('--category-id <id>', 'Category id for mode=category/topics')
    .option('--topic-id <id>', 'Topic (thread) id for mode=topic/posts — the thread to read')
    .option('--page <n>', 'First page for paged modes topics/posts (default 1)', (v) => parseInt(v, 10))
    .option('--page-size <n>', 'Page size for paged modes (default 50, the walk is bounded)', (v) => parseInt(v, 10))
    .option('--include-permission', "In mode=forum, also fetch the caller's own permission on the forum (best-effort)")
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          mode?: string;
          jobId?: string;
          forumId?: string;
          categoryId?: string;
          topicId?: string;
          page?: number;
          pageSize?: number;
          includePermission?: boolean;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const mode = parseForumsMode(options.mode);
        const params: ParamsForTool<'connect_synergy_forums'> = {
          ...(mode ? { mode } : {}),
          ...(options.jobId ? { job_id: options.jobId } : {}),
          ...(options.forumId ? { forum_id: options.forumId } : {}),
          ...(options.categoryId ? { category_id: options.categoryId } : {}),
          ...(options.topicId ? { topic_id: options.topicId } : {}),
          ...(options.page !== undefined ? { page: options.page } : {}),
          ...(options.pageSize !== undefined ? { page_size: options.pageSize } : {}),
          ...(options.includePermission ? { include_permission: true } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_forums',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-forums', 'synergy', res));
        emitResult({ tool: 'connect_synergy_forums', result: res.result, options, pretty: writeJson });
      }
    );
}

function createSynergyProjectsCommand(): Command {
  return new Command('synergy-projects')
    .description(
      'Synergy: 12d PROJECTS (read-only) — the 12d Model software projects embedded inside a job/folder ' +
        '(NOT Synergy jobs; for those use synergy-list / synergy-search / synergy-job). Find a project by name, ' +
        'list the projects in a job/folder, read one project (metadata/details/description), browse its sub-folders ' +
        'or a file inside it, read its associations/notes/permission/history/changed-elements/latest-change, or ' +
        'fetch its preview image.'
    )
    .option(
      '--mode <mode>',
      'What to do: find | list | get | folders | file-info | associations | notes | permission | history | changed-elements | latest-change | preview (inferred from the ids you pass)'
    )
    .option('--project-id <id>', '12d Project IDString, e.g. 900_1 (NOT a Synergy job id)')
    .option(
      '--job-id <id>',
      'Synergy job to list 12d projects under (mode=list, job scope; accepts job:/folder: prefix)'
    )
    .option(
      '--folder-id <id>',
      'Synergy folder to list 12d projects under (mode=list), OR a sub-folder to scope mode=history'
    )
    .option('--name <name>', 'Project name to locate (mode=find)')
    .option('--file-name <name>', 'Name of a file (or folder) inside the project to inspect (mode=file-info)')
    .option('--is-folder', 'mode=file-info: treat --file-name as a folder rather than a file')
    .option('--version <n>', 'Version for changed-elements / preview (defaults to latest when omitted)', (v) =>
      parseInt(v, 10)
    )
    .option('--page <n>', 'First page for mode=history (default 1)', (v) => parseInt(v, 10))
    .option('--page-size <n>', 'Page size for mode=history (default 50)', (v) => parseInt(v, 10))
    .option('--no-retrieve-attributes', 'Skip custom attributes on get/folders/file-info (default: include them)')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          mode?: string;
          projectId?: string;
          jobId?: string;
          folderId?: string;
          name?: string;
          fileName?: string;
          isFolder?: boolean;
          version?: number;
          page?: number;
          pageSize?: number;
          retrieveAttributes?: boolean;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const mode = parseProjectsMode(options.mode);
        const params: ParamsForTool<'connect_synergy_projects'> = {
          ...(mode ? { mode } : {}),
          ...(options.projectId ? { project_id: options.projectId } : {}),
          ...(options.jobId ? { job_id: options.jobId } : {}),
          ...(options.folderId ? { folder_id: options.folderId } : {}),
          ...(options.name ? { name: options.name } : {}),
          ...(options.fileName ? { file_name: options.fileName } : {}),
          ...(options.isFolder ? { is_folder: true } : {}),
          ...(options.version !== undefined ? { version: options.version } : {}),
          ...(options.page !== undefined ? { page: options.page } : {}),
          ...(options.pageSize !== undefined ? { page_size: options.pageSize } : {}),
          // commander sets `retrieveAttributes: false` only when --no-retrieve-attributes is passed.
          ...(options.retrieveAttributes === false ? { retrieve_attributes: false } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_projects',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-projects', 'synergy', res));
        emitResult({ tool: 'connect_synergy_projects', result: res.result, options, pretty: writeJson });
      }
    );
}

function createSynergyTransmittalsCommand(): Command {
  return new Command('synergy-transmittals')
    .description(
      'Synergy: Issued Files / transmittals on a job (read-only) — list the file-set types, the issued file-sets, ' +
        "one set's detail and issues, or one issue (publish event) with its published files and recipients. " +
        "--mode discover chains job -> types -> sets to answer 'list this job's transmittals' in one call. NOTE: an " +
        "'issue' here is a transmittal publish event, NOT an issue-tracking RFI (that is synergy-issues)."
    )
    .option(
      '--mode <mode>',
      "What to read: 'types' | 'sets' | 'set' | 'issue' | 'discover' | 'attributes' (inferred from the ids you pass)"
    )
    .option('--job-id <id>', 'Job IDString for modes types/sets/discover (accepts job:/folder: prefix)')
    .option('--type-id <id>', 'File-set TYPE id (required for mode=sets; resolved automatically in discover)')
    .option('--set-id <id>', 'Issued file-SET id (required for mode=set) — a versioned transmittal bundle')
    .option('--no-issues', "In mode=set, omit the set's issues (publish events) (default: include them)")
    .option('--version <n>', "In mode=set, also fetch that set version's files", (v) => parseInt(v, 10))
    .option('--issue-id <id>', 'An issued-files ISSUE (publish event) id for mode=issue (NOT an RFI id)')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          mode?: string;
          jobId?: string;
          typeId?: string;
          setId?: string;
          issues?: boolean;
          version?: number;
          issueId?: string;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const mode = parseTransmittalsMode(options.mode);
        const params: ParamsForTool<'connect_synergy_transmittals'> = {
          ...(mode ? { mode } : {}),
          ...(options.jobId ? { job_id: options.jobId } : {}),
          ...(options.typeId ? { type_id: options.typeId } : {}),
          ...(options.setId ? { set_id: options.setId } : {}),
          // commander sets `issues: false` only when --no-issues is passed (default true is the server default).
          ...(options.issues === false ? { get_issues: false } : {}),
          ...(options.version !== undefined ? { version: options.version } : {}),
          ...(options.issueId ? { issue_id: options.issueId } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_transmittals',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-transmittals', 'synergy', res));
        emitResult({ tool: 'connect_synergy_transmittals', result: res.result, options, pretty: writeJson });
      }
    );
}

function createSynergyCompaniesCommand(): Command {
  return new Command('synergy-companies')
    .description(
      'Synergy: companies / organisations (read-only) — list companies, get one company with its attributes, ' +
        "a company's jobs, a company's staff (contacts), or the system company-attribute vocabulary. Pairs with " +
        'synergy-contacts (each contact carries a companies[] back-reference).'
    )
    .option('--mode <mode>', "What to read: 'list' | 'get' | 'jobs' | 'staff' | 'schema' (inferred from --company-id)")
    .option('--company-id <id>', 'Company IDString (e.g. 50_1) for get/jobs/staff modes')
    .option('--limit <n>', 'Max rows for list/jobs/staff (default 200; truncated flagged when exceeded)', (v) =>
      parseInt(v, 10)
    )
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          mode?: string;
          companyId?: string;
          limit?: number;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const mode = parseCompaniesMode(options.mode);
        const params: ParamsForTool<'connect_synergy_companies'> = {
          ...(mode ? { mode } : {}),
          ...(options.companyId ? { company_id: options.companyId } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_companies',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-companies', 'synergy', res));
        emitResult({ tool: 'connect_synergy_companies', result: res.result, options, pretty: writeJson });
      }
    );
}

function createSynergyWebformsCommand(): Command {
  return new Command('synergy-webforms')
    .description(
      'Synergy: web forms (read-only) — check whether webforms are enabled, list form DEFINITIONS (scoped to a ' +
        'job/task/task-type, or one by id) or list form FILLS / submissions (scoped to a job/file/task, a server-side ' +
        "search, one fill with its answers, or a fill's output files). Default mode is inferred from the ids you pass."
    )
    .option('--mode <mode>', "What to read: 'enabled' | 'definitions' | 'fills' (inferred from the ids you pass)")
    .option('--job-id <id>', 'Job IDString — default scope for definitions and fills (accepts job:/folder: prefix)')
    .option('--task-id <id>', 'Task IDString — scopes definitions (by-task) and fills (by-task)')
    .option('--task-type-id <id>', 'Task-type id — scopes definitions to a task type')
    .option('--file-id <id>', 'File IDString — scopes fills to a file (a FILE id, not a job:/folder: id)')
    .option('--definition-id <id>', "Form-definition change id — fetch one definition's field/question structure")
    .option('--no-for-view', 'Definition fetch: request the non-view shape (default: the view-oriented shape)')
    .option('--fill-id <id>', 'Form-fill id — fetch one submission (mode=fills)')
    .option('--output-files', "With --fill-id, return the submission's output-file-list instead of its body")
    .option('--search', 'Use the server-side POST form-fills/search instead of a path-scoped list')
    .option('--user-id <id>', 'Filter fills (by-job / by-task) to one Synergy user; absent = all users')
    .option('--page <n>', 'First page for the fills walk (default 1)', (v) => parseInt(v, 10))
    .option('--page-size <n>', 'Page size for the fills walk / search (default 50)', (v) => parseInt(v, 10))
    .option('--limit <n>', 'Client-side cap on total fills returned across the walk (default 100)', (v) =>
      parseInt(v, 10)
    )
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          mode?: string;
          jobId?: string;
          taskId?: string;
          taskTypeId?: string;
          fileId?: string;
          definitionId?: string;
          forView?: boolean;
          fillId?: string;
          outputFiles?: boolean;
          search?: boolean;
          userId?: string;
          page?: number;
          pageSize?: number;
          limit?: number;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const mode = parseWebformsMode(options.mode);
        const params: ParamsForTool<'connect_synergy_webforms'> = {
          ...(mode ? { mode } : {}),
          ...(options.jobId ? { job_id: options.jobId } : {}),
          ...(options.taskId ? { task_id: options.taskId } : {}),
          ...(options.taskTypeId ? { task_type_id: options.taskTypeId } : {}),
          ...(options.fileId ? { file_id: options.fileId } : {}),
          ...(options.definitionId ? { definition_id: options.definitionId } : {}),
          // commander sets `forView: false` only when --no-for-view is passed (default true is the server default).
          ...(options.forView === false ? { for_view: false } : {}),
          ...(options.fillId ? { fill_id: options.fillId } : {}),
          ...(options.outputFiles ? { output_files: true } : {}),
          ...(options.search ? { search: true } : {}),
          ...(options.userId ? { user_id: options.userId } : {}),
          ...(options.page !== undefined ? { page: options.page } : {}),
          ...(options.pageSize !== undefined ? { page_size: options.pageSize } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_webforms',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-webforms', 'synergy', res));
        emitResult({ tool: 'connect_synergy_webforms', result: res.result, options, pretty: writeJson });
      }
    );
}

function createSynergyJobExtrasCommand(): Command {
  return new Command('synergy-job-extras')
    .description(
      'Synergy: heavier job/entity-scoped extras (read-only) — the job team and GLOBAL role definitions (section=team/roles), ' +
        'entity-type reports and report inputs (section=reports/report/report_inputs), federated-model clash ' +
        'detection (section=clashes/clash_items/clash_report), and lightweight job-header reads ' +
        '(section=dashboard/job-roles/categories/job-file-attributes). A required --section picks which extra to read.'
    )
    .requiredOption(
      '--section <section>',
      'Which extra to read: team | roles | reports | report | report_inputs | clashes | clash_items | clash_report | ' +
        'dashboard | job-roles | categories | job-file-attributes'
    )
    .option(
      '--job-id <id>',
      'Job IDString (required for section=team/dashboard/job-roles/categories/job-file-attributes; accepts job:/folder: prefix)'
    )
    .option('--entity-id <id>', 'Entity IDString to scope reports to one entity (section=reports)')
    .option(
      '--entity-type <type>',
      'Entity-type discriminator for entity-scoped reports (encoding [UNKNOWN]; passed verbatim)'
    )
    .option(
      '--report-type <type>',
      'Report type filter (section=reports): absent=catalog, alone=/reports/{type}, with --entity-id=/reports/{entity}/{type}'
    )
    .option('--report-id <id>', 'Report GUID (required for section=report and section=report_inputs)')
    .option(
      '--folder-id <id>',
      'Folder holding the federated model (required for section=clashes; accepts folder:/job: prefix)'
    )
    .option('--clash-id <id>', 'A clash-detection run id (required for section=clash_items and section=clash_report)')
    .option('--users-only', 'section=job-roles: only role assignments held by Synergy users (default: all)')
    .option(
      '--report-format <fmt>',
      "section=clash_report: the report format, e.g. 'csv' / 'pdf' / 'xlsx' (default csv)"
    )
    .option('--delimiter <char>', "section=clash_report: the delimiter for delimited formats (default ',')")
    .option('--limit <n>', 'Client-side cap for clash_items (default 200; truncated flagged)', (v) => parseInt(v, 10))
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          section: string;
          jobId?: string;
          entityId?: string;
          entityType?: string;
          reportType?: string;
          reportId?: string;
          folderId?: string;
          clashId?: string;
          usersOnly?: boolean;
          reportFormat?: string;
          delimiter?: string;
          limit?: number;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        // --section is a requiredOption, so options.section is always defined;
        // the parser fail()s on a bad value, so the non-null result is safe.
        const section = parseJobExtrasSection(options.section) as JobExtrasSection;
        const params: ParamsForTool<'connect_synergy_job_extras'> = {
          section,
          ...(options.jobId ? { job_id: options.jobId } : {}),
          ...(options.entityId ? { entity_id: options.entityId } : {}),
          ...(options.entityType ? { entity_type: options.entityType } : {}),
          ...(options.reportType ? { report_type: options.reportType } : {}),
          ...(options.reportId ? { report_id: options.reportId } : {}),
          ...(options.folderId ? { folder_id: options.folderId } : {}),
          ...(options.clashId ? { clash_id: options.clashId } : {}),
          ...(options.usersOnly ? { users_only: true } : {}),
          ...(options.reportFormat ? { report_format: options.reportFormat } : {}),
          ...(options.delimiter ? { delimiter: options.delimiter } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_job_extras',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-job-extras', 'synergy', res));
        emitResult({ tool: 'connect_synergy_job_extras', result: res.result, options, pretty: writeJson });
      }
    );
}

function createSynergyNotesCommand(): Command {
  return new Command('synergy-notes')
    .description(
      'Synergy: notes & associations on any entity (read-only) — what is attached to / linked from a job/file/folder/' +
        '12d-project. section=notes reads note headers + bodies (or just the count); section=associations reads the ' +
        'entities linked to a target (or just the count). Pass --scope to skip the entity-type enum where possible.'
    )
    .option('--section <section>', "What to read: 'notes' (default) | 'associations' (inferred from --expected-type)")
    .requiredOption(
      '--target-id <id>',
      'The entity the notes/associations hang off (accepts job:/folder:/file: prefix)'
    )
    .option(
      '--target-type <type>',
      'Entity-type enum (noteTargetTypes/entityTypes); required for the generic path, optional with --scope'
    )
    .option(
      '--scope <scope>',
      "Route via the scoped convenience path so you need no enum: 'job' | 'file' | 'folder' | 'project'"
    )
    .option('--note-id <id>', "section=notes: fetch this one note's message body")
    .option('--no-include-message', 'section=notes: headers only, do not hydrate each note body (cheaper)')
    .option(
      '--expected-type <type>',
      'section=associations: filter to a single associated-entity type (absent = all types)'
    )
    .option('--count-only', 'Return just the count (uses the cheap count endpoint), no rows')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          section?: string;
          targetId: string;
          targetType?: string;
          scope?: string;
          noteId?: string;
          includeMessage?: boolean;
          expectedType?: string;
          countOnly?: boolean;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const section = parseNotesSection(options.section);
        const scope = parseNotesScope(options.scope);
        const params: ParamsForTool<'connect_synergy_notes'> = {
          ...(section ? { section } : {}),
          target_id: options.targetId,
          ...(options.targetType ? { target_type: options.targetType } : {}),
          ...(scope ? { scope } : {}),
          ...(options.noteId ? { note_id: options.noteId } : {}),
          // commander sets `includeMessage: false` only when --no-include-message is passed (default true is the server default).
          ...(options.includeMessage === false ? { include_message: false } : {}),
          ...(options.expectedType ? { expected_type: options.expectedType } : {}),
          ...(options.countOnly ? { count_only: true } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_notes',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-notes', 'synergy', res));
        emitResult({ tool: 'connect_synergy_notes', result: res.result, options, pretty: writeJson });
      }
    );
}

function createSynergyStatusCommand(): Command {
  return new Command('synergy-status')
    .description(
      "Synergy: connection health & identity probe — 'is my Synergy connection healthy?' Combines instance " +
        'reachability (/health), the authenticated API version + server id, and PAT liveness + days-remaining into ' +
        'one verdict. Takes no inputs; it always probes the current connection.'
    )
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (options: StandardOptions) => {
      const account = requireSynergyScope();
      const params: ParamsForTool<'connect_synergy_status'> = {};
      const { accessToken, request } = await buildIntegrationsRequest({
        account,
        tool: 'connect_synergy_status',
        params,
        userMessage: options.userMessage,
      });
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(connectorFailure('synergy-status', 'synergy', res));
      emitResult({ tool: 'connect_synergy_status', result: res.result, options, pretty: writeJson });
    });
}

function createSynergyUsersCommand(): Command {
  return new Command('synergy-users')
    .description(
      'Synergy: users (read-only) — look up one user by id (resolve a task owner / issue assignee / checkout holder ' +
        "into a name/email), list the CALLER's active checkouts (locked files/folders) within a job, or check whether " +
        "the caller has access to a named license module. NOTE: checkouts are the caller's own only (PAT-scoped), not " +
        'an org-wide view.'
    )
    .option('--mode <mode>', "What to do: 'lookup' | 'checkouts' | 'module' (inferred from the ids you pass)")
    .option('--user-id <id>', 'User IDString (e.g. 8_1) for mode=lookup (a user id, NOT a job:/folder: id)')
    .option('--job-id <id>', 'Job IDString for mode=checkouts (accepts job:/folder: prefix)')
    .option('--module <name>', 'License module name for mode=module')
    .option('--no-retrieve-attributes', 'mode=lookup: skip the user attributes (default: include them)')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          mode?: string;
          userId?: string;
          jobId?: string;
          module?: string;
          retrieveAttributes?: boolean;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const mode = parseUsersMode(options.mode);
        const params: ParamsForTool<'connect_synergy_users'> = {
          ...(mode ? { mode } : {}),
          ...(options.userId ? { user_id: options.userId } : {}),
          ...(options.jobId ? { job_id: options.jobId } : {}),
          ...(options.module ? { module: options.module } : {}),
          // commander sets `retrieveAttributes: false` only when --no-retrieve-attributes is passed.
          ...(options.retrieveAttributes === false ? { retrieve_attributes: false } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_users',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-users', 'synergy', res));
        emitResult({ tool: 'connect_synergy_users', result: res.result, options, pretty: writeJson });
      }
    );
}

// Wave 3 NEW tool: connect_synergy_resolve — turn a pasted 12d link/path into an
// entity ref (+ a clickable web URL). These are admin-controller reads but are
// strictly non-mutating link/path lookups, so they stay on the read-only path.
function createSynergyResolveCommand(): Command {
  return new Command('synergy-resolve')
    .description(
      'Synergy: resolve a pasted 12d link or path into an entity (+ a clickable web URL). --mode link parses a ' +
        'synergy:// or web link into an entity ref (then best-effort fetches its web URL); --mode path finds the ' +
        'entity at a 12d path; --mode weblink turns an entity-id + entity-type into a web URL.'
    )
    .option(
      '--mode <mode>',
      "What to resolve: 'link' (--link) | 'path' (--path) | 'weblink' (--entity-id + --entity-type)"
    )
    .option('--link <link>', 'A synergy:// or web link to parse (mode=link)')
    .option('--path <path>', 'A 12d path to look up (mode=path; URL-encoded server-side)')
    .option(
      '--entity-id <id>',
      'Entity IDString for mode=weblink (also the parsed result feeds getWebLink in mode=link)'
    )
    .option('--entity-type <type>', 'Entity-type discriminator for mode=weblink (encoding [UNKNOWN]; passed verbatim)')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          mode?: string;
          link?: string;
          path?: string;
          entityId?: string;
          entityType?: string;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const mode = parseResolveMode(options.mode);
        const params: ParamsForTool<'connect_synergy_resolve'> = {
          ...(mode ? { mode } : {}),
          ...(options.link ? { link: options.link } : {}),
          ...(options.path ? { path: options.path } : {}),
          ...(options.entityId ? { entity_id: options.entityId } : {}),
          ...(options.entityType ? { entity_type: options.entityType } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_resolve',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-resolve', 'synergy', res));
        emitResult({ tool: 'connect_synergy_resolve', result: res.result, options, pretty: writeJson });
      }
    );
}

// Wave 3 fold-in: a dedicated synergy-file-info command for the new modes the
// shared `integrations file-info` cannot carry — permission/access reads, the
// version-N snapshot, and the by-name lookup (which has no file id at all, only
// a name + folder). mode=info keeps parity with the shared file-info default.
function createSynergyFileInfoCommand(): Command {
  return new Command('synergy-file-info')
    .description(
      "Synergy: a file's details and access (read-only). --mode info (default, with --file-id) reads its metadata; " +
        '--mode permission / --mode access read the caller permission / the users+groups who can see it; --mode by-name ' +
        '(--name + --folder-id) finds a file by name in a folder; --mode version (--file-id + --version) reads one version.'
    )
    .option('--mode <mode>', "What to read: 'info' (default) | 'permission' | 'access' | 'by-name' | 'version'")
    .option(
      '--file-id <id>',
      'File id (modes info/permission/access/version; must be a FILE id, not a job:/folder: id)'
    )
    .option('--name <name>', 'File name to look up (mode=by-name; URL-encoded server-side)')
    .option('--folder-id <id>', 'Folder to look in (mode=by-name; accepts folder:/job: prefix)')
    .option('--version <n>', 'Version number to read (mode=version)', (v) => parseInt(v, 10))
    .option('--no-retrieve-attributes', 'Omit custom attributes from by-name/version reads (default: include)')
    .option('--retrieve-flatten-parent-attributes', 'mode=by-name: also flatten parent-folder attributes (default off)')
    .option('-m, --user-message <text>', CAPTION_HELP)
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        options: {
          mode?: string;
          fileId?: string;
          name?: string;
          folderId?: string;
          version?: number;
          retrieveAttributes?: boolean;
          retrieveFlattenParentAttributes?: boolean;
        } & StandardOptions
      ) => {
        const account = requireSynergyScope();
        const mode = parseFileInfoMode(options.mode);
        const params: ParamsForTool<'connect_synergy_file_info'> = {
          ...(mode ? { mode } : {}),
          ...(options.fileId ? { file_id: options.fileId } : {}),
          ...(options.name ? { name: options.name } : {}),
          ...(options.folderId ? { folder_id: options.folderId } : {}),
          ...(options.version !== undefined ? { version: options.version } : {}),
          // --no-retrieve-attributes sets this false (Commander default true); only
          // send when explicitly disabled so the handler default (true) is preserved.
          ...(options.retrieveAttributes === false ? { retrieve_attributes: false } : {}),
          ...(options.retrieveFlattenParentAttributes ? { retrieve_flatten_parent_attributes: true } : {}),
        };
        const { accessToken, request } = await buildIntegrationsRequest({
          account,
          tool: 'connect_synergy_file_info',
          params,
          userMessage: options.userMessage,
        });
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(connectorFailure('synergy-file-info', 'synergy', res));
        emitResult({ tool: 'connect_synergy_file_info', result: res.result, options, pretty: writeJson });
      }
    );
}

/** Build the `numa integrations` command tree. */
export function createIntegrationsCommand(): Command {
  return new Command('integrations')
    .description('External integrations — list, browse, and call APIs across Pipedream + native methods')
    .addCommand(createIntegrationsListCommand())
    .addCommand(createIntegrationsDocsCommand())
    .addCommand(createIntegrationsSearchCommand())
    .addCommand(createIntegrationsPipedreamActionsCommand())
    .addCommand(createIntegrationsPipedreamPropsCommand())
    .addCommand(createIntegrationsPipedreamPropsOptionsCommand())
    .addCommand(createIntegrationsPipedreamCallCommand())
    .addCommand(createIntegrationsRequestCommand())
    .addCommand(createIntegrationsSoapCredentialsCommand())
    .addCommand(createIntegrationsListFilesCommand())
    .addCommand(createIntegrationsSearchFilesCommand())
    .addCommand(createIntegrationsDownloadFileCommand())
    .addCommand(createIntegrationsFileInfoCommand())
    .addCommand(createSynergyJobMetaCommand())
    .addCommand(createSynergyFolderSummaryCommand())
    .addCommand(createSynergySchemaCommand())
    .addCommand(createSynergyJobStatsCommand())
    .addCommand(createSynergyJobTreeCommand())
    .addCommand(createSynergyPortfolioCommand())
    .addCommand(createSynergyExactTermCommand())
    .addCommand(createSynergyTasksCommand())
    .addCommand(createSynergyContactsCommand())
    .addCommand(createSynergyIssuesCommand())
    .addCommand(createSynergyWorkflowCommand())
    .addCommand(createSynergyFileHistoryCommand())
    .addCommand(createSynergyRecentCommand())
    .addCommand(createSynergyForumsCommand())
    .addCommand(createSynergyProjectsCommand())
    .addCommand(createSynergyTransmittalsCommand())
    .addCommand(createSynergyCompaniesCommand())
    .addCommand(createSynergyWebformsCommand())
    .addCommand(createSynergyJobExtrasCommand())
    .addCommand(createSynergyNotesCommand())
    .addCommand(createSynergyStatusCommand())
    .addCommand(createSynergyUsersCommand())
    .addCommand(createSynergyResolveCommand())
    .addCommand(createSynergyFileInfoCommand());
}

// Unused-import guard for join (kept around for future workspace-direct
// reads if we add a `--read <topic>` shortcut).
void join;
