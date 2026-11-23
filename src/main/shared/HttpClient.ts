import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import type { IncomingHttpHeaders, IncomingMessage } from 'http';
import { fsyncFile } from './AtomicWrite.ts';
import { KARAMON } from './KaramonProfile.ts';

const REDIRECT_STATUS = new Set([301, 302, 307, 308]);
const MAX_REDIRECTS = 10;
const RANGED_DOWNLOAD_MIN_BYTES = 8 * 1024 * 1024;
const RANGED_DOWNLOAD_PARTS = 8;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const HEAD_IDLE_TIMEOUT_MS = 10_000;
const POST_IDLE_TIMEOUT_MS = 20_000;
const DOWNLOAD_RESPONSE_TIMEOUT_MS = 60_000;
const NETWORK_ATTEMPTS = 3;

const AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: 16,
  family: 4,
});

function launcherUserAgent(appVersion: string): string {
  return `${KARAMON.launcherName}/${appVersion}`;
}

export interface HttpClientOptions {
  appVersion?: string;
}

export interface HttpResponse {
  status: number;
  body: Buffer;
}

export function isSuccess(res: HttpResponse): boolean {
  return res.status >= 200 && res.status < 300;
}

export function jsonBody<T>(res: HttpResponse, fallback: T): T {
  try {
    return JSON.parse(res.body.toString('utf8')) as T;
  } catch {
    return fallback;
  }
}

export interface Deadlines {
  idleTimeoutMs?: number;
  responseTimeoutMs?: number;
  totalTimeoutMs?: number;
}

export interface RequestOptions extends Deadlines {
  headers?: Record<string, string>;
}

export interface GetOptions extends RequestOptions {
  timeoutMs?: number;
}

export interface DownloadOptions extends Deadlines {
  expectedSha1?: string;
  expectedSha256?: string;
  label?: string;
  onProgress?: (fraction: number) => void;
  timeoutMs?: number;
}

export interface RangeRequest {
  start: number;
  end?: number;
  ifRange?: string;
}

export interface RangeResponse {
  stream: IncomingMessage;
  start: number;
  end: number;
  total: number;
  etag: string;
}

export interface RangeBuffer {
  body: Buffer;
  start: number;
  total: number;
  etag: string;
}

export class InsecureUrlError extends Error {
  constructor(url: string) {
    super('URL non sécurisée refusée (HTTPS requis): ' + (url || '(vide)'));
    this.name = 'InsecureUrlError';
  }
}

export class TooManyRedirectsError extends Error {
  constructor(url: string) {
    super('Trop de redirections: ' + url);
    this.name = 'TooManyRedirectsError';
  }
}

export class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} pour ${url}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

export type DeadlineKind = 'idle' | 'response' | 'total';

export class TimeoutError extends Error {
  readonly kind: DeadlineKind;
  constructor(kind: DeadlineKind, ms: number, url: string) {
    const seconds = Math.round(ms / 1000);
    const what = kind === 'total' ? 'Délai total dépassé' : kind === 'response' ? 'Le serveur ne répond pas' : 'Plus aucune donnée reçue';
    super(`${what} (${seconds} s): ${url}`);
    this.name = 'TimeoutError';
    this.kind = kind;
  }
}

export class IncompleteDownloadError extends Error {
  constructor(label: string, received: number, expected: number) {
    super(`Téléchargement incomplet ${label}: ${received}/${expected} octets`);
    this.name = 'IncompleteDownloadError';
  }
}

export class DigestMismatchError extends Error {
  constructor(algorithm: DigestAlgorithm, label: string, expected: string, actual: string) {
    super(`${algorithm.toUpperCase()} mismatch for ${label}: expected ${expected}, got ${actual}`);
    this.name = 'DigestMismatchError';
  }
}

export class RangeUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RangeUnsupportedError';
  }
}

export class ResourceChangedError extends RangeUnsupportedError {
  constructor(label: string) {
    super(`${label} a changé sur le serveur pendant le téléchargement. Relance la synchronisation.`);
    this.name = 'ResourceChangedError';
  }
}

function isWorthRetrying(error: unknown): boolean {
  if (error instanceof RangeUnsupportedError) return false;
  if (error instanceof InsecureUrlError || error instanceof TooManyRedirectsError) return false;
  if (error instanceof DigestMismatchError) return false;
  if (error instanceof HttpStatusError) return error.status === 408 || error.status === 429 || error.status >= 500;
  return true;
}

export async function withNetworkRetries<T>(run: () => Promise<T>, onFailedAttempt?: () => void): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= NETWORK_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (e) {
      lastError = e;
      onFailedAttempt?.();
      if (!isWorthRetrying(e)) throw e;
    }
  }
  throw lastError;
}

type DigestAlgorithm = 'sha1' | 'sha256';

async function fileDigest(filePath: string, algorithm: DigestAlgorithm): Promise<string> {
  const hash = crypto.createHash(algorithm);
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function hasDigest(filePath: string, algorithm: DigestAlgorithm, expected: string): Promise<boolean> {
  try {
    return (await fileDigest(filePath, algorithm)) === expected.toLowerCase();
  } catch {
    return false;
  }
}

function headerValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? '';
  return typeof raw === 'string' ? raw : '';
}

function contentRange(headers: IncomingHttpHeaders): { start: number; end: number; total: number } | null {
  const match = headerValue(headers['content-range']).match(/^bytes (\d+)-(\d+)\/(\d+)\s*$/);
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

function isStrongEtag(etag: string): boolean {
  return etag.length > 0 && !etag.startsWith('W/');
}

function byteRanges(size: number, parts: number): { start: number; end: number }[] {
  const count = Math.max(1, Math.min(parts, size));
  const chunk = Math.floor(size / count);
  return Array.from({ length: count }, (_, i) => ({
    start: i * chunk,
    end: i === count - 1 ? size - 1 : (i + 1) * chunk - 1,
  }));
}

function assertHttps(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InsecureUrlError(url);
  }
  if (parsed.protocol !== 'https:') throw new InsecureUrlError(url);
}

class Watchdog {
  private idleTimer: NodeJS.Timeout | null = null;
  private totalTimer: NodeJS.Timeout | null = null;
  private onExpire: (error: TimeoutError) => void = () => {};
  private readonly idleMs: number;
  private readonly url: string;

  constructor(url: string, deadlines: Deadlines, fallbackIdleMs: number) {
    this.url = url;
    this.idleMs = deadlines.idleTimeoutMs ?? fallbackIdleMs;
    const responseMs = deadlines.responseTimeoutMs ?? this.idleMs;
    this.idleTimer = setTimeout(() => this.expire(new TimeoutError('response', responseMs, url)), responseMs);
    if (deadlines.totalTimeoutMs !== undefined) {
      const totalMs = deadlines.totalTimeoutMs;
      this.totalTimer = setTimeout(() => this.expire(new TimeoutError('total', totalMs, url)), totalMs);
    }
  }

  target(onExpire: (error: TimeoutError) => void): void {
    this.onExpire = onExpire;
  }

  activity(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.expire(new TimeoutError('idle', this.idleMs, this.url)), this.idleMs);
  }

  stop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.totalTimer) clearTimeout(this.totalTimer);
    this.idleTimer = null;
    this.totalTimer = null;
  }

  private expire(error: TimeoutError): void {
    this.stop();
    this.onExpire(error);
  }
}

export type HttpMethod = 'GET' | 'HEAD' | 'POST';

export interface HttpRequest extends RequestOptions {
  method: HttpMethod;
  body?: Buffer;
}

const IDLE_TIMEOUT_BY_METHOD: Record<HttpMethod, number> = {
  GET: DEFAULT_IDLE_TIMEOUT_MS,
  HEAD: HEAD_IDLE_TIMEOUT_MS,
  POST: POST_IDLE_TIMEOUT_MS,
};

function readBody(res: IncomingMessage, url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let ended = false;
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('error', reject);
    res.on('end', () => {
      ended = true;
      resolve(Buffer.concat(chunks));
    });
    res.on('close', () => {
      if (!ended) reject(new Error('Connexion interrompue: ' + url));
    });
  });
}

export class HttpClient {
  private readonly userAgent: string;

  constructor({ appVersion }: HttpClientOptions = {}) {
    this.userAgent = appVersion ? launcherUserAgent(appVersion) : KARAMON.launcherName;
  }

  async request(url: string, request: HttpRequest): Promise<HttpResponse> {
    const res = await this.open(url, request);
    return { status: res.statusCode ?? 0, body: await readBody(res, url) };
  }

  get(url: string, { timeoutMs, ...options }: GetOptions = {}): Promise<HttpResponse> {
    return this.request(url, {
      ...options,
      idleTimeoutMs: options.idleTimeoutMs ?? timeoutMs,
      method: 'GET',
    });
  }

  async getText(url: string, options: RequestOptions = {}): Promise<string> {
    const res = await this.get(url, options);
    if (!isSuccess(res)) throw new HttpStatusError(res.status, url);
    return res.body.toString('utf8');
  }

  async getJson<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    return JSON.parse(await this.getText(url, options)) as T;
  }

  post(url: string, body: Buffer | string, options: RequestOptions = {}): Promise<HttpResponse> {
    const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    return this.request(url, {
      ...options,
      headers: { ...options.headers, 'Content-Length': String(bytes.length) },
      body: bytes,
      method: 'POST',
    });
  }

  postJson(url: string, payload: unknown, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.post(url, JSON.stringify(payload), {
      ...options,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers },
    });
  }

  async head(url: string, options: RequestOptions = {}): Promise<IncomingHttpHeaders> {
    const res = await this.open(url, { ...options, method: 'HEAD' });
    res.resume();
    const status = res.statusCode ?? 0;
    if (!isSuccess({ status, body: Buffer.alloc(0) })) throw new HttpStatusError(status, url);
    return res.headers;
  }

  async openRange(url: string, range: RangeRequest, options: Deadlines = {}): Promise<RangeResponse> {
    const spec = range.end === undefined ? `bytes=${range.start}` : `bytes=${range.start}-${range.end}`;
    const headers: Record<string, string> = { Range: spec, 'Accept-Encoding': 'identity' };
    if (range.ifRange) headers['If-Range'] = range.ifRange;
    const res = await this.open(url, { ...options, headers, method: 'GET' });
    const etag = headerValue(res.headers.etag);
    const rejectWith = (error: Error): never => {
      res.resume();
      throw error;
    };
    if (res.statusCode !== 206) {
      if (range.ifRange && res.statusCode === 200) rejectWith(new ResourceChangedError(url));
      rejectWith(new RangeUnsupportedError(`HTTP ${res.statusCode} pour la plage ${spec} de ${url}`));
    }
    if (range.ifRange && etag && etag !== range.ifRange) rejectWith(new ResourceChangedError(url));
    const served = contentRange(res.headers);
    if (!served) return rejectWith(new RangeUnsupportedError(`Content-Range illisible pour ${url}`));
    if (range.end !== undefined && (served.start !== range.start || served.end !== range.end)) {
      rejectWith(new RangeUnsupportedError(`Plage ${served.start}-${served.end} reçue au lieu de ${spec} pour ${url}`));
    }
    return { stream: res, start: served.start, end: served.end, total: served.total, etag };
  }

  async getRange(url: string, range: RangeRequest, options: Deadlines = {}): Promise<RangeBuffer> {
    const opened = await this.openRange(url, range, options);
    const body = await readBody(opened.stream, url);
    const expected = opened.end - opened.start + 1;
    if (body.length !== expected) throw new IncompleteDownloadError(url, body.length, expected);
    return { body, start: opened.start, total: opened.total, etag: opened.etag };
  }

  async download(url: string, dest: string, options: DownloadOptions = {}): Promise<void> {
    const { expectedSha1 = '', expectedSha256 = '', label = '', onProgress, timeoutMs, ...deadlines } = options;
    const named = label || dest;
    const transfer: Deadlines = {
      ...deadlines,
      responseTimeoutMs: deadlines.responseTimeoutMs ?? timeoutMs ?? DOWNLOAD_RESPONSE_TIMEOUT_MS,
    };
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (expectedSha1 && (await hasDigest(dest, 'sha1', expectedSha1))) return;
    if (expectedSha256 && (await hasDigest(dest, 'sha256', expectedSha256))) return;

    const tmp = dest + '.tmp';
    try {
      const ranged = await this.downloadRanged(url, tmp, named, transfer, onProgress);
      if (!ranged) await this.downloadWhole(url, tmp, named, transfer, onProgress);
      if (expectedSha1) await HttpClient.verifyDigest(tmp, 'sha1', expectedSha1, named);
      if (expectedSha256) await HttpClient.verifyDigest(tmp, 'sha256', expectedSha256, named);
      fsyncFile(tmp);
      fs.renameSync(tmp, dest);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      if (e instanceof DigestMismatchError) fs.rmSync(dest, { force: true });
      throw e;
    }
  }

  private static async verifyDigest(file: string, algorithm: DigestAlgorithm, expected: string, label: string): Promise<void> {
    const actual = await fileDigest(file, algorithm);
    if (actual !== expected.toLowerCase()) throw new DigestMismatchError(algorithm, label, expected, actual);
  }

  private async downloadRanged(
    url: string,
    tmp: string,
    label: string,
    deadlines: Deadlines,
    onProgress: DownloadOptions['onProgress'],
  ): Promise<boolean> {
    let probe: RangeResponse;
    try {
      probe = await this.openRange(url, { start: 0, end: 0 }, deadlines);
    } catch (e) {
      if (e instanceof RangeUnsupportedError) return false;
      throw e;
    }
    probe.stream.resume();
    if (probe.total < RANGED_DOWNLOAD_MIN_BYTES || !isStrongEtag(probe.etag)) return false;

    const size = probe.total;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.ftruncateSync(fd, size);
    } finally {
      fs.closeSync(fd);
    }

    const ranges = byteRanges(size, RANGED_DOWNLOAD_PARTS);
    const received = new Array<number>(ranges.length).fill(0);
    const report = (): void => onProgress?.(Math.min(1, received.reduce((sum, n) => sum + n, 0) / size));
    const parts = await Promise.allSettled(
      ranges.map((range, index) =>
        withNetworkRetries(
          () =>
            this.downloadPart(url, tmp, { ...range, ifRange: probe.etag }, label, deadlines, (n) => {
              received[index] = n;
              report();
            }),
          () => {
            received[index] = 0;
          },
        ),
      ),
    );
    const failures = parts.flatMap((part) => (part.status === 'rejected' ? [part.reason as unknown] : []));
    if (failures.some((failure) => failure instanceof ResourceChangedError)) throw new ResourceChangedError(label);
    if (failures.length > 0) throw failures[0];
    return true;
  }

  private async downloadPart(
    url: string,
    tmp: string,
    range: Required<RangeRequest>,
    label: string,
    deadlines: Deadlines,
    onBytes: (received: number) => void,
  ): Promise<void> {
    const opened = await this.openRange(url, range, deadlines);
    const out = fs.createWriteStream(tmp, { flags: 'r+', start: range.start });
    await this.pipeToFile(opened.stream, out, label, range.end - range.start + 1, onBytes);
  }

  private async downloadWhole(
    url: string,
    tmp: string,
    label: string,
    deadlines: Deadlines,
    onProgress: DownloadOptions['onProgress'],
  ): Promise<void> {
    const res = await this.open(url, { ...deadlines, method: 'GET' });
    const status = res.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      res.resume();
      throw new HttpStatusError(status, label);
    }
    const total = parseInt(headerValue(res.headers['content-length']) || '0', 10);
    await this.pipeToFile(res, fs.createWriteStream(tmp), label, total, (received) => {
      if (total > 0) onProgress?.(received / total);
    });
  }

  private async pipeToFile(
    res: IncomingMessage,
    out: fs.WriteStream,
    label: string,
    expected: number,
    onBytes: (received: number) => void,
  ): Promise<void> {
    let received = 0;
    res.on('data', (chunk: Buffer) => {
      received += chunk.length;
      onBytes(received);
    });
    await pipeline(res, out);
    if (expected > 0 && received < expected) throw new IncompleteDownloadError(label, received, expected);
  }

  private open(url: string, request: HttpRequest): Promise<IncomingMessage> {
    const watchdog = new Watchdog(url, request, IDLE_TIMEOUT_BY_METHOD[request.method]);
    const headers = { 'User-Agent': this.userAgent, Accept: '*/*', ...request.headers };
    const followsRedirects = request.method !== 'POST';
    return new Promise((resolve, reject) => {
      const fail = (error: Error): void => {
        watchdog.stop();
        reject(error);
      };
      const send = (target: string, redirects: number): void => {
        try {
          assertHttps(target);
        } catch (e) {
          return fail(e as Error);
        }
        const req = https.request(target, { method: request.method, agent: AGENT, headers }, (res) => {
          const location = res.headers.location;
          if (followsRedirects && res.statusCode && REDIRECT_STATUS.has(res.statusCode) && location) {
            res.resume();
            if (redirects >= MAX_REDIRECTS) return fail(new TooManyRedirectsError(target));
            let next: string;
            try {
              next = new URL(location, target).toString();
            } catch {
              return fail(new InsecureUrlError(location));
            }
            return send(next, redirects + 1);
          }
          const socket = res.socket;
          const onSocketData = (): void => watchdog.activity();
          watchdog.activity();
          watchdog.target((error) => res.destroy(error));
          socket?.on('data', onSocketData);
          res.on('close', () => {
            watchdog.stop();
            socket?.off('data', onSocketData);
          });
          resolve(res);
        });
        watchdog.target((error) => req.destroy(error));
        req.on('error', fail);
        req.end(request.body);
      };
      send(url, 0);
    });
  }
}
