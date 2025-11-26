import { CommandHandler } from './commands/commandHandler';
import { ApiClient } from './api/client';
import { AuthSigner } from './auth/signer';

type ArgValue = string | boolean;

interface ParsedArgs {
  global: Record<string, ArgValue>;
  command?: string;
  params: Record<string, ArgValue>;
}

const COMMANDS = new Set([
  'deepping',
  'create-note',
  'get-note',
  'list-notes',
  'update-note',
  'delete-note',
]);

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
      // positional (used only by delete-note)
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

Global options:
  --access-key-id      Access Key ID (AK_xxx)
  --access-secret      Access Secret (SK_xxx, base64url PKCS#8 Ed25519)
  --base-url           API base URL (default: https://api.example.com)
  --verbose            Enable verbose request/response logs
  --help               Show this help

Commands:
  deepping               [--echo <text>]
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

    if (global.help || !command) {
      printUsage();
      return;
    }

    const accessKeyId = requiredString(global, 'access-key-id');
    const accessSecret = requiredString(global, 'access-secret');
    const baseUrl = optionalString(global, 'base-url') ?? 'https://api.example.com';
    const verbose = global.verbose === true;

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
      case 'create-note': {
        const payload = await handler.createNote({
          ownerId: requiredString(params, 'owner-id'),
          type: requiredString(params, 'type'),
          data: optionalString(params, 'data'),
          filePath: optionalString(params, 'file'),
          role: optionalString(params, 'role'),
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
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

main();
