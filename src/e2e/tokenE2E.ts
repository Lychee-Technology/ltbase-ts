import { randomUUID } from 'node:crypto';
import { ApiResponse, QueryParams, RequestOptions } from '../api/client';
import { AuthServiceClient } from '../auth/client';
import { CommandHandler } from '../commands/commandHandler';

type ArgValue = string | boolean;

interface ParsedArgs {
  params: Record<string, ArgValue>;
}

interface E2EOptions {
  authBaseUrl?: string;
  apiBaseUrl: string;
  apiBaseUrlClaimKey: string;
  projectId?: string;
  projectIdSource?: string;
  accessToken: string;
  refreshToken?: string;
  ownerId: string;
  noteText: string;
  role: string;
  visitId?: string;
  tenantId: string;
  ownerUserId: string;
  propertyId: string;
  logPollAttempts: number;
  logPollIntervalMs: number;
  keepNote: boolean;
  verbose: boolean;
}

interface BearerRequestOptions {
  method: string;
  path: string;
  bearerToken: string;
  queryParams?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

interface HttpResult<T = unknown> {
  status: number;
  data: T | null;
  rawBody: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const params: Record<string, ArgValue> = {};
  let i = 0;

  while (i < args.length) {
    const current = args[i];
    if (!current.startsWith('-')) {
      i += 1;
      continue;
    }

    const key = normalizeKey(current.replace(/^--?/, ''));
    const next = args[i + 1];
    const isBoolean = next === undefined || next.startsWith('-');
    params[key] = isBoolean ? true : next;
    i += isBoolean ? 1 : 2;
  }

  return { params };
}

function normalizeKey(key: string): string {
  if (key === 'h') return 'help';
  if (key === 'v') return 'verbose';
  return key;
}

function readStringArg(
  params: Record<string, ArgValue>,
  argName: string,
  envName?: string,
): string | undefined {
  const cliValue = params[argName];
  if (typeof cliValue === 'string' && cliValue.trim().length > 0) {
    return cliValue.trim();
  }

  if (envName) {
    const envValue = process.env[envName];
    if (envValue && envValue.trim().length > 0) {
      return envValue.trim();
    }
  }

  return undefined;
}

function readNumberArg(
  params: Record<string, ArgValue>,
  argName: string,
  envName: string,
  fallback: number,
): number {
  const raw = readStringArg(params, argName, envName);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid value for --${argName}: ${raw}`);
  }
  return value;
}

function toBoolean(value: ArgValue | undefined): boolean {
  return value === true;
}

function getRequired(
  params: Record<string, ArgValue>,
  argName: string,
  envName: string,
): string {
  const value = readStringArg(params, argName, envName);
  if (!value) {
    throw new Error(`Missing required option --${argName} (or env ${envName})`);
  }
  return value;
}

function buildOptions(params: Record<string, ArgValue>): E2EOptions {
  const accessToken = getRequired(params, 'access-token', 'LTBASE_ACCESS_TOKEN');
  const authBaseUrl = resolveAuthBaseUrl(params);
  const resolvedApiBaseUrl = resolveApiBaseUrl(accessToken);
  const resolvedProjectId = resolveProjectId(params, accessToken);
  const apiBaseUrl = resolvedApiBaseUrl.baseUrl;
  const apiBaseUrlClaimKey = resolvedApiBaseUrl.claimKey;
  const refreshToken = readStringArg(params, 'refresh-token', 'LTBASE_REFRESH_TOKEN');
  if (refreshToken && !authBaseUrl) {
    throw new Error(
      'Missing --auth-base-url (or LTBASE_AUTH_BASE_URL) when --refresh-token is provided',
    );
  }
  const ownerId = getRequired(params, 'owner-id', 'LTBASE_OWNER_ID');
  const noteText =
    readStringArg(params, 'note-text', 'LTBASE_NOTE_TEXT') ??
    `ltbase-ts e2e note ${new Date().toISOString()} ${randomUUID()}`;
  const role = readStringArg(params, 'role', 'LTBASE_NOTE_ROLE') ?? 'real_estate';
  const visitId = readStringArg(params, 'visit-id', 'LTBASE_VISIT_ID');
  const tenantId = readStringArg(params, 'tenant-id', 'LTBASE_TENANT_ID') ?? 'agency_001';
  const ownerUserId = readStringArg(params, 'owner-user-id', 'LTBASE_OWNER_USER_ID') ?? ownerId;
  const propertyId =
    readStringArg(params, 'property-id', 'LTBASE_PROPERTY_ID') ?? `property-${randomUUID()}`;
  const keepNote = toBoolean(params['keep-note']);
  const verbose = toBoolean(params.verbose);

  return {
    authBaseUrl,
    apiBaseUrl,
    apiBaseUrlClaimKey,
    projectId: resolvedProjectId?.projectId,
    projectIdSource: resolvedProjectId?.source,
    accessToken,
    refreshToken,
    ownerId,
    noteText,
    role,
    visitId,
    tenantId,
    ownerUserId,
    propertyId,
    logPollAttempts: readNumberArg(params, 'log-poll-attempts', 'LTBASE_LOG_POLL_ATTEMPTS', 6),
    logPollIntervalMs: readNumberArg(
      params,
      'log-poll-interval-ms',
      'LTBASE_LOG_POLL_INTERVAL_MS',
      1500,
    ),
    keepNote,
    verbose,
  };
}

function printUsage() {
  console.log(`
LTBase token-based E2E test (Bun)

Usage:
  bun run src/e2e/tokenE2E.ts [options]

Required:
  --access-token <token>    (or LTBASE_ACCESS_TOKEN)
  --owner-id <id>           (or LTBASE_OWNER_ID)

Optional:
  --refresh-token <token>   (or LTBASE_REFRESH_TOKEN); if omitted, refresh step is skipped
  --auth-base-url <url>     (or LTBASE_AUTH_BASE_URL), required only when refresh-token is provided
  --base-url <url>          Deprecated alias of --auth-base-url
  --project-id <id>         Optional project id for refresh requests (or LTBASE_PROJECT_ID)
  --note-text <text>        Note content for create-note step
  --role <role>             Note role (default: real_estate)
  --visit-id <id>           Optional visit id in note model data (or LTBASE_VISIT_ID)
  --tenant-id <id>          Lead tenant id for forma CRUD step (default: agency_001)
  --owner-user-id <id>      Lead/visit owner user id for forma CRUD step (default: owner-id)
  --property-id <id>        Visit property id for forma CRUD step (default: property-<uuid>)
  --log-poll-attempts <N>   Number of retries when searching logs (default: 6)
  --log-poll-interval-ms <N>  Delay between retries in ms (default: 1500)
  --keep-note               Skip cleanup delete-note step
  --verbose                 Print detailed request logs
  --help
`);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid access token format (expected JWT)');
  }

  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const decoded = Buffer.from(padded, 'base64').toString('utf8');

  try {
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JWT payload is not an object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to parse access token payload: ${(err as Error).message}`);
  }
}

function normalizeBaseUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported protocol in base URL: ${url.protocol}`);
  }

  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

function findBaseUrlClaim(payload: Record<string, unknown>): { claimKey: string; baseUrl: string } | null {
  const explicitClaimKeys = [
    'api_base_url',
    'apiBaseUrl',
    'base_url',
    'baseUrl',
    'ltbase_api_base_url',
    'ltbaseBaseUrl',
  ];

  for (const key of explicitClaimKeys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) {
      try {
        return { claimKey: key, baseUrl: normalizeBaseUrl(value) };
      } catch {
        // Try other claim candidates.
      }
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== 'string' || value.length === 0) continue;
    if (key.endsWith('/api_base_url') || key.endsWith('/apiBaseUrl') || key.endsWith('/base_url')) {
      try {
        return { claimKey: key, baseUrl: normalizeBaseUrl(value) };
      } catch {
        // Try other claim candidates.
      }
    }
  }

  const aud = payload.aud;
  if (typeof aud === 'string' && aud.startsWith('http')) {
    try {
      return { claimKey: 'aud', baseUrl: normalizeBaseUrl(aud) };
    } catch {
      // Continue fallback search.
    }
  }
  if (Array.isArray(aud)) {
    for (const value of aud) {
      if (typeof value === 'string' && value.startsWith('http')) {
        try {
          return { claimKey: 'aud[]', baseUrl: normalizeBaseUrl(value) };
        } catch {
          // Continue fallback search.
        }
      }
    }
  }

  return null;
}

function findProjectIdClaim(
  payload: Record<string, unknown>,
): { claimKey: string; projectId: string } | null {
  const explicitClaimKeys = ['project_id', 'projectId'];
  for (const key of explicitClaimKeys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return { claimKey: key, projectId: value.trim() };
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== 'string') continue;
    if (value.trim().length === 0) continue;
    if (key.endsWith('/project_id') || key.endsWith('/projectId')) {
      return { claimKey: key, projectId: value.trim() };
    }
  }

  return null;
}

function resolveProjectId(
  params: Record<string, ArgValue>,
  accessToken: string,
): { projectId: string; source: string } | null {
  const fromArgOrEnv = readStringArg(params, 'project-id', 'LTBASE_PROJECT_ID');
  if (fromArgOrEnv) {
    return { projectId: fromArgOrEnv, source: '--project-id/LTBASE_PROJECT_ID' };
  }

  const payload = decodeJwtPayload(accessToken);
  const fromClaim = findProjectIdClaim(payload);
  if (fromClaim) {
    return {
      projectId: fromClaim.projectId,
      source: `access token claim ${fromClaim.claimKey}`,
    };
  }

  return null;
}

function extractProjectIdFromToken(token: string): { claimKey: string; projectId: string } | null {
  try {
    return findProjectIdClaim(decodeJwtPayload(token));
  } catch {
    return null;
  }
}

function resolveAuthBaseUrl(params: Record<string, ArgValue>): string | undefined {
  const authBaseUrl =
    readStringArg(params, 'auth-base-url', 'LTBASE_AUTH_BASE_URL') ??
    readStringArg(params, 'base-url', 'LTBASE_BASE_URL');
  if (!authBaseUrl) return undefined;
  return normalizeBaseUrl(authBaseUrl);
}

function resolveApiBaseUrl(accessToken: string): { claimKey: string; baseUrl: string } {
  const payload = decodeJwtPayload(accessToken);
  const fromClaim = findBaseUrlClaim(payload);
  if (fromClaim) {
    return fromClaim;
  }

  throw new Error(
    'Cannot resolve API base URL from access token claims. Please include an API base-url claim in access token.',
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

class BearerApiClient {
  private readonly baseUrl: string;
  private readonly verbose: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, verbose: boolean, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl;
    this.verbose = verbose;
    this.fetchImpl = fetchImpl;
  }

  async request<T = unknown>(options: BearerRequestOptions): Promise<HttpResult<T>> {
    const url = new URL(options.path, this.baseUrl);
    if (options.queryParams) {
      const entries = Object.entries(options.queryParams).filter(([, value]) => value !== undefined);
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      for (const [key, value] of entries) {
        url.searchParams.append(key, String(value));
      }
    }

    const bodyString = options.body === undefined ? undefined : JSON.stringify(options.body);

    if (this.verbose) {
      console.log('----------------------------------------');
      console.log(`Bearer Request: ${options.method.toUpperCase()} ${url.toString()}`);
      if (bodyString) console.log(`Body: ${bodyString}`);
      console.log('----------------------------------------');
    }

    const response = await this.fetchImpl(url.toString(), {
      method: options.method,
      headers: {
        Authorization: `Bearer ${options.bearerToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept-Encoding': 'gzip',
      },
      body: bodyString,
    });

    const rawBody = await decodeResponse(response);
    let data: T | null = null;

    if (rawBody.length > 0) {
      try {
        data = JSON.parse(rawBody) as T;
      } catch {
        data = null;
      }
    }

    if (this.verbose) {
      console.log(`Response Status: ${response.status}`);
      console.log(`Response Body: ${rawBody}`);
      console.log('----------------------------------------');
    }

    return {
      status: response.status,
      data,
      rawBody,
    };
  }
}

class BearerCommandClient {
  private readonly baseUrl: string;
  private readonly verbose: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly accessTokenProvider: () => string;

  constructor(
    options: {
      baseUrl: string;
      verbose: boolean;
      accessTokenProvider: () => string;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.baseUrl = options.baseUrl;
    this.verbose = options.verbose;
    this.accessTokenProvider = options.accessTokenProvider;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request({ method, path, queryParams, body }: RequestOptions): Promise<ApiResponse> {
    const url = new URL(path, this.baseUrl);
    if (queryParams) {
      const entries = Object.entries(queryParams).filter(([, value]) => value !== undefined);
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      for (const [key, value] of entries) {
        url.searchParams.append(key, String(value));
      }
    }

    const bodyString = body === undefined || body === null ? undefined : JSON.stringify(body);
    const token = this.accessTokenProvider();

    if (this.verbose) {
      console.log('----------------------------------------');
      console.log(`Command Request: ${method.toUpperCase()} ${url.toString()}`);
      console.log(`Authorization: Bearer ${shortToken(token)}`);
      if (bodyString) console.log(`Body: ${bodyString}`);
      console.log('----------------------------------------');
    }

    const response = await this.fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept-Encoding': 'gzip',
      },
      body: bodyString,
    });

    const rawBody = await decodeResponse(response);

    if (this.verbose) {
      console.log(`Response Status: ${response.status}`);
      console.log(`Response Body: ${rawBody}`);
      console.log('----------------------------------------');
    }

    return new ApiResponse(response.status, rawBody, response.headers);
  }

  get(path: string, queryParams?: QueryParams): Promise<ApiResponse> {
    return this.request({ method: 'GET', path, queryParams });
  }

  post(path: string, body?: unknown): Promise<ApiResponse> {
    return this.request({ method: 'POST', path, body });
  }

  put(path: string, body?: unknown): Promise<ApiResponse> {
    return this.request({ method: 'PUT', path, body });
  }

  delete(path: string, queryParams?: QueryParams): Promise<ApiResponse> {
    return this.request({ method: 'DELETE', path, queryParams });
  }
}

async function decodeResponse(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  const charsetMatch = contentType.match(/charset=([^;]+)/i);

  if (charsetMatch && charsetMatch[1]) {
    const decoder = new TextDecoder(charsetMatch[1].trim());
    const buffer = await response.arrayBuffer();
    return decoder.decode(buffer);
  }

  return response.text();
}

function assert2xx(result: HttpResult, context: string): void {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${context} failed: ${result.status} - ${result.rawBody}`);
  }
}

function extractNoteId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const map = payload as Record<string, unknown>;
  const fields = ['note_id', 'noteId', 'id'];
  for (const field of fields) {
    const value = map[field];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function extractRowId(payload: unknown): string | null {
  const queue: unknown[] = [payload];
  const visited = new Set<object>();
  const fields = ['row_id', 'rowId', 'id'];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;

    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const field of fields) {
      const value = record[field];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }

    const nestedCandidates = ['attributes', 'item', 'data', 'items', 'results', 'rows'];
    for (const key of nestedCandidates) {
      if (record[key] !== undefined) queue.push(record[key]);
    }
  }

  return null;
}

function extractArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const map = payload as Record<string, unknown>;
  const candidates = ['items', 'data', 'results', 'rows'];
  for (const key of candidates) {
    const value = map[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function extractBusinessId(record: Record<string, unknown>): string | null {
  const directId = record.id;
  if (typeof directId === 'string' && directId.length > 0) {
    return directId;
  }

  const attributes = normalizeRecord(record.attributes);
  const attributeId = attributes.id;
  if (typeof attributeId === 'string' && attributeId.length > 0) {
    return attributeId;
  }

  return null;
}

function extractRecordRowId(record: Record<string, unknown>): string | null {
  const directRowId = record.row_id ?? record.rowId;
  if (typeof directRowId === 'string' && directRowId.length > 0) {
    return directRowId;
  }
  return null;
}

function findEntityByIdentity(
  items: unknown[],
  businessId: string,
  rowId?: string,
): Record<string, unknown> | null {
  for (const item of items) {
    const record = normalizeRecord(item);
    const itemBusinessId = extractBusinessId(record);
    const itemRowId = extractRecordRowId(record);
    if (itemBusinessId === businessId) {
      return record;
    }
    if (rowId && itemRowId === rowId) {
      return record;
    }
  }
  return null;
}

function previewRecordIds(items: unknown[], limit = 5): string {
  return items
    .slice(0, limit)
    .map((item) => {
      const record = normalizeRecord(item);
      const rowId = extractRecordRowId(record);
      if (rowId) return rowId;
      const businessId = extractBusinessId(record);
      if (businessId) return businessId;
      return '(unknown)';
    })
    .join(', ');
}

function extractLogNoteId(record: Record<string, unknown>): string | null {
  const attributes = normalizeRecord(record.attributes);
  const data = normalizeRecord(record.data);
  const attributesData = normalizeRecord(attributes.data);
  const candidateContainers = [record, attributes, data, attributesData];
  const candidateKeys = ['noteId', 'note_id'];

  for (const container of candidateContainers) {
    for (const key of candidateKeys) {
      const value = container[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }

  return null;
}

function previewLogNoteFields(logItems: unknown[], limit = 5): string {
  return logItems
    .slice(0, limit)
    .map((item, index) => {
      const record = normalizeRecord(item);
      const rowId = extractRecordRowId(record) ?? '(no-row-id)';
      const attributes = normalizeRecord(record.attributes);
      const data = normalizeRecord(record.data);
      const extracted = extractLogNoteId(record) ?? '(none)';
      const top = typeof (record.noteId ?? record.note_id) === 'string'
        ? String(record.noteId ?? record.note_id)
        : '(none)';
      const attr = typeof (attributes.noteId ?? attributes.note_id) === 'string'
        ? String(attributes.noteId ?? attributes.note_id)
        : '(none)';
      const dataField = typeof (data.noteId ?? data.note_id) === 'string'
        ? String(data.noteId ?? data.note_id)
        : '(none)';
      return `#${index + 1}{row_id=${rowId},extracted=${extracted},top=${top},attributes=${attr},data=${dataField}}`;
    })
    .join(' | ');
}

function findLogForNote(logItems: unknown[], noteId: string): Record<string, unknown> | null {
  for (const item of logItems) {
    const record = normalizeRecord(item);
    const maybeNoteId = extractLogNoteId(record);
    if (maybeNoteId === noteId) {
      return record;
    }
  }
  return null;
}

function buildCreateNoteModels(visitId?: string): {
  models: Array<Record<string, unknown>>;
  modelId: string;
  resolvedVisitId: string;
} {
  const modelId = randomUUID();
  const resolvedVisitId = visitId ?? randomUUID();
  const noteTemplateFields: Record<string, string> = {
    noteId: '${note.note_id}',
    ownerId: '${note.owner_id}',
    summary: '${note.summary}',
    type: '${note.type}',
    data: '${note.data}',
    createdAt: '${note.created_at}',
    updatedAt: '${note.updated_at}',
  };

  return {
    modelId,
    resolvedVisitId,
    models: [
      {
        type: 'log',
        data: {
          id: modelId,
          visitId: resolvedVisitId,
          ...noteTemplateFields,
        },
      },
    ],
  };
}

function shortToken(token: string): string {
  if (token.length <= 16) return token;
  return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function refreshTokenPair(
  authClient: AuthServiceClient,
  accessToken: string,
  refreshToken: string,
  projectId?: string,
): Promise<{ access_token: string; refresh_token: string; expires_at?: number }> {
  const refreshOptions = projectId ? { project_id: projectId } : undefined;
  try {
    return await authClient.refreshWithAccessToken(accessToken, refreshToken, refreshOptions);
  } catch (err1) {
    try {
      return await authClient.refresh(refreshToken, accessToken, refreshOptions);
    } catch (err2) {
      throw new Error(
        `refresh token failed (refreshWithAccessToken + refresh both failed): ${String(err1)} | ${String(err2)}`,
      );
    }
  }
}

async function runE2E(options: E2EOptions): Promise<void> {
  if (options.authBaseUrl) {
    console.log(`[setup] auth base URL: ${options.authBaseUrl}`);
  } else {
    console.log('[setup] auth base URL: not provided (refresh/auth-health will be skipped)');
  }
  console.log(`[setup] api base URL: ${options.apiBaseUrl} (source: ${options.apiBaseUrlClaimKey})`);
  if (options.refreshToken) {
    if (options.projectId && options.projectIdSource) {
      console.log(`[setup] project_id: ${options.projectId} (source: ${options.projectIdSource})`);
    } else {
      console.log('[setup] project_id: not provided (refresh may return token without project_id claim)');
    }
  }
  console.log(
    `[setup] forma context: tenant_id=${options.tenantId}, owner_user_id=${options.ownerUserId}, property_id=${options.propertyId}`,
  );

  let dataApiAccessToken = options.accessToken;

  if (options.refreshToken) {
    if (!options.authBaseUrl) {
      throw new Error('auth base URL is required when refresh token is provided');
    }
    const authClient = new AuthServiceClient({
      baseUrl: options.authBaseUrl,
      verbose: options.verbose,
    });

    console.log('[1/7] refresh access token');
    const refreshed = await refreshTokenPair(
      authClient,
      options.accessToken,
      options.refreshToken,
      options.projectId,
    );
    const latestAccessToken = refreshed.access_token;
    const latestRefreshToken = refreshed.refresh_token || options.refreshToken;
    if (!latestAccessToken) {
      throw new Error('refresh response missing access_token');
    }
    const refreshedProjectIdClaim = extractProjectIdFromToken(latestAccessToken);
    const inputProjectIdClaim = extractProjectIdFromToken(options.accessToken);
    dataApiAccessToken = latestAccessToken;
    if (refreshedProjectIdClaim) {
      console.log(
        `  refreshed access token project_id: ${refreshedProjectIdClaim.projectId} (${refreshedProjectIdClaim.claimKey})`,
      );
    } else if (inputProjectIdClaim) {
      dataApiAccessToken = options.accessToken;
      console.warn(
        `  [warn] refreshed access token missing project_id claim; using input access token for data API calls (${inputProjectIdClaim.claimKey})`,
      );
    } else {
      throw new Error(
        'refreshed access token missing project_id claim. Pass --project-id (or LTBASE_PROJECT_ID) and ensure auth refresh returns project_id in JWT claims.',
      );
    }
    console.log(`  refreshed access token: ${shortToken(latestAccessToken)}`);
    console.log(`  refreshed refresh token: ${shortToken(latestRefreshToken)}`);
    console.log('  new token pair (for next run):');
    console.log(`  export LTBASE_ACCESS_TOKEN=${shellQuote(latestAccessToken)}`);
    console.log(`  export LTBASE_REFRESH_TOKEN=${shellQuote(latestRefreshToken)}`);

    console.log('[2/7] auth health check');
    await authClient.health(latestAccessToken);
    console.log('  refreshed access token health ok');
  } else {
    console.log('[1/7] refresh access token');
    console.log('  skip refresh: no refresh token provided, use input access token directly');
    console.log('[2/7] auth health check');
    console.log('  skip auth health: no refresh flow');
  }

  const api = new BearerApiClient(options.apiBaseUrl, options.verbose);
  const commandClient = new BearerCommandClient({
    baseUrl: options.apiBaseUrl,
    verbose: options.verbose,
    accessTokenProvider: () => dataApiAccessToken,
  });
  const commands = new CommandHandler(commandClient);
  let noteIdForCleanup: string | null = null;
  let leadRowIdForCleanup: string | null = null;
  let visitRowIdForCleanup: string | null = null;
  let logRowIdForCleanup: string | null = null;

  try {
    console.log('[3/7] create note');
    const notePreview = options.noteText.replace(/\s+/g, ' ').slice(0, 80);
    const noteSizeBytes = Buffer.byteLength(options.noteText, 'utf8');
    const modelDefinition = buildCreateNoteModels(options.visitId);
    console.log(`  request owner_id: ${options.ownerId}`);
    console.log('  request type: text/plain');
    console.log(`  request role: ${options.role}`);
    console.log(`  request note bytes: ${noteSizeBytes}`);
    console.log(`  request note preview: ${JSON.stringify(notePreview)}`);
    console.log(`  request models count: ${modelDefinition.models.length}`);
    console.log(`  request model id: ${modelDefinition.modelId}`);
    console.log(`  request model visitId: ${modelDefinition.resolvedVisitId}`);

    const createNoteStartedAt = Date.now();
    const createNoteResult = await commands.createNote({
      type: 'text/plain',
      data: options.noteText,
      role: options.role,
      models: modelDefinition.models,
    });
    const createNoteElapsedMs = Date.now() - createNoteStartedAt;
    console.log(`  create note elapsed: ${createNoteElapsedMs} ms`);

    const noteId = extractNoteId(createNoteResult);
    if (!noteId) {
      throw new Error(`create note response missing note_id: ${JSON.stringify(createNoteResult)}`);
    }
    const createNoteRecord = normalizeRecord(createNoteResult);
    const createdAt = createNoteRecord.created_at ?? createNoteRecord.createdAt;
    const updatedAt = createNoteRecord.updated_at ?? createNoteRecord.updatedAt;
    const summary = createNoteRecord.summary;
    if (typeof summary === 'string') {
      console.log(`  response summary: ${JSON.stringify(summary.slice(0, 120))}`);
    }
    if (typeof createdAt === 'number' || typeof createdAt === 'string') {
      console.log(`  response created_at: ${createdAt}`);
    }
    if (typeof updatedAt === 'number' || typeof updatedAt === 'string') {
      console.log(`  response updated_at: ${updatedAt}`);
    }
    noteIdForCleanup = noteId;
    console.log(`  created note_id: ${noteId}`);

    console.log('[4/7] list notes');
    const listNotesResult = await commands.listNotes({
      schemaName: 'log',
      page: 1,
      itemsPerPage: 20,
    });
    const noteItems = extractArray(listNotesResult);
    const noteExists = noteItems.some((item) => {
      const record = normalizeRecord(item);
      return (record.note_id === noteId || record.noteId === noteId);
    });
    if (!noteExists) {
      throw new Error('created note was not found in list notes response');
    }
    console.log(`  list notes ok: ${noteItems.length} item(s)`);

    console.log('[5/7] list logs and match noteId');
    let matchedLog: Record<string, unknown> | null = null;
    for (let i = 1; i <= options.logPollAttempts; i += 1) {
      let listLogsResult: unknown;
      try {
        listLogsResult = await commands.listLogs({
          ownerId: options.ownerId,
          page: 1,
          itemsPerPage: 20,
        });
      } catch (err) {
        const errMsg = (err as Error).message;
        const canRetryWithInputToken =
          options.accessToken !== dataApiAccessToken && /(^|[^0-9])401([^0-9]|$)/.test(errMsg);
        if (!canRetryWithInputToken) {
          throw new Error(`list logs failed: ${errMsg}`);
        }

        console.warn(
          `  [warn] list logs unauthorized with token ${shortToken(dataApiAccessToken)}; retrying with input access token`,
        );
        dataApiAccessToken = options.accessToken;
        console.log(`  switched data API token for logs: ${shortToken(dataApiAccessToken)}`);
        listLogsResult = await commands.listLogs({
          ownerId: options.ownerId,
          page: 1,
          itemsPerPage: 20,
        });
      }

      const logs = extractArray(listLogsResult);
      const noteIdPreview = previewLogNoteFields(logs, 5);
      console.log(
        `  logs poll ${i}/${options.logPollAttempts}: count=${logs.length}, target_note_id=${noteId}, first_note_fields=[${noteIdPreview}]`,
      );
      const logsPayloadJson = JSON.stringify(listLogsResult, null, 2);
      console.log('  logs poll raw response JSON:');
      console.log(logsPayloadJson ?? String(listLogsResult));

      matchedLog = findLogForNote(logs, noteId);
      if (matchedLog) {
        console.log('  matched log JSON:');
        console.log(JSON.stringify(matchedLog, null, 2));
        break;
      }

      if (i < options.logPollAttempts) {
        await sleep(options.logPollIntervalMs);
      }
    }

    if (!matchedLog) {
      throw new Error(`log entry for note_id=${noteId} not found after ${options.logPollAttempts} attempts`);
    }
    const matchedLogId = typeof matchedLog.id === 'string' ? matchedLog.id : '(unknown)';
    console.log(`  matched log id: ${matchedLogId}`);

    console.log('[6/7] forma CRUD (lead/visit/log)');
    const nowIso = new Date().toISOString();
    const leadId = randomUUID();
    const phoneDigits = `${Date.now()}`.slice(-8).padStart(8, '0');
    const leadName = `E2E Lead ${leadId.slice(0, 8)}`;
    const leadPhone = `070${phoneDigits}`;
    const leadPreviewPayload = [
      {
        id: leadId,
        tenantId: options.tenantId,
        ownerUserId: options.ownerUserId,
        createdAt: nowIso,
        updatedAt: nowIso,
        pipeline: 'buy',
        stage: 'new',
        status: 'open',
        source: { channel: 'other' },
        contact: {
          isAnonymous: false,
          name: leadName,
          nameNative: leadName,
          primaryPhone: leadPhone,
          phones: [leadPhone],
        },
        requirement: {},
      },
    ];
    console.log('  lead create request: POST /api/v1/lead');
    console.log(`  lead create body: ${JSON.stringify(leadPreviewPayload)}`);
    const createLeadResult = await commands.createLead({
      id: leadId,
      tenantId: options.tenantId,
      ownerUserId: options.ownerUserId,
      pipeline: 'buy',
      stage: 'new',
      status: 'open',
      name: leadName,
      phone: leadPhone,
      sourceChannel: 'other',
    });
    const leadRowId = extractRowId(createLeadResult) ?? leadId;
    leadRowIdForCleanup = leadRowId;
    console.log(`  lead created: id=${leadId}, row_id=${leadRowId}`);

    const listLeadsResult = await commands.listLeads({
      leadId,
      page: 1,
      itemsPerPage: 20,
    });
    const leadItems = extractArray(listLeadsResult);
    const leadPreview = previewRecordIds(leadItems);
    console.log(`  lead list: count=${leadItems.length}, first_ids=[${leadPreview}]`);
    const listedLead = findEntityByIdentity(leadItems, leadId, leadRowId);
    if (!listedLead) {
      throw new Error(`created lead not found in list response: lead_id=${leadId}, row_id=${leadRowId}`);
    }

    const getLeadResult = await commands.getLead(leadRowId);
    const gotLeadRowId = extractRowId(getLeadResult);
    if (!gotLeadRowId) {
      throw new Error('get lead response missing row_id');
    }

    const updateLeadResult = await api.request({
      method: 'PUT',
      path: `/api/v1/lead/${encodeURIComponent(leadRowId)}`,
      bearerToken: dataApiAccessToken,
      body: {
        stage: 'contacted',
        updatedAt: new Date().toISOString(),
      },
    });
    assert2xx(updateLeadResult, 'update lead');
    console.log('  lead update ok');

    const visitEntityId = options.visitId ?? randomUUID();
    const visitEndAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const visitPreviewPayload = [
      {
        id: visitEntityId,
        leadId,
        userId: options.ownerUserId,
        propertyId: options.propertyId,
        scheduledStartAt: nowIso,
        scheduledEndAt: visitEndAt,
        status: 'scheduled',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];
    console.log('  visit create request: POST /api/v1/visit');
    console.log(`  visit create body: ${JSON.stringify(visitPreviewPayload)}`);
    const createVisitResult = await commands.createVisit({
      id: visitEntityId,
      leadId,
      userId: options.ownerUserId,
      propertyId: options.propertyId,
      scheduledStartAt: nowIso,
      scheduledEndAt: visitEndAt,
      status: 'scheduled',
    });
    const visitRowId = extractRowId(createVisitResult) ?? visitEntityId;
    visitRowIdForCleanup = visitRowId;
    console.log(`  visit created: id=${visitEntityId}, row_id=${visitRowId}`);

    const listVisitsResult = await commands.listVisits({
      leadId,
      page: 1,
      itemsPerPage: 20,
    });
    const visitItems = extractArray(listVisitsResult);
    const visitPreview = previewRecordIds(visitItems);
    console.log(`  visit list: count=${visitItems.length}, first_ids=[${visitPreview}]`);
    const listedVisit = findEntityByIdentity(visitItems, visitEntityId, visitRowId);
    if (!listedVisit) {
      throw new Error(`created visit not found in list response: visit_id=${visitEntityId}, row_id=${visitRowId}`);
    }

    const getVisitResult = await api.request({
      method: 'GET',
      path: `/api/v1/visit/${encodeURIComponent(visitRowId)}`,
      bearerToken: dataApiAccessToken,
    });
    assert2xx(getVisitResult, 'get visit');
    const gotVisitRowId = extractRowId(getVisitResult.data);
    if (!gotVisitRowId) {
      throw new Error('get visit response missing row_id');
    }

    const updateVisitResult = await api.request({
      method: 'PUT',
      path: `/api/v1/visit/${encodeURIComponent(visitRowId)}`,
      bearerToken: dataApiAccessToken,
      body: {
        status: 'visited',
        feedback: `e2e visit updated ${new Date().toISOString()}`,
        updatedAt: new Date().toISOString(),
      },
    });
    assert2xx(updateVisitResult, 'update visit');
    console.log('  visit update ok');

    const manualLogId = randomUUID();
    const logPayload = [
      {
        id: manualLogId,
        ownerId: options.ownerId,
        leadId,
        visitId: visitEntityId,
        noteId,
        summary: `e2e manual log ${manualLogId.slice(0, 8)}`,
        type: 'text/plain',
        data: options.noteText,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];
    console.log(`  log create request: POST /api/v1/log (items=${logPayload.length})`);
    console.log(`  log create body: ${JSON.stringify(logPayload)}`);
    const createLogResult = await api.request({
      method: 'POST',
      path: '/api/v1/log',
      bearerToken: dataApiAccessToken,
      body: logPayload,
    });
    assert2xx(createLogResult, 'create log');
    const logRowId = extractRowId(createLogResult.data) ?? manualLogId;
    logRowIdForCleanup = logRowId;
    console.log(`  log created: id=${manualLogId}, row_id=${logRowId}`);

    const listManualLogsResult = await commands.listLogs({
      logId: `equals:${manualLogId}`,
      ownerId: options.ownerId,
      page: 1,
      itemsPerPage: 20,
    });
    const manualLogItems = extractArray(listManualLogsResult);
    const manualLogPreview = previewRecordIds(manualLogItems);
    console.log(`  log list: count=${manualLogItems.length}, first_ids=[${manualLogPreview}]`);
    const listedManualLog = findEntityByIdentity(manualLogItems, manualLogId, logRowId);
    if (!listedManualLog) {
      throw new Error(`created log not found in list response: log_id=${manualLogId}, row_id=${logRowId}`);
    }

    const getLogResult = await api.request({
      method: 'GET',
      path: `/api/v1/log/${encodeURIComponent(logRowId)}`,
      bearerToken: dataApiAccessToken,
    });
    assert2xx(getLogResult, 'get log');
    const gotLogRowId = extractRowId(getLogResult.data);
    if (!gotLogRowId) {
      throw new Error('get log response missing row_id');
    }

    const updateLogResult = await api.request({
      method: 'PUT',
      path: `/api/v1/log/${encodeURIComponent(logRowId)}`,
      bearerToken: dataApiAccessToken,
      body: {
        summary: `e2e manual log updated ${new Date().toISOString()}`,
        updatedAt: new Date().toISOString(),
      },
    });
    assert2xx(updateLogResult, 'update log');
    console.log('  log update ok');

    const deleteLogResult = await api.request({
      method: 'DELETE',
      path: `/api/v1/log/${encodeURIComponent(logRowId)}`,
      bearerToken: dataApiAccessToken,
    });
    assert2xx(deleteLogResult, 'delete log');
    logRowIdForCleanup = null;
    console.log('  log delete ok');

    await commands.deleteVisit(visitRowId);
    visitRowIdForCleanup = null;
    console.log('  visit delete ok');

    const deleteLeadResult = await api.request({
      method: 'DELETE',
      path: `/api/v1/lead/${encodeURIComponent(leadRowId)}`,
      bearerToken: dataApiAccessToken,
    });
    assert2xx(deleteLeadResult, 'delete lead');
    leadRowIdForCleanup = null;
    console.log('  lead delete ok');

    if (options.keepNote) {
      console.log('[7/7] cleanup skipped because --keep-note is set');
    } else {
      console.log('[7/7] delete note');
      await commands.deleteNote(noteId);
      noteIdForCleanup = null;
      console.log('  cleanup done');
    }

    console.log('');
    console.log('E2E success');
  } catch (err) {
    if (logRowIdForCleanup) {
      console.log(`[cleanup] attempt delete log after failure: ${logRowIdForCleanup}`);
      try {
        const cleanupLogResult = await api.request({
          method: 'DELETE',
          path: `/api/v1/log/${encodeURIComponent(logRowIdForCleanup)}`,
          bearerToken: dataApiAccessToken,
        });
        assert2xx(cleanupLogResult, 'cleanup delete log');
        logRowIdForCleanup = null;
        console.log('[cleanup] log done');
      } catch (cleanupErr) {
        console.error(`[cleanup] failed deleting log: ${(cleanupErr as Error).message}`);
      }
    }

    if (visitRowIdForCleanup) {
      console.log(`[cleanup] attempt delete visit after failure: ${visitRowIdForCleanup}`);
      try {
        await commands.deleteVisit(visitRowIdForCleanup);
        visitRowIdForCleanup = null;
        console.log('[cleanup] visit done');
      } catch (cleanupErr) {
        console.error(`[cleanup] failed deleting visit: ${(cleanupErr as Error).message}`);
      }
    }

    if (leadRowIdForCleanup) {
      console.log(`[cleanup] attempt delete lead after failure: ${leadRowIdForCleanup}`);
      try {
        const cleanupLeadResult = await api.request({
          method: 'DELETE',
          path: `/api/v1/lead/${encodeURIComponent(leadRowIdForCleanup)}`,
          bearerToken: dataApiAccessToken,
        });
        assert2xx(cleanupLeadResult, 'cleanup delete lead');
        leadRowIdForCleanup = null;
        console.log('[cleanup] lead done');
      } catch (cleanupErr) {
        console.error(`[cleanup] failed deleting lead: ${(cleanupErr as Error).message}`);
      }
    }

    if (!options.keepNote && noteIdForCleanup) {
      console.log(`[cleanup] attempt delete note after failure: ${noteIdForCleanup}`);
      try {
        await commands.deleteNote(noteIdForCleanup);
        console.log('[cleanup] done');
      } catch (cleanupErr) {
        console.error(`[cleanup] failed: ${(cleanupErr as Error).message}`);
      }
    }
    throw err;
  }
}

async function main(): Promise<void> {
  try {
    const { params } = parseArgs(process.argv);
    if (params.help === true) {
      printUsage();
      return;
    }

    const options = buildOptions(params);
    await runE2E(options);
  } catch (err) {
    console.error(`E2E failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

void main();
