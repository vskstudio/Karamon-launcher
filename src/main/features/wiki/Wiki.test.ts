import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HttpResponse } from '../../shared/HttpClient.ts';
import { Wiki } from './Wiki.ts';
import { WIKI_ARTICLE_HTML, WIKI_HOME_HTML } from './WikiPages.fixture.ts';

type Server = (url: string) => HttpResponse;

const serving = (pages: Record<string, string>): Server => (url) =>
  url in pages ? { status: 200, body: Buffer.from(pages[url]) } : { status: 404, body: Buffer.from('') };
const offline: Server = () => {
  throw new Error('getaddrinfo ENOTFOUND karamon.fr');
};

function withCacheDir(run: (dir: string, wikiOn: (server: Server) => Wiki) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karamon-wiki-'));
  const wikiOn = (server: Server) => new Wiki({ get: async (url: string) => server(url) }, dir);
  return run(dir, wikiOn).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

const SITE = serving({
  'https://karamon.fr/wiki': WIKI_HOME_HTML,
  'https://karamon.fr/wiki/mondes': WIKI_ARTICLE_HTML,
});

test('the wiki opens offline with the copy saved by an earlier session', () =>
  withCacheDir(async (_dir, wikiOn) => {
    const online = wikiOn(SITE);
    const index = await online.index();
    const page = await online.page('mondes');
    assert.equal(index.length, 2);
    assert.equal(page?.title, 'Les mondes');

    const later = wikiOn(offline);
    assert.deepEqual(await later.index(), index);
    assert.deepEqual(await later.page('mondes'), page);
    assert.equal(await later.page('raids'), null);
  }));

test('a page the site no longer has is not served from the cache', () =>
  withCacheDir(async (_dir, wikiOn) => {
    await wikiOn(SITE).page('mondes');
    assert.equal(await wikiOn(serving({})).page('mondes'), null);
  }));

test('without network nor cache the wiki is empty', () =>
  withCacheDir(async (_dir, wikiOn) => {
    const wiki = wikiOn(offline);
    assert.deepEqual(await wiki.index(), []);
    assert.equal(await wiki.page('mondes'), null);
  }));

test('a slug that could leave the cache folder is refused before any request', () =>
  withCacheDir(async (_dir, wikiOn) => {
    const requested: string[] = [];
    const wiki = wikiOn((url) => {
      requested.push(url);
      return SITE(url);
    });
    assert.equal(await wiki.page('../../config'), null);
    assert.deepEqual(requested, []);
  }));
