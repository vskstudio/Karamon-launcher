import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ReportCollector } from './ReportCollector.ts';

const KIB = 1024;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-report-'));
  const dataDir = path.join(root, 'data');
  const gameDir = path.join(root, 'game');
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(gameDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(gameDir, 'crash-reports'), { recursive: true });
  const collector = new ReportCollector({
    dataDir,
    launcherVersion: '2.1.0',
    bundledPackVersion: '0.9.4',
    getPackVersion: async () => '0.9.5',
    getJavaVersion: async () => '21.0.8',
    getGpu: async () => 'GPU test',
    getPlayerName: () => 'Sacha',
    platform: 'linux',
    arch: 'x64',
    homeDir: '/home/alice',
    localNames: [],
    uuid: () => '123e4567-e89b-42d3-a456-426614174000',
  });
  return { root, dataDir, gameDir, collector };
}

function write(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('collecte les métadonnées et anonymise les fins de logs aux limites prévues', async () => {
  const f = fixture();
  write(path.join(f.dataDir, 'logs', 'launcher.log'), Buffer.concat([Buffer.from('é\n'), Buffer.alloc(256 * KIB - 1, 97)]));
  write(path.join(f.gameDir, 'logs', 'latest.log'), `${'b'.repeat(512 * KIB)}\n/home/alice 192.168.1.2`);
  write(path.join(f.gameDir, 'crash-reports', 'crash-old.txt'), 'Description: ancien');
  write(path.join(f.gameDir, 'crash-reports', 'notes-joueur.txt'), 'pas un crash-report');
  write(path.join(f.gameDir, 'crash-reports', 'crash-new.txt'), `Description: OpenGL\n--accessToken secret-token\n${`${'c'.repeat(1023)}\n`.repeat(1024)}`);
  write(path.join(f.gameDir, 'hs_err_pid42.log'), `${'d'.repeat(1024 * KIB)}\nAuthorization: Bearer java-secret`);
  fs.utimesSync(path.join(f.gameDir, 'crash-reports', 'crash-old.txt'), new Date(1), new Date(1));
  fs.utimesSync(path.join(f.gameDir, 'crash-reports', 'crash-new.txt'), new Date(2), new Date(2));
  fs.utimesSync(path.join(f.gameDir, 'crash-reports', 'notes-joueur.txt'), new Date(3), new Date(3));

  const summary = ['Erreur sur /home/alice à 10.0.0.1', '  ', ...Array.from({ length: 30 }, (_, i) => `tag ${i} ${'x'.repeat(300)}`)];
  const report = await f.collector.collect({ trigger: 'crash', summary, gameDir: f.gameDir, ramMb: 8192 });

  assert.equal(report.reportId, '123e4567-e89b-42d3-a456-426614174000');
  assert.deepEqual(
    { launcherVersion: report.launcherVersion, packVersion: report.packVersion, os: report.os, arch: report.arch, javaVersion: report.javaVersion, ramMb: report.ramMb, gpu: report.gpu, playerName: report.playerName },
    { launcherVersion: '2.1.0', packVersion: '0.9.5', os: 'linux', arch: 'x64', javaVersion: '21.0.8', ramMb: 8192, gpu: 'GPU test', playerName: 'Sacha' },
  );
  assert.equal(report.summary[0], 'Erreur sur <user> à <ip>');
  assert.equal(report.summary.length, 20);
  assert.ok(report.summary.every((tag) => tag.trim().length > 0 && tag.length <= 200));
  assert.deepEqual(report.files.map((file) => file.name), ['launcher.log', 'latest.log', 'crash-new.txt', 'hs_err_pid42.log']);
  assert.ok(!report.files[0].content.includes('�'), 'la fin UTF-8 commence sur un caractère valide');
  assert.ok(Buffer.byteLength(report.files[0].content) <= 256 * KIB);
  assert.ok(Buffer.byteLength(report.files[1].content) <= 512 * KIB);
  assert.ok(Buffer.byteLength(report.files[2].content) <= 1024 * KIB);
  assert.ok(Buffer.byteLength(report.files[3].content) <= 1024 * KIB);
  assert.ok(!JSON.stringify(report).includes('secret'));
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 5 * 1024 * KIB);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('écarte la ligne coupée au début de la fin lue pour ne pas laisser fuir un message du chat', async () => {
  const f = fixture();
  const chat = '[15:50:01] [Render thread/INFO]: [CHAT] <JoueurTest> mon mot de passe est hunter2\n';
  write(path.join(f.gameDir, 'logs', 'latest.log'), `${'a'.repeat(100)}\n${chat}${'b'.repeat(512 * KIB - 41)}\nfin du log`);
  const report = await f.collector.collect({ trigger: 'crash', summary: [], gameDir: f.gameDir, ramMb: 4096 });
  const latest = report.files.find((file) => file.name === 'latest.log');
  assert.ok(latest);
  assert.ok(!latest.content.includes('hunter2'), latest.content.slice(0, 80));
  assert.ok(latest.content.endsWith('\nfin du log'));
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('masque par défaut le vrai nom de la machine et le vrai nom d\'utilisateur', async () => {
  const f = fixture();
  const hostname = os.hostname().replace(/\.local$/i, '');
  const username = os.userInfo().username;
  const generic = new Set(['admin', 'default', 'desktop', 'dev', 'guest', 'home', 'java', 'laptop', 'linux', 'localhost', 'mac', 'macbook', 'minecraft', 'pc', 'root', 'server', 'ubuntu', 'user', 'windows']);
  const checked = [hostname, username].filter((name) => name.length > 0 && !generic.has(name.toLowerCase()));
  assert.ok(checked.length > 0, 'ce poste n\'a aucun nom à vérifier');
  write(path.join(f.gameDir, 'logs', 'latest.log'), `Hostname: ${hostname}\nuser ${username}\n`);
  const collector = new ReportCollector({
    dataDir: f.dataDir,
    launcherVersion: '2.1.0',
    bundledPackVersion: '0.9.4',
    homeDir: '/home/alice',
    uuid: () => '123e4567-e89b-42d3-a456-426614174002',
  });
  const report = await collector.collect({ trigger: 'manual', summary: [`machine ${hostname}, user ${username}`], gameDir: f.gameDir, ramMb: 4096 });
  const latest = report.files.find((file) => file.name === 'latest.log');
  assert.ok(latest);
  for (const name of checked) {
    assert.ok(!new RegExp(`(?<![A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'i').test(latest.content), latest.content);
    assert.ok(!report.summary.join('\n').toLowerCase().includes(name.toLowerCase()), report.summary.join('\n'));
  }
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('utilise les replis et omet proprement les métadonnées facultatives', async () => {
  const f = fixture();
  const collector = new ReportCollector({
    dataDir: f.dataDir,
    launcherVersion: '2.1.0',
    bundledPackVersion: '0.9.4',
    getPackVersion: async () => { throw new Error('offline'); },
    getJavaVersion: async () => '',
    getGpu: async () => undefined,
    getPlayerName: () => undefined,
    platform: 'darwin',
    arch: 'arm64',
    uuid: () => '123e4567-e89b-42d3-a456-426614174001',
  });
  const report = await collector.collect({ trigger: 'manual', summary: ['Envoi manuel'], gameDir: f.gameDir, ramMb: 6144 });
  assert.equal(report.packVersion, '0.9.4');
  assert.equal(report.javaVersion, 'inconnu');
  assert.ok(!('gpu' in report));
  assert.ok(!('playerName' in report));
  assert.deepEqual(report.files, []);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('réduit un JSON pathologique sous 5 Mio', async () => {
  const f = fixture();
  const controls = Buffer.alloc(1024 * KIB, 1);
  write(path.join(f.gameDir, 'crash-reports', 'crash-huge.txt'), controls);
  write(path.join(f.gameDir, 'hs_err_pid9.log'), controls);
  const report = await f.collector.collect({ trigger: 'crash_early', summary: ['Crash'], gameDir: f.gameDir, ramMb: 4096 });
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 5 * 1024 * KIB);
  fs.rmSync(f.root, { recursive: true, force: true });
});
