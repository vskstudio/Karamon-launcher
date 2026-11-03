import https from 'https';
import zlib from 'zlib';
import { MAX_REPORT_JSON_BYTES } from './ReportCollector.ts';
import type { LauncherReport } from './ReportTypes.ts';

/** Seule adresse d'envoi des rapports : route publique du panel Karamon. */
export const LAUNCHER_REPORTS_URL = 'https://karamon.fr/panel/api/launcher/reports';
const POST_TIMEOUT_MS = 10_000;
/** Ignore absurd Retry-After values: the queue TTL caps the wait anyway. */
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 16 * 1024;

export type ReportTransportResult =
  | { kind: 'sent'; serverId: string | null }
  | { kind: 'retry'; reason: string; retryAfterMs: number | null }
  | { kind: 'discard'; reason: string };

export interface ReportPostResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
}

export type ReportPost = (
  url: string,
  body: Buffer,
  headers: Record<string, string>,
  signal: AbortSignal,
) => Promise<ReportPostResponse>;

export interface ReportTransportOptions {
  post?: ReportPost;
  timeoutMs?: number;
  now?: () => number;
}

export class ReportTransport {
  private readonly post: ReportPost;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(options: ReportTransportOptions = {}) {
    this.post = options.post ?? postHttps;
    this.timeoutMs = options.timeoutMs ?? POST_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  async send(report: LauncherReport): Promise<ReportTransportResult> {
    const json = Buffer.from(JSON.stringify(report), 'utf8');
    if (json.length > MAX_REPORT_JSON_BYTES) return { kind: 'discard', reason: 'rapport trop volumineux' };
    const body = zlib.gzipSync(json);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Content-Length': String(body.length),
      // The panel deduplicates on this key: a retry after a lost response is not a second report.
      'Idempotency-Key': report.reportId,
      'User-Agent': `KaramonLauncher/${report.launcherVersion}`,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: ReportPostResponse;
    try {
      response = await this.post(LAUNCHER_REPORTS_URL, body, headers, controller.signal);
    } catch (error) {
      const reason = controller.signal.aborted ? 'délai dépassé' : (error as Error).message || 'réseau indisponible';
      return { kind: 'retry', reason, retryAfterMs: null };
    } finally {
      clearTimeout(timer);
    }
    const { status } = response;
    if (status >= 200 && status < 300) return { kind: 'sent', serverId: serverId(response.body) };
    if (status === 408 || status === 429 || status >= 500) {
      return { kind: 'retry', reason: `HTTP ${status}`, retryAfterMs: retryAfter(response.headers['retry-after'], this.now()) };
    }
    return { kind: 'discard', reason: `HTTP ${status}` };
  }
}

/** The id the panel stored the report under, if it sent a plausible one. */
function serverId(body: string): string | null {
  try {
    const id = (JSON.parse(body) as { id?: unknown })?.id;
    return typeof id === 'string' && /^[A-Za-z0-9-]{4,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function retryAfter(value: string | undefined, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - now;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

function postHttps(url: string, body: Buffer, headers: Record<string, string>, signal: AbortSignal): Promise<ReportPostResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return reject(new Error('HTTPS requis pour les rapports'));
    const request = https.request(parsed, { method: 'POST', headers, signal }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= MAX_RESPONSE_BYTES) chunks.push(chunk);
      });
      response.on('end', () => {
        const retry = response.headers['retry-after'];
        resolve({
          status: response.statusCode ?? 0,
          headers: { 'retry-after': Array.isArray(retry) ? retry[0] : retry },
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(body);
  });
}
