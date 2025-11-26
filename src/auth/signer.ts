import { createHash, createPrivateKey, randomBytes, sign as nodeSign } from 'node:crypto';

export interface GenerateAuthHeaderParams {
  method: string;
  url: string;
  queryString: string;
  body: string;
}

export class AuthSigner {
  readonly accessKeyId: string;
  readonly accessSecret: string;

  constructor(params: { accessKeyId: string; accessSecret: string }) {
    this.accessKeyId = params.accessKeyId;
    this.accessSecret = params.accessSecret;
  }

  async generateAuthorizationHeader({
    method,
    url,
    queryString,
    body,
  }: GenerateAuthHeaderParams): Promise<string> {
    const timestamp = Date.now();
    const nonce = this.generateNonce();
    const signingString = this.constructSigningString({
      method,
      url,
      queryString,
      body,
      timestamp,
      nonce,
    });
    const signature = this.sign(signingString);
    return `LtBase ${this.accessKeyId}:${signature}:${timestamp}:${nonce}`;
  }

  private constructSigningString({
    method,
    url,
    queryString,
    body,
    timestamp,
    nonce,
  }: GenerateAuthHeaderParams & { timestamp: number; nonce: string }): string {
    let cleanUrl = url;
    while (cleanUrl.endsWith('/') || cleanUrl.endsWith('?')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }

    const bodyHash = createHash('sha256').update(body).digest('hex');
    return [
      method.toUpperCase(),
      cleanUrl,
      queryString,
      bodyHash,
      timestamp.toString(),
      nonce,
    ].join('\n');
  }

  private sign(signingString: string): string {
    if (!this.accessSecret.startsWith('SK_')) {
      throw new Error('Invalid access secret format. Must start with SK_');
    }

    const secretKeyBase64Url = this.accessSecret.slice(3);
    const secretKeyDer = base64UrlToBuffer(secretKeyBase64Url);
    const privateKey = createPrivateKey({
      key: secretKeyDer,
      format: 'der',
      type: 'pkcs8',
    });

    const signature = nodeSign(null, Buffer.from(signingString, 'utf8'), privateKey);
    return toBase64Url(signature);
  }

  private generateNonce(): string {
    return toBase64Url(randomBytes(16));
  }
}

export function base64UrlToBuffer(value: string): Buffer {
  const padding = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + padding;
  return Buffer.from(base64, 'base64');
}

export function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
