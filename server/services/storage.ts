import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB

function getSigningSecret(): string {
  return (
    process.env.APP_ENCRYPTION_KEY?.trim() ||
    process.env.S3_SECRET_KEY?.trim() ||
    'meridian-dev-storage-signing-secret'
  );
}

export function getPrivateStorageRoot(): string {
  return path.resolve(process.env.PRIVATE_STORAGE_DIR || './data/private-storage');
}

export function validateUploadMetadata(
  filename: string,
  mimeType: string,
  byteSize: number,
): { valid: true } | { valid: false; error: string } {
  if (!filename.trim()) {
    return { valid: false, error: 'Filename is required' };
  }
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(mimeType as (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number])) {
    return {
      valid: false,
      error: 'Unsupported file type. Allowed types: PDF, JPG, PNG, and DOCX.',
    };
  }
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    return { valid: false, error: 'File must not be empty' };
  }
  if (byteSize > MAX_DOCUMENT_BYTES) {
    return { valid: false, error: 'File exceeds the 10 MB maximum upload limit' };
  }
  return { valid: true };
}

export function validateFileMagicBytes(
  mimeType: string,
  buffer: Buffer,
): { valid: true } | { valid: false; error: string } {
  if (buffer.length < 4) {
    return { valid: false, error: 'File content is corrupted or too small' };
  }
  if (mimeType === 'application/pdf') {
    const header = buffer.subarray(0, 5).toString('ascii');
    if (!header.startsWith('%PDF-')) {
      return { valid: false, error: 'File content does not match PDF signature (%PDF-)' };
    }
  } else if (mimeType === 'image/jpeg') {
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      return { valid: false, error: 'File content does not match JPEG signature' };
    }
  } else if (mimeType === 'image/png') {
    if (
      buffer[0] !== 0x89 ||
      buffer[1] !== 0x50 ||
      buffer[2] !== 0x4e ||
      buffer[3] !== 0x47
    ) {
      return { valid: false, error: 'File content does not match PNG signature' };
    }
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      return { valid: false, error: 'File content does not match DOCX archive signature' };
    }
  }
  return { valid: true };
}

const EICAR_TEST_SIGNATURE =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export function scanBufferForMalware(buffer: Buffer): {
  clean: boolean;
  engine: string;
  threat?: string;
} {
  const sampleText = buffer.subarray(0, Math.min(buffer.length, 65536)).toString('utf8');
  if (sampleText.includes(EICAR_TEST_SIGNATURE)) {
    return { clean: false, engine: 'builtin-signature-scanner', threat: 'EICAR-Test-File' };
  }
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return { clean: false, engine: 'builtin-signature-scanner', threat: 'Executable-MZ-Header' };
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    return { clean: false, engine: 'builtin-signature-scanner', threat: 'Executable-ELF-Header' };
  }
  return { clean: true, engine: 'builtin-signature-scanner' };
}

export function isS3Configured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT?.trim() &&
      process.env.S3_BUCKET?.trim() &&
      process.env.S3_ACCESS_KEY?.trim() &&
      process.env.S3_SECRET_KEY?.trim(),
  );
}

export function getStorageConfig() {
  if (isS3Configured()) {
    return {
      provider: 'S3_COMPATIBLE',
      bucket: process.env.S3_BUCKET!.trim(),
    };
  }
  return {
    provider: 'PRIVATE_LOCAL',
    bucket: 'meridian-private-local',
  };
}

export function buildStorageKey(
  organizationId: string,
  applicationId: string,
  documentId: string,
  version: number,
  originalFilename: string,
): string {
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return `${organizationId}/${applicationId}/${documentId}-v${version}-${safeName}`;
}

export function putPrivateObject(storageKey: string, buffer: Buffer): string {
  const root = getPrivateStorageRoot();
  const fullPath = path.resolve(root, storageKey);
  if (!fullPath.startsWith(root)) {
    throw new Error('Invalid storage key path');
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function getPrivateObject(storageKey: string): Buffer | null {
  const root = getPrivateStorageRoot();
  const fullPath = path.resolve(root, storageKey);
  if (!fullPath.startsWith(root) || !fs.existsSync(fullPath)) {
    return null;
  }
  return fs.readFileSync(fullPath);
}

export function signStorageToken(params: {
  documentId: string;
  organizationId: string;
  action: 'UPLOAD' | 'DOWNLOAD';
  expiresAtMs: number;
}): string {
  const payload = `${params.action}:${params.organizationId}:${params.documentId}:${params.expiresAtMs}`;
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('hex');
}

export function verifyStorageToken(params: {
  documentId: string;
  organizationId: string;
  action: 'UPLOAD' | 'DOWNLOAD';
  expiresAtMs: number;
  signature: string;
}): boolean {
  if (!Number.isFinite(params.expiresAtMs) || Date.now() > params.expiresAtMs) {
    return false;
  }
  const expected = signStorageToken({
    documentId: params.documentId,
    organizationId: params.organizationId,
    action: params.action,
    expiresAtMs: params.expiresAtMs,
  });
  const a = Buffer.from(expected);
  const b = Buffer.from(params.signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

export function createS3PresignedUrl(params: {
  method: 'PUT' | 'GET';
  storageKey: string;
  expiresInSeconds?: number;
}): string {
  const endpoint = process.env.S3_ENDPOINT!.replace(/\/$/, '');
  const bucket = process.env.S3_BUCKET!.trim();
  const region = (process.env.S3_REGION || 'us-east-1').trim();
  const accessKey = process.env.S3_ACCESS_KEY!.trim();
  const secretKey = process.env.S3_SECRET_KEY!.trim();
  const expires = params.expiresInSeconds || 300;

  const url = new URL(`${endpoint}/${bucket}/${params.storageKey}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${accessKey}/${credentialScope}`);
  url.searchParams.set('X-Amz-Date', amzDate);
  url.searchParams.set('X-Amz-Expires', String(expires));
  url.searchParams.set('X-Amz-SignedHeaders', 'host');

  const sortedQuery = Array.from(url.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    params.method,
    url.pathname,
    sortedQuery,
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');

  url.searchParams.set('X-Amz-Signature', signature);
  return url.toString();
}
