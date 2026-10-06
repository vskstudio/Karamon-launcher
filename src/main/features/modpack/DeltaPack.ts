import type { FileVerifier } from '../integrity/FileVerifier.ts';
import type { RemoteZip } from '../../shared/RemoteZip.ts';
import type { ZipEntry } from '../../shared/ZipReader.ts';

/** One entry of a remote pack archive and where it goes on disk. */
export interface DeltaFile {
  entry: ZipEntry;
  target: string;
  /** Always fetched: no local copy to compare with, or the caller already decided. */
  always?: boolean;
  /** A zip to unpack into the folder `target` (fetched to a temp file first). */
  unpack?: boolean;
}

export interface DeltaPlan {
  needed: DeltaFile[];
  /** Compressed bytes the server will send for `needed`. */
  bytes: number;
  /** Uncompressed bytes already on disk and kept as they are. */
  keptBytes: number;
}

const PARALLEL = 4;

/**
 * Keeps only the entries whose file on disk differs from the archive (size or
 * CRC-32): everything else is already installed and is not downloaded again.
 */
export async function planDelta(zip: RemoteZip, files: DeltaFile[], verifier: FileVerifier): Promise<DeltaPlan> {
  const needed: DeltaFile[] = [];
  let keptBytes = 0;
  for (const file of files) {
    if (!file.always && (await verifier.matchesZipEntry(file.target, file.entry.size, file.entry.crc))) {
      keptBytes += file.entry.size;
      continue;
    }
    needed.push(file);
  }
  return { needed, bytes: zip.bytesFor(needed.map((f) => f.entry)), keptBytes };
}

/**
 * Downloads the planned entries straight to their targets, a few at a time.
 * Each file is written to a temp file, checked (size + CRC) and renamed, then
 * its CRC is cached so the next sync does not reread it.
 */
export async function fetchDelta(
  zip: RemoteZip,
  plan: DeltaPlan,
  verifier: FileVerifier,
  onProgress: (fraction: number) => void,
  onFile?: (file: DeltaFile) => void,
): Promise<void> {
  const queue = [...plan.needed].sort((a, b) => b.entry.compressedSize - a.entry.compressedSize);
  let received = 0;
  const report = (n: number): void => {
    received += n;
    onProgress(plan.bytes > 0 ? Math.min(1, received / plan.bytes) : 1);
  };
  const worker = async (): Promise<void> => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      await zip.extractTo(file.entry, file.target, { durable: true, onBytes: report });
      if (!file.unpack) verifier.remember(file.target, file.entry.crc);
      onFile?.(file);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, () => worker()));
  onProgress(1);
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} Go`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
  return `${Math.max(1, Math.round(n / 1024))} Ko`;
}
