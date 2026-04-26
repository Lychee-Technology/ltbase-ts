# CRUD Agent RFC Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `ltbase-ts` CRUD Agent session and operation APIs with the current RFC so JWT claims provide trusted ownership and project scope instead of `owner_id` query parameters.

**Architecture:** Keep the change narrowly scoped to the SDK command handler, CLI argument parsing, and README command documentation. Preserve compatibility for `createSession` by keeping `owner_id` and `project_id` as optional request fields while removing `ownerId` requirements from read/message/operation methods and stopping those methods from emitting `owner_id` query params. Route CRUD Agent CLI commands through bearer-token requests so the executable contract matches the RFC's JWT-claim context.

**Tech Stack:** TypeScript, Bun, built-in `node:test`, existing Bun CLI

---

### Task 1: Add Regression Tests For CRUD Agent Requests

**Files:**
- Create: `docs/superpowers/plans/2026-04-26-crud-agent-rfc-alignment.md`
- Create: `test/commandHandler.crudAgent.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandHandler } from '../src/commands/commandHandler';

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

  assert.deepEqual(calls, [
    {
      method: 'POST',
      path: '/api/ai/v1/sessions',
      body: { user_preferences: { language: 'zh' } },
    },
    {
      method: 'GET',
      path: '/api/ai/v1/sessions/sess-1',
      queryParams: undefined,
    },
    {
      method: 'POST',
      path: '/api/ai/v1/sessions/sess-1/messages',
      queryParams: undefined,
      body: { user_input: 'hello' },
    },
    {
      method: 'GET',
      path: '/api/ai/v1/sessions/sess-1/messages',
      queryParams: undefined,
    },
    {
      method: 'POST',
      path: '/api/ai/v1/operations',
      queryParams: undefined,
      body: { user_input: 'hello' },
    },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/commandHandler.crudAgent.test.ts`
Expected: FAIL with TypeScript compile errors because the old method signatures still require `ownerId` arguments.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface CreateSessionRequest {
  session_id?: string;
  owner_id?: string;
  project_id?: string;
  user_preferences?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

async getSession(sessionId: string) {
  const response = await this.client.get(`/api/ai/v1/sessions/${encodeURIComponent(sessionId)}`);
  this.assertSuccess(response, 'Failed to get session');
  return response.json();
}

async sendSessionMessage(sessionId: string, body: SessionMessageRequest | Record<string, unknown>) {
  const response = await this.client.request({
    method: 'POST',
    path: `/api/ai/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
    body,
  });
  this.assertSuccess(response, 'Failed to send session message');
  return response.json();
}

async listSessionMessages(sessionId: string) {
  const response = await this.client.get(`/api/ai/v1/sessions/${encodeURIComponent(sessionId)}/messages`);
  this.assertSuccess(response, 'Failed to list session messages');
  return response.json();
}

async runOperation(body: SessionMessageRequest | Record<string, unknown>) {
  const response = await this.client.request({
    method: 'POST',
    path: '/api/ai/v1/operations',
    body,
  });
  this.assertSuccess(response, 'Failed to run operation');
  return response.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/commandHandler.crudAgent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json test/commandHandler.crudAgent.test.ts src/commands/commandHandler.ts
git commit -m "fix: align CRUD agent SDK methods with JWT context"
```

### Task 2: Update CLI Contract And Help Text

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Write the failing test**

Add this test below the request-level test in `test/commandHandler.crudAgent.test.ts`:

```ts
import { readFile } from 'node:fs/promises';

test('CLI usage requires bearer auth for CRUD agent reads and operations', async () => {
  const cliSource = await readFile(new URL('../src/cli.ts', import.meta.url), 'utf8');

  assert.match(cliSource, /create-session\s+--bearer <token> \[--owner-id <id>\] \[--project-id <id>\]/);
  assert.match(cliSource, /get-session\s+--session-id <id> --bearer <token>/);
  assert.match(cliSource, /send-session-message\s+--session-id <id> --bearer <token>/);
  assert.match(cliSource, /list-session-messages\s+--session-id <id> --bearer <token>/);
  assert.match(cliSource, /run-operation\s+--bearer <token> \[--file <path-to-json>\|--user-input <text>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/commandHandler.crudAgent.test.ts`
Expected: FAIL because `src/cli.ts` still routes these commands through the AK/SK path instead of requiring `--bearer` for JWT-context requests.

- [ ] **Step 3: Write minimal implementation**

```ts
if (isBearerCrudCommand) {
  const bearerToken = requiredString(params, 'bearer');

  switch (command) {
    case 'create-session': {
      const ownerId = optionalString(params, 'owner-id');
      const projectId = optionalString(params, 'project-id');
      const sessionId = optionalString(params, 'session-id');
      const filePath = optionalString(params, 'file');
      const body = filePath ? await readJsonObjectFile(filePath) : {};
      const payload = await requestJsonWithBearer({
        baseUrl,
        method: 'POST',
        path: '/api/ai/v1/sessions',
        bearerToken,
        body: {
          ...body,
          ...(ownerId ? { owner_id: ownerId } : {}),
          ...(projectId ? { project_id: projectId } : {}),
          ...(sessionId ? { session_id: sessionId } : {}),
        },
        verbose,
      });
      console.log('✓ Session created');
      console.log(JSON.stringify(payload, null, 2));
      break;
    }
  }
}
```

Also update the `printUsage()` block and README so those commands require `--bearer`, and make sure they no longer promise AK/SK-based execution for JWT-context endpoints.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/commandHandler.crudAgent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/commandHandler.crudAgent.test.ts
git commit -m "fix: drop owner-id from CRUD agent CLI commands"
```

### Task 3: Update README Examples And Verification Commands

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

Add this test below the CLI test in `test/commandHandler.crudAgent.test.ts`:

```ts
test('README documents CRUD agent commands with bearer auth and optional compatibility fields', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /create-session --bearer <token> \[--owner-id <id>\] \[--project-id <id>\] \[--session-id <id>\] \[--file <path-to-json>\]/);
  assert.match(readme, /get-session --session-id <id> --bearer <token>/);
  assert.match(readme, /send-session-message --session-id <id> --bearer <token> \[--file <path-to-json>\|--user-input <text>/);
  assert.match(readme, /list-session-messages --session-id <id> --bearer <token>/);
  assert.match(readme, /run-operation --bearer <token> \[--file <path-to-json>\|--user-input <text>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/commandHandler.crudAgent.test.ts`
Expected: FAIL because `README.md` still lists AK/SK-era command forms instead of the bearer-token contract.

- [ ] **Step 3: Write minimal implementation**

Update the README command list to:

```md
- `create-session --bearer <token> [--owner-id <id>] [--project-id <id>] [--session-id <id>] [--file <path-to-json>]`
- `get-session --session-id <id> --bearer <token>`
- `send-session-message --session-id <id> --bearer <token> [--file <path-to-json>|--user-input <text> [--input-type <mime>] [--confirmed <true|false>]]`
- `list-session-messages --session-id <id> --bearer <token>`
- `run-operation --bearer <token> [--file <path-to-json>|--user-input <text> [--input-type <mime>] [--confirmed <true|false>]]`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/commandHandler.crudAgent.test.ts`
Expected: PASS

- [ ] **Step 5: Run full verification**

Run: `bun test test/commandHandler.crudAgent.test.ts && bun run check`
Expected: all tests PASS and `tsc --noEmit` exits successfully with no errors.
