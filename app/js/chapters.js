// The book's own spine (GRAMMAR-CONTRACT.md "Chapter spine — navigation by
// chapter"): Familia Romana I–XXXIV, each chapter offering its reading or its
// grammar. This file is the ONE place the chapter → week mapping lives —
// nothing else in the app may hard-code it. Pure: no DOM, no fetch, no store
// (tests/ui.chapters.test.mjs).
//
// The mapping, as the contract fixes it (derived from `weeks.chapter`):
//
//   ch  1–24  reading: review shelf week 100 + N  ·  dialogue: colloquia week 200 + N
//   ch 25  w01     ch 26  w02     ch 29  w07     ch 30  w08     ch 31  w09
//   ch 27  w04 + w03 (FS Mīnōs, Corōnis; FL 63–65)
//   ch 28  w06 + w05 (FS Coriolānus, Nausicaa; FL 66–68)
//   ch 32  w11 + w10 (FS Arachnē; FL 69–74)
//   ch 33  w12       ch 34  w13 + w14
//
// A supplement week (3, 5, 10) attaches to the chapter its own `chapter`
// string names, and each of its parts — a Fabula Syrae, a Fabella — is a
// reading of its own, addressed by the part slug its unit ids carry
// (`w03:minos:1.1`, `w05:fl-66:b2.1`).

import { roman, SHELF_BASE, COLLO_BASE } from './sync.js';

export const CHAPTER_MIN = 1;
export const CHAPTER_MAX = 34;
/** Chapters I–XXIV are read on the two shelves; XXV–XXXIV are the 103 course weeks. */
export const SHELF_CHAPTER_MAX = 24;

/** The book's table of contents: chapter number → its Latin title. */
const TITLES = [
  'Imperium Rōmānum', 'Familia Rōmāna', 'Puer Improbus', 'Dominus et Servī',
  'Vīlla et Hortus', 'Via Latīna', 'Puella et Rosa', 'Taberna Rōmāna',
  'Pāstor et Ovēs', 'Bēstiae et Hominēs', 'Corpus Hūmānum', 'Mīles Rōmānus',
  'Annus et Mēnsēs', 'Novus Diēs', 'Magister et Discipulī', 'Tempestās',
  'Numerī Difficilēs', 'Litterae Latīnae', 'Marītus et Uxor', 'Parentēs',
  'Pugna Discipulōrum', 'Cavē Canem', 'Epistula Magistrī', 'Puer Aegrōtus',
  'Thēseus et Mīnōtaurus', 'Daedalus et Īcarus', 'Rēs Rūsticae', 'Perīcula Maris',
  'Nāvigāre Necesse Est', 'Convīvium', 'Inter Pōcula', 'Classis Rōmāna',
  'Exercitus Rōmānus', 'Dē Arte Poēticā',
];

/**
 * Chapters XXV–XXXIV → the 103 course weeks that read them. The first entry is
 * the chapter's own Familia Romana week; a `supplement: true` entry is the
 * week whose stories the syllabus reads beside it (its parts become readings).
 * Every one of the fourteen course weeks appears exactly once.
 */
const COURSE = Object.freeze({
  25: [{ week: 1 }],
  26: [{ week: 2 }],
  27: [{ week: 4 }, { week: 3, supplement: true }],
  28: [{ week: 6 }, { week: 5, supplement: true }],
  29: [{ week: 7 }],
  30: [{ week: 8 }],
  31: [{ week: 9 }],
  32: [{ week: 11 }, { week: 10, supplement: true }],
  33: [{ week: 12 }],
  34: [{ week: 13 }, { week: 14 }],
});

/**
 * The parts of the three multi-text weeks, in the order the week prints them.
 * `part` is the slug the unit ids carry; `label` is the short name a reading
 * row shows (the week's own part heading is long enough to be a paragraph).
 */
const SUPPLEMENT_PARTS = Object.freeze({
  3: [
    { kind: 'fs', part: 'minos', label: 'Mīnōs' },
    { kind: 'fs', part: 'coronis', label: 'Corōnis' },
    { kind: 'fl', part: 'fl-63', label: 'Fabella LXIII' },
    { kind: 'fl', part: 'fl-64', label: 'Fabella LXIV' },
    { kind: 'fl', part: 'fl-65', label: 'Fabella LXV' },
  ],
  5: [
    { kind: 'fs', part: 'coriolanus', label: 'Coriolānus' },
    { kind: 'fs', part: 'nausicaa', label: 'Nausicaa' },
    { kind: 'fl', part: 'fl-66', label: 'Fabella LXVI' },
    { kind: 'fl', part: 'fl-67', label: 'Fabella LXVII' },
    { kind: 'fl', part: 'fl-68', label: 'Fabella LXVIII' },
  ],
  10: [
    { kind: 'fs', part: 'arachne', label: 'Arachnē' },
    { kind: 'fl', part: 'fl-69', label: 'Fabella LXIX' },
    { kind: 'fl', part: 'fl-70', label: 'Fabella LXX' },
    { kind: 'fl', part: 'fl-71', label: 'Fabella LXXI' },
    { kind: 'fl', part: 'fl-72', label: 'Fabella LXXII' },
    { kind: 'fl', part: 'fl-73', label: 'Fabella LXXIII' },
    { kind: 'fl', part: 'fl-74', label: 'Fabella LXXIV' },
  ],
});

/** The four sources a reading may come from, and how the app names them. */
export const SOURCE_NAMES = Object.freeze({
  fr: 'Familia Rōmāna', collo: 'Colloquia Persōnārum', fs: 'Fabulae Syrae', fl: 'Fabellae Latīnae',
});

const pad = (n) => String(n).padStart(2, '0');
const weekId = (n) => `w${pad(n)}`;

/** The chapter set skill ids (GRAMMAR-CONTRACT.md wave 2) for one chapter. */
function grammarOf(n) {
  const nn = pad(n);
  return Object.freeze({
    chapter: n,
    questions: `questions-${nn}`,
    vocab: `vocab-${nn}`,
    vocabRev: `vocab-${nn}-rev`,
    pensum: `pensum-${nn}`,
    sets: Object.freeze([`questions-${nn}`, `vocab-${nn}`, `vocab-${nn}-rev`, `pensum-${nn}`]),
  });
}

function readingsFor(n) {
  if (n <= SHELF_CHAPTER_MAX) {
    return [
      { id: `r${pad(n)}`, kind: 'fr', week_n: SHELF_BASE + n, part: null, label: SOURCE_NAMES.fr, supplement: false },
      { id: `c${pad(n)}`, kind: 'collo', week_n: COLLO_BASE + n, part: null, label: `Colloquium ${roman(n)}`, supplement: false },
    ];
  }
  const out = [];
  for (const { week, supplement } of COURSE[n] ?? []) {
    if (!supplement) {
      out.push({ id: weekId(week), kind: 'fr', week_n: week, part: null, label: SOURCE_NAMES.fr, supplement: false });
      continue;
    }
    for (const p of SUPPLEMENT_PARTS[week] ?? []) {
      out.push({ id: `${weekId(week)}:${p.part}`, kind: p.kind, week_n: week, part: p.part, label: p.label, supplement: true });
    }
  }
  return out;
}

const ALL = Object.freeze(
  Array.from({ length: CHAPTER_MAX }, (_, i) => {
    const n = i + 1;
    const readings = readingsFor(n).map((r) => Object.freeze(r));
    return Object.freeze({
      n,
      roman: roman(n),
      title: TITLES[i],
      readings: Object.freeze(readings),
      weeks: Object.freeze([...new Set(readings.map((r) => r.week_n))]),
      grammar: grammarOf(n),
    });
  }),
);

/** Every chapter, I–XXXIV in order. Frozen: the same objects each call. */
export function chapters() { return ALL; }

/** One chapter by number, or null. */
export function chapter(n) {
  const x = Math.round(Number(n));
  return Number.isFinite(x) && x >= CHAPTER_MIN && x <= CHAPTER_MAX ? ALL[x - 1] : null;
}

/** A chapter's readings (empty for a number outside I–XXXIV). */
export function readingsOf(n) { return chapter(n)?.readings ?? []; }

/**
 * Which chapter a library week belongs to: a shelf or colloquia week by its
 * own number (107 → 7, 207 → 7), a course week through the mapping (4 → 27,
 * 3 → 27, 14 → 34). null for anything the spine does not name.
 */
export function chapterOfWeek(weekN) {
  const n = Math.round(Number(weekN));
  if (!Number.isFinite(n)) return null;
  return weekChapters().get(n) ?? null;
}

let weekMap = null;
/** Map library week → its chapter, for every week the spine names. Built once. */
export function weekChapters() {
  if (weekMap) return weekMap;
  weekMap = new Map();
  for (const c of ALL) for (const w of c.weeks) if (!weekMap.has(w)) weekMap.set(w, c.n);
  return weekMap;
}

/** The unit-id prefix a reading's sentences share: "r07:", "w03:minos:". */
export function readingPrefix(reading) {
  if (!reading) return '';
  const base = reading.part ? `${weekId(reading.week_n)}:${reading.part}` : String(reading.id);
  return `${base}:`;
}

/** True when a unit id belongs to this reading (a whole week, or one part of one). */
export function inReading(unitId, reading) {
  return typeof unitId === 'string' && unitId.startsWith(readingPrefix(reading));
}

/**
 * Names for a row's second line: at most `max` of them, then "+N more".
 * "Familia Rōmāna · Colloquium VII", "Week 4 · Mīnōs · +4 more". Pure.
 */
export function metaList(names, { max = 2 } = {}) {
  const list = (names ?? []).filter(Boolean);
  if (!list.length) return '';
  if (list.length <= max) return list.join(' · ');
  return [...list.slice(0, max), `+${list.length - max} more`].join(' · ');
}

/**
 * The readings' own names, for a chapter read on the shelves: "Familia Rōmāna ·
 * Colloquium VII". `readings` is whatever the library actually holds. Pure.
 */
export function readingsMeta(readings, opts) {
  return metaList((readings ?? []).map((r) => r?.label), opts);
}

/* ------------------------------------------------------------- routing */
// Deep links (GRAMMAR-CONTRACT.md): "#/chapter/7" is a chapter's readings,
// "#/chapter/7/grammar" its grammar. Anything else is the reader.

export const CHAPTER_TABS = Object.freeze(['reading', 'grammar']);

/** "#/chapter/7/grammar" → { n: 7, tab: 'grammar' }; not a chapter route → null. Pure. */
export function parseChapterRoute(hash) {
  const m = /^#?\/chapter\/(\d{1,2})(?:\/(reading|grammar))?\/?$/.exec(String(hash ?? '').trim());
  if (!m) return null;
  const c = chapter(Number(m[1]));
  return c ? { n: c.n, tab: m[2] === 'grammar' ? 'grammar' : 'reading' } : null;
}

/** The hash for a chapter (and tab): "#/chapter/7", "#/chapter/7/grammar". Pure. */
export function chapterHash(n, tab = 'reading') {
  const c = chapter(n);
  if (!c) return '';
  return tab === 'grammar' ? `#/chapter/${c.n}/grammar` : `#/chapter/${c.n}`;
}
