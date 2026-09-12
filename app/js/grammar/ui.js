// Grammar section views: the skill map, the lesson, the Learn flow, the
// Practice setup, the session runner (type / choice / chart / tap), feedback,
// the end-of-session summary and the stats page. Calm tone, no gamification.
// Every Latin word in a drill is tappable for its entry (a small popover built
// from dictionary.describe); the target's dictionary form sits under the item.

import { chapters, roman, inline, loadLesson, loadSentences, loadParadigmCatalogue, loadHeadwords, loadOccurrences, loadGenerated, generatedSkillIds, generatedUnreachable, occurrenceLine, KEY_CLASS, KEY_MODELS, entryOfClass, highlightParses } from './lessons.js';
import { renderParadigm } from '../wordpanel.js';
import { isShelfWeek } from '../sync.js';
import { tokenize, stripMacrons } from '../tokenize.js';
import { attachHoverGloss, cutLatinWords, pointerHovers } from '../hovergloss.js';
import { PARTS, skillProgress } from './progress.js';
import { decay, isDue, overdueRatio, newState, addToPractice, removeFromPractice, reviewFirst, inRotation, buildPairSession, DAY_MS } from './scheduler.js';
import { createLearn, createPractice, createBlockedFive, createRedo, createDrill, createMixed, mixedMembers, createCatalogueDrill, boxHints, normaliseHintMode, HINT_MODES, HINT_MODE_LABEL, cellResults, judgeCell, maskParadigm, acceptedAnswers, unmetPrereqs, workedPlan, judgeWhy, LEARN_BLOCKED, RETEST_SIZE, RETEST_AFTER_MS, noteRetest, retestDue, retestPending, SCAFFOLD_LEVELS, SCAFFOLD_STEPS, normaliseScaffold, scaffoldPercent, scaffoldStep, scaffoldGiven, chartCellKey } from './session.js';
import { featureLabel, createTeachItems, createCatalogueItems, tableIdOf, cellId, matchesForm, isWrittenKey, la, partsText } from './items.js';
import { setsOfChapter, setChapters, phraseIndexes, focusIndexes, POPULATIONS, POPULATION_LABEL, populationOf, normalisePopulations, filterPopulations, mixNote, mixTitle } from './sets.js';
import { spine, spineRows, chapterMaterial, chapterProgress, chapterPool, chapterSummary, normaliseView, chapterOfSentence } from './chapter.js';
import { orderInput, matchInput } from './inputs.js';
import { buildToday, fmtMinutes } from './today.js';
import * as stats from './stats.js';
import { localDay } from './stats.js';
import { buildChart, buildSheet, printDocument } from './print.js';

const LS_SESSION = 'l103.grammar.session';      // the practice session in progress (plan, position, log) — Back / Reload can resume it
const LS_QUEUE = 'l103.grammar.learnQueue';     // "Start all as new": the skills still to go through Learn
const LS_LEARN = 'l103.grammar.learn';          // where the learner is in each skill: `{ <skill id>: { step | seen, at } }`
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
const btn = (label, attrs = {}, cls = 'btn') => h('button', { type: 'button', class: cls, ...attrs }, label);
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
const PARTS_PANEL_ID = 'g-parts-panel';

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

/* ------------------------------ where the learner is in a lesson (§22) */

const MAX_STEPS = 64;   // a lesson has four to six; this only stops a corrupt file becoming a long loop

/** Whatever was stored as a list of step indices, as clean whole numbers, lowest first, no repeats. Pure. */
const stepList = (v) => {
  const out = new Set();
  for (const x of Array.isArray(v) ? v : []) {
    // `Number(null)` is 0 and `Number(true)` is 1: a stray null in a hand-edited file must not become step 1.
    const n = Math.floor(typeof x === 'number' ? x : (typeof x === 'string' && x.trim() ? Number(x) : NaN));
    if (Number.isFinite(n) && n >= 0 && n < MAX_STEPS) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
};

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
    const done = Array.isArray(v.done) ? stepList(v.done)
      : stepList(Array.from({ length: Math.min(MAX_STEPS, Math.max(0, Math.floor(Number(v.step) || 0))) }, (_, i) => i));
    const seen = Math.floor(Number(v.seen));
    const at = Number(v.at);
    const place = { ...(done.length ? { done } : null), ...(Number.isFinite(seen) && seen > 0 ? { seen } : null), ...(Number.isFinite(at) && at > 0 ? { at } : null) };
    if (Object.keys(place).length) out[id] = place;
  }
  return out;
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
 * **Colour is never the only signal (§3).** The glyph differs in *shape* — a
 * tick, a numeral, the word "Ten" — so the row still reads in greyscale and on
 * paper, and `label` carries the whole fact in words for a reader who sees no
 * glyph at all. The colour is the third signal and says nothing the other two
 * do not. Pure.
 */
export function stepMark(i, { title = '', state = 'todo', steps = 0, go = false } = {}) {
  const n = Math.max(0, Math.floor(Number(steps) || 0));
  const ten = i >= n;
  const what = ten ? 'The ten items' : `Step ${i + 1} of ${n}${title ? `, ${title}` : ''}`;
  const says = { done: 'done', now: 'in progress' }[state] ?? 'not started';
  const invite = go ? (state === 'done' ? ' Go back to it.' : ' Go to it.') : '';
  return { glyph: state === 'done' ? '✓' : ten ? 'Ten' : String(i + 1), label: `${what}: ${says}.${invite}` };
}

const partsData = new WeakMap();   // the meter button → what its panel should say
let partsPanel = null;
let partsFor = null;               // the button the panel is open against
let partsHover = null;             // open because the pointer is resting on it
let partsHeld = null;              // open because the keyboard is on it, or a finger pressed it
let partsWired = false;

/** What the panel is for: the learner's own reading of the row, so it never takes the keyboard. */
function partsNode() {
  if (partsPanel?.isConnected) return partsPanel;
  partsPanel = h('div', { class: 'g-parts__panel', id: PARTS_PANEL_ID, role: 'tooltip', hidden: true });
  document.body.append(partsPanel);
  return partsPanel;
}

/**
 * Measure, then place with `panelPlace`. Appended to the body and fixed, so it
 * works the same from the map, from the chapter spine and from a chapter
 * page's grammar panel, which is mounted outside the section's own root.
 */
function placeParts(el) {
  const p = partsNode();
  const w = Math.min(320, window.innerWidth - 16);
  p.style.width = `${w}px`;
  p.hidden = false;                                     // measured before it is placed: a hidden box has no height
  const { x, y } = panelPlace(el.getBoundingClientRect(), { h: p.getBoundingClientRect().height, w, vw: window.innerWidth, vh: window.innerHeight });
  p.style.left = `${x}px`;
  p.style.top = `${y}px`;
}

function partsBody(el) {
  const d = partsData.get(el);
  const p = partsNode();
  if (!d) { p.replaceChildren(); return; }
  const missing = PARTS.filter((part) => !d.parts.some((x) => x.key === part.key));
  p.replaceChildren(
    h('p', { class: 'g-parts__h', text: d.title }),
    h('p', { class: 'g-parts__sum', text: d.summary }),
    h('ul', { class: 'g-parts__list' }, d.parts.map((part) => {
      // A part that records which rung it was completed at leads with it, so a chart part finished with
      // 80 % of its cells printed never reads like one finished from memory (§12, §18.1). It goes in front
      // of the count rather than beside it: "completed unaided · 3 charts answered right" answers *how*
      // before *how many*, which is the order the learner asked the question in.
      const note = givenNote(part);
      const line = partLine(note ? { ...part, detail: part.detail ? `${note} · ${part.detail}` : note } : part);
      return h('li', { class: 'g-parts__item', 'data-done': part.done ? '1' : '0', 'data-part': part.key },
        h('span', { class: 'g-parts__mark', 'aria-hidden': 'true', text: line.mark }),
        h('span', { class: 'g-parts__what' },
          h('span', { class: 'g-parts__part', text: part.label }),
          h('span', { class: 'g-parts__detail' },
            line.notYet ? h('span', { class: 'g-parts__not', text: 'not yet' }) : null,
            line.text)));
    })),
    // `replaceChildren` is the DOM's, not `h`'s: a null passed to it is appended as the text "null".
    ...(missing.length ? [h('p', { class: 'g-parts__foot', text: `Not part of this skill: ${missing.map((m) => m.label).join(', ')}.` })] : []));
}

function syncParts() {
  const want = partsHeld ?? partsHover;
  if (want !== partsFor) {
    if (partsFor) { partsFor.setAttribute('aria-expanded', 'false'); partsFor.removeAttribute('aria-describedby'); }
    partsFor = want ?? null;
    if (!partsFor) { if (partsPanel) { partsPanel.hidden = true; partsPanel.replaceChildren(); } return; }
    partsFor.setAttribute('aria-expanded', 'true');
    partsFor.setAttribute('aria-describedby', PARTS_PANEL_ID);
    partsBody(partsFor);
  }
  if (!partsFor) return;
  // A panel the pointer alone opened takes no pointer (it would flicker as the mouse reached it, and it
  // has nothing to press); one a finger or the keyboard opened does, so a tap on it is not a tap on the
  // row underneath — where "Reset" is.
  partsNode().dataset.hover = partsHeld ? '0' : '1';
  placeParts(partsFor);
}

const closeParts = () => { partsHover = null; partsHeld = null; syncParts(); };

/**
 * One set of listeners for every meter the section ever draws. Whether the
 * pointer can hover is asked of the **event** (`pointerHovers`), never of the
 * device: the learner's Windows laptop has a touchscreen and a mouse, and
 * `matchMedia('(hover: hover)')` answers "no" for both (§17.2).
 */
let wasHeld = null;   // what was pinned when the current press began (see the click handler)

function wireParts() {
  if (partsWired || typeof document === 'undefined') return;
  partsWired = true;
  const meter = (e) => e.target?.closest?.('.g-parts') ?? null;
  const inPanel = (t) => !!t?.closest?.('.g-parts__panel');
  document.addEventListener('pointerover', (e) => {
    const b = meter(e);
    if (!b || !pointerHovers(e) || b === partsHover) return;
    partsHover = b;
    syncParts();
  });
  document.addEventListener('pointerout', (e) => {
    const b = meter(e);
    if (!b || b !== partsHover) return;
    if (e.relatedTarget && (b.contains(e.relatedTarget) || inPanel(e.relatedTarget))) return;
    partsHover = null;
    syncParts();
  });
  document.addEventListener('focusin', (e) => { const b = meter(e); if (b) { partsHeld = b; syncParts(); } else if (partsHeld && !inPanel(e.target)) { partsHeld = null; syncParts(); } });
  document.addEventListener('focusout', (e) => { const b = meter(e); if (b && b === partsHeld) { partsHeld = null; syncParts(); } });
  document.addEventListener('click', (e) => {
    const b = meter(e);
    if (!b) return;
    // A tap has no hover to open the panel and no leave to close it, so the press itself is the toggle —
    // but the toggle must be measured from **before the gesture began**, not from the state now. Tapping a
    // meter focuses it, `focusin` opens the panel, and the click arrives a few ms later: asking "is it open?"
    // at that point always answers yes, so one tap opened and then instantly shut it again. It needed two
    // taps, or three with another panel open, and desktop hid the bug because `pointerover` had already set
    // `partsHover`. `wasHeld` is read at pointerdown, before focus moves.
    partsHeld = wasHeld === b ? null : b;
    wasHeld = null;
    syncParts();
  });
  // A press anywhere else puts it away — the finger's equivalent of the pointer leaving. The same press
  // records what was pinned before it, which is what the click above toggles against. Hover is deliberately
  // not consulted: a click on a meter the mouse is merely resting over should pin it, not close it.
  document.addEventListener('pointerdown', (e) => {
    const b = meter(e);
    wasHeld = b ? partsHeld : null;
    if (partsHeld && !b && !inPanel(e.target)) { partsHeld = null; syncParts(); }
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && partsFor) { const b = partsFor; closeParts(); b.focus?.({ preventScroll: true }); } });
  // The panel is fixed, so a scroll or a resize would leave it hanging over the wrong row. It follows
  // its own row rather than vanishing — the map is long and the learner reads it by scrolling — and it
  // goes only when the row it belongs to has left the document, which is what a redraw does to it.
  const follow = () => { if (!partsFor) return; if (partsFor.isConnected) placeParts(partsFor); else closeParts(); };
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
}

/**
 * The meter itself: the ticks, the count, and the button that holds them. Null
 * when the skill has no parts at all, so nothing empty is drawn. The label
 * carries the whole count for a screen reader, and the panel is its
 * description, so the fact is never colour's alone.
 */
function partsMeter(title, p) {
  if (!p || !p.total) return null;
  wireParts();
  // Every paint passes through here, which is the one place that reliably knows a redraw happened: a panel
  // whose row has just been replaced is answering about a node no longer on the page, so it goes.
  if (partsFor && !partsFor.isConnected) closeParts();
  const b = h('button', {
    type: 'button', class: 'g-parts', 'data-level': p.level, 'aria-expanded': 'false', 'aria-label': meterLabel(title, p),
  },
  h('span', { class: 'g-parts__ticks', 'aria-hidden': 'true' }, p.parts.map((part) => h('span', { class: 'g-parts__tick', 'data-done': part.done ? '1' : '0' }))),
  // **The unit is named** (§22.1). A bare "3 of 6" beside a skill whose lesson happens to have six teaching
  // steps reads as lesson progress, and the learner read it exactly that way: they pressed Continue expecting
  // to land at step 4. The word is the whole fix — the meter still counts the skill's parts (§18), and the
  // aria-label and the panel's summary have said "parts" from the start, so all three now agree.
  h('span', { class: 'g-parts__count', 'aria-hidden': 'true', text: `${p.done} of ${p.total} part${p.total === 1 ? '' : 's'}` }));
  partsData.set(b, { title, summary: p.summary, parts: p.parts });
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
  let view = { name: 'map', params: {} };
  let body = null;
  let allMeanings = false;   // the "show all meanings" switch, for the session
  const lessonCache = new Map();
  const lessonOf = async (id) => { if (!lessonCache.has(id)) lessonCache.set(id, await loadLesson(id)); return lessonCache.get(id); };
  const unitOf = (id) => ctx.units.find((u) => u.id === id) ?? null;
  const stateOf = (id) => decay(gstore.getState(id) ?? newState(id), Date.now());
  const titleOf = (id) => skills.get(id)?.title ?? id;

  /* ------------------------------------------------------------ shell */
  function draw() {
    const nav = h('nav', { class: 'g-nav', 'aria-label': 'Grammar' },
      ['map', 'practice', 'catalogue', 'stats'].map((v) => h('button', { type: 'button', class: 'g-nav__btn', 'aria-current': (view.name === v || (v === 'practice' && ['setup', 'session', 'blocked', 'redo', 'summary', 'drill', 'unlimited', 'mixed'].includes(view.name)) || (v === 'map' && ['lesson', 'learn'].includes(view.name)) || (v === 'stats' && view.name === 'history')) ? 'page' : null, onclick: () => render(v === 'practice' ? 'setup' : v) },
        { map: 'Skills', practice: 'Practice', catalogue: 'Tables', stats: 'Stats' }[v])));
    body = h('div', { class: 'g-body' });
    root.replaceChildren(h('div', { class: 'g' }, nav, body));
    const fn = { map: renderMap, lesson: renderLessonView, learn: renderLearnStart, setup: renderSetup, session: renderPracticeStart, redo: renderRedo, blocked: renderBlocked, drill: renderDrill, unlimited: renderUnlimited, mixed: renderMixed, catalogue: renderCatalogue, stats: renderStats, history: renderHistory, summary: () => renderMap() };
    (fn[view.name] ?? renderMap)(view.params);
    document.title = `Grammar — Latin 103`;
  }
  /** Show a view. Each is a history entry (Back walks the section's views; a session in progress resumes); the new heading takes focus. */
  function render(name, params = {}, { push = true, focus = true } = {}) {
    closePop();
    // The map is 87 rows long: coming back from a lesson or a history page at scrollY 0 means hunting
    // for the skill you left (QA-B10). Its place is kept and restored; every other view opens at the top.
    if (view.name === 'map' && name !== 'map') mapScroll[mapView] = window.scrollY;
    view = { name, params };
    if (push) { try { history.pushState({ grammar: { name, params: name === 'session' || name === 'redo' ? { ...params, resume: true } : params } }, ''); } catch { /* file: URLs */ } }
    draw();
    // Each of the two map views keeps its own place: coming back from a lesson lands where it was left, in the view it was left in.
    window.scrollTo({ top: name === 'map' ? (params.chapter != null ? 0 : mapScroll[mapView]) : 0 });
    if (focus) body.querySelector('h1')?.focus?.({ preventScroll: true });
  }
  const mapScroll = { topic: 0, chapter: 0 };
  // Which of the two Grammar views the map shows — By topic (the category map) or By chapter (the book's spine).
  // Remembered in settings.grammar.view, so the choice survives a reload and a return from a lesson.
  let mapView = normaliseView(ctx.prefs?.().view);
  // The light instance behind the weeks-menu Today card has no generator, so it must never paint the
  // map: every row would read "no sentences in the library yet" until `init()` replaced it (QA-1).
  function refresh() { if (!ctx.items) return; if (['map', 'stats', 'history'].includes(view.name) && showing()) draw(); repaintPanels(); }
  /** True while the section itself is the thing on screen: `draw()` renames the document, so it must not run behind a chapter page. */
  const showing = () => (ctx.section?.() ?? 'grammar') === 'grammar';
  // The chapter pages' grammar panels (index.js's mountChapterGrammar). They are repainted whenever the
  // section's own state changes, and dropped as soon as the shell has taken their element out of the document.
  const panels = new Set();
  function repaintPanels() { for (const p of [...panels]) { if (!p.el?.isConnected) { panels.delete(p); continue; } chapterPanel(p.el, { chapter: p.chapter }); } }
  /** Redraw what is on screen: the current view when the section is showing, and every mounted chapter panel. */
  function repaint() { if (showing() && body) draw(); repaintPanels(); }
  // The new heading takes focus whenever the body is replaced and focus has nowhere to be (a view arriving after a lesson fetch, the end of a session) — G1-09.
  const setBody = (...nodes) => { body.replaceChildren(...nodes.flat(Infinity).filter(Boolean)); const f = body.querySelector('h1'); if (f) { f.tabIndex = -1; const a = document.activeElement; if (!a || a === document.body || !body.contains(a)) f.focus({ preventScroll: true }); } };
  // The section may be built twice in a life: once cheaply for the weeks-menu Today card, then in full when Grammar is
  // opened. `dispose()` takes the first instance's listener off so the two never both answer a Back.
  const onPop = (e) => {
    const g = e.state?.grammar;
    if (!g || ctx.section?.() === 'read') return;
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
    const block = (d, i) => h('div', { class: `g-pop__entry${i ? ' g-pop__entry--alt' : ''}` },
      h('p', { class: 'g-pop__meaning' }, String(d.meaning ?? '').split(/\s+·\s+/).map((m, j) => [j ? h('br') : null, m])),
      d.parse && parse ? h('p', { class: 'g-pop__parse', text: d.parse }) : null,
      h('p', { class: 'g-pop__lemma' }, h('span', { lang: 'la', class: 'entry__cite', text: d.lemma }), d.category ? ` · ${d.category}` : ''));
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
    let left = wr.left + wr.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    pop.style.left = `${Math.round(left - rr.left)}px`;
    pop.style.top = `${Math.round(wr.bottom - rr.top + 6)}px`;
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
  // `.g-parts` and its panel are in here for a reason, not for symmetry: the progress sheet is a report
  // about the learner, not reading text, and two popups answering one rest of the pointer is a mess. So
  // where they meet, the progress panel wins and the dictionary keeps quiet — nothing inside either is
  // ever cut into words, even if a `detail` line one day cites a form.
  const LA_NO = 'input, textarea, select, option, .g-w, .g-wx, .g-la, .g-pop, .g-blank, .g-parts, .g-parts__panel';

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

  /* -------------------------------------------------------------- map */
  /** Switch between the two ways of browsing the grammar; the choice is remembered (GRAMMAR-CONTRACT.md "Chapter spine"). */
  function setMapView(next) {
    const v = normaliseView(next);
    if (v === mapView) return;
    mapScroll[mapView] = window.scrollY;
    mapView = v;
    ctx.savePrefs?.({ view: v });     // savePrefs swallows its own failures; the view is right either way for this visit
    view.params = { ...view.params, chapter: undefined };
    draw();
    window.scrollTo({ top: mapScroll[mapView] });
  }
  const viewSwitch = () => h('div', { class: 'g-seg g-seg--views', role: 'group', 'aria-label': 'Browse the grammar' },
    [['topic', 'By topic'], ['chapter', 'By chapter']].map(([v, label]) => btn(label, { 'aria-pressed': String(mapView === v), onclick: () => setMapView(v) }, 'g-seg__btn')));

  /** Today: the daily plan (today.js), with the run in progress and the "start all as new" queue above it. Both map views carry it. */
  function todaySection() {
    const saved = readJSON(LS_SESSION, null);
    const queue = (readJSON(LS_QUEUE, []) || []).filter((id) => skills.has(id) && stateOf(id).state !== 'practising' && stateOf(id).state !== 'mastered');
    return h('section', { class: 'g-today', 'aria-labelledby': 'g-today-h' },
      h('h2', { id: 'g-today-h', class: 'g-h2', text: 'Today' }),
      saved?.queue?.length && saved.index < saved.queue.length ? h('p', { class: 'g-today__line' }, `${saved.redo ? 'A redo' : 'A practice session'} is in progress (${Math.min(saved.index, saved.queue.length)} of ${saved.queue.length} answered). `, btn('Resume', { onclick: () => render(saved.redo ? 'redo' : 'session', { ...(saved.params ?? {}), resume: true }) }, 'btn btn--primary g-today__btn'), ' ', btn('Discard', { onclick: () => { writeJSON(LS_SESSION, null); draw(); } }, 'btn btn--quiet g-today__btn')) : null,
      retestNode(),
      queue.length ? h('p', { class: 'g-today__line' }, `Learning in book order: ${queue.length} skill${queue.length === 1 ? '' : 's'} to go, next `, h('button', { type: 'button', class: 'g-link', onclick: () => render('learn', { skill: queue[0], queue: queue.slice(1) }) }, titleOf(queue[0])), '. ', btn('Stop the run', { onclick: () => { writeJSON(LS_QUEUE, null); draw(); } }, 'btn btn--quiet g-today__btn')) : null,
      todayCard({ place: 'map', bare: true }));
  }

  function renderMap(params = {}) {
    if (mapView === 'chapter') return renderSpine(params);
    const now = Date.now();
    const states = gstore.getStates();
    const cw = ctx.currentWeekSkills();
    const rf = reviewFirst({ weekSkills: cw, skills, states, now });
    const filter = view.params.category ?? 'all';

    const head = h('header', { class: 'g-head' },
      h('h1', { class: 'g-title', text: 'Skills' }),
      // The pensa arrive from the private library, so the lede only promises them once some are here.
      h('p', { class: 'g-lede', text: `${index.skills.size} skills in book order, with each chapter's questions, vocabulary${[...skills.values()].some((s) => s.set === 'pensum') ? ' and pensa' : ''}. Start a skill as new to learn it in one sitting, or add it straight to mixed practice.` }));

    const todayNode = todaySection();

    const reviewNode = rf.length ? h('section', { class: 'g-review', 'aria-labelledby': 'g-review-h' },
      h('h2', { id: 'g-review-h', class: 'g-h2', text: `Review first · week ${ctx.currentCourseWeekN()}` }),   // the last course week: a shelf chapter being read keeps it (G1-12)
      h('p', { class: 'g-quiet', text: "The prerequisites of this week's new skills, the most decayed first." }),
      h('ul', { class: 'g-chips' }, rf.map((r) => h('li', {}, h('button', { type: 'button', class: 'g-chip', 'data-state': r.state, onclick: () => render('lesson', { skill: r.skill }) }, titleOf(r.skill), h('span', { class: 'g-chip__state', text: ` · ${STATE_LABEL[r.state]}` })))))) : null;

    const cats = ['all', ...index.categories, ...(ctx.sets?.size ? ['sets'] : [])];
    const filterNode = h('div', { class: 'g-filter', role: 'group', 'aria-label': 'Filter by category' },
      cats.map((c) => btn(c === 'all' ? 'All' : c === 'sets' ? 'Chapter sets' : cap(c.replace('-', ' ')), { 'aria-pressed': String(filter === c), onclick: () => { view.params.category = c; draw(); } }, 'g-filter__btn')));

    // Add all, or none — at the level the list is shown. The category filter above decides the scope, so on
    // "Noun cases" the pair means that category's rows and on "All" it means the whole map's; the chapter
    // view has the same pair per chapter. "None" is the exact undo of "All" (scheduler.js removeFromPractice):
    // the rows leave the rotation and keep every bit of their history, so putting one back brings its spacing with it.
    const inFilter = (id) => { const s = skills.get(id); if (!s) return false; if (filter === 'all') return true; if (filter === 'sets') return !!s.set; return !s.set && s.category === filter; };
    const filterName = filter === 'all' ? 'everything here' : filter === 'sets' ? 'the chapter sets' : `the ${filter.replace('-', ' ')} skills`;
    const bulk = h('div', { class: 'g-bulk' },
      h('div', { class: 'g-seg g-seg--allnone', role: 'group', 'aria-label': `Mixed practice · ${filterName}` },
        btn('Add all', { onclick: () => bulkAdd(inFilter, filterName), 'aria-label': `Add all of ${filterName} to mixed practice` }, 'g-seg__btn'),
        btn('None', { onclick: () => bulkNone(inFilter, filterName), 'aria-label': `Take all of ${filterName} out of mixed practice` }, 'g-seg__btn')),
      btn('Start all as new', { onclick: () => bulkNew() }, 'btn btn--quiet'),
      btn('Print charts', { onclick: () => printCharts(filter), 'aria-label': filter === 'all' ? 'Print the paradigm charts of every skill' : `Print the paradigm charts of the ${filter.replace('-', ' ')} skills` }, 'btn btn--quiet'),
      btn('Reset all', { onclick: () => resetAll() }, 'btn btn--quiet g-danger'));

    // Every chapter with a skill or a set, in book order; the chapter's sets (Questions · Vocabulary · Pensa) sit under its skills.
    const byChapter = new Map(chapters(index).map((c) => [c.chapter, c.skills]));
    const allChapters = [...new Set([...byChapter.keys(), ...setChapters(ctx.sets ?? new Map())])].sort((a, b) => a - b);
    const chapterNodes = allChapters.map((chapter) => {
      const list = byChapter.get(chapter) ?? [];
      const sets = setsOfChapter(ctx.sets ?? new Map(), chapter);
      const shown = filter === 'sets' ? [] : list.filter((s) => filter === 'all' || s.category === filter);
      const shownSets = filter === 'all' || filter === 'sets' ? sets : [];
      if (!shown.length && !shownSets.length) return null;
      // The count is of what the filter is showing: "0 of 4 mastered" over three set rows read as a miscount (m18).
      const counted = [...shown, ...shownSets];
      const mastered = counted.filter((s) => stateOf(s.id).state === 'mastered').length;
      // The chapter heading keeps the one count it had. `progressSummary` was tried here and taken out
      // again: beside "1 of 7 mastered" it read "1 of 7 skills fully worked through", two identical-looking
      // fractions meaning different things, on a line that then wrapped on a phone. The rows under it
      // carry the parts already, which is where the learner asked for them.
      return h('section', { class: 'g-chap', 'aria-labelledby': `g-chap-${chapter}` },
        h('h2', { id: `g-chap-${chapter}`, class: 'g-chap__h' }, h('span', { class: 'g-chap__num', text: `Cap. ${roman(chapter)}` }), counted.length ? h('span', { class: 'g-chap__count', text: `${mastered} of ${counted.length} mastered` }) : null),
        shown.length ? h('ul', { class: 'g-skills' }, shown.map((s) => skillRow(s))) : null,
        shownSets.length ? h('div', { class: 'g-sets' }, h('h3', { class: 'g-sets__h', text: 'Chapter sets' }), h('ul', { class: 'g-skills g-skills--sets' }, shownSets.map((s) => setRow(s)))) : null);
    });

    setBody(head, viewSwitch(), todayNode, reviewNode, filterNode, bulk, chapterNodes);
  }

  /* -------------------------------------------------- by chapter (the spine) */
  /**
   * The book's spine: chapters I–XXXIV in order, each holding its own skills
   * and chapter sets and saying how much of it is mastered. The chapter being
   * read (or the one a link named) is open; the rest are folded away, so 34
   * chapters stay a page you can read down.
   */
  function renderSpine(params = {}) {
    const rows = spineRows({ chapters: ctx.chapters ?? null, skills, order: index.order, sets: ctx.sets ?? new Map(), state: stateOf, drillable: ctx.items ? drillable : () => true });
    const here = params.chapter != null ? Number(params.chapter) : ctx.currentChapter?.() ?? null;
    // Which chapters are unfolded is the learner's: the view is redrawn on every state change, and a redraw
    // must not close what they opened. null = nothing chosen yet, so the chapter being read opens itself.
    if (params.chapter != null) { spineOpen = spineOpen ?? new Set(); spineOpen.add(Number(params.chapter)); }
    const done = rows.filter((r) => r.progress.total && r.progress.mastered === r.progress.total).length;
    const head = h('header', { class: 'g-head' },
      h('h1', { class: 'g-title', text: 'Skills' }),
      h('p', { class: 'g-lede', text: `The book's chapters in order, each with the grammar it introduces and its own questions, vocabulary${[...skills.values()].some((s) => s.set === 'pensum') ? ' and pensa' : ''}. Open a chapter to see what is in it.${done ? ` ${done} chapter${done === 1 ? ' is' : 's are'} fully mastered.` : ''}` }));
    const sections = rows.map((c) => {
      const open = spineOpen ? spineOpen.has(c.n) : (here != null && c.n === here);
      const onToggle = (e) => { if (!spineOpen) spineOpen = new Set(here != null ? [here] : []); if (e.currentTarget.open) spineOpen.add(c.n); else spineOpen.delete(c.n); };
      return h('section', { class: 'g-chap g-chap--spine', id: `g-ch-${c.n}` },
        h('details', { class: 'g-chap__d', open: open || null, ontoggle: onToggle },
          h('summary', { class: 'g-chap__sum' },
            h('h2', { class: 'g-chap__h g-chap__h--sum' }, h('span', { class: 'g-chap__num', text: `Cap. ${c.roman}` }), c.title ? h('span', { class: 'g-chap__title', text: c.title }) : null),
            h('span', { class: 'g-chap__count', text: chapterSummary(c.progress) })),
          h('div', { class: 'g-chap__body' }, chapterBody(c))));
    });
    setBody(head, viewSwitch(), todaySection(), sections);
    // The chapter a link named, or — the first time the spine is opened — the one being read: brought into view once.
    // A redraw after an answer must leave the page where the learner left it.
    if (here != null && (params.chapter != null || (!spineScrolled && !mapScroll.chapter))) {
      spineScrolled = true;
      requestAnimationFrame(() => document.getElementById(`g-ch-${here}`)?.scrollIntoView?.({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    }
  }
  let spineOpen = null;
  let spineScrolled = false;

  /**
   * One chapter's grammar as a list of nodes: its skills, its chapter sets and
   * the ways into practising it. Shared by the by-chapter view and by the
   * chapter page's panel (`chapterPanel`), so a chapter reads the same in both.
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
          btn('Practise this chapter', { onclick: () => go('session', { chapter: material.chapter }), 'aria-label': `Practise chapter ${row.roman}` }, 'btn btn--primary'),
          missedHere ? btn(`Redo the ${missedHere} you missed`, { onclick: () => go('redo', { chapter: material.chapter }), 'aria-label': `Redo the ${missedHere} item${missedHere === 1 ? '' : 's'} of chapter ${row.roman} you missed and have not since got right` }, 'btn') : null,
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
        h('p', { class: 'g-chapter__sum', text: chapterSummary(progress) })),
      ...chapterBody(row, { nav, known })));
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
    const lessonBtn = btn('Lesson', { onclick: () => nav('lesson', { skill: s.id }) }, 'btn btn--quiet');
    // `known` false: the panel has states but no generator yet, so the row says nothing about what can be drilled (QA-B1's rule).
    const can = known ? drillable(s.id) : null;
    // "Just drill it" (§10): one tap from the row to ten items on this skill alone, the rule pinned above each.
    const drillBtn = can ? btn('Just drill it', { onclick: () => nav('drill', { skill: s.id }), 'aria-label': `Just drill ${s.title}: ten items, no lesson first` }, 'btn btn--quiet') : null;
    if (!known || !can) {
      // No sentence in the library fits (the metre skills by design): the lesson stands, nothing to drill (M8).
      acts.push(lessonBtn);
    } else if (st.state === 'new') {
      acts.push(btn('Start as new', { onclick: () => nav('learn', { skill: s.id }) }, 'btn'), btn('Add to mixed practice', { onclick: () => addSkill(s.id) }, 'btn btn--quiet'), lessonBtn);
    } else if (st.state === 'learning') {
      acts.push(btn('Continue learning', { onclick: () => nav('learn', { skill: s.id }) }, 'btn'), lessonBtn);
    } else if (st.state === 'lapsed') {
      acts.push(btn('Re-learn', { onclick: () => nav('learn', { skill: s.id }) }, 'btn'), btn('Practise this skill', { onclick: () => nav('blocked', { skill: s.id }) }, 'btn btn--quiet'), lessonBtn);
    } else {
      acts.push(btn('Practise this skill', { onclick: () => nav('blocked', { skill: s.id }) }, 'btn'), lessonBtn);
    }
    if (drillBtn) acts.splice(1, 0, drillBtn);
    // Unlimited and mixed practice (§11, §12), the same two taps, on the skills that have a generated bank.
    if (drillBtn && hasBank(s.id)) acts.splice(2, 0, ...practiceButtons(s, nav));
    if (gstore.countAttempts(s.id)) acts.push(btn('History', { onclick: () => nav('history', { skill: s.id }), 'aria-label': `History of ${s.title}` }, 'btn btn--quiet'));
    if (known) acts.push(btn('Reset', { onclick: () => resetSkill(s.id), 'aria-label': `Reset ${s.title}` }, 'btn btn--quiet g-skill__reset'));
    return h('li', { class: 'g-skill', 'data-state': st.state },
      h('div', { class: 'g-skill__main' },
        h('button', { type: 'button', class: 'g-skill__title', onclick: () => nav('lesson', { skill: s.id }) }, s.title),
        h('p', { class: 'g-skill__plain', text: `${s.plain} · ${s.course} week ${s.week ?? '—'}` }),
        h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': can === false ? 'none' : st.state, 'aria-hidden': 'true' }), can === false ? (s.parse_filter ? 'no sentences in the library yet' : 'lesson only — no drill') : dueText(st),
          partsMeter(s.title, progressOf(s, known)))),
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
    else if (st.state === 'new') { if (learnable) acts.push(btn('Start as new', { onclick: () => nav('learn', { skill: s.id }) }, 'btn')); acts.push(btn('Add to mixed practice', { onclick: () => addSkill(s.id) }, learnable ? 'btn btn--quiet' : 'btn')); if (!learnable) acts.push(btn('Practise', { onclick: () => nav('blocked', { skill: s.id }) }, 'btn btn--quiet')); }
    else if (st.state === 'learning') acts.push(btn('Continue learning', { onclick: () => nav('learn', { skill: s.id }) }, 'btn'));
    else if (st.state === 'lapsed') { if (learnable) acts.push(btn('Re-learn', { onclick: () => nav('learn', { skill: s.id }) }, 'btn')); acts.push(btn('Practise', { onclick: () => nav('blocked', { skill: s.id }) }, learnable ? 'btn btn--quiet' : 'btn')); }
    else acts.push(btn('Practise', { onclick: () => nav('blocked', { skill: s.id }) }, 'btn'));
    if (gstore.countAttempts(s.id)) acts.push(btn('History', { onclick: () => nav('history', { skill: s.id }), 'aria-label': `History of ${s.title}` }, 'btn btn--quiet'));
    if (known) acts.push(btn('Reset', { onclick: () => resetSkill(s.id), 'aria-label': `Reset ${s.title}` }, 'btn btn--quiet g-skill__reset'));
    const what = s.set === 'questions' ? `${s.count} question${s.count === 1 ? '' : 's'}${s.data?.title ? ` · ${s.data.title}` : ''}` : s.set === 'vocab' ? `${s.count} word${s.count === 1 ? '' : 's'}${s.rev ? ' · English → Latin, an optional extra deck' : ' · Latin → English'}` : `${s.data?.A.length ?? 0} A · ${s.data?.B.length ?? 0} B · ${s.data?.C.length ?? 0} C · practise only`;
    return h('li', { class: 'g-skill g-skill--set', 'data-state': st.state, 'data-set': s.set },
      h('div', { class: 'g-skill__main' },
        h('p', { class: 'g-skill__title g-skill__title--set', text: s.rev ? `${SET_ROW_LABEL[s.set]} · English → Latin` : SET_ROW_LABEL[s.set] }),
        h('p', { class: 'g-skill__plain', text: what }),
        h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': can === false ? 'none' : st.state, 'aria-hidden': 'true' }), can === false ? 'no items yet' : dueText(st),
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
   */
  // Memoised on the stored string itself, so any write anywhere — here, a reset, another tab — is its own
  // invalidation. It became worth having when the map's progress meters started asking 88 times a paint:
  // 88 parses of the whole object become 88 `getItem`s and one parse.
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
      else if (b.type === 'paradigm') { const t = paradigmFor(skill, b); const node = t && renderParadigm(t); if (node) { node.open = true; out.push(h('div', { class: 'g-lesson__pt' }, node)); } }
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
  async function renderLessonView({ skill: id, from = null }) {
    const skill = skills.get(id);
    if (!skill) return renderMap();
    const st = stateOf(id);
    setBody(h('p', { class: 'g-loading', text: 'Loading the lesson…' }));
    const lesson = await lessonOf(id);
    const acts = [];
    if (st.state === 'new' || st.state === 'lapsed') acts.push(btn(st.state === 'lapsed' ? 'Re-learn this skill' : 'Start learning', { onclick: () => render('learn', { skill: id, from }) }, 'btn btn--primary'));
    if (st.state === 'learning') acts.push(btn('Continue learning', { onclick: () => render('learn', { skill: id, from }) }, 'btn btn--primary'));
    if (st.state === 'new') acts.push(btn('Add to mixed practice', { onclick: async () => { await addSkill(id); render('lesson', { skill: id, from }); } }, 'btn'));
    if (inRotation(st)) acts.push(btn('Practise this skill', { onclick: () => startBlocked(id, from) }, 'btn btn--primary'));
    // Two taps to a drill (§10): the row opened this; one more starts ten items on the skill alone.
    if (!skill.set && drillable(id)) acts.push(btn('Just drill it', { onclick: () => render('drill', { skill: id, from }), 'aria-label': `Just drill ${skill.title}: ten items, the rule pinned above each` }, st.state === 'new' ? 'btn' : 'btn btn--quiet'));
    // Unlimited practice and a mixed set (§11, §12): one more tap, on a skill with a generated bank. The manifest is
    // awaited here (the page is async anyway), so the first lesson opened after a cold start offers them too.
    if (!skill.set && drillable(id) && await hasBankAsync(id)) acts.push(...practiceButtons(skill, (name, params) => render(name, { ...params, from })));
    if (!skill.set && skill.paradigms?.length) acts.push(btn('Its tables', { onclick: () => render('catalogue', { table: skill.paradigms[0], from }) }, 'btn btn--quiet'));
    // Printable charts (GRAMMAR-CONTRACT.md, wave 3): the chart alone, one table a page with the focus cells boxed,
    // or the whole sheet — rule, forms and examples. Offered only where there is something to put on the paper.
    if (!skill.set && chartTable(skill)) acts.push(btn('Print chart', { onclick: () => printChart(skill) }, 'btn btn--quiet'));
    if (!skill.set) acts.push(btn('Print sheet', { onclick: () => printSheet(skill) }, 'btn btn--quiet'));
    if (gstore.countAttempts(id)) acts.push(btn('History', { onclick: () => render('history', { skill: id, from }) }, 'btn btn--quiet'));
    setBody(
      backButton(from),
      lessonHeader(skill, st),
      h('article', { class: 'g-lesson' }, lessonBlocks(skill, lesson)),
      h('div', { class: 'g-acts' }, acts));
  }
  const lessonHeader = (skill, st) => h('header', { class: 'g-head' },
    h('p', { class: 'g-kicker', text: `Cap. ${roman(skill.chapter)} · ${skill.course} week ${skill.week ?? '—'} · ${cap(skill.category.replace('-', ' '))}` }),
    h('h1', { class: 'g-title', text: skill.title }),
    h('p', { class: 'g-lede' }, skill.plain, skill.latin_label ? [' · ', h('i', { lang: 'la', text: skill.latin_label })] : null),
    h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': st.state, 'aria-hidden': 'true' }), dueText(st)),
    h('p', { class: 'g-summary', text: skill.summary }));

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
    btn('Unlimited practice', { onclick: () => nav('unlimited', { skill: skill.id }), 'aria-label': `Unlimited practice of ${skill.title}: its own sentences, then generated ones, ten at a time for as long as you like` }, 'btn btn--quiet'),
    mixedMembers(skill, skills, { chapter: ctx.currentChapter?.() ?? null, drillable }).length > 1
      ? btn('Mixed set', { onclick: () => nav('mixed', { skill: skill.id }), 'aria-label': `A mixed set: ${skill.title} interleaved with the skills it is confused with and builds on` }, 'btn btn--quiet')
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
    return h('div', { class: 'g-show g-show--cells' },
      h('p', { class: 'g-lesson__tag', text: `${r.table?.label ?? show.key} · ${r.rows.map((row) => row.label).join(' and ')}` }),
      h('div', { class: 'pt__scroll' }, table),
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
  function prereqNode(skill, missing, { queue = [], from = null } = {}) {
    if (!missing.length) return null;
    const names = missing.map((id) => h('b', { text: titleOf(id) }));
    const list = names.flatMap((n, i) => (i === 0 ? [n] : i === names.length - 1 ? [' and ', n] : [', ', n]));
    const node = h('aside', { class: 'g-prereq', 'aria-label': 'Before this skill' },
      h('p', { class: 'g-prereq__line' }, 'This builds on ', ...list, `, which ${missing.length === 1 ? 'is' : 'are'} not in your practice yet. You can learn ${missing.length === 1 ? 'it' : 'them'} first and come back here, or go on.`),
      h('div', { class: 'g-acts' },
        btn(`Learn ${titleOf(missing[0])} first`, { onclick: () => render('learn', { skill: missing[0], queue: [...missing.slice(1), skill.id, ...queue], from }) }, 'btn'),
        btn('Go on', { onclick: () => { node.remove(); body.querySelector('.g-step__title')?.focus?.({ preventScroll: true }); } }, 'btn btn--quiet')));
    return node;
  }

  async function renderLearnStart({ skill: id, queue = [], from = null }) {
    const skill = skills.get(id);
    if (!skill) return renderMap();
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
     * where they were. A done step now carries a tick and is a button that
     * jumps to it — the deliberate "unless I purposely want to retry". A step
     * not yet answered is not a control: the runner has never let anyone past
     * an unanswered check, and a pip that could would be a way round the
     * teaching rather than through it.
     */
    const stepper = (at) => {
      if (skill.set) {
        const marks = [skill.set === 'vocab' ? 'The deck, a batch at a time' : 'The passage\'s questions', 'Blocked 10'];
        return h('ol', { class: 'g-steps', 'aria-label': 'Learn steps' }, marks.map((s, j) => h('li', { class: 'g-steps__s', 'aria-current': at === j ? 'step' : null }, s)));
      }
      const marks = [...learn.steps.map((s, i) => s.title || `Step ${i + 1}`), 'Ten items'];
      const allDone = learn.steps.every((_, i) => doneSteps.has(i));
      return h('ol', { class: 'g-steps g-steps--n', 'aria-label': 'Learn steps' }, marks.map((title, j) => {
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
        body.append(...[
          step.say ? h('p', { class: 'g-step__say' }, prose(step.say)) : null,
          // A shown sentence that the worked example then parses is printed once, with the parse under it.
          show && !sameSentence ? writtenNode(show, { focus: showFocus }) : null,
          step.show?.kind === 'paradigm' ? revealNode(teachItems, step.show) : null,
          wn?.node ?? null].filter(Boolean));   // `Element.append` prints a null as the word "null"
        return !!(wn && !wn.done());
      };
      // The noticing opener first (§10): the rest of the step, and its check, wait on it — one tap skips it.
      const nn = step.notice ? noticeNode(step.notice, teachItems, { onDone: () => { const gated = fillBody(); body.hidden = false; if (!gated) leadDone(); body.querySelector('.g-step__say, .g-worked__ask .g-q')?.scrollIntoView?.({ block: 'nearest' }); } }) : null;
      const lead = h('section', { class: 'g-step', 'aria-label': `Step ${n} of ${nSteps}` },
        (slot?.step ?? i) === 0 ? prereqNode(skill, missing, { queue, from }) : null,
        h('p', { class: 'g-kicker', text: `Step ${n} of ${nSteps}` }),
        h('h2', { class: 'g-step__title', tabindex: '-1', text: step.title || skill.title }),
        nn?.node ?? null,
        body);
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
      runSession({ runner: learn.runner, title: 'Check', mode: 'learn', hintOpen: false, stepper: (slot) => stepper(slot?.step ?? 0), lesson, before: stepLead, onDone: showBlocked });
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
      const missedKinds = [...new Set(r.missed.map((a) => a.kind))];
      const passed = r.passed;
      // The blocked ten's own misses, as items that can be rebuilt (a self-graded "partly" is not one).
      const redoMissed = r.missed.filter((a) => a.item_key && !a.partial);
      if (passed) setLearnPlace(id, null);
      // The same-session re-test (§10) and the reading tie-in (§13) belong to a skill that has just been learned.
      if (passed && !skill.set) noteRetestFor(id);
      const after = h('div', { class: 'g-after' }, passed ? retestNode({ only: id, from }) : null);
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
        h('div', { class: 'g-acts' },
          // "Redo the N you missed" from a Learn run, but only once the run has **passed**: the skill is in the
          // rotation from that moment, so a redo is the ordinary logged encounter the contract describes. On a
          // failed run the honest offer is another ten (below), not a session that would graduate the skill.
          passed && redoMissed.length ? btn(`Redo the ${redoMissed.length} you missed`, { onclick: () => render('redo', { misses: redoMissed, skill: id, from }), 'aria-label': `Redo the ${redoMissed.length} item${redoMissed.length === 1 ? '' : 's'} you missed in this drill` }, 'btn btn--primary') : null,
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
    if (!skill) return renderMap();
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
  }
  const nothingToDrill = (skill, from) => [h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: skill.title }), h('p', { class: 'g-lede', text: 'No sentences fit this skill yet, so there is nothing to drill. Add the review shelf or another week and come back.' })), h('div', { class: 'g-acts' }, backButton(from, 'btn'))];

  /* ------------------------------------- unlimited and mixed practice (§11, §12) */
  /**
   * **Unlimited practice** (§11): the drill, open-ended — ten at a time, "Ten
   * more" at the end of each, the skill's written sentences first and then its
   * generated bank, nothing repeated until the whole bank has come round.
   */
  async function renderUnlimited({ skill: id, from = null }) {
    const skill = skills.get(id);
    if (!skill) return renderMap();
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
    if (!skill) return renderMap();
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
  function retestNode({ only = null, from = null } = {}) {
    const now = Date.now();
    const list = retestList().filter((r) => skills.has(r.skill) && (!only || r.skill === only));
    const due = retestDue(list, now);
    const pending = retestPending(list, now);
    if (!due.length && !pending.length) return null;
    const node = h('div', { class: 'g-retest' });
    if (due.length) {
      node.append(h('p', { class: 'g-retest__line' }, `${due.length === 1 ? 'A short re-test is ready' : 'Short re-tests are ready'}: three items each, on what you learned or drilled earlier.`),
        h('div', { class: 'g-acts' }, due.map((r) => btn(`Re-test ${titleOf(r.skill)}`, { onclick: () => render('drill', { skill: r.skill, size: RETEST_SIZE, retest: true, from }), 'aria-label': `Re-test ${titleOf(r.skill)}: three items` }, 'btn btn--primary'))));
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
  loadParadigmCatalogue().then((c) => { selectRules = Array.isArray(c?.raw?.select) ? c.raw.select : null; }).catch(() => {});
  /** The table a chart item is on: the catalogue's id where the item names it, else the select rules on its word, else the word itself. */
  const tableIdOfItem = (item) => item?.chart?.tableId ?? (selectRules ? tableIdOf(item?.entry, selectRules) : null) ?? item?.entry?.h ?? null;
  /** The cells a skill teaches on a table: those its `paradigm_focus` names — never given (§12). */
  const taughtCellsOf = (item, skill) => {
    const focus = skill?.paradigm_focus;
    if (!focus || typeof focus !== 'object') return [];
    const fits = (key) => key && Object.entries(focus).every(([k, v]) => v == null || (Array.isArray(v) ? v.map(String) : [String(v)]).includes(String(key[k] ?? '')));
    return (item.chart?.cells ?? []).map((c, i) => (fits(chartCellKey(item, c)) ? (c.cellId ?? cellId(chartCellKey(item, c), item.chart?.table?.kind) ?? `#${i}`) : null)).filter(Boolean);
  };
  const scaffoldLabel = (level) => (level === 'auto' ? 'auto' : level === 'off' ? 'off' : `${level}%`);
  /**
   * The switch on the table itself (§13): auto · 80 · 50 · 20 · off, one tap,
   * no confirmation. The table on screen finishes as it started; the next one
   * drawn honours the change.
   */
  function scaffoldSwitch(tableId, { current, percent, onChange = null } = {}) {
    const seg = h('div', { class: 'g-seg g-seg--scaffold', role: 'group', 'aria-label': 'How much of the table is given' },
      SCAFFOLD_LEVELS.map((lv) => btn(scaffoldLabel(lv), { 'aria-pressed': String(lv === current), onclick: (e) => { setScaffold(tableId, lv); for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); note.textContent = noteText(lv); ctx.say(`Given cells: ${scaffoldLabel(lv)} from the next table.`); onChange?.(lv); } }, 'g-seg__btn')));
    const noteText = (lv) => (lv === current ? (percent > 0 ? `${percent}% of this table is given${lv === 'auto' ? ' — auto fades a level after a table right unaided' : ''}.` : 'A blank table.')
      : `From the next table: ${lv === 'auto' ? 'auto, starting at 80%' : lv === 'off' ? 'a blank table' : `${lv}% given`}. This one finishes as it started.`);
    const note = h('p', { class: 'g-quiet g-scaffold__note', text: noteText(current) });
    return h('div', { class: 'g-scaffold' }, h('span', { class: 'g-label', text: 'Given' }), seg, note);
  }

  /* ---------------------------------------------- the catalogue (§4, §11) */
  let catalogueItemsP = null;
  /** The catalogue's generator: the catalogue, the headword index and the dictionary, built once. */
  const catalogueItemsOf = () => (catalogueItemsP ??= Promise.all([loadParadigmCatalogue(), loadHeadwords()]).then(([catalogue, headwords]) => (catalogue ? { catalogue, gen: createCatalogueItems({ catalogue, lookup: dict.lookup, paradigm: par.paradigm, headwords, skills }) } : null)).catch(() => null));
  const catState = { category: 'all', chapter: null, word: new Map(), group: new Map(), axes: new Map() };
  const CATEGORY_LABEL = { 'noun-case': 'Noun cases', 'verb-form': 'Verb forms', pronoun: 'Pronouns', adjective: 'Adjectives', numeral: 'Numerals' };
  const readerChapter = () => ctx.currentChapter?.() ?? null;
  /**
   * The paradigm catalogue (§4, decision 9): by part of speech, then table,
   * each naming the chapter that introduces it, filtered by category and by
   * chapter. A table opens to its own page.
   */
  async function renderCatalogue({ table = null, from = null, category = null, chapter = undefined } = {}) {
    setBody(h('p', { class: 'g-loading', text: 'Loading the tables…' }));
    const got = await catalogueItemsOf();
    if (!got) { setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Tables' }), h('p', { class: 'g-lede', text: 'The paradigm catalogue could not be loaded.' })), h('div', { class: 'g-acts' }, backButton(from, 'btn'))); return; }
    if (table) { renderTable(got, table, { from }); return; }
    if (category) catState.category = category;
    if (chapter !== undefined) catState.chapter = chapter;
    const { catalogue } = got;
    const parts = Array.isArray(catalogue.raw?.parts) ? catalogue.raw.parts : [];
    const cats = ['all', ...new Set(parts.flatMap((p) => p.tables.map((t) => t.category)).filter(Boolean))];
    const shown = (t) => (catState.category === 'all' || t.category === catState.category) && (catState.chapter == null || (t.chapter != null && t.chapter <= catState.chapter));
    // The lede counts what is on screen, not what the catalogue holds: under a filter it went on saying
    // "65 tables" above four of them (N-9).
    const allTables = catalogue.tables.size;
    const listed = parts.reduce((n, p) => n + p.tables.filter(shown).length, 0);
    const head = h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Tables' }),
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
        h('ul', { class: 'g-skills g-tables' }, tables.map((t) => h('li', { class: 'g-skill g-table' },
          h('div', { class: 'g-skill__main' },
            h('button', { type: 'button', class: 'g-skill__title', onclick: () => render('catalogue', { table: t.id, from }) }, t.label),
            h('p', { class: 'g-skill__plain' }, h('span', { lang: 'la', class: 'g-table__ex', text: t.example }), t.chapter != null ? ` · from chapter ${roman(t.chapter)}` : ' · not in a chapter', t.skills?.length ? ` · ${t.skills.length} skill${t.skills.length === 1 ? '' : 's'}` : '')),
          h('div', { class: 'g-skill__acts' }, btn('Open', { onclick: () => render('catalogue', { table: t.id, from }), 'aria-label': `Open ${t.label}` }, 'btn'))))));
    });
    setBody(head, h('div', { class: 'g-cat__filters' }, filterNode, chapterSel), sections.filter(Boolean).length ? sections : h('p', { class: 'g-quiet', text: 'No table matches this filter.' }));
  }

  /**
   * One table's page (decision 10): see it filled, practise one cell across
   * words, practise the whole table, switch the word — the stock words, or a
   * word from the library — the axes it honestly offers (§5), and the
   * scaffold switch (§12). Every box here has the same immediate feedback and
   * the same per-cell hint as everywhere else.
   */
  function renderTable(got, tableId, { from = null } = {}) {
    const { catalogue, gen } = got;
    const t = catalogue.table(tableId);
    if (!t) { render('catalogue', { from }); return; }
    const stock = catalogue.stock(t.id);
    const chosen = catState.word.get(t.id) ?? stock[0] ?? null;
    const word = chosen ? gen.wordEntry(chosen, t.id) : null;
    const wordHead = word ? word.entry.lemma.split(/[\s,]/)[0] : '';
    const namingSkill = (t.skills ?? []).map((id) => skills.get(id)).find(Boolean) ?? null;
    const groups = t.groups ?? [];
    const group = catState.group.get(t.id) ?? (groups.length === 1 ? groups[0].id : null);
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
    const filled = word ? renderParadigm(word.table) : null;
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
      const drill = createCatalogueDrill({ items: built, gstore, skillId: namingSkill?.id ?? null });
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
      runSession({ runner: drill.runner, title, note, mode: 'practice', hintOpen: false, onDone: (summary) => renderSummary(summary, { catalogue: t.id, from }) });
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
      h('div', { class: 'g-acts' }, btn(groups.length > 1 && !group ? 'Choose a part above' : 'Practise it', { onclick: whole, disabled: groups.length > 1 && !group ? true : null }, 'btn btn--primary')));

    const acts = [];
    if (namingSkill) acts.push(btn(`Just drill ${namingSkill.title}`, { onclick: () => render('drill', { skill: namingSkill.id, from }) }, 'btn'), btn('Its lesson', { onclick: () => render('lesson', { skill: namingSkill.id, from }) }, 'btn btn--quiet'));
    setBody(
      btn('← Tables', { onclick: () => render('catalogue', { from }) }, 'btn btn--quiet g-back'),
      h('header', { class: 'g-head' },
        h('p', { class: 'g-kicker', text: `${cap(t.part ?? '')} · ${CATEGORY_LABEL[t.category] ?? t.category}${t.chapter != null ? ` · from chapter ${roman(t.chapter)}` : ''}` }),
        h('h1', { class: 'g-title', text: t.label }),
        h('p', { class: 'g-lede' }, 'The model word: ', h('span', { lang: 'la', text: t.example }), t.skills?.length ? `. Used by ${t.skills.slice(0, 3).map(titleOf).join(', ')}${t.skills.length > 3 ? ` and ${t.skills.length - 3} more skills` : ''}.` : '.'),
        acts.length ? h('div', { class: 'g-acts' }, acts) : null),
      wordNode, filledNode, oneCellNode, axesNode, wholeNode);
  }

  /* --------------------------------------------------------- practice */
  /**
   * **What a mixed set is allowed to mix** (the learner's four messages of
   * 2026-09-11). The populations are the app's own four, not a new taxonomy:
   * the grammar skills of `skills.json`, and each chapter's questions,
   * vocabulary and pensa, which `setSkills` builds as pseudo-skills and the
   * map lists under "Chapter sets". A population with nothing drillable in
   * this library is not offered at all — a control that cannot change
   * anything is worse than no control.
   */
  const populationsOffered = () => POPULATIONS.filter((p) => [...skills.values()].some((s) => populationOf(s) === p && drillable(s.id)));
  /** The learner's choice, cleaned against what is offered. Never chosen = everything. */
  const chosenPopulations = () => normalisePopulations(ctx.prefs().populations, populationsOffered());
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
  /** Every id a mixed set may draw on, given the chosen populations and whether untouched material is let in. */
  const mixPool = (pops = chosenPopulations(), withNew = unstudiedOn()) => [...skills.keys()]
    .filter((id) => drillable(id) && pops.includes(populationOf(skills.get(id))) && (inRotation(stateOf(id)) || (withNew && untouched(id))));

  // `from` is the chapter page this was opened from, when it was (the by-chapter view's "Practise"): it names
  // the Back button and the way out. Without the parameter the view crashed on `from` the moment it was drawn.
  function renderSetup({ from = null } = {}) {
    const prefs = ctx.prefs();
    const offered = populationsOffered();
    let pops = normalisePopulations(prefs.populations, offered);
    let unstudied = unstudiedOn();
    const rotation = [...skills.keys()].filter((id) => inRotation(stateOf(id)) && drillable(id));
    let pool = mixPool(pops, unstudied);
    const cw = [...ctx.currentWeekSkills(), ...(ctx.currentWeekSets?.() ?? [])];
    const onShelf = isShelfWeek(ctx.currentWeekN());
    let size = prefs.size;
    let preset = prefs.preset;
    let oneSkill = prefs.oneSkill && pool.includes(prefs.oneSkill) ? prefs.oneSkill : pool[0] ?? null;
    // The one emptiness left: this library can drill nothing at all, so no choice on this screen could fill a
    // session. "Nothing is in mixed practice yet" is no longer one of them — that is what the controls below are for.
    if (!offered.length) {
      setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Practice' }), h('p', { class: 'g-lede', text: 'Nothing here can be drilled yet — no sentence in the library fits a skill, and no chapter set has arrived. The lessons are there to read.' })),
        h('div', { class: 'g-acts' }, btn('Go to the skills', { onclick: () => render('map') }, 'btn btn--primary')));
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
    // Four toggles in the section's own filter pattern (the map's category filter), one per population, each
    // saying how many rows it would contribute; an All / None pair beside them; and the switch that decides
    // whether material never opened may come up. Every change is written to settings at once — the learner may
    // walk away from this screen and start a session from the Today card, which never passes through here.
    const popBtn = new Map();
    const ledeNode = h('p', { class: 'g-lede' });
    const mixNoteNode = h('p', { class: 'g-quiet' });
    const startBtn = btn('Start', { onclick: () => start() }, 'btn btn--primary');
    const emptyNode = h('p', { class: 'g-quiet g-mix__empty', hidden: true });
    const saveMix = () => ctx.savePrefs({ populations: pops, unstudied, preset, size, oneSkill, hints });
    const paintMix = () => {
      pool = mixPool(pops, unstudied);
      for (const [p, b] of popBtn) {
        b.setAttribute('aria-pressed', String(pops.includes(p)));
        b.textContent = `${POPULATION_LABEL[p]} · ${mixPool([p], unstudied).length}`;
      }
      mixNoteNode.textContent = mixNote(pops, offered);
      // Every number here counts **this mix**, not the whole rotation: a lede that said "11 due" over a mix
      // of four would be a count of something the learner cannot reach from this screen.
      const extra = pool.filter((id) => !inRotation(stateOf(id))).length;
      const due = pool.filter((id) => isDue(stateOf(id)));
      const crossable = new Set();
      for (const id of due) for (const c of skills.get(id)?.confusable_with ?? []) if (due.includes(c)) crossable.add([id, c].sort().join('|'));
      ledeNode.textContent = `${pool.length} in the mix${extra ? `, ${extra} of them never opened` : ''} · ${due.length} due${crossable.size ? ` · ${crossable.size} pair${crossable.size === 1 ? '' : 's'} that are easy to cross` : ''}.`;
      // "This week" can become possible the moment a population or the switch lets one of the week's skills in.
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
      emptyNode.hidden = !!pool.length;
      emptyNode.textContent = !pops.length
        ? 'Nothing can be built from an empty mix. Turn a population on, or press All.'
        : unstudied
          ? 'Nothing in the chosen populations can be drilled yet.'
          : 'Nothing you have studied is in the chosen populations. Turn on "Include what you have not studied", or add some from the skill map.';
    };
    const popFilter = h('div', { class: 'g-filter', role: 'group', 'aria-label': 'What goes in the mix' }, offered.map((p) => {
      const b = btn('', { onclick: () => { pops = pops.includes(p) ? pops.filter((x) => x !== p) : normalisePopulations([...pops, p], offered); paintMix(); saveMix(); ctx.say(mixNote(pops, offered)); } }, 'g-filter__btn');
      popBtn.set(p, b);
      return b;
    }));
    const allNone = h('div', { class: 'g-seg g-seg--allnone', role: 'group', 'aria-label': 'All or none' },
      btn('All', { onclick: () => { pops = [...offered]; paintMix(); saveMix(); ctx.say(mixNote(pops, offered)); } }, 'g-seg__btn'),
      btn('None', { onclick: () => { pops = []; paintMix(); saveMix(); ctx.say(mixNote(pops, offered)); } }, 'g-seg__btn'));
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
      await ctx.savePrefs({ populations: pops, unstudied, preset, size, oneSkill, hints });
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
          h('div', { class: 'g-mix' }, popFilter, allNone), mixNoteNode, unstudiedSwitch,
          h('p', { class: 'g-quiet', text: `${rotation.length} of the ${[...skills.keys()].filter(drillable).length} things here have been put into practice. With the switch on, a mixed set also draws on the ones you have never opened — they come after everything that is due, and answering one puts it into practice for good.` }),
          emptyNode),
        h('div', { class: 'g-setup__row' }, h('span', { class: 'g-label', text: 'Items' }), sizeGroup),
        h('div', { class: 'g-setup__row g-setup__row--col' }, h('span', { class: 'g-label', text: 'Mix' }), presetList, pick),
        h('div', { class: 'g-setup__row g-setup__row--col' }, h('span', { class: 'g-label', text: 'Hints' }), hintList,
          // What a hint now is (§6 decision 14, §12): it opens as a nudge, and its last step hands over the
          // form. The old line promised a hint "never spells the answer", which the shipped hint does (M-9).
          h('p', { class: 'g-quiet', text: 'Every answer box has its own hint — a typed field, each cell of a chart, each blank of a pensum, each word of an order or match item. A hint starts as a nudge: what that box is being asked for, and the rule behind it. Its last step, "Show this form", gives that one box its answer and marks the box hinted, which counts as weaker evidence. This choice holds for every session.' }))),
      h('div', { class: 'g-acts' }, startBtn, btn(from ? backLabel(from).replace('← ', 'Back to ') : 'Back to skills', { onclick: () => leaveTo(from) }, 'btn btn--quiet')));
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
    const offered = populationsOffered();
    const pops = ch != null ? offered : chosenPopulations();
    const unstudied = ch != null ? false : unstudiedOn();
    let world = ch != null ? skillsIndex : { ...skillsIndex, skills: filterPopulations(skillsIndex.skills, pops, offered) };
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
    if (!first) { writeJSON(LS_SESSION, null); setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Nothing to practise' }), h('p', { class: 'g-lede', text: ch != null ? `No sentences in the library fit chapter ${roman(ch)}'s skills yet.` : `Nothing in this mix can produce an item. ${mixNote(pops, offered)}` })), h('div', { class: 'g-acts' }, backButton(params.from, 'btn'), btn('Change the mix', { onclick: () => render('setup', { from: params.from }) }, 'btn btn--quiet'))); return; }
    if (usable) ctx.say('Session resumed.');
    // The header says what is actually in the set. A mix cut down to one population read "Practice · Review-heavy"
    // over ten vocabulary cards and named neither the narrowing nor the untouched material it had let in.
    const narrowed = ch != null ? '' : mixTitle(pops, offered);
    const title = ch != null ? `Practise · Cap. ${roman(ch)}` : `Practice · ${(PRESET_LABEL[params.preset] ?? PRESET_LABEL['review-heavy'])[0]}${narrowed ? ` · ${narrowed}` : ''}`;
    const note = ch != null ? '' : `${mixNote(pops, offered)}${unstudied ? ' Material you have never opened is let in, after everything that is due.' : ''}`;
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
    if (skillId != null && !skills.has(skillId)) { render('map'); return; }
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
      h('div', { class: 'g-acts' }, btn('Practice', { onclick: () => render('setup', { from }) }, 'btn btn--primary'), backButton(from, 'btn btn--quiet')));
  }

  /** "Practise this skill": a view of its own, so Back leaves it and a chapter page can open it through `ctx.go`. */
  const startBlocked = (id, from = null) => render('blocked', { skill: id, from });
  function renderBlocked({ skill: id, from = null }) {
    const skill = skills.get(id);
    if (!skill) return renderMap();
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
    // The shell's own router (`onChapterNav`): back to the chapter page, on its Grammar tab.
    if (from?.chapter != null && typeof ctx.openChapter === 'function') { ctx.openChapter(Number(from.chapter), 'grammar'); return; }
    if (from?.chapter != null) { mapView = 'chapter'; render('map', { chapter: Number(from.chapter) }); return; }
    render('map');
  }
  const backLabel = (from) => (from?.chapter != null ? `← Cap. ${roman(Number(from.chapter))}` : '← Skills');
  const backButton = (from, cls = 'btn btn--quiet g-back') => btn(backLabel(from), { onclick: () => leaveTo(from) }, cls);
  function renderSummary(summary, params) {
    view = { name: 'summary', params };
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
    const after = h('div', { class: 'g-after' }, retestNode({ from: params?.from ?? null }));
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
      h('div', { class: 'g-acts' },
        // The redo is narrowed exactly as the session was, and no further: `oneSkill` rides in the params of
        // every mixed session as the remembered choice for the "One skill" preset, so it names the session's
        // world only when that preset was the one actually used (a redo of five mixed skills is not one skill's).
        missed.length ? btn(`Redo the ${missed.length} you missed`, { onclick: () => render('redo', { misses: missed, skill: params?.skill ?? (params?.preset === 'one-skill' ? params.oneSkill : null) ?? null, chapter: params?.chapter ?? null, from: params?.from ?? null }), 'aria-label': `Redo the ${missed.length} item${missed.length === 1 ? '' : 's'} you missed in this session` }, 'btn btn--primary') : null,
        btn(againLabel, { onclick: again }, `btn ${missed.length ? '' : 'btn--primary'}`.trim()),
        btn(params?.from?.chapter != null ? backLabel(params.from).replace('← ', '') : 'Skills', { onclick: () => leaveTo(params?.from ?? null) }, 'btn btn--quiet'), btn('Stats', { onclick: () => render('stats') }, 'btn btn--quiet')));
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
  function runSession({ runner, title, note = '', mode, hintOpen = false, stepper = null, lesson = null, onDone, practiceLink = false, open = false, more = null, before = null }) {
    const wrap = h('div', { class: 'g-run' });
    // A stepper given as a function follows the run (Learn's steps): it is repainted for the slot on screen.
    const stepHolder = typeof stepper === 'function' ? h('div', { class: 'g-stepwrap' }) : null;
    const paintStepper = () => { if (stepHolder) { const n = stepper(runner.itemAt(runner.position)?.slot ?? runner.current?.slot ?? null); stepHolder.replaceChildren(...(n ? [n] : [])); } };
    const backB = btn([h('span', { 'aria-hidden': 'true', text: '←' })], { 'aria-label': 'Back to the previous item', onclick: () => go(-1) }, 'g-runnav__b');
    const fwdB = btn([h('span', { 'aria-hidden': 'true', text: '→' })], { 'aria-label': 'On to the next item', onclick: () => go(1) }, 'g-runnav__b');
    const posEl = h('span', { class: 'g-runnav__pos' });
    const nav = h('nav', { class: 'g-runnav', 'aria-label': 'This session' }, backB, posEl, fwdB);
    setBody(stepHolder ?? stepper, nav, wrap);
    const pages = [];        // queue index → the rendered page, kept so a step back shows it as it was left
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
            onRetry: result.correct ? null : () => { pages[i] = build(i, item, { fresh: true, keepLead: lead?.node ?? null }); wrap.replaceChildren(pages[i]); paintNav(); focusPage(pages[i]); ctx.say('Starting that one again.'); },
            onPractice: () => nested(item.skill) });
          // One verdict on screen at a time: a second guess replaces the first answer's feedback rather
          // than stacking under it. It is never taken away while the item is still answerable — the
          // pointer-dictionary reads a feedback node to know a tap item's words may be looked up again.
          page.querySelector(':scope > .g-fb')?.remove();
          page.append(fb);
          page.dataset.result = result.correct ? 'ok' : 'bad';
          paintNav();
          ctx.say(fb.querySelector('.g-fb__line')?.textContent ?? '');
          fb.scrollIntoView({ block: 'nearest' });
          // Nothing moves on by itself, right or wrong: the feedback is the teaching, and it was being
          // read for 1.4 s and then taken away. "Next" is focused, so Enter is still one key — except
          // where the item is live, and there the focus belongs back in the box being corrected (`submit`).
          if (!live) fb.querySelector(result.correct ? '.g-fb__next' : '.g-fb__retry, .g-fb__next')?.focus({ preventScroll: true });
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

  function itemNode(item, { title, note = '', position, hintOpen, onHint, onAnswer }) {
    const skill = skills.get(item.skill);
    ctx.current = item;   // the item on screen (window.latinGrammar.current — tests / debugging)
    // The position moved out of the item and into the session's nav bar, where the arrows are and where it
    // stays true as the session grows: a page is kept as it was left, so a number printed on it would go stale.
    const node = h('section', { class: 'g-item', 'data-kind': item.kind, 'data-input': item.input, 'data-pos': String(position) });
    node.append(h('p', { class: 'g-item__meta' }, h('span', { class: 'g-item__title', text: title })));
    if (note) node.append(h('p', { class: 'g-quiet g-item__note', text: note }));
    node.append(h('p', { class: 'g-item__skill', text: `${skill?.title ?? item.skill} · ${KIND_LABEL[item.kind] ?? item.kind}${item.pensum ? ` ${item.pensum}` : ''}` }));
    // "Just drill it" pins the rule at the top of every item (§10), so the learner can look without leaving.
    if (item.pin) node.append(h('p', { class: 'g-pin' }, h('span', { class: 'g-lesson__tag', text: 'The rule' }), ' ', prose(item.pin)));
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
      inp.addEventListener('input', () => { cells.paint(i, null); syncCheck(); });
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
  function boxKeys(e, { inputs, hints, mark }) {
    const at = [...inputs.entries()].find(([, el]) => el === e.target);
    if (!at) return;
    const [i, inp] = at;
    if (e.altKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); hints.get(i)?.click(); return; }
    if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey) return;
    mark(i, inp.value);
    const next = [...inputs.entries()].find(([, el]) => !el.value.trim());
    if (next) { e.preventDefault(); next[1].focus({ preventScroll: true }); }
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
    chart.given = given;
    const givenSet = new Set(given);
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
        syncCheck();
      };
      const hint = hintFor(i, { onOpen: () => paintCells.hinted(i), peek });
      if (hint) hints.set(i, hint);
      const mark = h('span', { class: 'g-cellmark', 'aria-hidden': 'true' });
      const wrap = h('span', { class: 'g-cellwrap' }, inp, mark, hint);
      boxes.set(i, { input: inp, wrap, mark });
      return wrap;
    };
    // A given cell: printed filled and greyed, not editable, with the same hint so the learner can ask why (§12).
    const cellGiven = (i) => {
      const c = chart.cells[i];
      const hint = hintFor(i, { onOpen: () => {}, given: true });
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
        return h('div', { class: 'g-chart__word' }, h('label', { class: 'g-chart__wlabel', for: `gc-${i}` }, h('span', { lang: 'la', class: 'g-chart__wlemma', text: c.word }), h('span', { class: 'g-chart__wcell', text: c.cellLabel ?? c.label })), w);
      })));
    } else if (cells.length === 1) {
      const c = cells[0];
      const i = chart.cells.indexOf(c);
      form.append(h('div', { class: 'g-chart__one' }, h('label', { class: 'g-label', for: `gc-${i}` }, `${item.lemma.split(/[\s,]/)[0]} · ${c.label}`), cellIn(i, c.label)));
      inputs.get(i).id = `gc-${i}`;
    } else {
      // The note says what *this* table gives, not what the switch is set to: after a retry the two can differ,
      // because the table on screen keeps the cells it was given while the switch may have been moved (N-5).
      if (tableId) form.append(scaffoldSwitch(tableId, { current: level, percent: chart.cells.length ? Math.round((given.length / chart.cells.length) * 100) : 0 }));
      // The sections the cells come from: one for an ordinary chart, several for a catalogue table that spans them.
      const secIdx = chart.multi ? [...new Set(chart.cells.map((c) => c.section ?? chart.section))] : [chart.section];
      for (const si of secIdx) {
        const sec = chart.table.sections[si];
        if (!sec) continue;
        const tbl = h('table', { class: 'pt g-chart__t' }, sec.title ? h('caption', { class: 'pt__caption', text: `${item.lemma} · ${sec.title}` }) : null,
          sec.headers?.length ? h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'pt__corner', 'aria-label': 'form' }), sec.headers.map((hd) => h('th', { scope: 'col', text: hd })))) : null,
          h('tbody', {}, sec.rows.map((r, ri) => h('tr', {}, h('th', { scope: 'row', text: r.label }), r.cells.map((cell, ci) => {
            const idx = chart.cells.findIndex((c) => (c.section ?? chart.section) === si && c.row === ri && c.col === ci);
            if (idx >= 0 && givenSet.has(idx)) return h('td', { class: 'pt__cell g-chart__given' }, cellGiven(idx));
            if (idx >= 0) return h('td', { class: 'pt__cell g-chart__in' }, cellIn(idx, chart.cells[idx].label));
            return h('td', { class: `pt__cell${cell?.empty ? ' is-empty' : ''}`, lang: 'la', text: cell?.empty ? '—' : cell?.text ?? '—' });
          })))));
        form.append(h('div', { class: 'pt__scroll' }, tbl));
      }
      if (given.length) form.append(h('p', { class: 'g-quiet g-chart__givennote', text: `${given.length} of ${chart.cells.length} cells are given in grey; fill the ${chart.cells.length - given.length} others. The given ones have their own hint.` }));
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
    form.append(h('div', { class: 'g-chart__acts' }, check), needOne, keyHelp('Tab moves to the next cell and marks the one you leave; Alt+H shows that cell’s form and hides it again; Enter checks once every cell is filled.'));
    // Said before the keys line, because it explains why boxes already have writing in them.
    if (keptHere) form.insertBefore(h('p', { class: 'g-quiet g-chart__keptnote', text: `The ${keptHere === 1 ? 'cell' : `${keptHere} cells`} you had right ${keptHere === 1 ? 'is' : 'are'} kept; ${emptyHere === 1 ? 'the empty one is the one' : `the ${emptyHere} empty ones are the ones`} that went wrong. Every cell is judged again when you check.` }), form.querySelector('.g-chart__acts'));
    form.addEventListener('keydown', (e) => boxKeys(e, { inputs, hints, mark: (i) => paintCells.mark(i, valueOf(i), { announce: true }) }));
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
      h('div', { class: 'g-fb__rule' }),
      // "Reached from the skill map and from an item's feedback" (GRAMMAR-CONTRACT.md, wave 3). Inside the
      // expandable, so a keyboard Enter on Next can never land on it by accident mid-session.
      h('p', { class: 'g-fb__hist' }, h('button', { type: 'button', class: 'g-link', onclick: () => render('history', { skill: item.skill }) }, `How ${skill?.title ?? 'this skill'} has gone`)),
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
    const plan = buildToday({ states: gstore.getStates(), skills, currentWeek: ctx.currentWeekSkills(), weekChapter: ctx.currentChapter?.() ?? null, attempts: gstore.getAttempts(), unread: place === 'weeks' ? unread : 0, pace, now, dismissed: ctx.settings?.todayDismissed ?? null, drillable: ctx.items ? drillable : null });
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
      h('span', { class: 'g-plan__label', text: l.label }),
      h('span', { class: 'g-plan__detail' }, l.detail, l.minutes != null ? h('span', { class: 'g-plan__min', text: ` · ${fmtMinutes(l.minutes)}` }) : null),
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
    setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Stats' }), h('p', { class: 'g-lede', text: 'Grammar only — the reading study log is in Settings.' })),
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
          h('span', { class: 'g-perskill__name' }, h('span', { class: 'g-dot', 'data-state': stateOf(id).state, 'aria-hidden': 'true' }), h('button', { type: 'button', class: 'g-link', onclick: () => render('history', { skill: id }), 'aria-label': `History of ${titleOf(id)}` }, titleOf(id))),
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
            h('button', { type: 'button', class: 'g-link', onclick: () => render('history', { skill: c.a }) }, titleOf(c.a)),
            ' and ',
            h('button', { type: 'button', class: 'g-link', onclick: () => render('history', { skill: c.b }) }, titleOf(c.b))),
          h('span', { class: 'g-pair__count', text: `${c.count} time${c.count === 1 ? '' : 's'}` })),
        why,
        h('p', { class: 'g-pair__dir g-quiet', text: direction }),
        h('div', { class: 'g-pair__acts' },
          btn('Start', { onclick: () => render('session', { pair: [c.a, c.b], size: 10 }), 'aria-label': `Practise ${titleOf(c.a)} against ${titleOf(c.b)}: ten items` }, 'btn'),
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
          h('div', { class: 'g-acts' }, btn('Back to stats', { onclick: () => render('stats') }, 'btn')));
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
    if (!first) { setBody(h('p', { class: 'g-quiet', text: 'No sentences fit these two skills yet.' }), h('div', { class: 'g-acts' }, btn('Back to stats', { onclick: () => render('stats') }, 'btn'))); return; }
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
    if (!skill) { render('map'); return; }
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
    if (missedHere) acts.push(btn(`Redo the ${missedHere} you missed`, { onclick: () => render('redo', { skill: id, from }), 'aria-label': `Redo the ${missedHere} item${missedHere === 1 ? '' : 's'} of ${skill.title} you missed and have not since got right` }, 'btn'));
    acts.push(btn('Lesson', { onclick: () => render('lesson', { skill: id, from }) }, 'btn btn--quiet'));
    if (!skill.set && chartTable(skill)) acts.push(btn('Print chart', { onclick: () => printChart(skill) }, 'btn btn--quiet'));

    const head = [
      backButton(from),
      h('header', { class: 'g-head' },
        skill.set ? null : h('p', { class: 'g-kicker', text: `Cap. ${roman(skill.chapter)} · ${skill.course} week ${skill.week ?? '—'} · ${cap(String(skill.category ?? '').replace('-', ' '))}` }),
        h('h1', { class: 'g-title', text: skill.title }),
        h('p', { class: 'g-lede', text: 'History' }),
        h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': st.state, 'aria-hidden': 'true' }), dueText(st, now))),
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
            h('button', { type: 'button', class: 'g-link', onclick: () => render('session', { pair: [id, x.other], size: 10 }) }, 'practise the pair'))))
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
