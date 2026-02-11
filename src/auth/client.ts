export interface AuthTokenPairResponse {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

export interface AuthLoginRequest {
  project_id: string;
  [key: string]: unknown;
}

export interface AuthBindContext {
  code: string;
  project_id: string;
  [key: string]: unknown;
}

export interface AuthBindRequest {
  bind_context: AuthBindContext;
}

export type AuthBindResponse = AuthTokenPairResponse;

export interface AuthRevokeResponse {
  status: string;
}

export interface AuthHealthResponse {
  status: string;
}

export interface AuthServiceClientOptions {
  baseUrl: string;
  verbose?: boolean;
  fetchImpl?: typeof fetch;
  loginPathTemplate?: string;
  bindingPathTemplate?: string;
}

export class AuthServiceClient {
  private static readonly DEFAULT_LOGIN_PATH_TEMPLATE = '/api/v1/login/{provider}';
  private static readonly DEFAULT_BINDING_PATH_TEMPLATE = '/api/v1/id_bindings/{provider}';

  readonly baseUrl: string;
  readonly verbose: boolean;
  private readonly fetchImpl: typeof fetch;
  readonly loginPathTemplate: string;
  readonly bindingPathTemplate: string;

  constructor(options: AuthServiceClientOptions) {
    this.baseUrl = options.baseUrl;
    this.verbose = options.verbose ?? false;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.loginPathTemplate =
      options.loginPathTemplate ?? AuthServiceClient.DEFAULT_LOGIN_PATH_TEMPLATE;
    this.bindingPathTemplate =
      options.bindingPathTemplate ?? AuthServiceClient.DEFAULT_BINDING_PATH_TEMPLATE;
  }

  async health(bearerToken: string): Promise<AuthHealthResponse> {
    return this.requestJson<AuthHealthResponse>({
      method: 'GET',
      path: '/auth/health',
      bearerToken,
    });
  }

  async jwks(): Promise<unknown> {
    return this.requestJson<unknown>({
      method: 'GET',
      path: '/auth/jwks.json',
    });
  }

  async login(
    provider: string,
    idToken: string,
    body: AuthLoginRequest,
  ): Promise<AuthTokenPairResponse> {
    return this.requestJson<AuthTokenPairResponse>({
      method: 'POST',
      path: this.renderProviderPath(this.loginPathTemplate, provider),
      bearerToken: idToken,
      body,
    });
  }

  async bind(
    provider: string,
    body: AuthBindRequest,
    idToken: string,
  ): Promise<AuthBindResponse> {
    return this.requestJson<AuthBindResponse>({
      method: 'POST',
      path: this.renderProviderPath(this.bindingPathTemplate, provider),
      bearerToken: idToken,
      body,
    });
  }

  /**
   * @deprecated Use login(provider, idToken, body) instead.
   */
  async exchange(
    provider: string,
    idToken: string,
    body: AuthLoginRequest,
  ): Promise<AuthTokenPairResponse> {
    return this.login(provider, idToken, body);
  }

  /**
   * @deprecated Use bind(provider, body, idToken) instead.
   */
  async provision(provider: string, body: AuthBindRequest, idToken: string): Promise<AuthBindResponse> {
    return this.bind(provider, body, idToken);
  }

  async refresh(refreshToken: string, bearerToken: string): Promise<AuthTokenPairResponse> {
    return this.requestJson<AuthTokenPairResponse>({
      method: 'POST',
      path: '/auth/refresh',
      bearerToken,
      body: { refresh_token: refreshToken },
    });
  }

  async revoke(jti: string, bearerToken: string, reason?: string): Promise<AuthRevokeResponse> {
    return this.requestJson<AuthRevokeResponse>({
      method: 'POST',
      path: '/auth/revoke',
      bearerToken,
      body: reason ? { jti, reason } : { jti },
    });
  }

  private async requestJson<T>(options: {
    method: string;
    path: string;
    bearerToken?: string;
    body?: unknown;
  }): Promise<T> {
    const { method, path, bearerToken, body } = options;
    const url = new URL(path, this.baseUrl);
    const bodyString = body === undefined ? undefined : JSON.stringify(body);

    if (this.verbose) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Auth Request: ${method.toUpperCase()} ${url.toString()}`);
      if (bearerToken) console.log('Authorization: Bearer ***');
      if (bodyString) console.log(`Body: ${bodyString}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=UTF-8',
      'Accept-Encoding': 'gzip',
    };
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    const response = await this.fetchImpl(url.toString(), {
      method,
      headers,
      body: bodyString,
    });

    const responseBody = await this.decodeResponse(response);

    if (this.verbose) {
      console.log(`Response Status: ${response.status}`);
      console.log(`Response Body: ${responseBody}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`AuthService request failed: ${response.status} - ${responseBody}`);
    }

    try {
      return JSON.parse(responseBody) as T;
    } catch (err) {
      throw new Error(`Invalid JSON response: ${(err as Error).message}`);
    }
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

  private renderProviderPath(pathTemplate: string, provider: string): string {
    if (!pathTemplate.includes('{provider}')) {
      throw new Error(`Invalid path template: "${pathTemplate}". It must include "{provider}".`);
    }
    return pathTemplate.replace('{provider}', encodeURIComponent(provider));
  }
}
