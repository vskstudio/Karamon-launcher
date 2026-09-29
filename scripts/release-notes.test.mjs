import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changesSince, releaseNotes } from './release-notes.mjs';

test('the notes open with the changes since the previous release', () => {
  const notes = releaseNotes('2.0.16', ['Add a home hero.', 'Fix the tooltip.']);
  assert.ok(notes.startsWith('## Nouveautés\n- Add a home hero.\n- Fix the tooltip.\n\n'));
  assert.match(notes, /Karamon-Launcher-Setup-2\.0\.16\.exe/);
});

test('a release without changes keeps only the install notes', () => {
  const notes = releaseNotes('2.0.16');
  assert.ok(!notes.includes('Nouveautés'));
  assert.ok(notes.startsWith('Launcher officiel Karamon'));
});

test('merge commits and blank subjects are left out, and the list is capped', () => {
  const subjects = ['Merge pull request #2 from x/y', '  ', 'Merge branch main', ...Array.from({ length: 12 }, (_, i) => `Change ${i}`)];
  const changes = changesSince(subjects);
  assert.equal(changes.length, 8);
  assert.equal(changes[0], 'Change 0');
});
