// node --test tests/ — the pure helpers behind the "Book lines" layout (CONTRACT.md "Book lines").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitLines, lineStarts, lastLine, breakAfter, breakSplit, weekHasLines, printedLines, lineNumberDups } from '../app/js/reader.js';
import { tokenize } from '../app/js/tokenize.js';
import { withDemoLines } from '../app/js/store-fixture.js';
import { bookLinesDesc } from '../app/js/settings.js';
import { DEFAULT_SETTINGS } from '../app/js/sync.js';

// Invented text, not the book's.
const LA = 'Puer ad rīvum ambulat, et "Quis es?" inquit; nēmō respondet.';

test('unitLines: sorted, coerced, duplicates and junk dropped; [] without data', () => {
  assert.deepEqual(unitLines({ lines: [{ line: 13, start: 41 }, { line: '12', start: '0' }, { line: 13, start: 41 }, { line: 'x', start: 5 }, null, { line: 14, start: -1 }] }),
    [{ line: 12, start: 0 }, { line: 13, start: 41 }]);
  // Monotonic by line: the same line from a second offset, or a line at or before the last kept, is dropped.
  assert.deepEqual(unitLines({ lines: [{ line: 5, start: 0 }, { line: 5, start: 20 }, { line: 6, start: 30 }, { line: 4, start: 40 }, { line: 7, start: 50 }] }),
    [{ line: 5, start: 0 }, { line: 6, start: 30 }, { line: 7, start: 50 }]);
  assert.deepEqual(unitLines({}), []);
  assert.deepEqual(unitLines({ lines: null }), []);
  assert.deepEqual(unitLines(null), []);
});

test('lineStarts: the token at each offset opens a line; whitespace is skipped; offset 0 is the first line', () => {
  const tokens = tokenize(LA);
  const at = (i) => tokens[i];
  const dash = LA.indexOf('et "Quis');
  const starts = lineStarts(tokens, [{ line: 7, start: 0 }, { line: 8, start: dash }]);
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[0], { index: 0, line: 7 });
  assert.equal(at(starts[1].index).text, 'et');
  assert.equal(at(starts[1].index).start, dash);
  assert.equal(starts[1].line, 8);
  // An offset on the space before "et" lands on "et" too (never a whitespace token).
  assert.equal(at(lineStarts(tokens, [{ line: 1, start: 0 }, { line: 2, start: dash - 1 }])[1].index).text, 'et');
  // An offset inside a word (a data slip) opens the line with that word — never with the punctuation after it.
  const inside = LA.indexOf('ambulat') + 3;
  const s2 = lineStarts(tokens, [{ line: 1, start: 0 }, { line: 2, start: inside }]);
  assert.equal(at(s2[1].index).text, 'ambulat');
  // The pipeline's offset is the first letter: `"Quis` opens at Q, and the token before it is `et "`-style punctuation.
  const q = LA.indexOf('Quis');
  const s3 = lineStarts(tokens, [{ line: 1, start: 0 }, { line: 2, start: q }]);
  assert.equal(at(s3[1].index).text, 'Quis');
  assert.equal(at(s3[1].index - 1).text, ' "');
  // Past the text, or the same token twice: dropped.
  assert.deepEqual(lineStarts(tokens, [{ line: 1, start: 0 }, { line: 2, start: LA.length + 5 }]), [{ index: 0, line: 1 }]);
  assert.equal(lineStarts(tokens, [{ line: 1, start: 0 }, { line: 2, start: 0 }]).length, 1);
  assert.deepEqual(lineStarts(tokens, []), []);
});

test('breakSplit: the punctuation before a break is divided at its last whitespace run, the quote going to the new line', () => {
  assert.deepEqual(breakSplit(' "'), { head: '', tail: '"' });
  assert.deepEqual(breakSplit('; "'), { head: ';', tail: '"' });
  assert.deepEqual(breakSplit(' — ‘'), { head: ' —', tail: '‘' });
  assert.deepEqual(breakSplit(', ('), { head: ',', tail: '(' });
  assert.deepEqual(breakSplit('. '), { head: '.', tail: '' });
  assert.deepEqual(breakSplit(' '), { head: '', tail: '' });
  assert.equal(breakSplit(':"'), null);   // no whitespace: nothing to divide
  assert.equal(breakSplit(''), null);
});

test('lastLine / breakAfter: a sentence ending a printed line breaks before the next; block starts stand in without data', () => {
  const a = { lines: [{ line: 2, start: 0 }, { line: 3, start: 15 }] };
  const b = { lines: [{ line: 3, start: 0 }] };
  const c = { lines: [{ line: 4, start: 0 }], block_start: true };
  assert.equal(lastLine(a), 3);
  assert.equal(lastLine({}), null);
  assert.equal(breakAfter(a, b), false);   // b continues line 3
  assert.equal(breakAfter(b, c), true);    // c opens line 4
  assert.equal(breakAfter(c, null), false);
  assert.equal(breakAfter(a, { block_start: true }), true);    // the next unit is unmapped: a paragraph start breaks
  assert.equal(breakAfter(a, { block_start: false }), false);
  assert.equal(breakAfter({ block_start: true }, c), true);    // this unit unmapped, the next a block start
  // An unmapped unit inside a mapped block: A (ends 13) → B (unmapped, no block start) → C (starts 15, no block start).
  const A = { lines: [{ line: 13, start: 0 }] };
  const B = { lines: [], block_start: false };
  const C = { lines: [{ line: 15, start: 0 }], block_start: false };
  assert.equal(breakAfter(A, B), false);            // B continues line 13
  assert.equal(breakAfter(B, C), false);            // without the carried line: no data, no block start
  assert.equal(breakAfter(B, C, 13), true);         // carrying A's last line: C opens a later line
  assert.equal(breakAfter(B, { lines: [{ line: 13, start: 0 }] }, 13), false);   // …but not one still on line 13
  assert.equal(breakAfter(A, C, 99), true);         // a mapped unit uses its own last line, not the carried one
});

test('printedLines: the printed lines rebuilt from the units, joined by a space, with the sentence ends per line (the measure helper)', () => {
  // Invented text. a spans lines 1–2 and ends mid-2; b ends line 2; c is line 3 alone.
  const a = { la: 'Puer ad rīvum ambulat et aquam videt.', lines: [{ line: 1, start: 0 }, { line: 2, start: 22 }] };
  const b = { la: 'Nēmō respondet.', lines: [{ line: 2, start: 0 }] };
  const c = { la: 'Fīnis.', lines: [{ line: 3, start: 0 }] };
  assert.deepEqual(printedLines([a, b, c]), [
    { line: 1, text: 'Puer ad rīvum ambulat', ends: 0 },
    { line: 2, text: 'et aquam videt. Nēmō respondet.', ends: 2 },
    { line: 3, text: 'Fīnis.', ends: 1 },
  ]);
  // An unmapped unit inside a mapped block stands on the last line seen; a block start without data (and what follows it) is flow text and is left out.
  const gap = { la: 'Sine datīs.', lines: [], block_start: false };
  const para = { la: 'Nova pars sine datīs.', lines: [], block_start: true };
  const tail = { la: 'Adhūc sine datīs.', lines: [] };
  const out = printedLines([a, gap, para, tail, c]);
  assert.deepEqual(out.map((L) => L.line), [1, 2, 3]);
  assert.equal(out[1].text, 'et aquam videt. Sine datīs.');
  assert.equal(out[1].ends, 2);
  assert.equal(out[2].text, 'Fīnis.');
  // Whitespace at a break is dropped; a unit whose first entry is not offset 0 keeps its head on the line before.
  assert.deepEqual(printedLines([{ la: 'Alpha  beta \n gamma', lines: [{ line: 5, start: 0 }, { line: 6, start: 12 }] }]),
    [{ line: 5, text: 'Alpha beta', ends: 0 }, { line: 6, text: 'gamma', ends: 1 }]);
  assert.deepEqual(printedLines([]), []);
  assert.deepEqual(printedLines([{ la: 'Nihil.', lines: [] }]), []);
  assert.deepEqual(printedLines(null), []);
});

test('lineNumberDups: one number per screen line — the same top, or the same printed line as the number shown last, is hidden', () => {
  // Two sentences sharing a printed line (same top); a wrapped line's continuation (same line, lower); two verses on one printed line.
  assert.deepEqual(lineNumberDups([
    { top: 100, line: '3' }, { top: 100.6, line: '3' },     // same screen line
    { top: 131, line: '4' }, { top: 162, line: '4' },       // line 4 wrapped, the next sentence continues it lower down
    { top: 193, line: 64 }, { top: 224, line: '64' },       // two verse blocks of printed line 64
    { top: 255, line: '65' },
  ]), [false, true, false, true, false, true, false]);
  // The comparison is with the last number *shown*: a "2" hidden for sharing line 1's screen line does not hide the first "2" on its own line.
  assert.deepEqual(lineNumberDups([{ top: 10, line: '1' }, { top: 11, line: '2' }, { top: 41, line: '2' }, { top: 72, line: '3' }]), [false, true, false, false]);
  // Flow numbers without data-line dedupe by top only.
  assert.deepEqual(lineNumberDups([{ top: 10 }, { top: 10 }, { top: 40 }]), [false, true, false]);
  assert.deepEqual(lineNumberDups([]), []);
  assert.deepEqual(lineNumberDups(null), []);
});

test('weekHasLines: any mapped unit counts', () => {
  assert.equal(weekHasLines([{ lines: [] }, { lines: [{ line: 1, start: 0 }] }]), true);
  assert.equal(weekHasLines([{ lines: [] }, {}]), false);
  assert.equal(weekHasLines([]), false);
  assert.equal(weekHasLines(null), false);
});

test('withDemoLines (fixture): ~55-character lines at word boundaries, numbered on from the block; real data is left alone', () => {
  const units = [
    { id: 'a', order: 0, line_no: 10, block_start: true, la: 'Alpha beta gamma delta epsilon zēta ēta thēta iōta kappa lambda mū nū xī omicron pī rhō sigma tau.' },
    { id: 'b', order: 1, line_no: 10, block_start: false, la: 'Ypsilon phī chī psī ōmega.' },
    { id: 'c', order: 2, line_no: 12, block_start: true, la: 'Nova.' },
    { id: 'd', order: 3, line_no: 14, block_start: true, la: 'Alpha beta gamma delta epsilon zēta ēta thēta iōta "Quis es?" inquit.' },   // 50 columns, then `"Quis` overflows
  ];
  const out = withDemoLines(units, 55);
  assert.deepEqual(out[0].lines[0], { line: 10, start: 0 });
  assert.equal(out[0].lines.length, 2);
  const brk = out[0].lines[1];
  assert.equal(brk.line, 11);
  assert.equal(units[0].la[brk.start - 1], ' ');                      // the break sits after a space…
  assert.notEqual(units[0].la[brk.start], ' ');                      // …at the start of a word
  assert.ok(brk.start <= 56 && brk.start > 40);
  assert.deepEqual(out[1].lines[0], { line: 11, start: 0 });         // continues the block's last line…
  for (const l of out[1].lines.slice(1)) { assert.equal(units[1].la[l.start - 1], ' '); assert.equal(l.line, 12); }   // …and any further break is at a word, on the next line
  assert.deepEqual(out[2].lines, [{ line: 12, start: 0 }]);          // a new block restarts from its own number
  // Like the pipeline, a break before `"Quis` starts at the Q, not the quote.
  const qb = out[3].lines[1];
  assert.equal(qb.line, 15);
  assert.equal(units[3].la[qb.start], 'Q');
  assert.equal(units[3].la[qb.start - 1], '"');

  assert.equal(units[0].lines, undefined);                           // the input is not mutated
  // A week that already has any line data is passed through (missing arrays normalised to []).
  const real = withDemoLines([{ ...units[0], lines: [{ line: 10, start: 0 }] }, units[1]]);
  assert.deepEqual(real[0].lines, [{ line: 10, start: 0 }]);
  assert.deepEqual(real[1].lines, []);
  // No line number at all: nothing to synthesise.
  assert.deepEqual(withDemoLines([{ id: 'x', order: 0, block_start: true, la: 'Sine numerō.' }])[0].lines, []);
});

test('settings: lineMode defaults to flow; the switch description turns into the hint without data', () => {
  assert.equal(DEFAULT_SETTINGS.lineMode, 'flow');
  assert.equal(bookLinesDesc(true), 'One printed line per line, every line numbered');
  assert.equal(bookLinesDesc(false), "This week's text has no printed line numbers");
});
