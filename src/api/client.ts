import { AuthSigner } from '../auth/signer';

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  method: string;
  path: string;
  queryParams?: QueryParams;
  body?: unknown;
}

export class ApiResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Headers;

  constructor(status: number, body: string, headers: Headers) {
    this.status = status;
    this.body = body;
    this.headers = headers;
  }

  get isSuccess(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  json<T = unknown>(): T | null {
    try {
      return JSON.parse(this.body) as T;
    } catch {
      return null;
    }
  }

  toString(): string {
    return `ApiResponse(status: ${this.status}, body: ${this.body})`;
  }
}

export class ApiClient {
  readonly baseUrl: string;
  readonly signer: AuthSigner;
  readonly verbose: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { baseUrl: string; signer: AuthSigner; verbose?: boolean; fetchImpl?: typeof fetch }) {
    this.baseUrl = options.baseUrl;
    this.signer = options.signer;
    this.verbose = options.verbose ?? false;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request({ method, path, queryParams, body }: RequestOptions): Promise<ApiResponse> {
    const url = new URL(path, this.baseUrl);
    const sortedQueryString = this.buildQueryString(queryParams);
    if (sortedQueryString) {
      url.search = sortedQueryString;
    }

    const urlWithoutQuery = `${url.origin}${url.pathname}`;
    const bodyString = body === undefined || body === null ? '' : JSON.stringify(body);

    const authHeader = await this.signer.generateAuthorizationHeader({
      method,
      url: urlWithoutQuery,
      queryString: sortedQueryString,
      body: bodyString,
    });

    if (this.verbose) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Request: ${method.toUpperCase()} ${url.toString()}`);
      console.log(`Authorization: ${authHeader}`);
      if (urlWithoutQuery) console.log(`URL: ${urlWithoutQuery}`);
      if (bodyString) console.log(`Body: ${bodyString}`);
      if (sortedQueryString) console.log(`Query: ${sortedQueryString}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    const response = await this.fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept-Encoding': 'gzip',
      },
      body: bodyString || undefined,
    });

    const responseBody = await this.decodeResponse(response);

    if (this.verbose) {
      console.log(`Response Status: ${response.status}`);
      console.log(`Response Body: ${responseBody}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    return new ApiResponse(response.status, responseBody, response.headers);
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

  delete(path: string): Promise<ApiResponse> {
    return this.request({ method: 'DELETE', path });
  }

  private buildQueryString(params?: QueryParams): string {
    if (!params) return '';
    const entries = Object.entries(params).filter(([, value]) => value !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    const searchParams = new URLSearchParams();
    for (const [key, value] of entries) {
      searchParams.append(key, String(value));
    }
    return searchParams.toString();
  }

  private async decodeResponse(response: Response): Promise<string> {
    const contentType = response.headers.get('content-type') ?? '';
    const charsetMatch = contentType.match(/charset=([^;]+)/i);

    if (charsetMatch && charsetMatch[1]) {
      const decoder = new TextDecoder(charsetMatch[1].trim());
      const buffer = await response.arrayBuffer();
      return decoder.decode(buffer);
    }

    return response.text();
  }
}
