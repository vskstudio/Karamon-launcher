import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReleases, releaseHighlights } from './ReleaseNotes.ts';

const BODY = [
  '## Nouveautés',
  '- Add a home hero.',
  '- Fix the tooltip.',
  '- Drop the theme picker.',
  '- Fourth change.',
  '',
  'Launcher officiel Karamon.',
  '',
  '## Windows',
  '- not a highlight',
].join('\r\n');

test('releaseHighlights keeps the first three bullets under Nouveautés', () => {
  assert.deepEqual(releaseHighlights(BODY), ['Add a home hero.', 'Fix the tooltip.', 'Drop the theme picker.']);
});

test('releaseHighlights stops at the next heading', () => {
  assert.deepEqual(releaseHighlights('## Nouveautés\n- One\n## Windows\n- Two'), ['One']);
});

test('an older release without Nouveautés has no highlights', () => {
  assert.deepEqual(releaseHighlights('Launcher officiel Karamon.\n\n## Windows\n- Installe'), []);
});

test('parseReleases keeps published launcher releases up to the limit', () => {
  const raw = [
    { tag_name: 'pack-latest', html_url: 'p', published_at: '2026-09-01T00:00:00Z', body: '' },
    { tag_name: 'launcher-v2.0.16', html_url: 'u16', published_at: '2026-09-20T10:00:00Z', body: BODY },
    { tag_name: 'launcher-v2.0.17', draft: true },
    { tag_name: 'launcher-v2.0.15', html_url: 'u15', published_at: null, body: null },
    { tag_name: 'launcher-v2.0.14', html_url: 'u14', published_at: '2026-09-10T00:00:00Z' },
  ];
  assert.deepEqual(parseReleases(raw, 2), [
    {
      version: '2.0.16',
      url: 'u16',
      publishedAt: Date.parse('2026-09-20T10:00:00Z'),
      highlights: ['Add a home hero.', 'Fix the tooltip.', 'Drop the theme picker.'],
    },
    { version: '2.0.15', url: 'u15', publishedAt: null, highlights: [] },
  ]);
});

test('parseReleases ignores a response that is not a list', () => {
  assert.deepEqual(parseReleases({ message: 'API rate limit exceeded' }, 3), []);
});
