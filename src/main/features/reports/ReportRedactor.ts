import net from 'net';

const MASKED = '[masqué]';
/** Host names too short or too common to mask without eating ordinary words. */
const GENERIC_HOSTS = new Set(['localhost', 'unknown', 'computer', 'desktop', 'laptop', 'macbook']);
const MIN_HOST_LENGTH = 4;

export interface RedactOptions {
  /** OS home directory, masked wherever it appears. */
  homeDir?: string;
  /** Machine name (os.hostname()), masked case-insensitively. */
  hostName?: string;
}

/**
 * Masks local identity, credentials and network addresses in diagnostic text.
 * Best effort: it removes what the launcher knows to look for, it does not
 * guarantee the text is anonymous.
 */
export function redactReportText(text: string, options: RedactOptions = {}): string {
  let result = text;

  const { homeDir, hostName } = options;
  if (homeDir) {
    result = result.replace(new RegExp(escapeRegex(homeDir), windowsPath(homeDir) ? 'gi' : 'g'), '<user>');
  }
  if (hostName && hostName.length >= MIN_HOST_LENGTH && !GENERIC_HOSTS.has(hostName.toLowerCase())) {
    result = result.replace(new RegExp(`(?<![A-Za-z0-9-])${escapeRegex(hostName)}(?![A-Za-z0-9-])`, 'gi'), '<host>');
  }

  result = result
    // Windows: plain, JSON-escaped (\\) or forward-slash separators.
    .replace(/\b([A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/))[^\\/"\r\n]+/gi, (_value, prefix: string) => `${prefix}<user>`)
    .replace(/\/(home|Users)\/[^/\s]+/g, (_value, root: string) => `/${root}/<user>`)
    // URL parameters carry OAuth codes, tickets and e-mails: keep only the address.
    .replace(/(\bhttps?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, `$1?${MASKED}`)
    .replace(/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}\b/g, '<email>')
    // Xbox Live header: user hash + token.
    .replace(/\bXBL3\.0\s+x=[^;\s]+;\S+/g, `XBL3.0 x=${MASKED}`)
    // JWT (Minecraft access token, Xbox/XSTS tokens).
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, MASKED)
    // Microsoft refresh tokens and authorization codes (M.C…, M.R3_…).
    .replace(/\bM\.[CR]\d+_[A-Za-z0-9]+\.[^\s"',;]+/g, MASKED)
    // Microsoft compact access tokens.
    .replace(/\bEw[A-Za-z0-9+/]{30,}={0,2}/g, MASKED)
    // JVM system properties whose name says they hold a secret.
    .replace(/(-D[\w.-]*(?:token|session|password|passwd|secret|auth)[\w.-]*=)(?:(['"])[\s\S]*?\2|\S+)/gi, `$1${MASKED}`)
    // Minecraft launch arguments with credentials or identity.
    .replace(
      /(--(?:accessToken|session|username|uuid|xuid|clientId)(?:\s+|=))(?:(['"])[\s\S]*?\2|\S+)/gi,
      `$1${MASKED}`,
    )
    .replace(/\b(Authorization\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi, `$1${MASKED}`)
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${MASKED}`)
    .replace(
      /((?:["']?(?:accessToken|access_token|refreshToken|refresh_token|session)["']?)\s*[:=]\s*)(["']?)([^\s"',;}\]]+)\2/gi,
      (_match, prefix: string, quote: string) => `${prefix}${quote}${MASKED}${quote}`,
    );

  result = result.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (candidate) =>
    net.isIP(candidate) === 4 ? '<ip>' : candidate,
  );
  result = result.replace(/\[([0-9A-Fa-f:]{2,39})\]/g, (whole, candidate: string) =>
    net.isIP(candidate) === 6 ? '[<ip>]' : whole,
  );
  // Starts only at a token boundary and stays bounded: linear on long hex runs.
  result = result.replace(/(?<![A-Za-z0-9_.:])((?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4})(?![A-Za-z0-9_.:])/g, (whole, candidate: string) =>
    net.isIP(candidate) === 6 ? '<ip>' : whole,
  );

  return result;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function windowsPath(value: string): boolean {
  return /^[A-Za-z]:\\/.test(value);
}
