// Grammar section views: the skill map, the lesson, the Learn flow, the
// Practice setup, the session runner (type / choice / chart / tap), feedback,
// the end-of-session summary and the stats page. Calm tone, no gamification.
// Every Latin word in a drill is tappable for its entry (a small popover built
// from dictionary.describe); the target's dictionary form sits under the item.

import { chapters, roman, inline, loadLesson, loadPartTitles, loadSentences, loadParadigmCatalogue, loadHeadwords, loadOccurrences, loadGenerated, generatedSkillIds, generatedUnreachable, occurrenceLine, KEY_CLASS, KEY_MODELS, entryOfClass, highlightParses } from './lessons.js';
import { renderParadigm, fitParadigm, cellAnswers } from '../wordpanel.js';
import { gameSound, playTable } from '../game.js';
import { wordRule, ruleCard, focusRule, formRule, skillHow } from '../wordrule.js';
import { chapter as bookChapter, chapters as bookChapters, grammarViewHash } from '../chapters.js';
import { cellChapter, loadFormSkills, skillCovers } from '../paradigm-chapters.js';
import { isShelfWeek } from '../sync.js';
import { tokenize, stripMacrons } from '../tokenize.js';
import { attachHoverGloss, cutLatinWords, pointerHovers } from '../hovergloss.js';
import { PARTS, skillProgress } from './progress.js';
import { decay, isDue, overdueRatio, newState, addToPractice, removeFromPractice, reviewFirst, inRotation, buildPairSession, stepList, normaliseLearnPlace, MAX_STEPS, DAY_MS, LEARN_NEEDED, LEARN_WINDOW, LEARN_KINDS, MASTERED_DAYS, MASTERED_SUCCESSES } from './scheduler.js';
import { createLearn, createStepPractice, createPractice, createBlockedFive, createRedo, createDrill, createMixed, mixedMembers, createCatalogueDrill, boxHints, normaliseHintMode, HINT_MODES, HINT_MODE_LABEL, cellResults, judge, judgeCell, maskParadigm, acceptedAnswers, unmetPrereqs, workedPlan, judgeWhy, LEARN_BLOCKED, RETEST_SIZE, RETEST_AFTER_MS, noteRetest, retestDue, retestPending, SCAFFOLD_LEVELS, SCAFFOLD_STEPS, normaliseScaffold, scaffoldPercent, scaffoldStep, scaffoldGiven, chartCellKey } from './session.js';
import { featureLabel, createTeachItems, createCatalogueItems, tableIdOf, cellId, isWrittenKey, la, partsText } from './items.js';
import { setsOfChapter, setChapters, phraseIndexes, focusIndexes, POPULATION_LABEL, mixGrid, normaliseMix, mixIn, mixHolds, filterMix, mixToggle, mixCounts, mixNote, mixTitle } from './sets.js';
import { spine, chapterMaterial, chapterProgress, chapterPool, chapterSummary, chapterOfSentence } from './chapter.js';
import { orderInput, matchInput } from './inputs.js';
import { buildPath, climbFrom } from './continuum.js';
import { appliesTo, exampleOf } from './applies.js';
import { withPassive } from './voices.js';
import { mainAction, acrossLabel } from './actions.js';
import { resolveView, tabOf, STUDY_TABS } from './routes.js';
import { practised, notePractised, timesText, setSyncedCounts } from '../practised.js';
import { practiceLog, needsPractice } from './practicelog.js';
import { buildToday, fmtMinutes } from './today.js';
import * as stats from './stats.js';
import { localDay } from './stats.js';
import { buildChart, buildSheet, printDocument } from './print.js';

const LS_SESSION = 'l103.grammar.session';      // the practice session in progress (plan, position, log) — Back / Reload can resume it
const LS_QUEUE = 'l103.grammar.learnQueue';     // "Start all as new": the skills still to go through Learn
// Where the learner is in each skill: `{ <skill id>: { done: [step index…] | seen, at } }`. Since §25 this
// is the **offline cache** of `skill_state.learn_place` and no longer the only copy: the grammar store owns
// the record, mirrors it here after every change, and reads this key once at startup to push up whatever
// the device had before it ever synced. Cleared on sign-out with the rest of the cache (store.js).
export const LS_LEARN = 'l103.grammar.learn';
const readJSON = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const writeJSON = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
};
// `to: [view, params]` makes the control a real link to that view's address (chapters.js grammarViewHash), so the
// browser offers it a new tab or window (right-click, Ctrl / ⌘-click, a middle click). A plain click still runs
// `onclick`, in place, as a button does.
const btn = (label, attrs = {}, cls = 'btn') => {
  const { to, ...rest } = attrs;
  if (!to) return h('button', { type: 'button', class: cls, ...rest }, label);
  const { onclick, ...more } = rest;
  const a = h('a', { class: cls, href: grammarViewHash(to[0], to[1] ?? {}), ...more }, label);
  a.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onclick?.(e);
  });
  return a;
};
/** The same for a control built as h('button', attrs, …children): `to` makes it a link (see `btn`). */
const navEl = (attrs = {}, ...children) => {
  const { to, type, ...rest } = attrs;
  if (!to) return h('button', { type: 'button', ...rest }, ...children);
  const { onclick, ...more } = rest;
  const a = h('a', { href: grammarViewHash(to[0], to[1] ?? {}), ...more }, ...children);
  a.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onclick?.(e);
  });
  return a;
};
/**
 * The grey help line under an item — how this item is worked, said once, in place of a tip anyone
 * has to dismiss. Two spans and not one string, because the two halves are true on different
 * machines: `__main` is the keyboard model (clipped from sight, but not from the accessibility
 * tree, on a coarse pointer — grammar.css), and `__hold` is the finger's dictionary, said only
 * once a finger has actually been used here (`<html data-touch>`, set by hovergloss.js from a real
 * pointer event and never from a media query — GRAMMAR-CONTRACT.md §17.2, §17.4).
 */
const keyHelp = (text, cls = '') => h('p', { class: `g-keys${cls ? ` ${cls}` : ''}` },
  h('span', { class: 'g-keys__main', text }),
  h('span', { class: 'g-keys__hold', text: ' Hold a word to see what it means.' }));
const phone = () => matchMedia('(max-width: 767.98px)').matches;
const STATE_LABEL = { new: 'new', learning: 'learning', practising: 'practising', mastered: 'mastered', lapsed: 'lapsed' };
const PRESET_LABEL = {
  'review-heavy': ['Review-heavy', 'Due skills first, with confusable pairs. The default.'],
  'this-week': ['This week', "Two thirds from this week's new skills, the rest due reviews."],
  even: ['Even mix', 'Random across everything in the mix.'],
  'one-skill': ['One skill', 'A blocked set on a skill you choose.'],
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** Which of the two sections on this root is showing: 'words' (Word Work) or 'grammar'. */
const sectionMode = () => { const m = document.documentElement.dataset.sectionMode; return m === 'words' || m === 'sheets' ? m : 'grammar'; };
/**
 * What an item says about where its sentence came from (`item.scope`, set by
 * the generators through chapter.js's `scopeNote`). A chapter's practice
 * prefers that chapter's own Latin; when the chapter has none for the skill it
 * reaches outward, and the item says which way it reached rather than leaving
 * the learner to recognise cap. XXXIV in a chapter-VII drill (QA M3). Pure.
 */
/**
 * The chapters the catalogue's "Up to chapter N" filter offers: **every** N
 * from the first chapter to the last one a table is introduced in. It used to
 * be the chapters that introduce a table, which is a different list — the
 * shipped catalogue introduces none in XXIII–XXV or XXIX–XXX, so the menu
 * jumped from XXII to XXVI and from XXVIII to XXXI and the learner reading
 * chapter XXIV had no way to say so (N-8). "Up to chapter N" is a meaningful
 * filter for every N: it means the same as the next one down, which is exactly
 * the answer a learner in an empty chapter wants. `parts` is the catalogue's
 * own `raw.parts`; [] when no table names a chapter at all. Pure.
 */
export function catalogueChapters(parts) {
  const named = (Array.isArray(parts) ? parts : []).flatMap((p) => (p?.tables ?? []).map((t) => Number(t?.chapter))).filter((c) => Number.isFinite(c) && c > 0);
  if (!named.length) return [];
  const max = Math.max(...named);
  return Array.from({ length: max }, (_, i) => i + 1);
}

/**
 * What the Stats page's state tally is counted over, said exactly (N-22). The
 * tally runs over the skill map **and** the chapter sets, because the scheduler
 * treats them alike; the Progress page's "Skills mastered" runs over the
 * grammar skills alone, because a chapter's question set, vocabulary deck and
 * pensa are not skills of the book's spine and their number moves with the
 * learner's own pensa. The two pages therefore count different things, and this
 * line says which rather than pretending one number covers both: "88 skills and
 * 8 chapter sets, counted together" above a tally of 96 named neither. Pure.
 */
export function tallyDenominator(skills, sets) {
  const n = Number(skills) || 0;
  const s = Number(sets) || 0;
  const plural = (x, word) => `${x} ${word}${x === 1 ? '' : 's'}`;
  if (!s) return `All ${plural(n, 'grammar skill')}, counted here.`;
  return `${n + s} in all — ${plural(n, 'grammar skill')} and ${plural(s, 'chapter set')}, counted together. Progress counts the ${n} grammar skills alone, so its "of ${n}" and this ${n + s} are two different tallies.`;
}

/**
 * The word indexes a tap on `index` lights: the sentence's **declared focus**
 * when the tapped word is part of it, else the tapped word alone. A
 * construction can need two words — an ablative absolute (*imbre cadente*), a
 * periphrastic form — and a step that asks "which two words are they?" must
 * light both, as the noticing opener does with the same declaration. The check
 * lit only the word under the finger, so half the answer to a question about a
 * pair never appeared (N-16). A drawn library item carries no written sentence
 * and so no declared focus: there the tapped word is the whole of it. Pure.
 */
export function tapSpan(item, index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) return [];
  const la = item?.prompt?.la ?? '';
  const focus = item?.written?.focus ?? '';
  const span = la && focus ? focusIndexes(la, focus) : [];
  return span.length > 1 && span.includes(i) ? span : [i];
}

/**
 * What a practice header says when the skill's generated bank (§11b) could not
 * be fetched. Offline the bank request is refused, the drill falls back to the
 * book's sentences — which is the right thing to do — and the header said only
 * "then the book's", as though that were the whole offer. The learner was never
 * told, and two refusals reached the console instead (N-13). '' when the bank
 * is there (the header then names its size) and when the skill simply has none:
 * there is nothing to download and nothing to say. Pure.
 */
export function bankUnreachableNote(bank, unreachable) {
  return bank || !unreachable ? '' : ' The sentences the app generates are not downloaded yet, so this is the book\'s own for now — connect once and they will be here.';
}

/**
 * What a chart's retry keeps: `{ cellIndex: text }` for every box the attempt
 * judged right, from the same `cellResults` the attempt was scored on. A
 * scaffold's given cells are not kept — they are printed, not filled, and the
 * rebuilt table prints them again from `chart.given`. `shown` (the boxes the
 * table actually rendered) keeps a cell a phone answered for the learner out of
 * it, so rotating between the two attempts cannot hand back an answer. Nothing
 * here says a kept cell is right: it is text put back in the box, judged again
 * with all the others on the next submit. Pure.
 */
export function keptCells(item, value, shown = null) {
  const out = {};
  for (const r of cellResults(item, value)) {
    if (r.scaffold || !r.ok) continue;
    if (shown && !shown.has(r.i)) continue;
    const text = String(value?.[r.i] ?? '').trim();
    if (text) out[r.i] = text;
  }
  return out;
}

export function scopeSentence(scope) {
  if (!scope || !scope.chapter || scope.scope === 'own') return null;
  const here = `chapter ${roman(scope.chapter)}`;
  if (scope.from == null) return `This sentence is not from a chapter of the book.`;
  if (scope.from === scope.chapter) return null;
  // Under the learner's own ceiling every chapter behind them is equally in play, so an earlier chapter
  // is not news about this chapter — it is just where the sentence is from.
  if (scope.ceiling && !scope.beyond) return `From chapter ${roman(scope.from)} — Latin you have already read.`;
  if (!scope.beyond) return `This skill has no sentence in ${here} itself, so this one is from chapter ${roman(scope.from)} — Latin you have already read.`;
  return `This skill has no sentence in ${here} or earlier, so this one is from chapter ${roman(scope.from)} — further on than you have read.`;
}

/* ------------------------------------------------- the feedback line */
/**
 * Whether what this item is answered *with* is Latin or English. The same rule
 * the input itself already uses — `itemNode`'s `latinTyped` for a typed box,
 * and the `lang` a choice button's label carries — so the feedback can never
 * disagree with the box the answer was written in. A blank, a transform, a
 * question, a pensum and the reverse vocabulary deck are answered in Latin; a
 * parse ("dative singular"), a construction and the forward vocabulary deck
 * are answered in English. Pure.
 */
export function answerIsLatin(item, { rev = false } = {}) {
  if (!item) return false;
  return item.kind === 'blank' || item.kind === 'transform' || item.kind === 'question' || item.kind === 'pensum' || (item.kind === 'vocab' && !!rev);
}

/**
 * "Italia is the nominative singular; here the blank wants the ablative Italiā
 * — the macron is the whole difference", as parts. `label(form)` is the case
 * the form carries, read off its own paradigm; null when the dictionary cannot
 * settle it, and the line then says only that the macron is the difference.
 * Pure.
 */
function macronParts(c, label) {
  const given = String(c.given ?? '').trim();
  const want = String(c.expected ?? '').trim();
  const gl = label(given);
  const wl = label(want);
  const head = gl ? [la(given), ` is the ${gl}`] : ['You wrote ', la(given)];
  const tail = wl ? [`here the blank wants the ${wl}, `, la(want)] : ['the blank wants ', la(want), c.note ? ` (${c.note})` : ''];
  const note = wl && c.note ? ` (${c.note})` : '';
  return [...head, '; ', ...tail, note, ' — they differ only in the macron, and that macron is the ending.'];
}

/**
 * The one-line verdict, **built from parts rather than interpolated** ("All
 * Latin text throughout should be mouse-overable for the meaning",
 * 2026-09-11). Every Latin fragment comes back as `{ la }` and is drawn as its
 * own `lang="la"` element, which is all the pointer dictionary needs; every
 * English fragment stays a plain string, because a marked English word would
 * open the dictionary on itself and be read out as Latin.
 *
 * The words, the punctuation and the spacing are exactly what the interpolated
 * string used to produce — `ctx.say` reads this line's rendered textContent,
 * and a screen reader must hear the line it always heard.
 *
 * Impure edges are handed in, so this stays pure and testable: `parse` is the
 * dictionary's reading of a tapped word, `formLabel` the case a form carries.
 * Pure.
 */
export function feedbackParts(item, result, fb, { rev = false, parse = null, formLabel = () => null } = {}) {
  const short = Array.isArray(fb?.parts) ? fb.parts : [String(fb?.short ?? '')];
  const ans = (t) => (answerIsLatin(item, { rev }) ? la(t) : String(t ?? ''));
  if (item.input === 'self') {
    const lead = result.given === 'right' ? 'Right, by your own account. ' : result.given === 'partly' ? 'Partly — worth another look. ' : 'Not this time. ';
    return [lead, ...short];
  }
  if (result.correct) return ['Right. ', ...short];
  if (item.input === 'tap') {
    // The tapped word and the word that fits are both the sentence's own Latin; the parse between them is English.
    return ['You tapped ', la(result.given), ...(parse ? [` — ${parse}`] : []), '; the word that fits is ', la(result.expected), '. ', ...short];
  }
  if (item.input === 'choice' && result.choice) {
    // A choice label is Latin only where the item is answered in Latin; `plain` is always the plain-words gloss.
    return ['You chose ', ans(result.choice.label), ...(result.choice.plain ? [` (${result.choice.plain})`] : []), '; the answer is ', ans(result.expected), '. ', ...short];
  }
  if ((item.input === 'chart' || item.input === 'inline' || item.input === 'bank') && result.cells) {
    const wrong = result.cells.filter((c) => !c.ok);
    // A pensum blank is macron-sensitive, so a miss that is *only* a macron gets named for what it is (M3).
    const macron = wrong.filter((c) => c.macron);
    if (macron.length === wrong.length) {
      const out = [];
      macron.forEach((c, i) => { if (i) out.push(' '); out.push(...macronParts(c, formLabel)); });
      return [...out, ' ', ...short];
    }
    const out = [`${wrong.length === 1 ? 'One blank' : `${wrong.length} blanks`} off: `];
    // An empty box is a dash, and a dash is not Latin.
    wrong.forEach((c, i) => { if (i) out.push(', '); out.push(c.given ? la(c.given) : '—', ' → ', la(c.expected)); });
    return [...out, '. ', ...short];
  }
  if (item.input === 'match' && result.cells) {
    const wrong = result.cells.filter((c) => !c.ok);
    const out = [`${wrong.length === 1 ? 'One pair' : `${wrong.length} pairs`} off: `];
    // The word is Latin, the meaning it should have had is English.
    wrong.forEach((c, i) => { if (i) out.push('; '); out.push(la(c.la), ' is ', String(c.expected ?? '')); });
    return [...out, '.'];
  }
  // The learner's order usually ends on a word that carries its own punctuation, so a full stop after it would read as a typo.
  if (item.input === 'order') {
    const given = String(result.given ?? '');
    return ['Not quite — you had: ', la(given), /[.!?,;:]$/.test(given.trim()) ? '' : '.', ' ', ...short];
  }
  return ['You answered ', result.given ? ans(result.given) : '—', '; the answer is ', ans(result.expected), '. ', ...short];
}

/* ------------------------------- a vocabulary word in a sentence (§2) */
/**
 * One real sentence using `lemma`, for a vocabulary item's feedback — right or
 * wrong ("for the vocab practice — show a sentence when right or wrong that
 * shows the word used in context — try to use the sentences we already have",
 * the reader, 2026-09-11). Nothing new is written: `pools` are the sentences
 * the app already has, in the order they are preferred — our own written
 * teaching sentences, then the book's own units, then the pre-generated banks.
 *
 * Two rules decide between them:
 *
 * - **a sentence the learner could have read comes first.** One at or before
 *   their chapter wins over a later one from any pool; when nothing at all is
 *   at or before it, a later one is shown and says so, because a sentence they
 *   have not reached still teaches the word and nothing teaches nothing.
 * - **the word must be findable in it.** `isForm(token, lemma)` is the
 *   dictionary's judgement, not string equality — the form in the sentence is
 *   usually inflected. A sentence where the word cannot be lit is passed over:
 *   the point is that the eye lands on it.
 *
 * null when no pool has one, and the view then shows nothing rather than an
 * empty block. Pure.
 */
export function vocabExample({ lemma, pools = [], chapter = null, isForm = null } = {}) {
  const want = String(lemma ?? '').trim();
  if (!want || typeof isForm !== 'function') return null;
  const here = Number(chapter);
  const hit = (s, source) => {
    const la_ = String(s?.la ?? '').trim();
    if (!la_) return null;
    const lit = tokenize(la_).filter((t) => t.isWord).map((t, i) => ({ t, i })).filter(({ t }) => isForm(t.text, want)).map(({ i }) => i);
    if (!lit.length) return null;
    const c = Number(s.chapter);
    return { la: la_, en: String(s.en ?? ''), lit, source, sentenceChapter: Number.isFinite(c) ? c : null, ahead: false };
  };
  const ahead = [];
  for (const pool of pools) {
    for (const s of pool?.sentences ?? []) {
      const got = hit(s, pool.source ?? null);
      if (!got) continue;
      // Number.isFinite(here) false — the learner's chapter is unknown — makes every sentence fair game.
      if (!Number.isFinite(here) || got.sentenceChapter == null || got.sentenceChapter <= here) return got;
      ahead.push(got);
    }
  }
  return ahead.length ? { ...ahead[0], ahead: true } : null;
}

/* --------------------------------------------- the second guess (§3) */
/**
 * The inputs a wrong answer leaves **live**, so the learner can change what
 * they wrote and check it again where it stands ("when a question is wrong
 * keep it on there and allow a second guess, unless the person says skip or
 * start again", the reader, 2026-09-11). The item keeps its red marks and its
 * feedback while they do it — reading the feedback and acting on it is the
 * whole point — and only the first answer is ever logged (`createRunner.answer`
 * returns early with `retry: true`, writing nothing).
 *
 * These five are the ones with the learner's own work in them, work worth
 * adjusting rather than redoing: a typed answer, a chart, Pensum A's endings,
 * Pensum B's bank and a reordered sentence.
 *
 * The other four are deliberately left to close as they always did, because a
 * second guess there is not a guess:
 *
 * - **choice** — the list marks the right answer the moment it is graded
 *   (m13), so picking again is picking the answer off the screen;
 * - **match** — every pair takes its own ✓ or ✗ and the line names the
 *   meaning each word wanted;
 * - **tap** — the words *are* the answer and the line names the one that
 *   fits; after the answer those words become dictionary words instead
 *   (`g-w--pick`), which is the more useful thing for them to do;
 * - **self** (translate) — the learner has already graded themselves against
 *   the model; there is nothing left to judge.
 *
 * Pure.
 */
export const SECOND_GUESS_INPUTS = new Set(['type', 'chart', 'inline', 'bank', 'order']);
export function secondGuess(item, result) {
  if (!item || !result || result.correct) return false;
  return SECOND_GUESS_INPUTS.has(item.input);
}

const KIND_LABEL = { recognise: 'recognise', chart: 'chart', parse: 'parse', blank: 'blank', transform: 'transform', reorder: 'reorder', translate: 'translate', question: 'question', vocab: 'vocabulary', pensum: 'pensum' };
const SET_ROW_LABEL = { questions: 'Questions', vocab: 'Vocabulary', pensum: 'Pensa' };

/**
 * The one line under a row saying where it stands. A row taken out of mixed
 * practice (scheduler.js `removeFromPractice`, the "None" half of the map's
 * pair) is `new` again to the scheduler but keeps everything it learned, and
 * "not started" over forty right answers would be simply false — so a `new`
 * row with a history says what it really is. Pure.
 */
export function dueText(s, now = Date.now()) {
  if (s && s.state === 'new' && (s.successes || s.failures || s.last_at)) {
    const n = (Number(s.successes) || 0) + (Number(s.failures) || 0);
    return `out of the mix · ${n} answer${n === 1 ? '' : 's'} kept`;
  }
  if (!s || s.state === 'new') return 'not started';
  if (s.state === 'learning') return 'in Learn';
  if (s.state === 'lapsed') return 'lapsed — worth a short re-learn';
  if (!s.due_at) return STATE_LABEL[s.state];
  const d = (Date.parse(s.due_at) - now) / DAY_MS;
  let when;
  if (d <= 0) when = overdueRatio(s, now) > 0.5 ? 'overdue' : 'due today';
  else if (d < 1) when = 'due today';
  else if (d < 1.5) when = 'due tomorrow';
  else when = `next in ${Math.round(d)} days`;
  return `${STATE_LABEL[s.state]} · ${when}`;
}

/* --------------------------------------------- progress, on the row */
/*
 * "use a bit of color to show how many parts of a lesson skill extra have been
 * practice. maybe have it mouse over it popsup with whats done or not."
 *
 * The map is the page the learner already opens, so this rides on the row that
 * is already there — the state line, after the dot and the due text — rather
 * than becoming a region of its own. Three things carry the same fact, so
 * none of them is doing it alone (GRAMMAR-CONTRACT.md "Session flow", the
 * colour rule): the **count** ("3 of 6"), the **filled ticks** (a shape, which
 * survives a greyscale print), and the **colour**, which is the only one of the
 * three a colour-blind reader may lose. The colour ramp is the section's own
 * and nothing new: grey while a skill is begun, ink past halfway, `--success`
 * only when every part is done — and because "mastered" is one of the parts,
 * green here means exactly what green already means on the state dot.
 *
 * The panel is ONE node for the whole map, positioned on demand, and the
 * listeners are ONE set, delegated from the document. 88 rows a paint means
 * neither a panel nor a listener per row.
 *
 * `g-parts`, not `g-prog`: `.g-prog` is already the `<progress>` bar a chapter
 * set's Learn pass draws (grammar.css), and taking the name gave every row a
 * 26rem grey stripe. Found live; do not rename it back.
 */
/**
 * One part's line in the panel: the mark, whether "not yet" is said out loud,
 * and the rest.
 *
 * **"Not yet" is always written, and always first.** A part that is not done
 * can still carry a `detail` — a lapsed skill's stability, a chart three cells
 * in — and "Mastered · 3 days of stability" under a tick whose colour the
 * reader cannot see reads as an achievement. The mark, the word and the colour
 * must say the same thing (GRAMMAR-CONTRACT.md "Session flow"). A part with
 * nothing to report falls back to its `blurb`, which says what the part *is*,
 * so a line is never bare. Pure.
 */
export function partLine(part) {
  const done = !!part?.done;
  const tail = String(part?.detail || '').trim() || (done ? 'done' : String(part?.blurb || '').trim());
  return { mark: done ? '✓' : '–', notYet: !done, text: done ? tail : (tail ? ` — ${tail}` : '') };
}

/**
 * How a part that records a scaffold level says which one it was completed at
 * (§12's ladder, §18.1's limitation — the learner: "we could show the completed
 * at 20%, completed at 60%, at 80%"). `part.given` is a percentage **given**,
 * so 0 is the table from memory and 80 the easiest rung, and the wording says
 * which way round that is: "completed at 80%" would read as nearly finished.
 *
 * Null when there is nothing to say, and each null is a different silence:
 *
 *   the part is not done      — nothing was completed, at any level
 *   the level is unknown      — an attempt from before it was written down, or
 *                               a question that was not a whole table. It must
 *                               read as neither an achievement nor a failure,
 *                               so the line simply says what the log counted.
 *
 * The model knows the rung and the view says it, which is why this is here and
 * not in `progress.js`: that module reports facts about a skill, and how hard
 * a table was is a sentence about this panel. Pure.
 */
export function givenNote(part) {
  if (!part?.done || typeof part.given !== 'number') return null;
  const g = part.given;
  if (!Number.isFinite(g) || g < 0 || g > 100) return null;
  // Said in the ladder's own numbers, not the table's arithmetic. A twelve-cell table at the 80 % rung
  // gives ten cells, which is 83 %, and a panel reading "completed with 83 % given" beside a switch the
  // learner set to 80 % looks like a fault. `want` is always within half a cell of the rung, so the
  // nearest rung recovers the setting exactly. The attempt keeps the true fraction; only the sentence
  // rounds, and it rounds to the words the learner chose from.
  // **Only a true zero is "unaided".** Rounding to the nearest rung must never turn a table that had a
  // cell printed for it into one done from memory: that is the one claim here a learner would notice as
  // a lie. A table with anything given rounds among the rungs that give something.
  if (g === 0) return 'completed unaided';
  const rungs = SCAFFOLD_STEPS.filter((s) => s > 0);
  const rung = rungs.reduce((best, s) => (Math.abs(s - g) < Math.abs(best - g) ? s : best), rungs[0]);
  return `completed with ${rung}% given`;
}

/**
 * Where the panel goes, in viewport coordinates. It is `position: fixed` and
 * hangs off the body, so this is the whole of its placement — and the whole
 * reason it can never reflow the row, the list or the page (§17.1, §17.3: a
 * panel that grew the page is the complaint this answers).
 *
 * Below the meter by default; above it when there is no room below **and**
 * there is room above, so a row near the foot of a long map does not open a
 * panel off the bottom of the screen. Left-aligned with the meter, then pulled
 * back inside the viewport, which is what keeps it on a 375px phone. Pure.
 */
export function panelPlace({ top, bottom, left }, { h: ph, w, vw, vh, gap = 8 }) {
  const below = bottom + gap;
  const above = top - gap - ph;
  // Below by choice, above when below would overflow and above has room — and **clamped either way**.
  // The old form returned `below` unclamped whenever neither side fitted, which is the ordinary case on a
  // phone: a meter halfway down a 727px screen, a 401px panel, nothing above it either. Measured 68px of
  // the panel hanging past the bottom of the screen with no way to reach it. When a panel is taller than
  // the screen it now starts at the top margin and scrolls (the CSS caps its height), which is the only
  // honest answer — a phone in landscape is 390px tall and some panels simply cannot fit.
  const y = below + ph > vh - gap && above > gap ? above : below;
  return {
    x: Math.round(Math.max(gap, Math.min(left, vw - w - gap))),
    y: Math.round(Math.max(gap, Math.min(y, vh - ph - gap))),
  };
}

/** The meter's whole fact in one string, for a screen reader: it never depends on seeing the ticks. Pure. */
export function meterLabel(title, p) {
  const total = Number(p?.total) || 0;
  return `${Number(p?.done) || 0} of ${total} part${total === 1 ? '' : 's'} of ${title} practised — show which`;
}

/* ============================== what a line on the page means (§23) */
/*
 * > "I don't kknow what these mean- can you put a pop up that practically
 * > explains them" — and, when the words were put another way:
 * > "Yes but I still don't know waht 1 grammar skill is and 4 chapter sets
 * > I dont know what this means"
 *
 * Two lines of a chapter row: its summary (`1 skill · 4 sets · 3 of 5
 * started`) and a row's state (`◐ in Learn`). "Skill" and "set" are themselves
 * the jargon, so saying them again in other words only moves the problem.
 * **The explainer names the things in front of the learner**: for cap. XXVI,
 * the one skill is *Gerund: the verb as a noun* and the four sets are that
 * chapter's questions, its two word decks and its pensa, by the names the rows
 * under it already use.
 *
 * Three rules hold these three builders together:
 *
 *   **Built from the learner's own figures.** Every builder is handed the same
 *   data the line was printed from — `chapterProgress`, the skill_state row —
 *   and quotes the printed phrase back, so a panel can never contradict the
 *   line above it. None of them takes a DOM or reads storage.
 *
 *   **One shape for all three.** `{ title, summary, lines, foot }`, where a
 *   line is `{ key, mark, label, flag, text, done, here }`: the mark is the
 *   shape half of the signal, `flag` the word half (it is never colour alone),
 *   and one renderer draws all of them into one panel node.
 *
 *   **The numbers come from the scheduler, not from memory.** "Three spaced
 *   successes", "21 days", "6 right of the last 10" are its constants, so a
 *   change to the spacing rewrites the explanation with it.
 */

/** A chapter member as the rows name it: a skill's own title, a set's row label (the reverse deck after its own). Pure. */
export const memberLabel = (s) => (s?.set ? (s.rev ? `${SET_ROW_LABEL[s.set]} · English → Latin` : (SET_ROW_LABEL[s.set] ?? s.id)) : (s?.title ?? s?.id ?? ''));

const SET_WHAT = {
  questions: (s) => `${s.count ?? 0} question${s.count === 1 ? '' : 's'}`,
  vocab: (s) => `${s.count ?? 0} word${s.count === 1 ? '' : 's'}, ${s.rev ? 'English → Latin' : 'Latin → English'}`,
  pensum: () => 'Pensa A, B and C, practise only',
};
/** Which of the two kinds a chapter member is, and what it holds — the half of the answer "1 skill · 4 sets" never gives. Pure. */
export const memberWhat = (s) => (s?.set ? `chapter set · ${(SET_WHAT[s.set] ?? ((x) => `${x.count ?? 0} items`))(s)}` : 'grammar skill');

/**
 * The chapter line, explained by naming what it counts. `material` and
 * `progress` are chapter.js's own (`chapterMaterial`, `chapterProgress`), so
 * the five lines here *are* the five things the line counted.
 *
 * The marks follow whichever number the line is printing: `chapterSummary`
 * switches from "started" to "mastered" the moment anything is mastered, and a
 * panel whose ticks did not switch with it would be answering a question the
 * learner is no longer looking at. Pure.
 */
export function chapterTip({ roman: rom = '', material = null, progress = null, state = () => null, now = Date.now() } = {}) {
  const title = `Cap. ${rom}`;
  const members = material?.members ?? [];
  const total = progress?.total ?? members.length;
  if (!total) {
    return { title, summary: 'This chapter introduces no grammar of its own, and your library has no questions, no word deck and no pensa for it. There is nothing here to work through.', lines: [], foot: null };
  }
  // "Started" is `state !== 'new'` and "mastered" is the state itself — chapterProgress's own tests, read
  // here rather than re-derived, so a row can never be ticked by one rule and counted by the other.
  const counting = progress?.mastered ? 'mastered' : 'started';
  const nSkills = progress?.skills ?? material?.skills?.length ?? 0;
  const nSets = progress?.sets ?? material?.sets?.length ?? 0;
  const both = [nSkills ? `${nSkills} grammar skill${nSkills === 1 ? '' : 's'}` : null, nSets ? `${nSets} chapter set${nSets === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ');
  const lines = members.map((s) => {
    const st = state(s.id);
    const name = st?.state ?? 'new';
    const done = counting === 'mastered' ? name === 'mastered' : name !== 'new';
    const says = dueText(st, now);
    const what = memberWhat(s);
    // The row's own words, unless they would only repeat the flag: "not started — grammar skill · not
    // started" was the first draft of an unopened row, and it says one thing twice.
    const detail = !done && says === 'not started' ? what : `${what} · ${says}`;
    return { key: s.id, mark: done ? '✓' : '–', label: memberLabel(s), flag: done ? null : `not ${counting}`, text: done ? detail : ` — ${detail}`, done, here: false };
  });
  const foot = counting === 'mastered'
    ? `"${progress.mastered} of ${total} mastered" counts the ones the app calls mastered: ${MASTERED_SUCCESSES} successes spaced out over time, and more than ${MASTERED_DAYS} days now between reviews. Until the first of them, the line counted what you had opened instead.`
    : progress?.started
      ? `"${progress.started} of ${total} started" counts the ones you have opened at least once — it says nothing about how well any of them is going. Master one and the line counts those instead: "1 of ${total} mastered".`
      : `"not started" means you have opened none of the ${total} yet. Open one and the line says "1 of ${total} started".`;
  return { title, summary: `The ${total} things this chapter gives you to work through — ${both} — by name:`, lines, foot };
}

/** The five words the state line can say, each in one clause. The numbers are the scheduler's own. */
const STATE_MEANS = Object.freeze([
  ['new', 'not started', 'never opened. Nothing is scheduled.'],
  ['learning', 'in Learn', `the one-sitting lesson is under way. It passes at ${LEARN_NEEDED} right of the last ${LEARN_WINDOW}, across ${LEARN_KINDS} kinds of question.`],
  ['practising', 'practising', 'in mixed practice, with the date it next comes up.'],
  ['mastered', 'mastered', `${MASTERED_SUCCESSES} successes spaced out over time, and more than ${MASTERED_DAYS} days between reviews.`],
  ['lapsed', 'lapsed', 'more than twice its own gap past its due date, so it counts as faded.'],
]);
const SAYS = { row: 'This row says', chip: 'This chip says', plan: 'This skill stands at' };

/**
 * The state line, explained: what the words on screen mean for *this* row
 * first, then the other four briefly, so the vocabulary is learned once and
 * read everywhere. `shown` is the phrase the caller printed — passed in rather
 * than guessed, so the panel quotes the row and cannot drift from it.
 *
 * `can === false` is the row that has no practice at all, and it says **why**:
 * `drillable` is `parse_filter && candidates.length` (items.js), which is two
 * different silences — a skill with no way of pointing at itself in a sentence
 * and a skill whose sentences are simply not in this library yet. Pure.
 */
export function stateTip(title, s, { shown = null, where = 'row', can = true, parse = true, isSet = false, now = Date.now() } = {}) {
  const says = SAYS[where] ?? SAYS.row;
  const line = shown ?? (can === false ? (isSet ? 'no items yet' : parse ? 'no sentences in the library yet' : 'lesson only — no drill') : dueText(s, now));
  const name = can === false ? null : (s?.state ?? 'new');
  // One place prints the scheduler's bare word: a "Review first" chip says "new" or "learning" where a row
  // says "not started" or "in Learn". The list below uses the rows' words, so the panel joins the two up
  // rather than leaving the learner to guess that the word they pressed is missing from it.
  const word = STATE_MEANS.find(([k]) => k === name)?.[1] ?? null;
  const bridge = word && !String(line).startsWith(word) ? ` The rows call this state "${word}".` : '';
  const head = `${says} "${line}".${bridge}`;
  const kept = (Number(s?.successes) || 0) + (Number(s?.failures) || 0);
  const outOfMix = name === 'new' && kept > 0;
  let summary;
  if (can === false && isSet) summary = `${head} A chapter set is the chapter's own material — its questions, its words, its pensa — and none of this one has been read into your library yet, so there is nothing here to practise.`;
  else if (can === false && !parse) summary = `${head} Every question in this section is built by finding the grammar in a real sentence, and this skill has no way of pointing at itself in one — so no question can be made for it. The lesson is the whole of it, and it is never scheduled.`;
  else if (can === false) summary = `${head} Questions are built out of the sentences in your library, and no sentence in your library uses this yet — so there is nothing to build one on. It gets its drill as soon as a reading does.`;
  else if (outOfMix) summary = `${head} You took it out of mixed practice, so nothing is scheduled — and all ${kept} of those answers, its spacing and its stage are kept, so putting it back carries on where it left off.`;
  else if (name === 'learning') summary = `${head} The one-sitting lesson is open and unfinished; "Continue learning" picks up at the first step you have not answered. Pass it — ${LEARN_NEEDED} right of the last ${LEARN_WINDOW}, across ${LEARN_KINDS} kinds of question — and it joins mixed practice.`;
  else if (name === 'practising') summary = `${head} It is in mixed practice: the app spaces it out for you, and that is when it next comes up. Answer it right and the gap widens; get it wrong and it shortens.`;
  else if (name === 'mastered') summary = `${head} Mastered is the app's own word for ${MASTERED_SUCCESSES} successes spaced out over time with more than ${MASTERED_DAYS} days now between reviews. It still comes back, just rarely.`;
  else if (name === 'lapsed') summary = `${head} It went more than twice its own gap past its due date, so the app takes it as faded. Nothing is lost: a short re-learn puts it back.`;
  else summary = `${head} You have not opened it — nothing read, nothing answered, nothing scheduled.`;
  const lines = STATE_MEANS.map(([key, word, means]) => {
    const here = can !== false && !outOfMix && key === name;
    return { key, mark: here ? '▸' : '·', label: word, flag: here ? 'this row' : null, text: here ? ` — ${means}` : means, done: false, here };
  });
  const foot = can === false
    ? `On a skill that can be practised this line says where it stands instead — ${STATE_MEANS.map(([, w]) => w).join(', ')}. This row is never any of them.`
    : outOfMix
      ? 'Two more readings this line has: "lesson only — no drill" and "no sentences in the library yet", for a skill no question can be built for.'
      : 'Three more readings this line has: "out of the mix", with the count of answers it keeps — taken out of mixed practice, with nothing lost; and "lesson only — no drill" or "no sentences in the library yet", for a skill no question can be built for.';
  return { title, summary, lines, foot };
}

/**
 * The parts meter's panel, in the shared shape (§18, §18.3 unchanged — this is
 * the same content `partsBody` built inline, lifted out so it is pure and the
 * one renderer can draw it). Pure.
 */
export function partsTip(title, p) {
  const parts = p?.parts ?? [];
  const lines = parts.map((part) => {
    // A part that records which rung it was completed at leads with it, so a chart part finished with 80 %
    // of its cells printed never reads like one finished from memory (§12, §18.1). It goes in front of the
    // count rather than beside it: "completed unaided · 3 charts answered right" answers *how* before *how
    // many*, which is the order the learner asked the question in.
    const note = givenNote(part);
    const line = partLine(note ? { ...part, detail: part.detail ? `${note} · ${part.detail}` : note } : part);
    return { key: part.key, mark: line.mark, label: part.label, flag: line.notYet ? 'not yet' : null, text: line.text, done: !!part.done, here: false };
  });
  const missing = PARTS.filter((part) => !parts.some((x) => x.key === part.key));
  return { title, summary: p?.summary ?? '', lines, foot: missing.length ? `Not part of this skill: ${missing.map((m) => m.label).join(', ')}.` : null };
}

/**
 * What a trigger says to a screen reader: the label as printed, then the thing
 * the panel will add. Colour and a "?" glyph are the sighted half; this is the
 * whole fact for a reader who has neither. Pure.
 */
export function tipLabel(what, shown, verb = 'explain what this means') {
  return `${what}: ${shown} — ${verb}`;
}

/* ------------------------------ where the learner is in a lesson (§22) */

// `MAX_STEPS`, `stepList` and `normaliseLearnPlace` moved to scheduler.js when the place
// started syncing (§25): the store has to clean a place arriving from the server with the
// same reading this view gives one arriving from localStorage, and two copies of that
// reading would be two chances to disagree about what the learner has finished.

/**
 * Every skill's place in Learn, migrated forward:
 * `{ <skill id>: { done: [<step index>…], seen, at } }`.
 *
 * **Why a set and not a position.** What was kept before was one number —
 * `{ step }`, the runner's own frontier — and a position cannot say *which*
 * steps are finished. Jumping back to step 2 rewrote it to 1 and the three
 * steps already behind the learner were gone; a tick drawn from that would
 * have lied, which is worse than the blank pips it replaced. A set only grows,
 * so going back to re-read a step costs nothing.
 *
 * **The migration, and what an existing record becomes.** Two older shapes
 * reach here and neither may reset anybody — 5599f09 migrated the first of
 * them the same way:
 *
 *     { skill, step, at }               one slot for the whole section
 *     { <id>: { step | seen, at } }     a place per skill, still a position
 *
 * `step: n` was written from the runner's snapshot — the frontier, or the
 * frontier plus one once the item standing there had been answered — so under
 * either reading the checks of steps 1…n have been answered and step n+1 has
 * not. It becomes `done: [0 … n-1]`, which is exactly what that learner had
 * finished: "Continue" opens the step it opened yesterday, `step: 0` (a lesson
 * opened and nothing answered) keeps nothing, and `step === the lesson's step
 * count` — the steps behind them, the ten on screen — becomes every step and
 * still sends "Continue" to the ten. The migration needs no lesson to hand,
 * which is why it can run here, in the reader.
 *
 * A deck's `seen` counts something else entirely (how far through a chapter
 * set's deck the learner is) and passes through untouched. Pure.
 */
export function normaliseLearn(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = typeof raw.skill === 'string' ? { [raw.skill]: { step: raw.step, seen: raw.seen, at: raw.at } } : raw;
  const out = {};
  for (const [id, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const done = Array.isArray(v.done) ? v.done
      : Array.from({ length: Math.min(MAX_STEPS, Math.max(0, Math.floor(Number(v.step) || 0))) }, (_, i) => i);
    // The shape itself is `normaliseLearnPlace`'s (scheduler.js), shared with the store so a place
    // read off the server and one read off this device are cleaned by the same function; the
    // migration above — the section's one slot, and the position this set replaced — is the part
    // that is only ever needed here, at the cache.
    const place = normaliseLearnPlace({ done, seen: v.seen, at: v.at });
    if (place) out[id] = place;
  }
  return out;
}

/**
 * The lesson place's offline cache, in the shape `createGrammarStore` wants
 * (§25). `read()` is what this device had before it ever synced — the
 * learner's computer is holding a finished lesson in it right now — and the
 * store unions that in and pushes it up on its first run. `write()` is the
 * mirror back: the merged truth of every device, so a reader with no network
 * still draws the pips, and a reset or a pruned row takes the cached place
 * with it rather than resurrecting it on the next start.
 *
 * The migrations live in `normaliseLearn`, which is why the cache is built
 * here and not in the store: the two shapes it reads forward
 * (`{ skill, step }` and `{ <id>: { step } }`) only ever existed on a device.
 */
export function learnCache(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  return {
    read() {
      let text = null;
      try { text = storage?.getItem(LS_LEARN); } catch { return null; }
      let raw = null;
      try { raw = text ? JSON.parse(text) : null; } catch { return null; }
      return normaliseLearn(raw);
    },
    write(all) {
      const n = all && typeof all === 'object' ? Object.keys(all).length : 0;
      try { if (n) storage?.setItem(LS_LEARN, JSON.stringify(all)); else storage?.removeItem(LS_LEARN); } catch { /* private mode */ }
    },
  };
}

/** The steps of one skill whose check has been answered, lowest first. Pure. */
export const stepsDone = (place) => stepList(place?.done);

/**
 * The place with those step indices added — the only way the set is ever
 * written to, and it has no other direction: re-reading step 2 cannot take the
 * tick off step 3, and a lesson walked from the middle keeps what was done
 * before it. Everything else on the place is carried through. Pure.
 */
export function withSteps(place, list) {
  const done = new Set(stepsDone(place));
  for (const n of stepList(list)) done.add(n);
  return { ...(place && typeof place === 'object' ? place : null), done: [...done].sort((a, b) => a - b) };
}

/**
 * Which step "Continue learning" opens: **the first whose check has not been
 * answered**, and `steps` itself — meaning the ten — when every one has.
 * Never where the learner happened to be last, which is the whole of the
 * complaint ("it should direct me to the unfinished parts unless I purposely
 * want to retry"): going back is a press on a pip, never the default. Pure.
 */
export function continueAt(place, steps) {
  const n = Math.max(0, Math.floor(Number(steps) || 0));
  const done = new Set(stepsDone(place));
  for (let i = 0; i < n; i++) if (!done.has(i)) return i;
  return n;
}

/**
 * One mark of the Learn stepper, in one of three states: `done` (its check has
 * been answered), `now` (the step on screen) and `todo`.
 *
 * **The glyph is the step's number in every state** (§22.5). A finished step
 * used to become a bare tick, so six finished steps read "✓ ✓ ✓ ✓ ✓ ✓ Ten" and
 * which was step 4 took a hover over each. The state moved to the mark's fill,
 * which the stylesheet draws from `data-state`.
 *
 * **Colour is still never the only signal (§3).** The fills differ in *shape* —
 * a solid disc (done), a solid disc inside a ring (now), an empty ring (todo) —
 * so the row reads in greyscale, and `label` carries the whole fact in words for
 * a reader who sees no glyph at all. Pure.
 */
export function stepMark(i, { title = '', state = 'todo', steps = 0, go = false } = {}) {
  const n = Math.max(0, Math.floor(Number(steps) || 0));
  const ten = i >= n;
  const what = ten ? 'The ten items' : `Step ${i + 1} of ${n}${title ? `, ${title}` : ''}`;
  const says = { done: 'done', now: 'in progress' }[state] ?? 'not started';
  const invite = go ? (state === 'done' ? ' Go back to it.' : ' Go to it.') : '';
  return { glyph: ten ? 'Ten' : String(i + 1), label: `${what}: ${says}.${invite}` };
}

/**
 * The stepper, explained (§22.5): what the row is, then every mark **by name**
 * — the chapter line was answered the same way, because defining the category
 * ("a step") told the learner nothing they could use. `titles` are the steps'
 * own titles in order, `done` the indexes answered, `at` the mark on screen
 * (`titles.length` for the ten). The ten's bar is the scheduler's, not retyped. Pure.
 */
export function stepsTip({ titles = [], done = [], at = 0 } = {}) {
  const n = titles.length;
  const finished = new Set(done);
  const count = titles.filter((_, i) => finished.has(i)).length;
  const lines = titles.map((t, i) => {
    const d = finished.has(i);
    const here = at === i;
    const text = here ? (d ? 'on screen now — you finished it before' : 'on screen now') : d ? 'finished — press its circle to go over it again' : 'not reached yet';
    // Plain text, the print sheet's way: ten titles mark their Latin (`*sine*`), and a panel line cannot italicise.
    return { key: `step-${i}`, mark: String(i + 1), label: String(t ?? '').replace(/\*\*?/g, '') || `Step ${i + 1}`, flag: null, text, done: d, here };
  });
  const open = at === n ? 'On screen now.' : n && count === n ? 'Open now — press "Ten".' : 'It opens once every step is finished.';
  lines.push({ key: 'ten', mark: '', label: 'Ten', flag: null, text: `ten questions on this skill alone. ${LEARN_NEEDED} of ${LEARN_WINDOW} right, across ${LEARN_KINDS} kinds of question, and it joins your mixed practice. ${open}`, done: false, here: at === n });
  return {
    title: 'The parts of this lesson',
    summary: `${n} step${n === 1 ? '' : 's'}, then ten questions. A filled green circle is a step you have finished; the red one with a ring round it is on screen. ${count} of ${n} finished so far.`,
    lines,
    foot: 'You cannot skip ahead: each step opens once the one before it is answered. A finished step can always be reopened by pressing its circle.',
  };
}

/* ------------------------------------ the panel the labels share (§23) */
/*
 * §18 built this for the parts meter: ONE panel node and ONE delegated set of
 * listeners for an 88-row page, `position: fixed` off the body so it can never
 * reflow the row (§17.1, §17.3), flipped and clamped to the viewport (§21),
 * and the hover question asked of the event (§17.2). The machine was right;
 * only its contents were specific to the meter.
 *
 * So it is now general: a trigger is anything carrying `data-tip`, its content
 * is a `() => { title, summary, lines, foot }` in one WeakMap, and the meter
 * is simply the first of three callers. Nothing about the behaviour moved —
 * the same seven listeners, the same `wasHeld` tap toggle, the same placer.
 */
const TIP_ID = 'g-tip-panel';
const TIP_SEL = '[data-tip]';
const tipData = new WeakMap();   // a trigger → () => what its panel should say, built only when it opens
let tipPanel = null;
let tipFor = null;               // the trigger the panel is open against
let tipHover = null;             // open because the pointer is resting on it
let tipHeld = null;              // open because the keyboard is on it, or a finger pressed it
let tipWired = false;

/** What the panel is for: the learner's own reading of the line, so it never takes the keyboard. */
function tipNode() {
  if (tipPanel?.isConnected) return tipPanel;
  tipPanel = h('div', { class: 'g-tip', id: TIP_ID, role: 'tooltip', hidden: true });
  document.body.append(tipPanel);
  return tipPanel;
}

/**
 * Measure, then place with `panelPlace`. Appended to the body and fixed, so it
 * works the same from the map, from the chapter spine, from a chapter page's
 * grammar panel and from the weeks menu's Today card — three of the four are
 * mounted outside the section's own root.
 */
function placeTip(el) {
  const p = tipNode();
  const w = Math.min(320, window.innerWidth - 16);
  p.style.width = `${w}px`;
  p.hidden = false;                                     // measured before it is placed: a hidden box has no height
  const { x, y } = panelPlace(el.getBoundingClientRect(), { h: p.getBoundingClientRect().height, w, vw: window.innerWidth, vh: window.innerHeight });
  p.style.left = `${x}px`;
  p.style.top = `${y}px`;
}

/** One renderer for every kind of explainer: the mark is the shape, `flag` the word, and neither is colour. */
function tipBody(el) {
  const p = tipNode();
  const d = tipData.get(el)?.();
  if (!d) { p.replaceChildren(); return; }
  // `replaceChildren` is the DOM's, not `h`'s: a null passed to it is appended as the text "null".
  p.replaceChildren(...[
    h('p', { class: 'g-tip__h', text: d.title }),
    d.summary ? h('p', { class: 'g-tip__sum', text: d.summary }) : null,
    d.lines?.length ? h('ul', { class: 'g-tip__list' }, d.lines.map((line) => h('li', { class: 'g-tip__item', 'data-done': line.done ? '1' : '0', 'data-here': line.here ? '1' : null, 'data-line': line.key },
      h('span', { class: 'g-tip__mark', 'aria-hidden': 'true', text: line.mark }),
      h('span', { class: 'g-tip__what' },
        h('span', { class: 'g-tip__label', text: line.label }),
        h('span', { class: 'g-tip__detail' },
          line.flag ? h('span', { class: 'g-tip__not', text: line.flag }) : null,
          line.text))))) : null,
    d.foot ? h('p', { class: 'g-tip__foot', text: d.foot }) : null,
  ].filter(Boolean));
}

function syncTip() {
  const want = tipHeld ?? tipHover;
  if (want !== tipFor) {
    if (tipFor) { tipFor.setAttribute('aria-expanded', 'false'); tipFor.removeAttribute('aria-describedby'); }
    tipFor = want ?? null;
    if (!tipFor) { if (tipPanel) { tipPanel.hidden = true; tipPanel.replaceChildren(); } return; }
    tipFor.setAttribute('aria-expanded', 'true');
    tipFor.setAttribute('aria-describedby', TIP_ID);
    tipBody(tipFor);
  }
  if (!tipFor) return;
  // A panel the pointer alone opened takes no pointer (it would flicker as the mouse reached it, and it
  // has nothing to press); one a finger or the keyboard opened does, so a tap on it is not a tap on the
  // row underneath — where "Reset" is.
  tipNode().dataset.hover = tipHeld ? '0' : '1';
  placeTip(tipFor);
}

const closeTip = () => { tipHover = null; tipHeld = null; syncTip(); };

/** Every paint passes a trigger through here: a panel open against a node the redraw has replaced must go. */
function tipCheck() {
  wireTips();
  if (tipFor && !tipFor.isConnected) closeTip();
}

/**
 * One set of listeners for every label the section ever draws. Whether the
 * pointer can hover is asked of the **event** (`pointerHovers`), never of the
 * device: the learner's Windows laptop has a touchscreen and a mouse, and
 * `matchMedia('(hover: hover)')` answers "no" for both (§17.2).
 */
let wasHeld = null;   // what was pinned when the current press began (see the click handler)

function wireTips() {
  if (tipWired || typeof document === 'undefined') return;
  tipWired = true;
  const trigger = (e) => e.target?.closest?.(TIP_SEL) ?? null;
  const inPanel = (t) => !!t?.closest?.('.g-tip');
  document.addEventListener('pointerover', (e) => {
    const b = trigger(e);
    if (!b || !pointerHovers(e) || b === tipHover) return;
    tipHover = b;
    syncTip();
  });
  document.addEventListener('pointerout', (e) => {
    const b = trigger(e);
    if (!b || b !== tipHover) return;
    if (e.relatedTarget && (b.contains(e.relatedTarget) || inPanel(e.relatedTarget))) return;
    tipHover = null;
    syncTip();
  });
  document.addEventListener('focusin', (e) => { const b = trigger(e); if (b) { tipHeld = b; syncTip(); } else if (tipHeld && !inPanel(e.target)) { tipHeld = null; syncTip(); } });
  document.addEventListener('focusout', (e) => { const b = trigger(e); if (b && b === tipHeld) { tipHeld = null; syncTip(); } });
  document.addEventListener('click', (e) => {
    const b = trigger(e);
    if (!b) return;
    // A tap has no hover to open the panel and no leave to close it, so the press itself is the toggle —
    // but the toggle must be measured from **before the gesture began**, not from the state now. Tapping a
    // trigger focuses it, `focusin` opens the panel, and the click arrives a few ms later: asking "is it
    // open?" at that point always answers yes, so one tap opened and then instantly shut it again. It needed
    // two taps, or three with another panel open, and desktop hid the bug because `pointerover` had already
    // set `tipHover`. `wasHeld` is read at pointerdown, before focus moves.
    tipHeld = wasHeld === b ? null : b;
    wasHeld = null;
    syncTip();
  });
  // A press anywhere else puts it away — the finger's equivalent of the pointer leaving. The same press
  // records what was pinned before it, which is what the click above toggles against. Hover is deliberately
  // not consulted: a click on a trigger the mouse is merely resting over should pin it, not close it.
  document.addEventListener('pointerdown', (e) => {
    const b = trigger(e);
    wasHeld = b ? tipHeld : null;
    if (tipHeld && !b && !inPanel(e.target)) { tipHeld = null; syncTip(); }
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tipFor) { const b = tipFor; closeTip(); b.focus?.({ preventScroll: true }); } });
  // The panel is fixed, so a scroll or a resize would leave it hanging over the wrong row. It follows
  // its own row rather than vanishing — the map is long and the learner reads it by scrolling — and it
  // goes only when the row it belongs to has left the document, which is what a redraw does to it.
  const follow = () => { if (!tipFor) return; if (tipFor.isConnected) placeTip(tipFor); else closeTip(); };
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
}

/**
 * A label that explains itself: the printed text, a quiet "?" after it (a
 * shape, so the affordance is not colour), and the panel behind it. `build` is
 * called when it opens and not at paint — 88 rows draw three of these each.
 */
function tipTrigger(kind, build, { cls = '', label = '', ...attrs } = {}, ...children) {
  tipCheck();
  const b = h('button', {
    type: 'button', class: `g-why${cls ? ` ${cls}` : ''}`, 'data-tip': kind, 'aria-expanded': 'false', 'aria-label': label, ...attrs,
  }, ...children, h('span', { class: 'g-why__q', 'aria-hidden': 'true', text: '?' }));
  tipData.set(b, build);
  return b;
}

/**
 * The chapter's own summary line, made to explain itself. It sits inside the
 * spine's `<summary>`, so the press must be stopped from folding the chapter
 * away: the default action is cancelled, and *only* the default — the click
 * still reaches the document, where the one delegated toggle lives.
 */
function chapterTipButton(rom, material, progress, state) {
  const shown = chapterSummary(progress);
  return tipTrigger('chapter', () => chapterTip({ roman: rom, material, progress, state }), {
    cls: 'g-chap__count', label: tipLabel(`Chapter ${rom}`, shown, 'name the things it counts'), onclick: (e) => e.preventDefault(),
  }, shown);
}

/**
 * The state line, made to explain itself — one builder for every place a state
 * word is printed, so the five words can never come to mean different things
 * on different pages. `text` is what the button shows (the Today card shows
 * its own label and explains the state behind it); `shown` is the phrase the
 * panel quotes, and it is always the one the caller printed.
 */
function stateTipButton(title, st, { shown, text = shown, where = 'row', can = true, parse = true, isSet = false, cls = '' } = {}) {
  return tipTrigger('state', () => stateTip(title, st, { shown, where, can, parse, isSet }), {
    cls, label: tipLabel(title, shown, 'explain what this means'),
  }, ...(text ? [text] : []));
}

/**
 * The meter itself: the ticks, the count, and the button that holds them. Null
 * when the skill has no parts at all, so nothing empty is drawn. The label
 * carries the whole count for a screen reader, and the panel is its
 * description, so the fact is never colour's alone.
 */
function partsMeter(title, p) {
  if (!p || !p.total) return null;
  tipCheck();
  const b = h('button', {
    type: 'button', class: 'g-parts', 'data-level': p.level, 'data-tip': 'parts', 'aria-expanded': 'false', 'aria-label': meterLabel(title, p),
  },
  h('span', { class: 'g-parts__ticks', 'aria-hidden': 'true' }, p.parts.map((part) => h('span', { class: 'g-parts__tick', 'data-done': part.done ? '1' : '0' }))),
  // **The unit is named** (§22.1). A bare "3 of 6" beside a skill whose lesson happens to have six teaching
  // steps reads as lesson progress, and the learner read it exactly that way: they pressed Continue expecting
  // to land at step 4. The word is the whole fix — the meter still counts the skill's parts (§18), and the
  // aria-label and the panel's summary have said "parts" from the start, so all three now agree.
  // Renamed "progress" (docs/SIMPLIFY-PLAN.md §3.4), so "part" only ever means a part of the lesson.
  h('span', { class: 'g-parts__count', 'aria-hidden': 'true', text: `progress ${p.done} of ${p.total}` }));
  tipData.set(b, () => partsTip(title, p));
  return b;
}

export function createUI(ctx) {
  const { root, index, gstore, dict, par } = ctx;
  // The grammar skills and the chapter sets (questions-NN, vocab-NN[-rev], pensum-NN) as one map: the scheduler treats them alike.
  const skills = ctx.skills ?? index.skills;
  const skillsIndex = { skills };
  /**
   * Is every word here one the dictionary can answer for? This is what decides
   * whether a **bold** fragment of teaching prose is Latin: the prose bolds a
   * Latin word or ending (*legere*, *-erit*, *quī*) and an English grammar term
   * ("the dative (the 'to/for' form)") with the same mark, and the dictionary
   * is the only honest way to tell them apart. It is also exactly the question
   * "would hovering this say anything?", so a bold that is marked is a bold the
   * pointer can answer on, and an ending the dictionary has never heard of is
   * left alone rather than promising a definition it has not got.
   */
  const laKnown = (t) => {
    const words = String(t ?? '').match(/\p{L}+/gu) ?? [];
    if (!words.length) return false;
    try { return words.every((w) => dict.lookup(w).entries.length > 0); } catch { return false; }
  };
  /** Teaching prose: `*italic*` is always Latin, `**bold**` when the dictionary knows it. */
  const prose = (text) => inline(text, { latin: laKnown });
  const items = ctx.items;
  let view = { name: 'today', params: {} };
  let body = null;
  let allMeanings = false;   // the "show all meanings" switch, for the session
  const lessonCache = new Map();
  // Both voices on one page where the skill is both voices' (voices.js): the passive below the active, with how it is made.
  const lessonOf = async (id) => { if (!lessonCache.has(id)) lessonCache.set(id, withPassive(skills.get(id), await loadLesson(id))); return lessonCache.get(id); };
  const unitOf = (id) => ctx.units.find((u) => u.id === id) ?? null;
  const stateOf = (id) => decay(gstore.getState(id) ?? newState(id), Date.now());
  const titleOf = (id) => skills.get(id)?.title ?? id;
  /** The chapter a skill belongs to, wherever a skill is listed (2026-10-25: "for all skills tell what chapter they are connected to"). */
  const capOf = (id) => { const c = skills.get(id)?.chapter; return c != null && c !== '' ? `Cap. ${roman(Number(c))}` : ''; };
  const capTag = (id) => (capOf(id) ? h('span', { class: 'g-captag', text: capOf(id) }) : null);
  // The practice log, from the synced attempts (practicelog.js): rebuilt when the log grows, so a round played on
  // another device counts here as soon as it has synced, and the "×N" everywhere reads it (practised.js).
  let logMemo = null;
  const pLog = () => {
    const n = gstore?.countAttempts?.() ?? 0;   // the cheap total; the log is only rebuilt when it has changed
    if (!logMemo || logMemo.n !== n) logMemo = { n, log: practiceLog(gstore?.getAttempts?.() ?? []) };
    return logMemo.log;
  };
  setSyncedCounts((key) => pLog().count(key));

  /* ------------------------------------------------------------ shell */
  /** The one Lesson / Game switch (kept on this device): every start follows it; a session's own switch still changes it. */
  function modeToggle() {
    const on = gameKept();
    return h('button', { type: 'button', class: 'g-modetoggle', 'aria-pressed': String(on), title: on ? 'Game mode is on: practice opens as a game. Tap for lesson mode.' : 'Lesson mode: practice opens as a lesson. Tap for game mode.', 'aria-label': `Game mode, ${on ? 'on' : 'off'}`,
      onclick: () => { keepGame(!on); draw(); ctx.say?.(on ? 'Lesson mode: practice opens as a lesson.' : 'Game mode: practice opens as a game.'); } },
      h('span', { class: 'g-modetoggle__opt', 'data-on': String(!on), text: '📖 Lesson' }), h('span', { class: 'g-modetoggle__opt', 'data-on': String(on), text: '▶ Game' }));
  }
  const wwChapterN = () => { const n = Number(view.params?.chapter ?? view.params?.from?.wordwork ?? ctx.currentChapter?.() ?? 1); return bookChapter(n) ? n : 1; };
  function draw() {
    root.dataset.drawnMode = sectionMode();   // index.js setSection: what the root holds now
    // One section, Study (docs/SIMPLIFY-PLAN.md §3.1): four tabs and the one Lesson / Game switch.
    const tab = tabOf(view.name);
    const sub = (items) => h('nav', { class: 'g-subnav', 'aria-label': 'In this tab' }, items.map(([v, label, params = {}]) => h('button', { type: 'button', class: 'g-subnav__btn', 'aria-current': view.name === v ? 'page' : null, onclick: () => (v === '#reading' ? (location.hash = '#/progress') : render(v, params)) }, label)));
    const here = wwChapterN();
    const studyNav = [h('nav', { class: 'g-nav g-nav--study', 'aria-label': 'Study' },
      STUDY_TABS.map((t) => h('button', { type: 'button', class: 'g-nav__btn', 'aria-current': tab === t.id ? 'page' : null, 'aria-label': t.label, onclick: () => render(t.view, {}) }, h('span', { class: 'g-nav__full', text: t.label }), t.short ? h('span', { class: 'g-nav__short', 'aria-hidden': 'true', text: t.short }) : null)),
      modeToggle()),
      tab === 'progress' ? sub([['chart', 'Practice chart'], ['stats', 'Stats'], ['#reading', 'Reading ↗']])
          : ['chapter', 'wordwork', 'sheets', 'wwtable'].includes(view.name) ? sub([['course', '← Course', { by: 'chapter', at: `c${here}` }], ['chapter', `Cap. ${roman(here)} · Grammar`, { chapter: here }], ['wordwork', 'Forms', { chapter: here }], ['sheets', 'Sheet', { chapter: here }]])
            : null];
    const nav = studyNav;
    body = h('div', { class: 'g-body' });
    root.replaceChildren(h('div', { class: 'g' }, ...[].concat(nav).filter(Boolean), body));
    const fn = { lesson: renderLessonView, learn: renderLearnStart, setup: renderSetup, session: renderPracticeStart, redo: renderRedo, blocked: renderBlocked, drill: renderDrill, unlimited: renderUnlimited, mixed: renderMixed, catalogue: renderCatalogue, paradigms: renderParadigms, wordwork: renderWordWork, wwtable: renderWordWorkTable, today: renderToday, course: renderCourse, chapter: renderChapterPage, sheets: renderSheets, stats: renderStats, history: renderHistory, part: renderPart, chart: renderChart, summary: () => renderToday() };
    (fn[view.name] ?? renderToday)(playOnce ? { ...view.params, play: true } : view.params);
    document.title = `${STUDY_TABS.find((t) => t.id === tab)?.label ?? 'Study'} — Latin 103`;
  }
  /** Show a view. Each is a history entry (Back walks the section's views; a session in progress resumes); the new heading takes focus. */
  let playOnce = false;
  function render(name, params = {}, { push = true, focus = true } = {}) {
    closePop();
    // Old names land on their new home (routes.js: Skills → Today, Path and the progressions → Course …).
    ({ name, params } = resolveView(name, params ?? {}));
    // `play` (start this view's game) is for this render alone: kept in the view or the history entry, a Back
    // onto it or any redraw would start the game again by itself.
    // `game` (an address such as a ▶ Play link opened in a new tab): the session opens in game mode, once.
    const { play: playNow = false, game: gameNow = false, ...kept } = params ?? {};
    params = kept;
    playOnce = !!playNow;
    if (gameNow) gameDrillOn();
    view = { name, params };
    // Each entry carries the section mode it was drawn in (Grammar or Word Work), so Back never draws one
    // section's view under the other's tabs; a redraw in place re-marks the entry it is on.
    const state = { grammar: { name, params: name === 'session' || name === 'redo' ? { ...params, resume: true } : params, mode: sectionMode() } };
    // Each view has its own address (chapters.js grammarViewHash), so it can be bookmarked, reloaded, or opened
    // in a new tab; the state still carries the view, so Back draws it without reading the address.
    const url = grammarViewHash(name, state.grammar.params);
    try { if (push) history.pushState(state, '', url); else history.replaceState(state, '', url); } catch { /* file: URLs */ }
    draw();
    playOnce = false;   // this render's game has been started; a later redraw is just a redraw
    window.scrollTo({ top: 0 });
    if (focus) body.querySelector('h1')?.focus?.({ preventScroll: true });
  }
  // The light instance behind the weeks-menu Today card has no generator, so it must never paint the
  // map: every row would read "no sentences in the library yet" until `init()` replaced it (QA-1).
  function refresh() { if (!ctx.items) return; if (['today', 'stats', 'history'].includes(view.name) && showing()) draw(); repaintPanels(); }
  /** True while the section itself is the thing on screen: `draw()` renames the document, so it must not run behind a chapter page. */
  const showing = () => (ctx.section?.() ?? 'grammar') === 'grammar';
  // The chapter pages' grammar panels (index.js's mountChapterGrammar). They are repainted whenever the
  // section's own state changes, and dropped as soon as the shell has taken their element out of the document.
  const panels = new Set();
  function repaintPanels() { for (const p of [...panels]) { if (!p.el?.isConnected) { panels.delete(p); continue; } chapterPanel(p.el, { chapter: p.chapter }); } }
  /** Redraw what is on screen: the current view when the section is showing, and every mounted chapter panel. */
  function repaint() { if (showing() && body) draw(); repaintPanels(); }
  // The new heading takes focus whenever the body is replaced and focus has nowhere to be (a view arriving after a lesson fetch, the end of a session) — G1-09.
  let gameKey = null;   // the running session's Escape-leaves-game-mode listener
  // Any new view leaves a drill's game mode (its summary, a lesson): only a running session draws it full screen.
  // Game mode, once chosen, is kept for every view (gameKept); a view that is not a session gets the game's own bar.
  const GAME_KEY = 'l103.game.drill';
  const gameKept = () => { try { return localStorage.getItem(GAME_KEY) === '1'; } catch { return false; } };
  const keepGame = (on) => { try { localStorage.setItem(GAME_KEY, on ? '1' : '0'); } catch { /* not kept */ } };
  let gameMenu = null;   // the open ☰ menu (openGameMenu)
  const setBody = (...nodes) => {
    closeGameMenu();
    // A reel opened over the page goes with it (a chart's own game, a table's part), so it never sits over the next view.
    for (const d of document.querySelectorAll('dialog.gm[open]')) { try { d.close(); } catch { /* already going */ } }
    const flat = nodes.flat(Infinity).filter(Boolean);
    const game = gameKept() && sectionMode() !== 'sheets';
    body.classList.toggle('g-game', game);
    document.documentElement.classList.toggle('g-game-open', game && showing());
    if (game && !flat.some((n) => n.classList?.contains('g-runnav'))) flat.unshift(gameBar());
    body.replaceChildren(...flat);
    paintSide();
    const f = body.querySelector('h1'); if (f) { f.tabIndex = -1; const a = document.activeElement; if (!a || a === document.body || !body.contains(a)) f.focus({ preventScroll: true }); } };
  // The section may be built twice in a life: once cheaply for the weeks-menu Today card, then in full when Grammar is
  // opened. `dispose()` takes the first instance's listener off so the two never both answer a Back.
  const onPop = (e) => {
    const g = e.state?.grammar;
    if (!g || ctx.section?.() === 'read') return;
    if (g.mode && g.mode !== sectionMode()) ctx.setMode?.(g.mode);   // Back across Grammar ↔ Word Work switches the header too
    render(g.name, g.params ?? {}, { push: false });
  };
  window.addEventListener('popstate', onPop);
  const dispose = () => window.removeEventListener('popstate', onPop);

  /* ------------------------------------------------------ gloss popover */
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', onDocDown, true); } }
  function onDocDown(e) { if (pop && !pop.contains(e.target) && !e.target.closest?.('.g-w')) closePop(); }
  function showGloss(wordEl, form, text, unitLa = '', { hover = false, parse = true } = {}) {
    closePop();
    const r = dict.lookup(form);
    // A pointer resting on a word the dictionary has never heard of — a grammatical term in the prose
    // (nōminātīvus), a bare ending — says nothing at all. A box reading "Not in the dictionary" is what
    // the learner met as "it's not showing the Latin when hovering". A **click** still answers plainly:
    // there they asked a direct question, and silence would be the worse reply.
    if (hover && !r.entries.length) return;
    const entries = r.entries.slice(0, 4);
    const described = entries.map((entry) => dict.describe(entry, { compact: !!ctx.settings?.compact, form: text, context: unitLa }));
    // Every reading the dictionary has (the reader's panel offers them too): the first in full, the others compact.
    //
    // The sense list, in the same place and the same order the reader's panel puts it (wordpanel.js
    // `entryParts`): meaning · parse · dictionary form · **what the word means**. The learner asked for
    // it — "lūdum … the dictionary only says 'game'" — and the senses were in `describe()` all along,
    // thrown away here.
    //
    // Why it sits *under* the case line and not over it. The first line answers "what is this word
    // doing in THIS sentence" ("the game (object)"); the list answers "what can this word mean at
    // all" ("game, play, sport…" / "school"). Putting the general list first would bury the
    // contextual answer under it and would print "game" twice before saying anything new.
    //
    // Why only the first reading gets a list. A hover popup cannot be scrolled — it is
    // `pointer-events: none` so it does not flicker as the mouse enters it (and §17.4's long press
    // opens the same popup), so it has to *fit*, not scroll. Four readings × four senses is a wall
    // on a phone. The first reading is the one the ranking chose for this sentence; the alternates
    // keep their one-line meaning, which already carries their head sense, and the "N entries" line
    // below says they are there.
    //
    // No second cap on the list itself: `pipeline/senses.py` already stops at MAX_SENSES = 4, so the
    // longest list this can print is four short lines. Capping at three here would hide a sense on
    // 36% of the glossary's keys to save one line.
    const block = (d, i) => h('div', { class: `g-pop__entry${i ? ' g-pop__entry--alt' : ''}` },
      h('p', { class: 'g-pop__meaning' }, String(d.meaning ?? '').split(/\s+·\s+/).map((m, j) => [j ? h('br') : null, m])),
      d.parse && parse ? h('p', { class: 'g-pop__parse', text: d.parse }) : null,
      h('p', { class: 'g-pop__lemma' }, h('span', { lang: 'la', class: 'entry__cite', text: d.lemma }), d.category ? ` · ${d.category}` : ''),
      // Senses are meaning, not parse, so §17.1's holdback does not touch them: they name no case,
      // no number and no person. The meaning line already shown above says "(object)" or "to/for"
      // outright, so a list of English senses gives an unanswered tap item strictly less away than
      // what the popup prints today.
      !i && d.senses?.length
        ? h('ol', { class: 'g-pop__senses', 'aria-label': 'Meanings' }, d.senses.map((s) => h('li', { text: s })))
        : null);
    pop = h('div', { class: 'g-pop', role: 'dialog', 'aria-label': `Word: ${text}` },
      h('p', { class: 'g-pop__form', lang: 'la', text }),
      described.length ? described.map(block) : h('p', { class: 'g-pop__meaning g-pop__miss', text: 'Not in the dictionary' }),
      r.entries.length > 1 ? h('p', { class: 'g-pop__more', text: `${r.entries.length} entries${r.entries.length > entries.length ? ` — the first ${entries.length} shown` : ''}` }) : null,
      // Said, not silently omitted: a learner who knows the entry has a parse line would otherwise wonder
      // where it went, and this way the popup states the rule it is keeping rather than appearing broken.
      parse ? null : h('p', { class: 'g-pop__more', text: 'The parse is held back until you answer.' }),
      btn('×', { class: 'g-pop__close', 'aria-label': 'Close' }, 'g-pop__close'));
    pop.querySelector('.g-pop__close').addEventListener('click', closePop);
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePop(); wordEl.focus(); } });
    root.append(pop);
    const wr = wordEl.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 16);
    pop.style.width = `${w}px`;
    // The sense list made this popup taller, so where it goes started to matter: a word near the foot
    // of a phone screen put the senses under the fold, and a *hover* popup cannot be scrolled to
    // (`pointer-events: none`). `panelPlace` is the explainer panel's placement, reused rather than
    // written again — it flips above when below would overflow AND clamps either way, which the
    // obvious hand-rolled flip does not: when neither side fits (a 727px phone, a word halfway down)
    // an unclamped "below" leaves the foot of the popup off the screen. Measured after the width is
    // set, because the width decides the wrapping and so the height.
    //
    // Two differences from `.g-tip`, both because this popup is `position: absolute` inside `root`
    // rather than fixed on the body: the viewport coordinates come back through `rr`, and the left
    // asked for is the word's centre rather than its left edge (panelPlace clamps it the same way).
    const centred = wr.left + wr.width / 2 - w / 2;
    const { x, y } = panelPlace(
      { top: wr.top, bottom: wr.bottom, left: centred },
      { h: pop.getBoundingClientRect().height, w, vw: window.innerWidth, vh: window.innerHeight },
    );
    pop.style.left = `${Math.round(x - rr.left)}px`;
    pop.style.top = `${Math.round(y - rr.top)}px`;
    document.addEventListener('pointerdown', onDocDown, true);
    // A pointer opened it, so the keyboard stays where the reader put it: taking focus here would
    // pull it out of the answer box just because the pointer crossed a word.
    pop.dataset.hover = hover ? '1' : '0';
    if (!hover) pop.querySelector('.g-pop__close').focus({ preventScroll: true });
  }

  /*
   * The dictionary on the pointer (asked for 2026-09-11: "you should not have to click on the word
   * in the grammar section"). Delegated from the body, so it covers every `.g-w` the section draws,
   * now and later. A click still means what it meant — in a tap item, choosing the word.
   *
   * Only where hovering is real, asked of the pointer and not of the device: on a touch screen a
   * "hover" fires on the tap that was meant to choose a word.
   *
   * The machine — that rest delay, that guard, the leave, and cutting plain-text Latin into words
   * the first time the pointer crosses it — is hovergloss.js, shared with the reader, which was
   * asked for the same thing ("All Latin text throughout"). What stays here is what is the
   * section's own: which elements are words, which popup, what a word means, and which words must
   * keep quiet. `LA_NO` is what must never be cut, nor cut inside: a control whose text is its
   * value, and everything that is already a word or a popup.
   */
  // Every explainer trigger (`[data-tip]`) and the panel they share (`.g-tip`) are in here for a reason,
  // not for symmetry: an explainer is a report about the learner, not reading text, and two popups
  // answering one rest of the pointer is a mess. So where they meet, the explainer wins and the dictionary
  // keeps quiet — nothing inside either is ever cut into words, even if a line one day cites a form.
  const LA_NO = 'input, textarea, select, option, .g-w, .g-wx, .g-la, .g-pop, .g-blank, .g-parts, .g-tip, [data-tip]';

  /** Has the item this word belongs to been answered? The run stamps `data-result` on the page; a
   *  teaching step has no stamp, so the feedback node being on screen is the same fact. */
  function answered(w) {
    // The run stamps `data-result` on the page; the noticing opener stamps `data-done`; a teaching
    // step has neither, and there the feedback node being on screen is the same fact.
    if (w.closest('[data-result], [data-done="1"]')) return true;
    const scope = w.closest('.g-notice, .g-step__body, .g-run, .g-body') ?? root;
    return !!scope.querySelector('.g-fb, .g-fb__line');
  }

  // `root` and not `body`: body is rebuilt by every draw(), and is still null when this runs.
  attachHoverGloss({
    root,
    word: '.g-w, .g-wx',
    pop: '.g-pop',
    cut: (el) => cutLatinWords(el, { tokenize, cls: 'g-wx', skip: LA_NO }),
    // No word is silent. The first version kept the whole entry back on an unanswered tap item, because a
    // grammar item asking "which word is in the ablative?" is answered outright by an entry that says
    // "ablative". But that also took the *meaning* away, and on a comprehension question — tap the words
    // that answer "Quālēs esse videntur illae īnsulae?" — knowing what the words mean is the reading, not
    // the answer (learner, 2026-09-12: "I want the latin in these questions to also mouse/touch over so
    // that they show the definition"). So the entry is split: the meaning and the dictionary form always,
    // the **parse** held back while a tap item is unanswered. Hovering every word in turn can no longer
    // find the ablative, and the learner can still read the sentence.
    skip: () => false,
    busy: () => !!pop && pop.dataset.hover !== '1',   // a popup opened by a click is the reader's own; leave it alone
    show: (w) => {
      const ctxLa = w.closest('.g-la, [lang="la"]')?.textContent ?? '';
      const held = w.classList.contains('g-w--pick') && !answered(w);
      showGloss(w, w.dataset.form ?? w.textContent, w.textContent, ctxLa, { hover: true, parse: !held });
    },
    hide: () => { if (pop && pop.dataset.hover === '1') closePop(); },
  });

  /** A Latin sentence as tappable words. `target`: word index (or a list of them) to mark; `tap(index)`: the words are the answer; a `___` blank is marked as the target. */
  function latin(la, { target = null, tap = null, cls = '' } = {}) {
    const p = h('p', { class: `g-la${cls ? ` ${cls}` : ''}`, lang: 'la' });
    const targets = new Set(target == null ? [] : Array.isArray(target) ? target : [target]);
    let wi = -1;
    let last = null;
    for (const t of tokenize(la)) {
      if (!t.isWord) {
        const parts = /^(\S*)([\s\S]*)$/.exec(t.text);
        // In a tap item the punctuation clinging to a word stays inside its box, so "superbia," reads as one word.
        if (tap && last && parts[1]) { last.append(h('span', { class: 'g-w__punct', 'aria-hidden': 'true', text: parts[1] })); p.append(parts[2]); }
        else p.append(t.text);
        const blank = /___/.exec(t.text);
        if (blank && !tap) {   // the blank is the target of a blank item (G1-02)
          const node = p.lastChild;
          const before = node.textContent.slice(0, blank.index), after = node.textContent.slice(blank.index + 3);
          node.textContent = before;
          p.append(h('span', { class: 'g-blank', role: 'img', 'aria-label': 'blank' }), after);
        }
        last = null;
        continue;
      }
      wi += 1;
      const i = wi;
      // `g-w--pick`: in a tap item the words are the answer, so the dictionary keeps quiet until it is given.
      const b = h('button', { type: 'button', class: `g-w${targets.has(i) ? ' g-w--target' : ''}${tap ? ' g-w--pick' : ''}`, 'data-form': t.form, 'data-index': String(i), lang: 'la', text: t.text,
        onclick: (e) => { if (tap) tap(i, e.currentTarget); else showGloss(e.currentTarget, t.form, t.text, la); } });
      if (tap) b.setAttribute('aria-label', `${t.text}: choose this word`);
      p.append(b);
      last = b;
    }
    return p;
  }
  /**
   * The target's dictionary line under the sentence ("puellae — from puella, girl").
   * A `blank` item has taken its target *out* of the sentence, so printing the
   * inflected form there would print the answer one line above the input (QA B1):
   * a blank shows the dictionary form and its meaning, and nothing else.
   */
  function glossNode(item) {
    const [cite, ...rest] = String(item.prompt.gloss).split(' — ');
    const meaning = rest.join(' — ');
    const dict = h('span', { lang: 'la', class: 'entry__cite', text: cite });
    if (item.kind === 'blank' || !item.target?.text) return h('p', { class: 'g-gloss' }, dict, ` — ${meaning}`);
    return h('p', { class: 'g-gloss' }, h('span', { lang: 'la', text: item.target.text }), ' — from ', dict, `, ${meaning}`);
  }
  /** "Show all meanings": every word's first reading under the sentence. */
  function glossList(item) {
    // A blank item's `meanings` still carry the word the blank replaced; listing it would hand over the answer.
    const hide = item.kind === 'blank' ? item.target?.start ?? null : null;
    const rows = (item.meanings || []).filter((m) => hide == null || m.start !== hide).map((m) => {
      // The *printed* word, macrons and all — `m.form` is stripped, and stripped means māla (apples)
      // reads as mala (bad). Where the dictionary cannot tell the two apart it says so, and both
      // readings are shown rather than one of them chosen (QA B3).
      const res = dict.lookup(m.text);
      const sense = (e) => { const d = e ? dict.describe(e, { compact: true, form: m.text }) : null; return d ? String(d.meaning).split(/\s+·\s+/)[0] : null; };
      const head = (e) => String((e?.senses || [])[0] ?? '');
      const readings = [];
      for (const e of res.ambiguous ? res.entries : res.entries.slice(0, 1)) {
        if (readings.length >= 3 || readings.some((r) => r.head === head(e))) continue;
        const s = sense(e);
        if (s && !readings.some((r) => r.text === s)) readings.push({ head: head(e), text: s });
      }
      const text = readings.length ? readings.map((r) => r.text).join(' · or ') : 'not in the glossary';
      return h('li', {}, h('span', { lang: 'la', class: 'g-all__la', text: m.text }), ' — ', h('span', { class: `g-all__en${readings.length ? '' : ' g-quiet'}`, text }));
    });
    return h('ul', { class: 'g-all', 'aria-label': 'All meanings' }, rows);
  }

  /* -------------------------------------------------------------- today */

  /** Today: the daily plan (today.js), with the run in progress and the "start all as new" queue above it. */
  function todaySection({ heading = 'Today' } = {}) {
    const saved = readJSON(LS_SESSION, null);
    const queue = (readJSON(LS_QUEUE, []) || []).filter((id) => skills.has(id) && stateOf(id).state !== 'practising' && stateOf(id).state !== 'mastered');
    return h('section', { class: 'g-today', 'aria-labelledby': 'g-today-h' },
      h('h2', { id: 'g-today-h', class: 'g-h2', text: heading }),
      saved?.queue?.length && saved.index < saved.queue.length ? h('p', { class: 'g-today__line' }, `${saved.redo ? 'A redo' : 'A practice session'} is in progress (${Math.min(saved.index, saved.queue.length)} of ${saved.queue.length} answered). `, btn('Resume', { onclick: () => render(saved.redo ? 'redo' : 'session', { ...(saved.params ?? {}), resume: true }) }, 'btn btn--primary g-today__btn'), ' ', btn('Discard', { onclick: () => { writeJSON(LS_SESSION, null); draw(); } }, 'btn btn--quiet g-today__btn')) : null,
      reviewButton(),
      queue.length ? h('p', { class: 'g-today__line' }, `Learning in book order: ${queue.length} skill${queue.length === 1 ? '' : 's'} to go, next `, navEl({ class: 'g-link', to: ['learn', { skill: queue[0], queue: queue.slice(1) }], onclick: () => render('learn', { skill: queue[0], queue: queue.slice(1) }) }, titleOf(queue[0])), '. ', btn('Stop the run', { onclick: () => { writeJSON(LS_QUEUE, null); draw(); } }, 'btn btn--quiet g-today__btn')) : null,
      todayCard({ place: 'map', bare: true }));
  }

  /* -------------------------------------------------- a chapter's grammar */
  /**
   * One chapter's grammar as a list of nodes: its skills, its chapter sets and
   * the ways into practising it. Drawn in the reader's chapter page
   * panel (`chapterPanel`).
   * `known` false = the section has not loaded its generator yet, so nothing
   * claims what can or cannot be drilled.
   */
  function chapterBody(row, { from = null, nav = null, known = !!ctx.items } = {}) {
    const go = nav ?? ((name, params) => render(name, { ...params, from }));
    const { material, progress } = row;
    const out = [];
    if (!material.members.length) { out.push(h('p', { class: 'g-quiet', text: 'This chapter introduces no grammar of its own.' })); return out; }
    if (material.skills.length) out.push(h('ul', { class: 'g-skills' }, material.skills.map((s) => skillRow(s, { go, known }))));
    if (material.sets.length) out.push(h('div', { class: 'g-sets' }, h('h3', { class: 'g-sets__h', text: 'Chapter sets' }), h('ul', { class: 'g-skills g-skills--sets' }, material.sets.map((s) => setRow(s, { go, known })))));
    if (!known) { out.push(h('p', { class: 'g-quiet', text: 'Reading the library to see what can be practised…' })); return out; }
    const pool = chapterPool(material, { state: stateOf, drillable });
    if (pool.rotation.length) {
      // "Redo the N you missed", narrowed to this chapter, with the count (GRAMMAR-CONTRACT.md "Redo what was
      // wrong"). With nothing to redo the chapter says so in a line rather than offering an empty session.
      const missedHere = missedCount({ chapter: material.chapter });
      out.push(h('div', { class: 'g-chap__acts' },
        h('div', { class: 'g-acts' },
          btn('Practise this chapter', { to: ['session', { chapter: material.chapter }], onclick: () => go('session', { chapter: material.chapter }), 'aria-label': `Practise chapter ${row.roman}` }, 'btn btn--primary'),
          missedHere ? btn(`Redo the ${missedHere} you missed`, { to: ['redo', { chapter: material.chapter }], onclick: () => go('redo', { chapter: material.chapter }), 'aria-label': `Redo the ${missedHere} item${missedHere === 1 ? '' : 's'} of chapter ${row.roman} you missed and have not since got right` }, 'btn') : null,
          chapterAllNone(material, row)),
        h('p', { class: 'g-quiet', text: `A mixed session of ten, drawn only from this chapter — its skills, and its own sentences wherever the library has them: ${pool.rotation.length} of the ${progress.drillable} it can drill ${pool.rotation.length === 1 ? 'is' : 'are'} in rotation.${missedHere ? '' : ' Nothing of this chapter is waiting to be redone.'}` })));
    } else if (pool.addable.length) {
      out.push(h('div', { class: 'g-chap__acts' },
        h('div', { class: 'g-acts' }, chapterAllNone(material, row)),
        h('p', { class: 'g-quiet', text: 'Nothing from this chapter is in mixed practice yet. Learn a skill above, or add them all and they will come up as they fall due — and the Practice tab can draw on them even before you do, with "Include what you have not studied".' })));
    } else if (progress.drillable) {
      out.push(h('p', { class: 'g-quiet', text: 'Everything here is still being learned.' }));
    } else {
      out.push(h('p', { class: 'g-quiet', text: 'Nothing in this chapter can be drilled yet — the lessons are here to read.' }));
    }
    return out;
  }

  /**
   * The chapter's own "add all or none", the same pair the map carries over
   * its filter — one chapter is just the level this list is shown at. Both
   * ends go through the map's `bulkAdd` / `bulkNone`, so a chapter and the
   * whole map behave identically and say the same things.
   */
  function chapterAllNone(material, row) {
    const ids = new Set((material.members ?? []).map((s) => s.id));
    const what = `chapter ${row?.roman ?? roman(material.chapter)}`;
    return h('div', { class: 'g-seg g-seg--allnone', role: 'group', 'aria-label': `Mixed practice · ${what}` },
      btn('Add all', { onclick: () => bulkAdd((id) => ids.has(id), what), 'aria-label': `Add all of ${what} to mixed practice` }, 'g-seg__btn'),
      btn('None', { onclick: () => bulkNone((id) => ids.has(id), what), 'aria-label': `Take all of ${what} out of mixed practice` }, 'g-seg__btn'));
  }

  /**
   * The chapter page's grammar panel (`mountChapterGrammar` in index.js): the
   * same rows and the same actions as the map, rendered into the shell's own
   * element. Its links open the Grammar section and carry a way back to this
   * chapter.
   */
  function chapterPanel(el, { chapter, known = !!ctx.items } = {}) {
    if (!el) return;
    const n = Number(chapter);
    const tracked = [...panels].find((p) => p.el === el);
    if (tracked) tracked.chapter = n; else panels.add({ el, chapter: n });
    const entry = spine(ctx.chapters ?? null).find((c) => c.n === n) ?? null;
    const material = chapterMaterial(n, { skills, order: index.order, sets: ctx.sets ?? new Map(), entry });
    const progress = chapterProgress(material, { state: stateOf, drillable: known ? drillable : () => true });
    const row = { n, roman: entry?.roman ?? roman(n), title: entry?.title ?? '', material, progress };
    const nav = (name, params) => (ctx.go ? ctx.go(name, { ...params, from: { chapter: n } }) : render(name, { ...params, from: { chapter: n } }));
    el.replaceChildren(h('div', { class: 'g-chapter' },
      h('header', { class: 'g-chapter__head' },
        // The chapter page's own tab already says "Grammar"; the heading is there for a screen reader
        // walking the page's structure, and the line under it is what the eye needs — the counts.
        h('h2', { class: 'g-chapter__h visually-hidden', text: `Grammar of chapter ${entry?.roman ?? roman(n)}` }),
        h('p', { class: 'g-chapter__sum' }, chapterTipButton(row.roman, material, progress, stateOf))),
      ...chapterBody(row, { nav, known }),
      // This chapter's part of the practice chart: practised or not, how much, and what is still to do.
      h('div', { class: 'g-chapter__chart' }, h('h3', { class: 'g-h2', text: 'Practice chart' }), chartChapter(n, { compact: true }),
        h('div', { class: 'g-acts' }, btn('The whole chart →', { to: ['chart', { chapter: n }], onclick: () => goView('chart', { chapter: n }) }, 'btn btn--quiet')))));
  }

  /**
   * One row's progress sheet (progress.js). Built per row, which is what the
   * model asks for: `getAttempts({ skill })` reads a per-skill index, so 88
   * calls a paint are 88 array lookups, and `learnAll()` memoises on the
   * stored string, so they are 88 reads of one parsed object.
   *
   * `attempts: null` would mean "not known"; the log is always loaded by the
   * time a row is drawn, so the rows are passed and an empty log honestly
   * means none. `known` false is the one case where nothing is claimed: the
   * generator has not been read yet, so what the skill can even have is
   * unknown and the row shows no meter at all rather than a wrong denominator.
   */
  function progressOf(s, known = true) {
    if (!known) return null;
    return skillProgress(s, {
      state: stateOf(s.id),
      attempts: gstore.getAttempts({ skill: s.id }),
      learn: learnPlace(s.id),
      drillable: drillable(s.id),
      hasBank: hasBank(s.id),
    });
  }

  function skillRow(s, { go = null, known = true } = {}) {
    const nav = go ?? ((name, params) => render(name, params));
    const st = stateOf(s.id);
    const acts = [];
    const lessonBtn = btn('Lesson', { to: ['lesson', { skill: s.id }], onclick: () => nav('lesson', { skill: s.id }) }, 'btn btn--quiet');
    // `known` false: the panel has states but no generator yet, so the row says nothing about what can be drilled (QA-B1's rule).
    const can = known ? drillable(s.id) : null;
    // "Just drill it" (§10): one tap from the row to ten items on this skill alone, the rule pinned above each.
    const drillBtn = can ? btn('Just drill it', { to: ['drill', { skill: s.id }], onclick: () => nav('drill', { skill: s.id }), 'aria-label': `Just drill ${s.title}: ten items, no lesson first` }, 'btn btn--quiet') : null;
    if (!known || !can) {
      // No sentence in the library fits (the metre skills by design): the lesson stands, nothing to drill (M8).
      acts.push(lessonBtn);
    } else if (st.state === 'new') {
      acts.push(btn('Start as new', { to: ['learn', { skill: s.id }], onclick: () => nav('learn', { skill: s.id }) }, 'btn'), btn('Add to mixed practice', { onclick: () => addSkill(s.id) }, 'btn btn--quiet'), lessonBtn);
    } else if (st.state === 'learning') {
      acts.push(btn('Continue learning', { to: ['learn', { skill: s.id }], onclick: () => nav('learn', { skill: s.id }) }, 'btn'), lessonBtn);
    } else if (st.state === 'lapsed') {
      acts.push(btn('Re-learn', { to: ['learn', { skill: s.id }], onclick: () => nav('learn', { skill: s.id }) }, 'btn'), btn('Practise this skill', { to: ['blocked', { skill: s.id }], onclick: () => nav('blocked', { skill: s.id }) }, 'btn btn--quiet'), lessonBtn);
    } else {
      acts.push(btn('Practise this skill', { to: ['blocked', { skill: s.id }], onclick: () => nav('blocked', { skill: s.id }) }, 'btn'), lessonBtn);
    }
    if (drillBtn) acts.splice(1, 0, drillBtn);

    // Unlimited and mixed practice (§11, §12), the same two taps, on the skills that have a generated bank.
    if (drillBtn && hasBank(s.id)) acts.splice(2, 0, ...practiceButtons(s, nav));
    if (!s.set && (can || (known && s.paradigms?.length))) acts.unshift(playButton(s.id, { nav: go, chapter: s.chapter }));
    if (known && can && (st.state === 'new' || st.state === 'learning' || st.state === 'lapsed')) acts.splice(1, 0, learnGameButton(s.id, { nav: go }));
    if (gstore.countAttempts(s.id)) acts.push(btn('History', { to: ['history', { skill: s.id }], onclick: () => nav('history', { skill: s.id }), 'aria-label': `History of ${s.title}` }, 'btn btn--quiet'));
    if (known) acts.push(btn('Reset', { onclick: () => resetSkill(s.id), 'aria-label': `Reset ${s.title}` }, 'btn btn--quiet g-skill__reset'));
    return h('li', { class: 'g-skill', 'data-state': st.state, 'data-area': areaOf(s.id) },
      h('div', { class: 'g-skill__main' },
        areaTag(s.id),
        navEl({ class: 'g-skill__title', to: ['lesson', { skill: s.id }], onclick: () => nav('lesson', { skill: s.id }) }, s.title),
        h('p', { class: 'g-skill__plain', text: `${s.plain} · ${s.course} week ${s.week ?? '—'}` }),
        h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': can === false ? 'none' : st.state, 'aria-hidden': 'true' }),
          stateTipButton(s.title, st, { shown: can === false ? (s.parse_filter ? 'no sentences in the library yet' : 'lesson only — no drill') : dueText(st), can: can !== false, parse: !!s.parse_filter }),
          partsMeter(s.title, progressOf(s, known)), countBadge(`skill:${s.id}`))),
      h('div', { class: 'g-skill__acts' }, acts));
  }
  /** A chapter set as a row: Questions · Vocabulary (· English → Latin, optional) · Pensa — the same actions and states as a skill; pensa have no Learn. */
  function setRow(s, { go = null, known = true } = {}) {
    const nav = go ?? ((name, params) => render(name, params));
    const st = stateOf(s.id);
    const can = known ? drillable(s.id) : null;
    const acts = [];
    const learnable = s.set !== 'pensum';
    if (can === false) acts.push(h('span', { class: 'g-quiet', text: 'nothing here yet' }));
    else if (can === null) { /* not known yet: the row states its counts and nothing else */ }
    // A new set offers the two documented routes only — Start as new, or Add to mixed practice. "Practise" bypassed
    // both and put the row into rotation without the learner choosing (m16); a pensum has no Learn, so it keeps it.
    else if (st.state === 'new') { if (learnable) acts.push(btn('Start as new', { to: ['learn', { skill: s.id }], onclick: () => nav('learn', { skill: s.id }) }, 'btn')); acts.push(btn('Add to mixed practice', { onclick: () => addSkill(s.id) }, learnable ? 'btn btn--quiet' : 'btn')); if (!learnable) acts.push(btn('Practise', { to: ['blocked', { skill: s.id }], onclick: () => nav('blocked', { skill: s.id }) }, 'btn btn--quiet')); }
    else if (st.state === 'learning') acts.push(btn('Continue learning', { to: ['learn', { skill: s.id }], onclick: () => nav('learn', { skill: s.id }) }, 'btn'));
    else if (st.state === 'lapsed') { if (learnable) acts.push(btn('Re-learn', { to: ['learn', { skill: s.id }], onclick: () => nav('learn', { skill: s.id }) }, 'btn')); acts.push(btn('Practise', { to: ['blocked', { skill: s.id }], onclick: () => nav('blocked', { skill: s.id }) }, learnable ? 'btn btn--quiet' : 'btn')); }
    else acts.push(btn('Practise', { to: ['blocked', { skill: s.id }], onclick: () => nav('blocked', { skill: s.id }) }, 'btn'));
    if (gstore.countAttempts(s.id)) acts.push(btn('History', { to: ['history', { skill: s.id }], onclick: () => nav('history', { skill: s.id }), 'aria-label': `History of ${s.title}` }, 'btn btn--quiet'));
    if (known) acts.push(btn('Reset', { onclick: () => resetSkill(s.id), 'aria-label': `Reset ${s.title}` }, 'btn btn--quiet g-skill__reset'));
    const what = s.set === 'questions' ? `${s.count} question${s.count === 1 ? '' : 's'}${s.data?.title ? ` · ${s.data.title}` : ''}` : s.set === 'vocab' ? `${s.count} word${s.count === 1 ? '' : 's'}${s.rev ? ' · English → Latin, an optional extra deck' : ' · Latin → English'}` : `${s.data?.A.length ?? 0} A · ${s.data?.B.length ?? 0} B · ${s.data?.C.length ?? 0} C · practise only`;
    return h('li', { class: 'g-skill g-skill--set', 'data-state': st.state, 'data-set': s.set },
      h('div', { class: 'g-skill__main' },
        h('p', { class: 'g-skill__title g-skill__title--set', text: memberLabel(s) }),
        h('p', { class: 'g-skill__plain', text: what }),
        h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': can === false ? 'none' : st.state, 'aria-hidden': 'true' }),
          stateTipButton(memberLabel(s), st, { shown: can === false ? 'no items yet' : dueText(st), can: can !== false, isSet: true }),
          partsMeter(SET_ROW_LABEL[s.set] ?? s.id, progressOf(s, known)))),
      h('div', { class: 'g-skill__acts' }, acts));
  }
  const drillable = (id) => ctx.drillable(id);
  async function addSkill(id) {
    if (!drillable(id)) { ctx.say(`${titleOf(id)} has no drillable sentences yet.`); return; }
    await gstore.setState(addToPractice(gstore.getState(id) ?? id)); ctx.say(`${titleOf(id)} added to mixed practice.`); repaint();
  }
  /**
   * "Add all" over whatever the list is showing. `scope` is the filter the
   * learner can see (everything, one category, the chapter sets); without one
   * it is the whole map, as it was before the pair existed.
   *
   * Two things stay out, and the confirm says both rather than quietly
   * differing from the word "all": a skill already in Learn keeps its run (the
   * bulk add used to move it to `practising` and throw the round away, m17),
   * and the English → Latin vocabulary decks are extras that each chapter's
   * own row can add.
   */
  async function bulkAdd(scope = () => true, what = 'everything here') {
    const ids = [...skills.keys()].filter((id) => scope(id) && !skills.get(id).rev && !inRotation(stateOf(id)) && stateOf(id).state !== 'learning' && drillable(id));
    const learning = [...skills.keys()].filter((id) => scope(id) && stateOf(id).state === 'learning' && drillable(id)).length;
    if (!ids.length) { ctx.say(`All of ${what} that can be drilled is already in mixed practice.`); return; }
    const asides = [learning ? `${learning} part-way through Learn ${learning === 1 ? 'keeps its run' : 'keep their runs'} and stays out.` : '', 'The English → Latin decks are extras; add one from its own row.'].filter(Boolean).join(' ');
    if (!confirm(`Add ${ids.length} of ${what} to mixed practice? Each will be practised as it comes up, without a lesson first. ${asides}`)) return;
    for (const id of ids) await gstore.setState(addToPractice(gstore.getState(id) ?? id));
    ctx.say(`${ids.length} added to mixed practice.`); repaint();
  }
  /**
   * …and "None": the same scope taken back out. Nothing is deleted — every
   * attempt, every confusion and the whole spacing stay where they are, and
   * "Add all" brings a row back at the stability it had. `resetSkill` is the
   * one that throws work away, and it still asks in its own words.
   */
  async function bulkNone(scope = () => true, what = 'everything here') {
    const ids = [...skills.keys()].filter((id) => scope(id) && inRotation(stateOf(id)));
    if (!ids.length) { ctx.say(`None of ${what} is in mixed practice.`); return; }
    if (!confirm(`Take ${ids.length} of ${what} out of mixed practice? ${ids.length === 1 ? 'It stops' : 'They stop'} coming round on their own. Nothing is lost — the history and the spacing stay, and adding ${ids.length === 1 ? 'it' : 'them'} back picks up where ${ids.length === 1 ? 'it' : 'they'} left off.`)) return;
    for (const id of ids) await gstore.setState(removeFromPractice(gstore.getState(id) ?? id));
    ctx.say(`${ids.length} taken out of mixed practice.`); repaint();
  }
  async function bulkNew() {
    const ids = [...skills.keys()].filter((id) => stateOf(id).state === 'new' && drillable(id) && !skills.get(id).rev && skills.get(id).set !== 'pensum');
    if (!ids.length) { ctx.say('No skill is still new.'); return; }
    if (!confirm(`Start all ${ids.length} new skills through Learn, one after another, in book order?`)) return;
    writeJSON(LS_QUEUE, ids.slice(1));   // the run survives a detour, a reload or Back (G1-11)
    render('learn', { skill: ids[0], queue: ids.slice(1) });
  }
  /**
   * Where the learner is in each skill: `{ <skill id>: { done: [<step index>…] | seen, at } }`.
   * `normaliseLearn` (§22) holds the reading of it, including the two older
   * shapes — the section's one slot, and the position-per-skill this replaced.
   *
   * **The record is `skill_state.learn_place` now and this is its cache
   * (§25).** The view still reads the cache, because a paint must not wait on
   * a network and must work with none; the store mirrors the merged truth
   * into it after every change, from whichever device. Writes go the other
   * way — the cache first, so the next paint is right this instant, then the
   * store, which unions, persists and queues the push.
   */
  // Memoised on the stored string itself, so any write anywhere — here, the store's mirror, a reset,
  // another tab — is its own invalidation. It became worth having when the map's progress meters started
  // asking 88 times a paint: 88 parses of the whole object become 88 `getItem`s and one parse.
  let learnMemo = { text: Symbol('unread'), value: {} };
  function learnAll() {
    let text = null;
    try { text = localStorage.getItem(LS_LEARN); } catch { /* private mode */ }
    if (text === learnMemo.text) return learnMemo.value;
    let raw = null;
    try { raw = text ? JSON.parse(text) : null; } catch { raw = null; }
    learnMemo = { text, value: normaliseLearn(raw) };
    return learnMemo.value;
  }
  const learnPlace = (id) => learnAll()[id] ?? null;
  function setLearnPlace(id, place) {
    const all = learnAll();
    if (place) all[id] = { ...place, at: Date.now() };
    else delete all[id];
    writeJSON(LS_LEARN, Object.keys(all).length ? all : null);
    // …and up. `null` is the deliberate erase (a Learn pass finished, a skill reset); anything else is
    // **added** to what is already recorded, here and on every other device, so a step cannot come off.
    gstore.setLearnPlace?.(id, place ? all[id] : null)?.catch?.((e) => console.warn('[grammar] learn place not synced', e?.message || e));
  }

  async function resetSkill(id) {
    if (!confirm(`Reset ${titleOf(id)}? Its progress, attempts and confusions are removed.`)) return;
    await gstore.resetSkill(id); items.pool.reset(id); setLearnPlace(id, null); ctx.say(`${titleOf(id)} reset.`); repaint();
  }
  async function resetAll() {
    if (!confirm('Reset every skill? All grammar progress, attempts and confusions are removed, including any session in progress. The reading progress and looked-up words are untouched.')) return;
    await gstore.resetAll();
    items.pool.reset();
    // Everything the reset used to leave behind: the saved practice session (resuming it re-created skill states from
    // the pre-reset queue), the "start all as new" run, a set's half-finished Learn pass, and today's dismissal (M4).
    writeJSON(LS_SESSION, null); writeJSON(LS_QUEUE, null); writeJSON(LS_LEARN, null);
    if (ctx.settings?.todayDismissed) await ctx.saveSetting?.({ todayDismissed: null });
    ctx.say('All grammar progress reset.');
    repaint();
  }

  /* ----------------------------------------------------------- lesson */
  /** The glossary entry a paradigm key names: a named table's headword (sum, is, ego …) or a word of the class (decl3, conj3 …), the skill's own sentences first. */
  function entryForKey(key, skill) {
    if (!key) return null;
    const named = index.paradigmKeys?.[key];
    if (named && !KEY_CLASS[key]) {
      const es = dict.lookup(key).entries.filter((e) => e.h === key && ['V', 'PRON', 'NUM', 'N'].includes(e.pos));
      return es.find((e) => (key === 'domus' ? e.cat?.[0] === 4 : true)) ?? es[0] ?? null;
    }
    const cls = KEY_CLASS[key];
    if (!cls) return null;
    const own = items.candidates(skill.id).find((c) => entryOfClass(c.entry, cls))?.entry;
    if (own) return own;
    for (const w of KEY_MODELS[key] || []) { const e = dict.lookup(w).entries.find((x) => x.h === w && entryOfClass(x, cls)); if (e) return e; }
    return null;
  }
  function paradigmFor(skill, block) {
    // The lesson names a table key (decl2m, conj3, sum …): the skill map's paradigm_keys says which table it is (G1-01).
    const filter = block?.highlight ?? skill.paradigm_focus ?? (Array.isArray(skill.parse_filter) ? null : skill.parse_filter);
    const want = block?.key ?? skill.paradigms?.[0] ?? '';
    let entry = entryForKey(want, skill);
    if (!entry) {
      const c = items.candidates(skill.id)[0] ?? null;
      if (want) console.warn(`[grammar] paradigm key "${want}" (${skill.id}): no entry of that class; ${c ? `showing ${c.entry.lemma}` : 'no table'}`);
      entry = c?.entry ?? null;
    }
    if (!entry) return null;
    const hits = highlightParses(filter);
    try { return par.paradigm(entry, hits); } catch { return null; }
  }
  function lessonBlocks(skill, lesson, { learn = false } = {}) {
    const out = [];
    for (const b of lesson?.core ?? []) {
      if (b.type === 'p') out.push(h('p', { class: 'g-lesson__p' }, prose(b.text)));
      else if (b.type === 'english') out.push(h('p', { class: 'g-lesson__english' }, h('span', { class: 'g-lesson__tag', text: 'In English' }), ' ', prose(b.text)));
      else if (b.type === 'rule') out.push(h('p', { class: 'g-lesson__rule', 'data-rule': '' }, prose(b.text)));
      else if (b.type === 'paradigm') { const t = paradigmFor(skill, b); const node = t && renderParadigm(t, { english: true, practise: true, countKey: tableKey(t.entry), chapter: () => ctx.currentChapter?.() ?? null }); if (node) { node.open = true; out.push(h('div', { class: 'g-lesson__pt' }, node)); } }
      else if (b.type === 'examples') out.push(examplesBlock(skill, b));
      else if (b.type === 'confusion') out.push(h('div', { class: 'g-lesson__conf', 'data-conf': '' }, h('p', { class: 'g-lesson__tag', text: `Not to be confused with ${titleOf(b.with)}` }), h('p', {}, prose(b.text))));
    }
    if (lesson?.more?.length) out.push(h('details', { class: 'g-more' }, h('summary', { class: 'g-more__s', text: 'More' }), lesson.more.map((b) => h('p', { class: 'g-lesson__p' }, prose(b.text)))));
    if (lesson?.sources?.length) out.push(h('p', { class: 'g-sources', text: `Sources: ${lesson.sources.join(' · ')}` }));
    if (!lesson) out.push(h('p', { class: 'g-lesson__p g-quiet', text: 'This lesson has not been written yet. The summary above and the examples below still stand.' }), examplesBlock(skill, { units: [], invented: [] }, { fallback: 3 }));
    return out;
  }
  /** "Week 3 · Fabulae Syrae 1: Mīnōs", or a shelf's own name: "Familia Romana cap. VII", "Colloquia Personarum VII". */
  function unitRefText(u) {
    const m = /^([wrc])(\d+):/.exec(String(u.id ?? ''));
    const part = u.part ? ` · ${u.part}` : '';
    if (m && m[1] === 'r') return `Familia Romana cap. ${roman(Number(m[2]))}${part}`;
    if (m && m[1] === 'c') return `Colloquia Personarum ${roman(Number(m[2]))}${part}`;
    const n = u.week_n ?? (m ? Number(m[2]) : null);
    return `${n != null ? `Week ${n}` : 'Library'}${part}`;
  }
  /** The lesson's example units in the library, plus substitutes from the skill's own pool when some are missing (short, a noun target for a case skill), each marked. */
  function exampleUnits(skill, ids, want, { maxLen = 140 } = {}) {
    const own = ids.map(unitOf).filter(Boolean).map((u) => ({ unit: u, own: true }));
    const missing = ids.filter((id) => !unitOf(id));
    if (missing.length) console.warn(`[grammar] lesson ${skill.id}: example units not in the library: ${missing.join(', ')}`);
    if (own.length >= want) return own.slice(0, Math.max(want, own.length));
    const seen = new Set(own.map((x) => x.unit.id));
    const pool = items.candidates(skill.id).filter((c) => !c.ambiguous && c.unit.la.length < maxLen && !seen.has(c.unit.id));
    const nounFirst = skill.parse_filter?.case ? [...pool.filter((c) => c.entry.pos === 'N'), ...pool.filter((c) => c.entry.pos !== 'N')] : pool;
    const extra = [];
    for (const c of nounFirst) { if (extra.length >= want - own.length) break; if (seen.has(c.unit.id)) continue; seen.add(c.unit.id); extra.push({ unit: c.unit, own: false }); }
    return [...own, ...extra];
  }
  // The word lit in an example: an unambiguous noun before an agreeing adjective (mulierī, not miserae), else the first clear reading.
  const focusOf = (u, skill) => { const cs = items.scan(u, skill); return cs.find((c) => !c.ambiguous && c.entry.pos === 'N') ?? cs.find((c) => !c.ambiguous) ?? cs[0] ?? null; };
  function examplesBlock(skill, b, { fallback = 0 } = {}) {
    const list = h('ul', { class: 'g-ex' });
    const ids = b.units || [];
    const want = Math.max(fallback, ids.length ? Math.min(3, ids.length) : 0);
    const units = exampleUnits(skill, ids, want);
    for (const { unit: u, own } of units) {
      const focus = focusOf(u, skill);
      // A substitute drawn from the library is marked as such: book examples first, invented ones marked, substitutes never passed off as the lesson's (G1-13).
      list.append(h('li', { class: 'g-ex__item' }, latin(u.la, { target: focus?.index ?? null }), u.en ? h('p', { class: 'g-ex__en', text: u.en }) : null, h('p', { class: 'g-ex__ref', text: `${own ? '' : 'From the library · '}${unitRefText(u)}` })));
    }
    for (const ex of b.invented || []) {
      const ti = ex.focus ? phraseIndexes(ex.la, ex.focus) : [];
      list.append(h('li', { class: 'g-ex__item g-ex__item--inv' }, latin(ex.la, { target: ti.length ? ti : null }), ex.en ? h('p', { class: 'g-ex__en', text: ex.en }) : null, h('p', { class: 'g-ex__ref', text: 'Invented example' })));
    }
    if (!list.children.length) return null;
    const anyOwn = units.some((x) => x.own);
    return h('div', { class: 'g-lesson__ex' }, h('p', { class: 'g-lesson__tag', text: anyOwn ? 'From the book' : (units.length ? 'From the library' : 'Examples') }), list);
  }
  async function renderLessonView({ skill: id, from = null, play = false }) {
    const skill = skills.get(id);
    if (!skill) return renderToday();
    if (!skill.set) return renderSkillPage({ skill: id, from, play });
    const st = stateOf(id);
    setBody(h('p', { class: 'g-loading', text: 'Loading the lesson…' }));
    const lesson = await lessonOf(id);
    const acts = [];
    if (st.state === 'new' || st.state === 'lapsed') acts.push(btn(st.state === 'lapsed' ? 'Re-learn this skill' : 'Start learning', { to: ['learn', { skill: id, from }], onclick: () => render('learn', { skill: id, from }) }, 'btn btn--primary'));
    if (st.state === 'learning') acts.push(btn('Continue learning', { to: ['learn', { skill: id, from }], onclick: () => render('learn', { skill: id, from }) }, 'btn btn--primary'));
    // The whole lesson as a game (2026-10-23: "the whole lesson progression should be in the game mode, all six parts").
    if (st.state === 'new' || st.state === 'lapsed' || st.state === 'learning') acts.push(learnGameButton(id, { from }));
    if (st.state === 'new') acts.push(btn('Add to mixed practice', { onclick: async () => { await addSkill(id); render('lesson', { skill: id, from }); } }, 'btn'));
    if (inRotation(st)) acts.push(btn('Practise this skill', { onclick: () => startBlocked(id, from) }, 'btn btn--primary'));
    // Two taps to a drill (§10): the row opened this; one more starts ten items on the skill alone.
    if (!skill.set && (drillable(id) || skill.paradigms?.length)) acts.push(playButton(id, { from }));
    if (!skill.set && drillable(id)) acts.push(btn('Just drill it', { to: ['drill', { skill: id, from }], onclick: () => render('drill', { skill: id, from }), 'aria-label': `Just drill ${skill.title}: ten items, the rule pinned above each` }, st.state === 'new' ? 'btn' : 'btn btn--quiet'));
    // Unlimited practice and a mixed set (§11, §12): one more tap, on a skill with a generated bank. The manifest is
    // awaited here (the page is async anyway), so the first lesson opened after a cold start offers them too.
    if (!skill.set && drillable(id) && await hasBankAsync(id)) acts.push(...practiceButtons(skill, (name, params) => render(name, { ...params, from })));
    if (!skill.set && skill.paradigms?.length) acts.push(btn('Its tables', { to: ['catalogue', { table: skill.paradigms[0], from }], onclick: () => render('catalogue', { table: skill.paradigms[0], from }) }, 'btn btn--quiet'));
    // Printable charts (GRAMMAR-CONTRACT.md, wave 3): the chart alone, one table a page with the focus cells boxed,
    // or the whole sheet — rule, forms and examples. Offered only where there is something to put on the paper.
    if (!skill.set && chartTable(skill)) acts.push(btn('Print chart', { onclick: () => printChart(skill) }, 'btn btn--quiet'));
    if (!skill.set) acts.push(btn('Print sheet', { onclick: () => printSheet(skill) }, 'btn btn--quiet'));
    if (gstore.countAttempts(id)) acts.push(btn('History', { to: ['history', { skill: id, from }], onclick: () => render('history', { skill: id, from }) }, 'btn btn--quiet'));
    // At the top (2026-10-23): its part of the table, and "Too hard? Too easy?" — the skills either side on the path.
    const top = [tablePartButton(id, { chapter: skill.chapter }), skill.set ? null : levelButton(id)].filter(Boolean);
    setBody(
      backButton(from),
      lessonHeader(skill, st),
      skill.set ? null : areaNav(id),
      top.length ? h('div', { class: 'g-acts g-acts--top' }, top) : null,
      prereqNode(skill, unmetPrereqs(skill, stateOf), { canDismiss: false }),
      h('article', { class: 'g-lesson' }, lessonBlocks(skill, lesson)),
      skill.set ? null : partsNode(id, stepsOf(lesson), { heading: 'Practise one part of the lesson' }),
      h('div', { class: 'g-acts' }, acts));
    // Opened to play (the next skill, when the learner's way in is its table game): the game over this lesson.
    if (play && skill.paradigms?.length && !skill.set && view.name === 'lesson') playSkillTables(id, { chapter: skill.chapter });
  }
  /**
   * **The skill page** (docs/SIMPLIFY-PLAN.md §3.4): one page per skill, the main button at the top (and fixed at the
   * bottom on a phone), the other ways in as small links beside it, then its parts, its tables (and Across the
   * conjugations), its related skills with ▶ Mix them, the lesson itself, What next, and the rare actions under More.
   * Every start follows the one Lesson / Game switch and comes back here.
   */
  const startSkill = (id, verb, params = {}) => {
    const sk = skills.get(id);
    if (!sk) return;
    const here = view.name === 'lesson' ? { view: 'lesson', params: { skill: id }, label: sk.title } : null;
    const from = params.from ?? here ?? (MENUS.has(view.name) ? hereFrom(id) : null);
    if (verb === 'learn' || verb === 'continue' || verb === 'relearn') { keepEntry('learn'); goView('learn', { skill: id, ...(from ? { from } : {}) }); return; }
    if (verb === 'review') { goView('blocked', { skill: id, ...(from ? { from } : {}) }); return; }
    if (verb === 'practise') { keepEntry('drill'); goView('drill', { skill: id, ...(from ? { from } : {}) }); return; }
    if (verb === 'more') { keepEntry('unlimited'); goView('unlimited', { skill: id, ...(from ? { from } : {}) }); return; }
    if (verb === 'mix') { goView(mixedMembers(sk, skills, { chapter: ctx.currentChapter?.() ?? null, drillable }).length > 1 ? 'mixed' : 'drill', { skill: id, ...(from ? { from } : {}) }); return; }
    if (verb === 'part') { keepEntry('part'); goView('part', { skill: id, step: Number(params.step) || 0, ...(from ? { from } : {}) }); return; }
    if (verb === 'across') {
      if (gameKept()) { playSkillTables(id, { chapter: sk.chapter }); return; }
      goView('wwtable', { chapter: sk.chapter, skill: id }); return;
    }
    if (verb === 'read' || verb === 'lesson') goView('lesson', { skill: id, ...(from ? { from } : {}) });
  };
  /** The main button: the verb the skill's state calls for (actions.js), in the look the switch says. */
  const mainButton = (id, { cls = 'btn btn--primary g-mainbtn', from = null } = {}) => {
    const sk = skills.get(id);
    if (!sk) return null;
    const a = mainAction(stateOf(id), { drillable: drillable(id), set: !!sk.set });
    const game = gameKept() && a.verb !== 'read';
    return btn(game ? playLabel(a.label) : a.label, { to: [a.view, { skill: id }], onclick: () => (a.verb === 'read' && view.name === 'lesson' && view.params?.skill === id ? body.querySelector('.g-lesson')?.scrollIntoView({ block: 'start' }) : startSkill(id, a.verb, from ? { from } : {})), 'aria-label': `${a.label}: ${sk.title}` }, cls);
  };
  /** The other ways in, as small links: Learn · Practise · Mix · Across … (the main button's own verb left out). */
  const verbLinks = (id, { main = null, level = true } = {}) => {
    const sk = skills.get(id);
    if (!sk || sk.set) return null;
    const a = main ?? mainAction(stateOf(id), { drillable: drillable(id) });
    const link = (text, verb, extra = {}) => h('button', { type: 'button', class: 'g-vlink', onclick: () => startSkill(id, verb, extra) }, text);
    const items = [];
    if (!['learn', 'continue', 'relearn'].includes(a.verb)) items.push(link('Learn', 'learn'));
    if (drillable(id) && a.verb !== 'practise') items.push(link('Practise', 'practise'));
    if (drillable(id)) items.push(link('Mix', 'mix'));
    const lv = level ? levelButton(id, 'g-vlink g-levelbtn') : null;
    if (lv) items.push(lv);
    return items.length ? h('p', { class: 'g-vlinks' }, items.map((x, i) => [i ? h('span', { class: 'g-vlinks__sep', 'aria-hidden': 'true', text: ' · ' }) : null, x])) : null;
  };
  /** Its parts, numbered, each opening that part on its own. */
  const partLinks = (id, steps) => (steps.length ? h('p', { class: 'g-plinks' }, h('span', { class: 'g-plinks__k', text: 'Parts ' }),
    steps.map((st, i) => [i ? ' ' : null, navEl({ class: 'g-plink', to: ['part', { skill: id, step: i }], onclick: () => startSkill(id, 'part', { step: i }), title: stepTitle(st, i), 'aria-label': `Part ${i + 1}: ${stepTitle(st, i)}` },
      h('b', { text: String(i + 1) }), h('span', { class: 'g-plink__t', text: ` ${stepTitle(st, i)}` }), countBadge(`part:${id}:${i}`))])) : null);
  /** Related: what Mix draws on — what it builds on, its look-alikes — each a link, and ▶ Mix them. */
  const relatedNode = (id) => {
    const sk = skills.get(id);
    const members = drillable(id) ? mixedMembers(sk, skills, { chapter: ctx.currentChapter?.() ?? null, drillable }).filter((m) => m.id !== id) : [];
    const ids = members.length ? members.map((m) => m.id) : [...new Set([...(sk.prereqs ?? []), ...(sk.confusable_with ?? [])])].filter((x) => skills.has(x)).slice(0, 4);
    if (!ids.length) return null;
    const conf = new Set(sk.confusable_with ?? []);
    return h('p', { class: 'g-related' }, h('span', { class: 'g-plinks__k', text: 'Related ' }),
      ids.map((x, i) => [i ? ' · ' : null, h('span', { class: 'g-related__why', text: conf.has(x) ? 'looks like ' : 'builds on ' }), capTag(x), ' ', navEl({ class: 'g-link', to: ['lesson', { skill: x }], onclick: () => goView('lesson', { skill: x }), 'data-area': areaOf(x) }, titleOf(x))]),
      members.length ? [' ', h('button', { type: 'button', class: 'btn btn--quiet g-play g-related__mix', onclick: () => startSkill(id, 'mix') }, playLabel('Mix them'))] : null);
  };
  async function renderSkillPage({ skill: id, from = null, play = false }) {
    const skill = skills.get(id);
    const st = stateOf(id);
    setBody(h('p', { class: 'g-loading', text: 'Loading the lesson…' }));
    const lesson = await lessonOf(id);
    if (view.name !== 'lesson' || view.params?.skill !== id) return;
    const steps = stepsOf(lesson);
    const a = mainAction(st, { drillable: drillable(id) });
    const more = h('details', { class: 'g-more' }, h('summary', { text: 'More' }),
      h('div', { class: 'g-acts' },
        drillable(id) && await hasBankAsync(id) ? btn('Ten more, and more (unlimited)', { onclick: () => startSkill(id, 'more') }, 'btn btn--quiet') : null,
        st.state === 'new' ? btn('Add to review without the lesson', { onclick: async () => { await addSkill(id); render('lesson', { skill: id, from }); } }, 'btn btn--quiet') : null,
        inRotation(st) ? btn('Start again as new', { onclick: () => startSkill(id, 'learn') }, 'btn btn--quiet') : null,
        gstore.countAttempts(id) ? btn('History', { to: ['history', { skill: id, from }], onclick: () => render('history', { skill: id, from }) }, 'btn btn--quiet') : null,
        chartTable(skill) ? btn('Print chart', { onclick: () => printChart(skill) }, 'btn btn--quiet') : null,
        btn('Print sheet', { onclick: () => printSheet(skill) }, 'btn btn--quiet'),
        st.state !== 'new' ? btn('Reset…', { onclick: () => resetSkill(id) }, 'btn btn--quiet g-skill__reset') : null));
    const bar = h('div', { class: 'g-skillbar' }, mainButton(id, { from }), verbLinks(id, { main: a }));
    setBody(
      backButton(from),
      h('header', { class: 'g-head g-skillhead', 'data-area': areaOf(id) },
        h('p', { class: 'g-kicker' }, areaTag(id), `Cap. ${roman(skill.chapter)} · ${skill.course} week ${skill.week ?? '—'}`),
        h('h1', { class: 'g-title', text: skill.title }),
        h('p', { class: 'g-lede' }, skill.plain, skill.latin_label ? [' · ', h('i', { lang: 'la', text: skill.latin_label })] : null),
        h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': st.state, 'aria-hidden': 'true' }),
          stateTipButton(skill.title, st, { shown: dueText(st) }), countBadge(`skill:${skill.id}`), ' ', partsMeter(skill.title, progressOf(skill, !!ctx.items)))),
      areaNav(id),
      bar,
      partLinks(id, steps),
      tableLinks(id),
      relatedNode(id),
      prereqNode(skill, unmetPrereqs(skill, stateOf), { canDismiss: false }),
      h('section', { class: 'g-skillesson', 'aria-label': 'The lesson' },
        h('h2', { class: 'g-h2', text: 'The lesson' }),
        h('p', { class: 'g-summary', text: skill.summary }),
        appliesNode(skill),
        howNode(skill, { open: false }),
        h('article', { class: 'g-lesson' }, lessonBlocks(skill, lesson))),
      suggestNode(id),
      more);
    // On a phone the main button stays in reach while the lesson is read: a bar fixed at the bottom of the screen,
    // shown once the page's own button has scrolled away.
    const fab = h('div', { class: 'g-skillfab', hidden: true }, mainButton(id, { from, cls: 'btn btn--primary g-mainbtn' }), h('button', { type: 'button', class: 'g-vlink', onclick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) }, '↑ Parts, tables, related'));
    body.append(fab);
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver(([en]) => { if (!fab.isConnected) { io.disconnect(); return; } fab.hidden = en.isIntersecting || en.boundingClientRect.top > 0; });
      io.observe(bar);
    }
    if (play && skill.paradigms?.length && view.name === 'lesson') playSkillTables(id, { chapter: skill.chapter });
  }
  const lessonHeader = (skill, st) => h('header', { class: 'g-head' },
    h('p', { class: 'g-kicker', text: `Cap. ${roman(skill.chapter)} · ${skill.course} week ${skill.week ?? '—'} · ${cap(skill.category.replace('-', ' '))}` }),
    h('h1', { class: 'g-title', text: skill.title }),
    h('p', { class: 'g-lede' }, skill.plain, skill.latin_label ? [' · ', h('i', { lang: 'la', text: skill.latin_label })] : null),
    h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': st.state, 'aria-hidden': 'true' }),
      stateTipButton(skill.title, st, { shown: dueText(st) }), countBadge(`skill:${skill.id}`)),
    h('p', { class: 'g-summary', text: skill.summary }),
    skill.set ? null : appliesNode(skill),
    skill.set ? null : howNode(skill, { open: false }));

  /* ------------------------------------------------------------ learn */
  /**
   * The teaching material behind a skill's Learn (GRAMMAR-CONTRACT.md §1, §4a,
   * §4b): its written sentences, the paradigm catalogue and the headword
   * index, as one generator whose whole world is the written set — so a step's
   * check cannot come from the library. null when the skill has no written
   * sentences yet; Learn then goes straight to the ten.
   */
  const teachCache = new Map();
  function teachItemsOf(skill) {
    if (!teachCache.has(skill.id)) {
      teachCache.set(skill.id, (async () => {
        const [sents, catalogue, headwords] = await Promise.all([loadSentences(skill.id), loadParadigmCatalogue(), loadHeadwords()]);
        if (!sents?.sentences?.length) return null;
        return createTeachItems({ skill, sentences: sents.sentences, lookup: dict.lookup, paradigm: par.paradigm, catalogue, skills, headwords, storage: localStorage });
      })().catch((e) => { console.warn(`[grammar] the teaching material for ${skill.id} could not be built`, e?.message || e); return null; }));
    }
    return teachCache.get(skill.id);
  }
  /**
   * The skill's generated bank (§11b) as the same kind of generator, over its
   * own pool memory: the bank's sentences are shaped like the written ones, so
   * every item kind, hint and per-box judgement applies to them unchanged.
   * null when the skill has no bank.
   */
  const genCache = new Map();
  function generatedItemsOf(skill) {
    if (!genCache.has(skill.id)) {
      genCache.set(skill.id, (async () => {
        const [bank, catalogue, headwords] = await Promise.all([loadGenerated(skill.id), loadParadigmCatalogue(), loadHeadwords()]);
        if (!bank?.sentences?.length) return null;
        return createTeachItems({ skill, sentences: bank.sentences, lookup: dict.lookup, paradigm: par.paradigm, catalogue, skills, headwords, storage: localStorage, poolKey: `l103.grammar.generated.${skill.id}` });
      })().catch((e) => { console.warn(`[grammar] the generated bank for ${skill.id} could not be built`, e?.message || e); return null; }));
    }
    return genCache.get(skill.id);
  }
  // Which skills have a bank (`generated/index.json`): read once, and the rows repainted when it arrives, so
  // "Unlimited practice" and "Mixed set" appear on exactly the skills that can supply them.
  let bankIds = null;
  const bankIdsP = generatedSkillIds().then((ids) => { bankIds = ids ?? new Set(); return bankIds; }).catch(() => (bankIds = new Set()));
  bankIdsP.then(() => repaint());
  const hasBank = (id) => !!bankIds?.has(id);
  const hasBankAsync = async (id) => (await bankIdsP).has(id);
  /** The two buttons of §11 and §12, one tap each: unlimited practice on the skill, and a mixed set with its confusables. */
  const practiceButtons = (skill, nav) => [
    btn('Unlimited practice', { to: ['unlimited', { skill: skill.id }], onclick: () => nav('unlimited', { skill: skill.id }), 'aria-label': `Unlimited practice of ${skill.title}: its own sentences, then generated ones, ten at a time for as long as you like` }, 'btn btn--quiet'),
    mixedMembers(skill, skills, { chapter: ctx.currentChapter?.() ?? null, drillable }).length > 1
      ? btn('Mixed set', { to: ['mixed', { skill: skill.id }], onclick: () => nav('mixed', { skill: skill.id }), 'aria-label': `A mixed set: ${skill.title} interleaved with the skills it is confused with and builds on` }, 'btn btn--quiet')
      : null,
  ].filter(Boolean);

  /** The gloss of a written sentence, word by word, under the sentence. */
  const glossLine = (written) => (written?.gloss?.length
    ? h('ul', { class: 'g-wgloss', 'aria-label': 'Word by word' }, written.gloss.map((g) => h('li', {}, h('span', { lang: 'la', class: 'g-wgloss__la', text: g.w }), ' ', h('span', { class: 'g-wgloss__en', text: g.m }))))
    : null);
  /** A written sentence as the step shows it: the Latin with its focus lit, its English, its gloss. */
  function writtenNode(written, { focus = null, tag = null } = {}) {
    if (!written) return null;
    return h('div', { class: 'g-show' },
      tag ? h('p', { class: 'g-lesson__tag', text: tag }) : null,
      latin(written.la, { target: focus }),
      written.en ? h('p', { class: 'g-ex__en', text: written.en }) : null,
      glossLine(written));
  }
  /**
   * The one or two cells a step reveals, on the table's stock words — never
   * the whole table (§2, §7.3): one row per cell, one column per word, the
   * ending set apart from the stem.
   */
  function revealNode(teachItems, show) {
    const r = teachItems?.revealed?.(show.key, show.reveal) ?? null;
    if (!r?.rows?.length) return null;
    const words = [...new Set(r.rows.flatMap((row) => row.cols.map((c) => c.word)))];
    const endings = [...new Set(r.rows.flatMap((row) => row.cols.map((c) => c.ending).filter(Boolean)))];
    const table = h('table', { class: 'pt g-reveal__t' },
      h('caption', { class: 'visually-hidden', text: `${r.table?.label ?? show.key}: ${r.rows.map((row) => row.label).join(', ')} on ${words.join(', ')}` }),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'pt__corner', 'aria-label': 'form' }), words.map((w) => h('th', { scope: 'col', lang: 'la', text: w })))),
      h('tbody', {}, r.rows.map((row) => h('tr', {}, h('th', { scope: 'row', text: row.label }), words.map((w) => {
        const c = row.cols.find((x) => x.word === w);
        if (!c) return h('td', { class: 'pt__cell is-empty', lang: 'la', text: '—' });
        return h('td', { class: 'pt__cell', lang: 'la' }, c.ending != null && (c.stem || c.ending) ? [c.stem ? h('span', { class: 'pt__stem', text: c.stem }) : null, h('span', { class: 'pt__ending g-reveal__end', text: c.ending })] : c.form);
      })))));
    const scroll = h('div', { class: 'pt__scroll' }, table);
    fitParadigm(scroll, table);      // §26: one block per stock word when the reveal does not fit its box
    return h('div', { class: 'g-show g-show--cells' },
      h('p', { class: 'g-lesson__tag', text: `${r.table?.label ?? show.key} · ${r.rows.map((row) => row.label).join(' and ')}` }),
      scroll,
      endings.length ? h('p', { class: 'g-reveal__note' }, 'The ending: ', endings.map((e, i) => [i ? ' and ' : null, h('b', { lang: 'la', text: `-${e}` })])) : null);
  }

  /**
   * A worked example, completed (§8, decision 2). The first of a skill is
   * shown fully parsed; every later one prints its `given` features and asks
   * the rest one at a time — a small choice over that feature's own values,
   * then the one-line reason, judged generously and never counted. `onDone`
   * fires when the learner has finished it (at once when there is nothing to
   * ask), and the step's check follows.
   */
  function workedNode(plan, { first = false, onDone = null } = {}) {
    if (!plan) return null;
    const node = h('div', { class: 'g-worked' },
      h('p', { class: 'g-lesson__tag', text: first ? 'Worked example' : 'Your turn: finish the example' }),
      latin(plan.sentence.la, { target: plan.index }),
      plan.sentence.en ? h('p', { class: 'g-ex__en', text: plan.sentence.en }) : null,
      glossLine(plan.sentence));
    const dl = h('dl', { class: 'g-worked__dl' });
    node.append(dl);
    const row = (label, value, plain = '', ok = null) => dl.append(h('div', { class: `g-worked__row${ok == null ? '' : ok ? ' is-right' : ' is-wrong'}` }, h('dt', { text: label }), h('dd', {}, h('b', { text: value }), plain ? h('span', { class: 'g-worked__plain', text: ` — ${plain}` }) : null)));
    for (const g of plan.given) row(g.label, g.name, g.plain);
    const asks = [...plan.asks];
    const live = h('div', { class: 'g-worked__ask' });
    node.append(live);
    let done = false;
    const finish = () => { if (done) return; done = true; live.replaceChildren(); node.classList.add('is-done'); onDone?.(); };
    const askWhy = () => {
      const ta = h('textarea', { class: 'g-input g-textarea g-worked__why', rows: '2', lang: 'en', 'aria-label': `Why is ${plan.word} ${[...plan.given, ...plan.asks].map((f) => f.name).join(' ')}?`, placeholder: 'One line: what in the sentence tells you?' });
      const go = btn('Done', {}, 'btn btn--primary'); go.type = 'submit';
      const form = h('form', { class: 'g-worked__form', onsubmit: (e) => {
        e.preventDefault();
        const v = judgeWhy(ta.value);
        ta.readOnly = true; go.disabled = true;
        // Generous, and never counted: a reason is a thought, not a form. The model answer stands beside it either way.
        row('why', v.empty ? '—' : v.given, '', v.empty ? null : true);
        form.replaceWith(h('div', { class: 'g-worked__reason' }, h('p', { class: 'g-lesson__tag', text: v.empty ? 'One reason' : 'And in the book\'s words' }), h('p', { class: 'g-worked__reasontext' }, prose(plan.reason)), btn('Now check it', { onclick: finish }, 'btn btn--primary g-worked__go')));
        form.parentNode?.querySelector('.g-worked__go')?.focus({ preventScroll: true });
      } }, h('p', { class: 'g-q g-worked__q', text: `Why? What in the sentence tells you?` }), ta, h('div', { class: 'g-chart__acts' }, go));
      live.replaceChildren(form);
      setTimeout(() => ta.focus({ preventScroll: true }), 0);
    };
    const askNext = () => {
      const a = asks.shift();
      if (!a) { if (plan.why) askWhy(); else finish(); return; }
      let picked = false;
      const group = h('div', { class: 'g-choices g-choices--worked', role: 'group', 'aria-label': `The ${a.label} of ${plan.word}` }, a.choices.map((c, i) => btn([h('span', { class: 'g-choice__n', 'aria-hidden': 'true', text: `${i + 1}` }), h('span', { class: 'g-choice__label', text: c.label }), c.plain ? h('span', { class: 'g-choice__plain', text: c.plain }) : null], { 'data-value': c.value, onclick: (e) => {
        if (picked) return; picked = true;
        e.currentTarget.classList.add('is-picked');
        for (const b of group.children) { b.disabled = true; b.classList.toggle('is-answer', a.choices[[...group.children].indexOf(b)]?.correct === true); }
        row(a.label, a.name, a.plain, !!c.correct);
        ctx.say(c.correct ? `${a.label}: ${a.name}. Right.` : `${a.label}: ${a.name}, not ${c.label}.`);
        // Nothing moves on by itself. This used to jump after half a second when right, which is not
        // long enough to read the answer it just put on the row beside the question.
        const on = btn(asks.length || plan.why ? 'Next' : 'Now check it', { onclick: askNext }, 'btn btn--primary g-worked__go');
        group.after(on);
        on.focus({ preventScroll: true });
      } }, 'g-choice')));
      // The word being worked through is Latin; the question round it is not. Marked apart, so the
      // pointer opens the dictionary on the word and the question reads as English to a screen reader.
      const q = h('p', { class: 'g-q g-worked__q', tabindex: '-1' }, ...(a.key === 'construction'
        ? ['What is ', h('span', { lang: 'la', text: plan.word }), ' doing here?']
        : [`Which ${a.label} is `, h('span', { lang: 'la', text: plan.word }), '?']));
      live.replaceChildren(q, group, keyHelp('Keys 1–4 choose an answer; Enter goes on.'));
      live.onkeydown = (e) => { const n = Number(e.key); if (n >= 1 && n <= a.choices.length && !picked) { e.preventDefault(); group.children[n - 1].click(); } };
      q.focus({ preventScroll: true });
    };
    if (!asks.length && !plan.why) { done = true; node.classList.add('is-done'); }
    else setTimeout(askNext, 0);
    return { node, done: () => done };
  }

  /**
   * The noticing opener (§10, amended): two of the skill's written sentences
   * side by side and one question, answered by tapping a word in either — the
   * sentences' own focus words are the answer — or by picking an option. A
   * right tap lights both focus words and says so; a wrong one says which word
   * to look at again and lets the learner try again; **Skip** goes straight to
   * the rule. Nothing here is logged. `onDone` fires once, however it ended.
   */
  function noticeNode(notice, teachItems, { onDone = null } = {}) {
    if (!notice || !teachItems) return null;
    const pair = notice.sentences.map((id) => teachItems.sentence(id)).filter(Boolean);
    if (pair.length < 2) return null;
    // Every index the focus covers: a two-word construction lights both, and a tap on either is right.
    const focusSpanOf = (w) => {
      const f = teachItems.focusOf(w.id); const idx = f?.candidate?.index;
      const span = w.focus ? focusIndexes(w.la, w.focus) : [];
      if (span.length > 1) return span;
      if (Number.isInteger(idx) && idx >= 0) return [idx];
      return span;
    };
    const focusOf = (w) => { const s = focusSpanOf(w); return s.length ? s[0] : -1; };
    let done = false;
    const line = h('p', { class: 'g-notice__line', role: 'status' });
    const node = h('section', { class: 'g-notice', 'aria-label': 'Look first' });
    const finish = ({ found = false } = {}) => {
      if (done) return; done = true;
      // Said in the DOM as well as in the closure: the pointer-dictionary reads this to know the words
      // have stopped being the answer (they may be hovered again).
      node.dataset.done = '1';
      node.classList.add('is-done');
      node.querySelectorAll('.g-notice__skip, .g-choices').forEach((el) => el.remove());
      if (!found) line.textContent = '';
      onDone?.();
    };
    const found = new Set();   // which of the two examples the learner has found for themselves
    const columns = pair.map((w, ci) => {
      const fi = focusSpanOf(w);
      const p = latin(w.la, { tap: notice.tap === 'focus' ? (i, el) => {
        if (done) { showGloss(el, el.dataset.form, el.textContent, w.la); return; }
        if (fi.includes(i)) {
          // **Only this sentence lights.** It used to light both and finish on the first tap, which
          // answered the second example for the learner: "I clicked on the first circled word which was
          // correct but it revealed both examples so I did not have a hcance to guess the second"
          // (2026-09-12). Two examples are two chances to notice; the shared pattern is the payoff for
          // having found both, not a reason to hand the second one over. A focus of two words (an
          // ablative absolute, *itūrum esse*) still lights both of its own words — that is one answer.
          node.querySelectorAll('.g-w.is-wrong').forEach((b) => b.classList.remove('is-wrong'));
          for (const idx of fi) p.querySelector(`.g-w[data-index="${idx}"]`)?.classList.add('g-w--target', 'is-right');
          found.add(ci);
          const named = pair.map((x, k) => (found.has(k) ? x.focus || '' : '')).filter(Boolean);
          if (found.size < pair.length) {
            // Say what they got and point at the one still to do, without naming it.
            line.textContent = `Yes — ${named.join(' and ')}. Now find it in the other sentence.`;
            ctx.say(line.textContent);
          } else {
            line.textContent = `Yes — ${pair.map((x) => x.focus || '').filter(Boolean).join(' and ')}. Here is why.`;
            ctx.say('Right. The rule follows.');
            finish({ found: true });
          }
        } else {
          el.classList.add('is-wrong');
          line.textContent = `Not ${el.textContent} — look at the word that answers the question in each sentence.`;
          ctx.say(line.textContent);
        }
      } : null, cls: notice.tap === 'focus' ? 'g-la--tap g-notice__la' : 'g-notice__la' });
      return h('div', { class: 'g-notice__col' }, p, w.en ? h('p', { class: 'g-ex__en', text: w.en }) : null);
    });
    node.append(h('p', { class: 'g-lesson__tag', text: 'Look first' }), h('div', { class: 'g-notice__pair' }, columns), h('p', { class: 'g-q g-notice__q', tabindex: '-1', text: notice.ask }));
    if (notice.tap !== 'focus' && notice.options.length) {
      node.append(h('div', { class: 'g-choices g-choices--worked', role: 'group', 'aria-label': 'Answers' }, notice.options.map((o, i) => btn([h('span', { class: 'g-choice__n', 'aria-hidden': 'true', text: `${i + 1}` }), h('span', { class: 'g-choice__label', text: o })], { onclick: (e) => { const ok = !notice.answer || o === notice.answer; e.currentTarget.classList.add(ok ? 'is-answer' : 'is-wrong'); line.textContent = ok ? 'Yes. Here is why.' : `Not quite — ${notice.answer ?? 'look again'}.`; finish({ found: true }); } }, 'g-choice'))));
    } else node.append(keyHelp('Tap the word in either sentence.', 'g-keys--tap'));
    node.append(line, h('div', { class: 'g-acts' }, btn('Skip to the rule', { onclick: () => finish() }, 'btn btn--quiet g-notice__skip')));
    return { node, done: () => done };
  }

  /**
   * Decision 4: a skill's unmet prerequisites are named and offered — on the
   * first step's page, above the step, so it is a line to read and a choice to
   * make rather than a screen to get past — and the learner may go on.
   */
  /**
   * The blue "This builds on" box of a lesson, from the path (continuum.js): what the skill builds on, nearest
   * first, and what it leads on to (2026-10-23: "make sure all the prerequisite links are up to date with our new
   * data about easier or harder skills … add the harder as well"). Each name opens its lesson in a new tab ("when
   * it's clicked have it open up in a new tab"), so this lesson stays where it is. A prerequisite not yet in the
   * practice is named as such, with "Learn it first" and "Go on"; the lesson can always go on (decision 4).
   */
  function prereqNode(skill, missing = [], { canDismiss = true } = {}) {
    if (!skill || skill.set) return null;
    const path = thePath();
    const before = (skill.prereqs ?? []).length ? path.easier(skill.id) : [];
    const after = path.harder(skill.id);
    if (!before.length && !after.length) return null;
    const unmet = new Set(missing);
    const newTab = (view, params, attrs, ...kids) => h('a', { href: grammarViewHash(view, params), target: '_blank', rel: 'noopener', ...attrs }, ...kids);
    const skillLink = (id) => newTab(...skillTo(id), { class: 'g-prereq__skill', title: `Open ${titleOf(id)} in a new tab` },
      h('b', { text: titleOf(id) }), h('span', { class: 'g-prereq__new', 'aria-hidden': 'true', text: ' ↗' }), h('span', { class: 'visually-hidden', text: ` (${unmet.has(id) ? 'not in your practice yet; ' : ''}opens in a new tab)` }),
      countBadge(`skill:${id}`));
    const listOf = (ids) => ids.flatMap((id, i) => (i === 0 ? [skillLink(id)] : i === ids.length - 1 ? [' and ', skillLink(id)] : [', ', skillLink(id)]));
    const waiting = before.filter((id) => unmet.has(id));
    const node = h('aside', { class: 'g-prereq', 'aria-label': 'Before and after this skill' },
      before.length ? h('p', { class: 'g-prereq__line' }, h('span', { 'aria-hidden': 'true', text: '😓 ' }), 'Builds on ', ...listOf(before),
        waiting.length ? `. ${waiting.length === before.length ? (waiting.length === 1 ? 'It is' : 'They are') : `${waiting.map(titleOf).join(', ')} ${waiting.length === 1 ? 'is' : 'are'}`} not in your practice yet — tap to learn it in a new tab (this lesson stays open here), or go on.` : '.') : null,
      after.length ? h('p', { class: 'g-prereq__line' }, h('span', { 'aria-hidden': 'true', text: '😎 ' }), 'Leads on to ', ...listOf(after), '.') : null,
      waiting.length && canDismiss ? h('div', { class: 'g-acts' },
        newTab(...skillTo(waiting[0]), { class: 'btn', 'aria-label': `Learn ${titleOf(waiting[0])} first, in a new tab` }, `Learn ${titleOf(waiting[0])} first`, h('span', { 'aria-hidden': 'true', text: ' ↗' })),
        btn('Go on', { onclick: () => { node.remove(); body.querySelector('.g-step__title')?.focus?.({ preventScroll: true }); } }, 'btn btn--quiet')) : null);
    return node;
  }

  async function renderLearnStart({ skill: id, queue = [], from = null }) {
    const skill = skills.get(id);
    if (!skill) return renderToday();
    if (!skill.set) keepEntry('learn');
    if (skill.set === 'pensum') { startBlocked(id, from); return; }   // pensa are practised, never learned in a sitting
    // Where the learner is, kept per skill. This used to be one slot for the whole section — `{ skill, step }` —
    // so opening any second lesson overwrote the first one's place and coming back to it started at step 1. It is
    // now a place for each skill, so "I left this one half way" survives going and doing something else.
    const savedLearn = learnPlace(id);
    const resume = skill.set && Number(savedLearn?.seen) > 0 ? { seen: Number(savedLearn.seen) } : null;
    // **A deck's count, and a deck's only.** `seen` is how far through a chapter set's cards the learner
    // is; for a skill with teach steps it is 0 at every report, so this line used to write `null` — the
    // whole place deleted — each time `startSteps` or `startBlocked` began. It looked harmless because
    // `onStep` wrote a position back a moment later, which is what made the bug invisible for as long as
    // the place *was* a position. A set of finished steps has nothing to rewrite: without this guard,
    // opening a lesson forgot which steps were done, and reaching the ten and reloading came back to step
    // one — M-2 exactly. Found on the live device pass, not by a test; there is one now.
    const onProgress = (pr) => { if (skill.set) setLearnPlace(pr.skill, pr.seen > 0 && pr.seen < pr.total ? { seen: pr.seen } : null); };
    /**
     * Which steps of this lesson are finished (§22.2) — a set, not a position,
     * so stepping back to re-read one does not unfinish the three after it.
     *
     * **A step is done when its check has been answered — right or wrong.**
     * Three things decide that threshold. §17.1: a form only being looked at
     * is not an answer, so scrolling past a step is not finishing it and the
     * check is the one thing the step asks the learner to *do*. §18: a mark
     * that comes off by itself is a nag and not a record, so once answered it
     * stays answered, and the row of pips is a place-keeper rather than a
     * score. And getting a check wrong is ordinary in learning — what comes
     * back because of it is the scheduler's business and the blocked ten's,
     * not this line's; a red pip would only punish the learner for the thing
     * the lesson exists to fix.
     */
    const doneSteps = new Set(stepsDone(savedLearn));
    const markSteps = (list) => {
      const { done } = withSteps({ done: [...doneSteps] }, list);
      if (done.length === doneSteps.size) return;               // every write is a localStorage write; only news is worth one
      for (const n of done) doneSteps.add(n);
      setLearnPlace(id, { ...(learnPlace(id) ?? {}), done });
    };
    /** The steps answered in a run that began at `from`, given the runner's own position report. */
    const answeredIn = (from, to) => { const out = []; for (let i = Math.max(0, from); i < to; i++) out.push(i); return out; };
    setBody(h('p', { class: 'g-loading', text: 'Preparing the lesson…' }));
    const lesson = skill.set ? null : await lessonOf(id);
    const teachItems = skill.set ? null : await teachItemsOf(skill);
    // The learner's own chapter is the ceiling on Learn's sentences too (GRAMMAR-CONTRACT.md §7.2).
    const learn = createLearn({ skill, gstore, items, teach: lesson?.teach ?? [], teachItems, currentWeekN: ctx.currentWeekN(), resume, onProgress });
    await learn.begin();
    const nSteps = learn.steps.length;
    /**
     * Where the sitting is: one mark per step and one for the ten. `at` is a
     * step index, or `nSteps` for the ten. A chapter set keeps its two marks,
     * plain text and no states — it has no teach steps to finish.
     *
     * **A finished step says so, and it is a way back** (§22.2). The pips used
     * to mark only `aria-current`, so a step behind the learner and one they
     * had never reached were drawn identically; the row said nothing about
     * what was done, which is what sent the learner into a lesson not knowing
     * where they were. A done step now fills green, keeps its number (§22.5)
     * and is a button that jumps to it — the deliberate "unless I purposely
     * want to retry". A step not yet answered is not a control: the runner has
     * never let anyone past
     * an unanswered check, and a pip that could would be a way round the
     * teaching rather than through it.
     */
    const stepper = (at) => {
      if (skill.set) {
        const marks = [skill.set === 'vocab' ? 'The deck, a batch at a time' : 'The passage\'s questions', 'Blocked 10'];
        return h('ol', { class: 'g-steps', 'aria-label': 'Learn steps' }, marks.map((s, j) => h('li', { class: 'g-steps__s', 'aria-current': at === j ? 'step' : null }, s)));
      }
      // A title's `*Latin*` stars would be read out in the mark's label and shown in its tooltip, neither of which italicises.
      const marks = [...learn.steps.map((s, i) => String(s.title ?? '').replace(/\*\*?/g, '') || `Step ${i + 1}`), 'Ten items'];
      const allDone = learn.steps.every((_, i) => doneSteps.has(i));
      const row = h('ol', { class: 'g-steps g-steps--n', 'aria-label': 'Learn steps' }, marks.map((title, j) => {
        const ten = j === nSteps;
        const state = at === j ? 'now' : (!ten && doneSteps.has(j) ? 'done' : 'todo');
        // The ten is a destination and never a tick: passing it ends the sitting and clears this record.
        const go = at !== j && (ten ? allDone : doneSteps.has(j));
        const m = stepMark(j, { title, state, steps: nSteps, go });
        const glyph = h('span', { class: 'g-steps__g', 'aria-hidden': 'true', text: m.glyph });
        return h('li', { class: 'g-steps__s', 'data-state': state, 'aria-current': at === j ? 'step' : null, 'aria-label': go ? null : m.label, title },
          go ? btn([glyph], { 'aria-label': m.label, onclick: () => (ten ? showBlocked() : showSteps({ at: j, back: true })) }, 'g-steps__go')
            : h('span', { class: 'g-steps__go' }, glyph));
      }));
      // The row explains itself (§22.5), from outside the list: inside it, a screen reader counts the "?" as an
      // eighth mark of "Learn steps". The panel is built when it opens, so it reads the steps finished by then.
      // A lesson with no steps has only the ten, and "0 of 0 finished" would explain nothing.
      const nDone = learn.steps.filter((_, i) => doneSteps.has(i)).length;
      const why = nSteps ? tipTrigger('steps', () => stepsTip({ titles: learn.steps.map((s) => s.title), done: [...doneSteps], at }), {
        cls: 'g-why--bare', label: tipLabel('Lesson steps', `${nDone} of ${nSteps} finished`, 'explain this row'),
      }) : null;
      return h('div', { class: 'g-stepbar' }, row, why);
    };
    const finishQueue = () => { writeJSON(LS_QUEUE, queue.length ? queue.slice(1) : null); if (queue.length) render('learn', { skill: queue[0], queue: queue.slice(1) }); else leaveTo(from); };
    if (queue.length) writeJSON(LS_QUEUE, queue);
    const missing = skill.set ? [] : unmetPrereqs(skill, stateOf);
    const firstWorked = learn.steps.findIndex((s) => s.worked);

    /**
     * The page of one step, above its check: the title, the `say`, the `show`
     * (a written sentence with its gloss, or the revealed cells), and the
     * worked example — which, when it has something to ask, keeps the check
     * out of sight until it is finished. The whole thing is one page of the
     * run, so stepping back shows it as it was left.
     */
    const stepLead = (i, item, slot) => {
      const step = learn.steps[slot?.step ?? i];
      if (!step) return null;
      const n = (slot?.step ?? i) + 1;
      const show = step.show?.kind === 'sentence' ? teachItems?.sentence(step.show.id) ?? null : null;
      const showFocus = show ? teachItems.focusOf(show.id)?.candidate?.index ?? null : null;
      const worked = step.worked ? workedPlan(step.worked, teachItems.focusOf(step.worked.sentence), { skill, skills, first: (slot?.step ?? i) === firstWorked }) : null;
      const sameSentence = worked && show && worked.sentence.id === show.id;
      const leadDone = () => lead.dispatchEvent(new CustomEvent('g-lead-done'));
      // The step's body — say, show, worked example — is built when it is to be read: after the notice, or at once.
      const body = h('div', { class: 'g-step__body' });
      let wn = null;
      const fillBody = () => {
        wn = worked ? workedNode(worked, { first: (slot?.step ?? i) === firstWorked, onDone: leadDone }) : null;
        // The explanation is one box (2026-10-23: "the explanations would be in each section a small explanation
        // box … OR the ? mark will show the information contained within that section"): as it was on a page; in
        // game mode its first lines, with ? for the whole of it. The worked example stays out: it is asked.
        const more = [show && !sameSentence ? writtenNode(show, { focus: showFocus }) : null,
          step.show?.kind === 'paradigm' ? revealNode(teachItems, step.show) : null].filter(Boolean);
        const explain = step.say || more.length ? h('div', { class: 'g-explain' }) : null;
        if (explain) {
          const q = btn([h('span', { 'aria-hidden': 'true', text: '?' }), h('span', { class: 'g-explain__qtext', text: ' The whole explanation' })], { 'aria-expanded': 'false', onclick: () => { const open = explain.classList.toggle('is-open'); q.setAttribute('aria-expanded', String(open)); } }, 'g-explain__q');
          explain.append(h('p', { class: 'g-explain__head' }, h('span', { 'aria-hidden': 'true', text: '💡 ' }), 'How it works', q),
            ...[step.say ? h('p', { class: 'g-step__say' }, prose(step.say)) : null,
              step.passive ? h('p', { class: 'g-step__say g-step__passive' }, h('b', { text: 'And the passive, below the active: ' }), step.passive) : null,
              appliesNode(skill, step.show?.kind === 'paradigm' ? step.show.key : (step.check?.key ?? null)),
              howNode(skill, { open: false }), more.length ? h('div', { class: 'g-explain__more' }, more) : null].filter(Boolean));
        }
        body.append(...[explain,
          wn?.node ?? null].filter(Boolean));   // `Element.append` prints a null as the word "null"
        return !!(wn && !wn.done());
      };
      // The noticing opener first (§10): the rest of the step, and its check, wait on it — one tap skips it.
      const nn = step.notice ? noticeNode(step.notice, teachItems, { onDone: () => { const gated = fillBody(); body.hidden = false; if (!gated) leadDone(); body.querySelector('.g-step__say, .g-worked__ask .g-q')?.scrollIntoView?.({ block: 'nearest' }); } }) : null;
      const lead = h('section', { class: 'g-step', 'aria-label': `Step ${n} of ${nSteps}` },
        (slot?.step ?? i) === 0 ? prereqNode(skill, missing) : null,
        (slot?.step ?? i) === 0 && !skill.set ? areaNav(skill.id) : null,
        h('p', { class: 'g-kicker', text: `Step ${n} of ${nSteps}` }),
        // Through `prose`, as `say` is: ten titles mark their Latin (`*cum* glued on behind: *mēcum*`) and printed the stars.
        h('h2', { class: 'g-step__title', tabindex: '-1' }, prose(step.title || skill.title)),
        nn?.node ?? null,
        body);
      lead.gExplain = () => (step.say ? h('div', { class: 'g-explain' }, h('p', { class: 'g-step__say' }, prose(step.say)), step.passive ? h('p', { class: 'g-step__say g-step__passive' }, h('b', { text: 'And the passive, below the active: ' }), step.passive) : null) : null);
      let gate = false;
      if (nn && !nn.done()) { body.hidden = true; gate = true; }
      else gate = fillBody();
      return { node: lead, gate };
    };

    const showSteps = ({ at = 0, back = false } = {}) => {
      // `pr.step` is the runner's own frontier, moved on by one the moment the item standing there is
      // answered — so everything from where this run began up to it has had its check answered, and that
      // is exactly the set to write down. Steps before `at` are untouched: the set only grows.
      const first = learn.startSteps({ at, onStep: (pr) => markSteps(answeredIn(at, pr.step)) });
      if (!first) { showNoSteps(); return; }
      if (back) ctx.say(`Back at step ${Math.min(at + 1, nSteps)} of ${nSteps}.`);
      else if (at > 0) ctx.say(`Picked up at step ${Math.min(at + 1, nSteps)} of ${nSteps}, the first you have not finished.`);
      runSession({ runner: learn.runner, title: 'Check', mode: 'learn', hintOpen: false, stepper: (slot) => stepper(slot?.step ?? 0), lesson, before: stepLead, onDone: showBlocked,
        // The end of each part offers the whole of it, practised on its own (2026-10-23).
        onFirst: (item) => { if (item.step != null && learn.steps[item.step]) notePractised(`part:${id}:${item.step}`); },
        partLink: (item) => (item.step != null && learn.steps[item.step] ? btn(`Practise this part more`, { to: ['part', { skill: id, step: item.step }], onclick: () => goView('part', { skill: id, step: item.step }), 'aria-label': `Practise part ${item.step + 1}, ${stepTitle(learn.steps[item.step], item.step)}, on its own` }, 'btn btn--quiet g-partmore') : null) });
    };
    /** No teach steps written yet (or no written sentences): the lesson to read, then the ten. */
    const showNoSteps = () => {
      setBody(stepper(0), lessonHeader(skill, stateOf(id)), h('article', { class: 'g-lesson' }, lessonBlocks(skill, lesson, { learn: true })),
        h('p', { class: 'g-quiet', text: 'This skill has no step-by-step teaching yet; the lesson stands, and ten items follow.' }),
        h('div', { class: 'g-acts' }, btn('Start the ten', { onclick: showBlocked }, 'btn btn--primary'), btn(from ? backLabel(from).replace('← ', 'Back to ') : 'Back to skills', { onclick: () => leaveTo(from) }, 'btn btn--quiet')));
    };
    const showGuided = (opts = {}) => {
      const first = opts.more ? learn.moreGuided() : learn.startGuided();
      if (!first) { setBody(stepper(0), h('p', { class: 'g-quiet', text: 'This set has no items yet.' }), h('div', { class: 'g-acts' }, backButton(from, 'btn'))); return; }
      const seenBefore = learn.seen;
      const thing = skill.set === 'vocab' ? 'words' : 'questions';
      const note = `${skill.set === 'vocab' ? 'Each word with its dictionary line after it' : 'Each question with the answering sentence after it'}. ${seenBefore + 1}–${Math.min(learn.total, seenBefore + learn.batchSize)} of ${learn.total} ${thing}; you can stop after any batch and pick it up here.`;
      runSession({ runner: learn.runner, title: `Through the deck · ${skill.title}`, note, mode: 'learn', hintOpen: false, stepper: stepper(0), lesson, onDone: showBatchEnd });
    };
    /** After a batch: how far through the deck, and the three honest ways on — another batch, the blocked ten, or stop. */
    const showBatchEnd = (summary) => {
      const left = learn.left;
      const thing = skill.set === 'vocab' ? 'word' : 'question';
      setBody(stepper(0), h('header', { class: 'g-head' },
        h('h1', { class: 'g-title', text: left ? 'Batch done' : 'Through the deck' }),
        h('p', { class: 'g-lede', text: left
          ? `${summary.right} of ${summary.total} right · ${learn.seen} of ${learn.total} ${thing}s seen, ${left} to go. Stopping here keeps your place.`
          : `${summary.right} of ${summary.total} right · all ${learn.total} ${thing}s seen. Ten more, mixed, and this set joins your mixed practice.` })),
        h('p', { class: 'g-prog__wrap' }, h('progress', { class: 'g-prog', max: String(learn.total), value: String(learn.seen), 'aria-label': `${learn.seen} of ${learn.total} ${thing}s seen` })),
        h('div', { class: 'g-acts' },
          left ? btn(`Another ${Math.min(learn.batchSize, left)}`, { onclick: () => showGuided({ more: true }) }, 'btn btn--primary') : null,
          btn('Go on to the ten', { onclick: showBlocked }, left ? 'btn' : 'btn btn--primary'),
          btn('Stop for now', { onclick: () => leaveTo(from) }, 'btn btn--quiet')));
      ctx.say(left ? `${learn.seen} of ${learn.total} seen.` : 'Through the deck.');
    };
    const tenAt = skill.set ? 1 : nSteps;
    const showBlocked = () => {
      // The steps are behind the learner now: a reload from here comes back to the ten, not to step one (M-2).
      // Every one of them, and honestly so — the ten is reachable only by answering the last step's check, by
      // the "Ten" pip, which is a control only once they are all answered, or from a Learn already finished.
      if (!skill.set && nSteps) markSteps(learn.steps.map((_, i) => i));
      const first = learn.startBlocked();
      if (!first) { setBody(stepper(tenAt), h('p', { class: 'g-quiet', text: 'No sentences fit this skill yet, so there is nothing to drill. Add the review shelf or another week and come back.' }), h('div', { class: 'g-acts' }, backButton(from, 'btn'))); return; }
      runSession({ runner: learn.runner, title: `Ten items · ${skill.title}`, note: skill.set ? 'Ten more from this set. Six of ten and it joins your mixed practice.' : 'Ten items, this skill only — its own sentences first, then the book\'s. Hints are behind a button; feedback after each.', mode: 'learn', hintOpen: false, stepper: stepper(tenAt), lesson, onDone: async () => showResult(await learn.finishBlocked()) });
    };
    const showResult = (r) => {
      if (r.total) notePractised(`skill:${id}`);
      const missedKinds = [...new Set(r.missed.map((a) => a.kind))];
      const passed = r.passed;
      // The blocked ten's own misses, as items that can be rebuilt (a self-graded "partly" is not one).
      const redoMissed = r.missed.filter((a) => a.item_key && !a.partial);
      if (passed) setLearnPlace(id, null);
      // The same-session re-test (§10) and the reading tie-in (§13) belong to a skill that has just been learned.
      if (passed && !skill.set) noteRetestFor(id);
      const after = h('div', { class: 'g-after' }, skill.set ? null : firstNextNode(id), passed ? retestNode({ only: id, from }) : null);
      if (passed && !skill.set) tieInNode(id).then((n) => { if (n) after.append(n); }).catch(() => {});
      setBody(stepper(tenAt), h('header', { class: 'g-head' },
        h('h1', { class: 'g-title', text: passed ? 'Learned' : 'Not yet' }),
        h('p', { class: 'g-lede', text: passed
          ? (skill.set ? `${r.correct} of ${r.total}. ${skill.title} joins your mixed practice; its first review is due tomorrow.` : `${r.correct} of ${r.total} across ${r.kinds} kinds. ${skill.title} joins your mixed practice; its first review is due tomorrow.`)
          : (skill.set ? `${r.correct} of ${r.total} — the bar is six of ten. Nothing is lost: another ten are ready when you are.` : `${r.correct} of ${r.total}${r.kinds < 2 && r.correct >= 6 ? ', but all of one kind' : ''} — the bar is six of ten across two kinds. Nothing is lost: a fresh set of ten is ready when you are.`) })),
        !passed && r.missed.length ? h('section', { class: 'g-missed' }, h('h2', { class: 'g-h2', text: 'What was missed' }),
          h('ul', { class: 'g-missed__list' }, r.missed.map((a) => h('li', {}, h('span', { class: 'g-missed__kind', text: a.kind }), ' ', h('span', { lang: 'la', text: a.answer || '—' }), ' → ', h('span', { lang: 'la', text: a.expected })))),
          skill.set ? null : h('p', { class: 'g-quiet', text: `Kinds missed: ${missedKinds.join(', ')}. The lesson's rule and the confusion note are below.` }),
          skill.set ? null : h('article', { class: 'g-lesson g-lesson--lit' }, (lesson?.core ?? []).filter((b) => b.type === 'rule' || b.type === 'confusion').map((b) => b.type === 'rule' ? h('p', { class: 'g-lesson__rule is-lit' }, prose(b.text)) : h('div', { class: 'g-lesson__conf is-lit' }, h('p', { class: 'g-lesson__tag', text: `Not to be confused with ${titleOf(b.with)}` }), h('p', {}, prose(b.text)))))) : null,
        after,
        // What next, on the path (2026-10-23): the next skill once this one is learned, the ones under it when
        // it is not yet — and any part of the lesson to practise on its own.
        skill.set ? null : h('div', { class: 'g-acts g-acts--path' }, passed ? nextOnPath(id) : null, tablePartButton(id, { chapter: skill.chapter }), levelButton(id)),
        skill.set ? null : suggestNode(id),
        skill.set ? null : partsNode(id, learn.steps, { heading: passed ? 'Practise one part again' : 'Practise one part on its own' }),
        h('div', { class: 'g-acts' },
          // "Redo the N you missed" from a Learn run, but only once the run has **passed**: the skill is in the
          // rotation from that moment, so a redo is the ordinary logged encounter the contract describes. On a
          // failed run the honest offer is another ten (below), not a session that would graduate the skill.
          passed && redoMissed.length ? btn(`Redo the ${redoMissed.length} you missed`, { to: ['redo', { misses: redoMissed, skill: id, from }], onclick: () => render('redo', { misses: redoMissed, skill: id, from }), 'aria-label': `Redo the ${redoMissed.length} item${redoMissed.length === 1 ? '' : 's'} you missed in this drill` }, 'btn btn--primary') : null,
          passed ? [btn(queue.length ? `Next: ${titleOf(queue[0])}` : (from ? backLabel(from).replace('← ', 'Back to ') : 'Back to skills'), { onclick: finishQueue }, redoMissed.length ? 'btn' : 'btn btn--primary'), btn('Practise now', { onclick: () => startBlocked(id, from) }, 'btn')]
            : [btn('Another ten', { onclick: showBlocked }, 'btn btn--primary'), skill.set ? btn(learn.left ? `The next ${Math.min(learn.batchSize, learn.left)}` : 'Through the deck again', { onclick: () => showGuided({ more: !!learn.left }) }, 'btn') : btn(nSteps ? 'Go through the steps again' : 'Re-read the lesson', { onclick: () => showSteps() }, 'btn'), btn('Stop for now', { onclick: () => leaveTo(from) }, 'btn btn--quiet')]));
      ctx.say(passed ? `${skill.title} learned.` : 'Not yet; another ten items are ready.');
    };
    // **The first unfinished step, always** (§22.3). It used to be wherever the learner last stood, which is
    // the fault they reported: they left a lesson in the middle of step 2 having already done 3 and 4 by
    // another route, and "Continue learning" put them back on 2 with nothing on the page saying so. Going
    // back is a press on a pip now, and never what the button does by itself. All of them answered → the ten.
    if (skill.set) showGuided();
    else if (nSteps && continueAt(savedLearn, nSteps) >= nSteps) showBlocked();
    else showSteps({ at: nSteps ? continueAt(savedLearn, nSteps) : 0 });
  }

  /* --------------------------------------------- "Just drill it" (§10) */
  /**
   * The rule pinned at the top of every item of a drill: the lesson's own
   * rule block when it has one, else the skill's summary — so the learner can
   * look without leaving.
   */
  const pinOf = (skill, lesson) => (lesson?.core ?? []).find((b) => b.type === 'rule')?.text || skill.summary || '';
  /**
   * A blocked set on one skill alone, no steps in the way: ten items, the
   * skill's written sentences first (A1), the rule pinned above each. `size`
   * 3 with `retest` is the same-session re-test (§10). Two taps from a skill
   * row, a chapter page or a catalogue entry: one opens, one starts this.
   */
  async function renderDrill({ skill: id, size = null, retest = false, from = null }) {
    const skill = skills.get(id);
    if (!skill) return renderToday();
    if (!retest) keepEntry('drill');
    if (skill.set) { startBlocked(id, from); return; }   // a chapter set keeps its own practice
    setBody(h('p', { class: 'g-loading', text: 'Preparing the drill…' }));
    const [lesson, teachItems, generated] = await Promise.all([lessonOf(id), teachItemsOf(skill), generatedItemsOf(skill)]);
    const n = size ?? LEARN_BLOCKED;
    const drill = createDrill({ skill, gstore, items, teachItems, generated, currentWeekN: ctx.currentWeekN(), size: n, pin: pinOf(skill, lesson) });
    await drill.begin();
    const first = drill.start();
    if (!first) { setBody(nothingToDrill(skill, from)); return; }
    const note = retest ? `Three items on ${skill.title}, a little after you last met it: the first review, the same day.`
      : `${n} items, this skill only — its own sentences first, then ${drill.bank ? 'ones the app generates from the chapter\'s words, then ' : ''}the book's.${bankUnreachableNote(drill.bank, generatedUnreachable(id))} The rule stays at the top of each; feedback after every one.${drill.mode === 'learn' ? ' This skill is still in Learn, so these count towards its criterion.' : ''}`;
    runSession({ runner: drill.runner, title: retest ? `Re-test · ${skill.title}` : `Drill · ${skill.title}`, note, mode: drill.mode, hintOpen: false, onDone: (summary) => { if (retest) clearRetest(id); renderSummary(summary, { drill: id, size: n, retest, from }); } });
    // A drill started in Word Work keeps the chapter's skills a choice away above it (wwSkillBar).
    if (from?.wordwork != null) body.prepend(wwSkillBar(Number(from.wordwork), id));
  }
  const nothingToDrill = (skill, from) => [from?.wordwork != null ? wwSkillBar(Number(from.wordwork), skill.id) : null, h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: skill.title }), h('p', { class: 'g-lede', text: 'No sentences fit this skill yet, so there is nothing to drill. Add the review shelf or another week and come back.' })), h('div', { class: 'g-acts' }, backButton(from, 'btn'))];

  /* ------------------------------------- unlimited and mixed practice (§11, §12) */
  /**
   * **Unlimited practice** (§11): the drill, open-ended — ten at a time, "Ten
   * more" at the end of each, the skill's written sentences first and then its
   * generated bank, nothing repeated until the whole bank has come round.
   */
  async function renderUnlimited({ skill: id, from = null }) {
    const skill = skills.get(id);
    if (!skill) return renderToday();
    keepEntry('unlimited');
    if (skill.set) { startBlocked(id, from); return; }
    setBody(h('p', { class: 'g-loading', text: 'Preparing the practice…' }));
    const [lesson, teachItems, generated] = await Promise.all([lessonOf(id), teachItemsOf(skill), generatedItemsOf(skill)]);
    const drill = createDrill({ skill, gstore, items, teachItems, generated, currentWeekN: ctx.currentWeekN(), size: LEARN_BLOCKED, pin: pinOf(skill, lesson), open: true });
    await drill.begin();
    if (!drill.start()) { setBody(nothingToDrill(skill, from)); return; }
    const note = `Ten at a time, for as long as you like — this skill's own sentences first, then ${drill.bank ? `${drill.bank} sentences the app generates from the chapter's words, none twice until all have come round` : 'the book\'s'}.${bankUnreachableNote(drill.bank, generatedUnreachable(id))} The rule stays at the top of each; feedback after every one.${drill.mode === 'learn' ? ' This skill is still in Learn, so these count towards its criterion.' : ''}`;
    runSession({ runner: drill.runner, title: `Unlimited · ${skill.title}`, note, mode: drill.mode, hintOpen: false, open: true, more: () => drill.more(), onDone: (summary) => renderSummary(summary, { drill: id, unlimited: true, from }) });
  }
  const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  /**
   * **A mixed set** (§12): the skill interleaved with the skills it is declared
   * confusable with and the ones it builds on (`mixedMembers`, capped to the
   * learner's chapter), each drawn from its own written sentences, then its
   * bank, then the book. Open-ended like unlimited practice.
   */
  async function renderMixed({ skill: id, from = null }) {
    const skill = skills.get(id);
    if (!skill) return renderToday();
    if (skill.set) { startBlocked(id, from); return; }
    setBody(h('p', { class: 'g-loading', text: 'Preparing the set…' }));
    const members = mixedMembers(skill, skills, { chapter: ctx.currentChapter?.() ?? null, drillable });
    const loaded = await Promise.all(members.map(async (s) => { const [lesson, teachItems, generated] = await Promise.all([lessonOf(s.id), teachItemsOf(s), generatedItemsOf(s)]); return { skill: s, teachItems, generated, pin: pinOf(s, lesson) }; }));
    const mixed = createMixed({ members: loaded, gstore, items, currentWeekN: ctx.currentWeekN(), size: LEARN_BLOCKED });
    await mixed.begin();
    if (!mixed.start()) { setBody(nothingToDrill(skill, from)); return; }
    const others = members.slice(1).map((s) => s.title);
    const note = others.length
      ? `Ten at a time: ${skill.title} on every other item, and between them ${andList(others)} — the skills it is easiest to confuse it with, and the ones it builds on. Each from its own sentences first, then generated ones, then the book's.`
      : `No related skill can be drilled yet, so this set is ${skill.title} alone.`;
    runSession({ runner: mixed.runner, title: `Mixed · ${skill.title}`, note, mode: 'practice', hintOpen: false, open: true, more: () => mixed.more(), onDone: (summary) => renderSummary(summary, { drill: id, mixed: true, from }) });
  }

  /* ---------------------------------------- the same-session re-test (§10) */
  const LS_RETEST = 'l103.grammar.retest';
  const retestList = () => readJSON(LS_RETEST, []);
  /** A skill learned or drilled just now: its re-test is offered ten minutes on, or at the next summary after that. */
  const noteRetestFor = (id) => writeJSON(LS_RETEST, noteRetest(retestList(), id, Date.now()));
  const clearRetest = (id) => { const rest = retestList().filter((r) => r.skill !== id); writeJSON(LS_RETEST, rest.length ? rest : null); };
  /**
   * The re-test offer as a line: the skills whose ten minutes have passed,
   * each with its three items a tap away; and, when nothing is due yet, when
   * the soonest will be. `only` narrows it to one skill (a result screen
   * speaks of its own skill). null when there is nothing to say.
   */
  /**
   * **Review** (2026-10-25: "get rid of the review pills and have a review button that will list needed review items"):
   * one button with the count; it opens the list — the short re-tests ready, the skills due, what was missed — each a
   * start, and Practise everything due at the top.
   */
  function reviewItems() {
    const now = Date.now();
    const retests = retestDue(retestList().filter((r) => skills.has(r.skill)), now).map((r) => r.skill);
    const due = [...skills.keys()].filter((x) => !skills.get(x).set && inRotation(stateOf(x)) && isDue(stateOf(x), now)).sort((a, b) => thePath().of(a) - thePath().of(b));
    const missed = missedCount();
    return { retests, due, missed, n: retests.length + due.length + (missed ? 1 : 0) };
  }
  function reviewButton() {
    const r = reviewItems();
    const count = r.retests.length + r.due.length;
    return h('p', { class: 'g-acts' }, btn(r.n ? `🔁 Review (${count}${r.missed ? ` + ${r.missed} missed` : ''})` : '🔁 Review · nothing due', { 'aria-haspopup': 'dialog', onclick: () => openReview() }, `btn ${r.n ? 'btn--primary' : ''} g-reviewbtn`.trim()));
  }
  function openReview() {
    const r = reviewItems();
    const d = h('dialog', { class: 'g-pmenu', 'aria-labelledby': 'g-pmenu-h' });
    const go = (fn) => () => { d.close(); fn(); };
    const row = (id, label, fn) => h('li', {}, h('button', { type: 'button', class: 'g-pmenu__part', onclick: go(fn) },
      h('span', { class: 'g-pmenu__n g-pmenu__cap', text: capOf(id).replace('Cap. ', '') }), h('span', { class: 'g-pmenu__t', text: label })));
    d.append(...[
      h('div', { class: 'g-pmenu__top' }, h('p', { class: 'g-kicker', text: 'Review · what needs it now' }), btn('×', { 'aria-label': 'Close', onclick: () => d.close() }, 'g-pop__close g-pmenu__close')),
      h('h2', { id: 'g-pmenu-h', class: 'g-pmenu__h', text: 'Review' }),
      r.due.length ? h('p', { class: 'g-acts' }, btn('▶ Practise everything due', { onclick: go(() => goView('session', {})) }, 'btn btn--primary')) : null,
      r.retests.length ? [h('h3', { class: 'g-pmenu__sh', text: `Short re-tests ready (${r.retests.length}) · three items each` }), h('ol', { class: 'g-pmenu__list' }, r.retests.map((x) => row(x, titleOf(x), () => render('drill', { skill: x, size: RETEST_SIZE, retest: true }))))] : null,
      r.due.length ? [h('h3', { class: 'g-pmenu__sh', text: `Due for review (${r.due.length})` }), h('ol', { class: 'g-pmenu__list' }, r.due.map((x) => row(x, titleOf(x), () => startSkill(x, 'review'))))] : null,
      r.missed ? [h('h3', { class: 'g-pmenu__sh', text: 'Missed before' }), h('p', { class: 'g-acts' }, btn(`Redo the ${r.missed} you missed`, { onclick: go(() => goView('redo', {})) }, 'btn'))] : null,
      r.n ? null : h('p', { class: 'g-quiet', text: 'Nothing needs review just now.' }),
    ].flat().filter(Boolean));
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    document.body.append(d);
    d.showModal();
    d.querySelector('button.btn, .g-pmenu__part')?.focus();
  }
  function retestNode({ only = null, from = null } = {}) {
    const now = Date.now();
    const list = retestList().filter((r) => skills.has(r.skill) && (!only || r.skill === only));
    const due = retestDue(list, now);
    const pending = retestPending(list, now);
    if (!due.length && !pending.length) return null;
    const node = h('div', { class: 'g-retest' });
    if (due.length) {
      node.append(h('p', { class: 'g-retest__line' }, `${due.length === 1 ? 'A short re-test is ready' : 'Short re-tests are ready'}: three items each, on what you learned or drilled earlier.`),
        h('div', { class: 'g-acts' }, due.map((r) => btn(`Re-test ${titleOf(r.skill)}`, { to: ['drill', { skill: r.skill, size: RETEST_SIZE, retest: true, from }], onclick: () => render('drill', { skill: r.skill, size: RETEST_SIZE, retest: true, from }), 'aria-label': `Re-test ${titleOf(r.skill)}: three items` }, 'btn btn--primary'))));
    }
    if (pending.length) {
      const soon = pending[0];
      const mins = Math.max(1, Math.ceil((Number(soon.at) + RETEST_AFTER_MS - now) / 60000));
      node.append(h('p', { class: 'g-retest__line g-quiet' }, `A three-item re-test of ${pending.map((r) => titleOf(r.skill)).join(' and ')} will be offered in about ${mins} minute${mins === 1 ? '' : 's'}, or at the end of your next session.`));
    }
    return node;
  }

  /* --------------------------------------------- the reading tie-in (§13) */
  let occurrencesP = null;
  const occurrencesOf = () => (occurrencesP ??= loadOccurrences());
  /**
   * One line after Learn or a drill: how often the construction occurs in the
   * learner's current chapter — "the notes mark N" when the count is the
   * highlights' (a floor, never a total), "occurs about N times" when only the
   * scanner counted — with one link that opens the chapter, the listed units
   * handed to the reader. With no count for the current chapter the skill's own
   * chapter answers, and the line names it.
   */
  async function tieInNode(skillId) {
    const skill = skills.get(skillId);
    const occ = await occurrencesOf();
    if (!occ || !skill || skill.set) return null;
    const current = ctx.currentChapter?.() ?? null;
    const tries = [...new Set([current, skill.chapter].filter((c) => c != null))];
    let line = null;
    let chapter = null;
    for (const c of tries) { line = occurrenceLine(occ, skillId, c); if (line) { chapter = c; break; } }
    if (!line) return null;
    const here = chapter === current;
    const text = here ? line.text : line.text.replace('this chapter', `chapter ${roman(chapter)}`);
    const open = () => {
      // The reader lights the chapter's own highlights already; the listed units ride along for it.
      try { sessionStorage.setItem('l103.grammar.lit', JSON.stringify({ skill: skillId, chapter, units: line.unitIds })); } catch { /* private mode */ }
      if (typeof ctx.openChapter === 'function') ctx.openChapter(Number(chapter), 'reading');
      else ctx.go?.('read');
    };
    return h('p', { class: 'g-tiein' }, h('span', { class: 'g-tiein__text', text: `${text} ` }), h('button', { type: 'button', class: 'g-link', onclick: open }, `Open chapter ${roman(chapter)} with them lit`));
  }

  /* ---------------------------------------------- scaffolded tables (§12) */
  const LS_SCAFFOLD = 'l103.grammar.scaffold.';       // + table id: that table's remembered level
  const LS_SCAFFOLD_AUTO = 'l103.grammar.scaffoldAuto.';   // + table id: where `auto` has faded to
  const LS_SCAFFOLD_RUN = 'l103.grammar.scaffoldRun.';     // + table id: how many tables of it have been answered
  const scaffoldGlobal = () => normaliseScaffold(ctx.settings?.grammar?.scaffold);
  const scaffoldLevelOf = (tableId) => { const own = tableId ? readJSON(LS_SCAFFOLD + tableId, null) : null; return own != null ? normaliseScaffold(own) : scaffoldGlobal(); };
  const scaffoldAutoOf = (tableId) => { const v = tableId ? Number(readJSON(LS_SCAFFOLD_AUTO + tableId, 80)) : 80; return [80, 50, 20, 0].includes(v) ? v : 80; };
  /**
   * Which arrangement of a level this table is drawn in (§19): the count of
   * tables of this one the learner has already answered, so practising 80%
   * three times is three different exercises rather than one memorised
   * picture. It lives beside the level and auto's step because it is the same
   * kind of fact — durable, per table, this device's — and because the two
   * durable per-table records the learner actually produces are not usable
   * here: `metCells` is an in-memory Map rebuilt every sitting, and the
   * attempt log does not say which table a chart was on (a drill chart's
   * `item_key` is a cell key; a catalogue chart's is empty by design, so a
   * miss never enters "redo what was wrong"). §19 gave a second reason — that
   * a catalogue run outside the rotation logged nothing at all — which §20 has
   * since removed: such a run is logged now, and marked `meta.uncounted`. The
   * first reason stands on its own and the count stays here.
   * The first table of one a learner has never answered is variant 0: the
   * settled anchors-first arrangement, unchanged.
   */
  const scaffoldRunOf = (tableId) => { const v = tableId ? Number(readJSON(LS_SCAFFOLD_RUN + tableId, 0)) : 0; return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; };
  const noteScaffoldRun = (tableId) => { if (tableId) writeJSON(LS_SCAFFOLD_RUN + tableId, scaffoldRunOf(tableId) + 1); };
  /** The switch's choice: remembered for this table and as the default for every other (`settings.grammar.scaffold`). */
  const setScaffold = (tableId, level) => { const v = normaliseScaffold(level); if (tableId) writeJSON(LS_SCAFFOLD + tableId, v); ctx.savePrefs?.({ scaffold: v }); };
  /** Cells the learner has answered right this sitting, per table — the "already met" tier of what is given. */
  const metCells = new Map();
  let selectRules = null;
  let catTables = null;   // the catalogue's tables (labels and model words), once loaded
  let gameCountedTable = null;   // a table a chart game has already counted this session (renderSummary skips it)
  loadParadigmCatalogue().then((c) => { selectRules = Array.isArray(c?.raw?.select) ? c.raw.select : null; catTables = c?.tables ?? null; }).catch(() => {});
  /**
   * "For: all four conjugations …" — what a skill's rule covers, and what the step's own table is an example of
   * (2026-10-23: "it should always say which conjugations it applies for, if it applies to all"). applies.js.
   */
  const appliesNode = (skill, tableId = null, { diff = true } = {}) => {
    const what = appliesTo(skill?.paradigms);
    if (!what) return null;
    const t = tableId ? catTables?.get?.(tableId) : null;
    const ex = tableId ? exampleOf(tableId, { label: t?.label ?? '', example: t?.example ?? '' }) : '';
    const line = h('p', { class: 'g-explain__applies' }, h('span', { class: 'g-explain__for', text: 'For: ' }), what, '.', ex ? h('span', { class: 'g-explain__ex', text: ` ${ex}` }) : null);
    // Where the types differ, how each one does it (2026-10-23: "if different for other conjugations or declensions
    // you can say what the difference is"), read off each type's own model table. Never above a question: a drill
    // can ask the very model word, so `diff: false` there.
    const d = diff ? differencesOf(skill) : [];
    if (d.length < 2) return line;
    const each = d.map((x, i) => [i ? h('span', { class: 'g-diff__sep', 'aria-hidden': 'true', text: ' · ' }) : null, h('span', { class: 'g-diff__i' }, h('b', { text: x.name }), ' ', h('i', { lang: 'la', text: x.forms.join(', ') }))]);
    const kind = d.every((x) => /conj/.test(x.id) || WORD_TABLES.has(x.id)) ? 'conjugation' : d.every((x) => /^decl|^domus/.test(x.id)) ? 'declension' : 'kind of word';
    return h('div', { class: 'g-explain__appliesbox' }, line,
      d.length <= 5 ? h('p', { class: 'g-explain__diff' }, h('span', { class: 'g-explain__for', text: `Each ${kind}: ` }), each)
        : h('details', { class: 'g-explain__diff' }, h('summary', { text: `How each ${kind} does it (${d.length})` }), h('p', {}, each)));
  };
  /**
   * How to make the skill's forms, for every type it covers, with no one word in it (2026-10-23: "say which
   * principal part to start with and then how to transform it per conjugation … everywhere"): a verb's from the
   * principal parts (wordrule.js skillHow), a case's from the genitive and each declension's endings, read off its
   * model table as endings only. It can sit above a question: it names the rule, never a word's form.
   */
  const howMemo = new Map();
  let howOpen = true;   // the question's "How to make it", as the learner last left it this visit
  function howOf(skill) {
    if (!skill || skill.set) return null;
    if (howMemo.has(skill.id)) return howMemo.get(skill.id);
    let rule = null;
    try { rule = skillHow(skill); } catch { rule = null; }
    if (!rule) rule = caseHow(skill);
    if (rule) rule = { ...rule, type: skill.title };   // the card's heading says "How to make it"; its title is the skill
    if (catTables || !rule) howMemo.set(skill.id, rule);
    return rule;
  }
  function caseHow(skill) {
    const f = [].concat(skill.parse_filter ?? []).find((x) => x && (x.case || x.degree)) ?? null;
    const tables = (skill.paradigms ?? []).filter((id) => /^(decl|adj|domus)/.test(id));
    if (f?.degree) {
      return { kind: 'Adjective', type: 'How to make it', parts: '', steps: [
        { head: 'Start', text: 'Start from the stem: the genitive without its ending (or, for -us, -a, -um adjectives, the feminine without -a).' },
        ...([].concat(f.degree).includes('comp') ? [{ head: 'Comparative', text: 'Stem + -ior (masculine and feminine), -ius (neuter); it declines like a 3rd-declension noun (-iōris …).' }] : []),
        ...([].concat(f.degree).includes('super') ? [{ head: 'Superlative', text: 'Stem + -issimus, -a, -um. After -er: the masculine + -rimus. Six in -lis (facilis, difficilis, similis, dissimilis, gracilis, humilis): stem + -limus.' }] : []),
        { head: 'Irregular', text: 'A few have their own forms: bonus → melior, optimus; malus → peior, pessimus; magnus → maior, maximus; parvus → minor, minimus; multus → plūs, plūrimus.' }] };
    }
    if (!f?.case || !tables.length) return null;
    const steps = [{ head: 'Start', text: 'Start from the genitive singular (the 2nd part of the dictionary entry: -ae, -ī, -is, -ūs, -ēī) and drop that ending: what is left is the stem.' }];
    for (const id of tables) {
      let e = null;
      try { e = entryForKey(id, skill); } catch { e = null; }
      const t = e ? tableOf(e) : null;
      if (!t) continue;
      const ends = [];
      for (const sec of t.sections ?? []) for (const r of sec.rows ?? []) for (const c of r.cells ?? []) {
        if (!c || c.empty || !c.key) continue;
        let ok = false;
        try { ok = skillCovers(skill, e, c.key); } catch { ok = false; }
        if (!ok) continue;
        const end = c.ending ? `-${c.ending}` : 'the dictionary form itself';
        if (!ends.includes(end)) ends.push(end);
      }
      if (!ends.length) continue;
      // Declensions that do it alike are said once: "2nd declension masculine, neuter: Stem + -ō, -īs".
      const text = `Stem + ${ends.join(', ')}`;
      const name = (catTables?.get?.(id)?.label ?? id).replace(/\s*\(.*\)$/, '');
      const same = steps.find((x) => x.text === text && x.head !== 'Start');
      if (same) same.head = `${same.head}, ${name.replace(/^(\d\w\w declension)\s*/, (m, d) => (same.head.startsWith(d) ? '' : m))}`;
      else steps.push({ head: name, text });
    }
    return steps.length > 1 ? { kind: 'Noun', type: 'How to make it', parts: '', steps } : null;
  }
  /** The card itself: "How to make it", open, under a question or beside a lesson (ruleCard). */
  const howNode = (skill, { open = true } = {}) => { const r = howOf(skill); return r ? ruleCard(r, { open, heading: 'How to make it' }) : null; };
  const WORD_TABLES = new Set(['sum', 'possum', 'eo', 'fero', 'volo', 'nolo', 'malo', 'fio']);
  /** Each of a skill's tables, by its model word: its name and its first forms of the skill (two at most). */
  const diffMemo = new Map();
  function differencesOf(skill) {
    if (!skill?.paradigms || skill.paradigms.length < 2) return [];
    if (diffMemo.has(skill.id)) return diffMemo.get(skill.id);
    const out = [];
    for (const id of skill.paradigms) {
      let e = null;
      try { e = entryForKey(id, skill); } catch { e = null; }
      const t = e ? tableOf(e) : null;
      if (!t) continue;
      const forms = [];
      for (const sec of t.sections ?? []) for (const r of sec.rows ?? []) for (const c of r.cells ?? []) {
        if (forms.length >= 2 || !c || c.empty || !c.key) continue;
        let ok = false;
        try { ok = skillCovers(skill, e, c.key); } catch { ok = false; }
        if (!ok) continue;
        const txt = String(c.text ?? '').split(' / ')[0];
        forms.push(c.stem && c.ending && txt === c.stem + c.ending ? `${c.stem}-${c.ending}` : txt);
      }
      const label = catTables?.get?.(id)?.label ?? id;
      if (forms.length) out.push({ id, name: label.replace(/\s*\|.*$/, ''), forms });
    }
    if (catTables) diffMemo.set(skill.id, out);   // before the catalogue's labels arrive, not kept
    return out;
  }
  /** The table a chart item is on: the catalogue's id where the item names it, else the select rules on its word, else the word itself. */
  /** "×3": how many times it has been practised (practised.js), or nothing when never. */
  const countBadge = (key, what = 'Practised') => { const n = practised(key); return n ? h('span', { class: 'g-count', title: `${what} ${n} time${n === 1 ? '' : 's'}`, 'aria-label': `${what.toLowerCase()} ${n} time${n === 1 ? '' : 's'}`, text: timesText(n) }) : null; };
  /** The "×N" key of a word's table (practised.js): its catalogue table, decl1, pres-act-1 … */
  const tableKey = (e) => { const t = e && selectRules ? tableIdOf(e, selectRules) : null; return t ? `table:${t}` : null; };
  /**
   * A game played to its end on a skill's own cells of a table (its part of the table, Word Work's whole-table drill,
   * a Sheets chart) is that skill's chart, practised (2026-10-23: "practice in game mode should also be recorded in
   * the lesson mode … as long as the content is the same"). It is logged as the Tables tab logs a table practised on
   * its own (§20): one chart attempt, `meta.uncounted`, so it ticks the skill's Chart part and its history and
   * never moves the scheduler or stands in for the blocked ten. Right when nothing had to be shown; a first-try miss
   * is a hint, as a chart's hinted cells are. Nothing is redrawn here: the game's own end screen is still open over
   * the page, and the next view drawn reads the log.
   */
  const tableGameDone = (sk, e) => ({ firstMiss = new Set(), shown = new Set() } = {}) => {
    if (!sk?.id || !gstore?.addAttempt) return;
    const table = tableKey(e)?.slice('table:'.length) ?? null;
    gstore.addAttempt({ skill: sk.id, kind: 'chart', item_key: '', mode: 'practice', correct: shown.size === 0, hinted: firstMiss.size > 0, self: false, partial: false,
      answer: 'the table, played as a game', expected: '', confused_with: null, ms: 0, at: new Date().toISOString(), meta: { uncounted: true, game: true, ...(table ? { table } : {}) } })
      .catch((err) => console.warn('[grammar] the game was not written down', err?.message || err));
  };
  const tableIdOfItem = (item) => item?.chart?.tableId ?? (selectRules ? tableIdOf(item?.entry, selectRules) : null) ?? item?.entry?.h ?? null;
  /** The cells a skill teaches on a table: those its `paradigm_focus` names — never given (§12). */
  const taughtCellsOf = (item, skill) => {
    const focus = skill?.paradigm_focus;
    if (!focus || typeof focus !== 'object') return [];
    const fits = (key) => key && Object.entries(focus).every(([k, v]) => v == null || (Array.isArray(v) ? v.map(String) : [String(v)]).includes(String(key[k] ?? '')));
    return (item.chart?.cells ?? []).map((c, i) => (fits(chartCellKey(item, c)) ? (c.cellId ?? cellId(chartCellKey(item, c), item.chart?.table?.kind) ?? `#${i}`) : null)).filter(Boolean);
  };
  /** Practise only… on a table (ui.js chartInput): the choices its cells allow — both voices, both numbers. */
  const CHART_FOCUS = 'l103.chart.focus';
  /** A game's cards narrowed to Practise only… (the same choice as the tables'); nothing is dropped if it would leave none. */
  const focusCards = (cards) => {
    const f = chartFocus();
    if (f === 'all') return cards;
    const kept = cards.filter((c) => !offFocus(f, c.form ?? {}));
    if (kept.length) cards.splice(0, cards.length, ...kept);
    return cards;
  };
  /** Practise only… for a skill's games: the choices its forms allow (both voices on a verb form, both numbers). */
  const skillFocusOptions = (sk) => {
    if (!sk?.paradigms?.length) return [];
    const f = sk.paradigm_focus ?? {};
    const verb = sk.paradigms.some((t) => /^conj|^(sum|possum|eo|fero|volo)$/.test(t));
    const gendered = sk.paradigms.some((t) => /^adj|^(is|hic|ille|iste|ipse|idem|qui|quis|aliquis|quisque|quidam|unus|duo|tres)$/.test(t));
    return chartFocusOptions([...(verb && !f.voice ? [{ voice: 'act' }, { voice: 'pass' }] : []), ...(!f.number ? [{ number: 'sg' }, { number: 'pl' }] : []), ...(gendered && !f.gender ? [{ gender: 'm' }, { gender: 'f' }, { gender: 'n' }] : [])]);
  };
  const chartFocus = () => { try { return localStorage.getItem(CHART_FOCUS) || 'all'; } catch { return 'all'; } };
  const setChartFocus = (f) => { try { localStorage.setItem(CHART_FOCUS, f); } catch { /* this visit only */ } };
  // Each choice narrows one feature of a cell (2026-10-26, "do similar things for the nouns, adjectives, adverbs … all
  // study subjects"): voice for a verb, number for every table, gender for an adjective or a pronoun.
  const FOCUS_AXIS = { act: ['voice', 'act'], pass: ['voice', 'pass'], sg: ['number', 'sg'], pl: ['number', 'pl'], m: ['gender', 'm'], f: ['gender', 'f'], n: ['gender', 'n'] };
  /** Does a cell's key fall outside the focus? A key without that feature (an infinitive's number) is never left out. */
  const offFocus = (f, k) => { const ax = FOCUS_AXIS[f]; return !!ax && k?.[ax[0]] != null && k[ax[0]] !== ax[1]; };
  function chartFocusOptions(keys) {
    const has = (k, v) => keys.some((x) => x?.[k] === v);
    const out = [{ id: 'all', label: 'All' }];
    if (has('voice', 'act') && has('voice', 'pass')) out.push({ id: 'act', label: 'Active only' }, { id: 'pass', label: 'Passive only' });
    if (has('number', 'sg') && has('number', 'pl')) out.push({ id: 'sg', label: 'Singular only' }, { id: 'pl', label: 'Plural only' });
    const genders = [['m', 'Masculine only'], ['f', 'Feminine only'], ['n', 'Neuter only']].filter(([g]) => has('gender', g));
    if (genders.length > 1) out.push(...genders.map(([id, label]) => ({ id, label })));
    return out;
  }
  const scaffoldLabel = (level) => (level === 'auto' ? 'auto' : level === 'off' ? 'off' : `${level}%`);
  /**
   * The switch on the table itself (§13): auto · 80 · 50 · 20 · off, one tap,
   * no confirmation. The table on screen finishes as it started; the next one
   * drawn honours the change.
   */
  function scaffoldSwitch(tableId, { current, percent, onChange = null } = {}) {
    const seg = h('div', { class: 'g-seg g-seg--scaffold', role: 'group', 'aria-label': 'How much of the table is given' },
      SCAFFOLD_LEVELS.map((lv) => btn(scaffoldLabel(lv), { 'aria-pressed': String(lv === current), onclick: (e) => {
        setScaffold(tableId, lv);
        for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        // On a table not yet checked the change is made on it at once (2026-10-26: "when the fill-in is off and I say I
        // want to practise passive forms it still fills many of them"); after a Check it waits for the next table.
        const now = onChange?.(lv) === true;
        note.textContent = now ? (lv === 'off' ? 'A blank table.' : `${scaffoldLabel(lv)} of this table is given.`) : noteText(lv);
        ctx.say(`Given cells: ${scaffoldLabel(lv)} ${now ? 'on this table' : 'from the next table'}.`);
      } }, 'g-seg__btn')));
    const noteText = (lv) => (lv === current ? (percent > 0 ? `${percent}% of this table is given${lv === 'auto' ? ' — auto fades a level after a table right unaided' : ''}.` : 'A blank table.')
      : `From the next table: ${lv === 'auto' ? 'auto, starting at 80%' : lv === 'off' ? 'a blank table' : `${lv}% given`}. This one finishes as it started.`);
    const note = h('p', { class: 'g-quiet g-scaffold__note', text: noteText(current) });
    return h('div', { class: 'g-scaffold' }, h('span', { class: 'g-label', text: 'Given' }), seg, note);
  }

  /* ------------------------------------------------------- game mode: playing a skill */
  /**
   * ▶ Play for a skill, from a list of skills (the learner, 2026-10-19: "I don't see any place where it says
   * play for any skill or table"). A skill with forms plays its whole table as the game, word after word
   * (Word Work's whole table, started); a skill about how forms are used plays its drill in game mode. The
   * game-mode choice is the drill's own kept one, so it stays on for the next drill too.
   */
  // ▶ Play opens the next session in game mode, once: a plain Start / Drill beside it stays plain. Only the
  // session's own "▶ Game mode" switch is a kept choice (l103.game.drill).
  let playGameOnce = false;
  const gameDrillOn = () => { playGameOnce = true; keepGame(true); };
  function playSkill(id, { chapter = null, from = null, nav = null } = {}) {
    const sk = skills.get(id);
    if (!sk) return;
    const go = nav ?? ((name, params) => render(name, params));
    const n = Number(chapter ?? sk.chapter ?? ctx.currentChapter?.() ?? 1);
    // A whole table is Word Work's: from Grammar's list the header moves there with it (a chapter page's
    // router does the same, index.js go). A drill stays where it is, its way back the section it came from.
    if (sk.paradigms?.length) { if (!nav && sectionMode() !== 'words') ctx.setMode?.('words'); go('wwtable', { chapter: n, skill: id, play: true }); return; }
    gameDrillOn();
    go('drill', { skill: id, from: from ?? (sectionMode() === 'words' ? { wordwork: n } : null) });
  }
  const playable = (id) => { const sk = skills.get(id); return !!sk && !sk.set && (!!sk.paradigms?.length || drillable(id)); };
  const playLabel = (text = 'Play') => [h('span', { 'aria-hidden': 'true', text: '▶ ' }), text];
  const playTo = (id, { chapter = null } = {}) => { const sk = skills.get(id); return sk?.paradigms?.length ? ['wwtable', { chapter: Number(chapter ?? sk.chapter ?? 1), skill: id, play: true }] : ['drill', { skill: id, game: true }]; };
  /** ▶ Learn as a game: the skill's lesson, every step of it, in game mode (its explanations a box away, ? for the whole). */
  const learnGameButton = (id, { nav = null, from = null } = {}) => btn(playLabel('Learn as a game'),
    { to: ['learn', { skill: id, game: true }], onclick: () => { gameDrillOn(); (nav ?? ((name, params) => render(name, params)))('learn', { skill: id, ...(from ? { from } : {}) }); }, 'aria-label': `Learn ${skills.get(id)?.title ?? 'this skill'} as a game` }, 'btn g-play');
  const TABLE_PART_WORDS = 6;   // a skill with one table: its part of it, for this many of the chapter's words
  /**
   * ▦ Every word's table (2026-10-23: "there was no place where I could practise all of the conjugations for each
   * of these verbs … when I used the table button it did not have each of the words but only this one"): one game
   * with the skill's part of the table for one word of each table it lists — sum, possum, eō, volō, nōlō, mālō,
   * ferō; amō, moneō, regō, capiō, audiō — word after word, every person and number. The game's Charts button picks
   * fewer words. Each word played is logged as its table practised (tableGameDone). The words: the skill's own
   * (entryForKey, as its lessons use), and from the chapter's words when it lists only one table.
   */
  async function tableWords(n, sk) {
    if (!selectRules) { try { await loadParadigmCatalogue(); } catch { /* the words are found without it */ } }
    const out = [];
    const has = (e) => out.some((x) => x.h === e.h && x.pos === e.pos);
    for (const pid of sk.paradigms ?? []) {
      let e = null;
      try { e = entryForKey(pid, sk); } catch { e = null; }
      if (e && !has(e) && tableOf(e) && skillWordFits(sk, e)) out.push(e);
    }
    if (out.length < 2) for (const e of await skillWords(n, sk)) { if (out.length >= TABLE_PART_WORDS) break; if (!has(e)) out.push(e); }
    // A skill that names no forms (adjective agreement: any adjective, any case) has the whole of its tables.
    if (!out.length && wholeTables(sk)) {
      const pids = new Set(sk.paradigms);
      for (const pid of sk.paradigms) { let e = null; try { e = entryForKey(pid, sk); } catch { e = null; } if (e && !has(e) && tableOf(e)) out.push(e); }
      for (const c of items.candidates(sk.id) ?? []) {
        if (out.length >= 3) break;   // a whole table is long: three words, more from the game's Words
        const e = c.entry;
        if (e && !has(e) && tableOf(e) && selectRules && pids.has(tableIdOf(e, selectRules))) out.push(e);
      }
    }
    return out;
  }
  const coversAny = (sk, e) => { const t = tableOf(e); return !!t && (t.sections ?? []).some((s) => (s.rows ?? []).some((r) => (r.cells ?? []).some((c) => c && !c.empty && c.key && skillCovers(sk, e, c.key)))); };
  const wholeMemo = new Map();
  /** No word of any of the skill's tables has a cell it names: the skill is about the whole of them. */
  const wholeTables = (sk) => {
    if (!wholeMemo.has(sk.id)) {
      let whole = true;
      for (const pid of sk.paradigms ?? []) { let e = null; try { e = entryForKey(pid, sk); } catch { e = null; } if (e && coversAny(sk, e)) { whole = false; break; } }
      wholeMemo.set(sk.id, whole);
    }
    return wholeMemo.get(sk.id);
  };
  /** The cells of a word's table a skill's game asks: those it names, or every one when it names none. */
  const skillCell = (sk, e, key) => skillCovers(sk, e, key) || (wholeTables(sk) && (key?.degree == null || key.degree === 'pos'));   // the whole: a plain adjective's own forms
  const skillWordFits = (sk, e) => coversAny(sk, e);
  /**
   * A game over several words in order, a column at a time (2026-10-23: "unless it's on shuffle have all the active
   * first then all the passive … most important is that it keeps order and doesn't jump between active and
   * passive"): every word's active, then every word's passive; each word's own forms in its table's order. `col`
   * names the column (its part and header); columns go in the order they are first met. In place, stable.
   */
  function columnsFirst(cards) {
    const cols = new Map();
    const words = new Map();
    for (const c of cards) { if (!cols.has(c.col ?? '')) cols.set(c.col ?? '', cols.size); const w = c.entry ? `${c.entry.h}|${c.entry.pos}` : ''; if (!words.has(w)) words.set(w, words.size); }
    const at = new Map(cards.map((c, i) => [c, i]));
    const wordOf = (c) => words.get(c.entry ? `${c.entry.h}|${c.entry.pos}` : '');
    return cards.sort((a, b) => cols.get(a.col ?? '') - cols.get(b.col ?? '') || wordOf(a) - wordOf(b) || at.get(a) - at.get(b));
  }
  async function playSkillTables(id, { chapter = null, only = null, table = null } = {}) {
    const sk = skills.get(id);
    if (!sk?.paradigms?.length || sk.set) return false;
    keepEntry('tablepart');
    const n = Number(chapter ?? sk.chapter ?? ctx.currentChapter?.() ?? 1);
    const all = await tableWords(n, sk);
    if (!all.length) { ctx.say('No word with a table fits this skill.'); return false; }
    // `table`: the words of one of its tables only (the ▦ popup's one-table choice, a conjugation under a skill): every
    // model word of that table (2026-10-26: "give me a word in that conjugation just to practise that part of the
    // chart, and other words in that same conjugation that I could choose or mix"), the game's Words to pick from.
    if (table) {
      try {
        const got = await catalogueItemsOf();
        for (const w of got?.catalogue?.stock?.(table) ?? []) {
          const e = got.gen.wordEntry(w, table)?.entry ?? null;
          if (e && !all.some((x) => x.h === e.h && x.pos === e.pos) && skillWordFits(sk, e)) all.push(e);
        }
      } catch { /* the skill's own word for the table is still there */ }
    }
    const ofTable = table ? all.filter((e) => (tableIdOf(e, selectRules) ?? '') === table) : all;
    // One word to start on a single table; the rest wait in the game's Words, to choose or mix.
    const words = only ? ofTable.filter((e) => only.includes(`${e.h}|${e.pos}`)) : table ? ofTable.slice(0, 1) : ofTable;
    if (!words.length) { ctx.say('No word of that table fits this skill.'); return false; }
    const rules = new Map();
    const ruleOf = (e) => { const k = `${e.h}|${e.pos}`; if (!rules.has(k)) { let r = null; try { r = wordRule(e, tableOf(e)); } catch { r = null; } rules.set(k, r); } return rules.get(k); };
    const cards = [];
    const counts = new Map();
    for (const e of all) {
      const t = tableOf(e);
      if (!t) continue;
      const head = headOf(e);
      const playing = words.includes(e);
      (t.sections ?? []).forEach((sec, si) => (sec.rows ?? []).forEach((r) => (r.cells ?? []).forEach((c, ci) => {
        if (!c || c.empty || !c.key || !skillCell(sk, e, c.key)) return;
        const answers = cellAnswers(c);
        if (!answers.length) return;
        if (!playing) { counts.set(`${e.h}|${e.pos}`, (counts.get(`${e.h}|${e.pos}`) ?? 0) + 1); return; }
        let en = '';
        try { en = dict.cellMeaning?.(e, c.key) ?? ''; } catch { en = ''; }
        cards.push({ key: `${e.h}|${e.pos}|${si}|${r.label}|${ci}`, cue: [words.length > 1 ? wordWithType(e) : null, r.label, [sec.title, sec.headers?.[ci]].filter(Boolean).join(' ')].filter(Boolean).join(' · '), en, answers, stem: c.stem || null, ending: c.ending || null, group: `${e.h}|${e.pos}|${si}|${ci}`, col: [sec.title, sec.headers?.[ci]].filter(Boolean).join(' '), entry: e, form: c.key });
        counts.set(`${e.h}|${e.pos}`, (counts.get(`${e.h}|${e.pos}`) ?? 0) + 1);
      })));
    }
    focusCards(cards);
    if (!cards.length) { ctx.say('No word with a table fits this skill.'); return false; }
    columnsFirst(cards);
    const how = howOf(sk);
    const one = words.length === 1 ? ruleOf(words[0]) : null;
    const rule = one ? { ...focusRule(one, sk), steps: [...(how?.steps ?? []), ...(focusRule(one, sk)?.steps ?? [])] }
      : { kind: '', parts: '', type: sk.title, steps: [...(appliesTo(sk.paradigms) ? [{ head: 'For', text: `${appliesTo(sk.paradigms)}.` }] : []), ...(how?.steps ?? [])] };
    const list = (table ? ofTable : all).filter((e) => counts.has(`${e.h}|${e.pos}`) || table).map((e) => ({ id: `${e.h}|${e.pos}`, section: table ? `${tableName(table)} · words` : 'Words', col: headOf(e), n: counts.get(`${e.h}|${e.pos}`) ?? 0 }));
    playTable({ title: words.length > 1 ? `${sk.title}: every word` : String(words[0].lemma ?? words[0].h),
      subtitle: `${sk.title}: ${testedLine(cards)}`,
      items: cards, rule: rule.steps?.length ? rule : null, ruleFirst: true,
      how: (it) => { const r = ruleOf(it.entry); try { return r && it.form ? formRule(r, it.form) : r; } catch { return r; } },
      charts: list.length > 1 ? { list, on: words.map((e) => `${e.h}|${e.pos}`), play: (ids) => playSkillTables(id, { chapter: n, only: ids, table }), noun: 'word' } : null,
      countKey: [`tablepart:${id}`, ...words.map((e) => tableKey(e)).filter(Boolean)],
      suggest: gameWays({ skill: id }),
      onDone: ({ firstMiss = new Set(), shown = new Set() } = {}) => {
        for (const e of words) {
          const k = `${e.h}|${e.pos}|`;
          const mine = (set) => new Set([...set].filter((x) => String(x).startsWith(k)));
          tableGameDone(sk, e)({ firstMiss: mine(firstMiss), shown: mine(shown) });
        }
      } });
    return true;
  }
  /**
   * ▶ A mixed game, for every skill (2026-10-23: "add a mixed game for those 15 skills too … do that for all"): its mixed set
   * — the skill on every other item, between them the skills it is confused with and builds on — played in game
   * mode; the skill's own drill, every kind of question, when nothing else can be mixed in.
   */
  const playMixedGame = (id, { from = null } = {}) => {
    const sk = skills.get(id);
    if (!sk || sk.set || !drillable(id)) return;
    keepEntry('tablepart');
    gameDrillOn();
    const mix = mixedMembers(sk, skills, { chapter: ctx.currentChapter?.() ?? null, drillable }).length > 1;
    goView(mix ? 'mixed' : 'drill', { skill: id, ...(from ? { from } : {}) });
  };
  const mixedGameButton = (id, { short = false } = {}) => {
    const sk = skills.get(id);
    if (!sk || sk.set || !drillable(id)) return null;
    return btn(playLabel(short ? 'Mixed game' : 'Play a mixed game'), { onclick: () => { closeGameMenu?.(); playMixedGame(id); }, 'aria-label': `A mixed game: ${sk.title} with the skills it is confused with and builds on, every kind of question` }, 'btn g-play g-partbtn');
  };
  /** The skill's games, side by side: its tables, every word (when it has a table), and its mixed game. */
  const tablePartButton = (id, opts = {}) => [tableGameButton(id, opts), mixedGameButton(id, opts)].filter(Boolean);
  const tableGameButton = (id, { chapter = null, short = false } = {}) => {
    const sk = skills.get(id);
    if (!sk || sk.set || !sk.paradigms?.length) return null;
    const many = sk.paradigms.length > 1;
    // One table of one word (nōlō) is that word's; any other table is played over several of its words.
    const oneWord = !many && WORD_TABLES.has(sk.paradigms[0]);
    return btn([h('span', { 'aria-hidden': 'true', text: '▦ ' }), short ? (many ? `Its tables (${sk.paradigms.length})` : 'Its table') : (many ? `Play its tables: every word (${sk.paradigms.length})` : oneWord ? 'Practise its part of the table' : 'Play its table: every word'), countBadge(`tablepart:${id}`)],
      { onclick: (e) => { const b = e.currentTarget; if (b.dataset.busy) return; b.dataset.busy = '1'; playSkillTables(id, { chapter }).finally(() => { delete b.dataset.busy; }); }, 'aria-label': many ? `Play ${sk.title}: its part of the table for every word it covers, in one game, then come back here` : `Practise just the part of the table ${sk.title} covers, as a game, then come back here` }, 'btn g-play g-partbtn');
  };
  /* ------------------------------------------------------- the path (continuum.js) */
  // Every skill and table from the easiest to the hardest (2026-10-23): built once from the skills' prerequisites.
  let pathMemo = null;
  const thePath = () => (pathMemo ??= buildPath(skills));
  /** Where a skill is best met from here: a lesson still to learn, a drill once it is in the rotation. */
  /**
   * The way the learner last went into a skill — its table game, a drill, unlimited practice, its lesson, one part —
   * kept until they go in another way (2026-10-23: "for the next skill it should go to the same entry point as the
   * previous skill was set … unless changed"). Every "next skill" (What next?, the path, Too hard? Too easy?, a
   * game's end) opens the next skill the same way; the game's own way to play (Type it, shuffled …) and game mode
   * are kept already. A skill that has no such entry (no table, nothing to drill) falls back to the usual one.
   */
  const ENTRY_KEY = 'l103.grammar.entry';
  // Once changed it is the default (2026-10-23: "once changed it can be default"): kept in the synced settings
  // (settings.grammar.entry), so every device opens the next skill the same way; this device's copy stands in
  // until the settings have loaded.
  const entryKept = () => { const g = ctx.settings?.grammar?.entry; if (typeof g === 'string' && g) return g; try { return localStorage.getItem(ENTRY_KEY) || 'auto'; } catch { return 'auto'; } };
  const keepEntry = (e) => {
    if (entryKept() === e) return;
    try { localStorage.setItem(ENTRY_KEY, e); } catch { /* not kept */ }
    ctx.savePrefs?.({ entry: e });
  };
  const usualTo = (id) => (inRotation(stateOf(id)) && drillable(id) ? ['drill', { skill: id }] : ['learn', { skill: id }]);
  const skillTo = (id) => {
    const sk = skills.get(id);
    switch (entryKept()) {
      // The skill as one game: its tables, every word — or, with no table, its mixed game.
      case 'tablepart': return sk?.paradigms?.length && !sk.set ? ['lesson', { skill: id, play: true }]
        : sk && !sk.set && drillable(id) ? [mixedMembers(sk, skills, { chapter: ctx.currentChapter?.() ?? null, drillable }).length > 1 ? 'mixed' : 'drill', { skill: id }] : usualTo(id);
      case 'drill': return drillable(id) ? ['drill', { skill: id }] : ['learn', { skill: id }];
      case 'unlimited': return drillable(id) && hasBank(id) ? ['unlimited', { skill: id }] : drillable(id) ? ['drill', { skill: id }] : ['learn', { skill: id }];
      case 'learn': return ['learn', { skill: id }];
      case 'part': return sk && !sk.set ? ['part', { skill: id, step: 0 }] : usualTo(id);
      default: return usualTo(id);
    }
  };
  /** A view in its own section (Grammar or Word Work), game mode kept as it is. */
  // A lesson or a practice started from a menu comes back to that menu (2026-10-25: "bring one back to the menu
  // that was clicked on"): it is given the screen it was opened from as its `from`, unless it already has one or
  // it was opened from inside another lesson or practice (which keeps its own way back).
  const LAUNCHED = new Set(['lesson', 'learn', 'part', 'drill', 'blocked', 'unlimited', 'mixed', 'redo', 'catalogue']);
  const MENUS = new Set(['chart', 'wordwork', 'paradigms', 'stats', 'setup', 'sheets', 'today', 'course', 'catalogue', 'chapter']);
  const goView = (name, params = {}, mode = 'grammar') => {
    if (LAUNCHED.has(name) && params?.from == null && MENUS.has(view.name)) params = { ...params, from: hereFrom(params?.skill ?? null) };
    if (sectionMode() !== mode) ctx.setMode?.(mode);
    if (gameKept()) gameDrillOn();
    render(name, params);
  };
  const goSkill = (id) => { const [name, params] = skillTo(id); goView(name, params); };
  /** One skill as a link of the path: its state, its name, its chapter. */
  /** "2 days ago", "today", "3 weeks ago": when a skill was last practised. */
  const agoText = (t) => {
    if (!t) return '';
    const days = Math.floor((startOfToday() - new Date(t).setHours(0, 0, 0, 0)) / DAY_MS);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    return `${Math.round(days / 30)} months ago`;
  };
  const startOfToday = () => new Date().setHours(0, 0, 0, 0);
  /**
   * Whether a skill has been practised and how much (2026-10-23: "these things should show if they have been
   * practised and how much"), from the synced log: "×3 · 2 days ago", or "Not practised yet".
   */
  const practiceTag = (id) => {
    const l = pLog().skill(id);
    const n = Math.max(l.rounds, practised(`skill:${id}`));
    return n || l.answers
      ? h('span', { class: 'g-ptag', title: `${n} time${n === 1 ? '' : 's'} · ${l.answers} answers, ${l.right} right${l.last ? ` · last ${agoText(l.last)}` : ''}` }, h('b', { text: `×${Math.max(1, n)}` }), l.last ? ` · ${agoText(l.last)}` : '')
      : h('span', { class: 'g-ptag g-ptag--none', text: 'Not practised yet' });
  };
  const pathLink = (id, { cls = 'g-pathlink' } = {}) => {
    const sk = skills.get(id);
    if (!sk) return null;
    return navEl({ class: cls, to: skillTo(id), onclick: () => { closeGameMenu(); goSkill(id); }, 'data-area': areaOf(id) },
      h('span', { class: 'g-dot', 'data-state': stateOf(id).state, 'aria-hidden': 'true' }),
      h('span', { class: 'g-pathlink__t' }, sk.title, h('br'), practiceTag(id)),
      h('span', { class: 'g-pathlink__c', text: `Cap. ${roman(sk.chapter)}` }));
  };
  /** "Too hard? / Too easy?": what it builds on, and what builds on it — both a tap away. */
  const levelNode = (id) => {
    const p = thePath();
    const easier = p.easier(id);
    const harder = p.harder(id);
    if (!easier.length && !harder.length) return null;
    return h('div', { class: 'g-level' },
      easier.length ? h('section', { class: 'g-level__side' }, h('h3', { class: 'g-level__h', text: '😓 Too hard? Build up to it' }),
        h('p', { class: 'g-quiet', text: 'What it builds on, the nearest first.' }), h('ul', { class: 'g-level__list' }, easier.map((x) => h('li', {}, pathLink(x))))) : null,
      harder.length ? h('section', { class: 'g-level__side' }, h('h3', { class: 'g-level__h', text: '😎 Too easy? Build on it' }),
        h('p', { class: 'g-quiet', text: 'The next skills that use it.' }), h('ul', { class: 'g-level__list' }, harder.map((x) => h('li', {}, pathLink(x))))) : null);
  };
  const levelButton = (id, cls = 'btn btn--quiet g-levelbtn') => (skills.get(id) && !skills.get(id).set && levelNode(id)
    ? btn([h('span', { 'aria-hidden': 'true', text: '⇅ ' }), h('span', { class: 'g-levelbtn__t', text: 'Easier or harder skill?' })],
      { 'aria-haspopup': 'dialog', 'aria-label': `Easier or harder skill? The skills before and after ${skills.get(id).title}`, title: 'Easier or harder skill? (another skill, before or after this one)', onclick: () => openGameMenu({ skill: id, only: 'level' }) }, cls)
    : null);
  /** Climb the path: the next skills on it still to learn, one after the other (Learn's queue), from `id` or the start. */
  const climb = (id = null) => {
    const q = climbFrom(thePath(), id, (x) => !inRotation(stateOf(x)), 5);
    if (!q.length) return false;
    closeGameMenu();
    goView('learn', { skill: q[0], queue: q.slice(1) });
    return true;
  };
  const climbButton = (id = null, label = '▶ Climb the path') => {
    const q = climbFrom(thePath(), id, (x) => !inRotation(stateOf(x)), 1);
    return q.length ? btn(label, { onclick: () => climb(id), 'aria-label': `${label.replace(/^▶ /, '')}: learn the next skills on the path in order, starting with ${titleOf(q[0])}` }, 'btn btn--primary g-play') : null;
  };
  /**
   * What to do after a skill (2026-10-23: "if it's at the end it should give next suggested skills to do — related,
   * prerequisite, or next"): the next on the path, what it builds on (the ones not yet in the practice first), and
   * the skills it is most often confused with, and others taught in the same chapter. Each once, at most seven.
   */
  const suggestionsOf = (id) => {
    const sk = skills.get(id);
    if (!sk || sk.set) return [];
    const p = thePath();
    const out = [];
    const add = (x, why) => { if (x && x !== id && skills.has(x) && !skills.get(x).set && !out.some((o) => o.id === x)) out.push({ id: x, why }); };
    // The skill's own progression first (2026-10-25: "integrate these progressions into the game suggestions for
    // what is next as well as in the lesson … these include the various tables"): the next skill in its area, and
    // the area's table that comes next on the path from here.
    const a = AREAS.find((x) => x.id === areaOf(id));
    if (a) {
      const nextIn = p.order.slice(p.of(id) + 1).find((x) => areaOf(x) === a.id && !skills.get(x).set);
      add(nextIn, `Next in ${a.label}`);
      const at = p.index.get(`skill:${id}`) ?? -1;
      const tbl = p.steps.slice(at + 1).find((st) => st.kind === 'table' && a.table(st.id) && st.chapter <= sk.chapter + 1)
        ?? p.steps.slice(0, at).reverse().find((st) => st.kind === 'table' && a.table(st.id) && (sk.paradigms ?? []).includes(st.id));
      if (tbl) out.push({ table: tbl.id, why: `The ${a.label.toLowerCase()} table` });
    }
    for (const x of p.harder(id).slice(0, 2)) add(x, 'Next');
    const unmet = new Set(unmetPrereqs(sk, stateOf));
    for (const x of [...p.easier(id)].sort((a, b) => Number(unmet.has(b)) - Number(unmet.has(a))).slice(0, 2)) add(x, unmet.has(x) ? 'Builds on (not learned yet)' : 'Builds on');
    for (const x of (sk.confusable_with ?? []).slice(0, 2)) add(x, 'Related');
    // …and the chapter's other skills, related or not (2026-10-23: "suggested skills can also be unrelated skills that
    // are taught in the same chapter"): the ones still to learn first, in the path's order.
    const sameCh = p.order.filter((x) => x !== id && skills.get(x)?.chapter === sk.chapter);
    for (const x of [...sameCh.filter((x) => !inRotation(stateOf(x))), ...sameCh.filter((x) => inRotation(stateOf(x)))].slice(0, 2)) add(x, `Also in Cap. ${roman(sk.chapter)}`);
    return out.slice(0, 8);
  };
  /** The suggestions as a section of links: why, then the skill. */
  const suggestNode = (id, { heading = 'What next?' } = {}) => {
    const list = suggestionsOf(id);
    return list.length ? h('section', { class: 'g-suggest', 'aria-label': heading }, h('h2', { class: 'g-h2', text: heading }),
      h('ul', { class: 'g-level__list' }, list.map((x) => h('li', { class: 'g-suggest__i' }, h('span', { class: 'g-suggest__why', text: x.why }), x.table ? tableLink(x.table) : pathLink(x.id))))) : null;
  };
  /** The same for a game's end screen (game.js `suggest`). */
  /**
   * Just one case, across the declensions (2026-10-26: "practise next declensions 1 2 3 … OR just cases across
   * declensions"): for each case, the noun skill that asks it on the most declensions; ▦ across plays that case on
   * every one of them.
   */
  /** The table after this one among its siblings, in the course's own order (thePath); the rare variants (Greek -os,
   * decl2g6) only when nothing else follows. */
  const nextSibling = (t, sibs) => {
    const order = thePath().steps.filter((st) => st.kind === 'table').map((st) => st.id);
    const main = sibs.filter((x) => !/g\d/.test(x.id));
    const at = order.indexOf(t.id);
    const byPath = main.filter((x) => order.indexOf(x.id) > at).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))[0];
    if (at >= 0 && byPath) return byPath;
    const keys = [...(catTables?.keys?.() ?? [])];
    return main.find((x) => keys.indexOf(x.id) > keys.indexOf(t.id)) ?? null;
  };
  const CASE_NAMES = [['nom', 'Nominative'], ['gen', 'Genitive'], ['dat', 'Dative'], ['acc', 'Accusative'], ['abl', 'Ablative'], ['voc', 'Vocative']];
  const caseSkills = () => CASE_NAMES.map(([c, label]) => {
    const best = [...skills.values()].filter((x) => x.category === 'noun-case' && x.paradigm_focus?.case === c && (x.paradigms ?? []).some((t) => /^decl/.test(t)))
      .sort((a, b) => (b.paradigms?.length ?? 0) - (a.paradigms?.length ?? 0))[0];
    return best ? { c, label, id: best.id, n: best.paradigms.filter((t) => /^decl|^domus/.test(t)).length } : null;
  }).filter(Boolean);
  /** "practised ×3" or "not practised yet", for a practised.js key (skill:, tablepart:, table:, part:). */
  const timesOf = (key) => { const n = practised(key); return n ? `practised ×${n}` : 'not practised yet'; };
  /**
   * First at the end of a skill (2026-10-26: "when finished with a skill … first show the practising across
   * conjugations, then the next skills down the course order; also show how many practices have been done of all of
   * them; put these first"): ▦ across its tables, then the next three skills of its area in course order, each with
   * its count. Everything else the end screen offers follows.
   */
  const firstNextList = (id) => {
    const sk = skills.get(id);
    if (!sk || sk.set) return { across: null, next: [] };
    const a = areaOf(id);
    const order = thePath().order.filter((x) => !skills.get(x)?.set && areaOf(x) === a);
    const i = order.indexOf(id);
    return { across: sk.paradigms?.length ? { label: `▦ ${acrossLabel(sk.paradigms)}`, times: timesOf(`tablepart:${id}`) } : null, next: i < 0 ? [] : order.slice(i + 1, i + 4), area: AREAS.find((x) => x.id === a) };
  };
  function firstNextNode(id) {
    const { across, next, area } = firstNextList(id);
    if (!across && !next.length) return null;
    return h('section', { class: 'g-firstnext', 'aria-labelledby': 'g-firstnext-h' },
      h('h2', { id: 'g-firstnext-h', class: 'g-h2', text: 'Next' }),
      across ? h('div', { class: 'g-acts' }, btn([across.label, h('span', { class: 'g-firstnext__n', text: ` · ${across.times}` })], { onclick: () => startSkill(id, 'across') }, 'btn btn--primary g-play')) : null,
      area?.id === 'nouns' ? h('h3', { class: 'g-next__h', text: 'Or just one case, across the declensions' }) : null,
      area?.id === 'nouns' ? h('div', { class: 'g-chips' }, caseSkills().map((x) => btn([x.label, h('span', { class: 'g-firstnext__n', text: ` · ${timesOf(`tablepart:${x.id}`)}` })], { onclick: () => startSkill(x.id, 'across') }, 'g-chip'))) : null,
      next.length ? h('h3', { class: 'g-next__h', text: `Next in ${area?.label ?? 'the course'}, in course order` }) : null,
      next.length ? h('ol', { class: 'g-firstnext__list' }, next.map((x) => h('li', {}, h('button', { type: 'button', class: 'g-side__go', 'data-area': areaOf(x), onclick: () => goSkill(x) },
        h('b', { text: titleOf(x) }), ' ', capTag(x), h('span', { class: 'g-firstnext__n', text: ` · ${timesOf(`skill:${x}`)}` }))))) : null);
  }
  const practiceText = (id) => { const l = pLog().skill(id); const n = Math.max(l.rounds, practised(`skill:${id}`)); return n || l.answers ? `×${Math.max(1, n)}${l.last ? `, ${agoText(l.last)}` : ''}` : 'not practised yet'; };
  const tableName = (t) => catTables?.get?.(t)?.label ?? t;
  /**
   * The end of a game, with everything the side bar has (2026-10-25, for the phone): a skill's tables (across them, or
   * one), easier or harder skills, then what next; a table's same forms on its sibling conjugations or declensions,
   * and the tables before and after it. `{ head }` entries head each group (game.js).
   */
  const gameWays = ({ skill: id = null, table = null } = {}) => {
    const out = [];
    const sk = id ? skills.get(id) : null;
    // First: across its tables, then the next skills of its area in course order, each with its count (firstNextList).
    const first = id ? firstNextList(id) : { across: null, next: [] };
    if (first.across || first.next.length) {
      out.push({ head: 'Next' });
      if (first.across) out.push({ label: () => `${first.across.label} · ${timesOf(`tablepart:${id}`)}`, go: () => playSkillTables(id, { chapter: sk.chapter }) });
      for (const x of first.next) out.push({ label: () => `${titleOf(x)} (${capOf(x)}) · ${timesOf(`skill:${x}`)}`, go: () => goSkill(x) });
    }
    if (sk && !sk.set && areaOf(id) === 'nouns') {
      out.push({ head: 'Or just one case, across the declensions' });
      for (const x of caseSkills()) out.push({ label: () => `${x.label} · ${timesOf(`tablepart:${x.id}`)}`, go: () => playSkillTables(x.id, { chapter: skills.get(x.id)?.chapter }) });
    }
    if (sk && !sk.set && sk.paradigms?.length) {
      out.push({ head: 'Its tables, one at a time' });
      for (const t of sk.paradigms) out.push({ label: () => `▦ ${tableName(t)} · ${timesOf(`table:${t}`)}`, go: () => playSkillTables(id, { chapter: sk.chapter, table: t }) });
    }
    const fo = sk && !sk.set ? skillFocusOptions(sk) : [];
    if (fo.length > 1) {
      out.push({ head: 'Practise only' });
      for (const o of fo) out.push({ label: `${chartFocus() === o.id ? '✓ ' : ''}${o.label}`, go: () => { setChartFocus(o.id); playSkillTables(id, { chapter: sk.chapter }); } });
    }
    if (sk && !sk.set) {
      const p = thePath();
      const e = p.easier(id)[0];
      const hd = p.harder(id)[0];
      if (e || hd) out.push({ head: 'Easier or harder' });
      if (e) out.push({ label: `😓 Easier: ${titleOf(e)} (${capOf(e)})`, go: () => goSkill(e) });
      if (hd) out.push({ label: `😎 Harder: ${titleOf(hd)} (${capOf(hd)})`, go: () => goSkill(hd) });
    }
    const t = table ? catTables?.get?.(table) : null;
    if (t) {
      const fam = String(t.id).replace(/\d.*$/, '');
      const ofFam = fam.length > 2 ? [...catTables.values()].filter((x) => x.id !== t.id && x.part === t.part && String(x.id).replace(/\d.*$/, '') === fam) : [];
      const sibs = (ofFam.length ? ofFam : [...catTables.values()].filter((x) => x.id !== t.id && x.part === t.part)).slice(0, 10);
      const kind = fam === 'conj' ? 'conjugation' : fam === 'decl' ? 'declension' : fam === 'adj' ? 'adjective type' : t.part === 'pronoun' ? 'pronoun' : t.part === 'numeral' ? 'numeral' : t.part === 'noun' ? 'noun' : 'table';
      const nextSib = nextSibling(t, sibs);
      if (nextSib) out.unshift({ head: `The next ${kind}` }, { label: () => `▶ ${nextSib.label} · ${timesOf(`table:${nextSib.id}`)}`, go: () => goTable(nextSib.id) });
      if (t.part === 'noun') { out.push({ head: 'Just one case, across the declensions' }); for (const x of caseSkills()) out.push({ label: () => `${x.label} · ${timesOf(`tablepart:${x.id}`)}`, go: () => playSkillTables(x.id, { chapter: skills.get(x.id)?.chapter }) }); }
      if (sibs.length) { out.push({ head: `The same forms, another ${kind}` }); for (const x of sibs) out.push({ label: () => `▦ ${x.label} · ${timesOf(`table:${x.id}`)}`, go: () => goTable(x.id) }); }
      const steps = thePath().steps.filter((st) => st.kind === 'table' && tableArea(st.id) === tableArea(t.id) && catTables.has(st.id));
      const at = steps.findIndex((st) => st.id === t.id);
      const easier = at > 0 ? steps[at - 1].id : null;
      const harder = at >= 0 && at + 1 < steps.length ? steps[at + 1].id : null;
      if (easier || harder) out.push({ head: 'Easier or harder table' });
      if (easier) out.push({ label: `😓 ${catTables.get(easier).label}`, go: () => goTable(easier) });
      if (harder) out.push({ label: `😎 ${catTables.get(harder).label}`, go: () => goTable(harder) });
    }
    const next = id ? gameSuggest(id) : [];
    if (next.length) out.push({ head: 'What next' }, ...next);
    return out;
  };
  const gameSuggest = (id) => suggestionsOf(id).map((x) => (x.table
    ? { label: `${x.why}: ${tableName(x.table)} (${practised(`table:${x.table}`) ? `×${practised(`table:${x.table}`)}` : 'not practised yet'}) →`, go: () => goTable(x.table) }
    : { label: `${x.why}: ${titleOf(x.id)} (${practiceText(x.id)}) →`, go: () => goSkill(x.id) }));
  /** Where a skill is in its area's progression: the one before, its place, the one after, and the whole chart. */
  const areaNav = (id) => {
    const a = AREAS.find((x) => x.id === areaOf(id));
    if (!a) return null;
    const list = thePath().order.filter((x) => areaOf(x) === a.id && !skills.get(x).set);
    const i = list.indexOf(id);
    if (i < 0) return null;
    const link = (x, text) => navEl({ class: 'g-link', to: ['learn', { skill: x }], onclick: () => { closeGameMenu(); goView('learn', { skill: x }); } }, text, ' ', capTag(x));
    return h('p', { class: 'g-areanav', 'data-area': a.id },
      areaTag(id), `${a.label} progression · ${i + 1} of ${list.length}`,
      i > 0 ? [' · ', link(list[i - 1], `← ${titleOf(list[i - 1])}`)] : null,
      i + 1 < list.length ? [' · ', link(list[i + 1], `${titleOf(list[i + 1])} →`)] : null,
      ' · ', navEl({ class: 'g-link', to: ['course', { by: 'area', area: a.id, at: id }], onclick: () => { closeGameMenu(); render('course', { by: 'area', area: a.id, at: id }); } }, 'the whole chart'));
  };
  /** A table as a suggestion: its name, its area's colour, how often it has been practised. */
  const tableLink = (t) => navEl({ class: 'g-pathlink', to: tableTo(t), onclick: () => goTable(t), 'data-area': tableArea(t) },
    h('span', { class: 'g-path__n g-pathlink__tbl', 'aria-hidden': 'true', text: '▦' }),
    h('span', { class: 'g-pathlink__t' }, `The table: ${tableName(t)}`, h('br'), practised(`table:${t}`) ? h('span', { class: 'g-ptag' }, h('b', { text: `×${practised(`table:${t}`)}` })) : h('span', { class: 'g-ptag g-ptag--none', text: 'Not practised yet' })),
    h('span', { class: 'g-pathlink__c', text: 'Table' }));
  /** After a skill: the next one on the path, as the thing to press. */
  const nextOnPath = (id) => { const nx = thePath().harder(id)[0] ?? thePath().next(id); return nx ? btn(`Next on the path: ${titleOf(nx)} →`, { to: skillTo(nx), onclick: () => goSkill(nx) }, 'btn g-play') : null; };

  /* ------------------------------------------------------- Study: Today, Course, Find (docs/SIMPLIFY-PLAN.md §3) */
  let partTitlesP = null;
  const partTitles = () => (partTitlesP ??= loadPartTitles().catch(() => ({})));
  /** A lesson's parts as numbers on a row, each opening that part on its own; titles on hover and for screen readers. */
  /**
   * A lesson's parts on a row (2026-10-25: "allow one to directly go just to that part and produce a card that tells
   * the title of that part; also have just Lesson and list the whole sequence of parts in a popup"): 📖 Lesson opens
   * the list of every part, in order; each number goes straight to its part and shows the part's title on a card.
   */
  const partNums = (id, titles) => (titles?.length ? h('span', { class: 'g-plinks g-plinks--row' },
    btn([h('span', { 'aria-hidden': 'true', text: '📖 ' }), 'Lesson ▾'], { 'aria-haspopup': 'dialog', 'aria-label': `The lesson: all ${titles.length} parts of ${titleOf(id)}`, onclick: () => openPartsMenu(id, titles) }, 'g-vlink g-partsbtn'),
    titles.map((t, i) => navEl({ class: 'g-plink g-plink--n', to: ['part', { skill: id, step: i }], onclick: () => startSkill(id, 'part', { step: i }), 'aria-label': `Part ${i + 1}: ${t}` },
      String(i + 1), h('span', { class: 'g-plink__card', 'aria-hidden': 'true' }, h('b', { text: `Part ${i + 1} of ${titles.length}` }), h('br'), t), countBadge(`part:${id}:${i}`)))) : null);
  /**
   * The lessons a table is in (2026-10-25: "when it speaks of 15 skills and 34 skills what is it referencing?"): the
   * ones that teach a piece of it (its forms) apart from the ones that only use forms already taught (syntax, uses).
   */
  const USE_CATS = new Set(['verb-use', 'syntax', 'metre']);
  const lessonsOfTable = (t) => {
    const ids = (t?.skills ?? []).filter((x) => skills.has(x) && !skills.get(x).set);
    const byBook = (a, b) => (Number(skills.get(a).chapter) || 99) - (Number(skills.get(b).chapter) || 99);
    return { taught: ids.filter((x) => !USE_CATS.has(skills.get(x).category)).sort(byBook), used: ids.filter((x) => USE_CATS.has(skills.get(x).category)).sort(byBook) };
  };
  const lessonsText = (t) => { const { taught, used } = lessonsOfTable(t); return [taught.length ? `taught in ${taught.length} lesson${taught.length === 1 ? '' : 's'}` : '', used.length ? `${taught.length ? 'used in ' : 'used in '}${used.length}${taught.length ? ' more' : ` lesson${used.length === 1 ? '' : 's'}`}` : ''].filter(Boolean).join(' · '); };
  const lessonsLink = (t) => (lessonsText(t) ? btn(`${lessonsText(t)} ▾`, { 'aria-haspopup': 'dialog', 'aria-label': `The lessons ${t.label} is in: ${lessonsText(t)}`, onclick: () => openTableLessons(t) }, 'g-vlink g-partsbtn g-tlessons') : null);
  /** A table's lessons in a popup, in book order, each with its chapter: the ones that teach its forms, then the ones that use them. */
  function openTableLessons(t) {
    const { taught, used } = lessonsOfTable(t);
    const d = h('dialog', { class: 'g-pmenu', 'aria-labelledby': 'g-pmenu-h' });
    const row = (x) => h('li', {}, navEl({ class: 'g-pmenu__part', to: ['lesson', { skill: x }], onclick: () => { d.close(); goView('lesson', { skill: x }); } },
      h('span', { class: 'g-pmenu__n g-pmenu__cap', text: capOf(x).replace('Cap. ', '') }), h('span', { class: 'g-pmenu__t', text: titleOf(x) })));
    d.append(...[
      h('div', { class: 'g-pmenu__top' }, h('p', { class: 'g-kicker', text: 'The lessons this table is in · by chapter of the book' }), btn('×', { 'aria-label': 'Close', onclick: () => d.close() }, 'g-pop__close g-pmenu__close')),
      h('h2', { id: 'g-pmenu-h', class: 'g-pmenu__h', text: t.label }),
      taught.length ? [h('h3', { class: 'g-pmenu__sh', text: `Teach a piece of it (${taught.length})` }), h('ol', { class: 'g-pmenu__list' }, taught.map(row))] : null,
      used.length ? [h('h3', { class: 'g-pmenu__sh', text: `Use its forms (${used.length})` }), h('p', { class: 'g-quiet', text: 'These add no new forms: they practise what the forms do in a sentence.' }), h('ol', { class: 'g-pmenu__list' }, used.map(row))] : null].flat().filter(Boolean));   // `append` prints an array as text
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    document.body.append(d);
    d.showModal();
    d.querySelector('.g-pmenu__part')?.focus();
  }
  /**
   * **The side bar** on a wide screen (2026-10-25: "on a large screen these can just sit fully opened on the side in a
   * collapsible side bar … including the end-of-table stuff: across conjugations, narrowed practice, and easier/harder
   * progression steps; but they should also all show up at the bottom as well"). Beside a practice of a skill or a
   * table: its tables (across them, or one), Practise only…, Keep going (another word, another conjugation, easier,
   * harder), easier or harder skills, related skills and the lesson's parts. Hidden under 900 px (a phone, a tablet upright), where the
   * popups and the end screen carry the same things. Collapsed or open is remembered on this device.
   */
  const SIDE_KEY = 'l103.side.open';
  const sideOpen = () => { try { return localStorage.getItem(SIDE_KEY) !== '0'; } catch { return true; } };
  // Which side it sits on (2026-10-25: "have the more ways side bar movable and open on the left side by default").
  const SIDE_AT = 'l103.side.at';
  const sideAt = () => { try { return localStorage.getItem(SIDE_AT) === 'right' ? 'right' : 'left'; } catch { return 'left'; } };
  function paintSide() {
    // Redrawn with every view, so it keeps its place (2026-10-25: "it's jerking the bar to other places when I click
    // to open or close something"): the bar's own scroll and each list's are put back as they were; a list is only
    // centred on its marked row when that row is new to it.
    const prev = document.querySelector('.g-side');
    const keep = { top: prev?.scrollTop ?? 0, lists: new Map([...(prev?.querySelectorAll('[data-keep]') ?? [])].map((x) => [x.dataset.keep, { top: x.scrollTop, here: x.dataset.here ?? '' }])) };
    prev?.remove();
    document.documentElement.classList.remove('g-side-on', 'g-side-left', 'g-side-right');
    if (!showing() || !ctx.items) return;
    const name = view.name;
    const pr = view.params ?? {};
    const table = name === 'catalogue' ? pr.table ?? null : name === 'summary' ? pr.catalogue ?? null : null;
    const sid = ['drill', 'learn', 'part', 'unlimited', 'mixed', 'blocked', 'lesson'].includes(name) ? pr.skill : name === 'summary' ? pr.drill : null;
    const sk = sid && skills.get(sid) && !skills.get(sid).set ? skills.get(sid) : null;
    // An accordion (2026-10-25: "when one part of the side bar opens it opens further down other options … so it's easy
    // to use"): each section a heading that opens its options under it. What is about this page starts open, the rest
    // (Now, This chapter) starts closed; each choice is remembered on this device by the section's kind.
    const secOpen = (key, dflt) => { try { const v = localStorage.getItem(`l103.side.sec.${key}`); return v == null ? dflt : v === '1'; } catch { return dflt; } };
    const sec = (title, ...kids) => {
      const k = kids.flat(Infinity).filter(Boolean);
      if (!k.length) return null;
      const key = title.replace(/\s*[·,(].*$/, '').toLowerCase().replace(/[^a-z]+/g, '-');
      const general = /^(now|this-chapter)/.test(key);
      const d = h('details', { class: 'g-side__sec', open: secOpen(key, !general) || null, ontoggle: (e) => { try { localStorage.setItem(`l103.side.sec.${key}`, e.currentTarget.open ? '1' : '0'); } catch { /* this visit only */ } } },
        h('summary', { class: 'g-side__sum' }, h('span', { text: title })), h('div', { class: 'g-side__body' }, k));
      return d;
    };
    const parts = contextSections(sk, table, sec, pr);
    if (name === 'catalogue' && tableChooser?.table === table) parts.unshift(sec('Choose what to practise', tableChooser.node()));
    const ctxCount = parts.length;
    // Every page of Study (2026-10-25: "add a side bar to all the study section; the goal is that one does not need to
    // leave the page to get exactly what one wants or needs"): Find, what to do now, and this chapter.
    const nextUp = climbFrom(thePath(), null, (x) => !inRotation(stateOf(x)) && !skills.get(x)?.set, 1)[0] ?? null;
    parts.push(sec('Now',
      nextUp ? btn(playLabel(`Next to learn: ${titleOf(nextUp)}`), { onclick: () => startSkill(nextUp, 'learn') }, 'btn btn--primary g-side__btn') : null,
      h('ul', { class: 'g-side__list' },
        h('li', {}, h('button', { type: 'button', class: 'g-side__go', 'aria-haspopup': 'dialog', onclick: () => openReview() }, `🔁 Review${reviewItems().n ? ` (${reviewItems().retests.length + reviewItems().due.length})` : ''}`)),
        h('li', {}, h('button', { type: 'button', class: 'g-side__go', onclick: () => goView('setup', {}) }, 'Mixed practice')),
        h('li', {}, h('button', { type: 'button', class: 'g-side__go', onclick: () => goView('session', { chapter: ctx.currentChapter?.() ?? 1 }) }, `Practise this chapter (Cap. ${roman(ctx.currentChapter?.() ?? 1)})`)),
        h('li', {}, h('button', { type: 'button', class: 'g-side__go', onclick: () => goView('chart', {}) }, 'Practice chart: what is still to do')))));
    const n = Number(ctx.currentChapter?.() ?? 1);
    const chIds = thePath().order.filter((x) => Number(skills.get(x)?.chapter) === n && !skills.get(x)?.set);
    const chTables = thePath().steps.filter((st) => st.kind === 'table' && Number(st.chapter) === n);
    parts.push(sec(`This chapter · Cap. ${roman(n)}`,
      h('ul', { class: 'g-side__list' },
        chIds.map((x) => h('li', {}, h('button', { type: 'button', class: 'g-side__go', 'data-area': areaOf(x), onclick: () => goView('lesson', { skill: x }) }, h('span', { class: 'g-dot', 'data-state': stateOf(x).state, 'aria-hidden': 'true' }), ' ', titleOf(x)))),
        chTables.map((st) => h('li', {}, h('button', { type: 'button', class: 'g-side__go', 'data-area': tableArea(st.id), onclick: () => goTable(st.id) }, `▦ ${tableName(st.id)}`)))),
      h('p', {}, btn('The whole chapter →', { onclick: () => render('chapter', { chapter: n }) }, 'g-vlink'))));
    const kids = [...parts.slice(0, ctxCount), ...progressionSections(sk, table, sec, nextUp), ...parts.slice(ctxCount)].filter(Boolean);
    if (!kids.length) return;
    const open = sideOpen();
    let at = sideAt();
    const aside = h('aside', { class: `g-side g-side--${at}${open ? '' : ' is-collapsed'}`, 'aria-label': 'More ways' });
    const hideText = () => (at === 'left' ? '‹ Hide' : 'Hide ›');
    const showText = () => (at === 'left' ? 'More ways ›' : '‹ More ways');
    const toggle = btn(open ? hideText() : showText(), { 'aria-expanded': String(open), onclick: () => {
      const now = aside.classList.toggle('is-collapsed');
      try { localStorage.setItem(SIDE_KEY, now ? '0' : '1'); } catch { /* this visit only */ }
      toggle.textContent = now ? showText() : hideText();
      toggle.setAttribute('aria-expanded', String(!now));
      document.documentElement.classList.toggle('g-side-on', !now);
    } }, 'g-side__toggle');
    const here = sk ? `${capOf(sk.id)} · ${sk.title}` : table ? catTables?.get?.(table)?.label ?? '' : '';
    // ⇄ moves it to the other side of the page, and the page column moves out of its way.
    const move = btn('⇄', { title: 'Move to the other side', 'aria-label': 'Move the side bar to the other side of the page', onclick: () => {
      at = at === 'left' ? 'right' : 'left';
      try { localStorage.setItem(SIDE_AT, at); } catch { /* this visit only */ }
      aside.classList.toggle('g-side--left', at === 'left'); aside.classList.toggle('g-side--right', at === 'right');
      document.documentElement.classList.toggle('g-side-left', at === 'left'); document.documentElement.classList.toggle('g-side-right', at === 'right');
      toggle.textContent = aside.classList.contains('is-collapsed') ? showText() : hideText();
      const bar = aside.querySelector('.g-side__bar'); if (bar) bar.replaceChildren(...(at === 'left' ? [toggle, move] : [move, toggle]));
    } }, 'g-side__toggle g-side__move');
    aside.append(h('div', { class: 'g-side__bar' }, at === 'left' ? [toggle, move] : [move, toggle]), h('div', { class: 'g-side__in' }, sideFind(), here ? h('p', { class: 'g-kicker g-side__here', text: here }) : null, kids));
    (root ?? document.body).append(aside);
    aside.scrollTop = keep.top;
    for (const x of aside.querySelectorAll('[data-keep]')) {
      const was = keep.lists.get(x.dataset.keep);
      if (was && was.here === (x.dataset.here ?? '')) x.scrollTop = was.top;
      else { const at = x.querySelector('.is-here'); if (at) x.scrollTop = at.offsetTop - x.clientHeight / 2; }
    }
    document.documentElement.classList.toggle('g-side-on', open);
    document.documentElement.classList.add(`g-side-${at}`);
  }
  /**
   * The progression, always in sight (2026-10-25: "see the progression always, within a strand, OR if in lesson view
   * the lesson progression"): the lesson's parts while in a lesson, the part on screen marked; and the strand — the
   * area's skills and tables from easiest to hardest — with this skill or table marked and scrolled to.
   */
  function progressionSections(sk, table, sec, nextUp = null) {
    const out = [];
    const pr = view.params ?? {};
    if (sk && ['lesson', 'learn', 'part'].includes(view.name)) {
      const here = view.name === 'part' ? Number(pr.step) || 0 : null;
      const ol = h('ol', { class: 'g-side__list g-side__steps', 'data-keep': `steps:${sk.id}`, 'data-here': String(here ?? '') }, h('li', { class: 'g-quiet', text: 'Loading the parts…' }));
      lessonOf(sk.id).then((lesson) => {
        ol.replaceChildren(...stepsOf(lesson).map((st, j) => h('li', {}, h('button', { type: 'button', class: `g-side__go${j === here ? ' is-here' : ''}`, 'aria-current': j === here ? 'step' : null, onclick: () => goView('part', { skill: sk.id, step: j }) },
          h('b', { text: `${j + 1}. ` }), stepTitle(st, j), ' ', countBadge(`part:${sk.id}:${j}`)))));
      }).catch(() => ol.replaceChildren(h('li', { class: 'g-quiet', text: 'The parts could not be loaded.' })));
      out.push(sec('The lesson, part by part', ol, btn('📖 The whole lesson, from the start', { onclick: () => startSkill(sk.id, 'learn') }, 'g-vlink')));
    }
    const areaId = sk ? areaOf(sk.id) : table ? tableArea(table) : (view.name === 'course' && view.params?.area) || (nextUp ? areaOf(nextUp) : 'verbs');
    const a = AREAS.find((x) => x.id === areaId);
    if (a) {
      const steps = thePath().steps.filter((st) => (st.kind === 'skill' ? areaOf(st.id) === a.id && !skills.get(st.id)?.set : st.kind === 'table' && a.table(st.id)));
      let n = 0;
      const ol = h('ol', { class: 'g-side__list g-side__strand', 'data-area': a.id, 'data-keep': `strand:${a.id}`, 'data-here': sk?.id ?? table ?? '' }, steps.map((st) => {
        const here = st.id === sk?.id || st.id === table;
        const isTable = st.kind === 'table';
        return h('li', {}, h('button', { type: 'button', class: `g-side__go${here ? ' is-here' : ''}`, 'aria-current': here ? 'true' : null, 'data-area': a.id,
          onclick: () => (isTable ? goTable(st.id) : goView('lesson', { skill: st.id })) },
          isTable ? `▦ ${tableName(st.id)}` : [h('span', { class: 'g-dot', 'data-state': stateOf(st.id).state, 'aria-hidden': 'true' }), ` ${++n}. ${titleOf(st.id)}`]));
      }));
      // Scrolled inside the list only (paintSide), never with scrollIntoView, which would move the page under it as well.
      if (!document.querySelector('.g-side')) requestAnimationFrame(() => { const at = ol.querySelector('.is-here'); if (at) ol.scrollTop = at.offsetTop - ol.clientHeight / 2; });
      out.push(sec(`${a.label}, easiest to hardest`, ol, h('p', {}, btn(`All of ${a.label} →`, { onclick: () => render('course', { by: 'area', area: a.id, ...(sk ? { at: sk.id } : {}) }) }, 'g-vlink'))));
    }
    return out;
  }
  /** What belongs to this skill or table, as sections (`sec` makes each): the side bar's, and the end screens' too. */
  function contextSections(sk, table, sec, pr = {}, { keepGoing = true } = {}) {
    const parts = [];
    if (table) {
      // Practise only…: the chart's own switch, pressed from here; with no table on screen it is kept for the next one.
      const t = catTables?.get?.(table);
      const hasVoice = /^conj|^(sum|possum|eo|fero|volo)$/.test(table);
      const gendered = t?.part === 'adjective' || t?.part === 'pronoun' || t?.part === 'numeral';
      const shown = chartFocusOptions([...(hasVoice ? [{ voice: 'act' }, { voice: 'pass' }] : []), { number: 'sg' }, { number: 'pl' }, ...(gendered ? [{ gender: 'm' }, { gender: 'f' }, { gender: 'n' }] : [])]);
      if (shown.length > 1) parts.push(sec('Practise only', h('div', { class: 'g-chips' }, shown.map((o) => btn(o.label, { 'aria-pressed': String(chartFocus() === o.id), onclick: (e) => {
        const there = [...document.querySelectorAll('.g-focus .g-seg__btn')].find((b) => b.textContent === o.label);
        if (there) there.click(); else setChartFocus(o.id);
        for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
      } }, 'g-chip')))));
      const next = tableNextNode(table, { group: catState.group.get(table) ?? pr.group ?? null, word: catState.word.get(table)?.h ?? pr.word ?? null, from: pr.from ?? null });
      // A second level (2026-10-25: "when something is pressed it … opens up the second or third level of options"):
      // each way on is its own fold under Keep going, the first one open.
      if (next && keepGoing) parts.push(sec('Keep going', [...next.querySelectorAll('.g-next__row')].map((row, i) => {
        const head = row.querySelector('.g-next__h');
        const title = head?.textContent ?? '';
        head?.remove();
        return h('details', { class: 'g-side__sub', open: i === 0 || null }, h('summary', { class: 'g-side__sum', text: title }), row);
      })));
    }
    if (sk && !table) {
      const fo = skillFocusOptions(sk);
      if (fo.length > 1) parts.push(sec('Practise only', h('div', { class: 'g-chips' }, fo.map((o) => btn(o.label, { 'aria-pressed': String(chartFocus() === o.id), onclick: (e) => {
        const there = [...document.querySelectorAll('.g-focus .g-seg__btn')].find((b) => b.textContent === o.label);
        if (there) there.click(); else setChartFocus(o.id);
        for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
      } }, 'g-chip'))), h('p', { class: 'g-quiet', text: 'For its tables and games, from the next one.' })));
    }
    if (sk) {
      if (sk.paradigms?.length) parts.push(sec('Its tables',
        sk.paradigms.length > 1 ? btn(`▦ ${acrossLabel(sk.paradigms)}`, { onclick: () => playSkillTables(sk.id, { chapter: sk.chapter }) }, 'btn btn--primary g-side__btn') : null,
        h('ul', { class: 'g-side__list' }, sk.paradigms.map((x) => h('li', {}, h('button', { type: 'button', class: 'g-side__go', 'data-area': tableArea(x), onclick: () => playSkillTables(sk.id, { chapter: sk.chapter, table: x }) }, `▦ ${tableName(x)}`))))));
      parts.push(sec('Easier or harder', levelNode(sk.id)));
      parts.push(sec('Related', relatedNode(sk.id)));
      if (!['lesson', 'learn', 'part'].includes(view.name)) parts.push(sec('The lesson', btn('📖 All its parts', { 'aria-haspopup': 'dialog', onclick: async () => { const lesson = await lessonOf(sk.id); openPartsMenu(sk.id, stepsOf(lesson).map((st, j) => stepTitle(st, j))); } }, 'btn btn--quiet g-side__btn')));
    }
    return parts;
  }
  /** Find, in the side bar: the same search as Today's, its first matches as one-tap links. */
  function sideFind() {
    const out = h('ul', { class: 'g-side__list' });
    const input = h('input', { type: 'search', class: 'g-input g-side__find', placeholder: 'e.g. future passive verb', 'aria-label': 'Find a skill or a table', autocomplete: 'off', spellcheck: 'false' });
    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (!q) { out.replaceChildren(); return; }
      const m = findMatches(q);
      out.replaceChildren(
        ...m.skills.slice(0, 8).map((x) => h('li', {}, h('button', { type: 'button', class: 'g-side__go', 'data-area': areaOf(x), onclick: () => goView('lesson', { skill: x }) }, titleOf(x), ' ', capTag(x)))),
        ...m.tables.slice(0, 4).map((t) => h('li', {}, h('button', { type: 'button', class: 'g-side__go', 'data-area': tableArea(t), onclick: () => goTable(t) }, `▦ ${tableName(t)}`))),
        ...(m.skills.length + m.tables.length ? [] : [h('li', { class: 'g-quiet', text: m.also.length ? `Only mentioned in ${m.also.length}; see Today's Find.` : 'Nothing matches.' })]));
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') out.querySelector('button')?.click(); });
    return h('div', { class: 'g-side__findbox' }, input, out);
  }
  /** The whole lesson in a popup: the skill, its chapter, the lesson from the start, then each part by its title. */
  function openPartsMenu(id, titles) {
    const sk = skills.get(id);
    if (!sk) return;
    const d = h('dialog', { class: 'g-pmenu', 'aria-labelledby': 'g-pmenu-h' });
    const go = (fn) => () => { d.close(); fn(); };
    d.append(
      h('div', { class: 'g-pmenu__top' }, h('p', { class: 'g-kicker', text: `${capOf(id) ? `${capOf(id)} · ` : ''}the lesson, part by part` }),
        btn('×', { 'aria-label': 'Close', onclick: () => d.close() }, 'g-pop__close g-pmenu__close')),
      h('h2', { id: 'g-pmenu-h', class: 'g-pmenu__h', text: sk.title }),
      h('p', { class: 'g-acts' }, btn('📖 The whole lesson, from the start', { onclick: go(() => startSkill(id, 'learn')) }, 'btn btn--primary')),
      h('ol', { class: 'g-pmenu__list' }, titles.map((t, i) => h('li', {},
        navEl({ class: 'g-pmenu__part', to: ['part', { skill: id, step: i }], onclick: go(() => startSkill(id, 'part', { step: i })) },
          h('span', { class: 'g-pmenu__n', text: String(i + 1) }), h('span', { class: 'g-pmenu__t', text: t }), countBadge(`part:${id}:${i}`))))));
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });   // a tap outside the card closes it
    document.body.append(d);
    d.showModal();
    d.querySelector('.g-pmenu__part')?.focus();
  }
  /** A skill as a Course row: what it is, how much it is practised, one main button, the other ways in beside it. */
  function courseRow(id, n, titles = null) {
    const sk = skills.get(id);
    if (!sk) return null;
    const st = stateOf(id);
    if (sk.set) {
      return h('li', { class: 'g-path__s g-crow g-crow--set', id: `g-path-${id}`, 'data-state': st.state },
        h('span', { class: 'g-path__n', 'aria-hidden': 'true', text: '·' }),
        h('div', { class: 'g-path__main' }, h('p', { class: 'g-path__t' }, h('span', { class: 'g-dot', 'data-state': st.state, 'aria-hidden': 'true' }), navEl({ class: 'g-link', to: ['lesson', { skill: id }], onclick: () => goView('lesson', { skill: id }) }, sk.title), ' ', practiceTag(id))),
        h('div', { class: 'g-path__acts' }, mainButton(id, { cls: 'btn g-play' })));
    }
    return h('li', { class: 'g-path__s g-crow', id: `g-path-${id}`, 'data-state': st.state, 'data-area': areaOf(id) },
      h('span', { class: 'g-path__n', text: String(n ?? '') }),
      h('div', { class: 'g-path__main' },
        h('p', { class: 'g-path__t' }, areaTag(id), h('span', { class: 'g-dot', 'data-state': st.state, 'aria-hidden': 'true' }),
          navEl({ class: 'g-link', to: ['lesson', { skill: id }], onclick: () => goView('lesson', { skill: id }) }, sk.title), ' ', capTag(id), ' ', practiceTag(id)),
        h('div', { class: 'g-crow__ways' }, verbLinks(id, { level: false }), partNums(id, titles?.[id])),
        tableLinks(id)),
      h('div', { class: 'g-path__acts' }, mainButton(id, { cls: 'btn btn--primary g-play' })));
  }
  /** A table as a Course row, where its first forms are taught. */
  const courseTableRow = (st, tables) => {
    const t = tables?.get?.(st.id) ?? catTables?.get?.(st.id);
    return h('li', { class: 'g-path__s g-path__s--table', id: `g-path-t-${st.id}`, 'data-area': tableArea(st.id) },
      h('span', { class: 'g-path__n', 'aria-hidden': 'true', text: '▦' }),
      h('div', { class: 'g-path__main' }, h('p', { class: 'g-path__t' }, areaTag(st.id, { table: true }), 'The table: ', navEl({ class: 'g-link', to: tableTo(st.id, `t-${st.id}`), onclick: () => goTable(st.id, `t-${st.id}`) }, t?.label ?? st.id), t?.example ? h('span', { class: 'g-quiet', lang: 'la', text: ` · ${t.example}` }) : null, countBadge(`table:${st.id}`))),
      h('div', { class: 'g-path__acts' }, btn(gameKept() ? playLabel('Practise') : 'Practise', { to: tableTo(st.id, `t-${st.id}`), onclick: () => goTable(st.id, `t-${st.id}`) }, 'btn g-play')));
  };
  /**
   * **Find a skill or a table** (§3.2): skills by their English or Latin name, what they are about, an ending
   * ("-bam"); tables by name or model word — macrons and case ignored. The matches are ordinary rows.
   */
  const fold = (x) => stripMacrons(String(x ?? '')).toLowerCase();
  /**
   * A skill's grammar as words a search can name (2026-10-25: "search any skill combination like passive future verb
   * and get all skill lessons that meet that"): its tense, mood, voice, case, number, declension, degree and part of
   * speech, from the features it practises (paradigm_focus / parse_filter), plus its kind and area.
   */
  const FEATURE_WORDS = {
    tense: { pres: 'present', impf: 'imperfect', fut: 'future', perf: 'perfect', plupf: 'pluperfect', futperf: 'future-perfect futureperfect' },
    mood: { ind: 'indicative', imper: 'imperative command', inf: 'infinitive', ptc: 'participle', supine: 'supine', gerund: 'gerund', subj: 'subjunctive', gerundive: 'gerundive' },
    voice: { act: 'active', pass: 'passive' },
    case: { nom: 'nominative', gen: 'genitive', acc: 'accusative', voc: 'vocative', abl: 'ablative', dat: 'dative' },
    pos: { N: 'noun', ADJ: 'adjective', V: 'verb', PRON: 'pronoun', ADV: 'adverb' },
    degree: { comp: 'comparative', super: 'superlative' },
    decl: { 1: '1st first declension', 2: '2nd second declension', 3: '3rd third declension', 4: '4th fourth declension', 5: '5th fifth declension' },
    gender: { m: 'masculine', f: 'feminine', n: 'neuter', c: 'common' },
  };
  const CATEGORY_WORDS = { 'verb-form': 'verb form', 'verb-use': 'verb use', 'noun-case': 'noun case', adjective: 'adjective', pronoun: 'pronoun', syntax: 'syntax sentence', metre: 'metre meter poetry', vocabulary: 'vocabulary' };
  const tagsCache = new Map();
  function skillTags(s) {
    if (tagsCache.has(s.id)) return tagsCache.get(s.id);
    const out = [CATEGORY_WORDS[s.category] ?? ''];
    for (const f of [s.paradigm_focus, s.parse_filter, s.feature]) {
      if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
      for (const [k, v] of Object.entries(f)) for (const x of [v].flat()) { const w = FEATURE_WORDS[k]?.[x]; if (w) out.push(w); }
      if (f.deponent) out.push('deponent');
    }
    const t = fold(out.join(' '));
    tagsCache.set(s.id, t);
    return t;
  }
  /** One search word as it is matched: folded, a plural's -s dropped ("verbs", "passives"), a few short forms widened. */
  const SEARCH_ALIAS = { fut: 'future', pres: 'present', impf: 'imperfect', perf: 'perfect', plupf: 'pluperfect', subj: 'subjunctive', pass: 'passive', act: 'active', abl: 'ablative', acc: 'accusative', gen: 'genitive', dat: 'dative', nom: 'nominative', meter: 'metre' };
  const searchWord = (w) => { const a = SEARCH_ALIAS[w] ?? w; return a.length > 4 && a.endsWith('s') && !a.endsWith('ss') && !a.endsWith('us') ? a.slice(0, -1) : a; };
  function findMatches(q) {
    const words = fold(q).split(/[\s,+]+/).filter(Boolean).map(searchWord);
    if (!words.length) return { skills: [], tables: [] };
    // Whole words, or the start of one: "perfect" is not found inside "imperfect", "abl" still finds "ablative".
    const res = words.map((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    const has = (text, i) => (/^[a-z]/.test(words[i]) ? res[i].test(text) : text.includes(words[i]));   // an ending ("-bam") anywhere
    const hit = (text) => words.every((_, i) => has(text, i));
    // Every word must be found in the skill (its name, what it is about, or its grammar); the ones whose grammar or
    // name carries every word come first, so "future passive verb" lists the future passive before a lesson that
    // only mentions the future in passing.
    const scored = [];
    for (const id of thePath().order) {
      const s = skills.get(id);
      if (!s || s.set) continue;
      const strong = `${fold(`${s.title} ${s.latin_label ?? ''}`)} ${skillTags(s)}`;
      if (!hit(`${strong} ${fold(`${s.plain ?? ''} ${s.summary ?? ''} ${s.id.replace(/-/g, ' ')}`)}`)) continue;
      scored.push({ id, score: words.filter((_, i) => has(strong, i)).length });
    }
    // The skills that are every word asked (by name or grammar) apart from the ones that only mention a word in passing.
    const sk = scored.filter((x) => x.score === words.length).map((x) => x.id);
    const also = scored.filter((x) => x.score < words.length).sort((a, b) => b.score - a.score).map((x) => x.id);
    const tb = [...(catTables?.values?.() ?? [])].filter((t) => hit(fold(`${t.label ?? ''} ${t.example ?? ''} ${t.id} ${CATEGORY_LABEL[t.category] ?? ''}`))).map((t) => t.id);
    return { skills: sk, also, tables: tb };
  }
  function findBox(content) {
    const results = h('div', { class: 'g-find__results', 'aria-live': 'polite' });
    const count = h('p', { class: 'g-quiet g-find__count' });
    const input = h('input', { type: 'search', class: 'g-input g-find__in', id: 'g-find', placeholder: 'e.g. future passive verb, ablative, -bam, puella', autocomplete: 'off', spellcheck: 'false' });
    let first = null;
    const paint = async () => {
      const q = input.value.trim();
      if (content) content.hidden = !!q;
      if (!q) { results.replaceChildren(); count.textContent = ''; first = null; return; }
      const titles = await partTitles();
      const m = findMatches(q);
      first = m.skills[0] ? () => goView('lesson', { skill: m.skills[0] }) : m.tables[0] ? () => goTable(m.tables[0]) : null;
      first = m.skills[0] ? () => goView('lesson', { skill: m.skills[0] }) : m.tables[0] ? () => goTable(m.tables[0]) : m.also[0] ? () => goView('lesson', { skill: m.also[0] }) : null;
      count.textContent = `${m.skills.length} skill${m.skills.length === 1 ? '' : 's'} and ${m.tables.length} table${m.tables.length === 1 ? '' : 's'} match${m.also.length ? `; ${m.also.length} more mention it` : ''}.`;
      results.replaceChildren(h('ol', { class: 'g-path__list g-area' },
        m.skills.slice(0, 30).map((id) => courseRow(id, thePath().of(id) + 1, titles)),
        m.tables.slice(0, 10).map((t) => courseTableRow({ id: t }, null))),
        m.also.length ? h('details', { class: 'g-more g-find__also', open: !m.skills.length && !m.tables.length ? true : null }, h('summary', { text: `Also mentioned in ${m.also.length} more` }),
          h('ol', { class: 'g-path__list g-area' }, m.also.slice(0, 20).map((id) => courseRow(id, thePath().of(id) + 1, titles)))) : null);
    };
    input.addEventListener('input', () => { paint(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && first) { e.preventDefault(); first(); } if (e.key === 'Escape' && input.value) { input.value = ''; paint(); } });
    return h('div', { class: 'g-find' }, h('label', { class: 'g-find__label', for: 'g-find', text: 'Find a skill or a table' }), input, count, results);
  }
  /** Today (§3.2): what to do now — the plan, what is in progress, this chapter, the next on the path. */
  async function renderToday() {
    const titles = await partTitles();
    try { await catalogueItemsOf(); } catch { /* table names fall back to their ids */ }
    if (view.name !== 'today') return;
    const n = ctx.currentChapter?.() ?? 1;
    const c = bookChapter(n);
    const p = thePath();
    const chapterIds = p.order.filter((id) => skills.get(id)?.chapter === n);
    const nextUp = climbFrom(p, null, (x) => !inRotation(stateOf(x)) && !skills.get(x)?.set, 1)[0] ?? null;
    const rf = reviewFirst({ weekSkills: ctx.currentWeekSkills(), skills, states: gstore.getStates(), now: Date.now() });
    const content = h('div', { class: 'g-today-body' },
      todaySection({ heading: 'Your plan' }),
      h('section', { class: 'g-chap g-thischap', 'aria-labelledby': 'g-thischap-h' },
        h('h2', { id: 'g-thischap-h', class: 'g-chap__h' }, h('span', { class: 'g-chap__num', text: `This chapter · Cap. ${roman(n)}` }), h('span', { class: 'g-chap__count', text: c?.title ?? '' })),
        chapterIds.length ? h('ol', { class: 'g-path__list g-area' }, chapterIds.map((id) => courseRow(id, p.of(id) + 1, titles))) : h('p', { class: 'g-quiet', text: 'No grammar skill is taught in this chapter.' }),
        h('p', { class: 'g-vlinks g-thischap__links' },
          btn('Practise this chapter', { to: ['session', { chapter: n }], onclick: () => goView('session', { chapter: n }) }, 'g-vlink'), ' · ',
          btn('Its forms', { to: ['wordwork', { chapter: n }], onclick: () => render('wordwork', { chapter: n }) }, 'g-vlink'), ' · ',
          btn('Its sheet', { to: ['sheets', { chapter: n }], onclick: () => render('sheets', { chapter: n }) }, 'g-vlink'), ' · ',
          h('button', { type: 'button', class: 'g-vlink', onclick: () => { render('sheets', { chapter: n }); setTimeout(() => window.print(), 900); } }, '🖨 Print sheet'), ' · ',
          btn(`Cap. ${roman(n)} page`, { to: ['chapter', { chapter: n }], onclick: () => render('chapter', { chapter: n }) }, 'g-vlink'))),
      nextUp ? h('section', { class: 'g-chap', 'aria-labelledby': 'g-next-h' },
        h('h2', { id: 'g-next-h', class: 'g-chap__h' }, h('span', { class: 'g-chap__num', text: 'Next on your path' }), h('span', { class: 'g-chap__count', text: `${AREAS.find((a) => a.id === areaOf(nextUp))?.label ?? ''} · ${p.of(nextUp) + 1} of ${p.order.length}` })),
        h('ol', { class: 'g-path__list g-area' }, courseRow(nextUp, p.of(nextUp) + 1, titles))) : null,
      rf.length ? h('section', { class: 'g-review', 'aria-labelledby': 'g-review-h' },
        h('h2', { id: 'g-review-h', class: 'g-h2', text: `Review first · week ${ctx.currentCourseWeekN()}` }),
        h('ul', { class: 'g-chips' }, rf.map((r) => h('li', { class: 'g-chips__li' }, navEl({ class: 'g-chip', 'data-state': r.state, 'data-area': areaOf(r.skill), to: ['lesson', { skill: r.skill }], onclick: () => goView('lesson', { skill: r.skill }) }, titleOf(r.skill), h('span', { class: 'g-chip__state', text: ` · ${STATE_LABEL[r.state]}` })))))) : null,
      h('p', { class: 'g-acts' }, btn('Choose your own practice…', { to: ['setup', {}], onclick: () => render('setup', {}) }, 'btn btn--quiet'), btn('📊 Practice chart', { to: ['chart', {}], onclick: () => render('chart', {}) }, 'btn btn--quiet')));
    setBody(
      h('header', { class: 'g-head' }, h('p', { class: 'g-kicker', text: 'Study' }), h('h1', { class: 'g-title', text: 'New This Week' })),
      findBox(content),
      content);
  }
  /**
   * Course (§3.3): every skill and table, **by area** (Verbs, Nouns … each easiest to hardest) or **by chapter**,
   * one row each with its main button, the other ways in, its parts and its tables (Across the conjugations).
   */
  const COURSE_BY = 'l103.course.by';
  const COURSE_AREA = 'l103.course.area';
  async function renderCourse({ by = null, area = null, at = null } = {}) {
    let kept = {};
    try { kept = { by: localStorage.getItem(COURSE_BY), area: localStorage.getItem(COURSE_AREA) }; } catch { /* private mode */ }
    by = by === 'chapter' || by === 'area' ? by : kept.by === 'chapter' ? 'chapter' : 'area';
    area = AREAS.some((a) => a.id === area) ? area : AREAS.some((a) => a.id === kept.area) ? kept.area : 'verbs';
    try { localStorage.setItem(COURSE_BY, by); if (by === 'area') localStorage.setItem(COURSE_AREA, area); } catch { /* not kept */ }
    const titles = await partTitles();
    let tables = null;
    try { tables = (await catalogueItemsOf())?.catalogue?.tables ?? null; } catch { tables = null; }
    if (view.name !== 'course') return;
    view.params = { ...(view.params ?? {}), by, ...(by === 'area' ? { area } : {}) };
    const p = thePath();
    let n = 0;
    const rows = [];
    if (by === 'area') {
      const a = AREAS.find((x) => x.id === area);
      for (const st of p.steps) {
        if (st.kind === 'skill' && areaOf(st.id) === a.id) rows.push(courseRow(st.id, ++n, titles));
        else if (st.kind === 'table' && a.table(st.id)) rows.push(courseTableRow(st, tables));
      }
    }
    const next = by === 'area' ? p.order.find((id) => areaOf(id) === area && !inRotation(stateOf(id))) : null;
    const byChapter = () => {
      const chs = new Map();
      for (const st of p.steps) { if (!chs.has(st.chapter)) chs.set(st.chapter, []); chs.get(st.chapter).push(st); }
      for (const ch of setChapters(ctx.sets ?? new Map())) if (!chs.has(ch)) chs.set(ch, []);
      return [...chs.entries()].sort((x, y) => x[0] - y[0]).map(([ch, list]) => {
        const sets = setsOfChapter(ctx.sets ?? new Map(), ch);
        return h('section', { class: 'g-chap g-path', id: `g-path-c${ch}`, 'aria-labelledby': `g-cc-${ch}` },
          h('h2', { id: `g-cc-${ch}`, class: 'g-chap__h' }, h('span', { class: 'g-chap__num', text: `Cap. ${roman(ch)}` }), h('span', { class: 'g-chap__count', text: bookChapter(ch)?.title ?? '' })),
          h('p', { class: 'g-vlinks' }, btn(`Cap. ${roman(ch)} page`, { to: ['chapter', { chapter: ch }], onclick: () => render('chapter', { chapter: ch }) }, 'g-vlink'), ' · ',
            btn('Practise this chapter', { to: ['session', { chapter: ch }], onclick: () => goView('session', { chapter: ch }) }, 'g-vlink'), ' · ',
            btn('Its forms', { to: ['wordwork', { chapter: ch }], onclick: () => render('wordwork', { chapter: ch }) }, 'g-vlink'), ' · ',
            btn('Its sheet', { to: ['sheets', { chapter: ch }], onclick: () => render('sheets', { chapter: ch }) }, 'g-vlink')),
          h('ol', { class: 'g-path__list g-area' }, list.map((st) => (st.kind === 'skill' ? courseRow(st.id, p.of(st.id) + 1, titles) : courseTableRow(st, tables))), sets.map((sk) => courseRow(sk.id, null))));
      });
    };
    const content = h('div', { class: 'g-course-body' },
      by === 'area' ? h('div', { class: 'g-acts g-areatabs', role: 'group', 'aria-label': 'Area of grammar' },
        AREAS.map((a) => btn(`${a.label} (${p.order.filter((id) => areaOf(id) === a.id).length})`, { 'aria-pressed': String(area === a.id), 'data-area': a.id, to: ['course', { by: 'area', area: a.id }], onclick: () => render('course', { by: 'area', area: a.id }) }, 'g-filter__btn g-areatab'))) : null,
      next ? h('div', { class: 'g-acts' }, btn(playLabel(`Next to learn: ${titleOf(next)}`), { to: ['learn', { skill: next }], onclick: () => startSkill(next, 'learn') }, 'btn btn--primary g-play'), climbButton(next, '▶ Learn them in order')) : null,
      by === 'area' ? h('ol', { class: 'g-path__list g-area' }, rows) : byChapter(),
      h('details', { class: 'g-more' }, h('summary', { text: 'Manage' }),
        h('div', { class: 'g-acts' },
          btn('Add all to review', { onclick: () => bulkAdd(() => true, 'every skill') }, 'btn btn--quiet'),
          btn('Take all out of review', { onclick: () => bulkNone(() => true, 'every skill') }, 'btn btn--quiet'),
          btn('Learn all in order', { onclick: () => bulkNew() }, 'btn btn--quiet'),
          btn('Print charts', { onclick: () => printCharts('all') }, 'btn btn--quiet'),
          btn('Reset all…', { onclick: () => resetAll() }, 'btn btn--quiet g-danger'))));
    setBody(
      h('header', { class: 'g-head' }, h('p', { class: 'g-kicker', text: 'Study' }), h('h1', { class: 'g-title', text: 'Course' }),
        h('p', { class: 'g-lede', text: by === 'area' ? 'Each area from the easiest skill to the hardest, its tables where their first forms are taught.' : 'Chapter by chapter, as the book teaches them, easiest first in each.' })),
      findBox(content),
      h('div', { class: 'g-acts g-acts--top', role: 'group', 'aria-label': 'Show the course' },
        btn('By area', { 'aria-pressed': String(by === 'area'), to: ['course', { by: 'area', area }], onclick: () => render('course', { by: 'area', area }) }, 'g-filter__btn'),
        btn('By chapter', { 'aria-pressed': String(by === 'chapter'), to: ['course', { by: 'chapter' }], onclick: () => render('course', { by: 'chapter' }) }, 'g-filter__btn')),
      content);
    const target = at ?? (by === 'chapter' && !at ? `c${ctx.currentChapter?.() ?? ''}` : null);
    if (target) (body.querySelector(`#g-path-${CSS.escape(target)}`))?.scrollIntoView({ block: at ? 'center' : 'start' });
  }
  /**
   * **The chapter page** (§3.5): Grammar · Forms · Sheet, one page per chapter. Grammar is the chapter's skills and
   * tables as Course rows, its Questions · Vocabulary · Pensa, Practise this chapter and its practice chart; Forms is
   * Word Work's This chapter; Sheet is the cheat sheet. Reading opens the chapter in Read.
   */
  async function renderChapterPage({ chapter = null } = {}) {
    let n = Number(chapter ?? ctx.currentChapter?.() ?? 1);
    if (!bookChapter(n)) n = ctx.currentChapter?.() ?? 1;
    const c = bookChapter(n);
    const titles = await partTitles();
    let tables = null;
    try { tables = (await catalogueItemsOf())?.catalogue?.tables ?? null; } catch { tables = null; }
    if (view.name !== 'chapter') return;
    view.params = { ...(view.params ?? {}), chapter: n };
    const p = thePath();
    const steps = p.steps.filter((st) => st.chapter === n);
    const sets = setsOfChapter(ctx.sets ?? new Map(), n);
    const weekNs = (c?.weeks ?? []).filter((w) => w < 100);
    setBody(
      h('header', { class: 'g-head' },
        h('p', { class: 'g-kicker', text: `Study · chapter${weekNs.length ? ` · week ${weekNs.join(' and ')}` : ''}` }),
        h('h1', { class: 'g-title' }, `Cap. ${roman(n)} · `, h('span', { lang: 'la', text: c?.title ?? '' })),
        h('div', { class: 'g-acts' },
          btn('Practise this chapter', { to: ['session', { chapter: n }], onclick: () => goView('session', { chapter: n }) }, 'btn btn--primary'),
          typeof ctx.openChapter === 'function' ? btn('📖 Read it', { onclick: () => ctx.openChapter(n, 'reading') }, 'btn btn--quiet') : null,
          btn('◂ Cap. ' + roman(Math.max(1, n - 1)), { to: ['chapter', { chapter: n - 1 }], onclick: () => render('chapter', { chapter: n - 1 }), disabled: n <= 1 ? true : null }, 'btn btn--quiet'),
          btn('Cap. ' + roman(n + 1) + ' ▸', { to: ['chapter', { chapter: n + 1 }], onclick: () => render('chapter', { chapter: n + 1 }), disabled: bookChapter(n + 1) ? null : true }, 'btn btn--quiet'))),
      steps.length ? h('ol', { class: 'g-path__list g-area' }, steps.map((st) => (st.kind === 'skill' ? courseRow(st.id, p.of(st.id) + 1, titles) : courseTableRow(st, tables))))
        : h('p', { class: 'g-quiet', text: 'No grammar skill is taught in this chapter.' }),
      sets.length ? h('section', { class: 'g-sets' }, h('h2', { class: 'g-h2', text: 'This chapter’s sets' }), h('ol', { class: 'g-path__list g-area' }, sets.map((sk) => courseRow(sk.id, null)))) : null,
      chartChapter(n, { compact: true }));
  }
  /**
   * **Progressions by area** (2026-10-25: "a skill progression that I can work through in lesson and game for each
   * area of grammar (verbs/nouns etc.) from easiest to hardest … a chart for each and then when I click it takes me
   * to that specific page/lesson/lesson section/charts … for both the lesson and game mode"; "integrate it into the
   * Word Work tab or Grammar tab where it makes sense"). Each area is the path (continuum.js) cut to its own skills
   * and tables, in the same easiest-to-hardest order: every skill with its lesson, each part of it, its tables and its
   * games; every table where its first forms are taught. One switch opens all of it as lessons or as games. Grammar's
   * Path has every area; Word Work's Progressions the four about forms.
   */
  const WW_VIEWS = new Set(['wordwork', 'wwtable']);
  /** The screen on now, as a `from`: where a table's practice opened from it comes back to (at its row, `at`). */
  const VIEW_LABEL = { today: 'Today', course: 'Course', catalogue: 'Tables', paradigms: 'Tables', chapter: 'The chapter', chart: 'Practice chart', lesson: 'The lesson', learn: 'The lesson', part: 'The lesson part', map: 'Skills', wordwork: 'This chapter', wwdrills: 'Skill drills' };
  const hereFrom = (at = null) => ({ view: view.name, params: (({ from: _f, play: _p, at: _a, ...rest }) => ({ ...rest, ...(at ? { at } : {}) }))(view.params ?? {}), label: view.params?.area ? `${AREAS.find((a) => a.id === view.params.area)?.label ?? ''} progression` : view.name === 'chapter' && view.params?.chapter ? `Cap. ${roman(Number(view.params.chapter))}` : VIEW_LABEL[view.name] ?? 'Back' });
  /** A table's practice, started at once, coming back here when it is done. */
  const tableTo = (t, at = null) => ['catalogue', { table: t, from: hereFrom(at), play: true }];
  const goTable = (t, at = null) => { closeGameMenu(); const [n, p] = tableTo(t, at); goView(n, p); };
  /**
   * A skill's tables, in small links under it (2026-10-25: "show all the associated tables underneath the skill …
   * just show them in small links … so it's all there to see. We don't want too much clicking"): each table straight
   * to its practice (coming back here), and one link that plays every word of them in one game.
   */
  const tableLinks = (id, at = id) => {
    const sk = skills.get(id);
    if (!sk || sk.set || !sk.paradigms?.length) return null;
    // ▦ Across the conjugations (N) first — the skill's forms on one word of every table it covers, in the look the
    // switch says — then each table by name, straight to its practice and back (docs/SIMPLIFY-PLAN.md §3.3).
    const across = sk.paradigms.length > 1
      ? h('button', { type: 'button', class: 'g-tlinks__all', onclick: (e) => { const b = e.currentTarget; if (b.dataset.busy) return; b.dataset.busy = '1'; Promise.resolve(startSkill(id, 'across')).finally(() => { delete b.dataset.busy; }); } }, `▦ ${acrossLabel(sk.paradigms)}`, countBadge(`tablepart:${id}`))
      : h('span', { class: 'g-tlinks__k', text: '▦ Its table: ' });
    return h('p', { class: 'g-tlinks' }, across,
      sk.paradigms.map((t, i) => [sk.paradigms.length > 1 || i ? h('span', { class: 'g-tlinks__sep', 'aria-hidden': 'true', text: ' · ' }) : null,
        navEl({ class: 'g-tlinks__a', 'data-area': tableArea(t), to: tableTo(t, at), title: `${sk.title} on the ${tableName(t)}: one word, more to choose or mix`,
          // In game mode, just this skill's part of that table, over the page: one word, the table's other words in the
          // game's Words to choose or mix (2026-10-26). In lesson mode, the table's page opened on the skill's part.
          onclick: () => (gameKept() ? playSkillTables(id, { chapter: sk.chapter, table: t }) : goTable(t, at)) }, tableName(t)), countBadge(`table:${t}`)]));
  };
  const AREAS = [
    { id: 'verbs', label: 'Verbs', short: 'Verb', cats: ['verb-form', 'vocabulary'], table: (t) => /^conj/.test(t) || WORD_TABLES.has(t) },
    { id: 'nouns', label: 'Nouns', short: 'Noun', cats: ['noun-case'], table: (t) => /^(decl|domus)/.test(t) },
    { id: 'adjectives', label: 'Adjectives & adverbs', short: 'Adjective', cats: ['adjective'], table: (t) => /^adj/.test(t) },
    { id: 'pronouns', label: 'Pronouns', short: 'Pronoun', cats: ['pronoun'], table: (t) => ['hic', 'ille', 'is', 'iste', 'ipse', 'qui', 'quis', 'ego', 'tu', 'se'].includes(t) },
    { id: 'sentences', label: 'Sentences & verb uses', short: 'Sentence', cats: ['syntax', 'verb-use'], table: () => false },
    { id: 'metre', label: 'Metre', short: 'Metre', cats: ['metre'], table: () => false },
  ];
  const areaOf = (id) => AREAS.find((a) => a.cats.includes(skills.get(id)?.category))?.id ?? null;
  /** The area's colour, everywhere a skill is listed (2026-10-25: "color code the different areas of grammar so it's
   * clear what area it belongs to"): `data-area` on the row (grammar.css paints its stripe) and a small named tag. */
  const tableArea = (t) => AREAS.find((a) => a.table(t))?.id ?? null;
  const areaTag = (id, { table = false } = {}) => {
    const a = AREAS.find((x) => x.id === (table ? tableArea(id) : areaOf(id)));
    return a ? h('span', { class: 'g-areatag', 'data-area': a.id, text: a.short }) : null;
  };

  /* ------------------------------------------------------- the practice chart */
  /**
   * **The practice chart** (2026-10-23: "a chart to show which skills have been practised … save across devices …
   * within the chapters … and what still needs to be practised"): every chapter's skills as tiles, each with its
   * state, how many times it has been practised and when (the synced log, practicelog.js), its progress sheet, and
   * what is still to do; the chapter's tables with theirs. "Still to do" at the top lists what needs practice most,
   * due reviews first. It reads only what syncs, so it is the same chart on every device.
   */
  const todoOf = (id) => needsPractice(stateOf(id), pLog().skill(id));
  function chartTile(id, { compact = false } = {}) {
    const sk = skills.get(id);
    const st = stateOf(id);
    const need = todoOf(id);
    return h('li', { class: `g-ptile${need ? ' is-todo' : ' is-done'}`, 'data-state': st.state, 'data-area': areaOf(id) },
      areaTag(id),
      navEl({ class: 'g-ptile__t', to: ['lesson', { skill: id }], onclick: () => goView('lesson', { skill: id }) },
        h('span', { class: 'g-dot', 'data-state': st.state, 'aria-hidden': 'true' }), sk.title),
      h('p', { class: 'g-ptile__meta' }, practiceTag(id), need ? h('span', { class: 'g-ptile__need', text: ` · ${need.why}` }) : h('span', { class: 'g-ptile__ok', text: ' · up to date' })),
      compact ? null : partsMeter(sk.title, progressOf(sk, !!ctx.items)),
      need ? btn(playLabel(need.rank <= 1 ? 'Review' : need.rank === 2 ? 'Continue' : 'Learn'), { to: skillTo(id), onclick: () => goSkill(id), 'aria-label': `${need.rank <= 1 ? 'Review' : 'Learn'} ${sk.title}` }, 'btn btn--quiet g-play g-ptile__go') : null);
  }
  /** One chapter's part of the chart: its skills, then the tables it introduces. */
  function chartChapter(n, { todoOnly = false, compact = false } = {}) {
    const ids = thePath().order.filter((id) => skills.get(id)?.chapter === n);
    const shown = todoOnly ? ids.filter((id) => todoOf(id)) : ids;
    const tables = thePath().steps.filter((st) => st.kind === 'table' && st.chapter === n);
    if (!shown.length && (todoOnly || !tables.length)) return null;
    const done = ids.filter((id) => pLog().skill(id).answers > 0 || practised(`skill:${id}`)).length;
    return h('section', { class: 'g-chap g-pchart', id: `g-pchart-${n}`, 'aria-labelledby': `g-pchart-h${n}` },
      h('h2', { id: `g-pchart-h${n}`, class: 'g-chap__h' }, h('span', { class: 'g-chap__num', text: `Cap. ${roman(n)}` }), h('span', { class: 'g-chap__count', text: `${bookChapter(n)?.title ?? ''} · ${done} of ${ids.length} practised` })),
      shown.length ? h('ul', { class: 'g-ptiles' }, shown.map((id) => chartTile(id, { compact }))) : null,
      !todoOnly && tables.length ? h('p', { class: 'g-ptables' }, h('span', { class: 'g-explain__for', text: 'Tables: ' }),
        tables.map((t, i) => [i ? ' · ' : '', navEl({ class: 'g-link', to: tableTo(t.id), onclick: () => goTable(t.id) }, catTables?.get?.(t.id)?.label ?? t.id), ' ',
          practised(`table:${t.id}`) ? h('b', { class: 'g-count', text: `×${practised(`table:${t.id}`)}` }) : h('span', { class: 'g-ptag--none', text: '(not yet)' })])) : null);
  }
  async function renderChart({ chapter = null, todo = false } = {}) {
    try { await catalogueItemsOf(); } catch { /* the tables' names fall back to their ids */ }
    if (view.name !== 'chart') return;
    const ids = thePath().order;
    const todoList = ids.map((id) => ({ id, need: todoOf(id) })).filter((x) => x.need)
      .sort((a, b) => a.need.rank - b.need.rank || thePath().of(a.id) - thePath().of(b.id));
    const here = ctx.currentChapter?.() ?? null;
    // What is pressing: the due reviews, a lesson half done, then what comes next in the chapter being read.
    const top = todoList.filter((x) => x.need.rank <= 2 || skills.get(x.id).chapter <= (here ?? 99)).slice(0, 8);
    const practisedN = ids.filter((id) => pLog().skill(id).answers > 0 || practised(`skill:${id}`)).length;
    const chapters = [...new Set(ids.map((id) => skills.get(id).chapter))].sort((a, b) => a - b);
    setBody(
      h('header', { class: 'g-head' },
        h('p', { class: 'g-kicker', text: 'Grammar · practice chart' }),
        h('h1', { class: 'g-title', text: 'What you have practised' }),
        h('p', { class: 'g-lede', text: `${practisedN} of ${ids.length} skills practised; ${todoList.length} still to do. It is kept with your account, so every device shows the same chart.` })),
      h('div', { class: 'g-acts g-acts--top', role: 'group', 'aria-label': 'Show' },
        btn('Every skill', { 'aria-pressed': String(!todo), to: ['chart', {}], onclick: () => render('chart', {}) }, 'g-filter__btn'),
        btn(`Still to do (${todoList.length})`, { 'aria-pressed': String(!!todo), to: ['chart', { todo: true }], onclick: () => render('chart', { todo: true }) }, 'g-filter__btn')),
      top.length ? h('section', { class: 'g-ptodo' }, h('h2', { class: 'g-h2', text: 'Still to practise first' }),
        h('ol', { class: 'g-level__list' }, top.map((x) => h('li', { class: 'g-suggest__i' }, h('span', { class: 'g-suggest__why', text: `${x.need.why} · Cap. ${roman(skills.get(x.id).chapter)}` }), pathLink(x.id))))) : h('p', { class: 'g-quiet', text: 'Nothing is waiting: every skill you have started is up to date.' }),
      chapters.map((n) => chartChapter(n, { todoOnly: !!todo })));
    if (chapter != null) body.querySelector(`#g-pchart-${Number(chapter)}`)?.scrollIntoView({ block: 'start' });
  }

  /* ------------------------------------------------------- one part of a lesson */
  const stepsOf = (lesson) => (Array.isArray(lesson?.teach) ? lesson.teach : []).filter((x) => x && typeof x === 'object');
  const stepTitle = (step, i) => String(step?.title ?? '').replace(/\*\*?/g, '') || `Part ${i + 1}`;
  /** The lesson's parts, each a link to practise it on its own. */
  const partsNode = (id, steps, { heading = 'Practise one part', current = null } = {}) => (steps.length ? h('section', { class: 'g-lparts' },
    h('h2', { class: 'g-h2', text: heading }),
    h('ol', { class: 'g-lparts__list' }, steps.map((st, i) => h('li', { class: 'g-lparts__i', 'aria-current': current === i ? 'step' : null },
      navEl({ class: 'g-lparts__go', to: ['part', { skill: id, step: i }], onclick: () => { closeGameMenu(); goView('part', { skill: id, step: i }); } },
        h('span', { class: 'g-lparts__n', text: String(i + 1) }), h('span', { class: 'g-lparts__t' }, prose(stepTitle(st, i))), countBadge(`part:${id}:${i}`)))))) : null);
  async function renderPart({ skill: id, step = 0, from = null }) {
    const skill = skills.get(id);
    if (!skill || skill.set) return renderToday();
    keepEntry('part');
    setBody(h('p', { class: 'g-loading', text: 'Preparing that part…' }));
    const [lesson, teachItems] = await Promise.all([lessonOf(id), teachItemsOf(skill)]);
    const steps = stepsOf(lesson);
    const at = Math.max(0, Math.min(steps.length - 1, Number(step) || 0));
    const st = steps[at];
    const run = st ? createStepPractice({ skill, steps, at, gstore, teachItems }) : null;
    const first = run?.start();
    if (!first) {
      setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: skill.title }), h('p', { class: 'g-lede', text: 'This part has nothing more to practise yet.' })),
        h('div', { class: 'g-acts' }, btn('The lesson', { to: ['learn', { skill: id }], onclick: () => goView('learn', { skill: id }) }, 'btn btn--primary'), backButton(from, 'btn')));
      return;
    }
    const title = stepTitle(st, at);
    // The part's explanation above each check, folded to its first lines (? opens the whole of it).
    const lead = (i) => {
      if (!st.say) return null;
      // Whole on the first check of the part; folded to its first lines on the ones after it.
      const ex = h('div', { class: `g-explain g-explain--part${i === 0 ? ' g-explain--first' : ''}` });
      const q = btn([h('span', { 'aria-hidden': 'true', text: '?' }), h('span', { class: 'g-explain__qtext', text: ' The whole explanation' })], { 'aria-expanded': 'false', onclick: () => { const open = ex.classList.toggle('is-open'); q.setAttribute('aria-expanded', String(open)); } }, 'g-explain__q');
      ex.append(h('p', { class: 'g-explain__head' }, h('span', { 'aria-hidden': 'true', text: '💡 ' }), 'How it works', q), h('p', { class: 'g-step__say' }, prose(st.say)),
        ...[st.passive ? h('p', { class: 'g-step__say g-step__passive' }, h('b', { text: 'And the passive, below the active: ' }), st.passive) : null, appliesNode(skill, st.show?.kind === 'paradigm' ? st.show.key : (st.check?.key ?? null)), howNode(skill, { open: false })].filter(Boolean));
      return { node: h('section', { class: 'g-step', 'aria-label': `Part ${at + 1}` }, h('p', { class: 'g-kicker' }, `${capOf(id)} · ${skill.title} · part ${at + 1} of ${steps.length} `, btn('📖 All parts ▾', { 'aria-haspopup': 'dialog', onclick: () => openPartsMenu(id, steps.map((s2, j) => stepTitle(s2, j))) }, 'g-vlink g-partsbtn')), h('h2', { class: 'g-step__title', tabindex: '-1' }, prose(title)), ex), gate: false };
    };
    runSession({ runner: run.runner, title: `Part ${at + 1} · ${title}`, mode: 'learn', hintOpen: false, before: lead,
      onDone: (summary) => {
        if (summary.total) notePractised(`part:${id}:${at}`);
        const more = at + 1 < steps.length;
        const clean = summary.total > 0 && summary.right === summary.total;
        const nextPart = more ? btn(`Next part: ${stepTitle(steps[at + 1], at + 1)} →`, { to: ['part', { skill: id, step: at + 1 }], onclick: () => goView('part', { skill: id, step: at + 1 }) }, clean ? 'btn btn--primary' : 'btn') : null;
        const backB = btn('Back to the lesson', { to: ['learn', { skill: id }], onclick: () => goView('learn', { skill: id }) }, !more && clean ? 'btn btn--primary' : 'btn');
        setBody(h('header', { class: 'g-head' },
          h('p', { class: 'g-kicker', text: `${capOf(id)} · ${skill.title} · part ${at + 1} of ${steps.length}` }),
          h('h1', { class: 'g-title' }, prose(title)),
          h('p', { class: 'g-lede', text: `${summary.right} of ${summary.total} right.` })),
          // Nothing goes on by itself (2026-10-23): the next part is a button, the primary one after a clean round.
          h('div', { class: 'g-acts' },
            btn('Again', { to: ['part', { skill: id, step: at }], onclick: () => goView('part', { skill: id, step: at }) }, summary.right < summary.total ? 'btn btn--primary' : 'btn'),
            nextPart, backB,
            tablePartButton(id, { chapter: skill.chapter }), levelButton(id)),
          suggestNode(id, { heading: more ? 'Or another skill' : 'What next?' }),
          partsNode(id, steps, { heading: 'Another part', current: at }));
      } });
  }

  /* ------------------------------------------------------- game mode, kept */
  // Game mode is one choice for the whole of Grammar (2026-10-23: "make sure everything can be easily navigated
  // to within the game mode so you don't have to leave the game mode each time"): once on, every view is drawn
  // full screen in the game's look, with ☰ for everywhere else, until "Leave game mode".
  /** The skill the page on screen is about, for the menu's "this skill". */
  const viewSkill = () => { const id = view.params?.skill ?? view.params?.drill ?? null; return typeof id === 'string' && skills.has(id) && !skills.get(id).set ? id : null; };
  const gameBar = () => h('nav', { class: 'g-runnav g-gamebar', 'aria-label': 'Game mode' },
    menuButton(() => viewSkill()),
    h('span', { class: 'g-gamebar__t', text: '🎮 Game mode' }),
    viewSkill() ? levelButton(viewSkill(), 'g-runnav__level') : null,
    btn([h('span', { 'aria-hidden': 'true', text: '✕' }), h('span', { class: 'g-gamebar__lt', text: ' Leave game mode' })], { 'aria-label': 'Leave game mode', onclick: () => { keepGame(false); draw(); } }, 'g-gamebar__leave'));
  const menuButton = (skillOf) => btn([h('span', { 'aria-hidden': 'true', text: '☰' }), h('span', { class: 'g-runnav__menut', text: ' Menu' })], { 'aria-haspopup': 'dialog', 'aria-label': 'Menu: go anywhere without leaving game mode', onclick: () => openGameMenu({ skill: skillOf() }) }, 'g-runnav__menu');
  function closeGameMenu() { if (!gameMenu) return; const m = gameMenu; gameMenu = null; m.panel.remove(); document.removeEventListener('keydown', m.onKey, true); if (m.opener?.isConnected) m.opener.focus({ preventScroll: true }); }
  /**
   * The game's menu: this skill (too hard / too easy, its parts, its table), the path, and every view of
   * Grammar and Word Work, each opened in game mode. `only: 'level'` is the "Too hard? Too easy?" panel alone.
   */
  function openGameMenu({ skill: id = null, only = null } = {}) {
    closeGameMenu();
    const sk = id ? skills.get(id) : null;
    const close = btn('✕', { 'aria-label': 'Close', onclick: () => closeGameMenu() }, 'g-gmenu__x');
    const go = (label, name, params = {}, mode = 'grammar') => h('li', {}, navEl({ class: 'g-gmenu__go', to: [name, params], onclick: () => { closeGameMenu(); goView(name, params, mode); } }, label));
    const here = ctx.currentChapter?.() ?? 1;
    const parts = h('div', { class: 'g-gmenu__parts' });
    // ▦ Its tables: the skill's forms on every table it covers in one game, or on one table, each over this page.
    const playOver = (opts) => { closeGameMenu(); playSkillTables(id, opts); };
    const tablesInner = only === 'tables' && sk?.paradigms?.length ? h('div', { class: 'g-gmenu__in' },
      h('div', { class: 'g-gmenu__top' }, h('h2', { class: 'g-gmenu__h', text: 'Its tables' }), close),
      h('p', { class: 'g-kicker', text: `Cap. ${roman(sk.chapter)} · this skill` }), h('h3', { class: 'g-gmenu__sk', text: sk.title }),
      h('p', { class: 'g-quiet', text: 'Its forms on every table at once, or on one table. It opens over this page and comes back here.' }),
      sk.paradigms.length > 1 ? h('div', { class: 'g-acts' }, btn(`▦ ${acrossLabel(sk.paradigms)}`, { onclick: () => playOver({ chapter: sk.chapter }) }, 'btn btn--primary')) : null,
      h('ul', { class: 'g-gmenu__list' }, sk.paradigms.map((t) => h('li', {}, h('button', { type: 'button', class: 'g-gmenu__go', 'data-area': tableArea(t), onclick: () => playOver({ chapter: sk.chapter, table: t }) }, `▦ ${tableName(t)}`)))),
      h('div', { class: 'g-acts' }, mixedGameButton(id))) : null;
    const inner = tablesInner ?? h('div', { class: 'g-gmenu__in' },
      h('div', { class: 'g-gmenu__top' }, h('h2', { class: 'g-gmenu__h', text: only === 'level' ? 'Easier or harder skill?' : 'Go anywhere' }), close),
      sk ? h('section', { class: 'g-gmenu__sec' },
        h('p', { class: 'g-kicker', text: `Cap. ${roman(sk.chapter)} · this skill` }), h('h3', { class: 'g-gmenu__sk', text: sk.title }),
        levelNode(id),
        only === 'level' ? null : h('div', { class: 'g-acts' }, learnGameButton(id), tablePartButton(id, { chapter: sk.chapter }), btn('The lesson page', { to: ['lesson', { skill: id }], onclick: () => { closeGameMenu(); goView('lesson', { skill: id }); } }, 'btn btn--quiet')),
        only === 'level' ? null : parts) : null,
      only === 'level' ? h('div', { class: 'g-acts' }, btn('The whole course →', { to: ['course', { by: 'chapter', at: id }], onclick: () => { closeGameMenu(); goView('course', { by: 'chapter', at: id }); } }, 'btn btn--quiet')) : null,
      only === 'level' ? null : h('section', { class: 'g-gmenu__sec' },
        h('h3', { class: 'g-gmenu__sh', text: 'The path' }),
        h('div', { class: 'g-acts' }, climbButton(id ?? null, id ? '▶ Climb on from here' : '▶ Climb the path'), btn('The whole course', { to: ['course', id ? { by: 'chapter', at: id } : { by: 'chapter' }], onclick: () => { closeGameMenu(); goView('course', id ? { by: 'chapter', at: id } : { by: 'chapter' }); } }, 'btn'))),
      only === 'level' ? null : h('section', { class: 'g-gmenu__sec' },
        h('h3', { class: 'g-gmenu__sh', text: 'Study' }),
        // The same four tabs as the tab row (routes.js STUDY_TABS), so the two never drift apart.
        h('ul', { class: 'g-gmenu__list' }, STUDY_TABS.map((t) => go(t.label, t.view, {}))),
        h('h3', { class: 'g-gmenu__sh', text: `This chapter · Cap. ${roman(here)}` }),
        h('ul', { class: 'g-gmenu__list' }, go('All of it', 'course', { by: 'chapter', at: `c${here}` }), go('Its forms', 'wordwork', { chapter: here }), go('Its sheet', 'sheets', { chapter: here }), go('Any word & types', 'paradigms', {}))),
      only === 'level' ? null : h('div', { class: 'g-acts' }, btn('✕ Leave game mode', { onclick: () => { closeGameMenu(); keepGame(false); body.classList.remove('g-game'); document.documentElement.classList.remove('g-game-open'); draw(); } }, 'btn btn--quiet')));
    const panel = h('div', { class: 'g-gmenu', role: 'dialog', 'aria-modal': 'true', 'aria-label': only === 'level' ? 'Easier or harder skill?' : only === 'tables' ? 'Its tables' : 'Menu', onclick: (e) => { if (e.target === panel) closeGameMenu(); } }, inner);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeGameMenu(); return; }
      if (e.key !== 'Tab') return;
      const f = [...panel.querySelectorAll('a[href], button:not([disabled])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    gameMenu = { panel, onKey, opener: document.activeElement };
    document.addEventListener('keydown', onKey, true);
    (root.querySelector('.g') ?? document.body).append(panel);
    close.focus({ preventScroll: true });
    if (sk && !only) lessonOf(id).then((lesson) => { if (gameMenu?.panel === panel) { const n = partsNode(id, stepsOf(lesson), { heading: 'Practise one part of it' }); if (n) parts.replaceChildren(n); } }).catch(() => {});
  }

  const playButton = (id, opts = {}, cls = 'btn g-play') => btn(playLabel(),
    { to: playTo(id, opts), onclick: () => playSkill(id, opts), 'aria-label': `Play ${skills.get(id)?.title ?? 'this skill'} as a game` }, cls);

  /* ------------------------------------------------------- game mode: the next table */
  /** After a game on `node`'s table, the next table on the page plays (Word Work's cards, a sheet's charts). */
  const playNextAfter = (getNode, more = null) => () => {
    const node = getNode();
    let plays = [...body.querySelectorAll('.paradigm__play')];
    let i = plays.indexOf(node?.querySelector('.paradigm__play'));
    if (i >= 0 && i === plays.length - 1 && more) { more(); plays = [...body.querySelectorAll('.paradigm__play')]; i = plays.indexOf(node?.querySelector('.paradigm__play')); }
    const next = plays[i + 1];
    if (next) { next.closest('.paradigm')?.scrollIntoView({ block: 'start' }); next.click(); }
  };
  /** A view opened with `play: true` starts its table's game as soon as the table is there. */
  const autoPlay = (scope) => setTimeout(() => scope?.querySelector('.paradigm__play')?.click(), 60);

  /* ------------------------------------------------------- paradigms */
  /**
   * **Paradigms** — the whole-table practice on a page of its own (the learner, 2026-10-03: "make this
   * feature easy to get to on its own", "note the type of verb and type of noun so I can practise
   * specific types"). Any word: typed, one of the learner's own learning words (the underlined ones),
   * one of the book's model words, or the words of one type — a conjugation, a declension, a kind of
   * adjective — with "Another word of this type" to drill one pattern across many words. The table is
   * the word popup's (wordpanel.js renderParadigm): every form with its English and the chapter that
   * teaches it, and "Practise this table" ready. This page only finds the word.
   */
  const MODEL_WORDS = ['amō', 'moneō', 'regō', 'capiō', 'audiō', 'sum', 'possum', 'eō', 'volō', 'ferō',
    'puella', 'servus', 'dōnum', 'puer', 'rēx', 'nōmen', 'manus', 'rēs', 'bonus', 'fortis', 'ego', 'is', 'hic', 'ille', 'quī'];
  const tableOf = (e) => { try { return par.paradigm(e, []); } catch { return null; } };
  const headOf = (e) => String(e?.lemma ?? e?.h ?? '').split(/[\s,]/)[0];
  /** The entries a typed form or headword may be, that have a table; one per headword and part of speech. */
  const tableEntries = (form) => {
    let r = null;
    try { r = dict.lookup(String(form ?? '').trim()); } catch { return []; }
    const seen = new Set();
    return (r?.entries ?? []).filter((e) => { const k = `${e.h}|${e.pos}`; if (seen.has(k) || !tableOf(e)) return false; seen.add(k); return true; });
  };
  /** A word's type — its conjugation, declension or kind of adjective (paradigms.js names them) — or null. */
  /**
   * What a game is testing, for its header (2026-10-26: "on the progress at the top always tell what is being tested:
   * what type of word, and what specifically"): the words' types (3rd conjugation -iō verb) and the parts asked
   * (present indicative passive), the first two named and the rest counted, then Practise only… when it is on.
   */
  const testedLine = (cards) => {
    const uniq = (xs) => [...new Set(xs.filter(Boolean))];
    const types = uniq(cards.map((c) => { const t = c.entry ? typeOf(c.entry)?.name : null; return t ? `${t}${/conjugation/.test(t) ? ' verb' : /declension/.test(t) ? ' noun' : ''}` : null; }));
    const parts = uniq(cards.map((c) => c.col));
    const name = (xs, n) => (xs.length <= n ? xs.join(' · ') : `${xs.slice(0, n).join(' · ')} +${xs.length - n} more`);
    const f = chartFocus();
    const focus = f !== 'all' ? (chartFocusOptions([{ voice: 'act' }, { voice: 'pass' }, { number: 'sg' }, { number: 'pl' }, { gender: 'm' }, { gender: 'f' }, { gender: 'n' }]).find((o) => o.id === f)?.label.toLowerCase() ?? '') : '';
    return [name(types, 2), name(parts, 2), focus].filter(Boolean).join(' — ');
  };
  const typeOf = (e) => {
    try {
      if (e?.pos === 'V' || e?.pos === 'VPAR') { const n = par.conjugationName(e); return n ? { group: 'Verbs', name: n.replace(/^((?:semi-)?deponent, .*?) \(deponent\)$/, '$1') } : null; }
      if (e?.pos === 'N') { const n = par.declensionName(e); return n ? { group: 'Nouns', name: n } : null; }
      if (e?.pos === 'ADJ') { const n = par.adjectiveName(e); return n ? { group: 'Adjectives', name: n } : null; }
    } catch { /* an entry the namer cannot read has no type */ }
    return null;
  };
  const shortType = (name) => String(name ?? '').replace('conjugation', 'conj.').replace('declension', 'decl.').replace(' adjective', ' adj.');
  /** A word and its type, wherever a form of it is asked (2026-10-25: "say what conjugation the verb is"): "vocō (1st conj.)". */
  const wordWithType = (e) => { const t = typeOf(e)?.name; return `${headOf(e)}${t ? ` (${shortType(t)})` : ''}`; };
  const TYPE_ORDER = ['1st conjugation', '2nd conjugation', '3rd conjugation', '3rd conjugation (-iō)', '4th conjugation', 'irregular verb',
    'deponent, 1st conjugation', 'deponent, 2nd conjugation', 'deponent, 3rd conjugation', 'deponent, 3rd conjugation (-iō)', 'deponent, 4th conjugation',
    '1st declension', '2nd declension', '2nd declension (-er / -ir)', '2nd declension, neuter', '3rd declension', '3rd declension, neuter',
    '3rd declension (i-stem)', '3rd declension (i-stem), neuter', '4th declension', '4th declension, neuter', '5th declension',
    '1st/2nd declension adjective', '1st/2nd declension adjective (-er)', '1st/2nd declension adjective (genitive -īus)',
    '3rd declension adjective (one ending)', '3rd declension adjective (two endings)', '3rd declension adjective (three endings)'];
  // Every common noun, verb and adjective of the library by its type, most frequent first. Built once, on
  // first use; a type needs five words to be offered, and the Greek, indeclinable and defective are left out.
  let typeIndexMemo = null;
  const typeIndex = () => {
    if (typeIndexMemo) return typeIndexMemo;
    const byKey = new Map();
    const g = dict.glossaryEntries?.() ?? {};
    for (const list of (g instanceof Map ? g.values() : Object.values(g))) {
      for (const e of [].concat(list)) {
        if (!e || !['V', 'N', 'ADJ'].includes(e.pos) || /^\p{Lu}/u.test(e.lemma ?? '')) continue;   // a capital is a proper name
        const k = `${e.h}|${e.pos}|${e.lemma}`;
        const had = byKey.get(k);
        if (!had) byKey.set(k, { e, n: Number(e.n) || 0 });
        else had.n = Math.max(had.n, Number(e.n) || 0);
      }
    }
    const types = new Map();
    for (const { e, n } of byKey.values()) {
      const t = typeOf(e);
      if (!t || /indeclinable|defective|impersonal|Greek|comparative/.test(t.name)) continue;
      if (!types.has(t.name)) types.set(t.name, { ...t, words: [] });
      types.get(t.name).words.push({ e, n });
    }
    for (const t of types.values()) t.words.sort((a, b) => b.n - a.n || String(a.e.lemma).localeCompare(String(b.e.lemma)));
    const rank = (name) => { const i = TYPE_ORDER.indexOf(name); return i < 0 ? 1000 : i; };
    typeIndexMemo = [...types.values()].filter((t) => t.words.length >= 5)
      .sort((a, b) => rank(a.name) - rank(b.name) || b.words.length - a.words.length);
    return typeIndexMemo;
  };
  /** The words of a type the page offers: the model word, the learner's own, then the most frequent. */
  const wordsOfType = (name, extra = []) => {
    const t = typeIndex().find((x) => x.name === name);
    if (!t) return [];
    const out = [];
    const seen = new Set();
    for (const e of [...extra.filter((x) => typeOf(x)?.name === name), ...t.words.slice(0, 80).map((w) => w.e)]) {
      if (seen.has(e.h) || !tableOf(e)) continue;
      seen.add(e.h);
      out.push(e);
    }
    return out;
  };

  /** A typed beginning folded for comparison: no macrons, case or punctuation; v→u, j→i. */
  const foldStart = (x) => stripMacrons(String(x ?? '')).toLowerCase().replace(/v/g, 'u').replace(/j/g, 'i').replace(/[^a-z]/g, '');
  /** Every word with a table, by headword, most frequent first — built once from the type index and the model words. */
  let suggestMemo = null;
  const suggestPool = () => {
    if (suggestMemo) return suggestMemo;
    const seen = new Set();
    const out = [];
    const add = (e, n) => { const k = `${e.h}|${e.pos}`; if (seen.has(k)) return; seen.add(k); out.push({ e, n, key: foldStart(headOf(e)), stems: [...new Set((e.roots ?? []).map(foldStart).filter((r) => r.length >= 3))] }); };
    for (const w of MODEL_WORDS) { const e = tableEntries(w)[0]; if (e) add(e, 1e9); }
    for (const t of typeIndex()) for (const w of t.words) add(w.e, w.n);
    out.sort((a, b) => b.n - a.n);
    suggestMemo = out;
    return out;
  };
  /** The words for what has been typed so far: a form it already is first, then headwords that begin so. */
  const suggestWords = (typed, max = 8) => {
    const q = foldStart(typed);
    if (!q) return [];
    const out = [];
    const seen = new Set();
    const add = (e) => { const k = `${e.h}|${e.pos}`; if (!seen.has(k) && out.length < max) { seen.add(k); out.push(e); } };
    for (const e of tableEntries(typed)) add(e);
    for (const x of suggestPool()) { if (out.length >= max) break; if (x.key.startsWith(q)) add(x.e); }
    // A form on its way (rēgib… for rēgibus): the words whose stem the letters already begin with.
    if (q.length >= 4) for (const x of suggestPool()) { if (out.length >= max) break; if (x.stems.some((r) => q.startsWith(r))) add(x.e); }
    return out;
  };
  /** A random common word with a table: of `type` when given, else of any type; from the most frequent few hundred. */
  const randomWord = (type = null) => {
    // Appropriate means common and of every kind: a noun, a verb or an adjective in turn (the counts the library
    // has are mostly adjectives', so ranking by count alone gave adjectives only), then one of the main types of
    // it, then one of that type's most frequent words — those it has counted when there are enough.
    const any = (xs) => xs[Math.floor(Math.random() * xs.length)];
    let t = type ? typeIndex().find((x) => x.name === type) : null;
    if (!t) {
      const group = any(['Verbs', 'Nouns', 'Adjectives']);
      const types = typeIndex().filter((x) => x.group === group && x.words.length >= 8 && !/deponent/.test(x.name));
      t = types.length ? any(types) : null;
    }
    if (!t) return null;
    const counted = t.words.filter((w) => w.n > 0);
    const pool = (counted.length >= 8 ? counted : t.words).slice(0, 40).map((w) => w.e).filter((e) => tableOf(e));
    return pool.length ? any(pool) : null;
  };

  async function renderParadigms({ word = null, pos = null, type = null, play = false, list: showList = false, at = null } = {}) {
    const tableBox = h('div', { class: 'g-para__table' });
    const pick = (e, t = type) => render('paradigms', { word: e.h, pos: e.pos, type: t ?? typeOf(e)?.name ?? null });
    const chip = (e, note = shortType(typeOf(e)?.name)) => h('li', {}, btn([h('span', { lang: 'la', text: headOf(e) }), note ? h('span', { class: 'g-chip__state', text: ` · ${note}` }) : null],
      { onclick: () => pick(e), 'aria-pressed': String(!!word && e.h === word && (!pos || e.pos === pos)), 'aria-label': `Practise the table of ${e.lemma ?? e.h}${typeOf(e) ? `, ${typeOf(e).name}` : ''}` }, 'g-chip'));

    // Find a word (2026-10-09: "when spelling a word have a drop down menu that appears with the search of the
    // words that match so far"): a combobox. Each letter typed lists the words that begin so — macrons, case
    // and v/u not needed — most frequent first, with any form the letters already are (rēgibus → rēx) at the
    // top. Arrows move, Enter takes, Escape closes; a tap takes too.
    const search = h('input', { type: 'search', class: 'g-input g-words__search', lang: 'la', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
      role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'g-suggest',
      placeholder: 'Start typing a Latin word — am…, rēg…, fort…', 'aria-label': 'Find a word to practise its table' });
    const list = h('ul', { class: 'g-suggest', id: 'g-suggest', role: 'listbox', 'aria-label': 'Matching words', hidden: true });
    let options = [];
    let active = -1;
    const gloss = (e) => String(e.senses?.[0] ?? '').split(/[;,(]/)[0].trim().slice(0, 40);
    // The chosen word is kept in sight by scrolling the list alone. `scrollIntoView` scrolled the page too: on a
    // phone, with the keyboard up, each letter typed carried the page down to the list and the box went off the
    // top (the learner, 2026-10-16: "it scrolls off the word and goes too far down").
    const showOpt = (li) => {
      if (!li) return;
      const top = li.offsetTop, bottom = top + li.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    };
    const setActive = (i) => {
      active = i;
      [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
      if (i >= 0) { search.setAttribute('aria-activedescendant', `g-suggest-${i}`); showOpt(list.children[i]); } else search.removeAttribute('aria-activedescendant');
    };
    const close = () => { list.hidden = true; search.setAttribute('aria-expanded', 'false'); setActive(-1); };
    const suggest = () => {
      options = suggestWords(search.value, 8);
      list.replaceChildren(...options.map((e, i) => {
        const li = h('li', { id: `g-suggest-${i}`, class: 'g-suggest__opt', role: 'option', 'aria-selected': 'false' },
          h('span', { class: 'g-suggest__la', lang: 'la', text: e.lemma ?? e.h }),
          h('span', { class: 'g-suggest__meta', text: [shortType(typeOf(e)?.name), gloss(e)].filter(Boolean).join(' · ') }));
        // A tap takes the word on `click`, which a scroll of the list never fires: picking on pointerdown made the
        // list impossible to scroll with a finger.
        li.addEventListener('click', () => pick(e, null));
        return li;
      }));
      list.hidden = !options.length;
      list.scrollTop = 0;   // a new list starts at its first word
      search.setAttribute('aria-expanded', String(!!options.length));
      setActive(options.length ? 0 : -1);
    };
    let timer = 0;
    const flush = () => { if (timer) { clearTimeout(timer); timer = 0; suggest(); } };   // the list for what is typed now, not 80 ms ago
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { timer = 0; suggest(); }, 80); });
    // A press on the list (an option, its scrollbar, a finger scrolling it) is not leaving the box.
    let inList = false;
    list.addEventListener('pointerdown', (ev) => { inList = true; if (ev.pointerType === 'mouse') ev.preventDefault(); });
    for (const t of ['pointerup', 'pointercancel']) list.addEventListener(t, () => { setTimeout(() => { inList = false; }, 0); });   // a finger's scroll ends in pointercancel
    search.addEventListener('focus', () => { inList = false; });
    search.addEventListener('blur', () => setTimeout(() => { if (!inList) close(); }, 150));
    search.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (list.hidden || timer) { flush(); if (list.hidden) suggest(); return; }   // opening the list lands on its first word
        if (!options.length) return;
        setActive((active + (ev.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        flush();
        const e = options[active] ?? suggestWords(search.value, 1)[0];
        if (e) pick(e, null);
      } else if (ev.key === 'Escape' && !list.hidden) { ev.preventDefault(); close(); }
    });
    // A random word (2026-10-09: "select a random (but appropriate) word, as I don't know how to spell the
    // words"): one of the library's common nouns, verbs and adjectives, any type — a type's own random word is
    // "Start with a random one" and "Another word of this type", below.
    const randomPlay = btn(playLabel('Play a random word'), { onclick: () => { const e = randomWord() ?? randomWord(); if (e) render('paradigms', { word: e.h, pos: e.pos, play: true }); else ctx.say('No word could be chosen just now.'); } }, 'btn g-play');
    const randomBtn = btn('Random word', { onclick: () => { const e = randomWord() ?? randomWord(); if (e) render('paradigms', { word: e.h, pos: e.pos }); else ctx.say('No word could be chosen just now.'); } }, 'btn');

    // The learner's own words: the ones underlined while reading (store.getLookups), newest first.
    let mine = [];
    try {
      const looks = await ctx.store?.getLookups?.();
      const rows = looks ? [...looks.entries()].filter(([, v]) => !v?.learned_at).sort((a, b) => String(b[1]?.created_at ?? '').localeCompare(String(a[1]?.created_at ?? ''))) : [];
      const seen = new Set();
      for (const [form] of rows) {
        const e = tableEntries(form)[0];
        if (e && !seen.has(e.h)) { seen.add(e.h); mine.push(e); }
        if (mine.length >= 24) break;
      }
    } catch { mine = []; }
    const models = MODEL_WORDS.map((w) => tableEntries(w).find((e) => stripMacrons(headOf(e)) === stripMacrons(w)) ?? tableEntries(w)[0]).filter(Boolean);
    const typeWords = type ? wordsOfType(type, [...models, ...mine]) : [];

    let chosen = null;
    if (word) {
      chosen = [...typeWords, ...mine, ...models].find((e) => e.h === word && (!pos || e.pos === pos)) ?? tableEntries(word).find((e) => e.h === word && (!pos || e.pos === pos)) ?? null;
    }
    if (chosen) {
      const t = tableOf(chosen);
      const kind = typeOf(chosen);
      // Another word of the same type: one of the most frequent, never the one on screen.
      const pool = kind ? wordsOfType(kind.name).slice(0, 40).filter((e) => e.h !== chosen.h) : [];
      const nextOfType = pool.length ? () => { const e = pool[Math.floor(Math.random() * pool.length)]; render('paradigms', { word: e.h, pos: e.pos, type: kind.name, play: true }); } : null;
      const node = t && renderParadigm(t, { english: true, practise: true, countKey: tableKey(t.entry), chapter: () => ctx.currentChapter?.() ?? null, gameNext: nextOfType, gameNextLabel: 'Another word of this type →' });
      const another = pool.length ? btn('Another word of this type →', { onclick: () => pick(pool[Math.floor(Math.random() * pool.length)], kind.name) }, 'btn') : null;
      if (node) {
        node.open = true;
        tableBox.append(
          h('h2', { class: 'g-h2', id: 'g-para-word' }, h('span', { lang: 'la', text: chosen.lemma ?? chosen.h })),
          h('p', { class: 'g-para__type' }, kind ? h('span', { class: 'g-para__typename', text: kind.name }) : null,
            btn(playLabel(), { onclick: () => node?.querySelector('.paradigm__play')?.click(), 'aria-label': `Play ${chosen.lemma ?? chosen.h} as a game` }, 'btn btn--primary g-play'), another),
          h('div', { class: 'g-lesson__pt' }, node));   // the lesson's wrapper: it holds the table to the column, and the table stacks (§26) inside it
      }
    } else if (word) {
      tableBox.append(h('p', { class: 'g-quiet', text: 'That word has no table to practise.' }));
    }

    // Practise by type: every conjugation, declension and kind of adjective, with how many words it has.
    const groups = ['Verbs', 'Nouns', 'Adjectives'].map((g) => ({ g, types: typeIndex().filter((t) => t.group === g) })).filter((x) => x.types.length);
    const typeNode = h('section', { class: 'g-cat__sec', 'aria-labelledby': 'g-para-types' },
      h('h2', { id: 'g-para-types', class: 'g-h2', text: 'Practise by type' }),
      h('p', { class: 'g-quiet', text: 'Choose a conjugation, a declension or a kind of adjective, then take its words one after another: the same pattern on new stems.' }),
      groups.map(({ g, types }) => h('div', { class: 'g-para__group' },
        h('h3', { class: 'g-label', text: g }),
        h('ul', { class: 'g-chips', 'aria-label': `${g} by type` }, types.map((t) => h('li', {}, btn([t.name, h('span', { class: 'g-chip__state', text: ` · ${t.words.length}` })],
          { onclick: () => render('paradigms', { type: t.name }), 'aria-pressed': String(type === t.name), 'aria-label': `${t.name}: ${t.words.length} words` }, 'g-chip')))))),
      type ? h('div', { class: 'g-para__typewords' },
        h('h3', { class: 'g-label', text: `${cap(type)} — its words` }),
        typeWords.length
          ? [h('ul', { class: 'g-chips g-words', 'aria-label': `Words of the ${type}` }, typeWords.slice(0, 24).map((e) => chip(e, ''))),
            h('div', { class: 'g-acts' },
              btn(playLabel('Play a random one'), { onclick: () => { const e = typeWords[Math.floor(Math.random() * Math.min(typeWords.length, 40))]; render('paradigms', { word: e.h, pos: e.pos, type, play: true }); } }, 'btn btn--primary g-play'),
              btn('Start with a random one', { onclick: () => pick(typeWords[Math.floor(Math.random() * Math.min(typeWords.length, 40))], type) }, 'btn'))]
          : h('p', { class: 'g-quiet', text: 'No word of this type has a table.' })) : null);

    let got = null;
    try { got = await catalogueItemsOf(); } catch { got = null; }
    if (view.name !== 'paradigms') return;
    setBody(
      h('header', { class: 'g-head' },
        h('p', { class: 'g-kicker', text: 'Study' }),
        h('h1', { class: 'g-title', text: 'Tables' }),
        h('p', { class: 'g-lede', text: 'Any word, its whole table: every form with its English and the chapter that teaches it. Practise it box by box — the whole form or just its ending, right turns green with the ending lit against the stem — or only the parts you have reached.' })),
      h('section', { class: 'g-cat__sec', 'aria-labelledby': 'g-para-find' },
        h('h2', { id: 'g-para-find', class: 'g-h2', text: 'Find a word' }),
        h('div', { class: 'g-find' }, h('div', { class: 'g-find__box' }, search, list), randomBtn, randomPlay),
        h('p', { class: 'g-quiet', text: 'Not sure how a word is spelled? Type its first letters and choose it from the list, or take a random one.' })),
      chosen ? h('section', { class: 'g-cat__sec g-para', 'aria-labelledby': 'g-para-word' }, tableBox) : (word ? tableBox : null),
      typeNode,
      got ? tablesListNode(got) : null,
      mine.length ? h('section', { class: 'g-cat__sec', 'aria-labelledby': 'g-para-mine' },
        h('h2', { id: 'g-para-mine', class: 'g-h2', text: 'Your learning words' }),
        h('p', { class: 'g-quiet', text: 'The words you have underlined while reading, newest first.' }),
        h('ul', { class: 'g-chips g-words', 'aria-label': 'Your learning words' }, mine.map((e) => chip(e)))) : null,
      h('section', { class: 'g-cat__sec', 'aria-labelledby': 'g-para-models' },
        h('h2', { id: 'g-para-models', class: 'g-h2', text: 'The model words' }),
        h('p', { class: 'g-quiet', text: 'One of each pattern: the four conjugations and the irregular verbs, the five declensions, adjectives and pronouns.' }),
        h('ul', { class: 'g-chips g-words', 'aria-label': 'Model words' }, models.map((e) => chip(e)))));
    if (chosen) { tableBox.querySelector('.paradigm__go')?.focus({ preventScroll: true }); if (play) autoPlay(tableBox); }
    else if (type) body.querySelector('.g-para__typewords')?.scrollIntoView({ block: 'start' });
    else if (at) body.querySelector(`#g-path-${CSS.escape(at)}`)?.scrollIntoView({ block: 'center' });
    else if (showList) body.querySelector('#g-tables-all')?.scrollIntoView({ block: 'start' });
  }

  /* ------------------------------------------------------- word work */
  /**
   * **Word Work** — a chapter's table practice (the learner, 2026-10-08: "for each lesson/chapter/week
   * there should be a word work button that practises just those word work skills that are taught in
   * that chapter"). The parts of the tables a chapter teaches are read from the skill map
   * (paradigm-chapters.js), and they are practised on the nouns, verbs and adjectives of that chapter's
   * own readings, most frequent first; the book's model word stands in where the readings have no word
   * of a pattern. Three ways through, the first the default:
   *   mix   the parts new in the chapter, then a short review — the parts of the last few chapters before it
   *   new   only the parts new in the chapter
   *   all   every part taught up to and including it
   * Each table opens already in practice with just those parts switched on (renderParadigm's `preset`);
   * the others show their forms, and the part toggles still turn any of them on.
   */
  let wwSeq = 0;   // the latest Word Work render; an older one still loading draws nothing
  const LS_WW_COLS = 'l103.wordwork.cols';
  const wwCols = () => { try { const k = Number(localStorage.getItem(LS_WW_COLS)); return k >= 1 && k <= 3 ? k : 1; } catch { return 1; } };
  const setWwCols = (k) => { try { localStorage.setItem(LS_WW_COLS, String(k)); } catch { /* the choice just is not kept */ } };
  const WW_MODES = [['mix', 'New + review'], ['new', 'Only the new'], ['all', 'Everything so far']];
  const WW_NEW_WORDS = 4;
  const WW_REVIEW_WORDS = 2;
  const WW_REVIEW_CHAPTERS = 3;   // a review round asks the parts of the last three chapters that taught this word's table anything
  const wwWords = new Map();      // chapter → its readings' words, counted (loaded once per chapter)
  /** The nouns, verbs, adjectives and pronouns of a chapter's readings, most frequent first: [{ e, count }]. */
  function chapterWords(n) {
    // The promise is kept, not the result: two renders of one chapter share one load.
    if (!wwWords.has(n)) wwWords.set(n, loadChapterWords(n).catch((e) => { wwWords.delete(n); throw e; }));
    return wwWords.get(n);
  }
  async function loadChapterWords(n) {
    const c = bookChapter(n);
    const weeksOf = c?.weeks ?? [];
    const lists = await Promise.all(weeksOf.map((w) => Promise.resolve(ctx.store?.getUnits?.(w)).catch(() => [])));
    const counts = new Map();
    for (const u of lists.flat()) {
      for (const t of tokenize(u?.la ?? '')) {
        if (!t.isWord) continue;
        let e = null;
        try { e = dict.lookup(t.form || t.text).entries?.[0] ?? null; } catch { e = null; }
        if (!e || !['N', 'V', 'VPAR', 'ADJ', 'PRON'].includes(e.pos) || /^\p{Lu}/u.test(e.lemma ?? '')) continue;
        const k = `${e.h}|${e.pos}`;
        const had = counts.get(k);
        if (had) had.count++; else counts.set(k, { e, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }
  /** Each cell's chapter for one word: [chapter|null, …] in table order, or null when the word has no table. */
  const cellChaptersOf = (skills, e) => {
    const t = tableOf(e);
    if (!t) return null;
    const out = [];
    for (const s of t.sections) for (const r of s.rows) for (const c of r.cells) if (!c.empty && c.key) out.push(cellChapter(skills, e, c.key));
    return out;
  };
  /** Up to `max` words, a new type before a second word of a type already chosen. */
  const spread = (list, max) => {
    const out = [];
    const types = new Set();
    for (const x of list) { const k = typeOf(x.e)?.name ?? x.e.pos; if (!types.has(k)) { types.add(k); out.push(x); } if (out.length >= max) return out; }
    for (const x of list) { if (!out.includes(x)) out.push(x); if (out.length >= max) break; }
    return out;
  };

  async function renderWordWork({ chapter: n = null, mode = 'mix' } = {}) {
    const seq = ++wwSeq;
    const here = ctx.currentChapter?.() ?? null;
    n = Number(n ?? here ?? 1);
    if (!bookChapter(n)) n = here ?? 1;
    if (!WW_MODES.some(([m]) => m === mode)) mode = 'mix';
    const c = bookChapter(n);
    const picker = h('select', { class: 'g-select', 'aria-label': 'Chapter', onchange: (ev) => render('wordwork', { chapter: Number(ev.target.value), mode }) },
      bookChapters().map((x) => h('option', { value: String(x.n), selected: x.n === n ? true : null }, `Cap. ${x.roman} · ${x.title}${x.n === here ? ' (where you are)' : ''}`)));
    const modes = h('div', { class: 'g-chips', role: 'group', 'aria-label': 'What to practise' },
      WW_MODES.map(([m, label]) => btn(label, { 'aria-pressed': String(m === mode), onclick: () => render('wordwork', { chapter: n, mode: m }) }, 'g-chip')));
    // Columns (2026-10-09: "have the option to have multiple columns"): the word cards side by side on a wide
    // screen, the choice kept on the device. A phone has room for one, and the control is not shown there.
    const cols = wwCols();
    const colsCtl = h('div', { class: 'g-chips g-ww__cols', role: 'group', 'aria-label': 'Columns' },
      h('span', { class: 'g-label', text: 'Columns' }),
      [1, 2, 3].map((k) => btn(String(k), { 'aria-pressed': String(k === cols), 'aria-label': `${k} column${k === 1 ? '' : 's'}`, onclick: () => { setWwCols(k); for (const g of body.querySelectorAll('.g-ww__cards')) g.dataset.cols = String(k); for (const b2 of colsCtl.querySelectorAll('button')) b2.setAttribute('aria-pressed', String(b2.textContent === String(k))); } }, 'g-chip')));
    // What this chapter teaches, said plainly at the top (2026-10-09: "clearly mark in the word work what are the
    // skills for that chapter/week"): every skill of the chapter, the ones with forms to practise first — those
    // are the tables below, their cells marked — and the rest (how the forms are used) one press from their lesson.
    const weekNs = (c.weeks ?? []).filter((w) => w < 100);
    const taught = [...skills.values()].filter((sk) => Number(sk.chapter) === n && !sk.set && !sk.rev && sk.title)
      .sort((x, y) => (y.paradigms?.length ? 1 : 0) - (x.paradigms?.length ? 1 : 0));
    const openLesson = (id) => { ctx.setMode?.('grammar'); render('lesson', { skill: id }); };
    const drillHere = (id) => render('drill', { skill: id, from: { wordwork: n } });
    const taughtNode = h('section', { class: 'g-ww__taught', 'aria-labelledby': 'g-ww-taught' },
      h('h2', { id: 'g-ww-taught', class: 'g-ww__taughth' }, `Taught in Cap. ${c.roman}`, weekNs.length ? h('span', { class: 'g-quiet', text: ` · week ${weekNs.join(' and ')}` }) : null),
      taught.length
        ? h('ul', { class: 'g-ww__skills' }, taught.map((sk) => h('li', { class: 'g-ww__skill', 'data-forms': sk.paradigms?.length ? 'true' : null },
          btn(sk.title, { onclick: () => drillHere(sk.id), 'aria-label': `${sk.title}: drill it here` }, 'g-link'),
          h('span', { class: 'g-ww__skillnote', text: sk.paradigms?.length ? 'forms — in the tables below too' : 'how the forms are used' }),
          btn('lesson', { onclick: () => openLesson(sk.id), 'aria-label': `${sk.title}: open its lesson in Grammar` }, 'g-link g-ww__lessonlink'))))
        : h('p', { class: 'g-quiet', text: 'No grammar skill is listed for this chapter.' }),
      h('p', { class: 'g-ww__legend' }, h('span', { class: 'g-ww__swatch', 'aria-hidden': 'true' }), `In every table, the forms Cap. ${c.roman} teaches are marked like this. A skill's name drills it here.`),
      h('div', { class: 'g-acts' }, btn(`Cap. ${c.roman}: its grammar →`, { to: ['chapter', { chapter: n }], onclick: () => render('chapter', { chapter: n }) }, 'btn')));
    const head = h('header', { class: 'g-head' },
      h('p', { class: 'g-kicker', text: weekNs.length ? `Word Work · week ${weekNs.join(' and ')}` : 'Word Work' }),
      h('h1', { class: 'g-title' }, `Cap. ${c.roman} · `, h('span', { lang: 'la', text: c.title })),
      h('p', { class: 'g-lede', text: 'The forms this chapter teaches, practised on the words of its own readings: every form a box, right turns green with its ending lit. The parts are tagged by chapter; any of them can be switched on or off.' }),
      h('div', { class: 'g-ww__controls' }, picker, modes, colsCtl),
      taughtNode);
    const more = h('div', { class: 'g-acts' }, btn('Any word, or a whole type →', { to: ['paradigms'], onclick: () => render('paradigms') }, 'btn btn--quiet'));
    setBody(head, h('p', { class: 'g-loading', text: 'Finding this chapter’s words…' }));

    const [formSkills, words] = await Promise.all([loadFormSkills(), chapterWords(n)]);
    if (seq !== wwSeq || view.name !== 'wordwork') return;   // the learner moved on (another chapter or mode, another view) while this loaded
    if (!formSkills.length) { setBody(head, h('p', { class: 'g-quiet', text: 'The chapter map could not be loaded, so the parts cannot be chosen. Try again online.' }), more); return; }

    // Each candidate's table, read once: how many cells this chapter teaches, and which earlier chapters it has.
    const scored = [];
    for (const x of words.slice(0, 80)) {
      const chs = cellChaptersOf(formSkills, x.e);
      if (!chs) continue;
      scored.push({ ...x, fresh: chs.filter((k) => k === n).length, earlier: [...new Set(chs.filter((k) => k != null && k < n))].sort((a, b) => b - a), model: false });
    }
    // The model words stand in where the readings give nothing: a pattern they lack, or readings not in the library.
    let modelMemo = null;
    const modelScored = () => (modelMemo ??= MODEL_WORDS.map((w) => tableEntries(w).find((e) => stripMacrons(headOf(e)) === stripMacrons(w)) ?? tableEntries(w)[0]).filter(Boolean)
      .map((e) => { const chs = cellChaptersOf(formSkills, e) ?? []; return { e, count: 0, fresh: chs.filter((k) => k === n).length, earlier: [...new Set(chs.filter((k) => k != null && k < n))].sort((a, b) => b - a), model: true }; }));
    const pool = scored.length ? scored : modelScored();
    let fresh = spread(pool.filter((x) => x.fresh > 0), WW_NEW_WORDS);
    if (!fresh.length && scored.length) fresh = spread(modelScored().filter((x) => x.fresh > 0), WW_NEW_WORDS);
    const review = spread(pool.filter((x) => x.earlier.length && !fresh.some((f) => f.e.h === x.e.h)), WW_REVIEW_WORDS);
    const everything = spread(pool.filter((x) => x.fresh > 0 || x.earlier.length), WW_NEW_WORDS);

    const card = (x, preset, note) => {
      const t = tableOf(x.e);
      // The card's "how it's made" is the chapter's skills for this word's type (the review's, its own chapters').
      const chs = note ? [...String(note).matchAll(/[IVXL]+/g)].map((m) => m[0]) : null;
      const ruleSkills = [...skills.values()].filter((s) => s.paradigms?.length && !s.set && !s.rev && (chs ? chs.includes(roman(Number(s.chapter))) : mode === 'all' ? Number(s.chapter) <= n : Number(s.chapter) === n));
      const node = t && renderParadigm(t, { english: true, practise: true, countKey: tableKey(t.entry), chapter: () => n, preset, focus: n, gameNext: playNextAfter(() => node), gameNextLabel: 'Next word →', ruleFor: mode === 'all' ? null : ruleSkills.length ? ruleSkills : null });
      if (!node) return null;
      node.open = true;
      const kind = typeOf(x.e);
      return h('article', { class: 'g-ww__word' },
        h('div', { class: 'g-ww__wordhead' }, h('h3', { class: 'g-ww__lemma' }, h('span', { lang: 'la', text: x.e.lemma ?? x.e.h })),
          btn(playLabel(), { onclick: () => node.querySelector('.paradigm__play')?.click(), 'aria-label': `Play ${x.e.lemma ?? x.e.h} as a game` }, 'btn g-play')),
        h('p', { class: 'g-para__type' },
          kind ? h('span', { class: 'g-para__typename', text: kind.name }) : null,
          h('span', { class: 'g-quiet', text: x.model ? (scored.length ? 'a model word — the readings have none of this pattern' : 'a model word — this chapter’s readings are not in your library') : `${x.count}× in this chapter’s readings` }),
          note ? h('span', { class: 'g-quiet', text: note }) : null),
        h('div', { class: 'g-lesson__pt' }, node));
    };
    // At most six words at first, the rest a press away (docs/SIMPLIFY-PLAN.md §3.5: not 50 screens on a phone).
    const WW_FIRST = 6;
    const block = (id, title, lede, cards) => {
      const all = cards.filter(Boolean);
      const grid = h('div', { class: 'g-ww__cards', 'data-cols': String(wwCols()) }, all.slice(0, WW_FIRST));   // read now: a choice made while the page loaded counts
      const rest = all.slice(WW_FIRST);
      const moreBtn = rest.length ? btn(`More words (${rest.length})`, { onclick: (e) => { grid.append(...rest); e.currentTarget.remove(); } }, 'btn btn--quiet g-ww__more') : null;
      return h('section', { class: 'g-cat__sec g-ww', 'aria-labelledby': id },
        h('h2', { id, class: 'g-h2', text: title }), lede ? h('p', { class: 'g-quiet', text: lede }) : null, grid, moreBtn);
    };

    const parts = [];
    if (mode === 'all') {
      parts.push(block('g-ww-all', `Everything up to Cap. ${c.roman}`, 'Every part these words’ tables have from chapter I to this one.',
        everything.map((x) => card(x, (ch) => ch != null && ch <= n))));
    } else {
      parts.push(fresh.length
        ? block('g-ww-new', `New in Cap. ${c.roman}`, 'Only the parts this chapter teaches are asked; the rest of each table shows its forms.',
          fresh.map((x) => card(x, (ch) => ch === n)))
        : block('g-ww-new', `New in Cap. ${c.roman}`, `Cap. ${c.roman} teaches no new forms of nouns, verbs, adjectives or pronouns — its grammar is in how they are used. ${mode === 'new' ? 'Choose New + review for the forms before it.' : 'The review below keeps the earlier ones fresh.'}`, []));
      if (mode === 'mix' && review.length) {
        parts.push(block('g-ww-review', 'Review', `A short round of earlier parts: on each word, the last ${WW_REVIEW_CHAPTERS} chapters before this one that taught its table anything.`,
          review.map((x) => { const keep = new Set(x.earlier.slice(0, WW_REVIEW_CHAPTERS)); return card(x, (ch) => keep.has(ch), `cap. ${[...keep].sort((a, b) => a - b).map(roman).join(', ')}`); })));
      }
    }
    if (!scored.length) parts.unshift(h('p', { class: 'g-quiet g-ww__note', text: 'This chapter’s readings are not in your library yet, so the model words stand in.' }));
    // ▶ Play this chapter: its first card's game, each "Next word →" the card after.
    const playAll = parts.some((x) => x?.querySelector?.('.paradigm__play'))
      ? h('div', { class: 'g-acts g-ww__playall' }, btn(playLabel(`Play this chapter`), { onclick: () => body.querySelector('.g-ww .paradigm__play')?.click(), 'aria-label': `Play Cap. ${c.roman}'s word work as a game, word after word` }, 'btn btn--primary g-play'))
      : null;
    setBody(head, playAll, parts, more);
  }

  /* ------------------------------------------------------- word work · a chapter's skills */
  /** The grammar skills a chapter teaches: the ones with forms first, then their uses, in the map's own order. */
  const wwSkillsOf = (n) => [...skills.values()].filter((sk) => Number(sk.chapter) === n && !sk.set && !sk.rev && sk.title)
    .sort((x, y) => (y.paradigms?.length ? 1 : 0) - (x.paradigms?.length ? 1 : 0));
  const wwSkillLabel = (sk) => `${sk.title}${sk.paradigms?.length ? ' · forms' : ''}${drillable(sk.id) ? '' : ' (nothing to drill yet)'}`;
  /** The bar above a Word Work drill: the chapter's skills in a dropdown (choosing one starts it), and the way back. */
  function wwSkillBar(n, current) {
    const list = wwSkillsOf(n);
    // On a whole table the dropdown moves to another skill's whole table when it has one; else to the skill's drill.
    const to = (id) => (view.name === 'wwtable' && skills.get(id)?.paradigms?.length ? render('wwtable', { chapter: n, skill: id }) : render('drill', { skill: id, from: { wordwork: n } }));
    const select = h('select', { class: 'g-select', 'aria-label': `Cap. ${roman(n)}: another skill`, onchange: (ev) => { if (ev.target.value) to(ev.target.value); } },
      list.map((sk) => h('option', { value: sk.id, selected: sk.id === current ? true : null }, wwSkillLabel(sk))));
    const sk = skills.get(current);
    return h('div', { class: 'g-ww__bar' },
      btn(`← Cap. ${roman(n)}`, { to: ['chapter', { chapter: n }], onclick: () => render('chapter', { chapter: n }) }, 'btn btn--quiet g-back'),
      h('label', { class: 'g-ww__barlabel' }, h('span', { class: 'g-label', text: `Cap. ${roman(n)} skills` }), select),
      // ▶ Play here: on a whole table, its game; in a drill, the session switches to game mode where it stands.
      playable(current) ? btn([h('span', { 'aria-hidden': 'true', text: '▶ ' }), 'Play'], { 'aria-label': 'Play this as a game', onclick: () => {
        if (view.name === 'wwtable') { body.querySelector('.g-ww .paradigm__play')?.click(); return; }
        const g = body.querySelector('.g-runnav__game');
        if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); else if (!g) playSkill(current, { chapter: n });
      } }, 'btn g-play') : null,
      sk?.paradigms?.length && view.name !== 'wwtable' ? btn('Whole table →', { to: ['wwtable', { chapter: n, skill: current }], onclick: () => render('wwtable', { chapter: n, skill: current }) }, 'btn btn--quiet') : null,
      sk && view.name === 'wwtable' && drillable(current) ? btn('Drill in sentences →', { to: ['drill', { skill: current, from: { wordwork: n } }], onclick: () => render('drill', { skill: current, from: { wordwork: n } }) }, 'btn btn--quiet') : null);
  }
  /**
   * **A skill's whole table, word after word** (the learner, 2026-10-09: "I want the skill drill to be able to be
   * used for the whole paradigm and then with all the words"). The part of the table the skill teaches — the
   * imperfect subjunctive's twelve forms, both voices; a case's two — opened ready to practise on one word, the
   * rest of the table left out (renderParadigm `only`, paradigm-chapters.js skillCovers). Next word walks on
   * through every word it applies to: the chapter's own readings first, most frequent first, then the model
   * words and the library's commonest words of that kind.
   */
  const wwTableWords = new Map();   // `${chapter}|${skill}` → [entry, …]
  async function skillWords(n, sk) {
    const k = `${n}|${sk.id}`;
    if (wwTableWords.has(k)) return wwTableWords.get(k);
    const fits = (e) => { const t = tableOf(e); if (!t) return false; for (const s of t.sections) for (const r of s.rows) for (const c of r.cells) if (!c.empty && c.key && skillCovers(sk, e, c.key)) return true; return false; };
    const out = [];
    const seen = new Set();
    const add = (e) => { const key = `${e.h}|${e.pos}`; if (seen.has(key) || out.length >= 40 || !fits(e)) return; seen.add(key); out.push(e); };
    let words = [];
    try { words = await chapterWords(n); } catch { words = []; }
    for (const x of words) add(x.e);
    for (const w of MODEL_WORDS) { const e = tableEntries(w)[0]; if (e) add(e); }
    for (const x of suggestPool()) { if (out.length >= 40) break; if (x.n > 0 || out.length < 12) add(x.e); }
    wwTableWords.set(k, out);
    return out;
  }
  async function renderWordWorkTable({ chapter: n = null, skill: id = null, i = 0, play = false } = {}) {
    n = Number(n ?? ctx.currentChapter?.() ?? 1);
    const sk = skills.get(id);
    if (!sk || !sk.paradigms?.length) { render('chapter', { chapter: n }); return; }
    const seq = ++wwSeq;
    setBody(wwSkillBar(n, id), h('p', { class: 'g-loading', text: 'Finding the words for this table…' }));
    const list = await skillWords(n, sk);
    if (seq !== wwSeq || view.name !== 'wwtable') return;
    if (!list.length) {
      if (play && drillable(id)) { gameDrillOn(); render('drill', { skill: id, from: { wordwork: n } }); return; }   // ▶ Play: the drill, since no table can be
      setBody(wwSkillBar(n, id), h('p', { class: 'g-quiet', text: 'No word with a table fits this skill.' })); return;
    }
    const k = ((Number(i) || 0) % list.length + list.length) % list.length;
    const e = list[k];
    const t = tableOf(e);
    const node = renderParadigm(t, { english: true, practise: true, countKey: [tableKey(t.entry), `tablepart:${sk.id}`], gameDone: tableGameDone(sk, t.entry), chapter: () => n, only: (key) => skillCovers(sk, e, key), preset: () => true, ruleFor: sk, ruleHow: howOf(sk),
      gameSubtitle: sk.title, gameNext: () => render('wwtable', { chapter: n, skill: id, i: k + 1, play: true }), gameNextLabel: `Next word → (${(k + 1) % list.length + 1} of ${list.length})` });
    node.open = true;
    const step = (d) => render('wwtable', { chapter: n, skill: id, i: k + d });
    const wordPick = h('select', { class: 'g-select', 'aria-label': 'Word', onchange: (ev) => render('wwtable', { chapter: n, skill: id, i: Number(ev.target.value) }) },
      list.map((w, j) => h('option', { value: String(j), selected: j === k ? true : null }, `${headOf(w)}${typeOf(w) ? ` · ${shortType(typeOf(w).name)}` : ''}`)));
    const next = btn('Next word →', { onclick: () => step(1) }, 'btn btn--primary');
    // When every box of this word is right, Next word is the thing to press: it takes the focus.
    node.addEventListener('focusout', () => { setTimeout(() => { if (node.classList.contains('is-complete') && !node.contains(document.activeElement)) next.focus({ preventScroll: true }); }, 0); });
    const kind = typeOf(e);
    setBody(
      wwSkillBar(n, id),
      h('header', { class: 'g-head' },
        h('p', { class: 'g-kicker', text: `Word Work · whole table · Cap. ${roman(n)}` }),
        h('h1', { class: 'g-title', text: sk.title }),
        h('p', { class: 'g-lede', text: 'Every form of this skill on one word — every box, right turns green with its ending lit — then the next word, through all of them.' })),
      h('div', { class: 'g-ww__wordnav' },
        btn('← Previous', { onclick: () => step(-1), 'aria-label': 'Previous word' }, 'btn btn--quiet'),
        h('span', { class: 'g-ww__count', text: `Word ${k + 1} of ${list.length}` }),
        h('label', { class: 'g-ww__barlabel' }, h('span', { class: 'visually-hidden', text: 'Choose a word' }), wordPick),
        next),
      h('section', { class: 'g-cat__sec g-ww', 'aria-labelledby': 'g-wwt-word' },
        h('h2', { class: 'g-ww__lemma', id: 'g-wwt-word' }, h('span', { lang: 'la', text: e.lemma ?? e.h })),
        kind ? h('p', { class: 'g-para__type' }, h('span', { class: 'g-para__typename', text: kind.name })) : null,
        h('div', { class: 'g-lesson__pt' }, node)),
      h('div', { class: 'g-acts' }, next.cloneNode(true)));
    body.querySelector('.g-acts:last-child .btn')?.addEventListener('click', () => step(1));
    if (play) autoPlay(node.parentNode);
  }

  /* ------------------------------------------------------- sheets */
  /**
   * **Sheets** — a chapter's cheat sheet (the learner, 2026-10-17: "a cheat sheet for each unit … the key
   * grammar / morphology charts for that chapter / week … click it on or off for each skill … with an example or
   * two … one scrolling page of the morphology charts that are easy to read, to see the stems and differences …
   * a short explanation of the transformation"; "needs to show all forms of that particular skill").
   *
   * One card a skill, on one scrolling page. A skill with forms gets its rule — how the form is made — and every
   * form it covers (paradigm-chapters.js skillCovers), charted on the book's model word and up to two words of
   * the chapter's own reading side by side, each form with its English, the stem plain and the ending lit, the
   * skill's own forms marked; "More examples" adds three words at a time. A skill about how the forms are used
   * (a purpose clause) gets its rule and two of its sentences, the key word marked, with their English.
   * The chapter's skills start on, every earlier chapter's are offered off, grouped by chapter; the choice is
   * kept per chapter on the device.
   */
  const LS_SHEET = 'l103.sheets.';
  const sheetOn = (n, fallback) => { try { const v = JSON.parse(localStorage.getItem(LS_SHEET + n) ?? 'null'); return Array.isArray(v) ? new Set(v) : new Set(fallback); } catch { return new Set(fallback); } };
  const saveSheet = (n, on) => { try { localStorage.setItem(LS_SHEET + n, JSON.stringify([...on])); } catch { /* the choice just is not kept */ } };
  /** The words a sheet charts a skill on: the model word, then the chapter's own words it applies to, then the rest. */
  async function sheetWords(n, sk) {
    const model = (() => { try { return entryForKey(sk.paradigms?.[0], sk); } catch { return null; } })();
    const fits = (e) => { const t = tableOf(e); if (!t) return false; for (const sec of t.sections) for (const r of sec.rows) for (const c of r.cells) if (!c.empty && c.key && skillCovers(sk, e, c.key)) return true; return false; };
    const out = [];
    const seen = new Set();
    const add = (e) => { if (!e) return; const k = `${e.h}|${e.pos}`; if (seen.has(k) || !fits(e)) return; seen.add(k); out.push(e); };
    add(model);
    // A skill that names its words (ego, tū, sē; hic, ille, is) charts each of them, in its own order.
    for (const f of Array.isArray(sk.parse_filter) ? sk.parse_filter : sk.parse_filter ? [sk.parse_filter] : []) {
      for (const w of [].concat(f.h ?? [])) add(tableEntries(w).find((e) => e.h === w) ?? null);
    }
    let words = [];
    try { words = await chapterWords(n); } catch { words = []; }
    for (const x of words) add(x.e);
    for (const e of await skillWords(n, sk)) add(e);
    // Side by side, a chart teaches most when its neighbours are other patterns (fīlia beside servus beside rēx,
    // not three of the first declension): a new type first, the model word leading; the rest after.
    const types = new Set();
    const fresh = [];
    const rest = [];
    const named = new Set((Array.isArray(sk.parse_filter) ? sk.parse_filter : [sk.parse_filter]).flatMap((f) => [].concat(f?.h ?? [])));
    for (const e of out) { const t = named.has(e.h) ? `h:${e.h}` : typeOf(e)?.name ?? e.pos; if (!types.has(t)) { types.add(t); fresh.push(e); } else rest.push(e); }
    return [...fresh, ...rest];
  }
  async function renderSheets({ chapter: n = null } = {}) {
    const here = ctx.currentChapter?.() ?? null;
    n = Number(n ?? here ?? 1);
    if (!bookChapter(n)) n = here ?? 1;
    const c = bookChapter(n);
    const seq = ++wwSeq;
    const ofChapter = (k) => wwSkillsOf(k);
    const mine = ofChapter(n);
    const on = sheetOn(n, mine.map((sk) => sk.id));
    const weekNs = (c.weeks ?? []).filter((w) => w < 100);
    const picker = h('select', { class: 'g-select', 'aria-label': 'Chapter', onchange: (ev) => render('sheets', { chapter: Number(ev.target.value) }) },
      bookChapters().map((x) => h('option', { value: String(x.n), selected: x.n === n ? true : null }, `Cap. ${x.roman} · ${x.title}${x.n === here ? ' (where you are)' : ''}`)));
    const sheet = h('div', { class: 'g-sheet' });
    const cards = new Map();   // skill id → its card, built once and shown or hidden as it is switched
    const order = [];
    for (let k = 1; k <= n; k++) for (const sk of ofChapter(k)) order.push(sk);
    const chip = (sk) => {
      const b = btn(sk.title, { 'aria-pressed': String(on.has(sk.id)), 'data-skill': sk.id, onclick: () => { if (on.has(sk.id)) on.delete(sk.id); else on.add(sk.id); saveSheet(n, on); paint(); } }, 'g-chip g-sheet__chip');
      return b;
    };
    const group = (k, open) => {
      const list = ofChapter(k);
      if (!list.length) return null;
      const chips = h('div', { class: 'g-chips' }, list.map(chip));
      if (k === n) return h('div', { class: 'g-sheet__group' }, h('p', { class: 'g-label', text: `Cap. ${roman(k)} — this chapter` }), chips);
      return h('details', { class: 'g-sheet__group', open: open ? true : null }, h('summary', { class: 'g-sheet__groupsum', text: `Cap. ${roman(k)} · ${bookChapter(k)?.title ?? ''}` }), chips);
    };
    const earlier = [];
    for (let k = n - 1; k >= 1; k--) { const g = group(k, ofChapter(k).some((sk) => on.has(sk.id))); if (g) earlier.push(g); }
    const quick = h('div', { class: 'g-acts' },
      btn('Only this chapter', { onclick: () => { on.clear(); for (const sk of mine) on.add(sk.id); saveSheet(n, on); paint(); } }, 'btn btn--quiet'),
      btn('Everything so far', { onclick: () => { for (const sk of order) on.add(sk.id); saveSheet(n, on); paint(); } }, 'btn btn--quiet'),
      btn('Print', { onclick: () => window.print() }, 'btn btn--quiet'));
    const toggles = h('section', { class: 'g-sheet__toggles', 'aria-labelledby': 'g-sheet-on' },
      h('h2', { id: 'g-sheet-on', class: 'g-h2', text: 'On this sheet' }),
      h('p', { class: 'g-quiet', text: 'Switch a skill on or off; earlier chapters are below. Your choice is kept for this chapter.' }),
      group(n, true),
      earlier.length ? h('details', { class: 'g-sheet__earlier' }, h('summary', { class: 'g-sheet__groupsum', text: `Earlier chapters (${earlier.length})` }), earlier) : null,
      quick);
    const empty = h('p', { class: 'g-quiet g-sheet__empty', text: 'Nothing is switched on. Choose a skill above.' });
    setBody(
      h('header', { class: 'g-head' },
        h('p', { class: 'g-kicker', text: weekNs.length ? `Sheets · week ${weekNs.join(' and ')}` : 'Sheets' }),
        h('h1', { class: 'g-title' }, `Cap. ${c.roman} · `, h('span', { lang: 'la', text: c.title })),
        h('p', { class: 'g-lede', text: 'The chapter’s charts on one page: how each form is made, every form of it on a model word and words from the reading, the stem plain and the ending lit.' }),
        h('div', { class: 'g-ww__controls' }, picker)),
      toggles, empty, sheet);
    if (!mine.length) toggles.prepend(h('p', { class: 'g-quiet', text: `Cap. ${c.roman} lists no grammar skill of its own; switch on an earlier chapter’s below.` }));

    const skillsReady = loadFormSkills();
    async function buildCard(sk) {
      // ▶ Play: a form skill's charts, one after another (each "Next word →" the next chart); a use skill's drill.
      const cardPlay = btn(playLabel(), { 'aria-label': `Play ${sk.title} as a game`, onclick: () => {
        const first = card.querySelector('.paradigm__play');
        if (first) first.click(); else playSkill(sk.id, { chapter: n });
      } }, 'btn g-play g-sheet__play');
      if (!sk.paradigms?.length && !drillable(sk.id)) cardPlay.hidden = true;
      const card = h('article', { class: 'g-sheet__card', 'data-forms': sk.paradigms?.length ? 'true' : null, 'aria-labelledby': `g-sheet-${sk.id}` },
        h('div', { class: 'g-sheet__head' }, h('h2', { class: 'g-sheet__title', id: `g-sheet-${sk.id}` }, sk.title, h('span', { class: 'g-sheet__cap', text: ` · cap. ${roman(Number(sk.chapter))}` })), cardPlay),
        sk.plain ? h('p', { class: 'g-sheet__plain', text: sk.plain }) : null,
        sk.summary ? h('p', { class: 'g-sheet__how' }, h('span', { class: 'g-sheet__howlabel', text: sk.paradigms?.length ? 'The rule ' : 'How it works ' }), prose(sk.summary)) : null,
        appliesNode(sk),
        howNode(sk, { open: false }),
        sk.paradigms?.length ? h('p', { class: 'g-quiet g-sheet__bytype', text: 'Each chart below says how its own type makes it — the conjugations and declensions differ.' }) : null);
      if (sk.paradigms?.length) {
        await skillsReady;
        const words = await sheetWords(n, sk);
        const charts = h('div', { class: 'g-sheet__charts' });
        let shown = 0;
        const more = btn('More examples', {}, 'btn btn--quiet g-sheet__more');
        const show = (k) => {
          for (const e of words.slice(shown, shown + k)) {
            const t = tableOf(e);
            const node = t && renderParadigm(t, { english: true, practise: true, label: headOf(e), countKey: [tableKey(t.entry), `tablepart:${sk.id}`], gameDone: tableGameDone(sk, t.entry), only: (key) => skillCovers(sk, e, key), mark: (key) => skillCovers(sk, e, key), resplit: true, tags: false, segment: true,
              gameSubtitle: sk.title, gameNext: playNextAfter(() => node, () => { if (!more.hidden) show(3); }), gameNextLabel: 'Next word →', ruleFor: sk, ruleHow: howOf(sk) });
            if (!node) continue;
            node.open = true;
            // The mark says which forms are the skill's; on a chart that is nothing but the skill's, it says nothing.
            const cellsHere = [...node.querySelectorAll('td.pt__cell:not(.is-empty)')];
            if (cellsHere.length && cellsHere.every((td) => td.classList.contains('is-focus'))) cellsHere.forEach((td) => td.classList.remove('is-focus'));
            charts.append(h('div', { class: 'g-sheet__chart' }, h('div', { class: 'g-lesson__pt' }, node)));   // the table's own heading names the word and its type
          }
          shown = Math.min(words.length, shown + k);
          more.hidden = shown >= words.length;
        };
        more.addEventListener('click', () => show(3));
        show(3);
        // What the colours mean, said on the card that uses them: a verb's three parts, or a noun's cases.
        const verbal = words.some((w) => w.pos === 'V' || w.pos === 'VPAR');
        const key = verbal
          ? h('p', { class: 'g-sheet__key' }, h('span', { class: 'g-sheet__keyitem' }, h('span', { class: 'pt__stem', lang: 'la', text: 'stem' })), ' + ',
            h('span', { class: 'g-sheet__keyitem' }, h('span', { class: 'pt__sign', text: 'tense / mood sign' })), ' + ',
            h('span', { class: 'g-sheet__keyitem' }, h('span', { class: 'pt__person', text: 'personal ending' })))
          : h('p', { class: 'g-sheet__key' }, ['nom', 'gen', 'dat', 'acc', 'abl', 'voc'].map((cs) => h('span', { class: 'g-sheet__case', 'data-case': cs, text: { nom: 'nominative', gen: 'genitive', dat: 'dative', acc: 'accusative', abl: 'ablative', voc: 'vocative' }[cs] })));
        card.append(key, words.length ? charts : h('p', { class: 'g-quiet', text: 'No word with a table fits this skill.' }), more);
      } else {
        let sents = [];
        try { sents = (await loadSentences(sk.id))?.sentences ?? []; } catch { sents = []; }
        const two = sents.filter((x) => x.la).slice(0, 2);
        const mark = (la, focus) => {
          if (!focus) return la;
          const i = la.indexOf(focus);
          return i < 0 ? la : [la.slice(0, i), h('mark', { class: 'g-sheet__focus', text: focus }), la.slice(i + focus.length)];
        };
        if (two.length) card.append(h('ul', { class: 'g-sheet__examples' }, two.map((x) => h('li', {},
          h('span', { class: 'g-sheet__la', lang: 'la' }, mark(x.la, x.focus)),
          x.en ? h('span', { class: 'g-sheet__en', text: x.en }) : null))));
      }
      return card;
    }
    let paintSeq = 0;   // the latest paint: a slower earlier one (a skill switched off meanwhile) draws nothing
    async function paint() {
      const mine = ++paintSeq;
      for (const b of toggles.querySelectorAll('[data-skill]')) b.setAttribute('aria-pressed', String(on.has(b.dataset.skill)));
      const want = order.filter((sk) => on.has(sk.id));
      empty.hidden = !!want.length;
      // A card that fails to build says so in its place, and is built again next time, rather than blanking the sheet.
      for (const sk of want) if (!cards.has(sk.id)) cards.set(sk.id, buildCard(sk).catch((err) => { console.warn('[sheets] card', sk.id, err); cards.delete(sk.id); return h('p', { class: 'g-quiet', text: `${sk.title}: this chart could not be drawn.` }); }));
      const built = await Promise.all(want.map((sk) => cards.get(sk.id)));
      if (mine !== paintSeq || seq !== wwSeq || view.name !== 'sheets') return;
      sheet.replaceChildren(...built);   // in chapter order, then the map's own order within a chapter
    }
    paint();
  }



  /* ---------------------------------------------- the catalogue (§4, §11) */
  let catalogueItemsP = null;
  /** The catalogue's generator: the catalogue, the headword index and the dictionary, built once. */
  const catalogueItemsOf = () => (catalogueItemsP ??= Promise.all([loadParadigmCatalogue(), loadHeadwords()]).then(([catalogue, headwords]) => (catalogue ? { catalogue, gen: createCatalogueItems({ catalogue, lookup: dict.lookup, paradigm: par.paradigm, headwords, skills }) } : null)).catch(() => null));
  const catState = { category: 'all', chapter: null, word: new Map(), group: new Map(), axes: new Map(), sel: new Map(), open: new Set() };
  let tableChooser = null;   // the table page's "Choose what to practise", for the side bar (renderTable sets it)
  const CATEGORY_LABEL = { 'noun-case': 'Noun cases', 'verb-form': 'Verb forms', pronoun: 'Pronouns', adjective: 'Adjectives', numeral: 'Numerals' };
  const readerChapter = () => ctx.currentChapter?.() ?? null;
  /**
   * The paradigm catalogue (§4, decision 9): by part of speech, then table,
   * each naming the chapter that introduces it, filtered by category and by
   * chapter. A table opens to its own page.
   */
  async function renderCatalogue({ table = null, from = null, category = null, chapter = undefined, play = false } = {}) {
    setBody(h('p', { class: 'g-loading', text: 'Loading the tables…' }));
    const got = await catalogueItemsOf();
    if (!got) { setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Tables' }), h('p', { class: 'g-lede', text: 'The paradigm catalogue could not be loaded.' })), h('div', { class: 'g-acts' }, backButton(from, 'btn'))); return; }
    if (table) { renderTable(got, table, { from, play }); return; }
    if (category) catState.category = category;
    if (chapter !== undefined) catState.chapter = chapter;
    // The list is part of Tables' one page now (routes.js sends here only with a table).
    render('paradigms', { list: true }, { push: false });
  }
  /** Every paradigm table, by part of speech, with its filters: the bottom of the Tables page (§3.6). */
  function tablesListNode(got, { from = null } = {}) {
    const { catalogue } = got;
    const parts = Array.isArray(catalogue.raw?.parts) ? catalogue.raw.parts : [];
    const cats = ['all', ...new Set(parts.flatMap((p) => p.tables.map((t) => t.category)).filter(Boolean))];
    const shown = (t) => (catState.category === 'all' || t.category === catState.category) && (catState.chapter == null || (t.chapter != null && t.chapter <= catState.chapter));
    // The lede counts what is on screen, not what the catalogue holds: under a filter it went on saying
    // "65 tables" above four of them (N-9).
    const allTables = catalogue.tables.size;
    const listed = parts.reduce((n, p) => n + p.tables.filter(shown).length, 0);
    const head = h('div', {}, h('h2', { class: 'g-h2', id: 'g-tables-all', text: 'Every table' }),
      h('p', { class: 'g-lede', text: `Every paradigm the book teaches, by part of speech: ${listed === allTables ? `${allTables} tables` : `${listed} of ${allTables} tables under this filter`}. Open one to see it filled, practise a cell across several words or the whole table, and switch the word it is built on.` }));
    const filterNode = h('div', { class: 'g-filter', role: 'group', 'aria-label': 'Filter by category' },
      cats.map((c) => btn(c === 'all' ? 'All' : (CATEGORY_LABEL[c] ?? cap(c.replace('-', ' '))), { 'aria-pressed': String(catState.category === c), onclick: () => { catState.category = c; draw(); } }, 'g-filter__btn')));
    const chapters = catalogueChapters(parts);
    const here = readerChapter();
    const chapterSel = h('select', { class: 'g-select', 'aria-label': 'Up to chapter', onchange: (e) => { catState.chapter = e.target.value ? Number(e.target.value) : null; draw(); } },
      h('option', { value: '', selected: catState.chapter == null ? true : null }, 'Every chapter'),
      chapters.map((c) => h('option', { value: String(c), selected: catState.chapter === c ? true : null }, `Up to chapter ${roman(c)}${c === here ? ' · being read' : ''}`)));
    const sections = parts.map((p) => {
      const tables = p.tables.filter(shown);
      if (!tables.length) return null;
      return h('section', { class: 'g-chap', 'aria-labelledby': `g-cat-${p.id}` },
        h('h2', { id: `g-cat-${p.id}`, class: 'g-chap__h' }, h('span', { class: 'g-chap__num', text: p.label ?? cap(p.id) }), h('span', { class: 'g-chap__count', text: `${tables.length} table${tables.length === 1 ? '' : 's'}` })),
        h('ul', { class: 'g-skills g-tables' }, tables.map((t) => h('li', { class: 'g-skill g-table', id: `g-path-t-${t.id}`, 'data-area': tableArea(t.id) },
          h('div', { class: 'g-skill__main' },
            navEl({ class: 'g-skill__title', to: ['catalogue', { table: t.id, from }], onclick: () => render('catalogue', { table: t.id, from }) }, t.label), countBadge(`table:${t.id}`),
            h('p', { class: 'g-skill__plain' }, h('span', { lang: 'la', class: 'g-table__ex', text: t.example }), t.chapter != null ? ` · from chapter ${roman(t.chapter)}` : ' · not in a chapter', lessonsLink(t) ? [' · ', lessonsLink(t)] : null)),
          h('div', { class: 'g-skill__acts' }, btn(gameKept() ? playLabel('Practise') : 'Practise', { to: tableTo(t.id, `t-${t.id}`), onclick: () => goTable(t.id, `t-${t.id}`), 'aria-label': `Practise ${t.label}` }, 'btn g-play'), btn('Open', { to: ['catalogue', { table: t.id, from }], onclick: () => render('catalogue', { table: t.id, from }), 'aria-label': `Open ${t.label}` }, 'btn btn--quiet'))))));
    });
    return h('section', { class: 'g-cat__sec g-tables-all', 'aria-labelledby': 'g-tables-all' }, head, h('div', { class: 'g-cat__filters' }, filterNode, chapterSel), sections.filter(Boolean).length ? sections : h('p', { class: 'g-quiet', text: 'No table matches this filter.' }));
  }

  /**
   * One table's page (decision 10): see it filled, practise one cell across
   * words, practise the whole table, switch the word — the stock words, or a
   * word from the library — the axes it honestly offers (§5), and the
   * scaffold switch (§12). Every box here has the same immediate feedback and
   * the same per-cell hint as everywhere else.
   */
  function renderTable(got, tableId, { from = null, play = false } = {}) {
    const { catalogue, gen } = got;
    const t = catalogue.table(tableId);
    if (!t) { render('catalogue', { from }); return; }
    const stock = catalogue.stock(t.id);
    const chosen = catState.word.get(t.id) ?? stock[0] ?? null;
    const word = chosen ? gen.wordEntry(chosen, t.id) : null;
    const wordHead = word ? word.entry.lemma.split(/[\s,]/)[0] : '';
    const namingSkill = (t.skills ?? []).map((id) => skills.get(id)).find(Boolean) ?? null;
    const groups = t.groups ?? [];
    // Opened to play a table in parts with none chosen: its first part (where its first forms are taught).
    const group = catState.group.get(t.id) ?? (groups.length === 1 || (play && groups.length) ? groups[0].id : null);
    const axes = catState.axes.get(t.id) ?? {};
    const cellAxes = (t.axes ?? []).filter((a) => a.scope === 'cell');
    // Of the lemma axes only gender can honestly narrow three to five stock words (§5); chapter and deponency cannot.
    const lemmaAxes = (t.axes ?? []).filter((a) => a.scope === 'lemma' && a.id === 'gender');
    // The two kinds of axis choose different things and must never be handed to the other's function (§5, QA M-6):
    // a **cell** axis says which cells are asked (`narrowCells`), a **lemma** axis which words they are asked on
    // (`stockWords`). Passing gender to `narrowCells` dropped every cell a noun table has, because a noun's cell id
    // carries no gender slot, and "practise one cell across words" answered "No cell fits these axes."
    const picked = gen.splitAxes(t, axes);
    const repaint = () => renderTable(got, tableId, { from });

    // The word: the stock words as chips, and a search over the library's headwords (§4b).
    const wordChips = h('div', { class: 'g-chips g-words', role: 'group', 'aria-label': 'Word' }, stock.map((w) => btn(w.lemma.split(/[\s,]/)[0], { 'aria-pressed': String(chosen && (chosen.h === w.h)), lang: 'la', onclick: () => { catState.word.set(t.id, w); repaint(); } }, 'g-chip')));
    if (chosen && !stock.some((w) => w.h === chosen.h)) wordChips.append(btn(chosen.lemma?.split(/[\s,]/)[0] ?? chosen.h, { 'aria-pressed': 'true', lang: 'la' }, 'g-chip'));
    const results = h('ul', { class: 'g-chips g-words__results', 'aria-label': 'Words found', hidden: true });
    const search = h('input', { type: 'search', class: 'g-input g-words__search', lang: 'la', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Any word from the library…', 'aria-label': 'Search the library for a word', oninput: (e) => {
      const rows = gen.search(e.target.value, { table: t.id });
      results.replaceChildren(...rows.map((r) => h('li', {}, btn([h('span', { lang: 'la', text: r.lemma.split(/[\s,]/)[0] }), r.fits ? null : h('span', { class: 'g-chip__state', text: ` · ${r.table ? catalogue.table(r.table)?.label ?? r.table : 'another table'}` })], { onclick: () => { catState.word.set(t.id, { h: r.h, key: r.key, i: r.i, pos: r.pos, lemma: r.lemma }); if (r.fits) repaint(); else render('catalogue', { table: r.table ?? t.id, from }); }, 'aria-label': `Build on ${r.lemma}${r.fits ? '' : ` (a ${r.table ? catalogue.table(r.table)?.label ?? r.table : 'different'} word)`}` }, 'g-chip'))));
      results.hidden = !rows.length;
    } });
    const wordNode = h('section', { class: 'g-cat__sec', 'aria-labelledby': 'g-cat-word' },
      h('h2', { id: 'g-cat-word', class: 'g-h2', text: 'The word' }),
      h('p', { class: 'g-quiet', text: t.stock_note ? `${t.stock_note}` : 'The stock words are the ones the book teaches with.' }),
      wordChips, search, results);

    // See it filled.
    const filled = word ? renderParadigm(word.table, { english: true, practise: true, countKey: tableKey(word.table.entry), chapter: () => ctx.currentChapter?.() ?? null }) : null;
    if (filled) filled.open = true;
    const filledNode = h('section', { class: 'g-cat__sec', 'aria-labelledby': 'g-cat-filled' },
      h('h2', { id: 'g-cat-filled', class: 'g-h2', text: `Filled in · ${wordHead}` }),
      filled ? h('div', { class: 'g-lesson__pt' }, filled) : h('p', { class: 'g-quiet', text: 'This word renders no table.' }));

    // The words a cell is practised on: the stock words under the lemma axes; the chosen library word joins them,
    // but only when it answers those axes too — with *masculine* chosen the drill still led on feminine īnsula (N-4).
    // A word the axis cannot judge (a library word whose gender is unknown to the chip) is kept, as `lemmaFits` says.
    const chosenWord = chosen ? { ...chosen, gender: chosen.gender ?? word?.entry?.gender ?? null } : null;
    const drillWords = () => {
      const base = gen.stockWords(t.id, axes);
      const join = chosenWord && !base.some((w) => w.h === chosenWord.h) && gen.lemmaFits(t, axes, chosenWord);
      return (join ? [chosenWord, ...base] : base).slice(0, 5);
    };
    const start = (list, { title }) => {
      const built = list.filter(Boolean);
      if (!built.length) { ctx.say('Nothing to practise with these choices.'); return; }
      const drill = createCatalogueDrill({ items: built, gstore, skillId: namingSkill?.id ?? null, table: t.id });
      drill.start();
      // What this run does, said in the two directions it now differs in (§20). It always reaches the
      // skill's progress sheet; it reaches the review schedule only while the skill is in mixed
      // practice. The old line said "nothing is counted", which stopped being true the day the sheet
      // started reading these tables — and a table with no skill to its name still records nothing,
      // which is a third thing and says so.
      //
      // Two sentences, not one with a colon in the middle: a skill's title may carry a colon of its
      // own ("Imperfect subjunctive: forms (infinitive + endings)"), and two in a line read as a fault.
      const note = drill.counted
        ? `Counts towards ${namingSkill.title}, which is in your practice.`
        : (namingSkill
          ? `Counts towards ${namingSkill.title} on the progress sheet, not towards review. It is not in your mixed practice, so nothing here changes what is due.`
          : 'Practice only — no skill names this table, so there is nothing to record it under.');
      runSession({ runner: drill.runner, title, note, mode: 'practice', hintOpen: false, onDone: (summary) => {
        // Opened from a menu (the progressions, the path, a chart, a game's What next?): straight back to it, the
        // score said on the way; the table's own page keeps its summary.
        // The end (2026-10-25: "at the end … have options to practise other words OR conjugations … easier harder; have
        // it all at the end"): the summary, with ← Back to the menu it came from first, then the ways to keep going.
        renderSummary(summary, { catalogue: t.id, group, word: chosen?.h ?? null, from });
      } });
    };
    // Practise one cell across words.
    const groupPick = groups.length > 1 ? h('select', { class: 'g-select', 'aria-label': 'Part of the table', onchange: (e) => { catState.group.set(t.id, e.target.value || null); repaint(); } },
      h('option', { value: '', selected: !group ? true : null }, 'Choose a part…'), groups.map((g) => h('option', { value: g.id, selected: group === g.id ? true : null }, g.label))) : null;
    const cellsOf = group ? gen.narrowCells(gen.cellIdsOf(t, group), picked.cell) : [];
    const labelOfCell = (id) => { const spot = word?.cells?.get(id); return spot ? gen.helpers.cellLabelOf(spot, word.table) : id; };
    const cellButtons = h('div', { class: 'g-chips g-cells', role: 'group', 'aria-label': 'Cell' }, cellsOf.map((id) => btn(labelOfCell(id), { onclick: () => start([gen.cellItem({ tableId: t.id, cellId: id, words: drillWords() })], { title: `${t.label} · ${labelOfCell(id)}` }), 'aria-label': `Practise the ${labelOfCell(id)} across ${drillWords().length} words` }, 'g-chip')));
    const oneCellNode = h('section', { class: 'g-cat__sec', 'aria-labelledby': 'g-cat-cell' },
      h('h2', { id: 'g-cat-cell', class: 'g-h2', text: 'Practise one cell across words' }),
      h('p', { class: 'g-quiet', text: drillWords().length
        ? `The same cell asked on ${drillWords().map((w) => (w.lemma ?? w.h).split(/[\s,]/)[0]).join(', ')} — one box a word, each judged as you leave it, the set one attempt.`
        : 'No stock word of this table answers the chosen axes, so there is nothing to ask the cell on. Let one of them go, or search for a word.' }),
      // A cell axis is what can empty this list; a lemma axis narrows the words above it and never the cells (M-6).
      groupPick, group ? (cellsOf.length ? cellButtons : h('p', { class: 'g-quiet', text: 'No cell fits these axes.' })) : null);

    // Axes (§5): only those the data can honestly filter, each value with its count.
    const axisNode = (a) => h('div', { class: 'g-axis' }, h('span', { class: 'g-label', text: `${cap(a.label)}${a.scope === 'lemma' ? ' (of the word)' : ''}` }),
      h('div', { class: 'g-chips', role: 'group', 'aria-label': a.label }, a.values.map((v) => { const on = (axes[a.id] ?? []).includes(v.v); return btn(`${featureLabel(a.id, v.v)?.name ?? v.v}`, { 'aria-pressed': String(on), onclick: () => { const cur = new Set(axes[a.id] ?? []); if (on) cur.delete(v.v); else cur.add(v.v); catState.axes.set(t.id, { ...axes, [a.id]: [...cur] }); repaint(); }, title: `${v.cells ?? v.lemmas} ${a.scope === 'cell' ? 'cells' : 'words'}` }, 'g-chip'); })));
    const axesNode = (cellAxes.length || lemmaAxes.length) ? h('section', { class: 'g-cat__sec', 'aria-labelledby': 'g-cat-axes' },
      h('h2', { id: 'g-cat-axes', class: 'g-h2', text: 'Narrow it' }),
      h('p', { class: 'g-quiet', text: 'Only the axes this table can honestly offer. A choice narrows the cells asked and the words they are asked on; nothing chosen means everything.' }),
      [...cellAxes, ...lemmaAxes].map(axisNode)) : null;

    // Practise the whole table (or the chosen part), scaffolded.
    const level = scaffoldLevelOf(t.id);
    const percent = scaffoldPercent(level, scaffoldAutoOf(t.id));
    // The chosen word leads the whole-table drill — unless a lemma axis rules it out, in which case leading on it
    // would drill exactly the word the learner had just excluded (N-4).
    const wholeWords = () => { const list = drillWords(); return chosenWord && gen.lemmaFits(t, axes, chosenWord) ? [chosenWord, ...list.filter((w) => w.h !== chosenWord.h)] : list; };
    const whole = () => start(wholeWords().slice(0, 4).map((w) => gen.tableItem({ tableId: t.id, word: w, group: group ?? null, cellIds: Object.keys(picked.cell).length ? gen.narrowCells(gen.cellIdsOf(t, group), picked.cell) : null })), { title: `${t.label}${group && groups.length > 1 ? ` · ${groups.find((g) => g.id === group)?.label ?? group}` : ''}` });
    const wholeNode = h('section', { class: 'g-cat__sec', 'aria-labelledby': 'g-cat-whole' },
      h('h2', { id: 'g-cat-whole', class: 'g-h2', text: groups.length > 1 ? 'Practise a whole part of the table' : 'Practise the whole table' }),
      // The line names the word the drill will really lead on, which under a lemma axis is not always the
      // chosen one (N-4): saying "īnsula first" while the masculine chip drills nauta was the same untruth.
      h('p', { class: 'g-quiet', text: `${(() => { const lead = wholeWords()[0]; const n = lead ? (lead.lemma ?? lead.h).split(/[\s,]/)[0] : ''; return n ? `${n} first, then the other words, ` : ''; })()}one table an item: every cell a box, judged as you leave it, the table one attempt. Part of it can be given to start with.` }),
      scaffoldSwitch(t.id, { current: level, percent }),
      h('div', { class: 'g-acts' }, groups.length > 1 && !group ? null : btn(playLabel(), { onclick: () => { gameDrillOn(); whole(); }, 'aria-label': 'Practise the whole table as a game' }, 'btn btn--primary g-play'),
        btn(groups.length > 1 && !group ? 'Choose a part above' : 'Practise it', { onclick: whole, disabled: groups.length > 1 && !group ? true : null }, groups.length > 1 && !group ? 'btn btn--primary' : 'btn')));

    // **Choose what to practise** (2026-10-26: "a side bar where I can check which parts / forms of the verb chart I want
    // to practise; I can click it on or off: the type, active, passive, all … down to every verb form for that word"):
    // every part of the table with its voices and, opened, each form, each a box to tick; then the chosen forms
    // practised on this word, or on three words mixed, in lesson or game mode alike. On the page, and in the side bar
    // on a computer; the choice is kept for the table.
    const selAll = groups.flatMap((g) => g.cells ?? []);
    const sel = catState.sel.get(t.id) ?? new Set(group ? (groups.find((g) => g.id === group)?.cells ?? selAll) : selAll);
    catState.sel.set(t.id, sel);
    const voiceOf = (id) => { const parts = String(id).split('.'); return parts.includes('act') ? 'act' : parts.includes('pass') ? 'pass' : null; };
    const hasVoices = selAll.some((c) => voiceOf(c) === 'act') && selAll.some((c) => voiceOf(c) === 'pass');
    const choosers = new Set();
    const paintChoosers = () => { for (const c of [...choosers]) { if (!c.isConnected && c.dataset.drawn) { choosers.delete(c); continue; } c.paint(); } };
    const setMany = (ids, on) => { for (const id of ids) { if (on) sel.add(id); else sel.delete(id); } paintChoosers(); };
    const only = (v) => { sel.clear(); for (const id of selAll) if (voiceOf(id) === v) sel.add(id); paintChoosers(); };
    const tick = (ids, label, cls = '') => {
      const on = ids.filter((x) => sel.has(x)).length;
      const cb = h('input', { type: 'checkbox', 'aria-label': `${label}: ${on} of ${ids.length} chosen` });
      cb.checked = on === ids.length && on > 0;
      cb.indeterminate = on > 0 && on < ids.length;
      cb.addEventListener('change', () => setMany(ids, cb.checked));
      return h('label', { class: `g-pick__tick ${cls}`.trim() }, cb, h('span', { text: ` ${label}` }), ids.length > 1 ? h('span', { class: 'g-firstnext__n', text: ` ${on}/${ids.length}` }) : null);
    };
    const fold = (key, head, kids) => {
      const open = catState.open.has(`${t.id}|${key}`);
      const more = btn(open ? '▾' : '▸', { 'aria-expanded': String(open), 'aria-label': `${open ? 'Hide' : 'Show'} the forms`, onclick: () => { if (open) catState.open.delete(`${t.id}|${key}`); else catState.open.add(`${t.id}|${key}`); paintChoosers(); } }, 'g-pick__more');
      return h('div', { class: 'g-pick__g' }, h('div', { class: 'g-pick__row' }, more, head), open ? h('div', { class: 'g-pick__kids' }, kids) : null);
    };
    const practiseSel = (nWords) => {
      const ids = selAll.filter((x) => sel.has(x));
      if (!ids.length) return;
      if (gameKept()) gameDrillOn();
      // The forms chosen are all asked: the table starts blank (Given can still put some in, on this table).
      const items = wholeWords().slice(0, nWords).map((w) => gen.tableItem({ tableId: t.id, word: w, group: null, cellIds: ids })).filter(Boolean);
      for (const it of items) if (it.chart) it.chart.given = [];
      start(items, { title: `${t.label} · your choice (${ids.length} form${ids.length === 1 ? '' : 's'})` });
    };
    const chooserNode = () => {
      const node = h('div', { class: 'g-pick' });
      node.paint = () => {
        node.dataset.drawn = '1';
        const n = selAll.filter((x) => sel.has(x)).length;
        node.replaceChildren(
          h('div', { class: 'g-chips' }, btn('All', { onclick: () => setMany(selAll, true) }, 'g-chip'), btn('None', { onclick: () => setMany(selAll, false) }, 'g-chip'),
            hasVoices ? btn('Active only', { onclick: () => only('act') }, 'g-chip') : null, hasVoices ? btn('Passive only', { onclick: () => only('pass') }, 'g-chip') : null),
          h('div', { class: 'g-pick__list' }, groups.map((g) => {
            const cells = g.cells ?? [];
            const vs = ['act', 'pass'].filter((v) => cells.some((c) => voiceOf(c) === v));
            const cellTicks = (list) => list.map((c) => tick([c], labelOfCell(c), 'g-pick__cell'));
            return fold(g.id, tick(cells, g.label), vs.length > 1
              ? vs.map((v) => { const vc = cells.filter((c) => voiceOf(c) === v); return fold(`${g.id}.${v}`, tick(vc, v === 'act' ? 'active' : 'passive'), cellTicks(vc)); })
              : cellTicks(cells));
          })),
          h('div', { class: 'g-acts' },
            btn(playLabel(`Practise these ${n} on ${wordHead || 'this word'}`), { disabled: n ? null : true, onclick: () => practiseSel(1) }, 'btn btn--primary g-play'),
            btn('On 3 words, mixed', { disabled: n ? null : true, onclick: () => practiseSel(3) }, 'btn')));
      };
      choosers.add(node);
      node.paint();
      return node;
    };
    tableChooser = { table: t.id, node: chooserNode };
    const chooseNode = selAll.length > 1 ? h('section', { class: 'g-cat__sec g-chooser--inline', 'aria-labelledby': 'g-cat-choose' },
      h('h2', { id: 'g-cat-choose', class: 'g-h2', text: 'Choose what to practise' }), chooserNode()) : null;
    const acts = [];
    if (namingSkill) acts.push(playButton(namingSkill.id, { from }));
    if (namingSkill) acts.push(btn(`Just drill ${namingSkill.title}`, { to: ['drill', { skill: namingSkill.id, from }], onclick: () => render('drill', { skill: namingSkill.id, from }) }, 'btn'), btn('Its lesson', { to: ['lesson', { skill: namingSkill.id, from }], onclick: () => render('lesson', { skill: namingSkill.id, from }) }, 'btn btn--quiet'));
    setBody(
      from?.view ? backButton(from) : btn('← Tables', { to: ['catalogue', { from }], onclick: () => render('catalogue', { from }) }, 'btn btn--quiet g-back'),
      h('header', { class: 'g-head' },
        h('p', { class: 'g-kicker', text: `${cap(t.part ?? '')} · ${CATEGORY_LABEL[t.category] ?? t.category}${t.chapter != null ? ` · from chapter ${roman(t.chapter)}` : ''}` }),
        h('h1', { class: 'g-title' }, t.label, countBadge(`table:${t.id}`)),
        h('p', { class: 'g-lede' }, 'The model word: ', h('span', { lang: 'la', text: t.example }), lessonsLink(t) ? ['. It is ', lessonsLink(t)] : '.'),
        acts.length ? h('div', { class: 'g-acts' }, acts) : null),
      chooseNode, wordNode, filledNode, oneCellNode, axesNode, wholeNode);
    // Opened to play (a table from a menu): the whole table at once, as a game when game mode is on.
    if (play && !(groups.length > 1 && !group)) { if (gameKept()) gameDrillOn(); whole(); }
  }

  /* --------------------------------------------------------- practice */
  /**
   * **What a mixed set is allowed to mix** (the learner's four messages of
   * 2026-09-11, and their grid of 2026-09-13). The columns are the app's own
   * four populations, not a new taxonomy: the grammar skills of `skills.json`,
   * and each chapter's questions, vocabulary and pensa, which `setSkills`
   * builds as pseudo-skills and the map lists under "Chapter sets". The rows
   * are the chapters that hold something drillable. Both come from `mixGrid`,
   * which reads each chapter's material through `chapterMaterial` — the same
   * call the map's by-chapter view is drawn from, so the two cannot drift. A
   * cell with nothing drillable is not offered at all: a control that cannot
   * change anything is worse than no control.
   */
  const mixGridNow = () => mixGrid({ chapters: ctx.chapters ?? null, skills, order: index.order, sets: ctx.sets ?? new Map(), drillable });
  /** The learner's ticks, cleaned against what the library offers. Never chosen = everything. */
  const chosenMix = (grid = mixGridNow()) => normaliseMix(ctx.prefs().populations, grid);
  /** True when a skill or set has never been opened at all: no row, or a row still marked new. */
  const untouched = (id) => stateOf(id).state === 'new';
  /**
   * Whether a mixed set may reach material the learner has never opened. Not
   * chosen yet means: on while nothing is in the rotation — so the Practice
   * tab is a session rather than the dead end it used to be on a fresh device
   * — and off once anything has been put there, which is the behaviour the
   * section has always had.
   */
  const unstudiedOn = () => { const p = ctx.prefs().unstudied; return p == null ? ![...skills.keys()].some((id) => inRotation(stateOf(id)) && drillable(id)) : p; };
  /** Every id a mixed set may draw on, given the ticked cells and whether untouched material is let in. */
  const mixPool = (sel = chosenMix(), withNew = unstudiedOn()) => [...skills.keys()]
    .filter((id) => drillable(id) && mixHolds(sel, skills.get(id)) && (inRotation(stateOf(id)) || (withNew && untouched(id))));

  // `from` is the chapter page this was opened from, when it was (the by-chapter view's "Practise"): it names
  // the Back button and the way out. Without the parameter the view crashed on `from` the moment it was drawn.
  function renderSetup({ from = null } = {}) {
    const prefs = ctx.prefs();
    const grid = mixGridNow();
    let sel = normaliseMix(prefs.populations, grid);
    let unstudied = unstudiedOn();
    const rotation = [...skills.keys()].filter((id) => inRotation(stateOf(id)) && drillable(id));
    let pool = mixPool(sel, unstudied);
    const cw = [...ctx.currentWeekSkills(), ...(ctx.currentWeekSets?.() ?? [])];
    const onShelf = isShelfWeek(ctx.currentWeekN());
    let size = prefs.size;
    let preset = prefs.preset;
    let oneSkill = prefs.oneSkill && pool.includes(prefs.oneSkill) ? prefs.oneSkill : pool[0] ?? null;
    // The one emptiness left: this library can drill nothing at all, so no choice on this screen could fill a
    // session. "Nothing is in mixed practice yet" is no longer one of them — that is what the controls below are for.
    if (!grid.kinds.length) {
      setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Practice' }), h('p', { class: 'g-lede', text: 'Nothing here can be drilled yet — no sentence in the library fits a skill, and no chapter set has arrived. The lessons are there to read.' })),
        h('div', { class: 'g-acts' }, btn('Go to Today', { to: ['today'], onclick: () => render('today') }, 'btn btn--primary')));
      return;
    }
    const sizes = [5, 10, 15, null];
    const sizeGroup = h('div', { class: 'g-seg', role: 'group', 'aria-label': 'Session size' }, sizes.map((n) => btn(n == null ? 'Open' : String(n), { 'aria-pressed': String(size === n), onclick: (e) => { size = n; for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, 'g-seg__btn')));
    const skillSelect = h('select', { class: 'g-select', 'aria-label': 'Skill', onchange: (e) => { oneSkill = e.target.value; } }, pool.map((id) => h('option', { value: id, selected: id === oneSkill ? true : null }, titleOf(id))));
    // "Missed items" stands beside the four mixes (GRAMMAR-CONTRACT.md "Redo what was wrong"). It is not a mix
    // over skills — it is a session over the very items got wrong and not since put right — so choosing it starts
    // the redo view rather than an ordinary session, and with nothing to redo the choice is simply unavailable.
    const missedTotal = missedCount();
    // What the empty "Missed items" line may claim. Saying "everything you have missed has since been answered
    // right" over a hundred wrong answers on generated sentences was the falsest line in the section (QA M-3):
    // the wording now separates nothing-missed-yet, nothing-that-can-be-offered-back, and all-put-right.
    const missedUnnamed = missedTotal ? 0 : unnamedMissedCount();
    const missedEmpty = missedUnnamed
      ? `Nothing to redo — ${missedUnnamed === 1 ? 'the one answer you got wrong was' : `all ${missedUnnamed} answers you got wrong were`} on a generated sentence, a catalogue table or a step inside a lesson, which are re-drawn rather than offered back.`
      : answeredHere()
        ? 'Nothing to redo — everything you have missed has since been answered right.'
        : 'Nothing to redo — nothing has been missed yet.';
    const CHOICES = [...Object.entries(PRESET_LABEL), ['missed', ['Missed items', 'The items you got wrong and have not since answered right — most recently missed first, still mixed across skills and kinds, up to the size you chose.']]];
    const weekLabels = new Map();   // key → [input, small], so a change to what goes in can re-decide "This week"
    const presetList = h('div', { class: 'g-presets', role: 'radiogroup', 'aria-label': 'Mix' }, CHOICES.map(([key, [label, desc]]) => {
      const disabled = key === 'this-week' ? !cw.some((id) => pool.includes(id)) : key === 'missed' ? missedTotal === 0 : false;
      if (disabled && preset === key) preset = 'review-heavy';
      const input = h('input', { type: 'radio', name: 'g-preset', value: key, checked: preset === key ? true : null, disabled: disabled ? true : null, onchange: () => { preset = key; skillSelect.closest('.g-preset__pick').hidden = key !== 'one-skill'; } });
      const small = h('small', { text: key === 'missed'
        ? (disabled ? missedEmpty : desc)
        : disabled ? (onShelf && !cw.length ? 'Reading a shelf chapter — no course week is current.' : 'No skill from this week is in the mix yet.')
        : (key === 'this-week' ? `${desc} The week's questions, vocabulary and pensa count as its skills.` : key === 'review-heavy' || key === 'even' ? `${desc} Chapter sets take at most three items in ten.` : desc) });
      const label_ = h('label', { class: `g-preset${disabled ? ' is-disabled' : ''}${key === 'missed' ? ' g-preset--missed' : ''}` },
        input, h('span', { class: 'g-preset__text' }, h('b', { text: key === 'missed' && missedTotal ? `${label} · ${missedTotal}` : label }), small));
      weekLabels.set(key, { input, small, label: label_, desc });
      return label_;
    }));
    const pick = h('div', { class: 'g-preset__pick', hidden: preset !== 'one-skill' }, h('span', { class: 'g-label', text: 'Skill' }), skillSelect);
    /* ------------------------------------------- what goes in the mix */
    // The grid the learner asked for (§26): the chapters down the side, the four kinds across the top, a box in
    // every cell that holds something. A column heading takes that whole kind — every chapter, and the ones that
    // arrive later — which is what the four global toggles that stood here used to do; a chapter name takes its
    // whole row; the All / None pair still sits under it. Real table semantics, so a screen reader reads each box
    // under its own two headings, and the arrow keys walk the grid. Every change is written to settings at once —
    // the learner may walk away from this screen and start a session from the Today card, which never comes here.
    const cellBtn = new Map();          // 'kind:chapter' → { b, kind, chapter }
    const colBtn = new Map();           // kind           → { b, small }
    const rowBtn = new Map();           // chapter        → { b, r }
    const ledeNode = h('p', { class: 'g-lede' });
    const mixNoteNode = h('p', { class: 'g-quiet' });
    const startBtn = btn('Start', { onclick: () => start() }, 'btn');
    const playStartBtn = btn(playLabel(), { onclick: () => { gameDrillOn(); start(); }, 'aria-label': 'Start this practice as a game' }, 'btn btn--primary g-play');
    const emptyNode = h('p', { class: 'g-quiet g-mix__empty', hidden: true });
    const saveMix = () => ctx.savePrefs({ populations: sel, unstudied, preset, size, oneSkill, hints });
    const paintMix = () => {
      pool = mixPool(sel, unstudied);
      const counts = mixCounts(sel, grid);
      for (const [k, { b, small }] of colBtn) {
        const c = counts.kinds[k];
        // "all 12" and "12 of 12" look alike today and behave differently tomorrow: the first is the
        // column itself and takes in a chapter that has not arrived yet, the second is those twelve chapters.
        // The heading is pressed for the first only, because pressing it is what makes a column the first.
        b.setAttribute('aria-pressed', String(c.whole));
        small.textContent = c.whole ? `all ${c.of}` : c.on ? `${c.on} of ${c.of}` : 'none';
        b.setAttribute('aria-label', c.whole
          ? `${POPULATION_LABEL[k]} — the whole column: every chapter, including chapters that arrive later. Press to take it out of the mix.`
          : `${POPULATION_LABEL[k]} — ${c.on ? `${c.on} of ${c.of} chapters` : 'no chapter'} in the mix. Press to take the whole column.`);
      }
      for (const [n, { b, r }] of rowBtn) {
        const c = counts.rows.get(n) ?? { on: 0, of: 0 };
        b.setAttribute('aria-pressed', String(c.of > 0 && c.on === c.of));
        b.setAttribute('aria-label', `Chapter ${r.roman}${r.title ? `, ${r.title}` : ''} — ${c.on} of its ${c.of} in the mix. Press to take the whole row ${c.of > 0 && c.on === c.of ? 'out' : 'in'}.`);
      }
      for (const { b, kind, chapter } of cellBtn.values()) b.setAttribute('aria-pressed', String(mixIn(sel, kind, chapter)));
      mixNoteNode.textContent = mixNote(sel, grid);
      // Every number here counts **this mix**, not the whole rotation: a lede that said "11 due" over a mix
      // of four would be a count of something the learner cannot reach from this screen.
      const extra = pool.filter((id) => !inRotation(stateOf(id))).length;
      const due = pool.filter((id) => isDue(stateOf(id)));
      const crossable = new Set();
      for (const id of due) for (const c of skills.get(id)?.confusable_with ?? []) if (due.includes(c)) crossable.add([id, c].sort().join('|'));
      ledeNode.textContent = `${pool.length} in the mix${extra ? `, ${extra} of them never opened` : ''} · ${due.length} due${crossable.size ? ` · ${crossable.size} pair${crossable.size === 1 ? '' : 's'} that are easy to cross` : ''}.`;
      // "This week" can become possible the moment a cell or the switch lets one of the week's skills in.
      const week = weekLabels.get('this-week');
      if (week) {
        const off = !cw.some((id) => pool.includes(id));
        week.input.disabled = off;
        week.label.classList.toggle('is-disabled', off);
        week.small.textContent = off ? (onShelf && !cw.length ? 'Reading a shelf chapter — no course week is current.' : 'No skill from this week is in the mix yet.') : `${week.desc} The week's questions, vocabulary and pensa count as its skills.`;
        if (off && preset === 'this-week') { preset = 'review-heavy'; weekLabels.get('review-heavy').input.checked = true; skillSelect.closest('.g-preset__pick').hidden = true; }
      }
      oneSkill = pool.includes(oneSkill) ? oneSkill : pool[0] ?? null;
      skillSelect.replaceChildren(...pool.map((id) => h('option', { value: id, selected: id === oneSkill ? true : null }, titleOf(id))));
      startBtn.disabled = !pool.length;
      playStartBtn.disabled = !pool.length;
      emptyNode.hidden = !!pool.length;
      emptyNode.textContent = Array.isArray(sel) && !sel.length
        ? 'Nothing can be built from an empty mix. Tick a box, or press All.'
        : unstudied
          ? 'Nothing you have ticked can be drilled yet.'
          : 'Nothing you have studied is in the cells you ticked. Turn on "Include what you have not studied", or add some from the skill map.';
    };
    const press = (what) => { sel = mixToggle(sel, what, grid); paintMix(); saveMix(); ctx.say(mixNote(sel, grid)); };
    // The arrow keys walk the grid, as they do in any grid of controls, and Home / End go to the ends of a row.
    // Tab still reaches every box in document order, so nothing here has to be known to use the thing; a cell with
    // nothing in it carries no control, and the walk steps over it rather than landing on an empty square.
    const gridKeys = (e) => {
      const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      const cell = e.target?.closest?.('th, td');
      const table = cell?.closest?.('table');
      if (!cell || !table || (!step && e.key !== 'Home' && e.key !== 'End')) return;
      const rows = [...table.rows];
      let y = rows.indexOf(cell.parentElement);
      let x = [...cell.parentElement.cells].indexOf(cell);
      if (y < 0 || x < 0) return;
      const at = (yy, xx) => rows[yy]?.cells?.[xx]?.querySelector('button') ?? null;
      let next = null;
      if (!step) {
        const across = [...rows[y].cells].map((_, i) => i);
        for (const xx of (e.key === 'Home' ? across : across.reverse())) { next = at(y, xx); if (next) break; }
      } else {
        for (let i = rows.length + rows[y].cells.length; i > 0 && !next; i--) {
          y += step[0];
          x += step[1];
          if (y < 0 || y >= rows.length || x < 0 || x >= (rows[y]?.cells?.length ?? 0)) break;
          next = at(y, x);
        }
      }
      if (!next) return;
      e.preventDefault();
      next.focus();
    };
    const mixTable = h('div', { class: 'g-mixg__scroll', onkeydown: gridKeys },
      h('table', { class: 'g-mixg' },
        h('caption', { class: 'visually-hidden', text: 'What goes in the mix: a chapter a row, a kind a column.' }),
        h('thead', {}, h('tr', {},
          h('td', { class: 'g-mixg__corner', text: 'Chapter' }),
          grid.kinds.map((k) => {
            const small = h('small', {});
            const b = h('button', { type: 'button', class: 'g-mixg__col', onclick: () => press({ kind: k }) },
              h('b', { text: POPULATION_LABEL[k] }), small);
            colBtn.set(k, { b, small });
            return h('th', { scope: 'col', class: 'g-mixg__colh' }, b);
          }))),
        h('tbody', {}, grid.rows.map((r) => h('tr', {},
          (() => {
            const b = h('button', { type: 'button', class: 'g-mixg__row', onclick: () => press({ chapter: r.chapter }) },
              h('b', { text: `Cap. ${r.roman}` }), r.title ? h('small', { text: r.title }) : null);
            rowBtn.set(r.chapter, { b, r });
            return h('th', { scope: 'row', class: 'g-mixg__rowh' }, b);
          })(),
          grid.kinds.map((k) => {
            const ids = r.cells[k];
            // An empty cell is not an unticked one. It carries no control at all and says so in words, so it
            // cannot be read — by eye or by a screen reader — as a box that merely happens to be off.
            if (!ids) return h('td', { class: 'g-mixg__td g-mixg__td--none' },
              h('span', { 'aria-hidden': 'true', text: '–' }), h('span', { class: 'visually-hidden', text: 'nothing here' }));
            const b = h('button', { type: 'button', class: 'g-mixg__cell',
              'aria-label': `${POPULATION_LABEL[k]}, chapter ${r.roman}, ${ids.length === 1 ? '1 thing' : `${ids.length} things`}, in the mix`,
              onclick: () => press({ kind: k, chapter: r.chapter }) },
              h('span', { class: 'g-mixg__box', 'aria-hidden': 'true' }));
            cellBtn.set(`${k}:${r.chapter}`, { b, kind: k, chapter: r.chapter });
            return h('td', { class: 'g-mixg__td' }, b);
          }))))));
    const gridHelp = h('p', { class: 'g-quiet', text: "Tick a box to put that chapter's things of that kind into the mix. A chapter name takes its whole row, and a column heading takes the whole kind. The figure under each heading counts the chapters in that column: “all 34” is the kind itself, so a chapter that reaches your library later joins it; “8 of 34” is those eight chapters and no more." });
    const allNone = h('div', { class: 'g-seg g-seg--allnone', role: 'group', 'aria-label': 'All or none' },
      btn('All', { onclick: () => press('all') }, 'g-seg__btn'),
      btn('None', { onclick: () => press('none') }, 'g-seg__btn'));
    const unstudiedSwitch = h('label', { class: 'switch g-all-switch' },
      h('input', { type: 'checkbox', role: 'switch', checked: unstudied ? true : null, onchange: (e) => { unstudied = e.target.checked; paintMix(); saveMix(); } }),
      h('span', { class: 'switch__ui', 'aria-hidden': 'true' }),
      h('span', { class: 'switch__text', text: 'Include what you have not studied' }));
    // Hints, per answer box (GRAMMAR-CONTRACT.md). One setting for every session, wherever it is started from —
    // the Today card and a chapter page never pass through this screen, so the choice is remembered, not asked for.
    let hints = prefs.hints;
    const hintList = h('div', { class: 'g-presets', role: 'radiogroup', 'aria-label': 'Hints' }, HINT_MODES.map((key) => {
      const [label, desc] = HINT_MODE_LABEL[key];
      return h('label', { class: 'g-preset' },
        h('input', { type: 'radio', name: 'g-hintmode', value: key, checked: hints === key ? true : null, onchange: () => { hints = key; } }),
        h('span', { class: 'g-preset__text' }, h('b', { text: label }), h('small', { text: desc })));
    }));
    const start = async () => {
      await ctx.savePrefs({ populations: sel, unstudied, preset, size, oneSkill, hints });
      if (preset === 'missed') { render('redo', { size, from }); return; }
      render('session', { preset, size, oneSkill, from });
    };
    paintMix();
    setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Practice' }),
      // "Confusion pair" is reserved for a pair the learner's answers have actually crossed (the Stats
      // page's "What you mix up"). This count is of pairs the map *declares* confusable and that are
      // both due — a different thing, and it said the same words one tab away (QA-B6). The count before
      // it is of what this mix really holds, which is the learner's choice and not the whole rotation.
      ledeNode),
      h('section', { class: 'g-setup' },
        h('div', { class: 'g-setup__row g-setup__row--col' }, h('span', { class: 'g-label', text: 'What goes in' }),
          gridHelp, mixTable, h('div', { class: 'g-mix' }, allNone), mixNoteNode, unstudiedSwitch,
          h('p', { class: 'g-quiet', text: `${rotation.length} of the ${[...skills.keys()].filter(drillable).length} things here have been put into practice. With the switch on, a mixed set also draws on the ones you have never opened — they come after everything that is due, and answering one puts it into practice for good.` }),
          emptyNode),
        h('div', { class: 'g-setup__row' }, h('span', { class: 'g-label', text: 'Items' }), sizeGroup),
        h('div', { class: 'g-setup__row g-setup__row--col' }, h('span', { class: 'g-label', text: 'Mix' }), presetList, pick),
        h('div', { class: 'g-setup__row g-setup__row--col' }, h('span', { class: 'g-label', text: 'Hints' }), hintList,
          // What a hint now is (§6 decision 14, §12): it opens as a nudge, and its last step hands over the
          // form. The old line promised a hint "never spells the answer", which the shipped hint does (M-9).
          h('p', { class: 'g-quiet', text: 'Every answer box has its own hint — a typed field, each cell of a chart, each blank of a pensum, each word of an order or match item. A hint starts as a nudge: what that box is being asked for, and the rule behind it. Its last step, "Show this form", gives that one box its answer and marks the box hinted, which counts as weaker evidence. This choice holds for every session.' }))),
      h('div', { class: 'g-acts' }, playStartBtn, startBtn, btn(from ? backLabel(from).replace('← ', 'Back to ') : 'Back to skills', { onclick: () => leaveTo(from) }, 'btn btn--quiet')));
  }
  function renderPracticeStart({ preset = 'review-heavy', size = 10, oneSkill = null, pair = null, resume = false, chapter = null, from = null, redo = false, skill: redoSkill = null }) {
    // "Missed items" is not a mix over skills but a session over named items, so it is its own view. Both routes
    // in: the setup's choice (which is remembered as a preference and could come back from anywhere), and a
    // redo in progress resuming through the Today card, which offers every session by the one Resume button.
    if (redo || preset === 'missed') { render('redo', { skill: redoSkill ?? (preset === 'missed' ? null : oneSkill), chapter, size: preset === 'missed' ? size : null, from, resume }); return; }
    // A confusion pair's Start: ten items alternating exactly those two skills (GRAMMAR-CONTRACT.md, wave 3).
    // It is not a preset — nothing else is let in — so it is built here and handed to the runner as a finished plan.
    if (Array.isArray(pair) && pair.length === 2) { startPair(pair, size ?? 10); return; }
    // "Practise this chapter": the same mixed session, with the chapter's own skills and sets as its whole world —
    // so the interleaving, the confusable pairs and the chapter-set window all hold, and the re-queue and the
    // filler can reach nothing outside the chapter either.
    const params = chapter != null ? { chapter: Number(chapter), size: size ?? 10, from } : { preset, size, oneSkill, from };
    // A session in progress is kept in localStorage (plan, position, answers) so Back or Reload offers to resume it (G1-08).
    const saved = resume ? readJSON(LS_SESSION, null) : null;
    const usable = saved?.queue?.length && saved.index < saved.queue.length ? saved : null;
    if (usable) Object.assign(params, usable.params ?? {});
    const ch = params.chapter ?? null;
    // What this mixed set is allowed to mix, and whether it may reach material never opened — the Practice
    // setup's two new controls, read here rather than carried in the params so a session resumed from the
    // Today card (which never passes through that screen) obeys the same choice. "Practise this chapter" is
    // the chapter's own material by definition and is left alone: the learner asked for that chapter, whole.
    const grid = ch != null ? null : mixGridNow();
    const sel = ch != null ? null : chosenMix(grid);
    const unstudied = ch != null ? false : unstudiedOn();
    let world = ch != null ? skillsIndex : { ...skillsIndex, skills: filterMix(skillsIndex.skills, sel) };
    if (ch != null) {
      const material = chapterMaterial(ch, { skills, order: index.order, sets: ctx.sets ?? new Map() });
      const pool = chapterPool(material, { state: stateOf, drillable });
      // A lapsed row is asked for on purpose here, as it is in "Practise this skill": it re-enters the rotation
      // now, so the answers that follow are not judged early (M1).
      for (const id of pool.lapsed) gstore.setState(addToPractice(gstore.getState(id) ?? id));
      if (!pool.rotation.length) {
        writeJSON(LS_SESSION, null);
        setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: `Chapter ${roman(ch)}` }),
          h('p', { class: 'g-lede', text: pool.map.size ? 'Nothing from this chapter is in mixed practice yet. Learn one of its skills, or add them to practice, and this will build a session from them alone.' : 'Nothing in this chapter can be drilled yet — its lessons are there to read.' })),
          h('div', { class: 'g-acts' }, backButton(params.from ?? { chapter: ch }, 'btn')));
        return;
      }
      world = { skills: pool.map };
    }
    const onChange = (snap) => writeJSON(LS_SESSION, snap.index < snap.queue.length ? { ...snap, params, at: Date.now() } : null);
    const practice = createPractice({ gstore, items, skillsIndex: world, currentWeekN: ctx.currentWeekN(), currentWeekSkills: ch != null ? [] : [...ctx.currentWeekSkills(), ...(ctx.currentWeekSets?.() ?? [])], preset: ch != null ? 'review-heavy' : params.preset, size: params.size, oneSkill: ch != null ? null : params.oneSkill, chapter: ch, resume: usable ? { queue: usable.queue, index: usable.index, log: usable.log } : null, onChange, unstudied });
    const first = practice.start();
    if (!first) { writeJSON(LS_SESSION, null); setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Nothing to practise' }), h('p', { class: 'g-lede', text: ch != null ? `No sentences in the library fit chapter ${roman(ch)}'s skills yet.` : `Nothing in this mix can produce an item. ${mixNote(sel, grid)}` })), h('div', { class: 'g-acts' }, backButton(params.from, 'btn'), btn('Change the mix', { to: ['setup', { from: params.from }], onclick: () => render('setup', { from: params.from }) }, 'btn btn--quiet'))); return; }
    if (usable) ctx.say('Session resumed.');
    // The header says what is actually in the set. A mix cut down to one population read "Practice · Review-heavy"
    // over ten vocabulary cards and named neither the narrowing nor the untouched material it had let in.
    const narrowed = ch != null ? '' : mixTitle(sel, grid);
    const title = ch != null ? `Practise · Cap. ${roman(ch)}` : `Practice · ${(PRESET_LABEL[params.preset] ?? PRESET_LABEL['review-heavy'])[0]}${narrowed ? ` · ${narrowed}` : ''}`;
    const note = ch != null ? '' : `${mixNote(sel, grid)}${unstudied ? ' Material you have never opened is let in, after everything that is due.' : ''}`;
    runSession({ runner: practice.runner, title, note, mode: 'practice', hintOpen: false, practiceLink: true, open: practice.open, more: () => practice.more(), onDone: (summary) => { writeJSON(LS_SESSION, null); renderSummary(summary, params); } });
  }
  /* ------------------------------------------------- redo what was wrong */
  /**
   * The items to redo, narrowed the way the control that offers them is
   * (GRAMMAR-CONTRACT.md "Redo what was wrong"): everything, one skill's, or
   * one chapter's. `skills` for a chapter is its whole material — its skills
   * and its sets — so a chapter's redo cannot reach outside the chapter.
   */
  const chapterIds = (n) => chapterMaterial(Number(n), { skills, order: index.order, sets: ctx.sets ?? new Map(), entry: spine(ctx.chapters ?? null).find((c) => c.n === Number(n)) ?? null }).ids;
  /**
   * A skill a redo may draw from: one that is in the rotation already (a
   * lapsed row counts and re-enters, as "Practise this skill" and "Practise
   * this chapter" let it), and that can still produce an item. A skill still
   * in **Learn** is left out on purpose — a redo is logged as an ordinary
   * practice answer, and letting one through would move the skill to
   * practising without its Learn criterion ever being met. Learn's own misses
   * are offered back from its result screen, once the skill has passed.
   */
  const redoable = (id) => { const st = stateOf(id).state; return (st === 'practising' || st === 'mastered' || st === 'lapsed') && drillable(id); };
  const redoScope = ({ skill = null, chapter = null } = {}) => new Set((skill != null ? [skill] : chapter != null ? chapterIds(chapter) : [...skills.keys()]).filter(redoable));
  /** How many items are waiting to be redone here. 0 means the control says so quietly and is not offered. */
  const missedCount = (scope = {}) => (ctx.items ? gstore.countMissed({ skills: redoScope(scope) }) : 0);
  /** Wrong answers here that name no item, so can never be offered back — what the empty state must own up to (M-3). */
  const unnamedMissedCount = (scope = {}) => (ctx.items ? gstore.countUnnamedMissed?.({ skills: redoScope(scope) }) ?? 0 : 0);
  /** Whether anything at all has been answered here — "nothing missed yet" is a different thing from "all put right". */
  const answeredHere = (scope = {}) => [...redoScope(scope)].some((id) => gstore.countAttempts(id) > 0);
  /**
   * A redo session: the same items, freshly ordered, run as an ordinary
   * session — logged, fed to the scheduler, clearing an item when it is
   * answered right. `misses` is an explicit list (the end of a session hands
   * its own back); without one the store is asked, narrowed by `skill` or
   * `chapter`. `size` caps it (Practice setup's chosen size); the other routes
   * pass none, because the count on the button is what the learner agreed to.
   */
  async function renderRedo({ misses = null, skill: skillId = null, chapter = null, size = null, from = null, resume = false } = {}) {
    if (skillId != null && !skills.has(skillId)) { render('today'); return; }
    // The world the session may reach: only redoable skills, so the re-queue and the filler stay inside the
    // skill or the chapter that was asked for and never touch one that is still being learned.
    const scope = redoScope({ skill: skillId, chapter });
    const world = { skills: new Map([...scope].map((id) => [id, skills.get(id)]).filter(([, s]) => s)) };
    const title = skillId != null ? `Redo · ${titleOf(skillId)}` : chapter != null ? `Redo · Cap. ${roman(Number(chapter))}` : 'Redo what you missed';
    // A lapsed row is asked for on purpose, as in "Practise this skill": it re-enters the rotation now, so the
    // answers that follow are not judged early (M1).
    for (const id of scope) if (stateOf(id).state === 'lapsed') gstore.setState(addToPractice(gstore.getState(id) ?? id));
    const params = { skill: skillId, chapter, size, from, redo: true };
    // A redo in progress resumes like any other session (the saved queue carries each slot's item key).
    const saved = resume ? readJSON(LS_SESSION, null) : null;
    const usable = saved?.redo && saved.queue?.length && saved.index < saved.queue.length ? saved : null;
    const offered = Array.isArray(misses) && misses.length ? misses.filter((m) => scope.has(m.skill)) : gstore.getMissed({ skills: scope });
    const rows = offered;
    if (!usable && !rows.length) { renderNothingToRedo({ skillId, chapter, from }); return; }
    // An item drawn from a skill's **own written sentences** is keyed `w:…` (items.js) and lives in that
    // skill's `createTeachItems`, not in the library, so the library generator cannot rebuild it. Its
    // generator is loaded for the skills that actually have such a miss — one fetch each, usually one skill —
    // and answers first for those slots; everything else goes to the library exactly as before (M-3).
    const wantTeach = [...new Set([...(usable?.queue ?? []), ...rows.map((r) => ({ skill: r.skill, itemKey: r.item_key }))]
      .filter((r) => r && isWrittenKey(r.itemKey)).map((r) => r.skill))].filter((id) => skills.has(id));
    const teachFor = new Map((await Promise.all(wantTeach.map(async (id) => [id, await teachItemsOf(skills.get(id))]))).filter(([, t]) => t));
    const rebuild = (slot) => (isWrittenKey(slot.itemKey) ? teachFor.get(slot.skill)?.itemByKey(slot.itemKey, { kind: slot.kind, stage: slot.stage }) ?? null : null);
    const onChange = (snap) => writeJSON(LS_SESSION, snap.index < snap.queue.length ? { ...snap, params, redo: true, at: Date.now() } : null);
    const redo = createRedo({ misses: rows, gstore, items, skillsIndex: world, size: size ?? rows.length, oneSkill: skillId, chapter: chapter != null ? Number(chapter) : null, currentWeekN: ctx.currentWeekN(), resume: usable ? { queue: usable.queue, index: usable.index, log: usable.log } : null, onChange, rebuild });
    const first = redo.start();
    if (!first) { writeJSON(LS_SESSION, null); renderNothingToRedo({ skillId, chapter, from, gone: rows.length }); return; }
    if (usable) ctx.say('Redo resumed.');
    const asked = usable ? usable.queue.length : redo.plan.length;
    const short = !usable && rows.length > asked && size == null ? ` ${rows.length - asked} of them can no longer be rebuilt and are left out.` : '';
    // The wording the contract asks for: a redo is a fresh encounter and *is* counted, unlike the
    // immediate retry inside an item, which the feedback describes in its own words a moment later.
    const note = `${asked} item${asked === 1 ? '' : 's'} you missed before, most recent first.${short} Each counts towards its skill — unlike trying an item again on the spot, which never does — and getting one right takes it off the list.`;
    runSession({ runner: redo.runner, title, note, mode: 'practice', hintOpen: false, practiceLink: true, onDone: (summary) => { writeJSON(LS_SESSION, null); renderSummary(summary, params); } });
  }
  /**
   * Nothing to redo: said quietly, in the place the learner asked from — and
   * only ever said of what the data supports. Three different emptinesses,
   * and the old copy told all three as the last one, so a learner who had
   * just got a hundred generated sentences wrong was told everything they had
   * missed had since been answered right (QA M-3):
   *
   *   gone      items are still marked missed but can no longer be rebuilt
   *   unnamed   the wrong answers were on items that carry no name at all
   *   neither   nothing is outstanding: it really has all been put right
   */
  function renderNothingToRedo({ skillId = null, chapter = null, from = null, gone = 0 } = {}) {
    const where = skillId != null ? titleOf(skillId) : chapter != null ? `chapter ${roman(Number(chapter))}` : 'your practice';
    const unnamed = gone ? 0 : unnamedMissedCount({ skill: skillId, chapter });
    const ever = answeredHere({ skill: skillId, chapter });
    setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Nothing to redo' }),
      h('p', { class: 'g-lede', text: gone
        ? `The ${gone} item${gone === 1 ? '' : 's'} still marked missed in ${where} cannot be rebuilt — the sentences or the words they came from have left the library. Nothing is lost; the skills themselves come round in ordinary practice.`
        : unnamed
          ? `${unnamed} answer${unnamed === 1 ? '' : 's'} in ${where} went wrong on something that has no item to come back to — a sentence the app generated for the moment, a table from the catalogue, or a step inside a lesson. Those are re-drawn rather than re-offered: practise the skill again and you will meet the same pattern in new words. Nothing else is outstanding.`
          : ever
            ? `Everything you have missed in ${where} has since been answered right. Items come back here when one is got wrong and not yet put right.`
            : `Nothing has been missed in ${where} yet. Items come back here when one is got wrong and not yet put right.` })),
      h('div', { class: 'g-acts' }, btn('Practice', { to: ['setup', { from }], onclick: () => render('setup', { from }) }, 'btn btn--primary'), backButton(from, 'btn btn--quiet')));
  }

  /** "Practise this skill": a view of its own, so Back leaves it and a chapter page can open it through `ctx.go`. */
  const startBlocked = (id, from = null) => render('blocked', { skill: id, from });
  function renderBlocked({ skill: id, from = null }) {
    const skill = skills.get(id);
    if (!skill) return renderToday();
    const st = gstore.getState(id);
    // A skill still in Learn keeps learning (m14); a lapsed or new one enters the rotation now, so the answers that follow are not judged "early" (M1).
    if (st?.state === 'learning' && skill.set !== 'pensum') { render('learn', { skill: id, from }); return; }
    if (!inRotation(st) || decay(st).state === 'lapsed') gstore.setState(addToPractice(st ?? id));
    const practice = createBlockedFive({ skill, gstore, items, skillsIndex, currentWeekN: ctx.currentWeekN() });
    const first = practice.start();
    if (!first) { setBody(h('p', { class: 'g-quiet', text: 'No sentences fit this skill yet.' }), h('div', { class: 'g-acts' }, backButton(from))); return; }
    runSession({ runner: practice.runner, title: `Practise · ${skill.title}`, mode: 'practice', hintOpen: false, onDone: (summary) => renderSummary(summary, { preset: 'one-skill', size: 5, oneSkill: id, from }) });
  }
  /**
   * The way back from a view opened elsewhere: the chapter page it came from
   * (the shell's own route, when it has given us one), else the by-chapter view
   * of the map, else the map. Every view that can be reached from a chapter
   * carries `from`.
   */
  function leaveTo(from) {
    // A screen to go back to (2026-10-25: "when done with a game bring one back to the menu that was clicked on to get
    // to the game/practice of a table"): the view itself, in its own section, at the row it was opened from.
    if (from?.view) { goView(from.view, from.params ?? {}, WW_VIEWS.has(from.view) ? 'words' : 'grammar'); return; }
    if (from?.wordwork != null) { render('chapter', { chapter: Number(from.wordwork) }); return; }   // a drill opened from a chapter's forms goes back to its page
    // The shell's own router (`onChapterNav`): back to the chapter page, on its Grammar tab.
    if (from?.chapter != null && typeof ctx.openChapter === 'function') { ctx.openChapter(Number(from.chapter), 'grammar'); return; }
    if (from?.chapter != null) { render('chapter', { chapter: Number(from.chapter) }); return; }
    render('today');
  }
  const backLabel = (from) => (from?.view ? `← ${from.label ?? 'Back'}` : from?.wordwork != null ? `← Cap. ${roman(Number(from.wordwork))}` : from?.chapter != null ? `← Cap. ${roman(Number(from.chapter))}` : '← Today');
  const backButton = (from, cls = 'btn btn--quiet g-back') => btn(backLabel(from), { onclick: () => leaveTo(from) }, cls);
  /**
   * Keep going after a table (2026-10-25): another word of the same table; the same forms on the other conjugations or
   * declensions (its siblings: conj1 … conj4, decl1 … decl5, the adjective classes), the part kept where they have it;
   * the tables before and after it in its area's progression (easier, harder); and the lessons it is taught in.
   */
  function tableNextNode(tableId, { group = null, word = null, from = null } = {}) {
    const all = catTables;
    const t = all?.get?.(tableId);
    if (!t) return null;
    const play = (id, { w = null } = {}) => {
      const t2 = all.get(id);
      if (w) catState.word.set(id, w); else catState.word.delete(id);
      // The same part of the table where the other one has it ("present indicative" on every conjugation).
      if (group && (t2?.groups ?? []).some((g) => g.id === group)) catState.group.set(id, group);
      render('catalogue', { table: id, from, play: true });
    };
    const family = (x) => String(x).replace(/\d.*$/, '');
    const fam = family(t.id);
    // Its family (conj1 … conj4, decl1 … decl5, adj12 … adj3); a table with none (a pronoun, a numeral, deus) has the
    // other tables of its part.
    const ofFam = [...all.values()].filter((x) => x.id !== t.id && x.part === t.part && fam.length > 2 && family(x.id) === fam);
    const siblings = (ofFam.length ? ofFam : [...all.values()].filter((x) => x.id !== t.id && x.part === t.part)).slice(0, 10);
    const words = (t.stock ?? []).filter((w) => w.h !== word);
    const p = thePath();
    const area = tableArea(t.id);
    const steps = p.steps.filter((st) => st.kind === 'table' && tableArea(st.id) === area && all.has(st.id));
    const at = steps.findIndex((st) => st.id === t.id);
    const easier = at > 0 ? steps[at - 1].id : null;
    const harder = at >= 0 && at + 1 < steps.length ? steps[at + 1].id : null;
    const kind = fam === 'conj' ? 'conjugation' : fam === 'decl' ? 'declension' : fam === 'adj' ? 'adjective type' : t.part === 'pronoun' ? 'pronoun' : t.part === 'numeral' ? 'numeral' : t.part === 'noun' ? 'noun' : 'table';
    const groupLabel = group ? (t.groups ?? []).find((g) => g.id === group)?.label ?? null : null;
    const chip = (label, onclick, extra = {}) => btn(label, { onclick, ...extra }, 'g-chip');
    const nextSib = nextSibling(t, siblings);
    const nouns = t.part === 'noun';
    const rows = [
      nextSib ? h('div', { class: 'g-next__row' }, h('h3', { class: 'g-next__h', text: `The next ${kind}` }),
        h('div', { class: 'g-chips' }, chip([`▶ ${nextSib.label}`, h('span', { class: 'g-firstnext__n', text: ` · ${timesOf(`table:${nextSib.id}`)}` })], () => play(nextSib.id), { 'data-area': tableArea(nextSib.id) }))) : null,
      nouns ? h('div', { class: 'g-next__row' }, h('h3', { class: 'g-next__h', text: 'Just one case, across the declensions' }),
        h('div', { class: 'g-chips' }, caseSkills().map((x) => chip([x.label, h('span', { class: 'g-firstnext__n', text: ` · ${timesOf(`tablepart:${x.id}`)}` })], () => startSkill(x.id, 'across'))))) : null,
      words.length ? h('div', { class: 'g-next__row' }, h('h3', { class: 'g-next__h', text: 'Another word, the same table' }),
        h('div', { class: 'g-chips' }, words.slice(0, 5).map((w) => chip(w.lemma.split(/[\s,]/)[0], () => play(t.id, { w }), { lang: 'la' })))) : null,
      siblings.length ? h('div', { class: 'g-next__row' }, h('h3', { class: 'g-next__h', text: `The same${groupLabel ? ` ${groupLabel}` : ' forms'}, another ${kind}` }),
        h('div', { class: 'g-chips' }, siblings.map((x) => chip([x.label, h('span', { class: 'g-firstnext__n', text: ` · ${timesOf(`table:${x.id}`)}` })], () => play(x.id), { 'data-area': tableArea(x.id) })))) : null,
      easier || harder ? h('div', { class: 'g-next__row' }, h('h3', { class: 'g-next__h', text: 'Easier or harder' }),
        h('div', { class: 'g-chips' }, easier ? chip(`😓 Easier: ${all.get(easier).label}`, () => play(easier)) : null, harder ? chip(`😎 Harder: ${all.get(harder).label}`, () => play(harder)) : null)) : null,
      lessonsLink(t) ? h('div', { class: 'g-next__row' }, h('h3', { class: 'g-next__h', text: 'Its lessons' }), h('p', {}, 'This table is ', lessonsLink(t), '.')) : null,
    ].filter(Boolean);
    if (!rows.length) return null;
    return h('section', { class: 'g-next', 'aria-labelledby': 'g-next-h' }, h('h2', { id: 'g-next-h', class: 'g-h2', text: 'Keep going' }), rows);
  }
  /**
   * Everything the side bar offers, at the end too (2026-10-25: "put all the information at the end of a table or game as
   * well so the phone can access it"): the skill's tables, easier or harder, related, its lesson part by part, and its
   * strand; for a table, Practise only… and its strand (Keep going is already above).
   */
  function endWays(params = {}) {
    const sk = params.drill && skills.get(params.drill) && !skills.get(params.drill).set ? skills.get(params.drill) : null;
    const table = params.catalogue ?? null;
    if (!sk && !table) return null;
    const sec = (title, ...kids) => { const k = kids.flat(Infinity).filter(Boolean); return k.length ? h('details', { class: 'g-side__sec g-end__sec', open: true }, h('summary', { class: 'g-side__sum' }, h('span', { text: title })), h('div', { class: 'g-side__body' }, k)) : null; };
    const list = [...contextSections(sk, table, sec, params, { keepGoing: false }), ...progressionSections(sk, table, sec)].filter(Boolean);
    return list.length ? h('section', { class: 'g-end', 'aria-label': 'More ways to keep going' }, h('h2', { class: 'g-h2', text: 'More ways to keep going' }), list) : null;
  }
  function renderSummary(summary, params) {
    view = { name: 'summary', params };
    // One more round of each skill the session asked, and of a table practised from Tables (the "×N", practised.js).
    const tableCounted = params?.catalogue && gameCountedTable === params.catalogue;
    gameCountedTable = null;
    if (summary.total) notePractised([...summary.skills.filter((x) => skills.has(x)).map((x) => `skill:${x}`), params?.catalogue && !tableCounted ? `table:${params.catalogue}` : null]);
    // A self-graded "partly" counts towards the scheduler but is not a clean right: it is named, not folded in (m4).
    const partly = summary.partly ?? 0;
    const clean = summary.right - partly;
    const acc = summary.total ? Math.round((clean / summary.total) * 100) : 0;
    const added = summary.added ?? 0;
    // The items this session leaves missed — one row per item, the last answer to it deciding. A skill still in
    // Learn is not offered back here (a redo is logged as practice, and that would skip its criterion).
    const missed = (summary.missed ?? []).filter((m) => redoable(m.skill));
    // After a drill (§10): the skill's same-session re-test is noted (a re-test itself is not re-noted), the
    // offer for anything already due, and the reading tie-in (§13). After any session: the re-tests now due.
    const drilled = params?.drill && skills.has(params.drill) && !params.retest ? params.drill : null;
    if (drilled) noteRetestFor(drilled);
    const after = h('div', { class: 'g-after' }, params?.drill && skills.has(params.drill) ? firstNextNode(params.drill) : null, retestNode({ from: params?.from ?? null }));
    if (params?.drill && skills.has(params.drill)) tieInNode(params.drill).then((n) => { if (n) after.append(n); }).catch(() => {});
    const againLabel = params?.unlimited ? 'Keep going' : params?.mixed ? 'Another mixed set' : params?.drill ? (params.retest ? `Drill ${titleOf(params.drill)}` : 'Another ten') : params?.catalogue ? 'Back to the table' : params?.redo ? 'Another redo' : params?.chapter != null ? `Another chapter ${roman(params.chapter)} session` : 'Another session';
    const again = () => (params?.unlimited || params?.mixed ? render(params.unlimited ? 'unlimited' : 'mixed', { skill: params.drill, from: params.from ?? null })
      : params?.drill ? render('drill', { skill: params.drill, size: params.retest ? null : params.size, from: params.from ?? null }) : params?.catalogue ? render('catalogue', { table: params.catalogue, from: params.from ?? null }) : render(params?.redo ? 'redo' : 'session', params));
    setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: params?.retest ? 'Re-test over' : 'Session over' }),
      h('p', { class: 'g-lede', text: `${clean} of ${summary.total} right${partly ? `, ${partly} partly` : ''} (${acc}%) · ${summary.skills.length} skill${summary.skills.length === 1 ? '' : 's'} · ${stats.fmtMin(summary.ms)}${summary.hinted ? ` · ${summary.hinted} with a hint` : ''}.` }),
      added ? h('p', { class: 'g-quiet', text: `${summary.asked} items were asked for; ${added} more came back after a wrong answer.` }) : null,
      summary.dropped ? h('p', { class: 'g-quiet', text: `${summary.dropped} item${summary.dropped === 1 ? '' : 's'} could not be rebuilt and ${summary.dropped === 1 ? 'was' : 'were'} left out — the sentence or the word behind ${summary.dropped === 1 ? 'it has' : 'them have'} left the library.` }) : null),
      summary.wrong.length ? h('section', {}, h('h2', { class: 'g-h2', text: 'Worth another look' }), h('ul', { class: 'g-chips' }, summary.wrong.map((id) => h('li', {}, h('button', { type: 'button', class: 'g-chip', onclick: () => startBlocked(id, params?.from ?? null) }, titleOf(id), h('span', { class: 'g-chip__state', text: ' · practise' })))))) : h('p', { class: 'g-quiet', text: 'Nothing missed.' }),
      // "Redo the N you missed" (GRAMMAR-CONTRACT.md): the very items, freshly ordered, as an ordinary session.
      // The list is this session's own, so it says what just happened rather than what the whole log holds.
      missed.length ? h('p', { class: 'g-quiet', text: 'They come back as ordinary items, later: each answer counts towards its skill, and getting one right takes it off your missed list.' }) : null,
      after,
      params?.drill && skills.has(params.drill) ? h('div', { class: 'g-acts g-acts--path' }, nextOnPath(params.drill), tablePartButton(params.drill), levelButton(params.drill)) : null,
      params?.drill && skills.has(params.drill) ? suggestNode(params.drill) : null,
      params?.catalogue ? tableNextNode(params.catalogue, { group: params.group ?? null, word: params.word ?? null, from: params.from ?? null }) : null,
      endWays(params),
      h('div', { class: 'g-acts' },
        // The redo is narrowed exactly as the session was, and no further: `oneSkill` rides in the params of
        // every mixed session as the remembered choice for the "One skill" preset, so it names the session's
        // world only when that preset was the one actually used (a redo of five mixed skills is not one skill's).
        missed.length ? btn(`Redo the ${missed.length} you missed`, { to: ['redo', { misses: missed, skill: params?.skill ?? (params?.preset === 'one-skill' ? params.oneSkill : null) ?? null, chapter: params?.chapter ?? null, from: params?.from ?? null }], onclick: () => render('redo', { misses: missed, skill: params?.skill ?? (params?.preset === 'one-skill' ? params.oneSkill : null) ?? null, chapter: params?.chapter ?? null, from: params?.from ?? null }), 'aria-label': `Redo the ${missed.length} item${missed.length === 1 ? '' : 's'} you missed in this session` }, 'btn btn--primary') : null,
        btn(againLabel, { onclick: again }, `btn ${missed.length ? '' : 'btn--primary'}`.trim()),
        btn(params?.from?.chapter != null || params?.from?.view ? backLabel(params.from).replace('← ', '') : 'Skills', { onclick: () => leaveTo(params?.from ?? null) }, params?.from?.view && !missed.length ? 'btn' : 'btn btn--quiet'), btn('Stats', { to: ['stats'], onclick: () => render('stats') }, 'btn btn--quiet')));
    body.querySelector('h1')?.focus?.({ preventScroll: true });   // a keyboard session ends on the summary, not at the top of the page (G1-09)
    ctx.say(`Session over: ${summary.right} of ${summary.total} right.`);
  }

  /* ----------------------------------------------------------- runner */
  /**
   * The beat between a right answer and the next item. Long enough to read the
   * one-line feedback, short enough that the session never waits on a click
   * ("a correct answer moves the session on by itself"). Enter, the forward
   * arrow, or answering nothing at all skips it; the back arrow cancels it, and
   * stepping back is how the learner re-reads a line they missed.
   */
  /**
   * Drives one runner in the body: item → answer → feedback → on. `open`
   * sessions offer "ten more" at the end; `practiceLink` shows "Practise this
   * skill" in the feedback (a five-item set that returns here afterwards).
   *
   * Session flow (GRAMMAR-CONTRACT.md, 2026-09-06):
   * - **no answer moves on by itself**, right or wrong: the feedback is the
   *   teaching, and a right answer used to show it for 1.4 s and then take it
   *   away before it could be read. "Next" takes the focus, so Enter is still
   *   one key;
   * - a **wrong** answer additionally holds the item, with its result and its
   *   explanation, and "Try again" builds the same item fresh. The runner logs
   *   the first answer and nothing after it;
   * - **back / forward** walk the items already seen. A page is kept exactly as
   *   it was left — its inputs already disabled by `submit()` — so a step back
   *   is a replay, never a second grading. Left and right arrow keys do the
   *   same when focus is not in a field or in an input that uses them itself.
   */
  let ruleSeq = 0;   // ids for each session's 📖 panel
  function runSession({ runner, title, note = '', mode, hintOpen = false, stepper = null, lesson = null, onDone, practiceLink = false, open = false, more = null, before = null, partLink = null, onFirst = null }) {
    const wrap = h('div', { class: 'g-run' });
    // A stepper given as a function follows the run (Learn's steps): it is repainted for the slot on screen.
    const stepHolder = typeof stepper === 'function' ? h('div', { class: 'g-stepwrap' }) : null;
    const paintStepper = () => { if (stepHolder) { const n = stepper(runner.itemAt(runner.position)?.slot ?? runner.current?.slot ?? null); stepHolder.replaceChildren(...(n ? [n] : [])); } };
    const backB = btn([h('span', { 'aria-hidden': 'true', text: '←' })], { 'aria-label': 'Back to the previous item', onclick: () => go(-1) }, 'g-runnav__b');
    const fwdB = btn([h('span', { 'aria-hidden': 'true', text: '→' })], { 'aria-label': 'On to the next item', onclick: () => go(1) }, 'g-runnav__b');
    const posEl = h('span', { class: 'g-runnav__pos' });
    // Game mode for a drill (2026-10-19): the session full screen, one question large, the last one answered
    // above it and the next below; right moves on by itself, wrong turns red and empties for another try. The
    // first answer is still the one the skill counts, so a miss is still a miss to redo. Kept on the device.
    const gameBtn = btn('', { 'aria-pressed': 'false', onclick: () => setGame(!gameOn()) }, 'g-runnav__game');
    // 📖 in a drill's game (2026-10-21: "make sure this works with the game — when you play and ask how it's made"):
    // how the question's own word makes this skill's form, for its type (wordrule.js focusRule); the skill's rule
    // when the question has no one word. A second press, or the next question, puts it away.
    const ruleId = `g-rule-${++ruleSeq}`;
    const ruleBtn = btn('📖', { 'aria-label': 'How it is made', title: 'How it is made', 'aria-expanded': 'false', 'aria-controls': ruleId, onclick: () => toggleRule() }, 'g-runnav__rule');
    const rulePanel = h('section', { class: 'g-game__rule', id: ruleId, hidden: true, 'aria-label': 'How it is made' });
    // Closed whenever the page under it changes (a new question, Try again) or game mode ends.
    const closeRule = () => { rulePanel.hidden = true; rulePanel.remove(); ruleBtn.setAttribute('aria-expanded', 'false'); };
    function toggleRule() {
      if (!rulePanel.hidden && rulePanel.isConnected) { closeRule(); return; }
      const item = runner.current?.item;
      const sk = item ? skills.get(item.skill) : null;
      const entry = item?.entry ?? item?.word?.entry ?? null;
      let rule = null;
      try { if (entry) rule = focusRule(wordRule(entry, par.paradigm(entry, [])), sk); } catch { rule = null; }
      // In a lesson the step's own explanation comes first (2026-10-23: "the little lesson parts can come up when
      // the book is clicked"): the whole of it, whatever the box on the page shows.
      // A step still behind its noticing opener has not built its box yet: the step's own words stand in.
      const stepNode = wrap.querySelector('.g-page .g-step');
      const ex = stepNode?.querySelector('.g-explain') ?? stepNode?.gExplain?.() ?? null;
      const stepEx = ex ? h('div', { class: 'g-game__rulestep' }, h('p', { class: 'g-sheet__howlabel', text: 'This part of the lesson' }),
        ...[...ex.children].filter((c) => !c.classList.contains('g-explain__head')).map((c) => { const x = c.cloneNode(true); x.hidden = false; return x; })) : null;
      if (stepEx) for (const x of stepEx.querySelectorAll('[id]')) x.removeAttribute('id');
      rulePanel.replaceChildren(...[   // replaceChildren writes a null as the text "null"
        stepEx,
        rule ? ruleCard(rule, { open: true, heading: 'How this type makes it' }) : null,
        !rule && !stepEx && sk?.summary ? h('p', { class: 'g-sheet__how' }, h('span', { class: 'g-sheet__howlabel', text: 'The rule ' }), prose(sk.summary)) : null,
        !stepEx && sk ? appliesNode(sk, null, { diff: false }) : null,
        sk ? howNode(sk) : null,
        !rule && !stepEx && !sk?.summary ? h('p', { class: 'g-quiet', text: 'No rule to show for this question.' }) : null].filter(Boolean));
      rulePanel.hidden = false;
      ruleBtn.setAttribute('aria-expanded', 'true');
      wrap.prepend(rulePanel);
      rulePanel.scrollIntoView({ block: 'nearest' });
    }
    const gameStats = h('span', { class: 'g-runnav__stats', 'aria-live': 'polite' });
    let streak = 0;
    let score = 0;
    // ▦ The skill's own part of the table, as a game over this page; closing it comes back to this item.
    const partSkillAny = () => { const sid = runner.current?.item?.skill ?? runner.itemAt(runner.position)?.item?.skill ?? null; const sk = sid ? skills.get(sid) : null; return sk && !sk.set ? sid : null; };
    const partSkill = () => { const sid = runner.current?.item?.skill ?? runner.itemAt(runner.position)?.item?.skill ?? null; const sk = sid ? skills.get(sid) : null; return sk && !sk.set && sk.paradigms?.length ? sid : null; };
    const partText = h('span', { class: 'g-runnav__parttext', text: ' Its table' });
    const partB = btn([h('span', { 'aria-hidden': 'true', text: '▦' }), partText],
      { title: 'Its tables: practise its forms on every table, or on one', 'aria-label': 'Its tables: practise this skill\'s forms on every table, or on one', hidden: true,
        // A popup, not another page (2026-10-25: "when pressing the table button it should not take you to another
        // page but just a popup like the easier and harder skill have"): across every table, or one of them.
        'aria-haspopup': 'dialog', onclick: () => { const sid = partSkill(); if (!sid) return; closeRule(); openGameMenu({ skill: sid, only: 'tables' }); } }, 'g-runnav__part');
    // ▶ The skill's mixed game, from wherever it is being practised.
    const mixSkill = () => { const sid = partSkillAny(); return sid && drillable(sid) ? sid : null; };
    const mixB = btn([h('span', { 'aria-hidden': 'true', text: '▶' }), h('span', { class: 'g-runnav__parttext', text: ' Mixed game' })],
      { title: 'A mixed game: this skill with the ones it is confused with and builds on', 'aria-label': 'Play a mixed game of this skill', hidden: true, onclick: () => { const sid = mixSkill(); if (sid) { closeRule(); playMixedGame(sid); } } }, 'g-runnav__part g-runnav__mix');
    // ⇅ Too hard? Too easy? for the skill on screen, and ☰ for everywhere else without leaving game mode.
    const levelB = btn([h('span', { 'aria-hidden': 'true', text: '⇅' }), h('span', { class: 'g-runnav__parttext', text: ' Easier or harder skill?' })],
      { title: 'Easier or harder skill? (another skill, before or after this one)', 'aria-haspopup': 'dialog', 'aria-label': 'Easier or harder skill? The skills before and after this one', hidden: true, onclick: () => { const sid = partSkillAny(); if (sid) openGameMenu({ skill: sid, only: 'level' }); } }, 'g-runnav__level');
    const menuB = menuButton(() => partSkillAny());
    // ← this skill: its page, from inside any of its practice (docs/SIMPLIFY-PLAN.md §3.4).
    const skillB = btn([h('span', { 'aria-hidden': 'true', text: '←' }), h('span', { class: 'g-runnav__parttext', text: ' This skill' })],
      { title: 'This skill’s page: its lesson, parts, tables and related skills', 'aria-label': 'Go to this skill’s page', hidden: true, onclick: () => { const sid = partSkillAny(); if (sid) { closeRule(); goView('lesson', { skill: sid }); } } }, 'g-runnav__part g-runnav__skill');
    const nav = h('nav', { class: 'g-runnav', 'aria-label': 'This session' }, backB, posEl, fwdB, gameStats, skillB, levelB, partB, mixB, ruleBtn, menuB, gameBtn);
    const gameOn = () => body.classList.contains('g-game');
    const paintGame = () => {
      const on = gameOn();
      gameBtn.setAttribute('aria-pressed', String(on));
      gameBtn.replaceChildren(h('span', { 'aria-hidden': 'true', text: on ? '✕' : '▶' }), h('span', { class: 'g-runnav__gamet', text: on ? ' Leave game mode' : ' Game mode' }));
      gameBtn.setAttribute('aria-label', on ? 'Leave game mode' : 'Game mode');
      gameStats.textContent = on ? `${streak >= 2 ? `🔥 ${streak} · ` : ''}${score} pts` : '';
      ruleBtn.hidden = !on;
      menuB.hidden = !on;
      if (!on) closeRule();
    };
    function setGame(on) {
      body.classList.toggle('g-game', on);
      document.documentElement.classList.toggle('g-game-open', on);
      keepGame(on);
      paintGame();
      if (runner.current) paintNav();   // the strips, after the position is counted
      (wrap.querySelector('.g-item:not([hidden]) input, .g-item:not([hidden]) button.g-choice, .g-fb__next') ?? gameBtn).focus({ preventScroll: true });
    }
    const onGameKey = (e) => { if (e.key === 'Escape' && gameOn() && body.contains(wrap)) { e.preventDefault(); setGame(false); } };
    if (gameKey) document.removeEventListener('keydown', gameKey);   // one session's Escape at a time
    gameKey = onGameKey;
    document.addEventListener('keydown', onGameKey);
    // The question before (as it was answered) and a word on the next, either side of the one on screen.
    const prevStrip = h('p', { class: 'g-game__prev', 'aria-hidden': 'true' });
    const nextStrip = h('p', { class: 'g-game__next', 'aria-hidden': 'true' });
    function paintStrips(at = null, total = null) {
      const i = runner.position;
      const prev = i > 0 ? pages[i - 1] : null;
      const line = prev?.querySelector('.g-fb__line')?.textContent?.trim() ?? '';
      prevStrip.textContent = line;
      prevStrip.dataset.ok = prev?.dataset.result ?? '';
      prevStrip.hidden = !gameOn() || !line;
      nextStrip.textContent = at != null && total != null ? (at < total ? `Next: ${at + 1} of ${total}` : 'The last one') : '';
      nextStrip.hidden = !gameOn();
      if (gameOn()) { wrap.prepend(prevStrip); wrap.append(nextStrip); }
    }
    setBody(stepHolder ?? stepper, nav, wrap);
    const pages = [];
    // Game mode, once chosen, is how the next session opens too.
    let wantGame = false;
    try { wantGame = playGameOnce || localStorage.getItem('l103.game.drill') === '1'; } catch { wantGame = playGameOnce; }
    playGameOnce = false;
    if (wantGame) { body.classList.add('g-game'); document.documentElement.classList.add('g-game-open'); }
    paintGame();        // queue index → the rendered page, kept so a step back shows it as it was left
    /** Human position: the made items up to here, out of the made items in all (skipped slots are not counted). */
    const paintNav = () => {
      const i = runner.position;
      let at = 0;
      let total = 0;
      for (let j = 0; j < runner.length; j++) { const made = j <= runner.frontier ? !!runner.itemAt(j) : true; if (!made) continue; total += 1; if (j <= i) at += 1; }
      posEl.textContent = runner.current ? `${at} of ${total}` : `${total} of ${total}`;
      posEl.setAttribute('aria-label', `Item ${at} of ${total}`);
      backB.disabled = !runner.canBack;
      fwdB.disabled = !runner.canForward;
      nav.dataset.replay = runner.replay ? 'true' : 'false';
      partB.hidden = !partSkill();
      { const pp = skills.get(partSkill())?.paradigms ?? []; partText.textContent = ` ${acrossLabel(pp) || 'Its table'}`; }
      mixB.hidden = !mixSkill();
      skillB.hidden = !partSkillAny() || view.name === 'lesson';
      { const sid = partSkillAny(); levelB.hidden = !sid || !levelNode(sid); }
      paintStrips(at, total);   // game mode's strips follow the position, after it is counted
    };
    function finish() {
      const summary = runner.summary();
      if (open && more) {   // open-ended: ten more before the summary
        wrap.replaceChildren(h('div', { class: 'g-open' }, h('p', { class: 'g-lede', text: `${summary.right} of ${summary.total} so far.` }),
          h('div', { class: 'g-acts' }, btn('Ten more', { onclick: () => { more(); step(); } }, 'btn btn--primary'), btn('Finish', { onclick: () => onDone(summary) }, 'btn'))));
        paintNav();
        wrap.querySelector('button')?.focus({ preventScroll: true });
        return;
      }
      onDone(summary);
    }
    /** Move by one item. -1 back (a replay), +1 forward (past an answered item, whichever way it went). */
    function go(dir) {
      if (dir < 0) { if (!runner.canBack) return; runner.back(); }
      else { if (!runner.canForward) return; runner.forward(); }
      step({ announce: true });
    }
    /** Build (or rebuild, for a retry) the page for the item on screen. */
    function build(i, item, { fresh = false, keepLead = null } = {}) {
      const grown = runner.added > 0 ? `${runner.added} item${runner.added === 1 ? '' : 's'} came back after a wrong answer${runner.capped ? '. The session is full now — anything still missed comes back next time' : ''}.` : '';
      // A redo names its items, and a named item can have gone (the sentence left the library, the deck changed).
      // The runner skips those; the count on screen is smaller than the one offered, and this says why.
      const lost = runner.dropped > 0 ? `${runner.dropped} item${runner.dropped === 1 ? '' : 's'} could not be rebuilt and ${runner.dropped === 1 ? 'was' : 'were'} left out.` : '';
      const page = h('div', { class: 'g-page' });
      // A teaching step's page (Learn): the lead — say, show, worked example — sits above its check. A worked
      // example with something to ask keeps the check out of sight until it is done; a retry keeps the lead as it was.
      const lead = keepLead ? { node: keepLead, gate: false } : (before ? before(i, item, runner.itemAt(i)?.slot ?? null) : null);
      if (lead?.node) page.append(lead.node);
      const itemEl = itemNode(item, {
        title, note: [note, grown, lost].filter(Boolean).join(' '), position: i, hintOpen, onHint: () => runner.hint(),
        onAnswer: async (value) => {
          const result = await runner.answer(value);
          // A wrong answer on an input worth adjusting leaves the item live for a second guess (§3): the
          // boxes stay open and this feedback stays under them to be read and acted on.
          const live = secondGuess(item, result);
          const fb = feedbackNode(item, result, { lesson, mode, practiceLink, live,
            onNext: () => go(1),
            onRetry: result.correct ? null : () => { closeRule(); pages[i] = build(i, item, { fresh: true, keepLead: lead?.node ?? null }); wrap.replaceChildren(pages[i]); paintNav(); focusPage(pages[i]); ctx.say('Starting that one again.'); },
            onPractice: () => nested(item.skill) });
          // One verdict on screen at a time: a second guess replaces the first answer's feedback rather
          // than stacking under it. It is never taken away while the item is still answerable — the
          // pointer-dictionary reads a feedback node to know a tap item's words may be looked up again.
          page.querySelector(':scope > .g-fb')?.remove();
          if (!result.retry) { try { onFirst?.(item); } catch { /* a count is never worth a broken session */ } }
          const pl = partLink?.(item);
          if (pl) fb.append(pl);
          page.append(fb);
          page.dataset.result = result.correct ? 'ok' : 'bad';
          page.dataset.answers = String(Number(page.dataset.answers ?? 0) + 1);   // the drill game's clear checks it is still this answer
          paintNav();
          ctx.say(fb.querySelector('.g-fb__line')?.textContent ?? '');
          fb.scrollIntoView({ block: 'nearest' });
          // Nothing moves on by itself, right or wrong: the feedback is the teaching, and it was being
          // read for 1.4 s and then taken away. "Next" is focused, so Enter is still one key — except
          // where the item is live, and there the focus belongs back in the box being corrected (`submit`).
          // The one exception is a vocabulary word answered right (autoNextVocab).
          if (!live) fb.querySelector(result.correct ? '.g-fb__next' : '.g-fb__retry, .g-fb__next')?.focus({ preventScroll: true });
          autoNextVocab(fb, item, result, () => { if (runner.position === i) go(1); }, { game: gameOn() });
          if (gameOn()) {
            const clean = result.correct && !result.partial && !result.retry;
            streak = clean ? streak + 1 : result.correct ? streak : 0;
            if (clean) score += 10 + Math.min(streak, 10);
            gameSound(result.correct ? 'right' : 'wrong');
            if (!result.correct) {
              page.classList.remove('g-game__shake'); void page.offsetWidth; page.classList.add('g-game__shake');
              // Red, a moment, then empty for another go: the boxes that were wrong (every box when none is
              // marked), or — for an item whose buttons are spent — the item afresh, as "Try again" would.
              // …unless the learner has already answered again, started typing, or moved on.
              const tok = String(Number(page.dataset.answers ?? 0));
              const typed = new Map([...page.querySelectorAll('.g-item input[type="text"], .g-item textarea')].map((b) => [b, b.value]));
              setTimeout(() => {
                if (runner.position !== i || !page.isConnected || !gameOn() || page.dataset.answers !== tok || page.dataset.result !== 'bad') return;
                if (live) {
                  const wrong = [...page.querySelectorAll('.g-item input.is-wrong, .g-item textarea.is-wrong')];
                  const boxes = (wrong.length ? wrong : [...page.querySelectorAll('.g-item input[type="text"]:not([readonly]):not([disabled]), .g-item textarea:not([readonly]):not([disabled])')])
                    .filter((b) => typed.get(b) === b.value);   // a box the learner is already retyping is theirs
                  for (const b of boxes) { b.value = ''; b.dispatchEvent(new Event('input', { bubbles: true })); }
                  boxes[0]?.focus({ preventScroll: true });
                } else page.querySelector('.g-fb__retry')?.click();
              }, 900);
            }
            paintGame();
          }
          return live;
        },
      });
      page.append(itemEl);
      if (lead?.gate) {
        itemEl.hidden = true;
        lead.node.addEventListener('g-lead-done', () => { itemEl.hidden = false; itemEl.querySelector('.g-q')?.focus?.({ preventScroll: true }); itemEl.scrollIntoView?.({ block: 'nearest' }); }, { once: true });
      }
      if (fresh) page.dataset.retry = 'true';
      return page;
    }
    // The first thing to do on the page: the feedback's button, else the worked example's question, else the check's.
    const focusPage = (page) => { (page.querySelector('.g-fb__retry, .g-fb__next') ?? page.querySelector('.g-worked__ask .g-q') ?? page.querySelector('.g-item:not([hidden]) .g-q') ?? page.querySelector('.g-step__title'))?.focus?.({ preventScroll: true }); };
    function step({ announce = false } = {}) {
      closePop();
      const cur = runner.current;
      if (!cur) { finish(); return; }
      const i = runner.position;
      if (!pages[i]) pages[i] = build(i, cur.item);
      wrap.replaceChildren(pages[i]);
      closeRule();
      ctx.current = cur.item;
      paintNav();
      paintStepper();
      if (announce) ctx.say(runner.replay ? `${posEl.textContent}, already answered.` : posEl.textContent);
      // A replayed item is read, not answered, so focus stays on the arrows. The back arrow is disabled at the
      // first item, and focusing a disabled button drops focus on the body — outside `#grammar`, where the
      // section's own keydown guard means the arrow keys would never be heard again (QA, keyboard-only pass).
      if (runner.replay) { (backB.disabled ? fwdB : backB).focus({ preventScroll: true }); return; }
      focusPage(pages[i]);
    }
    // Left / right arrows step through the session, but never when focus is in a field, and never inside an
    // input that uses the arrows itself (order and match move focus along their own buttons with them).
    // The listener sits on the section's own root, not on the document: index.js stops keydown from leaving
    // `#grammar` (so the reader's letter shortcuts cannot fire from inside a drill), and a document-level
    // handler would therefore never hear an arrow pressed in a session.
    const onKey = (e) => {
      if (!wrap.isConnected) { root.removeEventListener('keydown', onKey); return; }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target;
      if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '')) return;
      if (t?.closest?.('.g-order, .g-match, .g-chart, .g-pop')) return;
      e.preventDefault();
      go(e.key === 'ArrowLeft' ? -1 : 1);
    };
    root.addEventListener('keydown', onKey);
    /** "Practise this skill": a five-item blocked set, then back to this session's place (the feedback stays where it was). */
    function nested(skillId) {
      const skill = skills.get(skillId);
      const sub = createBlockedFive({ skill, gstore, items, skillsIndex, currentWeekN: ctx.currentWeekN() });
      if (!sub.start()) { ctx.say('No more sentences for this skill right now.'); return; }
      const saved = [...wrap.childNodes];
      const subWrap = h('div', { class: 'g-run g-run--sub' });
      closeRule();
      wrap.replaceChildren(h('p', { class: 'g-sub__note', text: `A short set on ${skill.title}; the session continues afterwards.` }), subWrap);
      const subStep = () => {
        closePop();
        const cur = sub.runner.current;
        if (!cur) { wrap.replaceChildren(...saved); wrap.querySelector('.g-fb__next')?.focus({ preventScroll: true }); ctx.say('Back to the session.'); return; }
        const paint = () => {
          subWrap.replaceChildren(itemNode(cur.item, { title: `Practise · ${skill.title}`, position: sub.runner.position, hintOpen, onHint: () => sub.runner.hint(),
            onAnswer: async (value) => {
              const result = await sub.runner.answer(value);
              const live = secondGuess(cur.item, result);
              const fb = feedbackNode(cur.item, result, { lesson: null, mode: 'practice', practiceLink: false, live,
                onNext: () => { sub.runner.forward(); subStep(); },
                onRetry: result.correct ? null : paint });
              subWrap.querySelector(':scope > .g-fb')?.remove();
              subWrap.append(fb);
              ctx.say(fb.querySelector('.g-fb__line')?.textContent ?? '');
              if (!live) fb.querySelector(result.correct ? '.g-fb__next' : '.g-fb__retry, .g-fb__next')?.focus({ preventScroll: true });
              autoNextVocab(fb, cur.item, result, () => { if (sub.runner.current === cur) { sub.runner.forward(); subStep(); } });
              return live;
            } }));
          subWrap.querySelector('.g-q')?.focus?.({ preventScroll: true });
        };
        paint();
      };
      subStep();
    }
    step();
  }

  /**
   * A vocabulary word answered right moves on by itself (the learner, 2026-10-09: "when you get a vocab right
   * it should shift to the next word automatically"): the green ✓ and the dictionary line stay
   * VOCAB_NEXT_MS, then the next word comes. A wrong answer, a half-right one and every other kind of item
   * still wait for Next. Touching the page in that moment — a click, a key, a tap on the example sentence —
   * keeps it where it is, and Next is there as ever; the move never fires twice or after Next was pressed.
   */
  const VOCAB_NEXT_MS = 1100;
  function autoNextVocab(fb, item, result, next, { game = false } = {}) {
    if ((item?.kind !== 'vocab' && !game) || !result?.correct || result.partial) return;
    const line = fb.querySelector('.g-fb__line');
    const note = h('span', { class: 'g-fb__auto', text: game ? ' Next…' : ' Next word…' });
    line?.append(note);
    let timer = 0;
    // Anywhere on the page counts, not only the item: a learner reaching for the example sentence or the margin is staying.
    const stop = () => { clearTimeout(timer); note.remove(); document.removeEventListener('pointerdown', stop, true); document.removeEventListener('keydown', stop, true); };
    document.addEventListener('pointerdown', stop, true);
    document.addEventListener('keydown', stop, true);
    timer = setTimeout(() => { stop(); if (fb.isConnected) next(); }, game ? 750 : VOCAB_NEXT_MS);
  }

  function itemNode(item, { title, note = '', position, hintOpen, onHint, onAnswer }) {
    const skill = skills.get(item.skill);
    ctx.current = item;   // the item on screen (window.latinGrammar.current — tests / debugging)
    // The position moved out of the item and into the session's nav bar, where the arrows are and where it
    // stays true as the session grows: a page is kept as it was left, so a number printed on it would go stale.
    const node = h('section', { class: 'g-item', 'data-kind': item.kind, 'data-input': item.input, 'data-pos': String(position) });
    node.append(h('p', { class: 'g-item__meta' }, h('span', { class: 'g-item__title', text: title })));
    if (note) node.append(h('p', { class: 'g-quiet g-item__note', text: note }));
    node.append(h('p', { class: 'g-item__skill', text: `${skill?.title ?? item.skill}${capOf(item.skill) ? ` · ${capOf(item.skill)}` : ''} · ${KIND_LABEL[item.kind] ?? item.kind}${item.pensum ? ` ${item.pensum}` : ''}` }));
    // "Just drill it" pins the rule at the top of every item (§10), so the learner can look without leaving.
    if (item.pin) node.append(h('p', { class: 'g-pin' }, h('span', { class: 'g-lesson__tag', text: 'The rule' }), ' ', prose(item.pin)), ...[appliesNode(skills.get(item.skill), null, { diff: false })].filter(Boolean));
    // Above every question about forms, in or out of game mode: which principal part to start from, and what each
    // conjugation (or declension) does with it. Folded away once the learner folds it, for the rest of the visit.
    { const how = !item.set && item.input !== 'self' ? howNode(skills.get(item.skill), { open: howOpen }) : null;
      if (how) { how.classList.add('g-how'); how.addEventListener('toggle', () => { howOpen = how.open; }); node.append(how); } }
    // Pool exhaustion, said of the pool the item was actually drawn from: a chapter session draws that
    // chapter's sentences, so "every sentence for this skill" would be a wider claim than the truth.
    if (item.repeat) node.append(h('p', { class: 'g-quiet g-item__note', text: item.set ? 'Every item of this set has come up once; starting over.'
      : item.scope?.scope === 'own' ? `Every chapter ${roman(item.scope.chapter)} sentence for this skill has come up once; starting over.`
        : 'Every sentence for this skill has come up once; starting over.' }));
    // Where the sentence came from, when a chapter scoped the session and the chapter itself had none
    // (chapter.js "the sentence's chapter"). A reach forward is said out loud; an earlier chapter is named
    // as the ordinary, welcome thing it is. Nothing is printed when the sentence is the chapter's own.
    const scopeLine = scopeSentence(item.scope);
    if (scopeLine) node.append(h('p', { class: 'g-quiet g-item__note', text: scopeLine }));
    // A1: an item in Learn's ten says so only when it had to reach past the skill's own written sentences.
    if (item.pool === 'library-short' || item.pool === 'library') node.append(h('p', { class: 'g-quiet g-item__note', text: 'From the book — every written sentence for this skill has come up in this sitting.' }));
    // A generated sentence is labelled as such in its own words (§11): made by one of the app's patterns, not the book's.
    if (item.generated) node.append(h('p', { class: 'g-quiet g-item__note g-item__gen', text: 'A generated sentence — made from the chapter\'s own words by one of the app\'s patterns, not taken from the book.' }));
    let submitted = false;
    // Every answer box paints itself green or red (GRAMMAR-CONTRACT.md §3). A typed box does it as the
    // learner leaves it; grading paints them all, from `cellResults` — the same per-cell truth `judge`
    // folds into the item's one verdict, so a cell cannot go green here and count wrong there.
    const cellPainters = [];
    const onCells = (fn) => cellPainters.push(fn);
    // What an input does when the item is handed back for a second guess: a chart, a pensum and a bank
    // clear the boxes that went wrong and keep the ones that were right, exactly as "Start again" does.
    const reopeners = [];
    const onReopen = (fn) => reopeners.push(fn);
    /**
     * Grading closes the item's controls. Only the ones this call actually
     * closed are remembered, so handing the item back cannot *open* something
     * that was already shut for its own reason — a Check button waiting on an
     * empty box, a bank tile already used, a given cell of a scaffolded table.
     */
    let frozen = [];
    const freezable = (el) => !el.closest('.g-hint') && !el.closest('.g-hints') && !el.classList.contains('g-hintb') && !el.classList.contains('g-w') && !el.closest('.g-all-switch') && !el.closest('.g-q-en');
    const freeze = () => {
      frozen = [...node.querySelectorAll('button, input, textarea')].filter((el) => !el.disabled && freezable(el));
      for (const el of frozen) el.disabled = true;
    };
    const thaw = () => { for (const el of frozen) if (el.isConnected) el.disabled = false; frozen = []; };
    /**
     * One answer. A **wrong** answer on an input that takes a second guess
     * (`secondGuess`) hands the item straight back: the boxes open again with
     * what the learner wrote still in them, the red marks and the feedback
     * stay on screen to be read and acted on, and checking again is judged
     * afresh but written down nowhere — the runner logs the first answer only.
     * "Start again" and "Skip" are still there for the learner who wants them.
     */
    const submit = async (v) => {
      if (submitted) return;
      submitted = true;
      const cells = cellResults(item, v);
      if (cells.length) for (const paint of cellPainters) paint(cells);
      freeze();
      node.dispatchEvent(new CustomEvent('g-answered'));
      const again = await onAnswer(v);
      if (!again) return;
      submitted = false;
      thaw();
      for (const fn of reopeners) { try { fn(cells); } catch { /* an input with nothing to tidy */ } }
      // The first box still wanting an answer, which after a wrong go is the first one that went wrong.
      const back = [...node.querySelectorAll('input:not(:disabled), textarea:not(:disabled)')].find((el) => !String(el.value ?? '').trim())
        ?? node.querySelector('input:not(:disabled), textarea:not(:disabled)')
        ?? node.querySelector('.g-order__row button:not(:disabled)');
      back?.focus({ preventScroll: true });
    };
    // The hints for this item's answer boxes. `hintOpen` (Learn's guided five) forces them open, unless the
    // learner has turned hints off altogether — that choice is theirs and outranks the phase's default.
    const effMode = hintMode() === 'off' ? 'off' : (hintOpen ? 'always' : hintMode());
    const boxes = effMode === 'off' ? [] : boxHints(item, { skill, describe: describeWord });
    const boxIn = (ids) => { const want = new Set(ids.map(String)); return boxes.filter((b) => want.has(String(b.id))); };
    const shownBoxes = item.input === 'chart' ? boxIn(chartCells(item).map((c) => item.chart.cells.indexOf(c)))
      : ['inline', 'bank', 'match', 'order'].includes(item.input) ? boxes : [];
    // Decision 14: on a chart the hint may give that one cell's answer, and the answer then counts as hinted.
    // §12: every box has its own hint, and the last step of that hint gives that box's answer. A chart cell
    // gives its form, a pensum blank its word (with the stem it is written after), and a typed single box its
    // answer. A choice, a tap and a self-graded translate are left out: there the "answer" is the whole item,
    // and translate already has its own Reveal.
    const revealOf = (it) => {
      if (it.input === 'chart') return (id) => it.chart.cells[Number(id)]?.answer?.[0] ?? null;
      if (it.input === 'inline' || it.input === 'bank') return (id) => { const b = it.blanks?.[Number(id)]; const a = b?.answers?.[0]; return a == null ? null : `${b.stem ?? ''}${a}`; };
      if (['blank', 'parse', 'transform'].includes(it.kind) && Array.isArray(it.answer) && it.answer.length) return () => it.answer[0];
      return null;
    };
    const hintPanel = shownBoxes.length ? boxHintPanel(shownBoxes, { mode: effMode, onHint: () => { if (!submitted) onHint(); }, reveal: revealOf(item) }) : null;
    const hintFor = (id, opts) => hintPanel?.control(id, opts) ?? null;
    // A question line is parts where its generator gave parts (the Latin word it asks about marked as
    // Latin, the rest left English) and a plain string where it is English through and through.
    const question = (text) => h('p', { class: 'g-q', tabindex: '-1' }, Array.isArray(text) ? partsNodes(text) : String(text ?? ''));
    // The English of a question on demand (a question set, Pensum C): never shown first.
    const englishOf = (en) => (en ? h('details', { class: 'g-q-en' }, h('summary', { class: 'g-hint__s', text: 'In English' }), h('p', { class: 'g-hint__rule', text: en })) : null);
    const tapMode = item.input === 'tap';
    /**
     * A tap on a word. A right tap lights the **whole** construction it names —
     * both words of a pair, from the sentence's declared focus (`tapSpan`) — the
     * way the noticing opener does; a wrong one marks only the word tapped, and
     * the feedback says what it was. Lighting only the finger's word left half
     * the answer to "which two words are they?" unlit (N-16).
     */
    const tapPick = (i, el) => {
      if (submitted) return;
      const span = (item.accept ?? []).map(Number).includes(Number(i)) ? tapSpan(item, i) : [];
      const p = el.closest('.g-la');
      if (span.length > 1) for (const idx of span) p?.querySelector(`.g-w[data-index="${idx}"]`)?.classList.add('g-w--target', 'is-right');
      el.classList.add('is-picked');
      submit(i);
    };
    // The sentence (tap items answer by tapping); a question shows its question first, the sentence under it when it is a tap item.
    if (item.kind === 'question' || (item.kind === 'pensum' && item.pensum === 'C')) {
      // The question's own words are tappable for their entry: plan §3 promises word by word, and a `type` or
      // `choice` question used to be plain text with only whole-question English behind a disclosure (m14).
      const qNode = latin(item.prompt.question, { cls: 'g-q g-q--la' });
      qNode.tabIndex = -1;
      // `Element.append` stringifies null, so a Pensum C item (no English) printed the word "null" under its question.
      node.append(...[qNode, englishOf(item.prompt.en)].filter(Boolean));
      if (!item.prompt.la && item.meanings?.length) {
        const sw = h('label', { class: 'switch g-all-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: allMeanings ? true : null, onchange: (e) => { allMeanings = e.target.checked; const l = node.querySelector('.g-all'); if (l) l.hidden = !allMeanings; } }), h('span', { class: 'switch__ui', 'aria-hidden': 'true' }), h('span', { class: 'switch__text', text: 'Show all meanings' }));
        node.append(sw, Object.assign(glossList(item), { hidden: !allMeanings }));
      }
      if (item.prompt.la) {
        node.append(latin(item.prompt.la, { tap: tapMode ? tapPick : null, cls: tapMode ? 'g-la--tap' : '' }));
        const sw = h('label', { class: 'switch g-all-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: allMeanings ? true : null, onchange: (e) => { allMeanings = e.target.checked; const l = node.querySelector('.g-all'); if (l) l.hidden = !allMeanings; } }), h('span', { class: 'switch__ui', 'aria-hidden': 'true' }), h('span', { class: 'switch__text', text: 'Show all meanings' }));
        node.append(sw, Object.assign(glossList(item), { hidden: !allMeanings }));
      }
    } else if (item.kind === 'vocab') {
      // Vocabulary withholds the meaning by design (plan §3): the word stands alone, the dictionary line comes after.
      if (item.input === 'match') node.append(question(item.prompt.questionParts ?? item.prompt.question));
      else node.append(h('p', { class: 'g-la g-vocab__word', lang: item.word && !skill?.rev ? 'la' : null, text: skill?.rev ? item.word.meaning : item.word.lemma }), question(item.prompt.questionParts ?? item.prompt.question));
    } else if (item.kind === 'pensum') {
      node.append(question(item.prompt.question));
    } else if (item.input === 'order') {
      node.append(question(item.prompt.questionParts ?? item.prompt.question));
      if (item.prompt.gloss) node.append(glossNode(item));
    } else if (item.prompt.la) {
      node.append(latin(item.prompt.la, { target: tapMode || item.kind === 'blank' ? null : item.target?.index ?? null, tap: tapMode ? tapPick : null, cls: tapMode ? 'g-la--tap' : '' }));
      // A generated sentence's English and word-by-word gloss, on demand (§11b), like a written sentence's in Learn. The
      // gloss names the very thing a recognise or parse item asks, so opening it before answering counts as a hint
      // (decision 14); a blank withholds the form and a translate reveals the English itself, so neither offers it.
      if (item.generated && item.written && item.kind !== 'blank' && item.kind !== 'translate' && (item.written.en || item.written.gloss?.length)) {
        const en = h('details', { class: 'g-q-en g-item__en' }, h('summary', { class: 'g-hint__s', text: 'In English (counts as a hint)' }), item.written.en ? h('p', { class: 'g-hint__rule', text: item.written.en }) : null, glossLine(item.written));
        en.addEventListener('toggle', () => { if (en.open && !submitted) onHint(); });
        node.append(en);
      }
      node.append(question(item.prompt.questionParts ?? item.prompt.question));
      if (item.prompt.gloss) node.append(glossNode(item));
      const sw = h('label', { class: 'switch g-all-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: allMeanings ? true : null, onchange: (e) => { allMeanings = e.target.checked; const l = node.querySelector('.g-all'); if (l) l.hidden = !allMeanings; } }), h('span', { class: 'switch__ui', 'aria-hidden': 'true' }), h('span', { class: 'switch__text', text: 'Show all meanings' }));
      node.append(sw, Object.assign(glossList(item), { hidden: !allMeanings }));
    } else {
      node.append(question(item.input === 'chart' ? chartQuestion(item) : item.prompt.questionParts ?? item.prompt.question));
      if (item.prompt.gloss) node.append(glossNode(item));
    }
    // Input
    const latinTyped = item.kind === 'blank' || item.kind === 'transform' || item.kind === 'question' || item.kind === 'pensum' || (item.kind === 'vocab' && skill?.rev);
    if (item.input === 'choice') {
      const group = h('div', { class: 'g-choices', role: 'group', 'aria-label': 'Answers' }, item.choices.map((c, i) => btn([h('span', { class: 'g-choice__n', 'aria-hidden': 'true', text: `${i + 1}` }), h('span', { class: 'g-choice__label', lang: item.kind === 'blank' || item.kind === 'question' || (item.kind === 'vocab' && skill?.rev) ? 'la' : null, text: c.label }), c.plain ? h('span', { class: 'g-choice__plain', text: c.plain }) : null], { 'data-value': c.value, onclick: (e) => { e.currentTarget.classList.add('is-picked'); submit(c.value); } }, 'g-choice')));
      node.append(group, keyHelp('Keys 1–4 choose an answer.'));
      // After an answer the list itself says which was right, not only the prose beneath it (m13).
      node.addEventListener('g-answered', () => { for (const b of group.children) b.classList.toggle('is-answer', item.choices[[...group.children].indexOf(b)]?.correct === true); });
      node.addEventListener('keydown', (e) => { const n = Number(e.key); if (n >= 1 && n <= item.choices.length && !submitted && e.target.tagName !== 'INPUT') { e.preventDefault(); group.children[n - 1].click(); } });
    } else if (item.input === 'type') {
      const input = h('input', { type: 'text', class: 'g-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', lang: latinTyped ? 'la' : 'en', 'aria-label': item.kind === 'blank' ? 'The missing form' : 'Your answer', placeholder: item.kind === 'blank' ? 'the form (macrons optional)' : (item.prompt.placeholder ?? 'e.g. dative singular') });
      const check = btn('Check', {}, 'btn btn--primary'); check.type = 'submit';
      const form = h('form', { class: 'g-type', onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) submit(input.value); } }, input, check);
      // Like the game's box and the table (2026-10-22): a right answer is taken the moment it is typed, no Enter.
      // Only a right one — a wrong one still waits for Check, so a half-typed word is never graded.
      input.addEventListener('input', () => { if (!submitted && input.value.trim() && judge(item, input.value).correct) form.requestSubmit(check); });
      node.append(form);
      setTimeout(() => input.focus({ preventScroll: true }), 0);
    } else if (item.input === 'chart') {
      node.append(chartInput(item, submit, hintFor, { onCells, onReopen, live: ctx.live }));
    } else if (item.input === 'tap') {
      node.append(keyHelp('Tap a word in the sentence.', 'g-keys--tap'));
    } else if (item.input === 'order') {
      const w = orderInput({ chunks: item.chunks, display: item.display ?? null, scrambled: item.scrambled, onSubmit: submit, live: ctx.live });
      node.append(w.node);
      if (hintPanel) w.node.append(hintPanel.row());
      setTimeout(() => w.focus(), 0);
    } else if (item.input === 'match') {
      const w = matchInput({ pairs: item.pairs, right: item.right, onSubmit: submit, live: ctx.live, onCells });
      node.append(w.node);
      if (hintPanel) w.node.append(hintPanel.row());
      setTimeout(() => w.focus(), 0);
    } else if (item.input === 'inline') {
      node.append(inlineInput(item, submit, hintFor, { onCells, onReopen, live: ctx.live }));
    } else if (item.input === 'bank') {
      node.append(bankInput(item, submit, hintFor, { onCells, onReopen }));
    } else if (item.input === 'self') {
      node.append(selfInput(item, submit));
    }
    // Hints, one per answer box (GRAMMAR-CONTRACT.md "Hints, per answer box"). A single-box item keeps the
    // familiar disclosure under the input; a chart, a pensum, an order or a match item gets a control per box
    // and a panel under the input, so a hint never covers the box or the sentence it belongs to.
    // The paradigm behind "Tell me more" is swept for the answer like every hint string is: on a single-box
    // `blank` item one cell of the word's own table *is* the form the item wants back, and the string sweep
    // never looked at a rendered table (§7.5). A leaking cell prints an ellipsis instead — the shape stays,
    // the answer does not.
    const table = item.entry && item.kind !== 'chart' ? (() => { try { return maskParadigm(par.paradigm(item.entry, []), acceptedAnswers(item)); } catch { return null; } })() : null;
    const pt = table ? renderParadigm(table) : null;
    if (pt) pt.open = true;
    const hintOnce = () => { if (!submitted) onHint(); };
    if (hintPanel) { node.append(hintPanel.node); if (hintPanel.always) hintOnce(); }
    else if (effMode !== 'off' && boxes[0]) {
      const box = boxes[0];
      const alwaysOn = effMode === 'always';
      const body = h('div', { class: 'g-hint__body' }, hintRule(box, 0));
      const deep = () => { if (box.levels[1]) body.append(hintRule(box, 1, 'g-hint__rule g-hint__rule--deep')); if (pt) body.append(pt); };
      const more = (box.levels[1] || pt) ? btn('Tell me more', { onclick: (e) => { e.currentTarget.remove(); deep(); } }, 'g-link g-hint__more') : null;
      const hint = h('details', { class: 'g-hint', open: alwaysOn ? true : null },
        h('summary', { class: 'g-hint__s' }, h('span', { 'aria-hidden': 'true', text: 'Hint' }), h('span', { class: 'visually-hidden', text: `Hint for ${box.label}` })),
        body, more);
      hint.addEventListener('toggle', () => { if (hint.open) hintOnce(); });
      if (alwaysOn) hintOnce();
      node.append(hint);
    }
    return node;
  }

  /* ------------------------------------------------------------- hints */
  /** The learner's hint mode: *Press for a hint* (default), *Always show*, *No hints*. */
  const hintMode = () => normaliseHintMode(ctx.prefs?.().hints);
  /**
   * One hint line. `levels` is the plain string the no-leak sweep reads;
   * `levelParts` is the same line with its Latin marked, and where the hint
   * knows which fragments are Latin ("the accusative of **īnsula**") the line
   * is drawn from those, so the pointer answers on the word the way it does
   * everywhere else. A hint with no Latin in it stays plain text.
   */
  const hintRule = (box, i, cls = 'g-hint__rule') => h('p', { class: cls },
    box.levelParts?.[i] ? partsNodes(box.levelParts[i]) : String(box.levels[i] ?? ''));
  /** A word's dictionary line, for the hints on a reorder item's chips (their words cannot be tapped: tapping places them). */
  const describeWord = (form, text) => {
    try {
      const e = dict.lookup(form).entries[0];
      if (!e) return null;
      const d = dict.describe(e, { compact: true, form: text });
      return { lemma: d?.lemma ?? null, meaning: String(d?.meaning ?? '').split(/\s+·\s+/)[0] || null, parse: d?.parse ?? null };
    } catch { return null; }
  };
  /**
   * One hint per answer box for a multi-box item. Each box gets a small control
   * ("?"); the hint itself opens in a panel under the input, so it never covers
   * the box or the sentence. Level two is a second press ("Tell me more").
   * `always` shows every panel from the start and counts the answer as hinted.
   */
  function boxHintPanel(boxes, { mode, onHint, reveal = null }) {
    const always = mode === 'always';
    const uid = `gh${Math.random().toString(36).slice(2, 8)}`;
    const rows = new Map();
    const list = h('div', { class: 'g-hints', role: 'group', 'aria-label': 'Hints' });
    for (const b of boxes) {
      const body = h('div', { class: 'g-hints__body' }, hintRule(b, 0));
      // Level two stays a second press even under *Always show*: "every box shows its hint from the start" is the
      // first level, what the box is being asked for; the rule behind it is still the deeper look.
      const more = b.levels[1] ? btn('Tell me more', { onclick: (e) => { e.currentTarget.remove(); body.append(hintRule(b, 1, 'g-hint__rule g-hint__rule--deep')); } }, 'g-link g-hint__more') : null;
      // "Show this form": the one cell's answer (GRAMMAR-CONTRACT.md §3, decision 14), a second press after the
      // hint, and the box is then marked hinted like any other helped answer.
      const show = reveal ? btn('Show this form', { onclick: (e) => { const t = reveal(b.id); if (t == null) return; e.currentTarget.replaceWith(h('p', { class: 'g-hint__rule g-hint__answer' }, 'It is ', h('b', { lang: 'la', text: t }), '.')); onHint?.(); } }, 'g-link g-hint__more') : null;
      const row = h('div', { class: 'g-hints__row', id: `${uid}-${b.id}`, hidden: always ? null : true },
        h('p', { class: 'g-hints__for', text: b.label }), body, more, show);
      rows.set(String(b.id), row);
      list.append(row);
    }
    /**
     * One box's hint control. The **inline** "?" that sits beside its own box is
     * out of the tab sequence (`tabindex="-1"`): Tab runs cell to cell and the
     * last cell reaches the grade button, which is what the contract asks for
     * and what the key help beside the input has always claimed
     * (GRAMMAR-CONTRACT.md §3; §7.5 found Tab landing on cell one's own hint).
     * It stays a control — clickable, in the accessibility tree, and reachable
     * from the box itself with Alt+H. The **labelled** row form (order, match,
     * whose boxes are buttons the learner taps) sits under the input, after
     * every box, and so keeps its place in the sequence.
     */
    const control = (id, { label = false, onOpen = null, given = false, peek = null } = {}) => {
      const row = rows.get(String(id));
      const b = boxes.find((x) => String(x.id) === String(id));
      if (!row || !b) return null;
      // A given cell (§12) already shows its form: its hint keeps the why and drops "Show this form".
      if (given) row.querySelectorAll('.g-hint__more').forEach((x) => { if (x.textContent === 'Show this form') x.remove(); });
      /**
       * A cell the learner **types into** answers in place. Pressing "?" used
       * to open a panel under the input, which grew the page and slid the
       * table, the question and the learner's own hands out from under them —
       * the worst place for a jump is the moment you are reading a cell. Now
       * the press shows that cell's form *inside the cell*, and the next press
       * takes it away again: nothing below the cell moves, and the answer
       * belongs visibly to the one box that asked for it.
       *
       * The rule behind the form is not lost — it stays where a typed cell can
       * hold it, in the box's own hint text under *Always show* — because
       * `always` means "show me the reasons from the start", and filling every
       * cell with its answer is not that. So a peek is offered only when the
       * learner presses for a hint themselves.
       */
      if (peek && !always) {
        row.remove();
        return h('button', { type: 'button', class: 'g-hintb g-hintb--peek', tabindex: '-1', 'aria-pressed': 'false', 'aria-label': `Show the form for ${b.label}`,
          onclick: (e) => {
            const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
            e.currentTarget.setAttribute('aria-pressed', String(on));
            peek(on);
            // Asked for and given: the answer counts as hinted the first time it is shown, whether or not
            // the learner presses again to hide it (§3, decision 14).
            if (on) { onHint?.(); onOpen?.(); }
          } }, h('span', { 'aria-hidden': 'true', text: '?' }));
      }
      return h('button', { type: 'button', class: `g-hintb${label ? ' g-hintb--wide' : ''}`, tabindex: label ? null : '-1', 'aria-expanded': String(always), 'aria-controls': row.id, 'aria-label': `Hint for ${b.label}`,
        onclick: (e) => {
          const opening = row.hidden;
          row.hidden = !opening;
          e.currentTarget.setAttribute('aria-expanded', String(opening));
          if (opening) { onHint?.(); onOpen?.(); row.scrollIntoView({ block: 'nearest' }); }
        } },
        h('span', { 'aria-hidden': 'true', text: '?' }), label ? h('span', { 'aria-hidden': 'true', class: 'g-hintb__w', lang: 'la', text: b.label }) : null);
    };
    /** For order and match, whose boxes are buttons the learner taps: a labelled row under the input, never a mark on the chip itself. */
    const row = () => h('div', { class: 'g-hintrow' }, h('span', { class: 'g-label', text: 'Hints' }), boxes.map((b) => control(b.id, { label: true })));
    return { node: list, control, row, always };
  }

  /**
   * The green / red of one answer box, shared by every multi-box input
   * (GRAMMAR-CONTRACT.md §3). `boxes` is index → { input, wrap, mark }.
   *
   * Colour is never the only signal: the box also carries a ✓ or a ✗ beside
   * it, `aria-invalid` for a screen reader, and the live region says which box
   * and how it went as the learner leaves it. Red never blocks — the box stays
   * editable, its hint stays available, and the item is graded when the learner
   * says so.
   */
  function cellPainter(item, boxes, { live = null, labelOf = () => '' } = {}) {
    const say = (t) => { if (live) live.textContent = t; };
    /** `r` null clears the box: an empty box has not been answered, so it is neither right nor wrong. */
    const paint = (i, r) => {
      const b = boxes.get(i);
      if (!b) return;
      const el = b.input ?? b.wrap;
      el?.classList.toggle('is-right', !!r?.ok);
      el?.classList.toggle('is-wrong', !!r && !r.ok);
      if (el) { if (r) el.setAttribute('aria-invalid', String(!r.ok)); else el.removeAttribute('aria-invalid'); }
      if (b.mark) { b.mark.textContent = r ? (r.ok ? '✓' : '✗') : ''; b.mark.className = `g-cellmark${r ? (r.ok ? ' is-ok' : ' is-bad') : ''}`; }
    };
    /** Judge one box as the learner leaves it (blur, tab, Enter); an empty box is left alone. */
    const mark = (i, value, { announce = false } = {}) => {
      if (!String(value ?? '').trim()) { paint(i, null); return null; }
      const r = judgeCell(item, i, value);
      paint(i, r);
      if (announce && r) say(`${labelOf(i)}: ${r.ok ? 'right' : 'not right yet'}.`);
      return r;
    };
    const hinted = (i) => { const b = boxes.get(i); if (b?.wrap) b.wrap.dataset.hinted = 'true'; };
    return { paint, mark, hinted, all: (cells) => { for (const r of cells) if (boxes.has(r.i)) paint(r.i, r); } };
  }
  /**
   * Handing a box of typed answers back for a second guess: the boxes that
   * went wrong are emptied and lose their red, the ones that were right keep
   * what is in them and keep their green. The same rule a rebuilt chart
   * follows (N-6), so changing your answer in place and starting the item
   * again leave the learner looking at the same table.
   */
  function reopenCells(cells, inputs, painter, sync = () => {}) {
    for (const r of cells ?? []) {
      if (r.ok || r.scaffold) continue;
      const el = inputs.get(r.i);
      if (!el) continue;
      el.value = '';
      painter.paint(r.i, null);
    }
    sync();
  }

  /** Pensum A: the sentence with an input for each ending, inline after its stem. Submits { blankIndex: typed }. */
  function inlineInput(item, submit, hintFor = () => null, { onCells = null, onReopen = null, live = null } = {}) {
    const inputs = new Map();
    const hints = new Map();
    const boxes = new Map();
    // A blank showing its own ending holds the answer on screen and the learner's writing here — see the
    // chart's `peeked`, which this mirrors cell for cell.
    const peeked = new Map();
    const valueOf = (i) => (peeked.has(i) ? peeked.get(i) : inputs.get(i)?.value ?? '');
    const closePeeks = () => { for (const btnEl of hints.values()) if (btnEl.getAttribute('aria-pressed') === 'true') btnEl.click(); };
    const labelOf = (i) => item.blanks[i]?.note || `ending ${i + 1}`;
    const cells = cellPainter(item, boxes, { live, labelOf });
    // As on a chart (§3, QA M-5): a pensum is one attempt, so Check waits until something has been written.
    let syncCheck = () => {};
    // A div, not a p: each blank carries its own hint button beside it, and a button is fine in a paragraph
    // but the hint panel that follows the sentence is not — the sentence keeps its look through `.g-la`.
    const p = h('div', { class: 'g-la g-pensum', lang: 'la' });
    for (const seg of item.segments) {
      if (seg.blank == null) { p.append(seg.text); continue; }
      const b = item.blanks[seg.blank];
      if (!b) continue;
      const i = seg.blank;
      const inp = h('input', { type: 'text', class: 'g-input g-input--end', lang: 'la', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': `Ending after ${b.stem || 'the stem'}${b.note ? ` (${b.note})` : ''}`, placeholder: '…', size: String(Math.max(2, Math.min(6, (b.answers[0] ?? '').length + 1))) });
      inputs.set(i, inp);
      // Judged as the learner leaves it, cleared while they are still typing in it (§3).
      inp.addEventListener('blur', () => { if (!inp.disabled && !peeked.has(i)) cells.mark(i, inp.value, { announce: true }); syncCheck(); });
      inp.addEventListener('input', () => {
        cells.paint(i, null); syncCheck();
        // A right ending goes green as it is typed and the next blank takes the cursor; the sentence checks
        // itself once every blank is right, as the game's box moves on (2026-10-22).
        if (!judgeCell(item, i, inp.value)?.ok) return;
        cells.paint(i, judgeCell(item, i, inp.value));
        const all = [...inputs.keys()].every((k) => judgeCell(item, k, valueOf(k))?.ok);
        if (all) { form.requestSubmit(check); return; }
        const next = [...inputs.values()].find((el) => el !== inp && !el.value.trim());
        next?.focus({ preventScroll: true });
      });
      // The blank shows its own ending on a press and puts it away on the next. Only the ending: the stem is
      // already printed in the sentence in front of it, so the box holds what the box asks for.
      const ending = b.answers?.[0] ?? null;
      const peek = ending == null ? null : (on) => {
        if (on) { peeked.set(i, inp.value); inp.value = ending; inp.readOnly = true; inp.classList.add('is-peek'); cells.paint(i, null); }
        else { inp.value = peeked.get(i) ?? ''; peeked.delete(i); inp.readOnly = false; inp.classList.remove('is-peek'); }
        syncCheck();
      };
      const hint = hintFor(i, { onOpen: () => cells.hinted(i), peek });
      if (hint) hints.set(i, hint);
      const mark = h('span', { class: 'g-cellmark', 'aria-hidden': 'true' });
      // The stem is already printed: it ends the prose segment before this blank ("Rōma in Itali_ est."). Printing
      // `b.stem` here too gave every Pensum A item a doubled stem — "Rōma in ItaliItali__ est." (C1). It stays in the
      // input's aria-label, which is where a screen-reader user needs it.
      const wrap = h('span', { class: 'g-pensum__blank' }, inp, mark, hint);
      boxes.set(i, { input: inp, wrap, mark });
      p.append(wrap);
    }
    const check = btn('Check', {}, 'btn btn--primary'); check.type = 'submit';
    const needOne = h('p', { class: 'g-quiet g-chart__needone', id: 'g-pensum-needone', text: inputs.size === 1 ? 'Write the ending, then Check.' : 'Write at least one ending before checking — the sentence is one attempt, so an empty one would spend it and show every answer.' });
    check.setAttribute('aria-describedby', 'g-pensum-needone');
    syncCheck = () => { const on = anyEnding(); check.disabled = !on; needOne.hidden = on; };
    const anyEnding = () => [...inputs.keys()].some((i) => String(valueOf(i)).trim() !== '');
    const form = h('form', { class: 'g-chart', onsubmit: (e) => { e.preventDefault(); if (!anyEnding()) { needOne.hidden = false; return; } const v = {}; item.blanks.forEach((b, i) => { v[i] = valueOf(i); }); closePeeks(); submit(v); } }, p, h('div', { class: 'g-chart__acts' }, check), needOne, keyHelp('Tab moves to the next ending and marks it right or wrong; Alt+H shows that ending and hides it again; Enter checks.'));
    form.addEventListener('keydown', (e) => boxKeys(e, { inputs, hints, mark: (i) => cells.mark(i, valueOf(i), { announce: true }) }));
    syncCheck();
    onCells?.(cells.all);
    onReopen?.((r) => reopenCells(r, inputs, cells, syncCheck));
    setTimeout(() => form.querySelector('input')?.focus({ preventScroll: true }), 0);
    return form;
  }
  /**
   * The keys of a box of typed answers, shared by the chart and Pensum A:
   * **Alt+H** opens that box's own hint (the "?" beside it is deliberately out
   * of the tab sequence, so this is how a keyboard reaches it), and **Enter**
   * judges the box and then moves to the next empty one — it grades the item
   * only once every box has something in it, so a half-written chart is never
   * graded by a key the learner meant as "next" (GRAMMAR-CONTRACT.md §3).
   */
  function boxKeys(e, { inputs, hints, mark, passive = () => false }) {
    const at = [...inputs.entries()].find(([, el]) => el === e.target);
    if (!at) return;
    const [i, inp] = at;
    if (e.altKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); hints.get(i)?.click(); return; }
    // The boxes in the order they are filled: every active form before any passive one (2026-10-24: "across all
    // lessons and forms, games, charts, I want all active first then passive"), and otherwise the order **on
    // screen**. A stacked chart (§26) reads down each block in turn, so the map's own order — the order the cells
    // were built in, along the table's rows — would jump between blocks; document order is how either layout reads.
    const order = [...inputs.entries()]
      .sort(([a, x], [b, y]) => (passive(a) ? 1 : 0) - (passive(b) ? 1 : 0) || ((x.compareDocumentPosition(y) & 4 /* DOCUMENT_POSITION_FOLLOWING */) ? -1 : 1))
      .map(([, el]) => el);
    const usable = (el) => !el.disabled && !el.readOnly;
    // Tab and Shift+Tab go along that order too, so a table with an active and a passive column is filled down
    // the active column first; past either end Tab leaves the boxes as usual.
    if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey && inputs.size > 1) {
      const live = order.filter(usable);
      const to = live[live.indexOf(inp) + (e.shiftKey ? -1 : 1)];
      if (to) { e.preventDefault(); to.focus({ preventScroll: false }); }
      return;
    }
    if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey) return;
    mark(i, inp.value);
    const next = order.filter((el) => usable(el) && !el.value.trim())[0];
    if (next) { e.preventDefault(); next.focus({ preventScroll: true }); }
  }
  /** Pensum B: the sentence with word blanks and a tappable bank. Submits { blankIndex: word }. */
  function bankInput(item, submit, hintFor = () => null, { onCells = null, onReopen = null } = {}) {
    const filled = {};
    const slots = new Map();
    const hints = new Map();
    const boxes = new Map();
    const cells = cellPainter(item, boxes);
    const p = h('div', { class: 'g-la g-pensum', lang: 'la' });
    for (const seg of item.segments) {
      if (seg.blank == null) { p.append(seg.text); continue; }
      const i = seg.blank;
      const slot = h('button', { type: 'button', class: 'g-pensum__slot', lang: 'la', 'aria-label': `Blank ${i + 1}: empty`, onclick: () => { if (filled[i] != null) { delete filled[i]; paint(); } } }, '\u00a0');
      slots.set(i, slot);
      const hint = hintFor(i, { onOpen: () => cells.hinted(i) });
      if (hint) hints.set(i, hint);
      const mark = h('span', { class: 'g-cellmark', 'aria-hidden': 'true' });
      // A tapped word is not typed and is never "left", so a bank blank is not judged as it is filled — that
      // would turn the bank into a game of trying each tile. It takes its colour when the item is graded (§3).
      boxes.set(i, { input: slot, wrap: slot, mark });
      p.append(...[slot, mark, hint].filter(Boolean));
    }
    // Tiles are identified by their position in the bank, never by their text: a sentence that wants the same word
    // twice offers two tiles (sets.js builds the bank as a multiset), and disabling "by text" left Check unreachable (M3).
    const bankBtns = item.bank.map((w, t) => h('button', { type: 'button', class: 'g-order__w', lang: 'la', text: w, 'data-tile': String(t), onclick: () => { const next = item.blanks.findIndex((_, i) => filled[i] == null); if (next < 0) return; filled[next] = t; paint(); } }));
    const check = btn('Check', {}, 'btn btn--primary'); check.type = 'submit';
    const paint = () => {
      for (const [i, slot] of slots) { const t = filled[i]; const w = t == null ? null : item.bank[t]; slot.textContent = w ?? '\u00a0'; slot.classList.toggle('is-filled', w != null); slot.setAttribute('aria-label', w != null ? `Blank ${i + 1}: ${w}; tap to empty` : `Blank ${i + 1}: empty`); }
      const used = new Set(Object.values(filled));
      bankBtns.forEach((b, t) => { b.disabled = used.has(t); b.classList.toggle('is-used', used.has(t)); });
      check.disabled = item.blanks.some((_, i) => filled[i] == null);
    };
    const form = h('form', { class: 'g-chart', onsubmit: (e) => { e.preventDefault(); const v = {}; item.blanks.forEach((_, i) => { v[i] = filled[i] == null ? '' : item.bank[filled[i]]; }); submit(v); } }, p, h('div', { class: 'g-order__bank', role: 'group', 'aria-label': 'Word bank' }, bankBtns), h('div', { class: 'g-chart__acts' }, check), keyHelp('Tab to a word and press Enter to put it in the next empty blank; a filled blank empties when chosen; Alt+H on a blank opens its hint.'));
    form.addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'h' && e.key !== 'H')) return;
      const at = [...slots.entries()].find(([, el]) => el === e.target);
      if (!at) return;
      e.preventDefault();
      hints.get(at[0])?.click();
    });
    onCells?.(cells.all);
    // A second guess empties the blanks that went wrong — their tiles go back to the bank — and leaves the
    // ones that were right where they are.
    onReopen?.((r) => {
      for (const x of r ?? []) if (!x.ok) { delete filled[x.i]; cells.paint(x.i, null); }
      paint();
    });
    paint();
    setTimeout(() => bankBtns[0]?.focus({ preventScroll: true }), 0);
    return form;
  }
  /** Translate: write, reveal the English (the key words lit in the Latin), grade yourself. Submits 'right' | 'partly' | 'wrong'. */
  function selfInput(item, submit) {
    const ta = h('textarea', { class: 'g-input g-textarea', lang: 'en', rows: '2', 'aria-label': 'Your translation', placeholder: 'Your translation…', autocapitalize: 'sentences', spellcheck: 'true' });
    const reveal = btn('Reveal', {}, 'btn btn--primary');
    const wrap = h('div', { class: 'g-self' }, ta, h('div', { class: 'g-chart__acts' }, reveal));
    reveal.addEventListener('click', () => {
      reveal.disabled = true; ta.readOnly = true;
      const la = wrap.closest('.g-item')?.querySelector('.g-la');
      if (la) for (const i of item.lit ?? []) la.querySelector(`.g-w[data-index="${i}"]`)?.classList.add('g-w--target');
      const grades = h('div', { class: 'g-self__grade', role: 'group', 'aria-label': 'How close were you?' },
        btn('Right', { onclick: () => submit('right') }, 'btn'), btn('Partly', { onclick: () => submit('partly') }, 'btn'), btn('Wrong', { onclick: () => submit('wrong') }, 'btn'));
      wrap.append(h('p', { class: 'g-self__model' }, h('span', { class: 'g-lesson__tag', text: 'The book' }), ' ', item.answer[0]), h('p', { class: 'g-quiet', text: 'The lit words carry the construction. Grade yourself: the answer is logged as your own judgement.' }), grades);
      grades.querySelector('button')?.focus({ preventScroll: true });
    });
    setTimeout(() => ta.focus({ preventScroll: true }), 0);
    return wrap;
  }

  /**
   * The cells a chart item shows: all of them, or the target cell alone on a
   * phone. How many is written onto the chart (`shown`), because the attempt's
   * record of how much of the table was given cannot be read without it: a
   * phone shows one cell of a twelve-cell table and hands the other eleven to
   * the grader, which is the opposite of an unaided table and must never be
   * written down as one (session.js `chartGiven`). `chart.given` is `[]` for
   * both, so the item alone cannot tell them apart.
   */
  const chartCells = (item) => {
    const { chart } = item;
    const note = (cells) => { chart.shown = cells.length; return cells; };
    if (chart.byWord || item.catalogue) return note(chart.cells);   /* the catalogue's whole table stays whole on a phone: its box scrolls */
    if (phone() && chart.cells.length > 1) return note([chart.cells.find((c) => c.row === chart.target.row && c.col === chart.target.col) ?? chart.cells.find((c) => c.row === chart.target.row) ?? chart.cells[0]]);
    return note(chart.cells);
  };
  /** The question as asked of the cells shown ("Give the accusative singular of cāsus" when a phone shows one cell). */
  const chartQuestion = (item) => { const cells = chartCells(item); return cells.length === 1 && item.chart.cells.length > 1 ? [`Give the ${cells[0].label} of `, la(item.chart.head ?? item.lemma.split(/[\s,]/)[0])] : item.prompt.questionParts ?? item.prompt.question; };
  /**
   * The paradigm section with inputs in the cells to fill (a compact single
   * row on phones). A whole-table drill is **scaffolded** (§12): at the table's
   * level — its own remembered one, else `settings.grammar.scaffold`, `auto`
   * by default — the anchor cells are printed filled and greyed, each with its
   * own hint, and the learner fills the rest; the switch sits on the table
   * itself, and the table on screen finishes as it started. `chart.given` is
   * written onto the item so `cellResults` scores the one attempt on the
   * filled cells alone. A step's chart over words (`byWord`) has nothing to
   * give: every box is the cell being taught.
   */
  function chartInput(item, submit, hintFor = () => null, { onCells = null, onReopen = null, live = null } = {}) {
    const { chart } = item;
    const cells = chartCells(item);
    const inputs = new Map();   // index into chart.cells → input
    const hints = new Map();    // index into chart.cells → its hint control
    const boxes = new Map();
    // While a cell is showing its own form (the hint below), the box on screen holds the answer and this
    // holds what the learner had written. Everything that reads a cell reads `valueOf`, so a peeked answer
    // is never mistaken for a typed one: it is not what was filled in, and it is not what gets graded.
    const peeked = new Map();   // index → the learner's own text, while that cell is showing its answer
    const valueOf = (i) => (peeked.has(i) ? peeked.get(i) : inputs.get(i)?.value ?? '');
    const closePeeks = () => { for (const btnEl of hints.values()) if (btnEl.getAttribute('aria-pressed') === 'true') btnEl.click(); };
    const labelOf = (i) => chart.cells[i]?.label ?? `cell ${i + 1}`;
    const paintCells = cellPainter(item, boxes, { live, labelOf });
    // The scaffold (§12): only a whole table has anything to give.
    const whole = !chart.byWord && cells.length > 1;
    const tableId = whole ? tableIdOfItem(item) : null;
    const level = whole ? scaffoldLevelOf(tableId) : 'off';
    const autoAt = whole ? scaffoldAutoOf(tableId) : 80;
    const percent = whole ? scaffoldPercent(level, autoAt) : 0;
    const idOfCell = (c) => c.cellId ?? cellId(chartCellKey(item, c), chart.table?.kind) ?? null;
    // A catalogue table has no step teaching a cell, so nothing there is withheld on that account.
    // The given cells are decided once, when the item is first built, and kept on the item. A retry rebuilds
    // this input, and re-deciding here would re-read the switch: flipping it to off after a wrong answer would
    // hand back a different table from the one the first attempt was scored on (§12 — the table on screen
    // finishes as it started; the switch applies to the next one). It is also why the *variant* (§19) is read
    // here and not again: the run count advances as this very table is graded, and a retry must hand back the
    // arrangement the first attempt was scored on, not the next one.
    const given = !whole ? []
      : Array.isArray(chart.given) ? chart.given
      : scaffoldGiven(item, { percent, taught: item.catalogue ? [] : taughtCellsOf(item, skills.get(item.skill)), met: [...(metCells.get(tableId) ?? [])], cellIdOf: idOfCell, variant: scaffoldRunOf(tableId) });
    // **Practise only…** (2026-10-25: "a button that says practice only active or passive etc."): the cells outside
    // the choice are given, printed in grey and right by definition, exactly as the scaffold's are, so the attempt is
    // scored on the cells practised. The scaffold's own choice is kept apart (`baseGiven`) so a change of focus never
    // compounds it; the focus is one choice for every table, kept on this device.
    let baseGiven = Array.isArray(chart.baseGiven) ? chart.baseGiven : (chart.baseGiven = given.slice());
    const keyAt = (i) => chartCellKey(item, chart.cells[i]) ?? {};
    const focusOpts = whole ? chartFocusOptions(chart.cells.map((_, i) => keyAt(i))) : [];
    let focus = focusOpts.some((o) => o.id === chartFocus()) ? chartFocus() : 'all';
    const offCells = (f) => (f === 'all' ? [] : chart.cells.map((_, i) => i).filter((i) => offFocus(f, keyAt(i))));
    // The scaffold still gives some of the cells practised; if it would give every one of them, it gives none.
    const givenFor = (f) => {
      const off = new Set(offCells(f));
      const inGiven = baseGiven.filter((i) => !off.has(i));
      const left = chart.cells.length - off.size - inGiven.length;
      return new Set([...off, ...(left > 0 ? inGiven : [])]);
    };
    let givenSet = givenFor(focus);
    chart.given = [...givenSet];
    // A chart is **one attempt** (§3), so an empty table must not be gradeable: pressing Check on twelve blank
    // cells spent the attempt and printed the whole answer key, and one stray click destroyed the exercise
    // (QA M-5). Check waits until at least one cell has something in it and says why; Enter already waited for
    // every cell (`boxKeys`), so the button no longer promises less than the keyboard does.
    const filledAny = () => [...inputs.keys()].some((i) => String(valueOf(i)).trim() !== '');
    let syncCheck = () => {};
    // A retry keeps what was already right (N-6). "Try again" rebuilds the item, and rebuilding used to hand
    // back a blank table: two cells right and one wrong became three empty boxes, and the learner retyped
    // what they already knew. The cells judged right are memoised on the item, as the scaffold's given cells
    // are, and the rebuilt table carries them — still editable, and **still judged afresh** on the new submit
    // (`collect` reads the boxes, `cellResults` grades every one of them), never assumed right. Only the
    // cells that were wrong come back empty, and the first of those takes the focus.
    const keep = (chart.keep && typeof chart.keep === 'object') ? chart.keep : null;
    const kept = (i) => (keep && keep[i] != null ? String(keep[i]) : '');
    const rememberRight = (v) => { chart.keep = keptCells(item, v, new Set(inputs.keys())); };
    const mk = (i, label) => {
      const inp = h('input', { type: 'text', class: 'g-input g-input--cell', id: `gc-${i}`, lang: 'la', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': label, placeholder: '…', value: kept(i) });
      inputs.set(i, inp);
      // Judged as the learner leaves it — green or red at once, and red does not block: the cell stays
      // editable, its hint stays there, and the chart is graded when the learner presses Check (§3).
      inp.addEventListener('blur', () => { if (!inp.disabled && !peeked.has(i)) paintCells.mark(i, inp.value, { announce: true }); syncCheck(); });
      inp.addEventListener('input', () => { paintCells.paint(i, null); syncCheck(); });
      return inp;
    };
    // How it's made, box by box (2026-10-24: "I don't know why cantō is not cantāverō but if I had a how it's made
    // button I could see why … it is cantātus erō"): that word's own steps for that one form (wordrule.js formRule).
    // One card under the chart, for the box last asked about.
    const howBox = h('div', { class: 'g-chart__how', hidden: true, 'aria-live': 'polite' });
    let howAt = null;
    // The ? is both (2026-10-24: "maybe combine these: what it is and how it's made"): it shows the form in its box
    // and, under the chart, why the form is that — and putting the form away puts the card away too.
    const showHow = (i, on = true) => {
      const c = chart.cells[i];
      if (!on) { if (howAt === i) { howBox.hidden = true; howAt = null; } return; }
      if (!c || !chartCellKey(item, c)) return;
      const e = entryOfCell(c);
      const r = ruleOfEntry(e);
      let card = null;
      try { card = r ? formRule(r, chartCellKey(item, c)) : null; } catch { card = r; }
      if (!card) return;
      howBox.replaceChildren(
        h('p', { class: 'g-chart__howfor' }, h('span', { lang: 'la', text: c.word ?? String(e?.lemma ?? item.lemma ?? '').split(/[\s,]/)[0] }), ' · ', c.cellLabel ?? c.label ?? '', c.answer?.[0] ? [' = ', h('b', { lang: 'la', text: c.answer[0] })] : null),
        ruleCard(card, { open: true, heading: 'How it’s made' }),
        h('button', { type: 'button', class: 'btn btn--quiet', text: 'Close', onclick: () => { howBox.hidden = true; howAt = null; } }));
      howBox.hidden = false;
      howAt = i;
      howBox.scrollIntoView({ block: 'nearest' });
    };
    // Each cell that is filled in carries its own hint: four cells means four hints, each about its own cell.
    const cellIn = (i, label) => {
      const inp = mk(i, label);
      // The hint for a typed cell shows that cell's form in the box itself and takes it away on the next
      // press. `readOnly`, not `disabled`: the box keeps its place in the tab order and Alt+H still reaches
      // its hint, so the same key that showed the form puts it away again.
      const answer = chart.cells[i]?.answer?.[0] ?? null;
      const peek = answer == null ? null : (on) => {
        if (on) { peeked.set(i, inp.value); inp.value = answer; inp.readOnly = true; inp.classList.add('is-peek'); paintCells.paint(i, null); }
        else { inp.value = peeked.get(i) ?? ''; peeked.delete(i); inp.readOnly = false; inp.classList.remove('is-peek'); }
        showHow(i, on);
        syncCheck();
      };
      const hint = hintFor(i, { onOpen: () => { paintCells.hinted(i); if (!peek) showHow(i); }, peek });
      if (hint) hints.set(i, hint);
      const mark = h('span', { class: 'g-cellmark', 'aria-hidden': 'true' });
      const wrap = h('span', { class: 'g-cellwrap' }, inp, mark, hint);
      boxes.set(i, { input: inp, wrap, mark });
      return wrap;
    };
    // A given cell: printed filled and greyed, not editable, with the same hint so the learner can ask why (§12).
    const cellGiven = (i) => {
      const c = chart.cells[i];
      const hint = hintFor(i, { onOpen: () => showHow(i), given: true });
      // No visually-hidden span here: positioned inside a scrolling table it would sit past the page's right edge on a phone.
      return h('span', { class: 'g-cellwrap g-cellwrap--given' }, h('span', { class: 'g-chart__givenform', lang: 'la', text: c.answer[0] }), h('span', { class: 'visually-hidden', text: ` — ${c.label}, given` }), hint);
    };
    // Cells not shown (phones show one) and cells given are right by definition: only what was asked counts.
    const collect = () => { const v = {}; chart.cells.forEach((c, i) => { v[i] = inputs.has(i) ? valueOf(i) : c.answer[0]; }); return v; };
    const afterGrade = (v) => {
      if (!whole || !tableId) return;
      const r = cellResults(item, v);
      const filled = r.filter((x) => !x.scaffold);
      const correct = filled.every((x) => x.ok);
      const hinted = [...boxes.values()].some((b) => b.wrap?.dataset.hinted === 'true');
      // What was answered right is "met" for the next table's scaffold; auto fades or steps back.
      const met = metCells.get(tableId) ?? new Set();
      for (const x of filled) if (x.ok) { const id = idOfCell(chart.cells[x.i]); if (id) met.add(id); }
      metCells.set(tableId, met);
      if (level === 'auto') writeJSON(LS_SCAFFOLD_AUTO + tableId, scaffoldStep(autoAt, { correct, hinted }));
      // One more table of this one answered, right or wrong: the next is drawn in the next arrangement (§19).
      // Here, not on the way in, so a retry of *this* table keeps the arrangement it was scored on.
      noteScaffoldRun(tableId);
    };
    // The guard is on the submit as well as on the button: a disabled button is the visible half, and this is
    // the half that holds however the form is submitted (Enter, an assistive tech, a script) — M-5.
    // Any cell still showing its form is put back first, so the graded table is the learner's own writing
    // and nothing on screen claims to be an answer that was only being looked at.
    const form = h('form', { class: 'g-chart', onsubmit: (e) => { e.preventDefault(); if (!filledAny()) { needOne.hidden = false; if (live) live.textContent = needText; return; } const v = collect(); closePeeks(); rememberRight(v); submit(v); afterGrade(v); } });
    if (chart.byWord) {
      // One box per word (§8): the same cell asked on each stock word in turn, each judged as it is left,
      // the whole set one attempt. Every box is asked on a phone too — a single box would answer the rest.
      form.append(h('div', { class: 'g-chart__words' }, cells.map((c) => {
        const i = chart.cells.indexOf(c);
        const w = cellIn(i, c.label);
        inputs.get(i).id = `gc-${i}`;
        const es = c.word ? tableEntries(c.word) : [];
        const t = typeOf(es.find((e) => e.lemma === c.lemma) ?? es[0])?.name;
        return h('div', { class: 'g-chart__word' }, h('label', { class: 'g-chart__wlabel', for: `gc-${i}` }, h('span', { lang: 'la', class: 'g-chart__wlemma', text: c.word }), t ? h('span', { class: 'g-chart__wtype', text: ` · ${shortType(t)}` }) : null, h('span', { class: 'g-chart__wcell', text: c.cellLabel ?? c.label })), w);
      })));
    } else if (cells.length === 1) {
      const c = cells[0];
      const i = chart.cells.indexOf(c);
      form.append(h('div', { class: 'g-chart__one' }, h('label', { class: 'g-label', for: `gc-${i}` }, `${item.lemma.split(/[\s,]/)[0]} · ${c.label}`), cellIn(i, c.label)));
      inputs.get(i).id = `gc-${i}`;
    } else {
      // The note says what *this* table gives, not what the switch is set to: after a retry the two can differ,
      // because the table on screen keeps the cells it was given while the switch may have been moved (N-5).
      // Redraw the cells for a new choice (Practise only…, or Given on a table not yet checked): what was typed stays.
      const redrawCells = () => {
        const typed = new Map([...inputs.keys()].map((i) => [i, valueOf(i)]));
        closePeeks();
        inputs.clear(); hints.clear(); boxes.clear(); peeked.clear();
        givenSet = givenFor(focus);
        chart.given = [...givenSet];
        drawTables();
        for (const [i, v] of typed) if (inputs.has(i)) inputs.get(i).value = v;
        syncCheck();
        tablesBox.querySelector('input:not([readonly])')?.focus({ preventScroll: true });
      };
      if (tableId) form.append(scaffoldSwitch(tableId, { current: level, percent: chart.cells.length ? Math.round((baseGiven.length / chart.cells.length) * 100) : 0,
        onChange: (lv) => {
          if (chart.keep) return false;   // checked once already: the table finishes as it was scored (§12)
          baseGiven = scaffoldGiven(item, { percent: scaffoldPercent(lv, autoAt), taught: item.catalogue ? [] : taughtCellsOf(item, skills.get(item.skill)), met: [...(metCells.get(tableId) ?? [])], cellIdOf: idOfCell, variant: scaffoldRunOf(tableId) });
          chart.baseGiven = baseGiven;
          redrawCells();
          return true;
        } }));
      const tablesBox = h('div', { class: 'g-chart__tables' });
      const drawTables = () => {
      tablesBox.replaceChildren();
      // The sections the cells come from: one for an ordinary chart, several for a catalogue table that spans them.
      const secIdx = chart.multi ? [...new Set(chart.cells.map((c) => c.section ?? chart.section))] : [chart.section];
      for (const si of secIdx) {
        const sec = chart.table.sections[si];
        if (!sec) continue;
        const tbl = h('table', { class: 'pt g-chart__t' }, sec.title ? h('caption', { class: 'pt__caption', text: `${item.lemma}${typeOf(item.entry)?.name ? ` (${typeOf(item.entry).name})` : ''} · ${sec.title}` }) : null,
          sec.headers?.length ? h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'pt__corner', 'aria-label': 'form' }), sec.headers.map((hd) => h('th', { scope: 'col', text: hd })))) : null,
          h('tbody', {}, sec.rows.map((r, ri) => h('tr', {}, h('th', { scope: 'row', text: r.label }), r.cells.map((cell, ci) => {
            const idx = chart.cells.findIndex((c) => (c.section ?? chart.section) === si && c.row === ri && c.col === ci);
            if (idx >= 0 && givenSet.has(idx)) return h('td', { class: 'pt__cell g-chart__given' }, cellGiven(idx));
            if (idx >= 0) return h('td', { class: 'pt__cell g-chart__in' }, cellIn(idx, chart.cells[idx].label));
            return h('td', { class: `pt__cell${cell?.empty ? ' is-empty' : ''}`, lang: 'la', text: cell?.empty ? '—' : cell?.text ?? '—' });
          })))));
        // §26: the drill chart is this same table with a box in its cells, so it stacks by the same rule —
        // and stacking is what brings a cell's "?" back inside a 375px screen, where the scrolling table
        // held it past the right edge. The cells are moved, not rebuilt, so every box keeps what is in it.
        const scroll = h('div', { class: 'pt__scroll' }, tbl);
        tablesBox.append(scroll);
        fitParadigm(scroll, tbl);
      }
      const nGiven = givenSet.size;
      if (nGiven) tablesBox.append(h('p', { class: 'g-quiet g-chart__givennote', text: `${nGiven} of ${chart.cells.length} cells are given in grey; fill the ${chart.cells.length - nGiven} others. The given ones have their own hint.` }));
      };
      if (focusOpts.length > 1) {
        const seg = h('div', { class: 'g-seg g-seg--scaffold', role: 'group', 'aria-label': 'Which cells to practise' },
          focusOpts.map((o) => btn(o.label, { 'aria-pressed': String(o.id === focus), onclick: (e) => {
            if (o.id === focus) return;
            for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
            setChartFocus(o.id);
            focus = o.id;
            redrawCells();
          } }, 'g-seg__btn')));
        form.append(h('div', { class: 'g-scaffold g-focus' }, h('span', { class: 'g-label', text: 'Practise' }), seg));
      }
      form.append(tablesBox);
      drawTables();
    }
    const check = btn('Check', {}, 'btn btn--primary'); check.type = 'submit';
    const needText = inputs.size === 1 ? 'Write the form, then Check.'
      : chart.byWord ? 'Write at least one of these before checking — the set is one attempt, so an empty one would spend it and show every answer.'
      : 'Write at least one cell before checking — the table is one attempt, so an empty one would spend it and show every answer.';
    const needOne = h('p', { class: 'g-quiet g-chart__needone', id: 'g-chart-needone', text: needText });
    check.setAttribute('aria-describedby', 'g-chart-needone');
    syncCheck = () => { const on = filledAny(); check.disabled = !on; needOne.hidden = on; };
    const keptHere = [...inputs.keys()].filter((i) => kept(i)).length;
    const emptyHere = inputs.size - keptHere;
    // ▶ Play this chart (2026-10-23: "everything should be able to be put into the game mode … all the game modes
    // should work with them"): its boxes as the reel game (game.js), in whatever way to play is chosen. At the end
    // the boxes right first time are filled in and the missed ones marked wrong ('?'), and the chart is checked —
    // so a lesson counts the game as it counts the chart. In a session's game mode it starts by itself, once.
    const asked = [...inputs.keys()].filter((i) => chart.cells[i]?.answer?.length);
    // ▶ Play this whole chart (2026-10-23: "have the button say play this whole chart and then it has all of them in
    // this mood and time for all persons … and a similar thing in the game mode"): every form of each word on the
    // chart in the same tense, mood and voice — all persons and both numbers (a noun's case in both numbers) — as the
    // reel game, the chart's own boxes among them. At the end those boxes are filled from how the game went (missed
    // ones marked '?') and the chart is checked, so the lesson counts it as before; in game mode it starts by itself.
    const ruleMemo = new Map();
    // A box's own word: the entry its chart was built on (its lemma, "vocō, vocāre, vocāvī, vocātum"), never another
    // word that happens to share the spelling.
    const entryOfCell = (c) => {
      if (!c?.word) return item.entry ?? null;
      const es = tableEntries(c.word);
      return es.find((e) => e.lemma === c.lemma) ?? es.find((e) => stripMacrons(e.h) === stripMacrons(c.word)) ?? es[0] ?? item.entry ?? null;
    };
    const ruleOfEntry = (e) => { if (!e) return null; const k = `${e.h}|${e.pos}`; if (!ruleMemo.has(k)) { let r = null; try { r = wordRule(e, par.paradigm(e, [])); } catch { r = null; } ruleMemo.set(k, r); } return ruleMemo.get(k); };
    // A form's family: its key without person and number — the tense, mood and voice (or the case) it shares.
    const famOf = (k) => (k && typeof k === 'object' ? JSON.stringify(Object.entries(k).filter(([f, v]) => f !== 'person' && f !== 'number' && v != null).sort()) : null);
    const sameKey = (a, b) => !!a && !!b && JSON.stringify(Object.entries(a).filter(([, v]) => v != null).sort()) === JSON.stringify(Object.entries(b).filter(([, v]) => v != null).sort());
    /** The whole chart's cards, word after word in the chart's order, and which card is which of the chart's boxes. */
    const wholeChart = () => {
      const cards = [];
      const boxOf = new Map();   // card key → the chart's box index
      const words = [];
      for (const i of asked) { const e = entryOfCell(chart.cells[i]); if (e && !words.some((w) => w.e === e || (w.e.h === e.h && w.e.pos === e.pos))) words.push({ e, boxes: [] }); (words.find((w) => w.e.h === e?.h && w.e.pos === e?.pos) ?? { boxes: [] }).boxes.push(i); }
      for (const { e, boxes } of words) {
        let t = null;
        try { t = par.paradigm(e, []); } catch { t = null; }
        const fams = new Set(boxes.map((i) => famOf(chartCellKey(item, chart.cells[i]))).filter(Boolean));
        if (!t || !fams.size) continue;
        const head = String(e.lemma ?? e.h).split(/[\s,]/)[0];
        (t.sections ?? []).forEach((sec, si) => (sec.rows ?? []).forEach((r) => (r.cells ?? []).forEach((c, ci) => {
          if (!c || c.empty || !c.key || !fams.has(famOf(c.key))) return;
          const answers = cellAnswers(c);
          if (!answers.length) return;
          const key = `${e.h}|${e.pos}|${si}|${r.label}|${ci}`;
          let en = '';
          try { en = dict.cellMeaning?.(e, c.key) ?? ''; } catch { en = ''; }
          cards.push({ key, cue: [words.length > 1 ? wordWithType(e) : null, r.label, [sec.title, sec.headers?.[ci]].filter(Boolean).join(' ')].filter(Boolean).join(' · '), en, answers, stem: c.stem || null, ending: c.ending || null, group: `${e.h}|${si}|${ci}`, col: [sec.title, sec.headers?.[ci]].filter(Boolean).join(' '), entry: e, form: c.key });
          const box = boxes.find((i) => sameKey(chartCellKey(item, chart.cells[i]), c.key));
          if (box != null) boxOf.set(key, box);
        })));
      }
      // Anything the tables could not give (a form the word's table does not have) is still asked, as the chart has it.
      for (const i of asked) if (![...boxOf.values()].includes(i)) { const c = chart.cells[i]; const key = `box|${i}`; cards.push({ key, cue: c.label ?? `cell ${i + 1}`, en: c.en ?? '', answers: c.answer, stem: c.stem ?? null, ending: c.ending ?? null, group: 'box', entry: entryOfCell(c), form: chartCellKey(item, c) }); boxOf.set(key, i); }
      columnsFirst(cards);
      return { cards, boxOf, words: words.length };
    };
    const playChart = () => {
      if (!asked.length) return;
      closePeeks();
      const { cards, boxOf, words } = wholeChart();
      if (!cards.length) return;
      // How it's made, as on every table's game: the game opens on the rule for this skill (and, in a lesson, the
      // part's own explanation first), and each card's ? says how its own word makes its form.
      const chartSkill = skills.get(item.skill) ?? null;
      const whole0 = ruleOfEntry(cards[0].entry);
      const formsRule = whole0 ? (chartSkill ? focusRule(whole0, chartSkill) : whole0) : null;
      const lead = form.closest('.g-page')?.querySelector('.g-step');
      const say = [(lead?.querySelector('.g-step__say') ?? lead?.gExplain?.()?.querySelector('.g-step__say'))?.textContent?.trim() ?? '', lead?.querySelector('.g-explain__applies')?.textContent?.trim() ?? ''].filter(Boolean).join(' ');
      const partTitle = lead?.querySelector('.g-step__title')?.textContent?.trim() ?? '';
      const skillSteps = (howOf(chartSkill)?.steps ?? []).map((x) => ({ ...x, head: x.head === 'Start' ? 'Start (every word)' : x.head }));
      const baseRule = formsRule ?? (skillSteps.length ? { kind: '', parts: '', type: chartSkill?.title ?? '', steps: [] } : null);
      const withHow = baseRule ? { ...baseRule, steps: [...skillSteps, ...baseRule.steps] } : null;
      const chartRule = say ? { ...(withHow ?? { kind: '', parts: '' }), type: withHow?.type ?? (partTitle || chartSkill?.title || ''), steps: [{ head: partTitle ? `This part: ${partTitle}` : 'This part of the lesson', text: say }, ...(withHow?.steps ?? [])] } : withHow;
      const cardHow = (it) => { const r = ruleOfEntry(it.entry); try { return r && it.form ? formRule(r, it.form) : r; } catch { return r; } };
      playTable({ title: words > 1 ? (item.lemma ?? chart.head ?? '') : String(cards[0].entry?.lemma ?? item.lemma ?? chart.head ?? ''), subtitle: testedLine(cards), suggest: gameWays({ skill: item.catalogue ? null : item.skill ?? null, table: tableIdOfItem(item) }), items: cards, rule: chartRule, ruleFirst: !!chartRule, how: cardHow, continueLabel: 'Go on →',
        // Counted the moment the game ends (2026-10-26: "when playing the game mode it does not update that you have
        // practised that chart, table or part of lesson"): the table's ×N, the lesson part's, and the chart itself graded.
        // (A lesson's Learn already counts its part on the part's first item, so only a part practised on its own adds one here;
        // a table session's end skips the table once the game has counted it, so one round is one ×.)
        countKey: [tableIdOfItem(item) ? `table:${tableIdOfItem(item)}` : null, view.name === 'part' && view.params?.skill ? `part:${view.params.skill}:${Number(view.params.step) || 0}` : null].filter(Boolean),
        onDone: ({ firstMiss }) => {
          if (view.name === 'catalogue' && tableIdOfItem(item)) gameCountedTable = tableIdOfItem(item);
          for (const [key, i] of boxOf) { const inp = inputs.get(i); if (inp && !inp.disabled && !inp.readOnly) inp.value = firstMiss.has(key) ? '?' : chart.cells[i].answer[0]; }
          syncCheck();
          // Graded now, not only when the game is closed: leaving by one of its end buttons used to skip this.
          if (form.isConnected && filledAny() && !check.disabled) form.requestSubmit(check);
        },
        onClose: () => { if (form.isConnected && filledAny() && !check.disabled) form.requestSubmit(check); } });
    };
    const playBtn = asked.length ? btn(playLabel('Play this whole chart'), { onclick: playChart, 'aria-label': 'Play the whole chart as a game: every person and number of this tense, mood and voice' }, 'btn g-play') : null;
    if (asked.length && body.classList.contains('g-game') && !chart.autoPlayed) { chart.autoPlayed = true; setTimeout(() => { if (form.isConnected) playChart(); }, 350); }
    form.append(howBox, h('div', { class: 'g-chart__acts' }, check, playBtn), needOne, keyHelp('Tab moves to the next cell and marks the one you leave; Alt+H shows that cell’s form and hides it again; Enter checks once every cell is filled.'));
    // Said before the keys line, because it explains why boxes already have writing in them.
    if (keptHere) form.insertBefore(h('p', { class: 'g-quiet g-chart__keptnote', text: `The ${keptHere === 1 ? 'cell' : `${keptHere} cells`} you had right ${keptHere === 1 ? 'is' : 'are'} kept; ${emptyHere === 1 ? 'the empty one is the one' : `the ${emptyHere} empty ones are the ones`} that went wrong. Every cell is judged again when you check.` }), form.querySelector('.g-chart__acts'));
    form.addEventListener('keydown', (e) => boxKeys(e, { inputs, hints, mark: (i) => paintCells.mark(i, valueOf(i), { announce: true }), passive: (i) => chartCellKey(item, chart.cells[i])?.voice === 'pass' }));
    syncCheck();
    onCells?.(paintCells.all);
    // A second guess in place keeps what was right and empties what was not — the very rule the rebuilt
    // table follows (N-6), so the two ways of trying again behave alike. Every cell is judged afresh on the
    // next Check (`collect` reads the boxes, `cellResults` grades all of them), never assumed right.
    onReopen?.((cells) => reopenCells(cells, inputs, paintCells, syncCheck));
    // The first cell still to fill, which on a retry is the first one that went wrong, not the first box.
    setTimeout(() => ([...form.querySelectorAll('input')].find((el) => !String(el.value ?? '').trim()) ?? form.querySelector('input'))?.focus({ preventScroll: true }), 0);
    return form;
  }

  /**
   * The case (and number) a Latin form carries, read off the word's own
   * paradigm — used only where two forms differ by a macron alone, so the
   * feedback can say *which* two forms they are. null when the dictionary or
   * the table cannot settle it, and the caller then says only that the macron
   * is the difference.
   */
  function formLabel(form) {
    try {
      const entry = dict.lookup(form).entries[0];
      if (!entry) return null;
      const t = par.paradigm(entry, []);
      const want = String(form).normalize('NFC').toLowerCase();
      const found = new Set();
      for (const sec of t?.sections ?? []) for (const row of sec.rows ?? []) for (const c of row.cells ?? []) {
        if (!c || c.empty || !c.key?.case) continue;
        if (String(c.text ?? '').split(' / ').some((f) => f.trim().normalize('NFC').toLowerCase() === want)) found.add(`${featureLabel('case', c.key.case).name}${c.key.number ? ` ${c.key.number === 'sg' ? 'singular' : 'plural'}` : ''}`);
      }
      // Two readings are named as two (nom. and voc. sg. really are the same form); more than two says nothing useful.
      if (!found.size || found.size > 2) return null;
      const [x, y] = [...found];
      return y ? `${x.replace(/ (singular|plural)$/, '')} or ${y}` : x;
    } catch { return null; }
  }
  /**
   * A feedback line's parts as nodes: a Latin part becomes its own
   * `lang="la"` span, which `wordsOnDemand` cuts into hoverable words the first
   * time the pointer crosses it — nothing is tokenised here. An English part
   * stays a bare string, so the dictionary never opens on an English word.
   */
  const partsNodes = (parts) => parts.filter((p) => p !== '' && p != null)
    .map((p) => (typeof p === 'object' ? h('span', { lang: 'la', text: p.la }) : p));

  /* -------------------------- a vocabulary word in a sentence (task 2) */
  /**
   * Is this word in a sentence a form of that headword? The **dictionary**
   * decides, never the spelling: the form a sentence prints is usually
   * inflected, so *mēnsā* is a form of *mēnsa* and *fēlem* of *fēlēs*. A word
   * the glossary has no reading for falls back to the headword itself, which
   * at least catches the uninflected words (prepositions, conjunctions).
   */
  // The glossary's lemma is a citation, not a headword — "nāsus -ī m", "fēlēs, fēlis f" — so the
  // comparison is on the first word of each side. Macrons are ignored: the deck and the glossary do not
  // always agree on them, and a missing macron is not a different word.
  const headWord = (x) => String(x ?? '').trim().split(/[\s,]/)[0] ?? '';
  const sameWord = (a, b) => { const x = stripMacrons(headWord(a)).toLowerCase(); return !!x && x === stripMacrons(headWord(b)).toLowerCase(); };
  const isFormOf = (text, lemma) => {
    if (sameWord(text, lemma)) return true;
    try { return dict.lookup(text).entries.some((e) => sameWord(e.lemma, lemma)); } catch { return false; }
  };
  // How many of a chapter's skills are asked for their written sentences and their bank. A chapter has a
  // handful, and the point is to use what the app already has without turning one feedback line into
  // eighty-eight requests; both loaders memoise, so a second word of the same chapter costs nothing.
  const VOCAB_CTX_SKILLS = 4;
  /**
   * The sentences the app already has that could show this word, in the order
   * §2 prefers them: our own written teaching sentences, then the book's own
   * unit (the one the deck itself names, reached through the same `unitOf` a
   * question's feedback uses), then the pre-generated bank. Nothing is written
   * here and nothing is copied anywhere: every sentence is fetched at the
   * moment it is shown.
   */
  async function vocabPools(lemma, chapter, unitId) {
    const ids = [...index.skills.values()].filter((s) => Number(s.chapter) === Number(chapter)).map((s) => s.id).slice(0, VOCAB_CTX_SKILLS);
    const [written, banks] = await Promise.all([
      Promise.all(ids.map((id) => loadSentences(id).catch(() => null))),
      Promise.all(ids.map((id) => loadGenerated(id).catch(() => null))),
    ]);
    const flat = (docs) => docs.filter(Boolean).flatMap((d) => (d.sentences ?? []).map((s) => ({ la: s.la, en: s.en, chapter: d.chapter ?? Number(chapter) })));
    const unit = unitId ? unitOf(unitId) : null;
    return [
      { source: 'written', sentences: flat(written) },
      { source: 'book', sentences: unit ? [{ la: unit.la, en: unit.en ?? '', chapter: chapterOfSentence(unit) ?? Number(chapter) }] : [] },
      { source: 'generated', sentences: flat(banks) },
    ];
  }
  /**
   * The vocabulary item's "used in a sentence" block, drawn exactly as a
   * question's answering sentence is (`g-fb__ctx`, the word lit, the English
   * behind the same disclosure and never shown first). null when no sentence
   * uses the word — better nothing than an empty block.
   */
  async function vocabExampleNode(lemma, chapter, unitId) {
    if (!lemma) return null;
    const got = vocabExample({ lemma, chapter: readerChapter(), isForm: isFormOf, pools: await vocabPools(lemma, chapter, unitId) });
    if (!got) return null;
    return h('div', { class: 'g-fb__ctx' },
      h('p', { class: 'g-lesson__tag' }, `${lemma} in a sentence`, got.source === 'generated' ? ' (generated)' : null),
      latin(got.la, { target: got.lit }),
      // A sentence the learner has not reached still teaches the word; it says so rather than passing itself off
      // as chapter work they have read, in the section's own words for exactly this (`scopeSentence`).
      got.ahead && got.sentenceChapter ? h('p', { class: 'g-quiet g-fb__ahead', text: `From chapter ${roman(got.sentenceChapter)} — further on than you have read.` }) : null,
      got.en ? h('details', { class: 'g-q-en' }, h('summary', { class: 'g-hint__s', text: 'In English' }), h('p', { class: 'g-hint__rule', text: got.en })) : null);
  }

  function feedbackNode(item, result, { lesson, mode, practiceLink, onNext, onRetry = null, onPractice = null, live = false }) {
    const skill = skills.get(item.skill);
    const fb = item.feedback;
    const ok = result.correct;
    const isSet = !!item.set;
    // The dictionary's reading of a tapped word, which is the one impure thing the line needs.
    const tapped = item.input === 'tap' && !ok ? item.meanings?.find((m) => m.text === result.given) : null;
    const tappedEntry = tapped ? dict.lookup(tapped.form).entries[0] : null;
    const tapParse = tappedEntry ? dict.describe(tappedEntry, { compact: false, form: tapped.text })?.parse ?? null : null;
    // Built from parts, not interpolated, so every Latin fragment carries `lang="la"` and the pointer
    // dictionary finds it. `partsText` is the very same line as a string, for anything that wants one.
    const line = feedbackParts(item, result, fb, { rev: !!skill?.rev, parse: tapParse, formLabel });

    const unit = item.unit_id ? unitOf(item.unit_id) : null;
    const lit = fb.table ? renderParadigm(fb.table) : null;
    if (lit) lit.open = true;
    // A question's answering sentence with the answer lit, right on the feedback (the English on demand); a vocabulary word's dictionary line.
    const answerBlock = (item.kind === 'question' || (item.kind === 'pensum' && item.pensum === 'C')) && fb.sentence
      ? h('div', { class: 'g-fb__ctx' }, h('p', { class: 'g-lesson__tag', text: 'The sentence that answers it' }), latin(fb.sentence, { target: fb.lit?.length ? fb.lit : null }), fb.sentenceEn ? h('details', { class: 'g-q-en' }, h('summary', { class: 'g-hint__s', text: 'In English' }), h('p', { class: 'g-hint__rule', text: fb.sentenceEn })) : null)
      : item.kind === 'vocab' && item.input !== 'match' ? h('p', { class: 'g-fb__dict' }, h('span', { lang: 'la', class: 'entry__cite', text: item.word.lemma }), ` — ${item.word.meaning} · `, h('span', { lang: 'la', text: fb.dict }))
      : item.kind === 'vocab' ? h('ul', { class: 'g-fb__pairs' }, item.pairs.map((p) => h('li', {}, h('span', { lang: 'la', class: 'entry__cite', text: p.la }), ` — ${p.en} · `, h('span', { lang: 'la', text: p.dict }))))
      : item.kind === 'pensum' && fb.sentence ? h('div', { class: 'g-fb__ctx' }, h('p', { class: 'g-lesson__tag', text: 'Filled in' }), h('p', { class: 'g-la', lang: 'la', text: fb.sentence }))
      : item.kind === 'transform' || item.kind === 'reorder' ? h('div', { class: 'g-fb__ctx' }, h('p', { class: 'g-lesson__tag', text: 'The book\'s sentence' }), latin(fb.sentence, { target: item.kind === 'transform' ? item.target?.index ?? null : null }), fb.sentenceEn ? h('p', { class: 'g-ex__en', text: fb.sentenceEn }) : null)
      : null;
    const details = isSet && item.kind !== 'question' && item.kind !== 'pensum' ? null : h('details', { class: 'g-fb__more' }, h('summary', { class: 'g-fb__more-s', text: 'Why' }),
      h('p', { class: 'g-fb__term' }, h('b', { text: skill?.plain ?? fb.term }), ` — ${skill?.summary ?? ''}`),
      skill ? appliesNode(skill, null, { diff: false }) : null,
      h('div', { class: 'g-fb__rule' }),
      // "Reached from the skill map and from an item's feedback" (GRAMMAR-CONTRACT.md, wave 3). Inside the
      // expandable, so a keyboard Enter on Next can never land on it by accident mid-session.
      h('p', { class: 'g-fb__hist' }, navEl({ class: 'g-link', to: ['history', { skill: item.skill }], onclick: () => render('history', { skill: item.skill }) }, `How ${skill?.title ?? 'this skill'} has gone`)),
      lit ? h('div', { class: 'g-fb__pt' }, lit) : null,
      unit && !isSet && item.kind !== 'transform' && item.kind !== 'reorder' ? h('div', { class: 'g-fb__ctx' }, h('p', { class: 'g-lesson__tag', text: 'In the sentence' }), latin(unit.la, { target: item.target?.index ?? null }), unit.en ? h('p', { class: 'g-ex__en', text: unit.en }) : null)
        // A teaching step's written sentence (§1): the whole of it, with its English, once the check is answered.
        // A generated one (§11b) the same, with its gloss word by word — the whole of what the learner may want to check.
        : item.written && item.kind !== 'chart' ? h('div', { class: 'g-fb__ctx' }, h('p', { class: 'g-lesson__tag', text: item.generated ? 'In the sentence (generated)' : 'In the sentence' }), latin(item.written.la, { target: item.target?.index ?? null }), item.written.en ? h('p', { class: 'g-ex__en', text: item.written.en }) : null, glossLine(item.written)) : null);
    details?.addEventListener('toggle', async () => {
      if (!details.open) return;
      const slot = details.querySelector('.g-fb__rule');
      if (slot.childElementCount || isSet) return;
      const l = lesson ?? await lessonOf(item.skill);
      const rule = (l?.core ?? []).find((b) => b.type === 'rule');
      const conf = (l?.core ?? []).find((b) => b.type === 'confusion' && (!result.attempt?.confused_with || b.with === result.attempt.confused_with));
      if (rule) slot.append(h('p', { class: 'g-lesson__rule is-lit' }, prose(rule.text)));
      if (!ok && conf) slot.append(h('div', { class: 'g-lesson__conf' }, h('p', { class: 'g-lesson__tag', text: `Not to be confused with ${titleOf(conf.with)}` }), h('p', {}, prose(conf.text))));
    }, { once: false });
    // Green for right, red for wrong — and never colour alone. The mark (✓ / ✗ / ~) survives greyscale and a
    // black-and-white print, the line says the word, and the visually-hidden label says it again for a screen
    // reader that never sees either. `data-ok` carries the colour in grammar.css, both themes.
    const verdict = result.partial ? 'Partly right.' : ok ? 'Correct.' : 'Not right.';
    // A wrong answer holds the item and the learner tries again; only the first answer was logged, and saying so
    // is what keeps a retry from feeling like cheating (GRAMMAR-CONTRACT.md "Session flow").
    const again = result.retry
      ? h('p', { class: 'g-fb__again' }, ok
        ? 'Right this time. Your first answer to this item is the one already counted, so the skill is unchanged.'
        : live
          ? 'Change it again and check — your first answer to this item is the one already counted.'
          : 'Try it once more — your first answer to this item is the one already counted.')
      : (!ok && (live || onRetry) ? h('p', { class: 'g-fb__again', text: live
        ? 'Your answer is still there: change it and check again. Only your first answer counts towards the skill, so a second go costs nothing.'
        : 'Have another go. Only your first answer counts towards the skill, so trying again costs nothing.' }) : null);
    // The word used in a sentence, right or wrong (§2): fetched when the feedback lands, dropped in when it
    // arrives, and nothing at all when no sentence uses the word. A match item asks about four words at once, so
    // it gets the sentence for the pair that went wrong — the one that wants the context — and none when all four
    // were right, where the four dictionary lines already stand.
    const ctxWord = item.kind !== 'vocab' ? null
      : item.input !== 'match' ? { lemma: item.word?.lemma ?? null, unitId: item.unit_id ?? null }
        : (() => { const miss = (result.cells ?? []).find((c) => !c.ok); return miss ? { lemma: miss.la, unitId: null } : null; })();
    const vocabCtx = ctxWord?.lemma ? h('div', { class: 'g-fb__use' }) : null;
    if (vocabCtx) vocabExampleNode(ctxWord.lemma, item.chapter ?? skill?.chapter ?? null, ctxWord.unitId)
      .then((n) => { if (n && vocabCtx.isConnected) vocabCtx.replaceChildren(n); })
      .catch(() => { /* no sentence to show, and nothing is the right thing to show */ });
    const node = h('div', { class: 'g-fb', 'data-ok': String(ok), 'data-partial': result.partial ? 'true' : null, 'data-retry': result.retry ? 'true' : null },
      h('p', { class: 'g-fb__line' }, h('span', { class: 'g-fb__mark', 'aria-hidden': 'true', text: ok ? (result.partial ? '~' : '✓') : '✗' }), h('span', { class: 'visually-hidden', text: `${verdict} ` }), ' ', partsNodes(line)),
      answerBlock,
      vocabCtx,
      isSet && item.kind !== 'question' && item.kind !== 'pensum' ? null : details,
      again,
      h('div', { class: 'g-fb__acts' },
        // Three things to do with an item that went wrong, now that the item itself stays live: change the
        // answer where it stands (no button — the boxes are open), start the same item over, or skip it.
        !ok && onRetry ? btn(live ? 'Start again' : 'Try again', { onclick: onRetry }, 'btn btn--quiet g-fb__retry') : null,
        btn(ok ? 'Next' : live ? 'Skip' : 'Move on', { onclick: onNext, 'aria-label': ok ? 'Next item' : 'Move on to the next item without getting this one right' }, `btn ${ok ? 'btn--primary' : 'btn--quiet'} g-fb__next`),
        practiceLink && mode === 'practice' && onPractice ? btn(`Practise ${skill?.title ?? 'this skill'}`, { onclick: onPractice }, 'btn btn--quiet') : null));
    return node;
  }

  /* ------------------------------------------------------------ today */
  /**
   * The Today card (today.js): the plan's lines with a Start each and "Not
   * today" to dismiss it for the day. `place` 'map' (the Grammar map, inside
   * its Today section) or 'weeks' (the weeks menu, main.js: with the reading
   * line from `unread` / `pace`). `bare` = the lines only, no heading.
   */
  function todayCard({ place = 'map', bare = false, unread = 0, pace = null } = {}) {
    const now = Date.now();
    const plan = buildToday({ states: gstore.getStates(), skills, currentWeek: ctx.currentWeekSkills(), weekChapter: ctx.currentChapter?.() ?? null, weekId: ctx.currentWeekId?.() ?? null, attempts: gstore.getAttempts(), unread: place === 'weeks' ? unread : 0, pace, now, dismissed: ctx.settings?.todayDismissed ?? null, drillable: ctx.items ? drillable : null });
    // The day is read at click time, not at render: the map is a long-lived node, and dismissing at 00:01 a card
    // drawn at 23:58 used to store yesterday's date, so the card came straight back (m8).
    const repaint = () => { if (place === 'map') { draw(); return; } const next = todayCard({ place, bare, unread, pace }); const holder = node.parentNode; if (next) node.replaceWith(next); else { node.remove(); if (holder && holder.id === 'weeks-today') holder.hidden = true; } };
    const dismiss = async () => {
      const ok = await ctx.saveSetting?.({ todayDismissed: localDay(Date.now()) });
      // A failed save was announced as a success, and the card came back on reload with no explanation (m20).
      ctx.say(ok === false ? 'Today\'s plan could not be hidden; it will be here next time.' : 'Today\'s plan hidden for today.');
      if (ok !== false) repaint();
    };
    const restore = async () => { await ctx.saveSetting?.({ todayDismissed: null }); repaint(); };
    if (plan.dismissed) {
      if (place === 'weeks') return null;
      return h('p', { class: 'g-today__line g-quiet' }, 'The plan is put away for today. ', h('button', { type: 'button', class: 'g-link', onclick: restore }, 'Show it'));
    }
    const go = (action) => { if (!action) return; if (place === 'weeks') { document.getElementById('weeks')?.close?.(); ctx.go?.(action.view, action.params ?? {}); } else render(action.view, action.params ?? {}); };
    const rows = plan.lines.map((l) => h('li', { class: 'g-plan__row', 'data-kind': l.kind },
      // The plan's own word for the line ("Continue learning", "Re-learn") is chosen by the skill's state,
      // so the label explains the state behind it — the same panel as the row it came from.
      h('span', { class: 'g-plan__label' }, l.skill && skills.has(l.skill)
        ? stateTipButton(titleOf(l.skill), stateOf(l.skill), { shown: dueText(stateOf(l.skill), now), text: l.label, where: 'plan' })
        : l.label),
      h('span', { class: 'g-plan__detail' }, l.skill && skills.has(l.skill) ? [capTag(l.skill), ' '] : null, l.detail, l.minutes != null ? h('span', { class: 'g-plan__min', text: ` · ${fmtMinutes(l.minutes)}` }) : null),
      btn(l.kind === 'read' ? 'Read' : 'Start', { onclick: () => go(l.action), 'aria-label': `${l.kind === 'read' ? 'Read' : 'Start'}: ${l.label} — ${l.detail}` }, `btn g-plan__go${l.kind === 'learn' || (l.kind === 'practice' && !plan.lines.some((x) => x.kind === 'learn')) ? ' btn--primary' : ''}`)));
    const node = h('section', { class: `g-plan${bare ? '' : ' g-plan--card'}`, 'aria-label': bare ? null : 'Today' },
      // "Today · about 109 min" read as a quota. The lines are a day's share now, and the total says what it is (GRAMMAR-PLAN §5: never forced).
      bare ? null : h('h3', { class: 'g-plan__h' }, 'Today', plan.minutes ? h('span', { class: 'g-plan__total', text: ` · about ${Math.round(plan.minutes)} min if you do it all` }) : null),
      rows.length ? h('ul', { class: 'g-plan__list' }, rows) : h('p', { class: 'g-today__line g-quiet', text: place === 'weeks' ? 'Nothing suggested for today — open Grammar to start a skill or add one to practice.' : 'Nothing suggested for today. Start a skill as new below, or add one to mixed practice.' }),
      h('p', { class: 'g-plan__foot' }, bare && plan.minutes ? h('span', { class: 'g-quiet', text: `${fmtMinutes(plan.minutes)} in all · ` }) : null, h('button', { type: 'button', class: 'g-link', onclick: dismiss }, 'Not today')));
    return node;
  }

  /* ------------------------------------------------------------ stats */
  /** How many of a skill's attempts the history view reads at most: a long log is windowed, never walked whole on a phone. */
  const HISTORY_WINDOW = 400;
  const HISTORY_DAYS = 21;

  function renderStats() {
    const now = Date.now();
    const ids = [...skills.keys()];
    const states = gstore.getStates();
    const attempts = gstore.getAttempts();
    const by = stats.byState(new Map(ids.map((id) => [id, stateOf(id)])), ids);
    const t = stats.totals(attempts, now);
    const days = stats.perDay(attempts, { days: 7, now }).filter((d) => d.items);
    const per = stats.perSkill(attempts, ids);
    const pairs = stats.confusionPairs(gstore.getConfusions(), skills);
    const dl = (label, value) => [h('dt', { text: label }), h('dd', { text: String(value) })];
    setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Stats' }), h('p', { class: 'g-lede', text: 'Grammar only — the reading study log is in Settings.' }),
      h('p', { class: 'g-acts' }, btn('📊 Practice chart, by chapter', { to: ['chart', {}], onclick: () => render('chart', {}) }, 'btn btn--quiet g-chartlink'))),
      // The tally runs over the map *and* the chapter sets, so it reaches 96 where the Progress page
      // says "of 88". The heading names both populations and the line names both tallies (QA-B7, N-22).
      h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: ctx.sets?.size ? 'Skills and chapter sets' : 'Skills' }),
        h('p', { class: 'g-quiet', text: tallyDenominator(index.skills.size, ctx.sets?.size ?? 0) }),
        h('dl', { class: 'g-dl' }, ['mastered', 'practising', 'learning', 'lapsed', 'new'].map((s) => dl(cap(s), by[s])))),
      h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Items' }),
        h('dl', { class: 'g-dl' }, dl('Today', t.today ? `${t.today} · ${stats.fmtPct(t.accToday)} right` : '0'), dl('Last 7 days', t.week ? `${t.week} · ${stats.fmtPct(t.accWeek)} right` : '0'), dl('All time', t.all ? `${t.all} · ${stats.fmtPct(t.accAll)} right · ${stats.fmtMin(t.ms)}` : '0')),
        days.length ? h('table', { class: 'study__table g-table' }, h('caption', { class: 'visually-hidden', text: 'Items per day, last 7 days' }),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Day' }), h('th', { scope: 'col', class: 'study__num', text: 'Items' }), h('th', { scope: 'col', class: 'study__num', text: 'Right' }))),
          h('tbody', {}, [...days].reverse().map((d) => h('tr', {}, h('th', { scope: 'row', text: fmtDay(d.day) }), h('td', { class: 'study__num', text: String(d.items) }), h('td', { class: 'study__num', text: stats.fmtPct(Math.round((d.right / d.items) * 100)) }))))) : h('p', { class: 'g-quiet', text: 'No items in the last seven days.' })),
      confusionSection(pairs),
      h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Per skill · last 10' }),
        h('ul', { class: 'g-perskill' }, ids.filter((id) => per.get(id)?.total).map((id) => { const p = per.get(id); return h('li', { class: 'g-perskill__row' },
          h('span', { class: 'g-perskill__name' }, h('span', { class: 'g-dot', 'data-state': stateOf(id).state, 'aria-hidden': 'true' }), navEl({ class: 'g-link', to: ['history', { skill: id }], onclick: () => render('history', { skill: id }), 'aria-label': `History of ${titleOf(id)}` }, titleOf(id))),
          h('span', { class: 'g-perskill__dots', 'aria-label': `${p.right} of ${p.recent.length} right` }, p.recent.map((a) => h('span', { class: `g-tick${a.correct ? ' is-ok' : ''}${a.hinted ? ' is-hinted' : ''}`, 'aria-hidden': 'true', text: a.correct ? '✓' : '✗' }))),
          h('span', { class: 'g-perskill__acc', text: `${p.right} of ${p.recent.length}${p.hinted ? ` · ${p.hinted} hinted` : ''}` })); })),
        ids.every((id) => !per.get(id)?.total) ? h('p', { class: 'g-quiet', text: 'Nothing practised yet.' }) : null));
  }

  /**
   * "What you mix up": the top confusion pairs, each with a plain-words line
   * saying what separates the two and a Start that practises exactly those two
   * skills, alternating (GRAMMAR-CONTRACT.md, wave 3). The reason comes from
   * the lessons' own confusion blocks where they have one, so it arrives after
   * the fetch; the pair's own `plain` glosses stand in the meantime.
   */
  function confusionSection(pairs) {
    const section = h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'What you mix up' }));
    if (!pairs.length) {
      section.append(h('p', { class: 'g-quiet', text: 'Nothing yet. When a wrong answer names another skill — an ablative answered as a dative, a result clause taken for a purpose clause — the pair is counted here, with a way to practise the two against each other.' }));
      return section;
    }
    section.append(h('p', { class: 'g-quiet', text: 'The pairs your answers have crossed, most often first. Ten items alternating the two is what tells them apart.' }));
    section.append(h('ul', { class: 'g-pairs' }, pairs.map((c) => {
      const a = skills.get(c.a);
      const b = skills.get(c.b);
      // The reason is lesson prose, so it carries the lessons' own emphasis (*servīs* set in Latin italics).
      const why = h('p', { class: 'g-pair__why' }, prose(stats.confusionReason(a, b, {})));
      // The lessons say it better than the glosses do; they are fetched once and swapped in.
      Promise.all([lessonOf(c.a), lessonOf(c.b)])
        .then(([lessonA, lessonB]) => { why.replaceChildren(prose(stats.confusionReason(a, b, { lessonA, lessonB }))); })
        .catch(() => { /* the gloss line already stands */ });
      const direction = c.ba
        ? `${c.ab} × ${titleOf(c.a)} answered as ${titleOf(c.b)} · ${c.ba} the other way round`
        : `${c.ab} × ${titleOf(c.a)} answered as ${titleOf(c.b)}`;
      // The count is its own line-box, not a " · 5 times" tail: as a tail it wrapped and the next line
      // began with the separator (QA-B8). It sits beside the names, and under them when they fill the row.
      return h('li', { class: 'g-pair' },
        h('p', { class: 'g-pair__names' },
          h('span', { class: 'g-pair__who' },
            navEl({ class: 'g-link', to: ['history', { skill: c.a }], onclick: () => render('history', { skill: c.a }) }, titleOf(c.a)),
            ' and ',
            navEl({ class: 'g-link', to: ['history', { skill: c.b }], onclick: () => render('history', { skill: c.b }) }, titleOf(c.b))),
          h('span', { class: 'g-pair__count', text: `${c.count} time${c.count === 1 ? '' : 's'}` })),
        why,
        h('p', { class: 'g-pair__dir g-quiet', text: direction }),
        h('div', { class: 'g-pair__acts' },
          btn('Start', { to: ['session', { pair: [c.a, c.b], size: 10 }], onclick: () => render('session', { pair: [c.a, c.b], size: 10 }), 'aria-label': `Practise ${titleOf(c.a)} against ${titleOf(c.b)}: ten items` }, 'btn'),
          h('span', { class: 'g-quiet', text: 'ten items, these two only' })));
    })));
    return section;
  }

  /**
   * The confusion pair's session: a plan that alternates the two skills and
   * nothing else. It is not kept in LS_SESSION — Back or a reload
   * builds a fresh ten on the same pair, which is what the Start promises;
   * only the mixed practice session is worth resuming mid-queue.
   */
  function startPair(pair, size = 10) {
    const [a, b] = pair;
    if (!skills.has(a) || !skills.has(b)) { render('stats'); return; }
    // Both must be answerable before they can be practised; a lapsed or new row joins the rotation now, so the
    // answers that follow are judged as practice rather than as an early review (as startBlocked does, M1).
    // Unlike startBlocked this does not divert a *learning* skill back into Learn: the learner asked for the
    // pair, and half a pair is not a session (G3-12).
    for (const id of [a, b]) {
      if (!drillable(id)) {
        setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Not yet' }), h('p', { class: 'g-lede', text: `${titleOf(id)} has no sentences in the library to drill, so the pair cannot be practised together yet.` })),
          h('div', { class: 'g-acts' }, btn('Back to stats', { to: ['stats'], onclick: () => render('stats') }, 'btn')));
        return;
      }
      const st = gstore.getState(id);
      if (!inRotation(st) || decay(st).state === 'lapsed') gstore.setState(addToPractice(st ?? id));
    }
    const plan = buildPairSession({ a, b, states: gstore.getStates(), skills, size, seed: Math.floor(Math.random() * 1e9) });
    // `fill: null`: nothing but these two ever enters — the Start promised so. `pair` is what lets a miss
    // come back at all: the plan alternates, so the re-queue arrives as the pair itself (G3-04).
    const practice = createPractice({ plan, gstore, items, skillsIndex, currentWeekN: ctx.currentWeekN(), preset: 'even', size, rand: Math.random, fill: null, pair: [a, b] });
    const first = practice.start();
    if (!first) { setBody(h('p', { class: 'g-quiet', text: 'No sentences fit these two skills yet.' }), h('div', { class: 'g-acts' }, btn('Back to stats', { to: ['stats'], onclick: () => render('stats') }, 'btn'))); return; }
    ctx.say(`${titleOf(a)} against ${titleOf(b)}: ${plan.length} items.`);
    runSession({ runner: practice.runner, title: `${titleOf(a)} · ${titleOf(b)}`, note: 'The two alternate: the same forms, asked either way round.', mode: 'practice', hintOpen: false, practiceLink: true, onDone: (summary) => renderSummary(summary, { pair: [a, b], size }) });
  }

  /* ---------------------------------------------------------- history */
  /**
   * One skill's own page (GRAMMAR-CONTRACT.md, wave 3): how the attempts went,
   * how stability and stage moved, the last twenty items with the learner's own
   * answers beside the right ones, and the skill's confusions. Everything is
   * read from `drill_attempts` and `confusions` — no new tables — and the log
   * is windowed to its tail, so a skill with thousands of rows still opens at
   * once on a phone.
   */
  function renderHistory({ skill: id, from = null }) {
    const skill = skills.get(id);
    if (!skill) { render('today'); return; }
    const now = Date.now();
    const st = stateOf(id);
    const total = gstore.countAttempts(id);
    const rows = gstore.getAttempts({ skill: id, limit: HISTORY_WINDOW });
    // The store has already trimmed the rows, so the lifetime count has to be handed in: deriving it
    // from the list made the parts add up to something other than the stated total (QA-B2).
    const hist = stats.skillHistory(rows, { last: 20, days: HISTORY_DAYS, now, max: HISTORY_WINDOW, total });
    const confs = stats.confusionsOf(id, gstore.getConfusions(), skills);
    const dl = (label, ...value) => [h('dt', { text: label }), h('dd', {}, ...value)];

    const acts = [];
    if (drillable(id)) acts.push(btn('Practise this skill', { onclick: () => startBlocked(id, from) }, 'btn btn--primary'));
    // "Redo the N you missed", narrowed to this skill, with the count shown (GRAMMAR-CONTRACT.md "Redo what
    // was wrong"). Nothing to redo says so quietly under the buttons rather than offering an empty session.
    const missedHere = missedCount({ skill: id });
    if (missedHere) acts.push(btn(`Redo the ${missedHere} you missed`, { to: ['redo', { skill: id, from }], onclick: () => render('redo', { skill: id, from }), 'aria-label': `Redo the ${missedHere} item${missedHere === 1 ? '' : 's'} of ${skill.title} you missed and have not since got right` }, 'btn'));
    acts.push(btn('Lesson', { to: ['lesson', { skill: id, from }], onclick: () => render('lesson', { skill: id, from }) }, 'btn btn--quiet'));
    if (!skill.set && chartTable(skill)) acts.push(btn('Print chart', { onclick: () => printChart(skill) }, 'btn btn--quiet'));

    const head = [
      backButton(from),
      h('header', { class: 'g-head' },
        skill.set ? null : h('p', { class: 'g-kicker', text: `Cap. ${roman(skill.chapter)} · ${skill.course} week ${skill.week ?? '—'} · ${cap(String(skill.category ?? '').replace('-', ' '))}` }),
        h('h1', { class: 'g-title', text: skill.title }),
        h('p', { class: 'g-lede', text: 'History' }),
        h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': st.state, 'aria-hidden': 'true' }),
          stateTipButton(skill.title, st, { shown: dueText(st, now) }))),
      h('div', { class: 'g-acts' }, acts),
      // The line may only claim what the log supports (M-3): a miss on a generated sentence or a catalogue
      // table names no item, so it can never be offered back — which is not the same as having been put right.
      total && !missedHere ? h('p', { class: 'g-quiet', text: unnamedMissedCount({ skill: id })
        ? `Nothing to redo here: ${unnamedMissedCount({ skill: id }) === 1 ? 'the one answer you got wrong was' : `all ${unnamedMissedCount({ skill: id })} answers you got wrong were`} on a generated sentence, a catalogue table or a step inside a lesson, which are re-drawn rather than offered back.`
        : 'Nothing to redo here: every item of this skill you have missed has since been answered right.' }) : null,
    ];

    if (!total) {
      setBody(head, h('p', { class: 'g-quiet', text: 'This skill has not been practised yet, so there is nothing to look back on. Its history starts with the first item answered.' }));
      return;
    }

    const c = hist.counts;
    const shown = hist.read;
    const attemptsSection = h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Attempts' }),
      h('dl', { class: 'g-dl' },
        dl('In all', `${total} item${total === 1 ? '' : 's'}`),
        // Right / hinted / wrong are counted over the window, so on a long log they add up to `shown`,
        // not to `total`. The percentage says which figure it is over rather than reading as a lifetime.
        dl(hist.windowed ? `Right of the last ${shown}` : 'Right', `${c.right}${shown ? ` · ${Math.round((c.right / shown) * 100)}%` : ''}`),
        dl('With a hint', String(c.hinted)),
        dl('Wrong', String(c.wrong))),
      hist.windowed ? h('p', { class: 'g-quiet', text: `Right, with a hint and wrong count the last ${shown} attempts — they add up to ${shown}, not to ${total}. The ${total - shown} before them are counted only in "In all".` }) : null,
      sparkStrip(hist.perDay));

    const last = hist.trail[hist.trail.length - 1] ?? null;
    const movedSection = h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'How it moved' }),
      h('dl', { class: 'g-dl' },
        dl('Stability', stats.fmtStability(st.stability_days)),
        dl('Stage', `${st.stage} of 3`),
        dl('State', cap(st.state)),
        dl('Next review', dueText(st, now).split(' · ').slice(1).join(' · ') || '—')),
      hist.trail.length > 1 ? trailChart(hist.trail) : null,
      hist.stageChanges.length
        ? h('ul', { class: 'g-trail__steps' }, hist.stageChanges.map((sc) => h('li', { text: `Stage ${sc.from} → ${sc.to} · ${fmtWhen(sc.at)}` })))
        : h('p', { class: 'g-quiet', text: `Still at stage ${st.stage}: four right in a row at this stage moves it up.` }),
      // The replay now includes Learn's own pass (stats.progressTrail), so the two figures normally agree.
      // What it cannot see is a reset: the log survives one, the row does not.
      last && Math.abs((Number(last.stability) || 0) - (Number(st.stability_days) || 0)) > 0.25
        ? h('p', { class: 'g-quiet', text: 'The curve is replayed from the attempts — the answers, and Learn’s own pass where the log shows one. It can still differ from the stability above when the skill was reset by hand, which the log does not record.' })
        : null);

    const itemsSection = h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: `The last ${hist.recent.length === 1 ? 'item' : `${hist.recent.length} items`}` }),
      h('div', { class: 'g-hist__scroll' },
        h('table', { class: 'study__table g-table g-hist__table' },
          h('caption', { class: 'visually-hidden', text: `The last ${hist.recent.length} items on ${skill.title}` }),
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col', text: 'When' }),
            h('th', { scope: 'col', text: 'Item' }),
            h('th', { scope: 'col', text: 'You' }),
            h('th', { scope: 'col', text: 'The answer' }))),
          h('tbody', {}, hist.recent.map((a) => h('tr', { class: a.correct ? null : 'is-wrong' },
            // Right and wrong were a colour and an aria-hidden glyph, so a screen reader — and anyone who
            // cannot separate the two inks — was told nothing (G3-08). The word is in the row header.
            h('th', { scope: 'row' },
              h('span', { class: `g-tick${a.correct ? ' is-ok' : ''}${a.hinted ? ' is-hinted' : ''}`, 'aria-hidden': 'true', text: a.correct ? '✓' : '✗' }),
              h('span', { class: 'visually-hidden', text: `${a.correct ? 'Right' : 'Wrong'}${a.hinted && a.correct ? ', with a hint' : ''}. ` }),
              ' ', h('span', { text: fmtWhen(a.at) })),
            h('td', {}, h('span', { class: 'g-hist__kind', text: a.kind }), a.mode === 'learn' ? h('span', { class: 'g-hist__mode', text: ' learn' }) : null),
            // Only the kinds that actually produce Latin are marked as Latin: a choice, a parse or a
            // self-graded translate holds English ("time when", "graded partly"), and a Latin voice
            // reading English is worse than none (QA-B5).
            h('td', { class: 'g-hist__given', lang: latinAnswer(a) ? 'la' : null, text: a.given || '—' }),
            h('td', { class: 'g-hist__want', lang: latinAnswer(a) ? 'la' : null, text: a.expected || '—' })))))));

    const confSection = h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Confusions' }),
      confs.length
        ? h('ul', { class: 'g-conf' }, confs.map((x) => h('li', {},
            `${titleOf(x.other)} · ${x.count} time${x.count === 1 ? '' : 's'} — ${confDirection(x)}. `,
            navEl({ class: 'g-link', to: ['session', { pair: [id, x.other], size: 10 }], onclick: () => render('session', { pair: [id, x.other], size: 10 }) }, 'practise the pair'))))
        : h('p', { class: 'g-quiet', text: 'None recorded for this skill.' }));

    setBody(head, attemptsSection, movedSection, itemsSection, confSection);
  }

  /**
   * The drill kinds whose answer and expected answer are Latin words. `recognise`
   * and `parse` are answered with English feature names ("time when", "dative
   * singular"), `translate` with a self-grade, and a vocabulary row does not say
   * which way the deck ran — so none of those is marked `lang="la"`.
   */
  const LATIN_ANSWER_KINDS = new Set(['chart', 'blank', 'transform', 'reorder', 'question', 'pensum']);
  const latinAnswer = (a) => !a.self && LATIN_ANSWER_KINDS.has(a.kind);

  /** Which way round a confusion went, said without arithmetic in brackets. */
  const confDirection = (x) => (x.mine === x.count ? 'always this skill answered as that one'
    : x.mine === 0 ? 'always that one answered as this skill'
    : `${x.mine} this skill answered as that one, ${x.count - x.mine} the other way round`);

  /** Items per day over the history window: one bar a day, the whole strip labelled, the figures said in words underneath. */
  function sparkStrip(perDay) {
    const max = Math.max(1, ...perDay.map((d) => d.items));
    const items = perDay.reduce((n, d) => n + d.items, 0);
    const active = perDay.filter((d) => d.items).length;
    return h('div', { class: 'g-spark__wrap' },
      h('ol', { class: 'g-spark', 'aria-label': `Items per day over the last ${perDay.length} days` },
        perDay.map((d) => h('li', { class: 'g-spark__d', 'data-empty': d.items ? null : '', style: `--h:${d.items ? Math.max(0.12, d.items / max) : 0}`, title: `${fmtDay(d.day)}: ${d.items} item${d.items === 1 ? '' : 's'}${d.items ? `, ${d.right} right` : ''}` },
          h('span', { class: 'visually-hidden', text: `${fmtDay(d.day)}: ${d.items} items${d.items ? `, ${d.right} right, ${d.wrong} wrong` : ''}` })))),
      h('p', { class: 'g-quiet', text: items ? `${items} item${items === 1 ? '' : 's'} on ${active} day${active === 1 ? '' : 's'} in the last ${perDay.length}.` : `Nothing in the last ${perDay.length} days.` }));
  }

  /**
   * The stability curve, replayed from the attempts. An inline SVG polyline —
   * no library, no colour it cannot lose: the line is ink, a wrong answer is a
   * gap in it. The reading is given in words beside it, so nothing depends on
   * seeing the shape.
   */
  function trailChart(trail) {
    const W = 320;
    const H = 56;
    const vals = trail.map((t) => Number(t.stability) || 0);
    const max = Math.max(...vals, 1);
    const x = (i) => (trail.length === 1 ? W : (i / (trail.length - 1)) * W);
    const y = (v) => H - (v / max) * (H - 4) - 2;
    const points = trail.map((t, i) => `${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'g-trail');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-label', `Stability over the last ${trail.length} attempts, from ${stats.fmtStability(vals[0])} to ${stats.fmtStability(vals[vals.length - 1])}; the highest it reached was ${stats.fmtStability(max)}.`);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('class', 'g-trail__line');
    line.setAttribute('points', points);
    svg.append(line);
    // Every wrong answer, where the curve dropped: the shape alone would not say which dips were misses.
    // A tick, not a dot — the box is stretched to the width of the page, and a circle would print as an ellipse.
    for (let i = 0; i < trail.length; i++) {
      if (trail[i].correct) continue;
      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tick.setAttribute('class', 'g-trail__miss');
      tick.setAttribute('x1', x(i).toFixed(1));
      tick.setAttribute('x2', x(i).toFixed(1));
      tick.setAttribute('y1', (y(vals[i]) - 5).toFixed(1));
      tick.setAttribute('y2', (y(vals[i]) + 5).toFixed(1));
      svg.append(tick);
    }
    return h('figure', { class: 'g-trail__fig' }, svg,
      h('figcaption', { class: 'g-quiet', text: `Stability over the last ${trail.length} attempts · highest ${stats.fmtStability(max)}. A tick marks a wrong answer.` }));
  }

  /** "3 Sep, 14:20" — when an attempt was made; the year only when it was not this one. */
  function fmtWhen(at) {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return '—';
    const opts = { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleString(undefined, opts);
  }

  /* ------------------------------------------------------------ print */
  /** The paradigm a skill's chart prints: its own focus cells lit, exactly as the lesson lights them. */
  const chartTable = (skill) => paradigmFor(skill, null);
  /** How many book examples a printed skill sheet carries (`Math.max(3, …Math.min(3, …))` was always 3 — G3-10). */
  const SHEET_EXAMPLES = 3;
  /** Above this many skills the bulk print asks first and builds in chunks, yielding so its own message can paint. */
  const BULK_ASK = 20;
  const BULK_CHUNK = 8;
  const yieldToPaint = () => new Promise((r) => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(r, 0)); else setTimeout(r, 0); });

  /** One skill's chart, one table a page, its focus cells boxed. */
  function printChart(skill) {
    const table = chartTable(skill);
    if (!table) { ctx.say(`${skill.title} has no paradigm table to print.`); return; }
    // A browser with no printing at all told the learner nothing before (G3-10).
    if (!printDocument(buildChart({ skill, paradigm: table, roman }), { title: `${skill.title} — chart` })) ctx.say('This browser cannot print from the app. Use the browser’s own Print in its menu.');
  }

  /** The skill sheet: the lesson's rule, the paradigm and its examples on paper. */
  async function printSheet(skill) {
    const lesson = await lessonOf(skill.id);
    const rule = (lesson?.core ?? []).find((b) => b.type === 'rule')?.text ?? '';
    const exBlock = (lesson?.core ?? []).find((b) => b.type === 'examples') ?? { units: [], invented: [] };
    const ids = exBlock.units || [];
    const examples = exampleUnits(skill, ids, SHEET_EXAMPLES)
      .map(({ unit: u, own }) => ({ la: u.la, en: u.en || '', ref: `${unitRefText(u)}${own ? '' : ' · from the library'}` }));
    for (const ex of exBlock.invented || []) examples.push({ la: ex.la, en: ex.en || '', ref: 'Invented example' });
    const confBlock = (lesson?.core ?? []).find((b) => b.type === 'confusion');
    const confusion = confBlock ? { title: titleOf(confBlock.with), text: String(confBlock.text ?? '').replace(/\*\*?/g, '') } : null;
    if (!printDocument(buildSheet({ skill, paradigm: chartTable(skill), rule: String(rule).replace(/\*\*?/g, ''), examples, confusion, roman }), { title: `${skill.title} — sheet` })) ctx.say('This browser cannot print from the app. Use the browser’s own Print in its menu.');
  }

  /**
   * The map's Print charts: every skill the filter is showing that has a
   * paradigm, one table a page.
   *
   * Three things the first version got wrong (G3-09, QA-I2). The "Building…"
   * message could never paint, because a synchronous loop over 87 skills — each
   * a full library scan for its candidates — followed it on the same tick; the
   * confirm came *after* all that work, so declining wasted thirteen seconds of
   * blocked main thread; and "All" is 777 sheets, which is a filing cabinet
   * rather than a study aid. So: a category filter prints straight through
   * (that is the default and the recommended route), "All" asks before any work
   * is done, and the build yields to the browser every few skills, so the
   * message shows and the page keeps answering.
   */
  async function printCharts(filter = 'all') {
    const shown = [...index.skills.values()].filter((s) => filter === 'all' || s.category === filter);
    if (!shown.length) { ctx.say('No skills are shown under this filter.'); return; }
    if (filter === 'all' && shown.length > BULK_ASK
      && !confirm(`Print the charts of all ${shown.length} skills? That is several hundred sheets. Cancel to choose a category above and print just those.`)) {
      ctx.say('Nothing printed. Choose a category above, then Print charts again.');
      root.querySelector('.g-filter')?.scrollIntoView({ block: 'nearest' });
      root.querySelector('.g-filter__btn')?.focus?.({ preventScroll: true });
      return;
    }
    const frag = document.createDocumentFragment();
    let skillCount = 0;
    let pages = 0;
    if (shown.length > BULK_ASK) { ctx.say(`Building the charts for ${shown.length} skills…`); await yieldToPaint(); }
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i];
      const table = chartTable(s);
      const node = table ? buildChart({ skill: s, paradigm: table, roman }) : null;
      if (node) { pages += node.childElementCount; skillCount += 1; frag.append(node); }
      if (shown.length > BULK_ASK && (i + 1) % BULK_CHUNK === 0) await yieldToPaint();
    }
    if (!pages) { ctx.say('None of the skills shown has a paradigm table to print.'); return; }
    if (!confirm(`Print ${pages} page${pages === 1 ? '' : 's'} — the charts of ${skillCount} skill${skillCount === 1 ? '' : 's'}, one table a page?`)) { ctx.say('Nothing printed.'); return; }
    if (!printDocument(frag, { title: filter === 'all' ? 'Latin 103 — paradigm charts' : `Latin 103 — ${filter.replace('-', ' ')} charts` })) ctx.say('This browser cannot print from the app. Use the browser’s own Print in its menu.');
  }

  const fmtDay = (day) => { const d = new Date(`${day}T12:00:00`); return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };

  return { render, refresh, repaint, todayCard, chapterPanel, dispose };
}
