import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execFileP = promisify(execFile);

const PROBE_TIMEOUT_MS = 4000;
const SYSTEM_VENDOR = 'system';

const WINDOWS_INSTALL_ROOTS = [
  'C:\\Program Files\\Java',
  'C:\\Program Files\\Eclipse Adoptium',
  'C:\\Program Files\\Microsoft',
  'C:\\Program Files\\Zulu',
  'C:\\Program Files\\Amazon Corretto',
  'C:\\Program Files (x86)\\Java',
];

const POSIX_INSTALL_ROOTS = ['/usr/lib/jvm', '/usr/java', '/Library/Java/JavaVirtualMachines', '/opt/java', '/opt/homebrew/opt'];

const BIN_DIRS_IN_A_JAVA_HOME = [['bin'], ['Contents', 'Home', 'bin'], ['jre', 'bin']];

const KNOWN_VENDORS: [RegExp, string][] = [
  [/Temurin|Adoptium/i, 'Temurin'],
  [/Zulu/i, 'Azul Zulu'],
  [/Corretto/i, 'Corretto'],
  [/OpenJDK/i, 'OpenJDK'],
  [/HotSpot/i, 'Oracle'],
  [/GraalVM/i, 'GraalVM'],
];

export interface JavaInstall {
  path: string;
  version: string;
  major: number;
  vendor: string;
}

export function javaInstallRoots(): string[] {
  return process.platform === 'win32' ? WINDOWS_INSTALL_ROOTS : POSIX_INSTALL_ROOTS;
}

export function javaExecutableName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

export function javaExecutablesUnder(root: string): string[] {
  let homes: string[];
  try {
    homes = fs.readdirSync(root);
  } catch {
    return [];
  }
  const exe = javaExecutableName();
  return homes.flatMap((home) =>
    BIN_DIRS_IN_A_JAVA_HOME.map((bin) => path.join(root, home, ...bin, exe)).filter((candidate) => fs.existsSync(candidate)),
  );
}

export function findJavaCandidates(roots: string[]): string[] {
  const candidates = roots.flatMap(javaExecutablesUnder);
  candidates.push(javaExecutableName());
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', javaExecutableName()));
  return [...new Set(candidates)];
}

export async function probeJava(javaPath: string): Promise<JavaInstall | null> {
  let banner: string;
  try {
    const { stderr, stdout } = await execFileP(javaPath, ['-version'], { timeout: PROBE_TIMEOUT_MS });
    banner = (stderr || stdout || '').trim();
  } catch {
    return null;
  }
  const version = banner.match(/version "([^"]+)"/)?.[1] ?? '?';
  const vendor = KNOWN_VENDORS.find(([pattern]) => pattern.test(banner))?.[1] ?? '';
  const isOnPath = javaPath === javaExecutableName();
  return { path: javaPath, version, major: javaMajor(version), vendor: vendor || (isOnPath ? SYSTEM_VENDOR : '') };
}

export function javaMajor(version: string): number {
  const parts = versionNumbers(version);
  if (parts[0] === 1) return parts[1] ?? 0;
  return parts[0] ?? 0;
}

function versionNumbers(version: string): number[] {
  return (version.match(/\d+/g) ?? []).map(Number);
}

export function newestJavaFirst(a: JavaInstall, b: JavaInstall): number {
  if (a.major !== b.major) return b.major - a.major;
  const left = versionNumbers(a.version);
  const right = versionNumbers(b.version);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
