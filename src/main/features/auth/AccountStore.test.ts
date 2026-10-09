import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AccountStore, MICROSOFT_ACTIVE } from './AccountStore.ts';

function tempStore(): { store: AccountStore; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-accounts-'));
  const file = path.join(dir, 'accounts.json');
  return { store: new AccountStore(file), file };
}

test('without the file, the Microsoft account plays as before', () => {
  const { store } = tempStore();
  assert.deepEqual(store.load(), { active: MICROSOFT_ACTIVE, offline: [] });
});

test('a corrupt file falls back to the Microsoft account', () => {
  const { store, file } = tempStore();
  fs.writeFileSync(file, '{ pas du json');
  assert.deepEqual(store.load(), { active: MICROSOFT_ACTIVE, offline: [] });
});

test('an offline account is remembered with its offline UUID and becomes active', () => {
  const { store } = tempStore();
  const entry = store.addOffline('Notch');
  assert.deepEqual(entry, { id: 'b50ad385-829d-3141-a216-7e7d7539ba7f', name: 'Notch' });
  assert.deepEqual(store.load(), { active: entry.id, offline: [entry] });
});

test('adding the same name twice keeps one entry', () => {
  const { store } = tempStore();
  store.addOffline('Kara_42');
  store.addOffline('Steve');
  store.addOffline('Kara_42');
  assert.deepEqual(store.load().offline.map((a) => a.name), ['Steve', 'Kara_42']);
});

test('switching to Microsoft keeps the offline accounts', () => {
  const { store } = tempStore();
  store.addOffline('Kara_42');
  store.setActive(MICROSOFT_ACTIVE);
  const state = store.load();
  assert.equal(state.active, MICROSOFT_ACTIVE);
  assert.equal(state.offline.length, 1);
});

test('removing the active offline account signs out, removing another one does not', () => {
  const { store } = tempStore();
  const kara = store.addOffline('Kara_42');
  const steve = store.addOffline('Steve');
  store.removeOffline(kara.id);
  assert.deepEqual(store.load(), { active: steve.id, offline: [steve] });
  store.removeOffline(steve.id);
  assert.deepEqual(store.load(), { active: null, offline: [] });
});

test('entries with an invalid name are dropped and the UUID is recomputed from the name', () => {
  const { store, file } = tempStore();
  fs.writeFileSync(
    file,
    JSON.stringify({
      active: 'x',
      offline: [{ id: 'forged', name: 'Notch' }, { id: 'y', name: 'é' }, { name: 42 }, null],
    }),
  );
  assert.deepEqual(store.load().offline, [{ id: 'b50ad385-829d-3141-a216-7e7d7539ba7f', name: 'Notch' }]);
});
