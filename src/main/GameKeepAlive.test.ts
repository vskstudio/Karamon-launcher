import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameKeepAlive } from './GameKeepAlive.ts';

function launcher(quitsWhenLastWindowCloses = true) {
  const events: string[] = [];
  let keepAlive: GameKeepAlive;
  const window = {
    hide: () => events.push('hide'),
    reveal: () => events.push('reveal'),
    close: () => {
      events.push('close');
      keepAlive.allWindowsClosed();
    },
  };
  keepAlive = new GameKeepAlive({ window, quit: () => events.push('quit'), quitsWhenLastWindowCloses });
  return { keepAlive, events };
}

test('fermer le launcher au lancement le cache sans quitter, puis quitte quand la partie finit normalement', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { keepAlive, events } = launcher();
  keepAlive.gameStarted(true);
  t.mock.timers.tick(5000);
  assert.deepEqual(events, ['hide']);

  keepAlive.lastGameExited({ crashed: false });
  assert.deepEqual(events, ['hide', 'close', 'quit']);
});

test('après un crash, le launcher caché revient pour proposer la réparation et le rapport', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { keepAlive, events } = launcher();
  keepAlive.gameStarted(true);
  t.mock.timers.tick(5000);
  keepAlive.lastGameExited({ crashed: true });
  assert.deepEqual(events, ['hide', 'reveal']);
});

test('fermer la fenêtre pendant la partie garde le processus jusqu’à la fin du jeu', () => {
  const { keepAlive, events } = launcher();
  keepAlive.gameStarted(false);
  keepAlive.allWindowsClosed();
  assert.deepEqual(events, []);
  keepAlive.lastGameExited({ crashed: false });
  assert.deepEqual(events, ['quit']);
});

test('sur macOS la fin de partie ferme la fenêtre cachée sans quitter l’app', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { keepAlive, events } = launcher(false);
  keepAlive.gameStarted(true);
  t.mock.timers.tick(5000);
  keepAlive.lastGameExited({ crashed: false });
  assert.deepEqual(events, ['hide', 'close']);
});
