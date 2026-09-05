// node --test tests/ — the pure helpers behind the textbook pictures
// (CONTRACT.md "Pictures"): grouping by sentence, the gutter drift rule that
// lets glosses flow under an illustration, the alt text and the row shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPictures, marginDrift, pictureAlt, stackMargin } from '../app/js/reader.js';
import { normalisePictureRows, DEFAULT_SETTINGS } from '../app/js/sync.js';

const pic = (id, unit_id, sort = 0) => ({ id, unit_id, sort, url: `blob:${id}` });

test('groupPictures: one list per unit, in sort order, ties by id; rows without a unit are dropped', () => {
  const g = groupPictures([pic('b', 'w01:4.1', 1), pic('a', 'w01:4.1', 0), pic('z', 'w01:29.1'), pic('c', 'w01:4.1', 1), { id: 'x', sort: 0 }, null]);
  assert.deepEqual([...g.keys()], ['w01:4.1', 'w01:29.1']);
  assert.deepEqual(g.get('w01:4.1').map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(g.get('w01:29.1').map((p) => p.id), ['z']);
});

test('groupPictures: a missing or non-numeric sort counts as 0; empty input → empty map', () => {
  const g = groupPictures([{ id: 'q', unit_id: 'u', sort: 'x' }, { id: 'p', unit_id: 'u', sort: -1 }, { id: 'r', unit_id: 'u' }]);
  assert.deepEqual(g.get('u').map((p) => p.id), ['p', 'q', 'r']);
  assert.equal(groupPictures([]).size, 0);
  assert.equal(groupPictures(null).size, 0);
});

test('marginDrift: the floor under a picture is the picture bottom plus the gap; later notes measure from their own sentence', () => {
  const items = [
    { pinned: true, top: 100, height: 160 },
    { top: 100, height: 20 },     // → 264: under the picture, drift 0
    { top: 400, height: 20 },     // far below: keeps 400, drift 0
  ];
  const tops = stackMargin(items, 4);
  assert.deepEqual(tops, [100, 264, 400]);
  assert.equal(marginDrift(items, tops, 4), 0);
  // Glosses flowing under the picture in a chain — each resting on the one
  // above — are the book's arrangement: no drift, however long the chain.
  const dense = [
    { pinned: true, top: 100, height: 160 },
    { top: 100, height: 20 },     // → 264
    { top: 110, height: 20 },     // → 288, resting on the chain
    { top: 130, height: 20 },     // → 312, still the chain
  ];
  const t2 = stackMargin(dense, 4);
  assert.deepEqual(t2, [100, 264, 288, 312]);
  assert.equal(marginDrift(dense, t2, 4), 0);
  // The chain ends at a note placed at its own sentence; a note crowded by *that* one counts.
  const broken = [
    { pinned: true, top: 100, height: 160 },
    { top: 100, height: 20 },     // → 264 (chain)
    { top: 500, height: 20 },     // → 500: at its own sentence, the chain ends
    { top: 505, height: 20 },     // → 524: pushed by a plain note → drift 19
  ];
  const t4 = stackMargin(broken, 4);
  assert.deepEqual(t4, [100, 264, 500, 524]);
  assert.equal(marginDrift(broken, t4, 4), 19);
  // A picture displaced by a note above it drifts like any block.
  const pushed = [{ top: 100, height: 40 }, { pinned: true, top: 110, height: 100 }];
  const t3 = stackMargin(pushed, 4);
  assert.deepEqual(t3, [100, 144]);
  assert.equal(marginDrift(pushed, t3, 4), 34);
});

test('marginDrift: a second picture of the same sentence stacks under the first without drift; one of another sentence pushed by a picture counts', () => {
  const same = [
    { pinned: true, unit: 'w01:1.1', top: 0, height: 150 },
    { pinned: true, unit: 'w01:1.1', top: 0, height: 120 },   // → 154, its sibling's arrangement
    { unit: 'w01:1.3', top: 60, height: 20 },                  // → 278, under the pair
  ];
  const t = stackMargin(same, 4);
  assert.deepEqual(t, [0, 154, 278]);
  assert.equal(marginDrift(same, t, 4), 0);
  const other = [
    { pinned: true, unit: 'w01:1.1', top: 0, height: 150 },
    { pinned: true, unit: 'w01:4.1', top: 90, height: 120 },   // → 154: 64 below its own sentence
  ];
  const t2 = stackMargin(other, 4);
  assert.deepEqual(t2, [0, 154]);
  assert.equal(marginDrift(other, t2, 4), 64);
});

test('marginDrift without pictures is the plain worst push (what the gutter check always measured)', () => {
  const items = [{ top: 0, height: 30 }, { top: 10, height: 30 }, { top: 20, height: 30 }];
  const tops = stackMargin(items, 0);
  assert.deepEqual(tops, [0, 30, 60]);
  assert.equal(marginDrift(items, tops, 0), 40);
});

test('pictureAlt: the caption, else the generic line', () => {
  assert.equal(pictureAlt({ caption: ' labyrinthus -ī m ' }), 'labyrinthus -ī m');
  assert.equal(pictureAlt({ caption: '' }), 'Illustration from the textbook');
  assert.equal(pictureAlt({}), 'Illustration from the textbook');
  assert.equal(pictureAlt(null), 'Illustration from the textbook');
});

test('normalisePictureRows: the store shape, bad rows dropped, blanks → null, sort → number', () => {
  const rows = normalisePictureRows([
    { id: 'w01/p197-1', unit_id: 'w01:29.1', path: ' week-01/p197-1.png ', caption: ' labyrinthus -ī m ', caption_en: '', page: '197', width: 900, height: 620.4, sort: '2', user_id: 'u' },
    { id: 'no-path', unit_id: 'w01:1.1' },
    { id: 'no-unit', path: 'x.png' },
    { id: 'w01/p2', unit_id: 'w01:2.1', path: 'week-01/p2.png', width: 0, height: -3, sort: null },
  ]);
  assert.deepEqual(rows, [
    { id: 'w01/p197-1', unit_id: 'w01:29.1', path: 'week-01/p197-1.png', caption: 'labyrinthus -ī m', caption_en: null, page: 197, width: 900, height: 620, sort: 2 },
    { id: 'w01/p2', unit_id: 'w01:2.1', path: 'week-01/p2.png', caption: null, caption_en: null, page: null, width: null, height: null, sort: 0 },
  ]);
  assert.ok(!('user_id' in rows[0]));
});

test('settings: showPictures defaults to on', () => {
  assert.equal(DEFAULT_SETTINGS.showPictures, true);
});
