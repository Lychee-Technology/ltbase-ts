# LTBase TypeScript SDK (Bun)

TypeScript port of the Dart LTBase client. Uses Bun as the runtime, signs requests with Ed25519, and avoids third-party runtime dependencies.

## Setup

```bash
cd ltbase-ts
bun install  # installs only dev dependencies (TypeScript + Node types)
```

## Quick start

```ts
import { ApiClient, AuthSigner, CommandHandler } from './src';

const signer = new AuthSigner({
  accessKeyId: 'AK_xxx',
  accessSecret: 'SK_xxx', // PKCS#8 Ed25519 key in base64url form
});

const client = new ApiClient({
  baseUrl: 'https://api.example.com',
  signer,
  verbose: true, // optional request/response logging
});

const commands = new CommandHandler(client);

await commands.deepping('hello');

const note = await commands.createNote({
  ownerId: 'user123',
  type: 'text/plain',
  data: 'My first note',
});

const listed = await commands.listNotes({ ownerId: 'user123', page: 1, itemsPerPage: 10 });
const fetched = await commands.getNote('user123', note?.note_id);
await commands.updateNote('user123', note?.note_id, 'Updated summary');
await commands.deleteNote(note?.note_id);
```

## CLI

Run the built-in CLI with Bun:

```bash
cd ltbase-ts
bun install
bun run src/cli.ts --access-key-id AK_xxx --access-secret SK_xxx --base-url https://api.example.com deepping --echo hello
# or with the helper script
# bun run cli -- --access-key-id AK_xxx --access-secret SK_xxx deepping
```

Supported commands mirror the Dart client:

- `deepping [--echo text]`
- `auth-login --provider <google|supabase|firebase|apple> --id-token <token> --project-id <project-id> [--login-path-template </api/v1/login/{provider}>]`
- `auth-bind --provider <google|supabase|firebase|apple> --id-token <token> --code <code> --project-id <project-id> [--binding-path-template </api/v1/id_bindings/{provider}>]`
- `auth-exchange` (alias of `auth-login`)
- `auth-provision` (alias of `auth-bind`)
- `create-note --owner-id <id> --type <mime> [--data text|--file path] [--role role]`
- `get-note --owner-id <id> --note-id <uuid>`
- `list-leads [--page N] [--items-per-page N] [--order-by field:asc|desc]`
- `list-notes --owner-id <id> [--page N] [--items-per-page N] [--schema-name name] [--summary text]`
- `update-lead --lead-id <uuid> --file <path-to-json>`
- `update-note --owner-id <id> --note-id <uuid> --summary <text>`
- `delete-note --note-id <uuid>`
- `delete-visit --visit-row-id <uuid>`

## AAA auth examples

Based on RFC `EN/aaa.md`, the default auth endpoints are:

- `POST /api/v1/login/{provider}`
- `POST /api/v1/id_bindings/{provider}`

```ts
import { AuthServiceClient } from './src';

const auth = new AuthServiceClient({
  baseUrl: 'https://api.example.com',
});

const loginResult = await auth.login(
  'firebase',
  process.env.FIREBASE_ID_TOKEN!,
  {
    project_id: 'project_456',
  },
);

const bindResult = await auth.bind(
  'firebase',
  {
    bind_context: {
      code: 'ABC123',
      project_id: 'project_456',
    },
  },
  process.env.FIREBASE_ID_TOKEN!,
);
```

If your gateway exposes `/api/v1/auth/firebase`, set `--login-path-template` (CLI) or
`loginPathTemplate` (SDK):

```bash
bun run src/cli.ts --base-url https://api.example.com \
  auth-login --provider firebase --id-token "$FIREBASE_ID_TOKEN" --project-id project_456 \
  --login-path-template /api/v1/auth/{provider}
```

```ts
const authViaCustomPath = new AuthServiceClient({
  baseUrl: 'https://api.example.com',
  loginPathTemplate: '/api/v1/auth/{provider}',
});

const tokenPair = await authViaCustomPath.login(
  'firebase',
  process.env.FIREBASE_ID_TOKEN!,
  {
    project_id: 'project_456',
  },
);
```

## API surface

- `AuthSigner` builds the `LtBase <id>:<signature>:<timestamp>:<nonce>` header. It trims trailing `/` and `?` in URLs and signs the SHA-256 hash of the request body plus the sorted query string with Ed25519.
- `ApiClient` wraps `fetch` with signing, JSON encoding, and simple response helpers.
- `CommandHandler` mirrors the Dart commands (`deepping`, `createNote`, `getNote`, `listNotes`, `updateNote`, `deleteNote`) and throws on non-2xx responses.

This SDK keeps parity with the Dart version while staying Bun-native and dependency-light.
