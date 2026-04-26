import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { promisify } from 'node:util';
import { CommandHandler } from '../src/commands/commandHandler';

const execFile = promisify(execFileCallback);

class FakeResponse {
  readonly status = 200;
  readonly body = '{}';
  readonly headers = new Headers();

  get isSuccess() {
    return true;
  }

  json<T = unknown>(): T {
    return {} as T;
  }
}

test('CRUD agent request methods omit owner_id query params', async () => {
  const calls: Array<{ method: string; path: string; queryParams?: Record<string, unknown>; body?: unknown }> = [];
  const client = {
    get: async (path: string, queryParams?: Record<string, unknown>) => {
      calls.push({ method: 'GET', path, queryParams });
      return new FakeResponse();
    },
    request: async (options: {
      method: string;
      path: string;
      queryParams?: Record<string, unknown>;
      body?: unknown;
    }) => {
      calls.push(options);
      return new FakeResponse();
    },
    post: async (path: string, body?: unknown) => {
      calls.push({ method: 'POST', path, body });
      return new FakeResponse();
    },
  };

  const handler = new CommandHandler(client as never);
  await handler.createSession({ user_preferences: { language: 'zh' } });
  await handler.getSession('sess-1');
  await handler.sendSessionMessage('sess-1', { user_input: 'hello' });
  await handler.listSessionMessages('sess-1');
  await handler.runOperation({ user_input: 'hello' });

  assert.equal(calls.length, 5);
  assert.deepEqual(calls[0], {
    method: 'POST',
    path: '/api/ai/v1/sessions',
    body: { user_preferences: { language: 'zh' } },
  });
  assert.deepEqual(calls[1], {
    method: 'GET',
    path: '/api/ai/v1/sessions/sess-1',
    queryParams: undefined,
  });
  assert.deepEqual(calls[2], {
    method: 'POST',
    path: '/api/ai/v1/sessions/sess-1/messages',
    body: { user_input: 'hello' },
  });
  assert.deepEqual(calls[3], {
    method: 'GET',
    path: '/api/ai/v1/sessions/sess-1/messages',
    queryParams: undefined,
  });
  assert.deepEqual(calls[4], {
    method: 'POST',
    path: '/api/ai/v1/operations',
    body: { user_input: 'hello' },
  });

  for (const call of calls) {
    assert.notEqual(call.queryParams?.owner_id, 'user123');
    assert.equal('owner_id' in (call.queryParams ?? {}), false);
  }
});

test('CLI usage no longer requires owner-id for CRUD agent reads and operations', async () => {
  const cliSource = await readFile(new URL('../src/cli.ts', import.meta.url), 'utf8');

  assert.match(cliSource, /create-session\s+--bearer <token> \[--owner-id <id>\]/);
  assert.match(cliSource, /get-session\s+--session-id <id> --bearer <token>/);
  assert.match(cliSource, /send-session-message\s+--session-id <id> --bearer <token>/);
  assert.match(cliSource, /list-session-messages\s+--session-id <id> --bearer <token>/);
  assert.match(cliSource, /run-operation\s+--bearer <token> \[--file <path-to-json>\|--user-input <text>/);
});

test('README documents CRUD agent commands without owner-id query context', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /- `create-session --bearer <token> \[--owner-id <id>\] \[--project-id <id>\] \[--session-id <id>\] \[--file <path-to-json>\]`/);
  assert.match(readme, /- `get-session --session-id <id> --bearer <token>`/);
  assert.match(readme, /- `send-session-message --session-id <id> --bearer <token> \[--file <path-to-json>\|--user-input <text>/);
  assert.match(readme, /- `list-session-messages --session-id <id> --bearer <token>`/);
  assert.match(readme, /- `run-operation --bearer <token> \[--file <path-to-json>\|--user-input <text>/);
});

test('CLI CRUD agent commands use bearer auth without owner_id query params', async () => {
  const requests: Array<{ method: string; url: string; authorization?: string; body: string }> = [];
  const server = createServer(async (req, res) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }

    requests.push({
      method: req.method ?? '',
      url: req.url ?? '',
      authorization: req.headers.authorization,
      body: Buffer.concat(chunks).toString('utf8'),
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server failed to bind to a TCP port');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const cwd = new URL('..', import.meta.url).pathname;

    const createSession = await execFile(process.execPath, [
      'run',
      'src/cli.ts',
      '--base-url',
      baseUrl,
      'create-session',
      '--bearer',
      'jwt-token',
      '--owner-id',
      'compat-owner',
      '--project-id',
      'compat-project',
      '--session-id',
      'sess-1',
    ], { cwd });

    const getSession = await execFile(process.execPath, [
      'run',
      'src/cli.ts',
      '--base-url',
      baseUrl,
      'get-session',
      '--session-id',
      'sess-1',
      '--bearer',
      'jwt-token',
    ], { cwd });

    assert.match(createSession.stdout, /Session created/);
    assert.equal(getSession.stderr, '');

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], {
      method: 'POST',
      url: '/api/ai/v1/sessions',
      authorization: 'Bearer jwt-token',
      body: JSON.stringify({
        owner_id: 'compat-owner',
        project_id: 'compat-project',
        session_id: 'sess-1',
      }),
    });
    assert.deepEqual(requests[1], {
      method: 'GET',
      url: '/api/ai/v1/sessions/sess-1',
      authorization: 'Bearer jwt-token',
      body: '',
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
