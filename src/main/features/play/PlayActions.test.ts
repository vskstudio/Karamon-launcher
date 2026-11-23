import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigNotReadYetError } from '../config/Config.ts';
import { PlayActions, type PlayActionsOptions } from './PlayActions.ts';

function actionsWithUnreadableConfig() {
  const calls: string[] = [];
  const status: string[] = [];
  const refuse = (name: string) => async () => {
    calls.push(name);
  };
  const options = {
    config: {
      getRead: () => {
        throw new ConfigNotReadYetError();
      },
    },
    minecraft: { launch: refuse('launch'), syncOnly: refuse('syncOnly'), repair: refuse('repair'), isRunning: () => false },
    packManifest: { latest: async () => null },
    reports: { reportInBackground: () => calls.push('report') },
    status: (line: string) => status.push(line),
    progress: () => undefined,
  } as unknown as PlayActionsOptions;
  return { actions: new PlayActions(options), calls, status };
}

const message = /Tes réglages sont illisibles pour l'instant \(fichier verrouillé \?\)\. Réessaie dans un instant\./;

test('Jouer, Synchroniser et Réparer sont refusés tant que les réglages ne sont pas lus', async () => {
  const { actions, calls, status } = actionsWithUnreadableConfig();

  await assert.rejects(actions.play(), message);
  await assert.rejects(actions.syncMods(), message);
  await assert.rejects(actions.repair(), message);

  assert.deepEqual(calls, []);
  assert.equal(status.length, 3);
  assert.ok(status.every((line) => message.test(line)));
});
