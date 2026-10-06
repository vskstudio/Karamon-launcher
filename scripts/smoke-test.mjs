#!/usr/bin/env node
// Starts the packaged launcher and checks, over the DevTools protocol, that the
// window loaded index.html with every image decoded. Catches a packaging change
// that leaves out a file the app needs at runtime.
// Usage: node scripts/smoke-test.mjs <path-to-executable>
import { spawn } from 'child_process';

const exe = process.argv[2];
if (!exe) {
  console.error('usage: smoke-test.mjs <executable>');
  process.exit(2);
}
const PORT = 9333;
const DEADLINE = Date.now() + (process.env.SMOKE_SYNC === '1' ? 15 * 60_000 : 60_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(exe, ['--no-sandbox', `--remote-debugging-port=${PORT}`], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
});
let exited = null;
child.on('exit', (code) => (exited = code));

function fail(msg) {
  console.error('smoke-test: ' + msg);
  child.kill('SIGKILL');
  process.exit(1);
}

async function findPage() {
  while (Date.now() < DEADLINE) {
    if (exited !== null) fail(`le launcher s'est arrêté (code ${exited})`);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.endsWith('/index.html'));
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  fail('aucune fenêtre index.html après 60 s');
}

function evaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () =>
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== 1) return;
      ws.close();
      if (msg.result?.exceptionDetails) reject(new Error(msg.result.exceptionDetails.text));
      else resolve(msg.result?.result?.value);
    };
    ws.onerror = () => reject(new Error('websocket'));
  });
}

const CHECK = `(async () => {
  if (document.readyState !== 'complete') await new Promise((r) => addEventListener('load', r, { once: true }));
  const imgs = [...document.querySelectorAll('img[src]')].filter((i) => !i.src.startsWith('http'));
  await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
  return {
    title: document.title,
    hasPlay: !!document.querySelector('button'),
    images: imgs.map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })),
  };
})()`;

const page = await findPage();
await sleep(2000);
const state = await evaluate(page.webSocketDebuggerUrl, CHECK).catch((e) => fail('évaluation: ' + e.message));
console.log(JSON.stringify(state, null, 2));
const broken = state.images.filter((i) => !i.ok);
if (state.images.length === 0) fail('aucune image locale dans la page');
if (broken.length) fail('images non chargées: ' + broken.map((i) => i.src).join(', '));
if (!state.hasPlay) fail('page vide');

// SMOKE_SYNC=1: real pack sync against karamon.fr from the packaged app, twice.
// The first run installs the pack; the second must download nothing.
if (process.env.SMOKE_SYNC === '1') {
  const SYNC = `(async () => {
    const lines = [];
    window.launcher.onStatus((m) => lines.push(m));
    const t0 = Date.now();
    const res = await window.launcher.syncMods();
    await new Promise((r) => setTimeout(r, 300));
    return { res, ms: Date.now() - t0, lines: lines.filter((l) => !l.startsWith('+ ')) };
  })()`;
  for (const round of [1, 2]) {
    const out = await evaluate(page.webSocketDebuggerUrl, SYNC).catch((e) => fail(`synchro ${round}: ` + e.message));
    console.log(`synchro ${round} (${(out.ms / 1000).toFixed(1)} s):`);
    for (const l of out.lines) console.log('  ' + l);
    if (!out.res?.ok) fail(`synchro ${round} en échec: ${out.res?.error}`);
    if (out.lines.some((l) => l.startsWith('Téléchargement partiel impossible'))) {
      fail(`synchro ${round}: retombée sur le téléchargement complet`);
    }
    if (round === 2 && !out.lines.some((l) => l.includes('déjà à jour') || l.includes('déjà installés'))) {
      fail('synchro 2: le pack aurait dû être à jour');
    }
  }
}

console.log('smoke-test: ok');
child.kill();
process.exit(0);
