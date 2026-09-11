// Progress across every chapter (GRAMMAR-CONTRACT.md "Progress across every
// chapter"): the book's 34 chapters, each with its readings, its grammar and
// its timings, and the totals over the whole book.
//
// Everything here is pure — no DOM, no fetch, no store (tests/ui.chapter-
// progress.test.mjs). main.js feeds it what the shell already holds and paints
// the result; the chapter → readings mapping is `chapters.js`'s alone and is
// never re-derived here (a chapter row model comes in from
// `settings.chapterRows()`, which reads it).
//
// **What is measured and what is not.** The only measured quantity in the app
// is the active minutes the study log records (CONTRACT.md "Study log"):
// `measuredMs` in `bookTotals()`, and nothing else. Every other minute on this
// page is *derived* — reading time from the study log's pace (sentences per
// active hour), grammar time from the per-kind drill medians the Today card
// computes (`itemSecondsBy`, grammar/today.js). The functions that produce
// them are named `…Ms` and carry `derived: true`; the strings that print them
// (`fmtEstimate`, `paceNote`) all say "about" and name the pace, so a derived
// figure is never shown as a measurement — in the interface, not only here.

import { chapter as chapterOf } from './chapters.js';
import { timeLeftMs, ROUGH_PACE, fmtDuration } from './settings.js';
// The drill-pace figures the Today card already uses, imported rather than
// copied so the two views can never drift (GRAMMAR-PLAN.md §5).
import { DEFAULT_ITEM_S, KIND_SECONDS, LEARN_LESSON_MIN, LEARN_ITEMS, LEARN_BLOCKED_ITEMS } from './grammar/today.js';

const MIN_MS = 60000;

/** The five skill states, in the order the contract names them. */
export const SKILL_STATES = Object.freeze(['new', 'learning', 'practising', 'mastered', 'lapsed']);
/** A chapter's row state: what the learner sees before opening it. */
export const CHAPTER_STATES = Object.freeze(['absent', 'untouched', 'part', 'done']);

/** How each kind of chapter set is named and counted, in the order a chapter lists them. */
export const SET_KINDS = Object.freeze({
  questions: { label: 'Questions', kind: 'question', verb: 'answered', noun: 'questions' },
  vocab: { label: 'Vocabulary', kind: 'vocab', verb: 'seen', noun: 'words' },
  pensum: { label: 'Pensa', kind: 'pensum', verb: 'done', noun: 'items' },
});
const SET_ORDER = { questions: 0, vocab: 1, pensum: 2 };

const clean = (n) => Math.max(0, Math.round(Number(n)) || 0);
const zeroSeen = { done: 0, attempts: 0 };

/* --------------------------------------------------------------- routing */
// Deep links: "#/progress" is the whole book, "#/progress/7" opens chapter VII
// already unfolded. Anything else is not this page.

/** "#/progress/7" → { n: 7 }; "#/progress" → { n: null }; not this page → null. Pure. */
export function parseProgressRoute(hash) {
  const m = /^#?\/progress(?:\/(\d{1,2}))?\/?$/.exec(String(hash ?? '').trim());
  if (!m) return null;
  if (m[1] == null) return { n: null };
  const c = chapterOf(Number(m[1]));
  return { n: c ? c.n : null };
}

/** The hash for the page ("#/progress"), or for one chapter of it ("#/progress/7"). Pure. */
export function progressHash(n = null) {
  const c = n == null ? null : chapterOf(n);
  return c ? `#/progress/${c.n}` : '#/progress';
}

/* --------------------------------------------------------------- timings */

/**
 * A span of derived time in the app's own voice: "under a minute", "about 12
 * min", "about 45 min", "about 1½ h". Always hedged, because none of it is
 * measured (`fmtDuration` — no "about" — is for measured minutes). '' for
 * nothing. Pure.
 */
export function fmtEstimate(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const min = n / MIN_MS;
  if (min < 1) return 'under a minute';
  if (min < 15) return `about ${Math.round(min)} min`;
  if (min < 57.5) return `about ${Math.round(min / 5) * 5} min`;
  const h = Math.round(min / 30) / 2;
  return `about ${h % 1 ? `${Math.floor(h)}½` : h} h`;
}

/** Measured minutes, in the plain voice: "6 h 12 min", "14 min", "none yet". Pure. */
export function fmtMeasured(ms) {
  return fmtDuration(ms) || 'none yet';
}

/**
 * The sentence under the totals that says which figure is measured and which
 * is worked out — the contract's "nothing may present a derived figure as a
 * measurement", in the interface. Pure.
 */
export function paceNote(pace) {
  const perHour = typeof pace === 'number' ? pace : pace?.perHour;
  const rough = !pace || pace.basis === 'rough' || !(perHour > 0);
  const rate = rough ? ROUGH_PACE : Math.round(perHour);
  const from = rough
    ? `an assumed ${rate} sentences an hour (too little reading time recorded for your own pace yet)`
    : `your own pace of ${rate} sentences an hour`;
  return `Minutes measured is the only measured figure here — the active minutes the study log records. Every other time on this page is worked out from ${from} and from how long your drill answers take, so read them as estimates.`;
}

/** The same, in a few words, for a chapter's timing line. Pure. */
export function estimateNote(pace) {
  const perHour = typeof pace === 'number' ? pace : pace?.perHour;
  const rough = !pace || pace.basis === 'rough' || !(perHour > 0);
  return rough
    ? `Estimated from an assumed ${ROUGH_PACE} sentences an hour — not measured.`
    : `Estimated from your pace of ${Math.round(perHour)} sentences an hour — not measured.`;
}

/** Reading time for `sentences` at the study log's pace, in ms. Derived, never measured. Pure. */
export function readingMs(sentences, pace) {
  return timeLeftMs(clean(sentences), pace);
}

/* --------------------------------------------------------------- grammar */

/**
 * One chapter set (its questions, a vocabulary deck, its pensa) as a row.
 *  `set`      the set skill (grammar/sets.js setSkills): { id, set, count, rev, title }
 *  `seenOf`   (id) → { done, attempts } — distinct items met, and every attempt
 *  `stateOf`  (id) → a skill state name
 *  `secondsFor` (kind) → seconds per item at the learner's own drill pace
 * `left` is the items not yet met once; the minutes are derived. Pure.
 */
export function setRow(set, { seenOf = () => zeroSeen, stateOf = () => 'new', secondsFor = null } = {}) {
  if (!set?.id) return null;
  const meta = SET_KINDS[set.set] ?? SET_KINDS.questions;
  const total = clean(set.count);
  const seen = seenOf(set.id) ?? zeroSeen;
  const done = Math.min(total, clean(seen.done));
  const secs = secondsFor ? secondsFor(meta.kind) : (KIND_SECONDS[meta.kind] ?? DEFAULT_ITEM_S);
  return {
    id: set.id, set: set.set, kind: meta.kind, rev: !!set.rev,
    label: set.rev ? `${meta.label} · English → Latin` : meta.label,
    verb: meta.verb, noun: meta.noun,
    total, done, left: Math.max(0, total - done),
    state: stateOf(set.id) ?? 'new',
    spentMs: clean(seen.attempts) * secs * 1000,
    leftMs: Math.max(0, total - done) * secs * 1000,
  };
}

/**
 * What one skill still costs before it has been met once: the lesson and its
 * guided items for a skill never started, the blocked ten for one part-way
 * through or lapsed, nothing for one already in rotation — spaced practice
 * after that is the daily plan's business and is not counted here (it would be
 * a guess about the future, not an estimate of work in hand). Pure.
 */
export function skillLeftMs(state, seconds = DEFAULT_ITEM_S) {
  const s = seconds > 0 ? seconds : DEFAULT_ITEM_S;
  if (state === 'new') return LEARN_LESSON_MIN * MIN_MS + LEARN_ITEMS * s * 1000;
  if (state === 'learning' || state === 'lapsed') return LEARN_BLOCKED_ITEMS * s * 1000;
  return 0;
}

/**
 * One chapter's grammar: its skills by state, its sets with what is done of
 * each, and the derived minutes spent and still to come.
 *   `skills` the chapter's grammar skills (grammar/chapter.js chapterMaterial)
 *   `sets`   its chapter sets, any order (they are sorted here)
 *   `known`  false while the grammar section has not been read yet — the view
 *            says so rather than printing zeros
 * Pure.
 */
export function chapterGrammar({ skills = [], sets = [], stateOf = () => 'new', seenOf = () => zeroSeen, secondsFor = null, known = true } = {}) {
  const counts = Object.fromEntries(SKILL_STATES.map((s) => [s, 0]));
  const secs = secondsFor ? secondsFor() : DEFAULT_ITEM_S;
  let skillsLeftMs = 0;
  let skillsSpentMs = 0;
  const list = [];
  for (const sk of skills) {
    if (!sk?.id) continue;
    const state = stateOf(sk.id) ?? 'new';
    counts[state] = (counts[state] ?? 0) + 1;
    skillsLeftMs += skillLeftMs(state, secs);
    skillsSpentMs += clean((seenOf(sk.id) ?? zeroSeen).attempts) * secs * 1000;
    list.push({ id: sk.id, title: sk.title ?? sk.id, state });
  }
  const rows = sets
    .map((s) => setRow(s, { seenOf, stateOf, secondsFor }))
    .filter(Boolean)
    .sort((a, b) => (SET_ORDER[a.set] ?? 9) - (SET_ORDER[b.set] ?? 9) || Number(a.rev) - Number(b.rev));
  const setsDone = rows.reduce((n, r) => n + r.done, 0);
  const setsTotal = rows.reduce((n, r) => n + r.total, 0);
  const spentMs = skillsSpentMs + rows.reduce((n, r) => n + r.spentMs, 0);
  const leftMs = skillsLeftMs + rows.reduce((n, r) => n + r.leftMs, 0);
  return {
    known,
    skills: list, counts,
    total: list.length, mastered: counts.mastered, started: list.length - counts.new,
    sets: rows, setsDone, setsTotal,
    // The reverse vocabulary deck is an optional extra: it is listed once it has been touched, never before.
    visibleSets: rows.filter((r) => !r.rev || r.done > 0 || r.state !== 'new'),
    spentMs, leftMs,
    anyDone: counts.new < list.length || setsDone > 0,
    any: list.length > 0 || rows.length > 0,
  };
}

/* ----------------------------------------------------------- the chapter */

/**
 * One chapter's row on the Progress page: its reading figures (from
 * `settings.chapterRows()` — the mapping stays there), its grammar, and the
 * derived minutes for both.
 *
 * `state` is what the row reads as:
 *   absent    nothing of this chapter is in the library and it has no grammar
 *   untouched in the library, but nothing read and nothing answered — the row
 *             says so instead of printing a line of zeros (the contract's rule)
 *   part      something done
 *   done      every sentence read
 * Pure.
 */
export function chapterRow(reading, { grammar = null, pace = null } = {}) {
  const r = reading ?? {};
  const total = clean(r.total);
  const read = Math.min(total, clean(r.read));
  const g = grammar ?? chapterGrammar({ known: false });
  const inLibrary = !!r.inLibrary;
  const touched = read > 0 || (g.known && g.anyDone);
  const state = !inLibrary && !g.any ? 'absent' : !touched ? 'untouched' : read >= total && total > 0 ? 'done' : 'part';
  const readSpentMs = readingMs(read, pace);
  const readLeftMs = readingMs(total - read, pace);
  return {
    n: r.n, roman: r.roman, title: r.title,
    inLibrary, meta: r.meta ?? '', audio: !!r.audio,
    readings: r.readings ?? [], weeks: r.weeks ?? [],
    read, total, unread: Math.max(0, total - read),
    grammar: g,
    readSpentMs, readLeftMs,
    spentMs: readSpentMs + (g.known ? g.spentMs : 0),
    leftMs: readLeftMs + (g.known ? g.leftMs : 0),
    finished: total > 0 && read >= total,
    state,
  };
}

/** Every chapter's row, in book order. `readingRows` is `settings.chapterRows()`. Pure. */
export function chapterRows(readingRows, { grammarOf = null, pace = null } = {}) {
  return (readingRows ?? []).map((r) => chapterRow(r, { grammar: grammarOf ? grammarOf(r.n) : null, pace }));
}

/**
 * The chapter row's one line, counts only — no praise, no score.
 * "Not added yet" · "Nothing done yet" · "42 of 93 read · 3 of 12 skills
 * mastered · about 1 h left" · "Read through · 5 of 12 skills mastered". Pure.
 */
export function chapterLine(row) {
  if (!row) return '';
  if (row.state === 'absent') return 'Not added yet';
  if (row.state === 'untouched') return 'Nothing done yet';
  const parts = [];
  if (row.total > 0) parts.push(row.read >= row.total ? 'Read through' : `${row.read} of ${row.total} read`);
  const g = row.grammar;
  if (g?.known && g.total > 0) parts.push(`${g.mastered} of ${g.total} skill${g.total === 1 ? '' : 's'} mastered`);
  if (g?.known && !g.total && g.setsTotal > 0) parts.push(`${g.setsDone} of ${g.setsTotal} items met`);
  const left = fmtEstimate(row.leftMs);
  if (left) parts.push(`${left} left`);
  return parts.join(' · ');
}

/** A chapter's timing line: "About 40 min spent · about 2 h to come". '' when neither is worth saying. Pure. */
export function timingLine(row) {
  if (!row) return '';
  const cap = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : '');
  const spent = fmtEstimate(row.spentMs);
  const left = fmtEstimate(row.leftMs);
  const parts = [];
  if (spent) parts.push(`${cap(spent)} spent`);
  if (left) parts.push(`${spent ? left : cap(left)} to come`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------ the totals */

/**
 * Across the whole book: sentences read, chapters finished, skills mastered,
 * and the minutes actually measured (the study log's active time — the one
 * figure on the page that is not derived).
 *
 * `skills` totals the skill map, not only the chapters' own skills, so
 * "11 of 88 mastered" is the book's whole grammar. Pure.
 */
/**
 * What "Skills mastered" is out of, said exactly (N-22): the book's grammar
 * skills, and not the chapter sets. The grammar section's Stats page tallies
 * the two together and reaches a larger number; "of 88" alone said neither
 * which 88 nor why Stats disagreed. '' when the grammar could not be read.
 * Pure.
 */
export const skillsOutOf = (total) => (total ? `of ${total} grammar skills` : '');

export function bookTotals(rows, { measuredMs = 0, skillsTotal = null, skillsMastered = null, grammarKnown = true } = {}) {
  const list = rows ?? [];
  let sentencesRead = 0;
  let sentencesTotal = 0;
  let chaptersFinished = 0;
  let chaptersStarted = 0;
  let inLibrary = 0;
  let mastered = 0;
  let skills = 0;
  let spentMs = 0;
  let leftMs = 0;
  for (const r of list) {
    sentencesRead += r.read;
    sentencesTotal += r.total;
    if (r.finished) chaptersFinished += 1;
    if (r.state === 'part' || r.state === 'done') chaptersStarted += 1;
    if (r.inLibrary) inLibrary += 1;
    mastered += r.grammar?.mastered ?? 0;
    skills += r.grammar?.total ?? 0;
    spentMs += r.spentMs;
    leftMs += r.leftMs;
  }
  return {
    sentencesRead, sentencesTotal,
    chapters: list.length, chaptersFinished, chaptersStarted, inLibrary,
    skillsMastered: skillsMastered == null ? mastered : clean(skillsMastered),
    skillsTotal: skillsTotal == null ? skills : clean(skillsTotal),
    grammarKnown,
    measuredMs: clean(measuredMs),
    spentMs, leftMs,
  };
}
