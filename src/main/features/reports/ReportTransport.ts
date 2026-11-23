import zlib from 'zlib';
import { HttpClient } from '../../shared/HttpClient.ts';
import { KARAMON } from '../../../shared/Karamon.ts';
import { MAX_REPORT_JSON_BYTES } from './ReportCollector.ts';
import type { LauncherReport } from './ReportTypes.ts';

const POST_TOTAL_TIMEOUT_MS = 10_000;

export type ReportTransportResult = 'sent' | 'retry' | 'discard';

export class ReportTransport {
  private readonly http: Pick<HttpClient, 'post'>;

  constructor(http: Pick<HttpClient, 'post'>) {
    this.http = http;
  }

  async send(report: LauncherReport): Promise<ReportTransportResult> {
    const json = Buffer.from(JSON.stringify(report), 'utf8');
    if (json.length > MAX_REPORT_JSON_BYTES) return 'discard';
    try {
      const { status } = await this.http.post(KARAMON.reportsUrl, zlib.gzipSync(json), {
        headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
        totalTimeoutMs: POST_TOTAL_TIMEOUT_MS,
      });
      if (status >= 200 && status < 300) return 'sent';
      if (status === 408 || status === 429 || status >= 500) return 'retry';
      return 'discard';
    } catch {
      return 'retry';
    }
  }
}
