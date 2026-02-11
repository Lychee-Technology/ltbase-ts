import { randomUUID } from 'node:crypto';
import { CommandHandler } from './commands/commandHandler';
import { ApiClient } from './api/client';
import { AuthSigner } from './auth/signer';
import { AuthServiceClient } from './auth/client';

type ArgValue = string | boolean;

interface ParsedArgs {
  global: Record<string, ArgValue>;
  command?: string;
  params: Record<string, ArgValue>;
}

const COMMANDS = new Set([
  'deepping',
  'auth-health',
  'auth-jwks',
  'auth-login',
  'auth-bind',
  'auth-exchange',
  'auth-refresh',
  'auth-revoke',
  'auth-provision',
  'create-activity',
  'list-activities',
  'create-lead',
  'list-leads',
  'get-lead',
  'update-lead',
  'create-visit',
  'list-visits',
  'delete-visit',
  'list-logs',
  'create-note',
  'get-note',
  'list-notes',
  'update-note',
  'delete-note',
]);

const AUTH_COMMANDS = new Set([
  'auth-health',
  'auth-jwks',
  'auth-login',
  'auth-bind',
  'auth-exchange',
  'auth-refresh',
  'auth-revoke',
  'auth-provision',
]);

const SUPPORTED_AUTH_PROVIDERS = ['google', 'supabase', 'firebase', 'apple'] as const;

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const parsed: ParsedArgs = { global: {}, params: {} };
  let i = 0;
  let commandFound = false;

  const parseOption = (target: Record<string, ArgValue>) => {
    const arg = args[i];
    if (!arg.startsWith('-')) return false;

    const next = args[i + 1];
    const isBoolean = next === undefined || next.startsWith('-') || COMMANDS.has(next);
    const key = normalizeKey(arg.replace(/^--?/, ''));
    target[key] = isBoolean ? true : next;
    i += isBoolean ? 1 : 2;
    return true;
  };

  while (i < args.length) {
    const current = args[i];

    if (COMMANDS.has(current)) {
      parsed.command = current;
      commandFound = true;
      i += 1;
      break;
    }

    if (!parseOption(parsed.global)) {
      i += 1;
    }
  }

  while (i < args.length) {
    if (!parseOption(parsed.params)) {
      // positional (used only by delete-note/delete-visit)
      parsed.params._ = args.slice(i).join(' ');
      break;
    }
  }

  if (!commandFound && parsed.global.help !== true) {
    parsed.global.help = true;
  }

  return parsed;
}

function requiredString(params: Record<string, ArgValue>, key: string): string {
  const value = params[key];
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error(`Missing required option --${key}`);
}

function optionalString(params: Record<string, ArgValue>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

function parseNumberParam(params: Record<string, ArgValue>, key: string): number | undefined {
  const value = optionalString(params, key);
  if (value === undefined) return undefined;
  const num = Number(value);
  if (Number.isNaN(num)) {
    throw new Error(`Invalid number for --${key}: ${value}`);
  }
  return num;
}

function requireEnum<T extends string>(
  params: Record<string, ArgValue>,
  key: string,
  allowed: readonly T[],
): T {
  const value = requiredString(params, key);
  if (allowed.includes(value as T)) return value as T;
  throw new Error(`Invalid value for --${key}. Allowed: ${allowed.join(', ')}`);
}

function normalizeKey(key: string): string {
  if (key === 'h') return 'help';
  if (key === 'v') return 'verbose';
  return key;
}

function printUsage() {
  console.log(`
LTBase CLI (Bun)

Usage:
  bun run src/cli.ts --access-key-id AK_xxx --access-secret SK_xxx [--base-url https://api.example.com] <command> [options]
  bun run src/cli.ts [--base-url https://api.example.com] <auth-command> [options]

Global options:
  --access-key-id      Access Key ID (AK_xxx)
  --access-secret      Access Secret (SK_xxx, base64url PKCS#8 Ed25519)
  --base-url           API base URL (default: https://api.example.com)
  --verbose            Enable verbose request/response logs
  --help               Show this help

Commands:
  deepping               [--echo <text>]
  auth-health            --bearer <token>
  auth-jwks
  auth-login              --provider <google|supabase|firebase|apple> --id-token <token> --project-id <project-id> [--login-path-template </api/v1/login/{provider}>]
  auth-bind               --provider <google|supabase|firebase|apple> --id-token <token> --code <code> --project-id <project-id> [--binding-path-template </api/v1/id_bindings/{provider}>]
  auth-exchange           Alias of auth-login
  auth-refresh            --refresh-token <token> --bearer <token>
  auth-revoke             --jti <id> [--reason <text>] --bearer <token>
  auth-provision          Alias of auth-bind
  create-activity        --type <call|line|email|visit|note> --direction <inbound|outbound> --user-id <id> --summary <text> [--id <id>] [--at <iso>] [--next-follow-up-at <iso>] [--lead-id <id>]
  list-activities        [--user-id <id>] [--lead-id <id>] [--page N] [--items-per-page N]
  create-lead            --name <name> --pipeline <buy|rent|sell|landlord> --tenant-id <id> --owner-user-id <id> [--id <uuid>] [--email <email>] [--phone <phone>] [--stage <stage>] [--status <status>] [--source-channel <channel>] [--source-name <name>] [--tags <tag1,tag2>] [--file <path>]
  list-leads             --lead-id <uuid> [--page N] [--items-per-page N] [--order-by field:asc|desc]
  get-lead               --lead-id <uuid>
  update-lead            --lead-id <uuid> --file <path>
  create-visit           --lead-id <id> --user-id <id> --property-id <id> [--id <uuid>] [--scheduled-start-at <iso>] [--scheduled-end-at <iso>] [--status <scheduled|visited|no_show|canceled|rescheduled>] [--feedback <text>] [--attendees <name1,name2>] [--next-follow-up-at <iso>] [--file <path>]
  list-visits            [--lead-id <id>] [--user-id <id>] [--property-id <id>] [--page N] [--items-per-page N]
  delete-visit           --visit-row-id <uuid>
  list-logs              [--log-id <id>] [--lead-id <id>] [--visit-id <id>] [--owner-id <id>] [--page N] [--items-per-page N]
  create-note            --owner-id <id> --type <mime> [--data <text>|--file <path>] [--role <role>]
  get-note               --owner-id <id> --note-id <uuid>
  list-notes             --owner-id <id> [--page N] [--items-per-page N] [--schema-name name] [--summary text]
  update-note            --owner-id <id> --note-id <uuid> --summary <text>
  delete-note            --note-id <uuid>
`);
}

async function main() {
  try {
    const { global, command, params } = parseArgs(process.argv);
    const isAuthCommand = command ? AUTH_COMMANDS.has(command) : false;

    if (global.help || !command) {
      printUsage();
      return;
    }

    const baseUrl = optionalString(global, 'base-url') ?? 'https://api.example.com';
    const verbose = global.verbose === true;

    if (isAuthCommand) {
      const authClient = new AuthServiceClient({
        baseUrl,
        verbose,
        loginPathTemplate: optionalString(params, 'login-path-template'),
        bindingPathTemplate: optionalString(params, 'binding-path-template'),
      });
      switch (command) {
        case 'auth-health': {
          const bearer = requiredString(params, 'bearer');
          const payload = await authClient.health(bearer);
          console.log('✓ Auth health ok');
          console.log(JSON.stringify(payload, null, 2));
          break;
        }
        case 'auth-jwks': {
          const payload = await authClient.jwks();
          console.log(JSON.stringify(payload, null, 2));
          break;
        }
        case 'auth-login':
        case 'auth-exchange': {
          const provider = requireEnum(params, 'provider', SUPPORTED_AUTH_PROVIDERS);
          const idToken = requiredString(params, 'id-token');
          const projectId = requiredString(params, 'project-id');
          const payload = await authClient.login(provider, idToken, {
            project_id: projectId,
          });
          console.log('✓ Login successful');
          console.log(JSON.stringify(payload, null, 2));
          break;
        }
        case 'auth-refresh': {
          const refreshToken = requiredString(params, 'refresh-token');
          const bearer = requiredString(params, 'bearer');
          const payload = await authClient.refresh(refreshToken, bearer);
          console.log('✓ Refresh successful');
          console.log(JSON.stringify(payload, null, 2));
          break;
        }
        case 'auth-revoke': {
          const jti = requiredString(params, 'jti');
          const bearer = requiredString(params, 'bearer');
          const reason = optionalString(params, 'reason');
          const payload = await authClient.revoke(jti, bearer, reason);
          console.log('✓ Token revoked');
          console.log(JSON.stringify(payload, null, 2));
          break;
        }
        case 'auth-bind':
        case 'auth-provision': {
          const provider = requireEnum(params, 'provider', SUPPORTED_AUTH_PROVIDERS);
          const idToken = requiredString(params, 'id-token');
          const code = requiredString(params, 'code');
          const projectId = requiredString(params, 'project-id');
          const payload = await authClient.bind(
            provider,
            {
              bind_context: {
                code,
                project_id: projectId,
              },
            },
            idToken,
          );
          console.log('✓ Bind successful');
          console.log(JSON.stringify(payload, null, 2));
          break;
        }
        default:
          printUsage();
      }
      return;
    }

    const accessKeyId = requiredString(global, 'access-key-id');
    const accessSecret = requiredString(global, 'access-secret');

    const signer = new AuthSigner({ accessKeyId, accessSecret });
    const client = new ApiClient({ baseUrl, signer, verbose });
    const handler = new CommandHandler(client);

    switch (command) {
      case 'deepping': {
        const result = await handler.deepping(optionalString(params, 'echo'));
        console.log('✓ DeepPing successful');
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case 'create-activity': {
        const payload = await handler.createActivity({
          id: optionalString(params, 'id') ?? randomUUID(),
          type: requireEnum(params, 'type', ['call', 'line', 'email', 'visit', 'note']),
          direction: requireEnum(params, 'direction', ['inbound', 'outbound']),
          at: optionalString(params, 'at') ?? new Date().toISOString(),
          userId: requiredString(params, 'user-id'),
          summary: requiredString(params, 'summary'),
          nextFollowUpAt: optionalString(params, 'next-follow-up-at'),
          leadId: optionalString(params, 'lead-id'),
        });
        console.log('✓ Activity created');
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'list-activities': {
        const payload = await handler.listActivities({
          userId: optionalString(params, 'user-id'),
          leadId: optionalString(params, 'lead-id'),
          page: parseNumberParam(params, 'page'),
          itemsPerPage: parseNumberParam(params, 'items-per-page'),
        });
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'create-note': {
        const models = [{
          'type': 'log', 'data': {
            'id': '17d9bdb7-adb6-4d6c-95dc-ff17b5e3c7d9',
            'visitId': '94fdbcbe-1744-4ed9-910c-b9b59268d3e4',
            'noteId': '${note.note_id}',
            'ownerId': '${note.owner_id}',
            'summary': '${note.summary}',
            'type': '${note.type}',
            'createdAt': '${note.created_at}',
            'updatedAt': '${note.updated_at}',
          }
        }]
        const payload = await handler.createNote({
          ownerId: requiredString(params, 'owner-id'),
          type: requiredString(params, 'type'),
          data: optionalString(params, 'data'),
          filePath: optionalString(params, 'file'),
          role: optionalString(params, 'role'),
          models,
        });
        console.log('✓ Note created');
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'get-note': {
        const payload = await handler.getNote(
          requiredString(params, 'owner-id'),
          requiredString(params, 'note-id'),
        );
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'list-notes': {
        const payload = await handler.listNotes({
          ownerId: requiredString(params, 'owner-id'),
          page: parseNumberParam(params, 'page'),
          itemsPerPage: parseNumberParam(params, 'items-per-page'),
          schemaName: optionalString(params, 'schema-name'),
          summary: optionalString(params, 'summary'),
        });
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'create-lead': {
        const tagsStr = optionalString(params, 'tags');
        const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()) : undefined;

        const payload = await handler.createLead({
          id: optionalString(params, 'id'),
          tenantId: requiredString(params, 'tenant-id'),
          ownerUserId: requiredString(params, 'owner-user-id'),
          pipeline: requireEnum(params, 'pipeline', ['buy', 'rent', 'sell', 'landlord']),
          stage: optionalString(params, 'stage') as
            | 'new'
            | 'contacted'
            | 'need_defined'
            | 'viewing'
            | 'offer'
            | 'contract'
            | 'closed'
            | undefined,
          status: optionalString(params, 'status') as 'open' | 'won' | 'lost' | 'junk' | undefined,
          name: requiredString(params, 'name'),
          email: optionalString(params, 'email'),
          phone: optionalString(params, 'phone'),
          sourceChannel: optionalString(params, 'source-channel') as
            | 'portal'
            | 'walk_in'
            | 'referral'
            | 'phone'
            | 'web_form'
            | 'event'
            | 'other'
            | undefined,
          sourceName: optionalString(params, 'source-name'),
          tags,
          filePath: optionalString(params, 'file'),
        });
        console.log('✓ Lead created');
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'list-leads': {
        const payload = await handler.listLeads({
          leadId: optionalString(params, 'lead-id'),
          page: parseNumberParam(params, 'page'),
          itemsPerPage: parseNumberParam(params, 'items-per-page'),
          orderBy: optionalString(params, 'order-by'),
        });
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'get-lead': {
        const payload = await handler.getLead(requiredString(params, 'lead-id'));
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'update-lead': {
        const payload = await handler.updateLead({
          leadId: requiredString(params, 'lead-id'),
          filePath: requiredString(params, 'file'),
        });
        console.log('✓ Lead updated');
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'create-visit': {
        const attendeesStr = optionalString(params, 'attendees');
        const attendees = attendeesStr ? attendeesStr.split(',').map((a) => a.trim()) : undefined;

        const payload = await handler.createVisit({
          id: optionalString(params, 'id'),
          leadId: requiredString(params, 'lead-id'),
          userId: requiredString(params, 'user-id'),
          propertyId: requiredString(params, 'property-id'),
          scheduledStartAt: optionalString(params, 'scheduled-start-at'),
          scheduledEndAt: optionalString(params, 'scheduled-end-at'),
          status: optionalString(params, 'status') as
            | 'scheduled'
            | 'visited'
            | 'no_show'
            | 'canceled'
            | 'rescheduled'
            | undefined,
          feedback: optionalString(params, 'feedback'),
          attendees,
          nextFollowUpAt: optionalString(params, 'next-follow-up-at'),
          filePath: optionalString(params, 'file'),
        });
        console.log('✓ Visit created');
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'list-visits': {
        const payload = await handler.listVisits({
          leadId: optionalString(params, 'lead-id'),
          userId: optionalString(params, 'user-id'),
          propertyId: optionalString(params, 'property-id'),
          page: parseNumberParam(params, 'page'),
          itemsPerPage: parseNumberParam(params, 'items-per-page'),
        });
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'delete-visit': {
        const visitId = optionalString(params, 'visit-row-id') ?? optionalString(params, '_');
        if (!visitId) throw new Error('Missing --visit-row-id');
        const payload = await handler.deleteVisit(visitId.trim());
        console.log('✓ Visit deleted');
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'list-logs': {
        const payload = await handler.listLogs({
          logId: optionalString(params, 'log-id'),
          leadId: optionalString(params, 'lead-id'),
          visitId: optionalString(params, 'visit-id'),
          ownerId: optionalString(params, 'owner-id'),
          page: parseNumberParam(params, 'page'),
          itemsPerPage: parseNumberParam(params, 'items-per-page'),
        });
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'update-note': {
        const payload = await handler.updateNote(
          requiredString(params, 'owner-id'),
          requiredString(params, 'note-id'),
          requiredString(params, 'summary'),
        );
        console.log('✓ Note updated');
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      case 'delete-note': {
        const noteId = optionalString(params, 'note-id') ?? optionalString(params, '_');
        if (!noteId) throw new Error('Missing --note-id');
        const payload = await handler.deleteNote(noteId.trim());
        console.log('✓ Note deleted');
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
      default:
        printUsage();
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`, `${(err as Error).stack}`);
    process.exitCode = 1;
  }
}

main();
