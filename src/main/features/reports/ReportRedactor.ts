import net from 'net';

const MASKED = '[masqué]';
const MIN_LOCAL_NAME_LENGTH = 3;

/** Removes local identity, credentials and network addresses from diagnostic text. */
export function redactReportText(text: string, homeDir?: string, localNames: string[] = []): string {
  let result = text;

  if (homeDir) {
    result = result.replace(new RegExp(escapeRegex(homeDir), windowsPath(homeDir) ? 'gi' : 'g'), '<user>');
  }
  for (const name of localNames) {
    if (name.trim().length < MIN_LOCAL_NAME_LENGTH) continue;
    result = result.replace(new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(name.trim())}(?![A-Za-z0-9_])`, 'gi'), '<local>');
  }

  result = result
    // Windows: plain, JSON-escaped (\\) or forward-slash separators.
    .replace(/\b([A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/))[^\\/"\r\n]+/gi, (_value, prefix: string) => `${prefix}<user>`)
    .replace(/\/(home|Users)\/[^/\s]+/g, (_value, root: string) => `/${root}/<user>`)
    .replace(/(--accessToken(?:\s+|=))(?:(['"])[\s\S]*?\2|\S+)/gi, `$1${MASKED}`)
    .replace(/\b(Authorization\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi, `$1${MASKED}`)
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${MASKED}`)
    .replace(/(connecté en tant que |logged in as )\S+/gi, `$1${MASKED}`)
    .replace(/(\[CHAT\] ).*$/gm, `$1${MASKED}`)
    .replace(
      /((?:["']?(?:accessToken|access_token|refreshToken|refresh_token|session)["']?)\s*[:=]\s*)(["']?)([^\s"',;}\]]+)\2/gi,
      (_match, prefix: string, quote: string) => `${prefix}${quote}${MASKED}${quote}`,
    );

  result = result.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (candidate) =>
    net.isIP(candidate) === 4 ? '<ip>' : candidate,
  );
  result = result.replace(/\[([0-9A-Fa-f:]+)\]/g, (whole, candidate: string) =>
    net.isIP(candidate) === 6 ? '[<ip>]' : whole,
  );
  result = result.replace(/(?<![A-Za-z0-9_.])([0-9A-Fa-f:]*:[0-9A-Fa-f:]+)(?![A-Za-z0-9_.])/g, (whole, candidate: string) =>
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
