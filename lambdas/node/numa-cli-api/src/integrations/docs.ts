/**
 * `GET /api/cli/integrations/{slug}/docs?method=pipedream|native`
 *
 * Returns the reference documentation the LLM uses to call this
 * integration. Two shapes depending on method:
 *
 *   pipedream: { method: "pipedream", index: PipedreamActionIndexEntry[] }
 *      Calls `pipedream_list_actions` server-side and returns the
 *      compact index (same `_index.json` shape stored at
 *      `/workdir/tools/integrations/{slug}/`).
 *
 *   native:    { method: "native", files: { name, content }[] }
 *      Lists `tools/api-docs/{slug}/` in the tenant's outputs bucket
 *      (same path the workspace agent's `sync_ext_api_docs_for_connectors`
 *      pulls from at chat start) and returns every markdown file's
 *      content inline. Typical bundle is 5-20 KB, all 7 reference files.
 *
 * The CLI caches the response at `~/.cache/numa/integrations/{slug}/`
 * after first fetch (in-workspace, the CLI prefers local `/workdir/...`
 * directly and skips this endpoint).
 *
 * Auth: same authorizer as the rest of numa-cli-api. The user must have
 * the integration enabled tenant-wide (we don't check per-conversation
 * here; that's runtime gating).
 */

import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { InvokeCommand } from '@aws-sdk/client-lambda';

import { lambdaClient, s3 as s3Client } from '../shared/aws.js';
import { CLIENT_NAME } from '../shared/config.js';
import { errorResponse, jsonResponse, type HttpResponse } from '../shared/response.js';
import type { AuthContext } from '../shared/auth.js';

/** Per-action summary; mirrors `_index.json` shape on disk. */
interface ActionIndexEntry {
  key: string;
  name: string;
  description?: string;
  annotations?: Record<string, unknown>;
  prop_count?: number;
  file?: string;
}

/** S3 path the workspace agent's sync_ext_api_docs_for_connectors reads from. */
const NATIVE_DOCS_S3_PREFIX = 'tools/api-docs';

/** Tenant outputs bucket — same one used for workspace S3 and KB files. */
const OUTPUTS_BUCKET = `numa-${CLIENT_NAME}-outputs`;

const fetchPipedreamIndex = async (slug: string, userSub: string): Promise<ActionIndexEntry[]> => {
  const event = {
    tool: 'pipedream_list_actions',
    // We're the trusted caller — bypass the per-tool allowlist that the
    // dispatcher enforces for chat-driven calls by setting `allowed_tools`
    // to include the slug. Mirrors how `_sync_integration_schemas` in
    // main.py does it at workspace startup.
    allowed_tools: [slug],
    params: {
      app_slug: slug,
      external_user_id: `${CLIENT_NAME}_${userSub}`,
    },
  };

  const res = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: `${CLIENT_NAME}_workspace_chat_tools`,
      Payload: Buffer.from(JSON.stringify(event)),
      InvocationType: 'RequestResponse',
    })
  );

  if (res.FunctionError) {
    const payload = res.Payload ? Buffer.from(res.Payload).toString('utf-8') : '<empty>';
    throw new Error(`pipedream_list_actions ${slug}: ${res.FunctionError} — ${payload.slice(0, 300)}`);
  }
  if (!res.Payload) throw new Error(`pipedream_list_actions ${slug}: empty payload`);

  const raw = JSON.parse(Buffer.from(res.Payload).toString('utf-8')) as {
    status?: string;
    result?: { actions?: ActionIndexEntry[]; index?: ActionIndexEntry[] };
    error?: string;
  };
  if (raw.status !== 'success') throw new Error(raw.error ?? `pipedream_list_actions ${slug} failed`);

  // `pipedream_list_actions` may return either {actions: [...]} or
  // pre-built {index: [...]} depending on the implementation. Prefer the
  // index when present; otherwise derive from the full action list.
  const index = raw.result?.index;
  if (Array.isArray(index)) return index;
  const actions = raw.result?.actions ?? [];
  return actions.map((a) => ({
    key: a.key,
    name: a.name ?? a.key,
    description: (a.description ?? '').slice(0, 200),
    annotations: a.annotations,
    prop_count: a.prop_count,
    file: `${a.key.replace(/\//g, '_')}.json`,
  }));
};

interface NativeDocFile {
  name: string;
  content: string;
}

const fetchNativeDocs = async (slug: string): Promise<NativeDocFile[]> => {
  const prefix = `${NATIVE_DOCS_S3_PREFIX}/${slug}/`;
  const list = await s3Client.send(new ListObjectsV2Command({ Bucket: OUTPUTS_BUCKET, Prefix: prefix, MaxKeys: 50 }));
  const keys = (list.Contents ?? [])
    .map((o) => o.Key)
    .filter((k): k is string => typeof k === 'string' && k.endsWith('.md'));

  if (keys.length === 0) return [];

  const files = await Promise.all(
    keys.map(async (key) => {
      const obj = await s3Client.send(new GetObjectCommand({ Bucket: OUTPUTS_BUCKET, Key: key }));
      const content = (await obj.Body?.transformToString?.()) ?? '';
      const name = key.slice(prefix.length);
      return { name, content };
    })
  );

  // Sort by filename so the numbered prefixes (01-..., 01a-..., 02-...)
  // land in reading order.
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
};

export const handleIntegrationDocs = async (
  auth: AuthContext,
  slug: string,
  method: 'pipedream' | 'native'
): Promise<HttpResponse> => {
  if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) {
    return errorResponse(400, `Invalid slug '${slug}' — expected slug-shaped string`);
  }

  try {
    if (method === 'pipedream') {
      const index = await fetchPipedreamIndex(slug, auth.sub);
      return jsonResponse(200, {
        status: 'success',
        result: { method: 'pipedream', slug, index },
      });
    }
    const files = await fetchNativeDocs(slug);
    return jsonResponse(200, {
      status: 'success',
      result: { method: 'native', slug, files },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(500, `integration docs failed: ${message}`);
  }
};
