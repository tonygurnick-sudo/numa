/**
 * Orchestration for `numa ops upload_attachment`
 * (commands/actions/_ops-attachment.ts — the read → presign → PUT → register
 * flow that BUG-389 added so the model can attach workspace files without
 * touching a presigned URL or curl).
 *
 * The flow is exercised with a fake `invoke` (no Lambda) and a stubbed global
 * `fetch` (no network) — so we assert the SEQUENCE and the exact params each
 * step gets, which is the whole correctness story: gate once on presign, never
 * PUT after a deny, register with the right attachment record.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { runUploadAttachment } = await import('../dist/commands/actions/_ops-attachment.js');

/** Fake ops invoker: records every call, returns scripted responses per op. */
function makeInvoke(responses) {
  const calls = [];
  const invoke = async (op, params, gate) => {
    calls.push({ op, params, gate });
    const r = responses[op];
    return typeof r === 'function' ? r(params, gate) : (r ?? { status: 'success', result: {} });
  };
  return { invoke, calls };
}

/** Stub global fetch, capturing PUT calls; returns a restore fn. */
function stubFetch(impl) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return impl ? impl(url, opts) : { ok: true, status: 200, statusText: 'OK' };
  };
  return { calls, restore: () => (globalThis.fetch = orig) };
}

/** Write a temp file with given name + bytes; returns its absolute path + a cleanup. */
async function tempFile(name, bytes) {
  const dir = await mkdtemp(join(tmpdir(), 'numa-attach-'));
  const path = join(dir, name);
  await writeFile(path, bytes);
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const PRESIGN_OK = {
  status: 'success',
  result: { uploadUrl: 'https://signed.example/put?sig=x', s3Key: 'ops/tickets/T1/attachments/F1/shot.png', fileId: 'F1' },
};

test('happy path: presign → PUT → register, params threaded correctly', async () => {
  delete process.env.NUMA_CONVERSATION_ID; // laptop mode — temp file lives outside /workdir
  const { path, cleanup } = await tempFile('shot.png', Buffer.from('PNGDATA'));
  const fetchStub = stubFetch();
  try {
    const { invoke, calls } = makeInvoke({
      upload_attachment: PRESIGN_OK,
      add_comment: { status: 'success', result: { commentId: 'c1' } },
    });

    const res = await runUploadAttachment({
      invoke,
      opParams: { workspaceFilePath: path, displayId: 'BUG-389' },
      gate: { autoApproved: false, requestId: 'req-1' },
    });

    // Two ops calls, in order.
    assert.equal(calls.length, 2);
    assert.equal(calls[0].op, 'upload_attachment');
    assert.equal(calls[1].op, 'add_comment');

    // Presign got the gate (the one approval) + inferred type + ticket ref.
    assert.equal(calls[0].params.fileName, 'shot.png');
    assert.equal(calls[0].params.contentType, 'image/png'); // inferred from .png
    assert.equal(calls[0].params.displayId, 'BUG-389');
    assert.equal(calls[0].gate.autoApproved, false);
    assert.equal(calls[0].gate.requestId, 'req-1');

    // The bytes were PUT to the signed URL with the matching Content-Type.
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(fetchStub.calls[0].url, PRESIGN_OK.result.uploadUrl);
    assert.equal(fetchStub.calls[0].opts.method, 'PUT');
    assert.equal(fetchStub.calls[0].opts.headers['Content-Type'], 'image/png');
    assert.deepEqual(fetchStub.calls[0].opts.body, Buffer.from('PNGDATA'));

    // The follow-on comment is auto-approved and carries the attachment record.
    assert.equal(calls[1].gate.autoApproved, true);
    assert.equal(calls[1].params.displayId, 'BUG-389');
    assert.deepEqual(calls[1].params.attachments, [
      { name: 'shot.png', s3Key: PRESIGN_OK.result.s3Key, size: 7, mimeType: 'image/png' },
    ]);

    // Result summary.
    assert.equal(res.status, 'success');
    assert.equal(res.s3Key, PRESIGN_OK.result.s3Key);
    assert.equal(res.size, 7);
    assert.equal(res.ticket, 'BUG-389');
  } finally {
    fetchStub.restore();
    await cleanup();
  }
});

test('denied approval at presign: never PUTs, never registers', async () => {
  delete process.env.NUMA_CONVERSATION_ID;
  const { path, cleanup } = await tempFile('doc.pdf', Buffer.from('PDF'));
  const fetchStub = stubFetch();
  try {
    const { invoke, calls } = makeInvoke({
      // invokeTool normalises a denied/timed-out approval to status:'error'.
      upload_attachment: { status: 'error', error: 'The user denied this action.' },
    });

    await assert.rejects(
      runUploadAttachment({
        invoke,
        opParams: { workspaceFilePath: path, displayId: 'BUG-1' },
        gate: { autoApproved: false, requestId: 'req-2' },
      }),
      /denied/
    );

    assert.equal(calls.length, 1); // only the presign attempt
    assert.equal(calls[0].op, 'upload_attachment');
    assert.equal(fetchStub.calls.length, 0); // bytes never moved
  } finally {
    fetchStub.restore();
    await cleanup();
  }
});

test('explicit contentType wins over inference', async () => {
  delete process.env.NUMA_CONVERSATION_ID;
  const { path, cleanup } = await tempFile('data.bin', Buffer.from('x'));
  const fetchStub = stubFetch();
  try {
    const { invoke, calls } = makeInvoke({ upload_attachment: PRESIGN_OK, add_comment: { status: 'success' } });
    await runUploadAttachment({
      invoke,
      opParams: { workspaceFilePath: path, ticketId: 'uuid-1', contentType: 'application/json', fileName: 'data.json' },
      gate: { autoApproved: true },
    });
    assert.equal(calls[0].params.contentType, 'application/json');
    assert.equal(calls[0].params.ticketId, 'uuid-1');
    assert.equal(fetchStub.calls[0].opts.headers['Content-Type'], 'application/json');
  } finally {
    fetchStub.restore();
    await cleanup();
  }
});

test('registration failure after a successful PUT surfaces the s3Key', async () => {
  delete process.env.NUMA_CONVERSATION_ID;
  const { path, cleanup } = await tempFile('shot.png', Buffer.from('PNGDATA'));
  const fetchStub = stubFetch();
  try {
    const { invoke } = makeInvoke({
      upload_attachment: PRESIGN_OK,
      add_comment: { status: 'error', error: 'ticket not found' },
    });
    await assert.rejects(
      runUploadAttachment({
        invoke,
        opParams: { workspaceFilePath: path, displayId: 'BUG-389' },
        gate: { autoApproved: true },
      }),
      (err) => {
        assert.match(err.message, /uploaded to S3/);
        assert.match(err.message, /ops\/tickets\/T1\/attachments\/F1\/shot\.png/);
        return true;
      }
    );
    assert.equal(fetchStub.calls.length, 1); // the PUT did happen
  } finally {
    fetchStub.restore();
    await cleanup();
  }
});

test('missing workspaceFilePath throws before any call', async () => {
  delete process.env.NUMA_CONVERSATION_ID;
  const { invoke, calls } = makeInvoke({});
  await assert.rejects(
    runUploadAttachment({ invoke, opParams: { displayId: 'BUG-1' }, gate: { autoApproved: true } }),
    /workspaceFilePath/
  );
  assert.equal(calls.length, 0);
});

test('missing ticket reference throws', async () => {
  delete process.env.NUMA_CONVERSATION_ID;
  const { path, cleanup } = await tempFile('shot.png', Buffer.from('x'));
  try {
    const { invoke } = makeInvoke({});
    await assert.rejects(
      runUploadAttachment({ invoke, opParams: { workspaceFilePath: path }, gate: { autoApproved: true } }),
      /displayId|ticketId/
    );
  } finally {
    await cleanup();
  }
});

test('in-workspace, a path outside /workdir is refused', async () => {
  process.env.NUMA_CONVERSATION_ID = 'conv-test';
  try {
    const { invoke, calls } = makeInvoke({});
    await assert.rejects(
      runUploadAttachment({
        invoke,
        opParams: { workspaceFilePath: '/etc/passwd', displayId: 'BUG-1' },
        gate: { autoApproved: false, requestId: 'r' },
      }),
      /outside the workspace/
    );
    assert.equal(calls.length, 0);
  } finally {
    delete process.env.NUMA_CONVERSATION_ID;
  }
});
