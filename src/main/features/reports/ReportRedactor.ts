import net from 'net';

const MASKED = '[masqué]';
/** Host names too short or too common to mask without eating ordinary words. */
const GENERIC_HOSTS = new Set(['localhost', 'unknown', 'computer', 'desktop', 'laptop', 'macbook']);
const MIN_HOST_LENGTH = 4;
const SECRET_NAME = /token|session|passw|secret|auth/i;

/** Keeps the quotes around a masked value so JSON and shell lines stay readable. */
function quoted(value: string, replacement: string): string {
  const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
  return quote && value.length > 1 && value.endsWith(quote) ? `${quote}${replacement}${quote}` : replacement;
}

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
  // A home dir of one character ('/') would eat every separator.
  if (homeDir && homeDir.replace(/[\\/]+$/, '').length > 1) {
    const home = homeDir.replace(/[\\/]+$/, '');
    result = result.replace(new RegExp(`${escapeRegex(home)}(?![A-Za-z0-9._-])`, windowsPath(home) ? 'gi' : 'g'), '<user>');
  }
  if (hostName && hostName.length >= MIN_HOST_LENGTH && !GENERIC_HOSTS.has(hostName.toLowerCase())) {
    result = result.replace(new RegExp(`(?<![A-Za-z0-9-])${escapeRegex(hostName)}(?![A-Za-z0-9-])`, 'gi'), '<host>');
  }

  // Every pattern below either always succeeds once started or is bounded, so a
  // hostile log of repeated prefixes stays linear.
  result = result
    // Windows: plain, JSON-escaped (\\) or forward-slash separators.
    .replace(/\b([A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/))[^\\/"\r\n]+/gi, (_value, prefix: string) => `${prefix}<user>`)
    // macOS names may contain spaces: take up to the next slash when there is one.
    .replace(/\/Users\/(?:[^/\r\n"'<>]{1,64}(?=\/)|[^/\s"'<>]+)/g, '/Users/<user>')
    .replace(/\/home\/[^/\s]+/g, '/home/<user>')
    // URL parameters carry OAuth codes, tickets and e-mails: keep only the address.
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => {
      const cut = url.search(/[?#]/);
      return cut < 0 ? url : `${url.slice(0, cut)}?${MASKED}`;
    })
    .replace(/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}\b/g, '<email>')
    // Xbox Live header: user hash + token.
    .replace(/\bXBL3\.0\s+x=[^;\s]+;\S+/g, `XBL3.0 x=${MASKED}`)
    // JWT (Minecraft access token, Xbox/XSTS tokens).
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, MASKED)
    // Microsoft refresh tokens and authorization codes (M.C…, M.R3_…).
    .replace(/\bM\.[CR]\d+_[A-Za-z0-9]+\.[^\s"',;]+/g, MASKED)
    // Microsoft compact access tokens.
    .replace(/\bEw[A-Za-z0-9+/]{30,}={0,2}/g, MASKED)
    // JVM system properties whose name says they hold a secret (name tested apart: no nested repeats).
    .replace(/(-D([\w.-]{1,128})=)("[^"\r\n]{0,512}"|'[^'\r\n]{0,512}'|\S+)/g, (whole, prefix: string, name: string, value: string) =>
      SECRET_NAME.test(name) ? prefix + quoted(value, MASKED) : whole,
    )
    // Minecraft launch arguments with credentials or identity.
    .replace(
      /(--(?:accessToken|session|username|uuid|xuid|clientId)(?:\s+|=))("[^"\r\n]{0,512}"|'[^'\r\n]{0,512}'|\S+)/gi,
      (_whole, prefix: string, value: string) => prefix + quoted(value, MASKED),
    )
    .replace(/\b(Authorization\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi, `$1${MASKED}`)
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${MASKED}`)
    .replace(
      /((?:["']?(?:accessToken|access_token|refreshToken|refresh_token|clientToken|session)["']?)\s*[:=]\s*)("[^"\r\n]{0,4096}"|'[^'\r\n]{0,4096}'|[^\s"',;}\]]+)/gi,
      (_match, prefix: string, value: string) => prefix + quoted(value, MASKED),
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
