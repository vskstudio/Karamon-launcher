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
    installedPackVersion: () => '0.9.5',
    getJavaVersion: async () => '21.0.8',
    getGpu: async () => 'GPU test',
    hostName: 'PC-DE-SACHA',
    platform: 'linux',
    arch: 'x64',
    homeDir: '/home/alice',
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
  write(path.join(f.dataDir, 'logs', 'launcher.log'), Buffer.concat([Buffer.from('é'), Buffer.alloc(256 * KIB - 1, 97)]));
  write(path.join(f.gameDir, 'logs', 'latest.log'), `${'b'.repeat(512 * KIB)}\n/home/alice 192.168.1.2`);
  write(path.join(f.gameDir, 'crash-reports', 'crash-old.txt'), 'Description: ancien');
  write(path.join(f.gameDir, 'crash-reports', 'notes-joueur.txt'), 'pas un crash-report');
  write(path.join(f.gameDir, 'crash-reports', 'crash-new.txt'), `Description: OpenGL\n--accessToken secret-token\n${'c'.repeat(1024 * KIB)}`);
  write(path.join(f.gameDir, 'hs_err_pid42.log'), `${'d'.repeat(1024 * KIB)}\nAuthorization: Bearer java-secret`);
  fs.utimesSync(path.join(f.gameDir, 'crash-reports', 'crash-old.txt'), new Date(1), new Date(1));
  fs.utimesSync(path.join(f.gameDir, 'crash-reports', 'crash-new.txt'), new Date(2), new Date(2));
  fs.utimesSync(path.join(f.gameDir, 'crash-reports', 'notes-joueur.txt'), new Date(3), new Date(3));

  const summary = ['Erreur sur /home/alice à 10.0.0.1', '  ', ...Array.from({ length: 30 }, (_, i) => `tag ${i} ${'x'.repeat(300)}`)];
  const report = await f.collector.collect({ trigger: 'crash', summary, gameDir: f.gameDir, ramMb: 8192 });

  assert.equal(report.reportId, '123e4567-e89b-42d3-a456-426614174000');
  assert.deepEqual(
    { launcherVersion: report.launcherVersion, packVersion: report.packVersion, os: report.os, arch: report.arch, javaVersion: report.javaVersion, ramMb: report.ramMb, gpu: report.gpu },
    { launcherVersion: '2.1.0', packVersion: '0.9.5', os: 'linux', arch: 'x64', javaVersion: '21.0.8', ramMb: 8192, gpu: 'GPU test' },
  );
  assert.ok(!('playerName' in report), 'le pseudo ne sert pas au diagnostic');
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

test('utilise les replis et omet proprement les métadonnées facultatives', async () => {
  const f = fixture();
  const collector = new ReportCollector({
    dataDir: f.dataDir,
    launcherVersion: '2.1.0',
    installedPackVersion: () => undefined,
    getJavaVersion: async () => '',
    getGpu: async () => undefined,
    platform: 'darwin',
    arch: 'arm64',
    uuid: () => '123e4567-e89b-42d3-a456-426614174001',
  });
  const report = await collector.collect({ trigger: 'manual', summary: ['Envoi manuel'], gameDir: f.gameDir, ramMb: 6144 });
  assert.equal(report.packVersion, 'inconnu', 'sans version installée : inconnu, jamais la version embarquée au build');
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

test('refuse les liens symboliques, fichiers comme dossiers', async () => {
  const f = fixture();
  const outside = path.join(f.root, 'outside');
  write(path.join(outside, 'secret.txt'), 'contenu hors du jeu');
  write(path.join(outside, 'crash-reports', 'crash-evil.txt'), 'contenu hors du jeu');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(f.gameDir, 'logs', 'latest.log'));
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(f.gameDir, 'hs_err_pid7.log'));
  fs.rmSync(path.join(f.gameDir, 'crash-reports'), { recursive: true });
  fs.symlinkSync(path.join(outside, 'crash-reports'), path.join(f.gameDir, 'crash-reports'));
  write(path.join(f.dataDir, 'logs', 'launcher.log'), 'journal légitime');

  const report = await f.collector.collect({ trigger: 'crash', summary: [], gameDir: f.gameDir, ramMb: 4096 });
  assert.deepEqual(report.files.map((file) => file.name), ['launcher.log']);
  assert.ok(!JSON.stringify(report).includes('hors du jeu'));
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('masque aussi le nom de la machine dans les fichiers et le résumé', async () => {
  const f = fixture();
  write(path.join(f.gameDir, 'logs', 'latest.log'), 'Connexion depuis PC-DE-SACHA.local');
  const report = await f.collector.collect({ trigger: 'crash', summary: ['Hôte pc-de-sacha'], gameDir: f.gameDir, ramMb: 4096 });
  assert.ok(!JSON.stringify(report).toLowerCase().includes('pc-de-sacha'));
  fs.rmSync(f.root, { recursive: true, force: true });
});
