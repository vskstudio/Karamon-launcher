import { computed, signal } from '@preact/signals';
import type { CrashReport } from '../../ipc/contract';
import { api } from './api';
import { setRouteBadge } from './badges';
import { gameRunning } from './tasks';

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const OUT_OF_MEMORY = /OutOfMemoryError|\(OOM\)/;

export const crashReports = signal<CrashReport[] | null>(null);

export const recentCrashCount = computed(() => {
  const since = Date.now() - RECENT_WINDOW_MS;
  return (crashReports.value ?? []).filter((report) => report.mtime >= since).length;
});

export const latestCrashIsOutOfMemory = computed(() => {
  const reports = crashReports.value ?? [];
  const latest = reports.reduce<CrashReport | null>((newest, report) => (!newest || report.mtime > newest.mtime ? report : newest), null);
  return latest !== null && isOutOfMemory(latest);
});

export function isOutOfMemory(report: CrashReport): boolean {
  return OUT_OF_MEMORY.test(report.summary) || OUT_OF_MEMORY.test(report.excerpt);
}

function applyReports(reports: CrashReport[]): void {
  crashReports.value = [...reports].sort((a, b) => b.mtime - a.mtime);
  const recent = recentCrashCount.value;
  setRouteBadge('tools', recent > 0 ? String(recent) : null);
}

export async function refreshCrashes(): Promise<void> {
  applyReports((await api.listCrashes()).reports);
}

export async function deleteCrash(name: string): Promise<void> {
  applyReports((await api.deleteCrash(name)).reports);
}

export function wireCrashEvents(): void {
  void refreshCrashes().catch(() => undefined);
  let wasRunning = gameRunning.value;
  gameRunning.subscribe((running) => {
    if (wasRunning && !running) void refreshCrashes().catch(() => undefined);
    wasRunning = running;
  });
}
