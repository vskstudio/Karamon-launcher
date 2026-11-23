import crypto from 'crypto';
import fs from 'fs';
import { pipeline } from 'stream/promises';

export type DigestAlgorithm = 'sha1' | 'sha256';

export async function fileDigest(filePath: string, algorithm: DigestAlgorithm): Promise<string> {
  const hash = crypto.createHash(algorithm);
  await pipeline(fs.createReadStream(filePath, { highWaterMark: 1 << 20 }), hash);
  return hash.digest('hex');
}
