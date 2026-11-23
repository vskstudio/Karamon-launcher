import type { Readable } from 'stream';

export function forEachOutputLine(stream: Readable, onLine: (line: string) => void): void {
  let partial = '';
  const emit = (line: string): void => {
    if (line.trim()) onLine(line);
  };
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    const lines = (partial + chunk).split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) emit(line);
  });
  stream.on('end', () => {
    emit(partial);
    partial = '';
  });
}
