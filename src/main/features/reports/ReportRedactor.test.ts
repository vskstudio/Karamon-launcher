import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactReportText } from './ReportRedactor.ts';

test('masque les dossiers personnels Windows, macOS et Linux', () => {
  const text = String.raw`C:\Users\Alice\AppData\Roaming
/Users/bob/Library/Application Support
/home/charlie/.minecraft`;
  assert.equal(
    redactReportText(text),
    String.raw`C:\Users\<user>\AppData\Roaming
/Users/<user>/Library/Application Support
/home/<user>/.minecraft`,
  );
});

test('masque les chemins Windows échappés en JSON ou écrits avec des slashs', () => {
  const text = String.raw`{"dir":"C:\\Users\\Alice\\AppData"} C:/Users/Bob/.minecraft`;
  const output = redactReportText(text);
  assert.ok(!output.includes('Alice'), output);
  assert.ok(!output.includes('Bob'), output);
  assert.equal(output, String.raw`{"dir":"C:\\Users\\<user>\\AppData"} C:/Users/<user>/.minecraft`);
});

test('masque le home injecté qui contient un espace (macOS)', () => {
  assert.equal(
    redactReportText('/Users/Jean Dupont/Library/Application Support/Karamon', '/Users/Jean Dupont'),
    '<user>/Library/Application Support/Karamon',
  );
});

test('masque le home injecté même hors des chemins habituels', () => {
  assert.equal(
    redactReportText('/srv/players/alice/game/logs/latest.log', '/srv/players/alice'),
    '<user>/game/logs/latest.log',
  );
});

test('masque les jetons JSON, clé-valeur, CLI et Authorization', () => {
  const input = [
    '"accessToken": "abc.DEF-123_secret"',
    'refreshToken=refresh-value-123',
    'session: session-value-456',
    '--accessToken java-token-789 --uuid public-uuid',
    'Authorization: Bearer bearer-token-000',
    'Bearer standalone-token-111',
  ].join('\n');
  const output = redactReportText(input);
  for (const secret of [
    'abc.DEF-123_secret',
    'refresh-value-123',
    'session-value-456',
    'java-token-789',
    'bearer-token-000',
    'standalone-token-111',
  ]) {
    assert.ok(!output.includes(secret), `le secret ${secret} reste visible`);
  }
  assert.match(output, /"accessToken": "\[masqué\]"/);
  assert.match(output, /--accessToken \[masqué\]/);
});

test('masque les adresses IPv4 et IPv6 sans masquer une version Minecraft', () => {
  const output = redactReportText(
    'serveur=192.168.1.42 public=203.0.113.8 ipv6=2001:db8:85a3::8a2e:370:7334 loop=[::1] mc=1.21.1',
  );
  assert.equal(output, 'serveur=<ip> public=<ip> ipv6=<ip> loop=[<ip>] mc=1.21.1');
});

test('applique tous les masques en un seul passage', () => {
  const output = redactReportText(
    String.raw`C:\Users\Alice\game lancé sur 10.0.0.2 avec --accessToken ultra-secret-token`,
    String.raw`C:\Users\Alice`,
  );
  assert.equal(output, String.raw`<user>\game lancé sur <ip> avec --accessToken [masqué]`);
});

test('masque le pseudo Discord, le chat des joueurs et les noms de la machine', () => {
  const input = [
    '[15:43:06] [Discord] connecté en tant que joueur_discord_test',
    '[15:50:01] [Render thread/INFO]: [System] [CHAT] <JoueurTest> mon mot de passe est hunter2',
    '[15:50:02] Hostname: Machine-De-Test, user utilisateur_test',
  ].join('\n');
  const output = redactReportText(input, undefined, ['Machine-De-Test', 'utilisateur_test', 'ab']);
  for (const leaked of ['joueur_discord_test', 'JoueurTest', 'hunter2', 'Machine-De-Test', 'utilisateur_test']) {
    assert.ok(!output.includes(leaked), output);
  }
  assert.ok(output.includes('[CHAT] [masqué]'), output);
  assert.ok(output.includes('Hostname: <local>, user <local>'), output);
});
