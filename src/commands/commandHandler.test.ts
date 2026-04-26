import { describe, expect, test } from 'bun:test';
import { ApiResponse, QueryParams, RequestOptions } from '../api/client';
import { CommandHandler } from './commandHandler';

class FakeCommandClient {
  calls: Array<
    | { method: 'request'; options: RequestOptions }
    | { method: 'get'; path: string; queryParams?: QueryParams }
    | { method: 'post'; path: string; body?: unknown }
    | { method: 'put'; path: string; body?: unknown }
    | { method: 'delete'; path: string; queryParams?: QueryParams }
  > = [];

  request(options: RequestOptions): Promise<ApiResponse> {
    this.calls.push({ method: 'request', options });
    return Promise.resolve(new ApiResponse(200, '{}', new Headers()));
  }

  get(path: string, queryParams?: QueryParams): Promise<ApiResponse> {
    this.calls.push({ method: 'get', path, queryParams });
    return Promise.resolve(new ApiResponse(200, '{}', new Headers()));
  }

  post(path: string, body?: unknown): Promise<ApiResponse> {
    this.calls.push({ method: 'post', path, body });
    return Promise.resolve(new ApiResponse(200, '{}', new Headers()));
  }

  put(path: string, body?: unknown): Promise<ApiResponse> {
    this.calls.push({ method: 'put', path, body });
    return Promise.resolve(new ApiResponse(200, '{}', new Headers()));
  }

  delete(path: string, queryParams?: QueryParams): Promise<ApiResponse> {
    this.calls.push({ method: 'delete', path, queryParams });
    return Promise.resolve(new ApiResponse(204, '', new Headers()));
  }
}

describe('CommandHandler notes API semantics', () => {
  test('createNote allows missing ownerId and omits owner_id from request body', async () => {
    const client = new FakeCommandClient();
    const handler = new CommandHandler(client);

    await handler.createNote({
      type: 'text/plain',
      data: 'note body',
      models: [],
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      method: 'post',
      path: '/api/ai/v1/notes',
      body: {
        type: 'text/plain',
        data: 'note body',
        role: 'real_estate',
        models: [],
      },
    });
  });

  test('createNote still forwards owner_id when ownerId is provided', async () => {
    const client = new FakeCommandClient();
    const handler = new CommandHandler(client);

    await handler.createNote({
      ownerId: 'user-123',
      type: 'text/plain',
      data: 'note body',
      models: [],
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      method: 'post',
      path: '/api/ai/v1/notes',
      body: {
        owner_id: 'user-123',
        type: 'text/plain',
        data: 'note body',
        role: 'real_estate',
        models: [],
      },
    });
  });

  test('getNote does not send owner_id query params', async () => {
    const client = new FakeCommandClient();
    const handler = new CommandHandler(client);

    await handler.getNote('note-123');

    expect(client.calls).toEqual([
      {
        method: 'get',
        path: '/api/ai/v1/notes/note-123',
        queryParams: undefined,
      },
    ]);
  });

  test('getNoteModelSync does not send owner_id query params', async () => {
    const client = new FakeCommandClient();
    const handler = new CommandHandler(client);

    await handler.getNoteModelSync('note-123');

    expect(client.calls).toEqual([
      {
        method: 'get',
        path: '/api/ai/v1/notes/note-123/model_sync',
        queryParams: undefined,
      },
    ]);
  });

  test('retryNoteModelSync does not send owner_id query params', async () => {
    const client = new FakeCommandClient();
    const handler = new CommandHandler(client);

    await handler.retryNoteModelSync('note-123');

    expect(client.calls).toEqual([
      {
        method: 'request',
        options: {
          method: 'POST',
          path: '/api/ai/v1/notes/note-123/model_sync',
        },
      },
    ]);
  });

  test('listNotes omits owner_id and forwards schema_name filter', async () => {
    const client = new FakeCommandClient();
    const handler = new CommandHandler(client);

    await handler.listNotes({
      schemaName: 'log',
      page: 2,
      itemsPerPage: 10,
      summary: 'hello',
    });

    expect(client.calls).toEqual([
      {
        method: 'get',
        path: '/api/ai/v1/notes',
        queryParams: {
          page: 2,
          items_per_page: 10,
          summary: 'hello',
          schema_name: 'log',
        },
      },
    ]);
  });

  test('listNotes still rejects items_per_page over 100', async () => {
    const client = new FakeCommandClient();
    const handler = new CommandHandler(client);

    await expect(handler.listNotes({ itemsPerPage: 101 })).rejects.toThrow(
      'items_per_page must be <= 100',
    );
  });

  test('deleteNote does not send owner_id query params', async () => {
    const client = new FakeCommandClient();
    const handler = new CommandHandler(client);

    await handler.deleteNote('note-123');

    expect(client.calls).toEqual([
      {
        method: 'delete',
        path: '/api/ai/v1/notes/note-123',
        queryParams: undefined,
      },
    ]);
  });
});
