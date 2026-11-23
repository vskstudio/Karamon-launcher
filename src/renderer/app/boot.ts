import { api } from '../state/api';
import { log } from '../state/console';
import { loadConfig } from '../state/config';
import { wireCrashEvents } from '../state/crashes';
import { suggestPotatoModeIfModest, wireNoticeEvents } from '../state/notices';
import { startServerPolling } from '../state/server';
import { refreshSession } from '../state/session';
import { refreshStats } from '../state/stats';
import { wireTaskEvents } from '../state/tasks';

export async function boot(): Promise<void> {
  api.onStatus((message) => log(message));
  wireTaskEvents();
  wireNoticeEvents();
  wireCrashEvents();
  log('Karamon Launcher démarré.', 'success');

  await Promise.all([refreshSession(), loadConfig(), refreshStats()]);
  suggestPotatoModeIfModest();

  const setup = await api.setupMinecraft();
  log(`Instance : ${setup.path}`, setup.ok ? 'success' : 'warning');
  log(`Installation : ${setup.details}`, setup.ok ? 'success' : 'warning');

  startServerPolling();
  log('Prêt.', 'success');
}
