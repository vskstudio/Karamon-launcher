import { computed, signal } from '@preact/signals';

export type LogTone = 'info' | 'success' | 'warning' | 'error' | 'game';

export interface LogLine {
  id: number;
  time: string;
  text: string;
  tone: LogTone;
}

const MAX_LINES = 500;
const GAME_PREFIX = '[MC]';

export const logLines = signal<LogLine[]>([]);
export const consoleOpen = signal(false);
export const lastStatus = computed(() => {
  for (let index = logLines.value.length - 1; index >= 0; index--) {
    const line = logLines.value[index];
    if (line && line.tone !== 'game') return line.text;
  }
  return '';
});

let nextId = 1;

export function inferTone(text: string): LogTone {
  if (text.startsWith(GAME_PREFIX)) return 'game';
  if (/error|erreur|échec/i.test(text)) return 'error';
  if (/warn|avertissement/i.test(text)) return 'warning';
  if (/\bok\b|terminé|connecté|synchronis|prêt/i.test(text)) return 'success';
  return 'info';
}

export function log(text: string, tone: LogTone = inferTone(text)): void {
  const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  logLines.value = [...logLines.value, { id: nextId++, time, text, tone }].slice(-MAX_LINES);
}

export function clearLog(): void {
  logLines.value = [];
  log('Console effacée.', 'info');
}

export function logText(): string {
  return logLines.value.map((line) => `[${line.time}] ${line.text}`).join('\n');
}

export function toggleConsole(): void {
  consoleOpen.value = !consoleOpen.value;
}
