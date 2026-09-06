// Dictionary: lookup + learner-first description of a glossary entry.
//
//   loadGlossary(url)        fetch + index glossary.json (+ function-words.json, glosses.json next to it)
//   setGlossary(g, fw, gl)   same, from already-parsed objects (tests, prefetch)
//   lookup(form, opts)       → { form, entries, via: 'exact'|'lower'|'enclitic'|'miss', enclitic }
//                              opts.context  the sentence the form sits in — readings whose parse
//                                            cannot fit it are ranked down (see "ranking" below)
//                              opts.at       the form's character offset in that context, when the
//                                            caller has it (the sentence may print the word twice)
//                              opts.want     a parse the caller already knows must hold
//                                            ({ case: 'abl' }, { mood: 'imper' }) — readings that
//                                            cannot take it lose
//   describe(entry, opts)    → opts.compact; opts.form (as in the text) and opts.context (the unit's
//                              Latin) let the meaning line put a command / an address first
//   describe(entry, opts)    → LearnerEntry (see CONTRACT.md)
//
// The meaning line is the plain answer for THIS form ("to/for the labyrinth ·
// by/with/from the labyrinth", "they were sending / they might send
// (subjunctive)"); the parse line is the label ("dative or ablative singular").

import { stripMacrons, normalizeForm, tokenize } from './tokenize.js';
import { paradigm, declensionName, adjectiveName, conjugationName } from './paradigms.js';

let GLOSSARY = null;
let FUNCTION_WORDS = {};
let GLOSSES = {};
let GLOSS_TERMS = [];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export async function loadGlossary(url = './data/glossary.json') {
  const base = url.replace(/[^/]*$/, '');
  const [g, fw, gl] = await Promise.all([
    fetchJson(url),
    fetchJson(base + 'function-words.json').catch(() => ({})),
    fetchJson(base + 'glosses.json').catch(() => ({})),
  ]);
  return setGlossary(g, fw, gl);
}

export function setGlossary(glossary, functionWords = {}, glosses = {}) {
  GLOSSARY = glossary || {};
  FUNCTION_WORDS = functionWords || {};
  GLOSSES = glosses || {};
  GLOSS_TERMS = Object.keys(GLOSSES).sort((a, b) => b.length - a.length);
  return { forms: Object.keys(GLOSSARY).length };
}

export function glossaryLoaded() {
  return GLOSSARY !== null;
}

export function glossaryEntries() {
  return GLOSSARY || {};
}

// ---------------------------------------------------------------------------
// lookup

const ENCLITICS = ['que', 'ne', 've'];

function canonicalKey(s) {
  return stripMacrons(s).toLowerCase().replace(/j/g, 'i').replace(/v/g, 'u');
}

function hitKey(key) {
  if (!GLOSSARY) return null;
  if (Object.prototype.hasOwnProperty.call(GLOSSARY, key)) return GLOSSARY[key];
  return null;
}

/** Try a spelling as given, then canonical i/u. */
function findEntries(key) {
  let e = hitKey(key);
  if (e) return e;
  const c = canonicalKey(key);
  if (c !== key) e = hitKey(c);
  if (e) return e;
  // the glossary key may have kept a 'v' that the query lacks
  const withV = key.replace(/^u(?=[aeiou])/, 'v');
  if (withV !== key) e = hitKey(withV);
  return e || null;
}

const MACRON_RE = /[āēīōūȳĀĒĪŌŪȲ]/;
const CAP_RE = /^[A-ZĀĒĪŌŪȲ]/;
const tableMemo = new Map();
function tableOf(entry) {
  const k = `${entry.lemma}|${entry.pos}|${entry.h ?? ''}`;
  if (!tableMemo.has(k)) { let t = null; try { t = paradigm(entry, []); } catch { t = null; } tableMemo.set(k, t); }
  return tableMemo.get(k);
}
/** "sē, suī (+ -cum: with)" — Whitaker's fold of an enclitic-like tackon into the headword. */
const TACKON_RE = /\+\s*-/;
/** Ørberg's margin abbreviations and endings, whose "spelling" is a fragment: `-iō`, `-ōrum`, `m`. */
const GLOSS_POS = new Set(['ABBR', 'ENDING', 'PREFIX', 'STEM']);
/** The entry's own spelling of its headword: first word, hyphens off ("-iō" is the ending -iō). */
const headSpelling = (e) => String(e.lemma || '').split(/[\s,(/]/)[0].replace(/^-+|-+$/g, '').toLowerCase();
const cellText = (c) => [c?.text, c?.alt, ...String(c?.text ?? '').split(' / ')].filter(Boolean).map((s) => String(s).trim());
/**
 * Does the entry's own paradigm print *this* spelling — macrons and all?
 * 0 yes · 1 the entry has no table, so it has no opinion · 2 it prints the same
 * letters with other macrons, so this may not be the word (māla is not the
 * adjective mala) · 3 its table does not print these letters at all, so the
 * form is only Whitaker's spare parse and the entry goes last.
 */
function macronVerdict(entry, q) {
  // A reading Whitaker cut a tackon off ("sē, suī (+ -cum: with)" for sēcum, "Q + -uis" for quis)
  // has a table for the bare word: it cannot be *asked* how the whole word is spelled, so it is not
  // held against it, and the build's order settles where it goes.
  if (TACKON_RE.test(String(entry.lemma || ''))) return 0;
  // The headword itself is the entry's own spelling of the word, and it carries macrons even where the
  // stems the paradigm is built from have lost them (māla malae f is built from the stem "mal").
  if (headSpelling(entry) === q) return 0;
  const table = tableOf(entry);
  if (!table) return 1;
  let loose = false;
  for (const sec of table.sections ?? []) for (const row of sec.rows ?? []) for (const c of row.cells ?? []) {
    if (!c || c.empty) continue;
    for (const f of cellText(c)) {
      const lf = f.toLowerCase();
      if (lf === q) return 0;
      if (stripMacrons(lf) === stripMacrons(q)) loose = true;
    }
  }
  return loose ? 2 : 3;
}

// ---------------------------------------------------------------------------
// ranking: which reading of a form leads the list
//
// One key can hold several words. They are put in order by, in this order:
//
//   1. whole word before enclitic split          ubīque before ubi + -que
//   2. the printed spelling                      macronVerdict above — a reading that prints these
//                                                letters with *other* macrons is not this word at
//                                                all, so it cannot win on any other ground
//   3. the sentence                              fitPenalties below — a reading whose parse cannot
//                                                survive the governing preposition, the adjective
//                                                next to it or the verb's object slot loses
//   4. a capital wants a name                    Mārcō is Mārcus, not "I am withered"; a real name
//                                                (`proper`) before a merely capitalised word
//                                                (Aemilia the woman before Aemilius -a -um)
//   5. a word the learner never meets            `n` from the build: how often the library prints a
//                                                form of that lexeme that the rival readings cannot
//                                                (māla → mālum/mālō/mālōrum, 64; cheeks, 0). It only
//                                                ever pushes a reading *back*, and only at its
//                                                sharpest — never printed at all, against a rival
//                                                that is part of the course.
//   6. the sentence, guessing                    fitPenalties' softer half: which slot in the clause
//                                                is still free. Worth having, but a guess, so last.
//   7. the build's own order                     Whitaker frequency, supplements, names

// `n` / `nd` from build_glossary.py: how often the library prints a form only this reading can give,
// and how many such forms there were to count over. COUNT_SEEN / COUNT_BASE match it.
const COUNT_SEEN = 10;
const COUNT_BASE = 4;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
/**
 * 0 for every reading, 1 for one the library never once shows the learner while
 * a rival is all over the course. Two things keep this honest.
 *
 * Only "never printed at all" counts. Nothing softer is trustworthy, because a
 * verb has ten times a noun's forms to be counted over, so comparing the two
 * totals measures the paradigm, not the word.
 *
 * And the rival has to have been counted over evidence of a comparable size.
 * `vītēs` is the vine, but the only forms the vine alone can give are
 * `vītis/vīte/vītium/vītibus`, none of which the book prints, while `vītō`
 * "avoid" brings 146 forms of its own to the count: whichever word is meant, a
 * race like that goes to the verb.
 *
 * A reading with no `n` at all had too little of its own to print (the adverb
 * `modo` gives no form the noun `modus` does not; Iūlia none that Iūlius -a -um
 * does not), so the counts never move it either way.
 */
function countRanks(entries) {
  const ns = entries.map((e) => num(e?.n));
  const nds = entries.map((e) => num(e?.nd));
  return ns.map((n, i) => (n === 0 && ns.some((rn, k) => rn >= COUNT_SEEN && nds[k] != null && nds[i] && nds[k] <= COUNT_BASE * nds[i]) ? 1 : 0));
}

const NOMINAL_POS = new Set(['N', 'ADJ', 'PRON', 'NUM']);
const STATED_MOODS = new Set(['ind', 'subj']);
/** punctuation that ends the stretch of sentence a word can agree with */
const CLAUSE_BREAK = /[.,;:!?()[\]"“”«»…\n]|--|—|–/;

const casesOf = (e) => { const s = new Set(); for (const p of e.parses || []) if (p.case) s.add(p.case); return s; };

/** sum and its compounds (absum, possum, adsum …): they take no object. */
const COPULA_H = /(^|[a-z])sum$/;

/** What a *neighbouring* token could be — never ranked, so it is read raw. */
function tokenFacts(form) {
  const ents = findEntries(form) || [];
  const facts = { cases: new Set(), governs: new Set(), agree: [], stated: false, copula: false, other: false };
  for (const e of ents) {
    // `other`: this token has a reading that is not a preposition, so it may not be governing at all
    // — `cum` is as often "when" as "with", and `causā` is a noun that follows its genitive.
    if (e.pos !== 'PREP') facts.other = true;
    if (e.pos === 'PREP' && e.kind) facts.governs.add(e.kind);
    for (const p of e.parses || []) {
      if (p.governs) facts.governs.add(p.governs);
      if (p.case) {
        facts.cases.add(p.case);
        if (NOMINAL_POS.has(e.pos)) facts.agree.push({ pos: e.pos, case: p.case, number: p.number, gender: p.gender });
      }
      // "est" can be read as edō "he eats", but in a course text it is sum, so a form that *could*
      // be the copula is treated as one and the clause is not made to want an object. Only a stated
      // (indicative or subjunctive) reading counts as the clause's verb: Whitaker offers a passive
      // imperative for every infinitive ("numerāre" = "be counted!"), which is not a verb in use.
      if (STATED_MOODS.has(p.mood)) { facts.stated = true; if (COPULA_H.test(String(e.h ?? ''))) facts.copula = true; }
    }
  }
  // nothing here could be a noun, so a stated reading of it really is the clause's verb
  facts.verbOnly = facts.stated && facts.cases.size === 0;
  // …and a word that can head the subject: a noun or pronoun, not an adjective agreeing with one
  facts.subject = facts.agree.some((a) => a.case === 'nom' && (a.pos === 'N' || a.pos === 'PRON'));
  return facts;
}

// The same sentence is asked about once per word of it, so the reading of it is kept.
const ctxMemo = new Map();
function analyseContext(context) {
  if (ctxMemo.has(context)) return ctxMemo.get(context);
  const words = [];
  let clause = 0;
  for (const t of tokenize(context)) {
    if (t.isWord) words.push({ ...tokenFacts(t.form), text: t.text, form: t.form, start: t.start, clause });
    else if (CLAUSE_BREAK.test(t.text)) clause += 1;
  }
  const out = { words };
  if (ctxMemo.size > 200) ctxMemo.clear();
  ctxMemo.set(context, out);
  return out;
}

/** Which word of the sentence is the one being looked up. `at` is its offset when the caller has it. */
function locate(words, raw, at) {
  if (Number.isFinite(at)) {
    const hit = words.findIndex((w) => w.start === at);
    if (hit >= 0) return hit;
  }
  const form = normalizeForm(raw);
  let hit = words.findIndex((w) => w.text === raw);
  if (hit < 0) hit = words.findIndex((w) => w.form === form);
  return hit;
}

/** Every (case, number, gender) an entry can carry. */
const agreeOf = (e) => (e.parses || []).filter((p) => p.case).map((p) => ({ case: p.case, number: p.number, gender: p.gender }));
const agrees = (a, b) => a.case === b.case && a.number === b.number && a.gender === b.gender;

/**
 * How badly each reading contradicts the sentence. `hard` is what the sentence
 * really says — a case the governing preposition cannot take, an adjective
 * beside it that agrees with nothing the reading offers; `soft` is the two
 * guesses about which slot is still free, which are worth having but are not
 * evidence of the same kind, so they are settled last of all.
 *
 * Every rule is judged three ways per reading: it holds, it fails, or the rule
 * has nothing to say about this reading (an adverb has no case to disagree
 * with). A rule that *no* reading actually satisfies is dropped whole — an
 * adjective that turns out not to modify this word, or a preposition governing
 * something else, must not be allowed to push the uninflected reading up by
 * penalising every inflected one.
 */
function fitPenalties(entries, raw, opts) {
  const hard = entries.map(() => 0);
  const soft = entries.map(() => 0);
  /** `verdict(e)` → 0 it holds · 1 it fails · null not applicable. */
  const apply = (pen, weight, verdict) => {
    const v = entries.map(verdict);
    if (!v.some((x) => x === 0)) return;
    v.forEach((x, i) => { if (x === 1) pen[i] += weight; });
  };
  const nominal = (e) => NOMINAL_POS.has(e.pos) && casesOf(e).size > 0;

  // The caller already knows the role (a drill that asks for the ablative, a scan that matched one parse).
  const want = opts.want;
  if (want && Object.keys(want).length) {
    apply(hard, 4, (e) => ((e.parses || []).some((p) => Object.entries(want).every(([k, v]) => p[k] === v)) ? 0 : 1));
  }

  const context = opts.context;
  if (!context) return { hard, soft };
  const { words } = analyseContext(context);
  const at = locate(words, raw, opts.at);
  if (at < 0) return { hard, soft };
  const here = words[at].clause;
  const inClause = (j) => j >= 0 && j < words.length && words[j].clause === here;

  // 1. a governing preposition, and only over the word it stands in front of: "in hortō", and in
  //    "ad magnam vīllam" the accusative is asked of `magnam`. Reaching further would ask it of the
  //    wrong word — in "ad ōram maris" the preposition has its object already, and `maris` (of the
  //    sea) belongs to `ōram`, not to `ad`.
  const before = inClause(at - 1) ? words[at - 1] : null;
  const governs = before && before.governs.size && !before.other ? before.governs : null;
  if (governs) {
    apply(hard, 4, (e) => (!nominal(e) ? null : [...casesOf(e)].some((c) => governs.has(c)) ? 0 : 1));
  }

  // 2. the word in front of it agrees with it: "duōs pedēs", "magna vīlla", "servus bonus" (read
  //    from `bonus`). Only the word in front — an adjective *after* the word is as likely to belong
  //    to the verb, and "duōs pedēs longus est" is two feet long, not two long feet.
  // …and only when that word is not already spoken for: in "Puella laeta mālō suō" the adjective
  // `laeta` agrees with `Puella` behind it, so it says nothing about `mālō`.
  const spokenFor = before?.agree.length && inClause(at - 2)
    && words[at - 2].agree.some((a) => before.agree.some((b) => agrees(a, b)));
  if (before?.agree.length && !spokenFor) {
    const adjOnly = before.agree.every((a) => a.pos === 'ADJ' || a.pos === 'NUM');
    const nounOnly = before.agree.every((a) => a.pos === 'N');
    if (adjOnly || nounOnly) {
      const mine = adjOnly ? (e) => e.pos === 'N' || e.pos === 'PRON' : (e) => e.pos === 'ADJ' || e.pos === 'NUM';
      apply(hard, 2, (e) => (!mine(e) || !agreeOf(e).length ? null : agreeOf(e).some((a) => before.agree.some((b) => agrees(a, b))) ? 0 : 1));
    }
  }

  // 3. the verb still wants an object: "Aemilia puerīs māla dat" — a subject stands in front of the
  //    word, the verb takes objects, and nothing else in the clause can be accusative, so the
  //    reading that can (mālum, apples) is the one the sentence is asking for.
  //
  //    All three conditions earn their keep. The verb has to be a word that is *nothing but* a verb,
  //    or "is enim deus maris est" would count `is` as "you go" and demand an object; it must not be
  //    sum or a compound of it, which take none; and a subject has to have been named already, or
  //    "Nunc īnfans dormit" would ask the intransitive `dormit` for one — and that subject has to be
  //    a noun or pronoun of its own, not the adjective standing in front of this very word
  //    ("Parvulus īnfans in cūnīs cubāre solet").
  const verbWantsObject = words.some((w, j) => j !== at && inClause(j) && w.verbOnly && !w.copula)
    && words.some((w, j) => j < at && inClause(j) && w.subject)
    && !words.some((w, j) => j !== at && inClause(j) && w.cases.has('acc'));
  if (verbWantsObject) apply(soft, 1, (e) => (!nominal(e) ? null : casesOf(e).has('acc') ? 0 : 1));
  return { hard, soft };
}

/** Is this word the first of its sentence, so that its capital says nothing? */
function startsSentence(opts) {
  if (!opts.context || !Number.isFinite(opts.at)) return false;
  const before = String(opts.context).slice(0, opts.at).replace(/[\s"'“”‘’(\[—–-]+$/u, '');
  // a colon too: "Syra: \"Num pater domī est?\"" opens a sentence just as a full stop does
  return before === '' || /[.!?:…]$/.test(before);
}

/**
 * Keys drop macrons, so "hīc" (here) and "hic" (this) share one key, and so do
 * *māla* (apples) and *mala* (bad). `ambiguous` is set when the leading
 * readings are still level and mean different things — the caller shows both
 * rather than choosing one (QA B3).
 */
export function rankEntries(entries, raw, opts = {}) {
  if (!Array.isArray(entries) || entries.length < 2) return { entries: entries || [], ambiguous: false };
  const q = String(raw).toLowerCase();
  const hasMacron = MACRON_RE.test(raw);
  // A capital means a name only where the sentence did not put it there: "Num pater domī est?" opens
  // with the question particle, not with Numerius. Without the sentence we cannot tell, and the
  // capital is taken at face value as before.
  const cap = CAP_RE.test(raw) && !startsSentence(opts);
  // …and the words that have only one form of their own: the true uninflected parts of speech, and
  // the gloss abbreviations, whose "spelling" is a fragment ("-iō", "-ōrum").
  const UNINFLECTED = new Set([...GLOSS_POS, 'ADV', 'CONJ', 'PREP', 'INTERJ']);
  const score = (e) => {
    // `spelled`: the list came from a key the build made for this exact spelling, and the build
    // tested it against every form of every reading (spelling_rank in build_glossary.py). Asking
    // again here with a table the app may not be able to build could only make that answer worse.
    if (opts.spelled || !hasMacron || e.enc) return 1;
    if (UNINFLECTED.has(e.pos)) {
      if (TACKON_RE.test(String(e.lemma || ''))) return 0;
      const lemma = headSpelling(e);
      if (lemma === q) return 0;
      if (stripMacrons(lemma) === stripMacrons(q) && lemma !== q) {
        // A word with one form and a disputed vowel: the library prints the adverb `modo` 39 times
        // and `modō` 52, so a macron that disagrees with the headword proves nothing about a
        // particle, and the build's order is left to decide. It does still tell a *fragment* apart
        // from a word — the ending `-a` is not the preposition `ā`.
        return GLOSS_POS.has(e.pos) ? 2 : 0;
      }
      return 1;
    }
    return macronVerdict(e, q);
  };
  // Mārcō is Mārcus, Aemilia is the woman and not the adjective Aemilius -a -um; a common word that
  // only happens to start the sentence is nobody.
  const named = (e) => (!cap || e.enc ? 3 : e.proper ? (e.pos === 'N' ? 0 : 1) : CAP_RE.test(String(e.lemma ?? '')) ? 2 : 3);
  const fit = fitPenalties(entries, raw, opts);
  const band = countRanks(entries);
  // whole-word readings stay ahead of enclitic splits (ubīque before ubi + -que)
  const ranked = entries.map((e, i) => [e.enc ? 1 : 0, score(e), fit.hard[i], named(e), band[i], fit.soft[i], i, e]);
  ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4] || a[5] - b[5] || a[6] - b[6]);
  const best = ranked[0];
  const head = (e) => String((e.senses || [])[0] ?? '');
  // Ambiguous means the printed spelling was tested and *nobody* passed: every reading prints these
  // letters with other macrons (mala — the glossary holds `malus` bad and `malum` apple, both spelled
  // mala), and nothing else — not the sentence, not the counts — separates them either. Plain
  // homography (quī, eō — readings that do print the word) is not this.
  const ambiguous = best[1] === 2 && ranked.some((r, i) => i > 0
    && r.slice(0, 6).every((x, k) => x === best[k])
    && String(r[7].h ?? r[7].lemma) !== String(best[7].h ?? best[7].lemma) && head(r[7]) !== head(best[7]));
  return { entries: ranked.map((x) => x[7]), ambiguous };
}

/**
 * `opts`: `context` (the sentence the form sits in), `at` (its offset there)
 * and `want` (a parse the caller knows must hold). All optional — with none of
 * them the readings are still put in order by spelling, capital and how often
 * the library prints the word.
 */
export function lookup(form, opts = {}) {
  const raw = String(form ?? '').replace(/[^\p{L}]/gu, '');
  const result = { form: raw, entries: [], via: 'miss', enclitic: null, ambiguous: false };
  if (!raw || !GLOSSARY) return result;

  const lower = stripMacrons(raw).toLowerCase();
  let entries = hitKey(raw);
  let via = 'exact';
  // a key the build made for this exact spelling (māla, Mārcō) — its order already answers the
  // spelling question, so the ranking below leaves that part alone
  const spelled = !!entries && raw !== lower;
  if (!entries) {
    entries = findEntries(lower);
    if (entries) via = raw === lower ? 'exact' : 'lower';
  }
  if (entries) {
    const ranked = rankEntries(entries, raw, { ...opts, spelled });
    return { ...result, entries: ranked.entries, ambiguous: !!ranked.ambiguous, via, enclitic: ranked.entries[0]?.enc ?? null };
  }

  for (const enc of ENCLITICS) {
    if (lower.endsWith(enc) && lower.length > enc.length + 1) {
      const base = lower.slice(0, -enc.length);
      const found = findEntries(base);
      if (found) {
        const cloned = found.map((e) => ({ ...e, enc }));
        const ranked = rankEntries(cloned, raw, opts);
        return { ...result, entries: ranked.entries, ambiguous: !!ranked.ambiguous, via: 'enclitic', enclitic: enc };
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// English helpers

const IRREGULAR_VERBS = {
  be: ['is', 'was', 'been'], have: ['has', 'had', 'had'], do: ['does', 'did', 'done'], go: ['goes', 'went', 'gone'],
  come: ['comes', 'came', 'come'], become: ['becomes', 'became', 'become'], see: ['sees', 'saw', 'seen'], give: ['gives', 'gave', 'given'],
  take: ['takes', 'took', 'taken'], make: ['makes', 'made', 'made'], say: ['says', 'said', 'said'], tell: ['tells', 'told', 'told'],
  hear: ['hears', 'heard', 'heard'], send: ['sends', 'sent', 'sent'], bring: ['brings', 'brought', 'brought'], think: ['thinks', 'thought', 'thought'],
  seek: ['seeks', 'sought', 'sought'], buy: ['buys', 'bought', 'bought'], fight: ['fights', 'fought', 'fought'], teach: ['teaches', 'taught', 'taught'],
  catch: ['catches', 'caught', 'caught'], lead: ['leads', 'led', 'led'], feed: ['feeds', 'fed', 'fed'], flee: ['flees', 'fled', 'fled'],
  hold: ['holds', 'held', 'held'], run: ['runs', 'ran', 'run'], sit: ['sits', 'sat', 'sat'], eat: ['eats', 'ate', 'eaten'],
  drink: ['drinks', 'drank', 'drunk'], begin: ['begins', 'began', 'begun'], swim: ['swims', 'swam', 'swum'], sing: ['sings', 'sang', 'sung'],
  speak: ['speaks', 'spoke', 'spoken'], break: ['breaks', 'broke', 'broken'], choose: ['chooses', 'chose', 'chosen'], drive: ['drives', 'drove', 'driven'],
  rise: ['rises', 'rose', 'risen'], write: ['writes', 'wrote', 'written'], ride: ['rides', 'rode', 'ridden'], fall: ['falls', 'fell', 'fallen'],
  know: ['knows', 'knew', 'known'], throw: ['throws', 'threw', 'thrown'], grow: ['grows', 'grew', 'grown'], fly: ['flies', 'flew', 'flown'],
  draw: ['draws', 'drew', 'drawn'], forget: ['forgets', 'forgot', 'forgotten'], get: ['gets', 'got', 'got'], put: ['puts', 'put', 'put'],
  cut: ['cuts', 'cut', 'cut'], set: ['sets', 'set', 'set'], let: ['lets', 'let', 'let'], hit: ['hits', 'hit', 'hit'], shut: ['shuts', 'shut', 'shut'],
  hurt: ['hurts', 'hurt', 'hurt'], read: ['reads', 'read', 'read'], leave: ['leaves', 'left', 'left'], keep: ['keeps', 'kept', 'kept'],
  sleep: ['sleeps', 'slept', 'slept'], feel: ['feels', 'felt', 'felt'], meet: ['meets', 'met', 'met'], lose: ['loses', 'lost', 'lost'],
  find: ['finds', 'found', 'found'], build: ['builds', 'built', 'built'], stand: ['stands', 'stood', 'stood'], understand: ['understands', 'understood', 'understood'],
  sell: ['sells', 'sold', 'sold'], pay: ['pays', 'paid', 'paid'], lay: ['lays', 'laid', 'laid'], wear: ['wears', 'wore', 'worn'],
  tear: ['tears', 'tore', 'torn'], bear: ['bears', 'bore', 'borne'], swear: ['swears', 'swore', 'sworn'], strike: ['strikes', 'struck', 'struck'],
  stick: ['sticks', 'stuck', 'stuck'], dig: ['digs', 'dug', 'dug'], hang: ['hangs', 'hung', 'hung'], win: ['wins', 'won', 'won'],
  spin: ['spins', 'spun', 'spun'], shine: ['shines', 'shone', 'shone'], shoot: ['shoots', 'shot', 'shot'], bind: ['binds', 'bound', 'bound'],
  wind: ['winds', 'wound', 'wound'], grind: ['grinds', 'ground', 'ground'], bite: ['bites', 'bit', 'bitten'], hide: ['hides', 'hid', 'hidden'],
  light: ['lights', 'lit', 'lit'], slay: ['slays', 'slew', 'slain'], lie: ['lies', 'lay', 'lain'], weep: ['weeps', 'wept', 'wept'],
  sweep: ['sweeps', 'swept', 'swept'], creep: ['creeps', 'crept', 'crept'], kneel: ['kneels', 'knelt', 'knelt'], spend: ['spends', 'spent', 'spent'],
  lend: ['lends', 'lent', 'lent'], bend: ['bends', 'bent', 'bent'], mean: ['means', 'meant', 'meant'], deal: ['deals', 'dealt', 'dealt'],
  weave: ['weaves', 'wove', 'woven'], arise: ['arises', 'arose', 'arisen'], beat: ['beats', 'beat', 'beaten'], blow: ['blows', 'blew', 'blown'],
  forbid: ['forbids', 'forbade', 'forbidden'], forgive: ['forgives', 'forgave', 'forgiven'], freeze: ['freezes', 'froze', 'frozen'], steal: ['steals', 'stole', 'stolen'],
  strive: ['strives', 'strove', 'striven'], wake: ['wakes', 'woke', 'woken'], tread: ['treads', 'trod', 'trodden'], dwell: ['dwells', 'dwelt', 'dwelt'],
  cling: ['clings', 'clung', 'clung'], fling: ['flings', 'flung', 'flung'], sting: ['stings', 'stung', 'stung'], swing: ['swings', 'swung', 'swung'],
  spring: ['springs', 'sprang', 'sprung'], sink: ['sinks', 'sank', 'sunk'], shrink: ['shrinks', 'shrank', 'shrunk'], wring: ['wrings', 'wrung', 'wrung'],
  show: ['shows', 'showed', 'shown'], sow: ['sows', 'sowed', 'sown'], prove: ['proves', 'proved', 'proven'], seem: ['seems', 'seemed', 'seemed'],
  drag: ['drags', 'dragged', 'dragged'], stop: ['stops', 'stopped', 'stopped'], beg: ['begs', 'begged', 'begged'], rub: ['rubs', 'rubbed', 'rubbed'],
  plan: ['plans', 'planned', 'planned'], carry: ['carries', 'carried', 'carried'], bury: ['buries', 'buried', 'buried'], marry: ['marries', 'married', 'married'],
  can: ['can', 'could', 'been able'], will: ['will', 'would', 'willed'], shall: ['shall', 'should', 'should'], may: ['may', 'might', 'might'],
  must: ['must', 'had to', 'had to'], ought: ['ought', 'ought', 'ought'],
};

function splitPhrase(v) {
  const i = v.indexOf(' ');
  return i < 0 ? [v, ''] : [v.slice(0, i), v.slice(i)];
}

function thirdSg(v) {
  const [w, rest] = splitPhrase(v);
  const irr = IRREGULAR_VERBS[w];
  if (irr) return irr[0] + rest;
  if (/(s|x|z|ch|sh|o)$/.test(w)) return w + 'es' + rest;
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies' + rest;
  return w + 's' + rest;
}

function pastTense(v) {
  const [w, rest] = splitPhrase(v);
  const irr = IRREGULAR_VERBS[w];
  if (irr) return irr[1] + rest;
  return regularPast(w) + rest;
}

function pastParticiple(v) {
  const [w, rest] = splitPhrase(v);
  const irr = IRREGULAR_VERBS[w];
  if (irr) return irr[2] + rest;
  return regularPast(w) + rest;
}

function regularPast(w) {
  if (/e$/.test(w)) return w + 'd';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ied';
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(w) && w.length <= 4) return w + w[w.length - 1] + 'ed';
  return w + 'ed';
}

function ingForm(v) {
  const [w, rest] = splitPhrase(v);
  let out;
  if (w === 'be') out = 'being';
  else if (/ie$/.test(w)) out = w.slice(0, -2) + 'ying';
  else if (/[^eoy]e$/.test(w)) out = w.slice(0, -1) + 'ing';
  else if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(w) && w.length <= 4) out = w + w[w.length - 1] + 'ing';
  else out = w + 'ing';
  return out + rest;
}

function pluralNoun(phrase) {
  const IRR = { man: 'men', woman: 'women', child: 'children', foot: 'feet', tooth: 'teeth', mouse: 'mice', goose: 'geese', ox: 'oxen',
    person: 'people', sheep: 'sheep', deer: 'deer', fish: 'fish', life: 'lives', wife: 'wives', knife: 'knives', leaf: 'leaves', wolf: 'wolves',
    half: 'halves', self: 'selves', calf: 'calves', thief: 'thieves', loaf: 'loaves', die: 'dice', penny: 'pence' };
  const words = phrase.split(' ');
  const last = words[words.length - 1];
  let pl;
  if (IRR[last]) pl = IRR[last];
  else if (/[^aeiou]y$/.test(last)) pl = last.slice(0, -1) + 'ies';
  else if (/(s|x|z|ch|sh)$/.test(last)) pl = last + 'es';
  else pl = last + 's';
  words[words.length - 1] = pl;
  return words.join(' ');
}

/** First plain item of the first sense, parentheticals removed. */
function headWord(sense) {
  let s = String(sense || '').replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
  s = s.split(/[,;]/)[0].split(' or ')[0].split('/')[0];
  s = s.replace(/\s+/g, ' ').trim().replace(/[.:!?]+$/, '');
  return s;
}

function verbBase(entry) {
  let s = headWord(entry.senses?.[0] || '').toLowerCase();
  s = s.replace(/^to\s+/, '');
  // impersonals are glossed "it is fitting": strip the subject, restore the base verb
  s = s.replace(/^it\s+/, '').replace(/^(is|are)\s+/, 'be ').replace(/^is$/, 'be');
  if (!s) s = 'do';
  return s;
}

// ---------------------------------------------------------------------------
// meaning line

const SUBJ = { '1sg': 'I', '2sg': 'you', '3sg': 'he/she/it', '1pl': 'we', '2pl': 'you (pl.)', '3pl': 'they' };

function bePresent(subj) {
  if (subj === 'I') return 'am';
  if (subj === 'he/she/it' || subj === 'it') return 'is';
  return 'are';
}
function bePast(subj) {
  return subj === 'I' || subj === 'he/she/it' || subj === 'it' ? 'was' : 'were';
}
function haveForm(subj) {
  return subj === 'he/she/it' || subj === 'it' ? 'has' : 'have';
}

function verbForms(base) {
  const isBe = base === 'be' || /^be /.test(base);
  return {
    base,
    isBe,
    rest: isBe ? base.replace(/^be\s*/, '') : '',
    s3: thirdSg(base),
    past: pastTense(base),
    pp: pastParticiple(base),
    ing: ingForm(base),
  };
}

function pres(subj, V) {
  if (V.isBe) return `${subj} ${bePresent(subj)}${V.rest ? ' ' + V.rest : ''}`;
  return `${subj} ${subj === 'he/she/it' || subj === 'it' ? V.s3 : V.base}`;
}
function progressivePast(subj, V) {
  if (V.isBe) return `${subj} ${bePast(subj)}${V.rest ? ' ' + V.rest : ''}`;
  return `${subj} ${bePast(subj)} ${V.ing}`;
}

function finiteMeaning(p, V, deponent, impersonal) {
  const subj = impersonal ? 'it' : SUBJ[`${p.person}${p.number}`] || 'they';
  const mood = p.mood;
  const active = p.voice !== 'pass' || deponent;
  const t = p.tense;
  const SUBJ_TAG = ' (subjunctive)';
  if (mood === 'imper') {
    const who = p.number === 'pl' ? 'command to more than one person' : 'command to one person';
    if (p.tense === 'fut') {
      if (String(p.person) === '3') return `let ${p.number === 'pl' ? 'them' : 'him/her'} ${active ? V.base : 'be ' + V.pp}! (future command)`;
      return `${active ? V.base : 'be ' + V.pp}! (future command, ${who.replace('command ', '')})`;
    }
    return `${active ? V.base : 'be ' + V.pp}! (${who})`;
  }
  if (mood === 'inf') {
    if (active) {
      if (t === 'perf') return `to have ${V.pp}`;
      if (t === 'fut') return `to be about to ${V.base}`;
      return `to ${V.base}`;
    }
    if (t === 'perf') return `to have been ${V.pp}`;
    if (t === 'fut') return `to be going to be ${V.pp}`;
    return `to be ${V.pp}`;
  }
  if (active) {
    if (mood === 'subj') {
      if (t === 'pres') return `${pres(subj, V)} / ${subj} may ${V.base}${SUBJ_TAG}`;
      if (t === 'impf') return `${progressivePast(subj, V)} / ${subj} should ${V.base}${SUBJ_TAG}`;
      if (t === 'perf') return `${subj} ${V.past} / ${subj} may have ${V.pp}${SUBJ_TAG}`;
      if (t === 'plupf') return `${subj} had ${V.pp} / ${subj} might have ${V.pp}${SUBJ_TAG}`;
    }
    if (t === 'pres') return pres(subj, V);
    if (t === 'impf') return V.isBe ? progressivePast(subj, V) : `${progressivePast(subj, V)} / ${subj} used to ${V.base}`;
    if (t === 'fut') return `${subj} will ${V.base}`;
    if (t === 'perf') return `${subj} ${V.past} / ${subj} ${haveForm(subj)} ${V.pp}`;
    if (t === 'plupf') return `${subj} had ${V.pp}`;
    if (t === 'futperf') return `${subj} will have ${V.pp}`;
    return `${subj} ${V.base}`;
  }
  // passive
  if (mood === 'subj') {
    if (t === 'pres') return `${subj} ${bePresent(subj)} ${V.pp} / ${subj} may be ${V.pp}${SUBJ_TAG}`;
    if (t === 'impf') return `${subj} ${bePast(subj)} being ${V.pp} / ${subj} should be ${V.pp}${SUBJ_TAG}`;
    if (t === 'perf') return `${subj} ${bePast(subj)} ${V.pp} / ${subj} may have been ${V.pp}${SUBJ_TAG}`;
    if (t === 'plupf') return `${subj} had been ${V.pp} / ${subj} might have been ${V.pp}${SUBJ_TAG}`;
  }
  if (t === 'pres') return `${subj} ${bePresent(subj)} ${V.pp}`;
  if (t === 'impf') return `${subj} ${bePast(subj)} being ${V.pp}`;
  if (t === 'fut') return `${subj} will be ${V.pp}`;
  if (t === 'perf') return `${subj} ${bePast(subj)} ${V.pp} / ${subj} ${haveForm(subj)} been ${V.pp}`;
  if (t === 'plupf') return `${subj} had been ${V.pp}`;
  if (t === 'futperf') return `${subj} will have been ${V.pp}`;
  return `${subj} ${bePresent(subj)} ${V.pp}`;
}

function participleMeaning(p, V, deponent) {
  const m = p.mood;
  if (m === 'gerund') {
    const g = V.ing;
    return { gen: `of ${g}`, dat: `to/for ${g}`, acc: `${g} (after ad: for ${g})`, abl: `by ${g}` }[p.case] || g;
  }
  if (m === 'gerundive') return `to be ${V.pp} / needing to be ${V.pp}`;
  if (m === 'supine') return p.case === 'abl' ? `to ${V.base} (after an adjective: easy to ${V.base})` : `to ${V.base} (purpose, after a verb of motion)`;
  // participle
  if (p.tense === 'pres') return V.ing;
  if (p.tense === 'fut') return p.voice === 'pass' ? `to be ${V.pp}` : `about to ${V.base}`;
  if (p.tense === 'perf') return deponent ? `having ${V.pp}` : `${V.pp} / having been ${V.pp}`;
  return V.ing;
}

const NO_ARTICLE = new Set(['no one', 'nobody', 'nothing', 'someone', 'somebody', 'something', 'anyone', 'anybody', 'anything', 'everyone', 'everything', 'each', 'none']);

function caseMeaning(c, noun, art) {
  const n = noun;
  switch (c) {
    case 'nom': return `${art}${n} (subject)`;
    case 'gen': return `of ${art}${n}`;
    case 'dat': return `to/for ${art}${n}`;
    case 'acc': return `${art}${n} (object)`;
    case 'abl': return `by/with/from ${art}${n}`;
    case 'voc': return `O ${n}!`;
    case 'loc': return `at/in ${art}${n}`;
    default: return n;
  }
}

const PRON_FORMS = {
  is: { sg: { m: 'he / that', f: 'she / that', n: 'it / that' }, pl: { m: 'they / those', f: 'they / those', n: 'they / those' } },
  hic: { sg: { m: 'this (man)', f: 'this (woman)', n: 'this (thing)' }, pl: { m: 'these', f: 'these', n: 'these' } },
  ille: { sg: { m: 'that (man)', f: 'that (woman)', n: 'that (thing)' }, pl: { m: 'those', f: 'those', n: 'those' } },
  iste: { sg: { m: 'that (of yours)', f: 'that (of yours)', n: 'that (of yours)' }, pl: { m: 'those (of yours)', f: 'those (of yours)', n: 'those (of yours)' } },
  ipse: { sg: { m: 'he himself', f: 'she herself', n: 'it itself' }, pl: { m: 'they themselves', f: 'they themselves', n: 'they themselves' } },
  idem: { sg: { m: 'the same (man)', f: 'the same (woman)', n: 'the same (thing)' }, pl: { m: 'the same', f: 'the same', n: 'the same' } },
  qui: { sg: { m: 'who / which', f: 'who / which', n: 'which / that' }, pl: { m: 'who / which', f: 'who / which', n: 'which' } },
  quis: { sg: { m: 'who?', f: 'who?', n: 'what?' }, pl: { m: 'who?', f: 'who?', n: 'what?' } },
  ego: { sg: { m: 'I', f: 'I', n: 'I' }, pl: { m: 'we', f: 'we', n: 'we' } },
  nos: { sg: { m: 'we', f: 'we', n: 'we' }, pl: { m: 'we', f: 'we', n: 'we' } },
  tu: { sg: { m: 'you', f: 'you', n: 'you' }, pl: { m: 'you (pl.)', f: 'you (pl.)', n: 'you (pl.)' } },
  vos: { sg: { m: 'you (pl.)', f: 'you (pl.)', n: 'you (pl.)' }, pl: { m: 'you (pl.)', f: 'you (pl.)', n: 'you (pl.)' } },
  se: { sg: { m: 'himself / herself / itself', f: 'himself / herself / itself', n: 'himself / herself / itself' }, pl: { m: 'themselves', f: 'themselves', n: 'themselves' } },
  aliquis: { sg: { m: 'someone', f: 'someone', n: 'something' }, pl: { m: 'some (people)', f: 'some', n: 'some (things)' } },
  quisque: { sg: { m: 'each one', f: 'each one', n: 'each thing' }, pl: { m: 'each', f: 'each', n: 'each' } },
  quidam: { sg: { m: 'a certain (man)', f: 'a certain (woman)', n: 'a certain (thing)' }, pl: { m: 'certain (people), some', f: 'certain, some', n: 'certain (things), some' } },
  quisquam: { sg: { m: 'anyone', f: 'anyone', n: 'anything' }, pl: { m: 'any', f: 'any', n: 'any' } },
};
const OBJ = { he: 'him', she: 'her', they: 'them', I: 'me', we: 'us', who: 'whom', 'he himself': 'himself', 'she herself': 'herself', 'it itself': 'itself', 'they themselves': 'themselves' };
const POSS = { he: 'his', she: 'her', it: 'its', they: 'their', I: 'my', we: 'our', you: 'your', 'you (pl.)': 'your', who: 'whose', 'he himself': 'his own', 'she herself': 'her own', 'they themselves': 'their own', 'himself / herself / itself': 'his / her / its own', themselves: 'their own' };

function objective(word) {
  return word.split(' / ').map((w) => OBJ[w] || w).join(' / ');
}

function pronounCase(c, word) {
  const first = word.split(' / ')[0];
  switch (c) {
    case 'nom': return word;
    case 'gen': {
      const p = POSS[word] || POSS[first];
      if (p && word.includes(' / ') && !POSS[word]) {
        return word.split(' / ').map((w) => POSS[w] || `of ${objective(w)}`).join(' / ');
      }
      return p || `of ${objective(word)}`;
    }
    case 'dat': return `to/for ${objective(word)}`;
    case 'acc': return `${objective(word)} (object)`;
    case 'abl': return `by/with/from ${objective(word)}`;
    case 'voc': return `O ${word}!`;
    default: return word;
  }
}

function uniq(list) {
  const seen = new Set();
  return list.filter((x) => x && !seen.has(x) && seen.add(x));
}

function isProper(entry) {
  const s = entry.senses?.[0] || '';
  return /^[A-Z]/.test(entry.lemma || '') || /^(the )?[A-Z]/.test(s);
}

/**
 * What the sentence says about the tapped form. `opts.form` is the form as it
 * appears in the text (capitalisation kept); `opts.context` is the unit's Latin.
 * Returns { initial, exclaim, addressed }: sentence-initial capital, the clause
 * the form sits in ends in "!", and the form is preceded by "ō" (vocative).
 */
function formContext(opts = {}) {
  const form = opts.form || '';
  const context = opts.context || '';
  const initial = /^[A-ZĀĒĪŌŪȲ]/.test(form) && !/^[A-ZĀĒĪŌŪȲ]{2}/.test(form);
  let exclaim = false;
  let addressed = false;
  if (form && context) {
    let at = context.indexOf(form);
    if (at < 0) at = context.toLowerCase().indexOf(form.toLowerCase());
    if (at >= 0) {
      const after = context.slice(at + form.length);
      const m = /[.!?;:…]/.exec(after);
      exclaim = !!m && m[0] === '!';
      const before = context.slice(0, at).trimEnd();
      addressed = /(^|[\s"'“‘(])[ōo]$/i.test(before);
    }
  }
  return { initial, exclaim, addressed };
}

export function meaningLine(entry, opts = {}) {
  const parses = entry.parses || [];
  const pos = entry.pos;
  const first = entry.senses?.[0] || '';
  const ctx = formContext(opts);
  if (pos === 'N') {
    const rawHead = headWord(first) || entry.h;
    const hasThe = /^the /i.test(rawHead);
    const head = rawHead.replace(/^(the|a|an) /i, '');
    const proper = isProper(entry);
    const art = hasThe ? 'the ' : proper || NO_ARTICLE.has(head.toLowerCase()) ? '' : 'the ';
    if (!parses.length) return head;
    // every case reading is shown, the vocative last ("the citizens (subject) · O citizens!")
    // — unless the sentence addresses someone ("cīvēs meī!", "ō Mārce"), then it comes first
    const cased = parses.filter((p) => p.case);
    const vocFirst = ctx.exclaim || ctx.addressed;
    const shown = [...cased].sort((a, b) => ((a.case === 'voc') === (b.case === 'voc') ? 0 : (a.case === 'voc') === vocFirst ? -1 : 1));
    const parts = shown.map((p) => caseMeaning(p.case, p.number === 'pl' && !proper ? pluralNoun(head) : head, art));
    return uniq(parts).join(' · ') || head;
  }
  if (pos === 'PRON') {
    const table = PRON_FORMS[entry.h];
    if (table && parses.length) {
      const cased = parses.filter((p) => p.case);
      const shown = cased.filter((p) => !(p.case === 'voc' && cased.some((q) => q.case === 'nom' && q.number === p.number)));
      const parts = shown.map((p) => {
        const num = p.number === 'pl' ? 'pl' : 'sg';
        const g = p.gender && p.gender !== 'c' ? p.gender : null;
        const words = g ? [table[num][g]] : [table[num].m];
        return uniq(words.map((w) => pronounCase(p.case, w))).join(' / ');
      });
      return uniq(parts).join(' · ');
    }
    return first;
  }
  if (pos === 'ADJ' || pos === 'NUM') {
    const head = first;
    const degs = uniq(parses.map((p) => p.degree || 'pos'));
    const short = headWord(first);
    const parts = degs.map((d) => {
      if (d === 'comp') return `more ${short} (comparative)`;
      if (d === 'super') return `most ${short} / very ${short} (superlative)`;
      return head;
    });
    return parts.join(' · ');
  }
  if (pos === 'V' || pos === 'VPAR') {
    const V = verbForms(verbBase(entry));
    const deponent = entry.kind === 'dep' || entry.kind === 'semidep';
    const impersonal = entry.kind === 'impers';
    // "Sequiminī!" / "sequere mē!": a sentence-initial or exclaimed form reads as the command first
    const imperFirst = ctx.initial || ctx.exclaim;
    const ordered = imperFirst
      ? [...parses].sort((a, b) => ((a.mood === 'imper') === (b.mood === 'imper') ? 0 : a.mood === 'imper' ? -1 : 1))
      : parses;
    const parts = ordered.map((p) => {
      if (p.mood === 'ptc' || p.mood === 'gerund' || p.mood === 'gerundive' || p.mood === 'supine') return participleMeaning(p, V, deponent);
      return finiteMeaning(p, V, deponent, impersonal);
    });
    return uniq(parts).join(' · ') || first;
  }
  if (pos === 'PREP') {
    const fw = FUNCTION_WORDS[entry.h];
    const gov = parses[0]?.governs || entry.kind;
    if (fw?.cases?.[gov]) return fw.cases[gov];
    return first;
  }
  if (pos === 'ADV') {
    const degs = uniq(parses.map((p) => p.degree).filter(Boolean));
    if (degs.includes('comp')) return `more ${headWord(first)} (comparative)`;
    if (degs.includes('super')) return `most ${headWord(first)} (superlative)`;
    return first;
  }
  return first;
}

// ---------------------------------------------------------------------------
// parse line

const CASE_NAME = { nom: 'nominative', gen: 'genitive', dat: 'dative', acc: 'accusative', abl: 'ablative', voc: 'vocative', loc: 'locative' };
const CASE_ABBR = { nom: 'nom.', gen: 'gen.', dat: 'dat.', acc: 'acc.', abl: 'abl.', voc: 'voc.', loc: 'loc.' };
const NUM_NAME = { sg: 'singular', pl: 'plural' };
const NUM_ABBR = { sg: 'sg.', pl: 'pl.' };
const GEN_NAME = { m: 'masculine', f: 'feminine', n: 'neuter', c: 'masculine or feminine' };
const GEN_ABBR = { m: 'm.', f: 'f.', n: 'n.', c: 'm./f.' };
const TENSE_NAME = { pres: 'present', impf: 'imperfect', fut: 'future', perf: 'perfect', plupf: 'pluperfect', futperf: 'future perfect' };
const TENSE_ABBR = { pres: 'pres.', impf: 'impf.', fut: 'fut.', perf: 'perf.', plupf: 'plupf.', futperf: 'fut. perf.' };
const MOOD_NAME = { ind: 'indicative', subj: 'subjunctive', imper: 'imperative', inf: 'infinitive' };
const MOOD_ABBR = { ind: 'ind.', subj: 'subj.', imper: 'imper.', inf: 'inf.' };
const PERSON_NAME = { 1: '1st', 2: '2nd', 3: '3rd' };
const DEGREE_NAME = { comp: 'comparative', super: 'superlative' };

function nominalPhrase(group, compact, showGender) {
  const cases = group.cases.map((c) => (compact ? CASE_ABBR[c] : CASE_NAME[c]));
  const caseStr = compact ? cases.join('/') : cases.join(' or ');
  const num = group.number ? (compact ? NUM_ABBR[group.number] : NUM_NAME[group.number]) : '';
  const gen = showGender && group.gender ? (compact ? GEN_ABBR[group.gender] : GEN_NAME[group.gender]) : '';
  return [caseStr, num, gen].filter(Boolean).join(' ');
}

function groupNominal(parses) {
  const groups = [];
  for (const p of parses) {
    if (!p.case) continue;
    const key = `${p.number || ''}|${p.gender || ''}|${p.degree || ''}|${p.mood || ''}|${p.tense || ''}|${p.voice || ''}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, cases: [], number: p.number, gender: p.gender, degree: p.degree, mood: p.mood, tense: p.tense, voice: p.voice };
      groups.push(g);
    }
    if (!g.cases.includes(p.case)) g.cases.push(p.case);
  }
  return groups;
}

export function parseLine(entry, opts = {}) {
  const compact = !!opts.compact;
  const parses = entry.parses || [];
  const pos = entry.pos;
  const dep = entry.kind === 'dep';
  const tail = [];
  if (dep) tail.push(compact ? 'dep.' : 'deponent');
  if (entry.kind === 'semidep') tail.push('semi-deponent');
  if (entry.kind === 'impers') tail.push('impersonal');
  if (entry.enc) tail.push(compact ? `+ -${entry.enc}` : `+ -${entry.enc}${entry.enc === 'que' ? ' (and)' : entry.enc === 'ne' ? ' (question)' : ' (or)'}`);
  const suffix = tail.length ? ` (${tail.join(', ')})` : '';

  if (pos === 'N' || pos === 'ADJ' || pos === 'PRON' || pos === 'NUM') {
    const groups = groupNominal(parses);
    if (!groups.length) {
      const degs = uniq(parses.map((p) => p.degree).filter(Boolean));
      if (degs.length) return degs.map((d) => DEGREE_NAME[d]).join(' or ') + suffix;
      return (pos === 'N' ? (compact ? 'indecl.' : 'indeclinable') : '') + suffix;
    }
    const parts = groups.map((g) => {
      // ego / tū / sē have no gender worth naming; is, hic, quī keep theirs
      const showGender = pos !== 'N' && !(pos === 'PRON' && ['ego', 'tu', 'nos', 'vos', 'se'].includes(entry.h));
      const base = nominalPhrase(g, compact, showGender);
      return g.degree ? `${compact ? DEGREE_NAME[g.degree].slice(0, 4) + '.' : DEGREE_NAME[g.degree]}, ${base}` : base;
    });
    return uniq(parts).join(compact ? '; ' : ' · ') + suffix;
  }
  if (pos === 'V' || pos === 'VPAR') {
    const nominal = parses.filter((p) => ['ptc', 'gerundive', 'gerund', 'supine'].includes(p.mood));
    const finite = parses.filter((p) => !['ptc', 'gerundive', 'gerund', 'supine'].includes(p.mood));
    const parts = [];
    // group finite by tense/voice/person/number so "indicative or imperative" merges
    const fgroups = [];
    for (const p of finite) {
      const key = `${p.tense}|${p.voice}|${p.person || ''}|${p.number || ''}`;
      let g = fgroups.find((x) => x.key === key);
      if (!g) { g = { key, p, moods: [] }; fgroups.push(g); }
      if (!g.moods.includes(p.mood)) g.moods.push(p.mood);
    }
    for (const g of fgroups) {
      const p = g.p;
      const voice = p.voice === 'pass' && !dep ? (compact ? 'pass.' : 'passive') : (p.voice === 'act' && p.mood === 'inf' ? (compact ? 'act.' : 'active') : '');
      const moods = g.moods.map((m) => (compact ? MOOD_ABBR[m] : MOOD_NAME[m])).join(' or ');
      const tense = compact ? TENSE_ABBR[p.tense] : TENSE_NAME[p.tense];
      let s = [tense, voice, moods].filter(Boolean).join(' ');
      if (p.person && p.number) {
        s += compact ? ` ${PERSON_NAME[p.person]} ${NUM_ABBR[p.number]}` : `, ${PERSON_NAME[p.person]} person ${NUM_NAME[p.number]}`;
      } else if (p.number && p.mood === 'imper') {
        s += compact ? ` ${NUM_ABBR[p.number]}` : `, ${NUM_NAME[p.number]}`;
      }
      parts.push(s);
    }
    let lastLabel = null;
    for (const g of groupNominal(nominal)) {
      let label;
      if (g.mood === 'ptc') label = `${compact ? TENSE_ABBR[g.tense] : TENSE_NAME[g.tense]} ${g.voice === 'pass' && !dep ? (compact ? 'pass.' : 'passive') : (compact ? 'act.' : 'active')} ${compact ? 'ptc.' : 'participle'}`;
      else label = g.mood;
      const phrase = nominalPhrase(g, compact, g.mood === 'ptc' || g.mood === 'gerundive');
      parts.push(label === lastLabel ? phrase : `${label}, ${phrase}`);
      lastLabel = label;
    }
    for (const p of nominal.filter((p) => !p.case)) parts.push(p.mood);
    return uniq(parts).join(compact ? '; ' : ' · ') + suffix;
  }
  if (pos === 'PREP') {
    const gov = parses[0]?.governs || entry.kind;
    return (gov ? `preposition + ${compact ? CASE_ABBR[gov] : CASE_NAME[gov]}` : 'preposition') + suffix;
  }
  if (pos === 'ADV') {
    const degs = uniq(parses.map((p) => p.degree).filter(Boolean));
    return (degs.length ? `${degs.map((d) => DEGREE_NAME[d]).join(' or ')} adverb` : 'adverb') + suffix;
  }
  if (pos === 'CONJ') return 'conjunction' + suffix;
  if (pos === 'INTERJ') return 'interjection' + suffix;
  return suffix.trim();
}

// ---------------------------------------------------------------------------
// category, glosses, usage

const PRON_KIND = { pers: 'personal', reflex: 'reflexive', demons: 'demonstrative', indef: 'indefinite', interr: 'interrogative', rel: 'relative', adject: 'adjectival' };

export function categoryLine(entry) {
  switch (entry.pos) {
    case 'N': return declensionName(entry) || 'noun';
    case 'ADJ': return adjectiveName(entry);
    case 'V':
    case 'VPAR': return conjugationName(entry) || 'verb';
    case 'PRON': return entry.kind && PRON_KIND[entry.kind] ? `${PRON_KIND[entry.kind]} pronoun` : 'pronoun';
    case 'NUM': return 'numeral';
    case 'PREP': { const gov = entry.parses?.[0]?.governs || entry.kind; return gov ? `preposition + ${CASE_NAME[gov]}` : 'preposition'; }
    case 'ADV': return 'adverb';
    case 'CONJ': return 'conjunction';
    case 'INTERJ': return 'interjection';
    default: return entry.pos?.toLowerCase() || '';
  }
}

function collectGlosses(...texts) {
  const hay = texts.filter(Boolean).join(' | ').toLowerCase();
  const out = [];
  const taken = new Set();
  for (const term of GLOSS_TERMS) {
    const t = term.toLowerCase();
    if (!hay.includes(t)) continue;
    // skip a term fully inside a longer matched term (e.g. "perfect" inside "future perfect")
    if ([...taken].some((longer) => longer.includes(t) && longer !== t && hay.includes(longer))) {
      // still include if it also appears on its own
      const re = new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
      const stripped = [...taken].reduce((h, longer) => h.split(longer).join(' '), hay);
      if (!re.test(stripped)) continue;
    }
    taken.add(t);
    out.push({ term, gloss: GLOSSES[term] });
  }
  return out;
}

function usageFor(entry) {
  const h = entry.h;
  const parts = [];
  let fw = FUNCTION_WORDS[h];
  if (entry.pos === 'ADV' && FUNCTION_WORDS[`${h}_adv`]) fw = FUNCTION_WORDS[`${h}_adv`];
  if (entry.pos === 'CONJ' && h === 'ne' && FUNCTION_WORDS.ne) fw = FUNCTION_WORDS.ne;
  if (fw?.usage && (!fw.pos || fw.pos === entry.pos || entry.pos === 'VPAR' || ['PRON', 'ADJ', 'N', 'V'].includes(entry.pos))) parts.push(fw.usage);
  else if (fw?.usage && ['PREP', 'CONJ', 'ADV', 'INTERJ'].includes(entry.pos) && ['PREP', 'CONJ', 'ADV', 'INTERJ'].includes(fw.pos)) parts.push(fw.usage);
  if (entry.pos === 'N' && !isProper(entry) && FUNCTION_WORDS._articles) parts.push(FUNCTION_WORDS._articles);
  if (entry.enc && FUNCTION_WORDS._enclitics?.[entry.enc]) parts.push(FUNCTION_WORDS._enclitics[entry.enc]);
  return parts.length ? parts.join(' ') : null;
}

// ---------------------------------------------------------------------------
// describe

export function describe(entry, opts = {}) {
  if (!entry) return null;
  const parse = parseLine(entry, opts);
  const category = categoryLine(entry);
  const meaning = meaningLine(entry, opts);
  const kindTerms = [];
  if (entry.kind === 'dep') kindTerms.push('deponent');
  if (entry.kind === 'semidep') kindTerms.push('semi-deponent');
  if (entry.kind === 'impers') kindTerms.push('impersonal');
  if (entry.enc) kindTerms.push('enclitic');
  const glosses = collectGlosses(parseLine(entry, { compact: false }), category, kindTerms.join(' '));
  let table = null;
  try {
    table = paradigm(entry, entry.parses || []);
  } catch (err) {
    console.error('paradigm error', err);
  }
  return {
    meaning,
    parse,
    lemma: entry.lemma,
    category,
    senses: entry.senses || [],
    glosses,
    usage: usageFor(entry),
    paradigm: table,
  };
}

export const _internal = { thirdSg, pastTense, pastParticiple, ingForm, pluralNoun, headWord, finiteMeaning, verbForms, countRanks, fitPenalties };
