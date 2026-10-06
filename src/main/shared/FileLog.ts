import fs from 'fs';
import path from 'path';

/** Past this size the log moves to launcher.old.log and a new one starts. */
export const MAX_LOG_BYTES = 1024 * 1024;

/**
 * Launcher log on disk (logs/launcher.log in the launcher data folder), so a
 * player can send what happened even after the window is closed. One rotated
 * copy is kept: at most about 2 Mo. Writing never throws: a full disk or a
 * locked file must not break the launcher.
 */
export class FileLog {
  readonly file: string;
  private readonly oldFile: string;
  private readonly maxBytes: number;
  private size = -1;

  constructor(logsDir: string, maxBytes = MAX_LOG_BYTES) {
    this.file = path.join(logsDir, 'launcher.log');
    this.oldFile = path.join(logsDir, 'launcher.old.log');
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

  /** Keeps one entry per line; access tokens never reach the log. */
  private static oneLine(message: string): string {
    return message
      .replace(/\r?\n/g, ' ⏎ ')
      .replace(/(access_token|refresh_token|accessToken|refreshToken|Bearer)(["'=:\s]+)[A-Za-z0-9._~+/=-]{12,}/g, '$1$2[masqué]');
  }
}
