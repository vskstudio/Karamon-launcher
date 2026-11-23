import { signal } from '@preact/signals';
import type { AppConfig, AppConfigUpdate, SystemInfo } from '../../ipc/contract';
import { api } from './api';

export const config = signal<AppConfig | null>(null);
export const system = signal<SystemInfo | null>(null);

export async function loadConfig(): Promise<AppConfig> {
  const [loaded, info] = await Promise.all([api.getConfig(), api.systemInfo()]);
  config.value = loaded;
  system.value = info;
  return loaded;
}

export async function saveConfig(update: AppConfigUpdate): Promise<AppConfig> {
  const saved = await api.saveConfig(update);
  config.value = saved;
  return saved;
}
