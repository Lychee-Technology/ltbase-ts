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
  type: 'text/plain',
  data: 'My first note',
});

const listed = await commands.listNotes({ page: 1, itemsPerPage: 10, schemaName: 'log' });
const fetched = await commands.getNote(note?.note_id);
await commands.updateNote(note?.note_id, 'Updated summary');
await commands.deleteNote(note?.note_id);
```

`schemaName` maps to the RFC `schema_name` filter and matches notes by `models[].type`.
In JWT-backed data-plane flows, trusted identity and project context come from JWT claims, not
from `owner_id` query semantics.

## CLI

Run the built-in CLI with Bun:

```bash
cd ltbase-ts
bun install
bun run src/cli.ts --access-key-id AK_xxx --access-secret SK_xxx --base-url https://api.example.com deepping --echo hello
# or with the helper script
# bun run cli -- --access-key-id AK_xxx --access-secret SK_xxx deepping
```

Current CLI surface (`bun run src/cli.ts --help`):

- `create-session --bearer <token> [--owner-id <id>] [--project-id <id>] [--session-id <id>] [--file <path-to-json>]`
- `get-session --session-id <id> --bearer <token>`
- `send-session-message --session-id <id> --bearer <token> [--file <path-to-json>|--user-input <text> [--input-type <mime>] [--confirmed <true|false>]]`
- `list-session-messages --session-id <id> --bearer <token>`
- `run-operation --bearer <token> [--file <path-to-json>|--user-input <text> [--input-type <mime>] [--confirmed <true|false>]]`

```text
deepping                 [--echo <text>]
auth-health              --bearer <token>
auth-jwks                --bearer <token>
auth-login               --provider <google|supabase|firebase|apple> --id-token <token> --project-id <project-id> [--login-path-template </api/v1/login/{provider}>]
auth-bind                --provider <google|supabase|firebase|apple> --id-token <token> --code <code> --project-id <project-id> [--binding-path-template </api/v1/id_bindings/{provider}>]
auth-exchange            Alias of auth-login
auth-refresh             --refresh-token <token> --bearer <token> [--project-id <project-id>]
auth-refresh-with-access --access-token <token> --refresh-token <token> [--project-id <project-id>]
auth-revoke              --jti <id> [--reason <text>] --bearer <token>
auth-provision           Alias of auth-bind
create-activity          --type <call|line|email|visit|note> --direction <inbound|outbound> --user-id <id> --summary <text> [--id <id>] [--at <iso>] [--next-follow-up-at <iso>] [--lead-id <id>]
list-activities          [--user-id <id>] [--lead-id <id>] [--page N] [--items-per-page N]
create-lead              --name <name> --pipeline <buy|rent|sell|landlord> --tenant-id <id> --owner-user-id <id> [--id <uuid>] [--email <email>] [--phone <phone>] [--stage <stage>] [--status <status>] [--source-channel <channel>] [--source-name <name>] [--tags <tag1,tag2>] [--file <path>]
list-leads               [--lead-id <uuid>] [--page N] [--items-per-page N] [--order-by field:asc|desc]
get-lead                 --lead-id <uuid>
update-lead              --lead-id <uuid> --file <path-to-json>
create-visit             --lead-id <id> --user-id <id> --property-id <id> [--id <uuid>] [--scheduled-start-at <iso>] [--scheduled-end-at <iso>] [--status <scheduled|visited|no_show|canceled|rescheduled>] [--feedback <text>] [--attendees <name1,name2>] [--next-follow-up-at <iso>] [--file <path>]
list-visits              [--lead-id <id>] [--user-id <id>] [--property-id <id>] [--page N] [--items-per-page N]
delete-visit             --visit-row-id <uuid>
list-logs                [--log-id <id>] [--lead-id <id>] [--visit-id <id>] [--owner-id <id>] [--page N] [--items-per-page N]
create-note              --type <mime> [--data <text>|--file <path>] [--role <role>] [--visit-id <id>] [--owner-id <id>]
get-note                 --note-id <uuid>
get-note-model-sync      --note-id <uuid>
retry-note-model-sync    --note-id <uuid>
list-notes               [--page N] [--items-per-page N] [--summary <text>] [--schema-name <name>]
update-note              --note-id <uuid> --summary <text> [--owner-id <id>]
delete-note              --note-id <uuid>
search                   --schemas <lead,visit,...> --q <text> [--page N] [--page-size N]
advanced-query           --file <path-to-json>
create-session           --bearer <token> [--owner-id <id>] [--project-id <id>] [--session-id <id>] [--file <path-to-json>]
get-session              --session-id <id> --bearer <token>
send-session-message     --session-id <id> --bearer <token> [--file <path-to-json>|--user-input <text> [--input-type <mime>] [--confirmed <true|false>]]
list-session-messages    --session-id <id> --bearer <token>
run-operation            --bearer <token> [--file <path-to-json>|--user-input <text> [--input-type <mime>] [--confirmed <true|false>]]
```

RFC alignment with the current data-plane behavior:
- `list-notes` supports the RFC `schema_name` filter (`schemaName` in SDK, `--schema-name` in CLI) and matches `models[].type`
- Notes read/delete flows do not rely on `owner_id` query parameters; trusted identity comes from JWT `sub` / `user_id`
- CRUD-agent session and operation flows derive trusted `owner_id` and `project_id` from JWT claims
- Compatibility request-body fields such as `owner_id` or `project_id` may still be accepted by some endpoints and CLI commands, but the server treats JWT claims as authoritative in trusted flows
- `DELETE /api/ai/v1/notes/{note_id}` does not require an `owner_id` query parameter
- `create-note` sends one default `log` model when `models` is not provided, with runtime `id/visitId` and `${note.*}` template bindings

## Token-based E2E script

If you already have `access token` (and optional `refresh token`), use the token E2E runner:

With refresh:

```bash
cd ltbase-ts
bun run e2e:token -- \
  --auth-base-url "https://auth.example.com" \
  --access-token "$LTBASE_ACCESS_TOKEN" \
  --refresh-token "$LTBASE_REFRESH_TOKEN" \
  --project-id "$LTBASE_PROJECT_ID" \
  --owner-id "user123"
```

Without refresh (access token only):

```bash
cd ltbase-ts
bun run e2e:token -- \
  --access-token "$LTBASE_ACCESS_TOKEN" \
  --owner-id "user123"
```

It validates:

- `auth health`
- `auth refresh`
- `create note`
- `list notes` (contains created note)
- `list logs` (contains the created note log)
- `forma CRUD` for `lead`, `visit`, `log` (create/list/get/update/delete)
- `delete note` cleanup (skip with `--keep-note`)

You can also pass values by env vars:

```bash
export LTBASE_ACCESS_TOKEN="..."
export LTBASE_PROJECT_ID="project_456"
export LTBASE_OWNER_ID="user123"
export LTBASE_VISIT_ID="visit_001" # optional, used for note->log model data
export LTBASE_TENANT_ID="agency_001" # optional, default agency_001
export LTBASE_OWNER_USER_ID="demo-user-1" # optional, default LTBASE_OWNER_ID
export LTBASE_PROPERTY_ID="prop_001" # optional, default property-<uuid>
bun run e2e:token
```

If `refresh token` is provided, auth service base URL must be provided by `--auth-base-url` (or `LTBASE_AUTH_BASE_URL`).  
If only access token is provided, refresh/auth-health steps are skipped automatically.  
Data plane API base URL is auto-resolved from access token claims.
Claim keys tried first: `api_base_url`, `apiBaseUrl`, `base_url`, `baseUrl`, `ltbase_api_base_url`, `ltbaseBaseUrl`.
`project_id` used for refresh is resolved from `--project-id` / `LTBASE_PROJECT_ID` first, then falls back to access-token claims.

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
