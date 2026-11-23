import { computed, signal } from '@preact/signals';
import type { PingResult } from '../../ipc/contract';
import { api } from './api';
import { gameRunning } from './tasks';

export type ServerState = 'unknown' | 'online' | 'offline';

const POLL_INTERVAL_MS = 30000;
const HISTORY_SIZE = 30;

export const serverPing = signal<PingResult | null>(null);
export const playerHistory = signal<number[]>([]);
export const serverState = computed<ServerState>(() => {
  const ping = serverPing.value;
  if (!ping) return 'unknown';
  return ping.online ? 'online' : 'offline';
});
export const peakPlayers = computed(() => Math.max(0, ...playerHistory.value));

function notify(title: string, body: string): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body });
    return;
  }
  if (Notification.permission !== 'denied') {
    void Notification.requestPermission().then((permission) => {
      if (permission === 'granted') new Notification(title, { body });
    });
  }
}

export async function refreshServer(): Promise<void> {
  const previous = serverState.value;
  const ping = await api.pingServer().catch((): PingResult => ({ online: false }));
  serverPing.value = ping;
  playerHistory.value = [...playerHistory.value, ping.online ? ping.players : 0].slice(-HISTORY_SIZE);
  if (previous === 'offline' && ping.online) notify('Serveur en ligne', 'Karamon est de retour !');
  if (previous === 'online' && !ping.online) notify('Serveur hors ligne', 'Karamon vient de s’arrêter.');
}

export function startServerPolling(): void {
  void refreshServer();
  setInterval(() => {
    if (gameRunning.value || document.hidden) return;
    void refreshServer();
  }, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !gameRunning.value) void refreshServer();
  });
}
