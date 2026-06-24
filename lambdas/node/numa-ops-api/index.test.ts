/**
 * Tests for the numa-ops-api comment routes — specifically TASK-181's
 * atomicity + IDOR hardening of comment create/delete and the
 * `ticket.commentCount` mutation.
 *
 * The AWS clients are built at module load. We mock `@aws-sdk/lib-dynamodb`
 * so `DynamoDBDocumentClient.from()` hands back a shared `send()` spy and the
 * command classes capture their input + a `__name` discriminator — no network,
 * no creds. `withPRM` is stubbed to a no-op client factory so we don't pull AWS
 * middleware. We then drive the real handler and assert on the DynamoDB calls
 * it makes.
 *
 * The invariants under test:
 *   - POST /comments writes the comment + bumps commentCount in a SINGLE
 *     TransactWriteCommand keyed on the STORED ticket's PK/SK (BUG-222), with a
 *     ConditionExpression that the ticket exists.
 *   - DELETE /comments deletes the comment + decrements commentCount in a SINGLE
 *     TransactWriteCommand, resolving the ticket's team from the STORED ticket
 *     rather than the client-supplied body.boardId (BUG-221/BUG-224, BUG-222).
 *     A forged boardId in the body must NOT influence the write key.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const sendMock = vi.fn();

type FakeCommand = { __name: string; input: unknown };
type FakeCommandCtor = new (input: unknown) => FakeCommand;

/** Fake command factory: instances carry their input + a __name discriminator. */
function mkCommand(name: string): FakeCommandCtor {
  return class {
    __name = name;
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  };
}

// DynamoDBDocumentClient.from() returns the shared send() spy regardless of the
// underlying client it's handed. All lib-dynamodb commands capture their input.
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: (): { send: typeof sendMock } => ({ send: sendMock }) },
  GetCommand: mkCommand('Get'),
  PutCommand: mkCommand('Put'),
  QueryCommand: mkCommand('Query'),
  DeleteCommand: mkCommand('Delete'),
  UpdateCommand: mkCommand('Update'),
  TransactWriteCommand: mkCommand('TransactWrite'),
}));

// Stub withPRM to a no-op client factory so client construction at module load
// doesn't drag in AWS middleware. The returned object is only ever passed to the
// mocked DynamoDBDocumentClient.from() (which ignores it) or left unused.
vi.mock('../../../lib/prm-node/prm', () => ({
  PRODUCT_CODE: 'test',
  PRM_UA: 'test',
  withPRM: (): { send: ReturnType<typeof vi.fn> } => ({ send: vi.fn() }),
}));

const TEAM_ID = 'real-team-aaa';
const TICKET_ID = 'ticket-bbb';
const FORGED_BOARD_ID = 'attacker-board-zzz';

const STORED_TICKET = {
  PK: `TEAM#${TEAM_ID}`,
  SK: `TICKET#${TICKET_ID}`,
  entityType: 'TICKET',
  id: TICKET_ID,
  teamId: TEAM_ID,
  title: 'A ticket',
  commentCount: 3,
};

const TEAM_META = {
  PK: `TEAM#${TEAM_ID}`,
  SK: 'META',
  id: TEAM_ID,
  accessControl: { mode: 'all' },
};

/**
 * Route the shared send() spy by command type, inspecting Query inputs to serve
 * the right slice of the single-table layout the handler walks:
 *   - GSI1 Query for TENANT/TEAM# → the list of teams (findTicketByUuid fan-out)
 *   - Get TEAM#{id}/TICKET#{id}   → the stored ticket
 *   - Query TEAM#{id}/META        → team meta (access check)
 *   - Query TICKET#{id}/COMMENT#  → existing comments (delete path)
 *   - Get CONFIG/STAFF#{sub}      → author-name lookup (returns nothing)
 */
function defaultRoute(cmd: FakeCommand): unknown {
  const input = (cmd.input ?? {}) as Record<string, unknown>;
  const values = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
  const key = (input.Key ?? {}) as Record<string, unknown>;

  if (cmd.__name === 'Query') {
    if (input.IndexName === 'GSI1' && values[':pk'] === 'TENANT') {
      return { Items: [{ id: TEAM_ID }] };
    }
    if (values[':pk'] === `TEAM#${TEAM_ID}` && values[':sk'] === 'META') {
      return { Items: [TEAM_META] };
    }
    if (values[':pk'] === `TICKET#${TICKET_ID}` && values[':sk'] === 'COMMENT#') {
      return {
        Items: [
          {
            PK: `TICKET#${TICKET_ID}`,
            SK: 'COMMENT#2020-01-01T00:00:00.000Z#comment-ccc',
            commentId: 'comment-ccc',
            content: 'hi',
          },
        ],
      };
    }
    return { Items: [] };
  }

  if (cmd.__name === 'Get') {
    if (key.PK === `TEAM#${TEAM_ID}` && key.SK === `TICKET#${TICKET_ID}`) {
      return { Item: STORED_TICKET };
    }
    return {}; // STAFF# author lookup etc.
  }

  return {}; // Put / Delete / Update / TransactWrite
}

type Handler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;
let handler: Handler;

beforeAll(async () => {
  process.env.OPS_TABLE = 'ops-table';
  process.env.OPS_CONFIG_TABLE = 'ops-config-table';
  process.env.OPS_CRM_TABLE = 'ops-crm-table';
  process.env.OUTPUTS_BUCKET_NAME = 'outputs-bucket';
  process.env.CLIENT_NAME = 'testclient';
  delete process.env.EMAIL_SENDER_LAMBDA_ARN; // skip the mention fan-out
  ({ handler } = (await import('./index')) as unknown as { handler: Handler });
});

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockImplementation((cmd: FakeCommand) => Promise.resolve(defaultRoute(cmd)));
});

/** Unsigned JWT — resolveAuthContext only base64-decodes the payload. */
function jwt(payload: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(payload)).toString('base64')}.s`;
}

const AUTH = `Bearer ${jwt({ sub: 'sub-1', email: 'u@x.nz', 'cognito:groups': [] })}`;

function event(method: string, path: string, body?: unknown): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    requestContext: { http: { method, path } },
    headers: { authorization: AUTH },
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2;
}

/** Collect every captured command the handler sent, in order. */
function sentCommands(): FakeCommand[] {
  return sendMock.mock.calls.map((c) => c[0] as FakeCommand);
}

function transactWrites(): FakeCommand[] {
  return sentCommands().filter((c) => c.__name === 'TransactWrite');
}

describe('POST /ops/tickets/{id}/comments — atomic create + count bump', () => {
  it('writes the comment and increments commentCount in a single conditional transaction', async () => {
    const res = await handler(event('POST', `/api/ops/tickets/${TICKET_ID}/comments`, { content: 'hello world' }));
    expect(res.statusCode).toBe(201);

    // Exactly one TransactWriteCommand carries both the Put and the Update.
    const txns = transactWrites();
    expect(txns).toHaveLength(1);
    const items = (txns[0].input as { TransactItems: Record<string, Record<string, unknown>>[] }).TransactItems;
    expect(items).toHaveLength(2);

    const put = items.find((i) => i.Put)?.Put as Record<string, unknown>;
    const put_item = put.Item as Record<string, unknown>;
    expect(put_item.entityType).toBe('COMMENT');
    expect(put_item.PK).toBe(`TICKET#${TICKET_ID}`);

    const upd = items.find((i) => i.Update)?.Update as Record<string, unknown>;
    // Keyed on the STORED ticket PK/SK, guarded by attribute_exists(PK).
    expect(upd.Key).toEqual({ PK: `TEAM#${TEAM_ID}`, SK: `TICKET#${TICKET_ID}` });
    expect(upd.UpdateExpression).toBe('ADD commentCount :inc');
    expect(upd.ConditionExpression).toBe('attribute_exists(PK)');
    expect((upd.ExpressionAttributeValues as Record<string, unknown>)[':inc']).toBe(1);

    // The standalone (non-transactional) commentCount UpdateCommand is gone —
    // the only remaining Update is the board heartbeat on TEAM META.
    const standaloneCountBumps = sentCommands().filter(
      (c) =>
        c.__name === 'Update' && (c.input as { UpdateExpression?: string }).UpdateExpression?.includes('commentCount')
    );
    expect(standaloneCountBumps).toHaveLength(0);
  });
});

describe('DELETE /ops/tickets/{id}/comments/{cid} — atomic delete + count drop, boardId ignored', () => {
  it('decrements commentCount keyed on the STORED ticket, not the forged body.boardId', async () => {
    const res = await handler(
      event('DELETE', `/api/ops/tickets/${TICKET_ID}/comments/comment-ccc`, {
        boardId: FORGED_BOARD_ID,
      })
    );
    expect(res.statusCode).toBe(200);

    const txns = transactWrites();
    expect(txns).toHaveLength(1);
    const items = (txns[0].input as { TransactItems: Record<string, Record<string, unknown>>[] }).TransactItems;
    expect(items).toHaveLength(2);

    const del = items.find((i) => i.Delete)?.Delete as Record<string, unknown>;
    expect((del.Key as Record<string, unknown>).PK).toBe(`TICKET#${TICKET_ID}`);

    const upd = items.find((i) => i.Update)?.Update as Record<string, unknown>;
    // The decrement targets the real team from the stored ticket...
    expect(upd.Key).toEqual({ PK: `TEAM#${TEAM_ID}`, SK: `TICKET#${TICKET_ID}` });
    expect(upd.UpdateExpression).toBe('ADD commentCount :dec');
    expect(upd.ConditionExpression).toBe('attribute_exists(PK)');
    expect((upd.ExpressionAttributeValues as Record<string, unknown>)[':dec']).toBe(-1);

    // ...and the attacker-supplied boardId never appears in ANY command key.
    const forgedKeyUsed = sentCommands().some((c) => {
      const i = c.input as { Key?: Record<string, unknown> };
      return i.Key?.PK === `TEAM#${FORGED_BOARD_ID}`;
    });
    expect(forgedKeyUsed).toBe(false);
  });

  it('404s when the comment does not exist (no transaction issued)', async () => {
    const res = await handler(event('DELETE', `/api/ops/tickets/${TICKET_ID}/comments/does-not-exist`, {}));
    expect(res.statusCode).toBe(404);
    expect(transactWrites()).toHaveLength(0);
  });
});

describe('POST /ops/tickets — typeless create uses board default type + prefix (BUG-366/367)', () => {
  const STAGE = { PK: `TEAM#${TEAM_ID}`, SK: 'STAGE#stage-1', statusType: 'todo' };

  it('resolves null ticketTypeId to the board default and mints the type prefix (SAL), not the TKT ghost', async () => {
    const BOARD = {
      PK: `TEAM#${TEAM_ID}`,
      SK: 'META',
      id: TEAM_ID,
      accessControl: { mode: 'all' },
      ticketTypeId: 'tt-sal',
      allowedTicketTypes: ['tt-sal'],
    };
    sendMock.mockImplementation((cmd: FakeCommand) => {
      const input = (cmd.input ?? {}) as Record<string, unknown>;
      const values = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
      const key = (input.Key ?? {}) as Record<string, unknown>;
      if (cmd.__name === 'Query' && values[':pk'] === `TEAM#${TEAM_ID}` && values[':sk'] === 'META')
        return Promise.resolve({ Items: [BOARD] });
      if (cmd.__name === 'Get' && key.PK === `TEAM#${TEAM_ID}` && key.SK === 'STAGE#stage-1')
        return Promise.resolve({ Item: STAGE });
      if (cmd.__name === 'Get' && key.PK === 'CONFIG' && key.SK === 'TICKET_TYPE#tt-sal')
        return Promise.resolve({ Item: { prefix: 'SAL' } });
      if (cmd.__name === 'Update' && key.PK === 'PREFIX' && key.SK === 'SAL')
        return Promise.resolve({ Attributes: { nextSequence: 435 } });
      return Promise.resolve({ Items: [] });
    });
    const res = await handler(
      event('POST', '/api/ops/tickets', { boardId: TEAM_ID, stageId: 'stage-1', title: 'Inbound enquiry' })
    );
    expect(res.statusCode).toBe(201);
    const items = (transactWrites()[0].input as { TransactItems: { Put?: { Item: Record<string, unknown> } }[] })
      .TransactItems;
    const ticketItem = items.map((i) => i.Put?.Item).find((it) => it?.entityType === 'TICKET');
    expect(ticketItem?.ticketTypeId).toBe('tt-sal');
    expect(String(ticketItem?.displayId)).toMatch(/^SAL-/);
  });

  it('still falls back to TKT when the board has no ticket type at all', async () => {
    const BOARD = { PK: `TEAM#${TEAM_ID}`, SK: 'META', id: TEAM_ID, accessControl: { mode: 'all' } };
    sendMock.mockImplementation((cmd: FakeCommand) => {
      const input = (cmd.input ?? {}) as Record<string, unknown>;
      const values = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
      const key = (input.Key ?? {}) as Record<string, unknown>;
      if (cmd.__name === 'Query' && values[':pk'] === `TEAM#${TEAM_ID}` && values[':sk'] === 'META')
        return Promise.resolve({ Items: [BOARD] });
      if (cmd.__name === 'Get' && key.PK === `TEAM#${TEAM_ID}` && key.SK === 'STAGE#stage-1')
        return Promise.resolve({ Item: STAGE });
      if (cmd.__name === 'Update' && key.PK === 'PREFIX' && key.SK === 'TKT')
        return Promise.resolve({ Attributes: { nextSequence: 693 } });
      return Promise.resolve({ Items: [] });
    });
    const res = await handler(
      event('POST', '/api/ops/tickets', { boardId: TEAM_ID, stageId: 'stage-1', title: 'No-type board ticket' })
    );
    expect(res.statusCode).toBe(201);
    const items = (transactWrites()[0].input as { TransactItems: { Put?: { Item: Record<string, unknown> } }[] })
      .TransactItems;
    const ticketItem = items.map((i) => i.Put?.Item).find((it) => it?.entityType === 'TICKET');
    expect(ticketItem?.ticketTypeId).toBeUndefined();
    expect(String(ticketItem?.displayId)).toMatch(/^TKT-/);
  });

  it('uses the request-supplied ticketTypeId (and its prefix) over the board default', async () => {
    const BOARD = {
      PK: `TEAM#${TEAM_ID}`,
      SK: 'META',
      id: TEAM_ID,
      accessControl: { mode: 'all' },
      ticketTypeId: 'tt-sal',
      allowedTicketTypes: ['tt-sal', 'tt-bug'],
    };
    sendMock.mockImplementation((cmd: FakeCommand) => {
      const input = (cmd.input ?? {}) as Record<string, unknown>;
      const values = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
      const key = (input.Key ?? {}) as Record<string, unknown>;
      if (cmd.__name === 'Query' && values[':pk'] === `TEAM#${TEAM_ID}` && values[':sk'] === 'META')
        return Promise.resolve({ Items: [BOARD] });
      if (cmd.__name === 'Get' && key.PK === `TEAM#${TEAM_ID}` && key.SK === 'STAGE#stage-1')
        return Promise.resolve({ Item: STAGE });
      if (cmd.__name === 'Get' && key.PK === 'CONFIG' && key.SK === 'TICKET_TYPE#tt-bug')
        return Promise.resolve({ Item: { prefix: 'BUG' } });
      if (cmd.__name === 'Update' && key.PK === 'PREFIX' && key.SK === 'BUG')
        return Promise.resolve({ Attributes: { nextSequence: 12 } });
      return Promise.resolve({ Items: [] });
    });
    const res = await handler(
      event('POST', '/api/ops/tickets', {
        boardId: TEAM_ID,
        stageId: 'stage-1',
        title: 'Explicit type',
        ticketTypeId: 'tt-bug',
      })
    );
    expect(res.statusCode).toBe(201);
    const items = (transactWrites()[0].input as { TransactItems: { Put?: { Item: Record<string, unknown> } }[] })
      .TransactItems;
    const ticketItem = items.map((i) => i.Put?.Item).find((it) => it?.entityType === 'TICKET');
    expect(ticketItem?.ticketTypeId).toBe('tt-bug');
    expect(String(ticketItem?.displayId)).toMatch(/^BUG-/);
  });
});
