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
    redactReportText('/Users/Jean Dupont/Library/Application Support/Karamon', { homeDir: '/Users/Jean Dupont' }),
    '<user>/Library/Application Support/Karamon',
  );
});

test('masque le home injecté même hors des chemins habituels', () => {
  assert.equal(
    redactReportText('/srv/players/alice/game/logs/latest.log', { homeDir: '/srv/players/alice' }),
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
    { homeDir: String.raw`C:\Users\Alice` },
  );
  assert.equal(output, String.raw`<user>\game lancé sur <ip> avec --accessToken [masqué]`);
});

test('masque les adresses e-mail', () => {
  const output = redactReportText('Compte sacha.ketchum+mc@outlook.fr connecté, contact support@karamon.fr');
  assert.ok(!output.includes('sacha.ketchum'), output);
  assert.ok(!output.includes('support@karamon.fr'), output);
  assert.match(output, /Compte <email> connecté/);
});

test('reste linéaire sur un log de 1 Mio sans séparateur (pas de retour arrière quadratique)', () => {
  const fillers = [
    'c', 'a', '1', 'f:', '-Dtoken', 'token', '--accessToken "', '-Dtoken="', 'accessToken: "',
    'http://', 'https://a.b/', 'eyJ.', 'M.C1_a', 'a@', '/Users/', 'C:\\Users\\',
  ];
  for (const filler of fillers) {
    const body = filler.repeat(Math.ceil((1024 * 1024) / filler.length));
    const text = filler === 'token' ? `-D${body}` : body;
    const start = performance.now();
    redactReportText(text, { homeDir: '/home/alice', hostName: 'PC-DE-SACHA' });
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1500, `motif « ${filler} » : ${Math.round(elapsed)} ms`);
  }
});

test('un dossier personnel court ne déborde pas sur les chemins voisins', () => {
  assert.equal(redactReportText('/root/x et /rootfs/y', { homeDir: '/root' }), '<user>/x et /rootfs/y');
  assert.equal(redactReportText('/var/log', { homeDir: '/' }), '/var/log');
});

test('masque un nom macOS avec espace et une valeur de jeton entre guillemets', () => {
  const output = redactReportText(
    'at /Users/Jean Dupont/Library/x.jar et {"accessToken": "abc def ghi", "session": \'x y\'} -Dauth.token="a b"',
  );
  assert.ok(!output.includes('Jean') && !output.includes('Dupont'), output);
  assert.ok(!/abc|def|ghi|x y|a b/.test(output), output);
  assert.match(output, /"accessToken": "\[masqué\]"/);
  assert.match(output, /\/Users\/<user>\/Library/);
});

test('ne touche pas une propriété JVM sans secret', () => {
  assert.equal(redactReportText('-Dfile.encoding=UTF-8 -Dauth.token=abc'), `-Dfile.encoding=UTF-8 -Dauth.token=[masqué]`);
});

test('masque les paramètres des URL mais garde le chemin', () => {
  const output = redactReportText(
    'GET https://login.live.com/oauth20_desktop.srf?code=M.C507_BAY.2.U.abc&state=xyz#frag puis https://karamon.fr/downloads/pack.json',
  );
  assert.ok(!output.includes('M.C507'), output);
  assert.ok(!output.includes('state=xyz'), output);
  assert.match(output, /https:\/\/login\.live\.com\/oauth20_desktop\.srf\?\[masqué\]/);
  assert.match(output, /https:\/\/karamon\.fr\/downloads\/pack\.json/);
});

test('masque le nom de la machine, quelle que soit la casse', () => {
  const output = redactReportText('Hôte DESKTOP-7QK2LM9 / desktop-7qk2lm9.local prêt', { hostName: 'DESKTOP-7QK2LM9' });
  assert.equal(output, 'Hôte <host> / <host>.local prêt');
});

test('un nom de machine trop court ou générique ne masque pas tout le texte', () => {
  assert.equal(redactReportText('mod pc chargé', { hostName: 'pc' }), 'mod pc chargé');
  assert.equal(redactReportText('mod localhost chargé', { hostName: 'localhost' }), 'mod localhost chargé');
});

test('masque les jetons Microsoft, Xbox et Minecraft (JWT)', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ4dWlkIjoiMjUzNTQwIn0.c2lnbmF0dXJlLXNlY3JldA';
  const input = [
    `token ${jwt}`,
    'refresh M.C507_BL2.0.U.-CgMlnK7xM!secret-refresh-value$',
    'xbl EwAIA+pvBAAUKods63Ys1fGlwiccIFJ+qE1hANsAAeqe5kQsecretxbl==',
    'XBL3.0 x=2535400000000000;eyJhbGciOiJSUzI1NiJ9.eyJzIjoxfQ.sig-part',
  ].join('\n');
  const output = redactReportText(input);
  for (const secret of ['eyJhbGciOiJIUzI1NiJ9', 'secret-refresh-value', 'secretxbl', '2535400000000000', 'sig-part']) {
    assert.ok(!output.includes(secret), `le jeton ${secret} reste visible:\n${output}`);
  }
});

test('masque les arguments JVM et de lancement porteurs de jetons ou d’identité', () => {
  const input =
    'java -Dfml.accessToken=jvm-secret-1 -Dminecraft.api.session=jvm-secret-2 -Dauth.token=jvm-secret-3 ' +
    '--username Sacha --uuid 0f1e2d3c4b5a69788796a5b4c3d2e1f0 --xuid 2535400000000001 --clientId Y2xpZW50LWlk --version 1.21.1';
  const output = redactReportText(input);
  for (const secret of ['jvm-secret-1', 'jvm-secret-2', 'jvm-secret-3', 'Sacha', '0f1e2d3c4b5a6978', '2535400000000001', 'Y2xpZW50LWlk']) {
    assert.ok(!output.includes(secret), `${secret} reste visible:\n${output}`);
  }
  assert.match(output, /--version 1\.21\.1/);
});
