import { describe, expect, test } from 'bun:test';

import {
  ApiResponse,
  ApiClient,
  type QueryParams,
  type RequestOptions,
} from '../api/client';
import { AuthSigner } from '../auth/signer';
import { CommandHandler } from './commandHandler';

type RecordedCall = {
  method: string;
  path: string;
  queryParams?: QueryParams;
  body?: unknown;
};

class RecordingCommandApiClient extends ApiClient {
  readonly calls: RecordedCall[] = [];

  constructor() {
    super({
      baseUrl: 'https://example.test',
      signer: new AuthSigner({
        accessKeyId: 'test-access-key',
        accessSecret: 'SK_aa',
      }),
    });
  }

  override get(path: string, queryParams?: QueryParams): Promise<ApiResponse> {
    this.calls.push({ method: 'GET', path, queryParams });
    return this.ok();
  }

  override post(path: string, body?: unknown): Promise<ApiResponse> {
    this.calls.push({ method: 'POST', path, body });
    return this.ok();
  }

  override put(path: string, body?: unknown): Promise<ApiResponse> {
    this.calls.push({ method: 'PUT', path, body });
    return this.ok();
  }

  override delete(path: string, queryParams?: QueryParams): Promise<ApiResponse> {
    this.calls.push({ method: 'DELETE', path, queryParams });
    return this.ok();
  }

  override request(options: RequestOptions): Promise<ApiResponse> {
    this.calls.push({
      method: options.method,
      path: options.path,
      queryParams: options.queryParams,
      body: options.body,
    });
    return this.ok();
  }

  private ok(): Promise<ApiResponse> {
    return Promise.resolve(new ApiResponse(200, '{}', new Headers()));
  }
}

function createHandler() {
  const client = new RecordingCommandApiClient();
  const handler = new CommandHandler(client);
  return { client, handler };
}

describe('CommandHandler request shapes', () => {
  test('listNotes omits owner_id and passes schema_name', async () => {
    const { client, handler } = createHandler();

    await handler.listNotes({ schemaName: 'tenant_note' });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      method: 'GET',
      path: '/api/ai/v1/notes',
      queryParams: { schema_name: 'tenant_note' },
    });
  });

  test('getNote does not send owner_id', async () => {
    const { client, handler } = createHandler();

    await handler.getNote('note-123');

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      method: 'GET',
      path: '/api/ai/v1/notes/note-123',
      queryParams: undefined,
    });
  });

  test('getNoteModelSync does not send owner_id', async () => {
    const { client, handler } = createHandler();

    await handler.getNoteModelSync('note-123');

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      method: 'GET',
      path: '/api/ai/v1/notes/note-123/model_sync',
      queryParams: undefined,
    });
  });

  test('retryNoteModelSync does not send owner_id', async () => {
    const { client, handler } = createHandler();

    await handler.retryNoteModelSync('note-123');

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      method: 'POST',
      path: '/api/ai/v1/notes/note-123/model_sync',
      queryParams: undefined,
      body: undefined,
    });
  });

  test('deleteNote does not send owner_id', async () => {
    const { client, handler } = createHandler();

    await handler.deleteNote('note-123');

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      method: 'DELETE',
      path: '/api/ai/v1/notes/note-123',
      queryParams: undefined,
    });
  });

  test('getSession does not send owner_id', async () => {
    const { client, handler } = createHandler();

    await handler.getSession('session-123');

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      method: 'GET',
      path: '/api/ai/v1/sessions/session-123',
      queryParams: undefined,
    });
  });

  test('sendSessionMessage does not send owner_id', async () => {
    const { client, handler } = createHandler();
    const body = { user_input: 'hello' };

    await handler.sendSessionMessage('session-123', body);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      method: 'POST',
      path: '/api/ai/v1/sessions/session-123/messages',
      queryParams: undefined,
      body,
    });
  });

  test('listSessionMessages does not send owner_id', async () => {
    const { client, handler } = createHandler();

    await handler.listSessionMessages('session-123');

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      method: 'GET',
      path: '/api/ai/v1/sessions/session-123/messages',
      queryParams: undefined,
    });
  });

  test('runOperation does not send owner_id', async () => {
    const { client, handler } = createHandler();
    const body = { user_input: 'hello' };

    await handler.runOperation(body);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      method: 'POST',
      path: '/api/ai/v1/operations',
      queryParams: undefined,
      body,
    });
  });
});
