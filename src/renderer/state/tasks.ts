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

async function runTask(kind: TaskKind, work: () => Promise<boolean>): Promise<boolean> {
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
    log(`Erreur : ${message}`, 'error');
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

export function play(): Promise<boolean> {
  if (!activeAccount.value) {
    openAccounts();
    return Promise.resolve(false);
  }
  return runTask('play', async () => {
    log('Lancement en cours…', 'info');
    const result = await api.play();
    if (!result.ok) {
      log(`Erreur : ${result.error}`, 'error');
      toast(result.error, 'error');
      if (result.loginRequired) {
        applySession(await api.authGetSession());
        openAccounts();
      }
      return false;
    }
    await waitForGameStart();
    return true;
  });
}

export function syncPack(): Promise<boolean> {
  return runTask('sync', async () => {
    log('Synchronisation du pack en cours…', 'info');
    const result = await api.syncMods();
    if (!result.ok) {
      log(`Erreur de synchronisation : ${result.error}`, 'error');
      toast(result.error, 'error');
      return false;
    }
    log('Pack synchronisé.', 'success');
    toast('Pack à jour.');
    return true;
  });
}

export function repairInstall(): Promise<boolean> {
  return runTask('repair', async () => {
    log('Réparation de l’installation en cours…', 'info');
    const result = await api.repair();
    if (!result.ok) {
      log(`Erreur de réparation : ${result.error}`, 'error');
      toast(result.error, 'error');
      return false;
    }
    log(result.summary, 'success');
    toast(result.summary);
    return true;
  });
}

export function loginMicrosoft(): Promise<boolean> {
  return runTask('login', async () => {
    const result = await api.authLogin();
    if (!result.ok) {
      log(`Erreur de connexion : ${result.error}`, 'error');
      toast(result.error, 'error');
      return false;
    }
    applySession(await api.authGetSession(), `Connecté en tant que ${result.profile.name}.`);
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
