import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PingResult } from './ServerPing.ts';
import { ServerStatus } from './ServerStatus.ts';

const online = (players: number): PingResult => ({ online: true, players, maxPlayers: 100, motd: '', version: '1.21.1' });

function statusFor(host: string, answers: Record<string, () => Promise<PingResult>>) {
  const pinged: string[] = [];
  const status = new ServerStatus({
    pinger: {
      ping: (candidate) => {
        pinged.push(candidate);
        return answers[candidate]?.() ?? Promise.resolve({ online: false });
      },
    },
    server: () => ({ host, port: 25565 }),
    publicServerHost: 'karamon.fr',
    statusFallbackHost: 'play.karamon.fr',
  });
  return { status, pinged };
}

test('the public address is also asked through the status host, and an answer from either counts', async () => {
  const { status, pinged } = statusFor(' Karamon.FR ', { 'karamon.fr': async () => online(12) });
  assert.deepEqual(await status.ping(), online(12));
  assert.deepEqual(pinged.sort(), ['karamon.fr', 'play.karamon.fr']);
});

test('the first host online wins without waiting for a slow one', async () => {
  const never = () => new Promise<PingResult>(() => undefined);
  const { status } = statusFor('karamon.fr', { 'karamon.fr': never, 'play.karamon.fr': async () => online(3) });
  assert.deepEqual(await status.ping(), online(3));
});

test('the server is offline only once every host failed', async () => {
  const { status } = statusFor('karamon.fr', { 'play.karamon.fr': () => Promise.reject(new Error('ECONNRESET')) });
  assert.deepEqual(await status.ping(), { online: false });
});

test('a custom address is asked alone', async () => {
  const { status, pinged } = statusFor('mc.example.org', {});
  assert.deepEqual(await status.ping(), { online: false });
  assert.deepEqual(pinged, ['mc.example.org']);
});
