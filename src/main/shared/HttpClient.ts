import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { IncomingHttpHeaders } from 'http';

const REDIRECT_STATUS = new Set([301, 302, 307, 308]);
const MAX_REDIRECTS = 10;
const DEFAULT_HEADERS = {
  'User-Agent': 'KaramonLauncher/2.0.5',
  Accept: '*/*',
};

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
        const req = https.get(target, { headers: DEFAULT_HEADERS }, (res) => {
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
        const req = https.request(target, { method: 'HEAD', headers: DEFAULT_HEADERS }, (res) => {
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

    await new Promise<void>((resolve, reject) => {
      const fetchUrl = (target: string, redirects = 0): void => {
        try {
          HttpClient.assertHttps(target);
        } catch (e) {
          return reject(e);
        }
        const req = https.get(target, { headers: DEFAULT_HEADERS }, (res) => {
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
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} downloading ${label || url}`));
          }
          const total = parseInt(res.headers['content-length'] || '0', 10);
          let received = 0;
          const tmp = dest + '.tmp';
          const out = fs.createWriteStream(tmp);

          let settled = false;
          let stallTimer: NodeJS.Timeout | null = null;
          const cleanupTmp = (): void => {
            try {
              fs.rmSync(tmp, { force: true });
            } catch {
              /* best-effort */
            }
          };
          const fail = (err: Error): void => {
            if (settled) return;
            settled = true;
            if (stallTimer) clearTimeout(stallTimer);
            try {
              req.destroy();
            } catch {
              /* ignore */
            }
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
            cleanupTmp();
            reject(err);
          };
          const armStallTimer = (): void => {
            if (stallTimer) clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
              fail(
                new Error(
                  `Download stalled (${Math.round(stallTimeoutMs / 1000)}s sans données): ` +
                    (label || url),
                ),
              );
            }, stallTimeoutMs);
          };
          armStallTimer();

          res.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (onProgress && total > 0) onProgress(received / total);
            armStallTimer();
          });
          res.on('error', (e) => fail(e as Error));
          res.on('aborted', () =>
            fail(new Error('Connexion interrompue: ' + (label || url))),
          );
          res.pipe(out);
          out.on('finish', () => {
            if (settled) return;
            if (stallTimer) clearTimeout(stallTimer);
            if (total > 0 && received < total) {
              settled = true;
              cleanupTmp();
              return reject(
                new Error(
                  `Download incomplet ${label || url}: ${received}/${total} octets`,
                ),
              );
            }
            try {
              try {
                fs.rmSync(dest, { force: true });
              } catch {
                /* best-effort: dest absent ou non supprimable */
              }
              fs.renameSync(tmp, dest);
              settled = true;
              resolve();
            } catch (e) {
              cleanupTmp();
              settled = true;
              reject(e as Error);
            }
          });
          out.on('error', (e) => fail(e as Error));
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error('Download timeout: ' + (label || url)));
        });
      };
      fetchUrl(url);
    });

    if (expectedSha1) {
      HttpClient.verifyDigest(dest, expectedSha1, 'sha1', label || dest);
    }
    if (expectedSha256) {
      HttpClient.verifyDigest(dest, expectedSha256, 'sha256', label || dest);
    }
  }
}
