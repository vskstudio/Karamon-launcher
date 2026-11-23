import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WikiBlock } from './WikiTypes.ts';
import { parseWikiIndex, parseWikiPage } from './WikiParser.ts';
import { WIKI_ARTICLE_HTML, WIKI_HOME_HTML } from './WikiPages.fixture.ts';

const text = (value: string) => ({ kind: 'text' as const, text: value });
const code = (value: string) => ({ kind: 'code' as const, text: value });

test('the wiki home cards give the groups and their pages with absolute icons', () => {
  assert.deepEqual(parseWikiIndex(WIKI_HOME_HTML), [
    {
      name: 'Bien commencer',
      pages: [
        { slug: 'bien-debuter', title: 'Bien débuter', icon: 'https://karamon.fr/img/wiki/gui/star.png' },
        { slug: 'mondes', title: 'Les mondes', icon: 'https://karamon.fr/img/wiki/gui/globe.png' },
      ],
    },
    {
      name: 'Économie',
      pages: [{ slug: 'monnaies', title: 'Monnaies', icon: 'https://karamon.fr/img/wiki/gui/koin.png' }],
    },
  ]);
});

test('the side navigation of an article gives the same index and drops links leaving the wiki', () => {
  assert.deepEqual(parseWikiIndex(WIKI_ARTICLE_HTML), [
    {
      name: 'Bien commencer',
      pages: [
        { slug: 'bien-debuter', title: 'Bien débuter', icon: 'https://karamon.fr/img/wiki/gui/star.png' },
        { slug: 'mondes', title: 'Les mondes', icon: 'https://karamon.fr/img/wiki/gui/globe.png' },
      ],
    },
    {
      name: 'Progresser',
      pages: [{ slug: 'progression', title: 'Niveau & rangs', icon: 'https://karamon.fr/img/wiki/gui/profile.png' }],
    },
  ]);
});

test('an article becomes typed blocks with absolute karamon.fr images and resolved wiki links', () => {
  const page = parseWikiPage('mondes', WIKI_ARTICLE_HTML);
  assert.ok(page);
  assert.equal(page.slug, 'mondes');
  assert.equal(page.title, 'Les mondes');
  assert.equal(page.group, 'Bien commencer');
  assert.equal(page.lede, 'La Ville, Ressources, Aventure, les Arènes, le Safari et ton île.');
  assert.equal(page.icon, 'https://karamon.fr/img/wiki/gui/globe.png');
  assert.equal(page.cover, 'https://karamon.fr/img/wiki/art/backdrop_portal.webp');
  const expected: WikiBlock[] = [
    {
      kind: 'paragraph',
      content: [
        text('Karamon est découpé en plusieurs mondes. Le plus simple : '),
        code('K'),
        text(' › '),
        { kind: 'strong', children: [text('Téléportation')] },
        text(', ou '),
        { kind: 'em', children: [text('les commandes')] },
        text(' ci-dessous.'),
      ],
    },
    {
      kind: 'table',
      head: [[text('Monde')], [text('Commande')]],
      rows: [
        [[{ kind: 'image', src: 'https://karamon.fr/img/wiki/items/karaball.png', alt: '' }, text(' Ville')], [code('/spawn')]],
        [[text('Îles')], [code('/ile'), text(', '), code('/ile guilde')]],
      ],
    },
    {
      kind: 'callout',
      tone: 'note',
      title: 'À savoir',
      blocks: [
        { kind: 'paragraph', content: [text("L'inventaire est conservé à la mort.")] },
        { kind: 'paragraph', content: [text('Les cultures ne se piétinent plus.')] },
      ],
    },
    { kind: 'heading', level: 2, id: 'ville', text: 'La Ville' },
    { kind: 'image', src: 'https://karamon.fr/img/wiki/worlds/spawn.webp', alt: 'La Ville, le monde de départ' },
    { kind: 'paragraph', content: [{ kind: 'em', children: [text('La Ville')] }] },
    {
      kind: 'list',
      ordered: false,
      items: [
        [
          text('le centre Pokémon (voir '),
          { kind: 'link', href: 'https://karamon.fr/wiki/objets#soins', wikiSlug: 'objets', children: [text('Objets')] },
          text(') ;'),
        ],
        [
          text('la salle des portails, voir '),
          { kind: 'link', href: 'https://karamon.fr/wiki/mondes#ville', wikiSlug: 'mondes', children: [text('plus haut')] },
          text('.'),
        ],
      ],
    },
    { kind: 'heading', level: 3, id: 'le-safari', text: 'Le Safari' },
    {
      kind: 'list',
      ordered: true,
      items: [
        [
          text('Achète un ticket sur '),
          { kind: 'link', href: 'https://karamon.fr/boutique', wikiSlug: null, children: [text('la boutique')] },
          text('.'),
        ],
        [
          text('Rejoins le '),
          { kind: 'link', href: 'https://discord.gg/karamon', wikiSlug: null, children: [text('Discord')] },
          text(' ou vote sur le top.'),
        ],
      ],
    },
    {
      kind: 'callout',
      tone: 'warning',
      title: 'Attention',
      blocks: [{ kind: 'paragraph', content: [text('Une seule vie par raid.')] }],
    },
    {
      kind: 'callout',
      tone: 'note',
      title: "Écran d'accueil du jeu",
      blocks: [{ kind: 'paragraph', content: [text("Capture de l'écran titre.")] }],
    },
    {
      kind: 'paragraph',
      content: [text('Le Safari ferme '), { kind: 'strong', children: [text('chaque lundi')] }, text('.')],
    },
    {
      kind: 'callout',
      tone: 'tip',
      title: 'Astuce',
      blocks: [{ kind: 'paragraph', content: [text('Pose un home avec '), code('/sethome'), text('.')] }],
    },
  ];
  assert.deepEqual(page.blocks, expected);
});

test('a page without a wiki article is not a page', () => {
  assert.equal(parseWikiPage('bien-debuter', WIKI_HOME_HTML), null);
  assert.equal(parseWikiPage('bien-debuter', '<html><body><h1>404</h1></body></html>'), null);
});
