import { listClients, getClientConfig, putClientConfig } from '../index';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import fs from 'node:fs';

import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { z, ZodError } from 'zod';

const ddbMock = mockClient(DynamoDBDocumentClient);
const clientConfigSchema = z.object({
  region: z.string(),
});
type ClientConfig = z.infer<typeof clientConfigSchema>;

describe('listClients', () => {
  beforeEach(() => {
    ddbMock.on(ScanCommand).resolves({
      Items: [],
    });
    mock.method(fs, 'readFileSync', () => {
      return JSON.stringify({});
    });
  });
  afterEach(() => {
    ddbMock.reset();
    mock.reset();
  });
  it('should return a list of clients', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [{ clientName: 'def' }, { clientName: 'abc' }],
    });
    const clients = await listClients();
    assert.deepStrictEqual(clients.sort(), ['abc', 'def']);
  });
  it('should include list from json file', async () => {
    mock.method(fs, 'readFileSync', () => {
      return JSON.stringify({ abc: {}, def: {} });
    });
    const client = await listClients();
    assert.deepStrictEqual(client.sort(), ['abc', 'def']);
  });
  it('should read clients from the correct json file', async () => {
    const readMock = mock.method(fs, 'readFileSync', () => {
      return JSON.stringify({});
    });
    const expectedPath = path.join(import.meta.dirname, '..', '..', '..', 'clientConfigProd.json');
    await listClients();
    const call = readMock.mock.calls[0];
    assert.strictEqual(call.arguments[0], expectedPath);
  });
  it('should return an empty list when json file not found and Dynamo empty', async () => {
    mock.method(fs, 'readFileSync', () => {
      throw new Error('File not found');
    });
    const warnMock = mock.method(console, 'warn', () => {});
    const clients = await listClients();
    assert.strictEqual(warnMock.mock.callCount(), 1);
    assert.deepStrictEqual(clients, []);
  });
  it('should return an empty list when no clients', async () => {
    const clients = await listClients();
    assert.deepStrictEqual(clients, []);
  });
  it('should return an empty list when items not returned', async () => {
    ddbMock.on(ScanCommand).resolves({});
    const clients = await listClients();
    assert.deepStrictEqual(clients, []);
  });
  it('dedupes clients from Dynamo and json file', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [{ clientName: 'def' }, { clientName: 'abc' }],
    });
    mock.method(fs, 'readFileSync', () => {
      return JSON.stringify({ abc: {}, def: {} });
    });
    const clients = await listClients();
    assert.deepStrictEqual(clients.sort(), ['abc', 'def']);
  });
});

describe('getClientConfig', () => {
  beforeEach(() => {
    ddbMock.on(GetCommand).resolves({});
  });
  afterEach(() => {
    ddbMock.reset();
    mock.reset();
  });
  it('should return a client config', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { clientName: 'def', config: { region: 'us-east-1' } },
    });
    const config = await getClientConfig('def', clientConfigSchema);
    assert.deepStrictEqual(config, { region: 'us-east-1' });
  });
  it('should throw an error when client not found', async () => {
    ddbMock.on(GetCommand).resolves({});
    await assert.rejects(async () => {
      await getClientConfig('def', clientConfigSchema);
    }, /Client config not found for client: def/);
  });
  it('should return a client config from json', async () => {
    mock.method(fs, 'readFileSync', () => {
      return JSON.stringify({ def: { region: 'us-east-1' } });
    });
    const config = await getClientConfig('def', clientConfigSchema);
    assert.deepStrictEqual(config, { region: 'us-east-1' });
  });
  it('should prefer config from json over Dynamo', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { clientName: 'def', config: { region: 'us-east-1' } },
    });
    mock.method(fs, 'readFileSync', () => {
      return JSON.stringify({ def: { region: 'us-west-2' } });
    });
    const config = await getClientConfig<ClientConfig>('def', clientConfigSchema);
    assert.deepStrictEqual(config, { region: 'us-west-2' });
  });
  it('should validate the config type', async () => {
    mock.method(fs, 'readFileSync', () => {
      return JSON.stringify({ def: {} });
    });
    ddbMock.on(GetCommand).resolves({
      Item: { clientName: 'abc', config: {} },
    });
    await assert.rejects(async () => {
      await getClientConfig<ClientConfig>('def', clientConfigSchema);
    }, ZodError);
    await assert.rejects(async () => {
      await getClientConfig('abc', clientConfigSchema);
    }, ZodError);
  });
  // TODO: Remove this test when the schema is implemented
  it('should not throw an error when no schema is provided', async () => {
    mock.method(fs, 'readFileSync', () => {
      return JSON.stringify({ def: { turbo: 'us-east-1' } });
    });
    const config = await getClientConfig('def');
    assert.deepStrictEqual(config, { turbo: 'us-east-1' });
  });
});

describe('putClientConfig', () => {
  beforeEach(() => {
    ddbMock.on(PutCommand).resolves({
      $metadata: {
        httpStatusCode: 200,
      },
    });
  });
  afterEach(() => {
    ddbMock.reset();
    mock.reset();
  });
  it('should put a client config', async () => {
    const config = { region: 'us-east-1' };
    const result = await putClientConfig('def', config, clientConfigSchema);
    assert.strictEqual(result, true);
    assert.strictEqual(ddbMock.commandCalls(PutCommand).length, 1);
    const call = ddbMock.commandCalls(PutCommand)[0];
    assert.deepStrictEqual(call.args[0].input.Item, { clientName: 'def', config });
  });
  it('should throw an error when config is invalid', async () => {
    const config = { region: 123 };
    await assert.rejects(async () => {
      await putClientConfig('def', config, clientConfigSchema);
    }, ZodError);
  });
  it('should throw an error when config is empty', async () => {
    const config = {};
    await assert.rejects(async () => {
      await putClientConfig('def', config, clientConfigSchema);
    }, ZodError);
  });
  it('should throw an error when config is not an object', async () => {
    const config = 'string';
    await assert.rejects(async () => {
      await putClientConfig('def', config, clientConfigSchema);
    }, ZodError);
  });
  // TODO: Remove this test when the schema is implemented
  it('should not throw an error when no schema is provided', async () => {
    const config = { turbo: 'us-east-1' };
    const result = await putClientConfig('def', config);
    assert.strictEqual(result, true);
    assert.strictEqual(ddbMock.commandCalls(PutCommand).length, 1);
    const call = ddbMock.commandCalls(PutCommand)[0];
    assert.deepStrictEqual(call.args[0].input.Item, { clientName: 'def', config });
  });
});
