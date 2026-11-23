import fs from 'fs';
import path from 'path';

export const MAX_LOG_BYTES_BEFORE_ROTATION = 1024 * 1024;

export class FileLog {
  readonly file: string;
  private readonly oldFile: string;
  private readonly maxBytes: number;
  private size = -1;

  constructor(file: string, maxBytes = MAX_LOG_BYTES_BEFORE_ROTATION) {
    this.file = file;
    this.oldFile = path.join(path.dirname(file), `${path.basename(file, '.log')}.old.log`);
    this.maxBytes = maxBytes;
  }

  write(level: 'info' | 'warn' | 'error', message: string): void {
    const line = `${new Date().toISOString()} [${level}] ${FileLog.oneLine(message)}\n`;
    try {
      if (this.size < 0) {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        this.size = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
      }
      if (this.size + Buffer.byteLength(line) > this.maxBytes && this.size > 0) {
        fs.rmSync(this.oldFile, { force: true });
        fs.renameSync(this.file, this.oldFile);
        this.size = 0;
      }
      fs.appendFileSync(this.file, line, 'utf8');
      this.size += Buffer.byteLength(line);
    } catch {
      this.size = -1;
    }
  }

  info(message: string): void {
    this.write('info', message);
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  error(message: string, error?: unknown): void {
    this.write('error', error === undefined ? message : `${message}: ${FileLog.describe(error)}`);
  }

  static describe(error: unknown): string {
    if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
    return String(error);
  }

  private static oneLine(message: string): string {
    return message
      .replace(/\r?\n/g, ' ⏎ ')
      .replace(/(access_token|refresh_token|accessToken|refreshToken|Bearer)(["'=:\s]+)[A-Za-z0-9._~+/=-]{12,}/g, '$1$2[masqué]');
  }
}
