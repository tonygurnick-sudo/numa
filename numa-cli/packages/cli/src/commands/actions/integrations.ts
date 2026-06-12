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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { getValidTokens } from '../../auth/tokens.js';
import { activeProfile } from '../../context/store.js';
import { resolveScopingContext, type EnabledIntegration, type ScopingContext } from '../../context/resolve.js';
import { invokeTool, type ToolInvokeRequest } from '../../api/tools.js';
import { fetchIntegrationDocs } from '../../api/integrations-docs.js';
import { tryWorkspaceDocs, writeCachedDocs, type ResolvedDocs } from '../../context/integrations-cache.js';
import type { ParamsForTool, PipedreamActionIndexEntry, ToolName } from '../../metadata/tool-types.js';
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
    .addCommand(createIntegrationsRequestCommand());
}

// Unused-import guard for join (kept around for future workspace-direct
// reads if we add a `--read <topic>` shortcut).
void join;
