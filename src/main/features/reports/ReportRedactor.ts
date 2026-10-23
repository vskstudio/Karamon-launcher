import net from 'net';

const MASKED = '[masqué]';
const LOCAL = '<local>';
const MIN_FREE_WORD_LENGTH = 3;
const GENERIC_NAMES = new Set([
  'admin',
  'default',
  'desktop',
  'dev',
  'guest',
  'home',
  'java',
  'laptop',
  'linux',
  'localhost',
  'mac',
  'macbook',
  'minecraft',
  'pc',
  'root',
  'server',
  'ubuntu',
  'user',
  'windows',
]);
const IDENTITY_KEY = String.raw`(?<![A-Za-z0-9_])(?:user(?:[ ._-]?name)?|utilisateur|nom d'utilisateur|host(?:[ _-]?name)?|computer[ _-]?name|machine)`;

export function redactReportText(text: string, homeDir?: string, localNames: string[] = []): string {
  let result = text;

  if (homeDir) {
    result = result.replace(new RegExp(escapeRegex(homeDir), windowsPath(homeDir) ? 'gi' : 'g'), '<user>');
  }
  result = maskLocalNames(result, localNames);

  result = result
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

function maskLocalNames(text: string, localNames: readonly string[]): string {
  let result = text;
  for (const raw of localNames) {
    const name = raw.trim();
    if (name.length === 0) continue;
    const escaped = escapeRegex(name);
    result = result.replace(new RegExp(`(${IDENTITY_KEY}["']?(?:\\s*[:=]\\s*|\\s+)["']?)${escaped}(?![A-Za-z0-9_])`, 'gi'), `$1${LOCAL}`);
    if (isGenericName(name)) continue;
    result = result.replace(new RegExp(`(?<=[\\\\/])${escaped}(?=[\\\\/]|$|[\\s"'])`, 'gim'), LOCAL);
    if (name.length >= MIN_FREE_WORD_LENGTH) {
      result = result.replace(new RegExp(`(?<![A-Za-z0-9_./\\\\])${escaped}(?![A-Za-z0-9_/\\\\]|\\.[A-Za-z0-9_])`, 'gi'), LOCAL);
    }
  }
  return result;
}

export function isGenericName(name: string): boolean {
  return GENERIC_NAMES.has(name.trim().toLowerCase());
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function windowsPath(value: string): boolean {
  return /^[A-Za-z]:\\/.test(value);
}
