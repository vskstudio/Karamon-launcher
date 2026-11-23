import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough } from 'stream';
import { once } from 'events';
import { forEachOutputLine } from './OutputLines.ts';

test('a game line split across output chunks reaches the console whole', async () => {
  const stream = new PassThrough();
  const lines: string[] = [];
  forEachOutputLine(stream, (line) => lines.push(line));
  const accent = Buffer.from('é');
  stream.write('[12:00:01] [main/INFO]: Loading 312 mo');
  stream.write('ds\n[12:00:02] [main/WARN]: Caf');
  stream.write(accent.subarray(0, 1));
  stream.write(Buffer.concat([accent.subarray(1), Buffer.from(' fermé\n\n[12:00:03] Stopping!')]));
  stream.end();
  await once(stream, 'end');
  assert.deepEqual(lines, [
    '[12:00:01] [main/INFO]: Loading 312 mods',
    '[12:00:02] [main/WARN]: Café fermé',
    '[12:00:03] Stopping!',
  ]);
});
