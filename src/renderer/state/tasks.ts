import { computed, signal } from '@preact/signals';
import { toast } from '../ui';
import { api } from './api';
import { log } from './console';
import { activeAccount, applySession, openAccounts } from './session';
import { refreshStats } from './stats';

export type TaskKind = 'play' | 'sync' | 'repair' | 'login';

export const activeTask = signal<TaskKind | null>(null);
export const taskProgress = signal(0);
export const gameRunning = signal(false);
export const isBusy = computed(() => activeTask.value !== null);

const GAME_START_GRACE_MS = 20000;
const completedListeners = new Set<(kind: TaskKind, ok: boolean) => void>();

export function onTaskCompleted(listener: (kind: TaskKind, ok: boolean) => void): () => void {
  completedListeners.add(listener);
  return () => completedListeners.delete(listener);
}

async function runTask(kind: TaskKind, failureLabel: string, work: () => Promise<boolean>): Promise<boolean> {
  if (activeTask.value) {
    toast('Une autre action est déjà en cours.', 'info');
    return false;
  }
  activeTask.value = kind;
  taskProgress.value = 0;
  let ok = false;
  try {
    ok = await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`${failureLabel} : ${message}`, 'error');
    toast(message, 'error');
  } finally {
    activeTask.value = null;
    taskProgress.value = 0;
  }
  for (const listener of completedListeners) listener(kind, ok);
  return ok;
}

function waitForGameStart(): Promise<void> {
  if (gameRunning.value) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, GAME_START_GRACE_MS);
    const stop = gameRunning.subscribe((running) => {
      if (running) finish();
    });
    function finish() {
      clearTimeout(timer);
      stop();
      resolve();
    }
  });
}

async function reopenAccountsIfSignedOut(): Promise<void> {
  applySession(await api.authGetSession());
  if (!activeAccount.value) openAccounts();
}

export function play(): Promise<boolean> {
  if (!activeAccount.value) {
    openAccounts();
    return Promise.resolve(false);
  }
  return runTask('play', 'Erreur', async () => {
    log('Lancement en cours…', 'info');
    try {
      await api.play();
    } catch (error) {
      await reopenAccountsIfSignedOut();
      throw error;
    }
    await waitForGameStart();
    return true;
  });
}

export function syncPack(): Promise<boolean> {
  return runTask('sync', 'Erreur de synchronisation', async () => {
    log('Synchronisation du pack en cours…', 'info');
    await api.syncMods();
    log('Pack synchronisé.', 'success');
    toast('Pack à jour.');
    return true;
  });
}

export function repairInstall(): Promise<boolean> {
  return runTask('repair', 'Erreur de réparation', async () => {
    log('Réparation de l’installation en cours…', 'info');
    const result = await api.repair();
    log(result.summary, 'success');
    toast(result.summary);
    return true;
  });
}

export function loginMicrosoft(): Promise<boolean> {
  return runTask('login', 'Erreur de connexion', async () => {
    const profile = await api.authLogin();
    applySession(await api.authGetSession(), `Connecté en tant que ${profile.name}.`);
    return true;
  });
}

export function wireTaskEvents(): void {
  api.onProgress((value) => {
    taskProgress.value = Math.round(Math.max(0, Math.min(1, value)) * 100);
  });
  api.onGameState(({ running }) => {
    const wasRunning = gameRunning.value;
    gameRunning.value = running;
    if (running && !wasRunning) {
      log('Minecraft est lancé.', 'success');
      toast('Minecraft est lancé, bon jeu !');
    }
    void refreshStats();
  });
}
