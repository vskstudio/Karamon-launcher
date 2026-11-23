import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routes } from '../../ipc/contract.ts';
import { UNEXPECTED_FAILURE } from '../../ipc/Route.ts';
import { bridgeRoutes } from '../../preload/LauncherBridge.ts';
import { IpcRouter } from './IpcRouter.ts';

function connectedLauncher() {
  const invokeHandlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
  const sendHandlers = new Map<string, (event: unknown) => void>();
  const listeners = new Map<string, (event: unknown, payload: unknown) => void>();
  const router = new IpcRouter({
    handle: (channel, listener) => void invokeHandlers.set(channel, listener),
    on: (channel, listener) => sendHandlers.set(channel, listener),
  });
  const api = bridgeRoutes(routes, {
    invoke: async (channel, input) => {
      const handler = invokeHandlers.get(channel);
      if (!handler) throw new Error(`Error invoking remote method '${channel}': No handler registered`);
      return await handler({}, input);
    },
    send: (channel) => sendHandlers.get(channel)?.({}),
    on: (channel, listener) => listeners.set(channel, listener),
  });
  const emit = (channel: string, payload: unknown): void => listeners.get(channel)?.({}, payload);
  return { router, api, emit };
}

test('a renderer call reaches its handler with the decoded input and gets its answer', async () => {
  const { router, api } = connectedLauncher();
  const received: string[] = [];
  router.handle(routes.readCrash, (name) => {
    received.push(name);
    return `contenu de ${name}`;
  });
  assert.equal(await api.readCrash('crash-1.txt'), 'contenu de crash-1.txt');
  assert.deepEqual(received, ['crash-1.txt']);
});

test('a handler failure reaches the renderer as its own French message', async () => {
  const { router, api } = connectedLauncher();
  router.handle(routes.repair, () => {
    throw new Error("Ferme Minecraft avant de réparer l'installation.");
  });
  await assert.rejects(api.repair(), { message: "Ferme Minecraft avant de réparer l'installation." });
});

test('an invalid request is refused before the handler runs', async () => {
  const { router, api } = connectedLauncher();
  let called = false;
  router.handle(routes.deleteBackup, () => {
    called = true;
    return { dir: '', backups: [] };
  });
  await assert.rejects(api.deleteBackup(42 as unknown as string), /Demande invalide/);
  assert.equal(called, false);
});

test('a call the main process cannot answer is reported without Electron internals', async () => {
  const { api } = connectedLauncher();
  await assert.rejects(api.listJava(), { message: UNEXPECTED_FAILURE });
});

test('window commands and main-process events cross the bridge', () => {
  const { router, api, emit } = connectedLauncher();
  let minimized = 0;
  router.on(routes.minimize, () => minimized++);
  api.minimize();
  assert.equal(minimized, 1);

  const progress: number[] = [];
  api.onProgress((value) => progress.push(value));
  emit(routes.onProgress.channel, 0.4);
  assert.deepEqual(progress, [0.4]);
});

test('a channel cannot get two handlers, and routes left without one are named', () => {
  const { router } = connectedLauncher();
  router.handle(routes.getConfig, () => ({}) as never);
  assert.throws(() => router.handle(routes.getConfig, () => ({}) as never), /config:get/);
  const unhandled = router.unhandled(routes);
  assert.ok(!unhandled.includes('getConfig'));
  assert.ok(unhandled.includes('play'));
  assert.ok(!unhandled.includes('onStatus'));
});

test('every route of the contract has its own channel', () => {
  const channels = Object.values(routes).map((route) => route.channel);
  assert.equal(new Set(channels).size, channels.length);
});
