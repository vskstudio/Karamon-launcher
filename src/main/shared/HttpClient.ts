import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'http';

const REDIRECT_STATUS = new Set([301, 302, 307, 308]);
const MAX_REDIRECTS = 10;
const RANGE_MIN_SIZE = 8 * 1024 * 1024;
const RANGE_PARTS = 8;
const DEFAULT_HEADERS = {
  'User-Agent': 'KaramonLauncher/2.0.9',
  Accept: '*/*',
};

const AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: 16,
  family: 4,
});

export interface HttpResponse {
  status: number;
  body: Buffer;
}

export interface DownloadOptions {
  expectedSha1?: string;
  expectedSha256?: string;
  label?: string;
  onProgress?: (fraction: number) => void;
  timeoutMs?: number;
  stallTimeoutMs?: number;
}

export interface ByteRange {
  start: number;
  end: number;
}

export function planByteRanges(size: number, parts = RANGE_PARTS): ByteRange[] {
  if (size <= 0) return [];
  const n = Math.max(1, Math.min(parts, size));
  const chunk = Math.floor(size / n);
  const ranges: ByteRange[] = [];
  for (let i = 0; i < n; i++) {
    const start = i * chunk;
    const end = i === n - 1 ? size - 1 : start + chunk - 1;
    ranges.push({ start, end });
  }
  return ranges;
}

export function parseTotalSize(headers: IncomingHttpHeaders, status: number): number {
  const range = headerValue(headers['content-range']);
  const match = range.match(/\/(\d+)\s*$/);
  if (match) return Number(match[1]);
  if (status === 200) {
    const length = headerValue(headers['content-length']);
    if (length) return Number(length);
  }
  return 0;
}

function headerValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? '';
  return typeof raw === 'string' ? raw : '';
}

export class HttpClient {
  static assertHttps(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('URL invalide: ' + (url || '(vide)'));
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('URL non sécurisée refusée (HTTPS requis): ' + url);
    }
  }

  private static redirectTarget(location: string | string[], baseUrl: string): string {
    const value = Array.isArray(location) ? location[0] : location;
    if (!value) throw new Error('Redirection invalide: ' + baseUrl);
    const next = new URL(value, baseUrl).toString();
    HttpClient.assertHttps(next);
    return next;
  }

  static sha1File(filePath: string): string {
    return HttpClient.hashFile(filePath, 'sha1');
  }

  static sha256File(filePath: string): string {
    return HttpClient.hashFile(filePath, 'sha256');
  }

  private static hashFile(filePath: string, algorithm: string): string {
    const hash = crypto.createHash(algorithm);
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
  }

  private static verifyDigest(filePath: string, expected: string, algorithm: 'sha1' | 'sha256', label: string): void {
    const actual = HttpClient.hashFile(filePath, algorithm);
    if (actual.toLowerCase() === expected.toLowerCase()) return;
    fs.rmSync(filePath, { force: true });
    throw new Error(
      `${algorithm.toUpperCase()} mismatch for ${label}: expected ${expected}, got ${actual}`,
    );
  }

  get(url: string, { timeoutMs = 30000 }: { timeoutMs?: number } = {}): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const fetchUrl = (target: string, redirects = 0): void => {
        try {
          HttpClient.assertHttps(target);
        } catch (e) {
          return reject(e);
        }
        const req = https.get(target, { agent: AGENT, headers: DEFAULT_HEADERS }, (res) => {
          if (res.statusCode && REDIRECT_STATUS.has(res.statusCode) && res.headers.location) {
            res.resume();
            if (redirects >= MAX_REDIRECTS) {
              return reject(new Error('Trop de redirections: ' + target));
            }
            try {
              return fetchUrl(HttpClient.redirectTarget(res.headers.location, target), redirects + 1);
            } catch (e) {
              return reject(e);
            }
          }
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }),
          );
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
          req.destroy();
          reject(new Error('Request timeout: ' + target));
        });
      };
      fetchUrl(url);
    });
  }

  async getText(url: string): Promise<string> {
    const res = await this.get(url);
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.body.toString('utf8');
  }

  async getJson<T = unknown>(url: string): Promise<T> {
    return JSON.parse(await this.getText(url)) as T;
  }

  head(url: string, { timeoutMs = 10000 }: { timeoutMs?: number } = {}): Promise<IncomingHttpHeaders> {
    return new Promise((resolve, reject) => {
      const sendHead = (target: string, redirects = 0): void => {
        try {
          HttpClient.assertHttps(target);
        } catch (e) {
          return reject(e);
        }
        const req = https.request(target, { method: 'HEAD', agent: AGENT, headers: DEFAULT_HEADERS }, (res) => {
          res.resume();
          if (res.statusCode && REDIRECT_STATUS.has(res.statusCode) && res.headers.location) {
            if (redirects >= MAX_REDIRECTS) {
              return reject(new Error('Trop de redirections: ' + target));
            }
            try {
              return sendHead(HttpClient.redirectTarget(res.headers.location, target), redirects + 1);
            } catch (e) {
              return reject(e);
            }
          }
          resolve(res.headers);
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
          req.destroy();
          reject(new Error('HEAD timeout: ' + target));
        });
        req.end();
      };
      sendHead(url);
    });
  }

  async download(url: string, dest: string, opts: DownloadOptions = {}): Promise<void> {
    const {
      expectedSha1 = '',
      expectedSha256 = '',
      label = '',
      onProgress,
      timeoutMs = 60000,
      stallTimeoutMs = 30000,
    } = opts;
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (expectedSha1 && fs.existsSync(dest)) {
      const cached = HttpClient.sha1File(dest).toLowerCase();
      if (cached === expectedSha1.toLowerCase()) return;
    }
    if (expectedSha256 && fs.existsSync(dest)) {
      const cached = HttpClient.sha256File(dest).toLowerCase();
      if (cached === expectedSha256.toLowerCase()) return;
    }

    const ranged = await this.downloadRanged(url, dest, {
      label,
      onProgress,
      timeoutMs,
      stallTimeoutMs,
    });
    if (!ranged) {
      await this.downloadSingle(url, dest, {
        label,
        onProgress,
        timeoutMs,
        stallTimeoutMs,
      });
    }

    if (expectedSha1) {
      HttpClient.verifyDigest(dest, expectedSha1, 'sha1', label || dest);
    }
    if (expectedSha256) {
      HttpClient.verifyDigest(dest, expectedSha256, 'sha256', label || dest);
    }
  }

  private async downloadRanged(
    url: string,
    dest: string,
    opts: Required<Pick<DownloadOptions, 'label' | 'timeoutMs' | 'stallTimeoutMs'>> &
      Pick<DownloadOptions, 'onProgress'>,
  ): Promise<boolean> {
    let probe: { status: number; headers: IncomingHttpHeaders };
    try {
      probe = await this.requestHeaders(url, { Range: 'bytes=0-0' }, opts.timeoutMs);
    } catch {
      return false;
    }
    if (probe.status !== 206) return false;
    const size = parseTotalSize(probe.headers, probe.status);
    if (size < RANGE_MIN_SIZE) return false;

    const ranges = planByteRanges(size, RANGE_PARTS);
    const tmp = dest + '.tmp';
    fs.rmSync(tmp, { force: true });
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.ftruncateSync(fd, size);
    } finally {
      fs.closeSync(fd);
    }

    const received = new Array(ranges.length).fill(0);
    const report = (): void => {
      if (!opts.onProgress) return;
      const total = received.reduce((sum, n) => sum + n, 0);
      opts.onProgress(Math.min(1, total / size));
    };

    try {
      await Promise.all(
        ranges.map((range, index) =>
          this.downloadRangeToFile(url, tmp, range, opts, (n) => {
            received[index] = n;
            report();
          }),
        ),
      );
      fs.rmSync(dest, { force: true });
      fs.renameSync(tmp, dest);
      return true;
    } catch {
      fs.rmSync(tmp, { force: true });
      return false;
    }
  }

  private downloadRangeToFile(
    url: string,
    dest: string,
    range: ByteRange,
    opts: Required<Pick<DownloadOptions, 'label' | 'timeoutMs' | 'stallTimeoutMs'>>,
    onBytes: (received: number) => void,
  ): Promise<void> {
    const expected = range.end - range.start + 1;
    return new Promise((resolve, reject) => {
      this.open(url, { Range: `bytes=${range.start}-${range.end}` }, opts.timeoutMs, (err, res) => {
        if (err || !res) return reject(err ?? new Error('Range vide'));
        if (res.statusCode !== 206) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} range ${opts.label}`));
        }
        const out = fs.createWriteStream(dest, { flags: 'r+', start: range.start });
        this.pipeToFile(res, out, {
          label: opts.label,
          expected,
          stallTimeoutMs: opts.stallTimeoutMs,
          onProgress: (received) => onBytes(received),
        })
          .then(resolve)
          .catch(reject);
      });
    });
  }

  private downloadSingle(
    url: string,
    dest: string,
    opts: Required<Pick<DownloadOptions, 'label' | 'timeoutMs' | 'stallTimeoutMs'>> &
      Pick<DownloadOptions, 'onProgress'>,
  ): Promise<void> {
    const tmp = dest + '.tmp';
    return new Promise((resolve, reject) => {
      this.open(url, {}, opts.timeoutMs, (err, res) => {
        if (err || !res) return reject(err ?? new Error('Réponse vide'));
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} downloading ${opts.label || url}`));
        }
        const total = parseInt(headerValue(res.headers['content-length']) || '0', 10);
        const out = fs.createWriteStream(tmp);
        this.pipeToFile(res, out, {
          label: opts.label || url,
          expected: total,
          stallTimeoutMs: opts.stallTimeoutMs,
          onProgress: opts.onProgress
            ? (received) => {
                if (total > 0) opts.onProgress?.(received / total);
              }
            : undefined,
        })
          .then(() => {
            fs.rmSync(dest, { force: true });
            fs.renameSync(tmp, dest);
            resolve();
          })
          .catch((error) => {
            fs.rmSync(tmp, { force: true });
            reject(error);
          });
      });
    });
  }

  private requestHeaders(
    url: string,
    extraHeaders: Record<string, string>,
    timeoutMs: number,
  ): Promise<{ status: number; headers: IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      this.open(url, extraHeaders, timeoutMs, (err, res) => {
        if (err || !res) return reject(err ?? new Error('Réponse vide'));
        res.resume();
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
      });
    });
  }

  private open(
    url: string,
    extraHeaders: Record<string, string>,
    timeoutMs: number,
    cb: (err: Error | null, res?: IncomingMessage) => void,
  ): void {
    const fetchUrl = (target: string, redirects = 0): void => {
      try {
        HttpClient.assertHttps(target);
      } catch (e) {
        return cb(e as Error);
      }
      const req = https.get(
        target,
        { agent: AGENT, headers: { ...DEFAULT_HEADERS, ...extraHeaders } },
        (res) => {
          if (res.statusCode && REDIRECT_STATUS.has(res.statusCode) && res.headers.location) {
            res.resume();
            if (redirects >= MAX_REDIRECTS) {
              return cb(new Error('Trop de redirections: ' + target));
            }
            try {
              return fetchUrl(HttpClient.redirectTarget(res.headers.location, target), redirects + 1);
            } catch (e) {
              return cb(e as Error);
            }
          }
          cb(null, res);
        },
      );
      req.on('error', (e) => cb(e));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        cb(new Error('Download timeout: ' + target));
      });
    };
    fetchUrl(url);
  }

  private pipeToFile(
    res: IncomingMessage,
    out: fs.WriteStream,
    opts: {
      label: string;
      expected: number;
      stallTimeoutMs: number;
      onProgress?: (received: number) => void;
    },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let received = 0;
      let settled = false;
      let stallTimer: NodeJS.Timeout | null = null;
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        if (stallTimer) clearTimeout(stallTimer);
        try {
          res.destroy();
        } catch {
          /* ignore */
        }
        try {
          out.destroy();
        } catch {
          /* ignore */
        }
        reject(err);
      };
      const armStallTimer = (): void => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          fail(
            new Error(
              `Download stalled (${Math.round(opts.stallTimeoutMs / 1000)}s sans données): ` + opts.label,
            ),
          );
        }, opts.stallTimeoutMs);
      };
      armStallTimer();
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        opts.onProgress?.(received);
        armStallTimer();
      });
      res.on('error', (e) => fail(e as Error));
      res.on('aborted', () => fail(new Error('Connexion interrompue: ' + opts.label)));
      res.pipe(out);
      out.on('finish', () => {
        if (settled) return;
        if (stallTimer) clearTimeout(stallTimer);
        if (opts.expected > 0 && received < opts.expected) {
          settled = true;
          return reject(
            new Error(`Download incomplet ${opts.label}: ${received}/${opts.expected} octets`),
          );
        }
        settled = true;
        resolve();
      });
      out.on('error', (e) => fail(e as Error));
    });
  }
}
