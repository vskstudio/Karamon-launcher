import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameKeepAlive } from './GameKeepAlive.ts';
import { SingleInstance, type InstanceLockHost } from './SingleInstance.ts';

function host(lockFree: boolean) {
  const events: string[] = [];
  let relaunch: (() => void) | null = null;
  const fake: InstanceLockHost = {
    requestSingleInstanceLock: () => lockFree,
    on: (_event, listener) => {
      relaunch = listener;
    },
    quit: () => events.push('quit'),
  };
  return { fake, events, relaunch: () => relaunch?.() };
}

test('un launcher rouvert alors qu’un autre tourne quitte aussitôt sans démarrer', () => {
  const { fake, events } = host(false);
  assert.equal(SingleInstance.claim(fake), null);
  assert.deepEqual(events, ['quit']);
});

test('rouvrir le launcher pendant la partie ramène la fenêtre du launcher déjà ouvert', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fake, events, relaunch } = host(true);
  const window = { hide: () => events.push('hide'), reveal: () => events.push('reveal'), close: () => events.push('close') };
  const keepAlive = new GameKeepAlive({ window, quit: () => events.push('quit'), quitsWhenLastWindowCloses: true });
  const lock = SingleInstance.claim(fake);
  assert.ok(lock);
  lock.whenRelaunched(() => keepAlive.windowRequested());

  keepAlive.gameStarted(true);
  t.mock.timers.tick(5000);
  relaunch();
  keepAlive.lastGameExited({ crashed: false });

  assert.deepEqual(events, ['hide', 'reveal']);
});

test('une réouverture avant que la fenêtre existe ne fait rien', () => {
  const { fake, events, relaunch } = host(true);
  assert.ok(SingleInstance.claim(fake));
  relaunch();
  assert.deepEqual(events, []);
});
