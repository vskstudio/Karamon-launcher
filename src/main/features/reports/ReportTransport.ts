import https from 'https';
import zlib from 'zlib';
import { MAX_REPORT_JSON_BYTES } from './ReportCollector.ts';
import type { LauncherReport } from './ReportTypes.ts';

/** Provisional panel URL; the public hostname must be confirmed before merge. */
export const LAUNCHER_REPORTS_URL = 'https://panel.karamon.fr/api/launcher/reports';
const POST_TIMEOUT_MS = 10_000;

export type ReportTransportResult = 'sent' | 'retry' | 'discard';
export type ReportPost = (
  url: string,
  body: Buffer,
  headers: Record<string, string>,
) => Promise<number>;

export class ReportTransport {
  private readonly post: ReportPost;

  constructor(post: ReportPost = postHttps) {
    this.post = post;
  }

  async send(report: LauncherReport): Promise<ReportTransportResult> {
    const json = Buffer.from(JSON.stringify(report), 'utf8');
    if (json.length > MAX_REPORT_JSON_BYTES) return 'discard';
    const body = zlib.gzipSync(json);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Content-Length': String(body.length),
      'User-Agent': `KaramonLauncher/${report.launcherVersion}`,
    };
    try {
      const status = await this.post(LAUNCHER_REPORTS_URL, body, headers);
      if (status >= 200 && status < 300) return 'sent';
      if (status === 429 || status >= 500) return 'retry';
      return 'discard';
    } catch {
      return 'retry';
    }
  }
}

function postHttps(url: string, body: Buffer, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return reject(new Error('HTTPS requis pour les rapports'));
    const request = https.request(parsed, { method: 'POST', headers }, (response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      response.on('end', () => resolve(status));
    });
    request.on('error', reject);
    request.setTimeout(POST_TIMEOUT_MS, () => request.destroy(new Error('Envoi du rapport expiré')));
    request.end(body);
  });
}
