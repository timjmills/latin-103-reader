// Drill items (GRAMMAR-CONTRACT.md "Drill items"): generated on the device
// from the library's sentences and the dictionary's parses — nothing is
// hand-written, nothing copyrighted leaves the library. Wave 1 kinds:
// recognise (choice / tap), chart (a paradigm cell, or a row / column when
// learning), parse (choice at stage 1, typed from stage 2), blank (typed;
// choice at stage 1). Every item carries the target's dictionary form + meaning
// and `meanings` for every word, so a drill tests the grammar, never the vocab.
//
//   createItems({ units, lookup, paradigm, skills, storage, rand, gold })
//     .generate({ skill, kind, stage, currentWeek, currentWeekN, avoid }) → item | null
//     .candidates(skillId) → the pool (for the skill map's counts)
//     .drillable(skillId) → true when the skill can produce an item at all
//
// What a skill asks about is its `feature` (skills.json): case · gender ·
// number · tense · mood · voice · person · degree · construction · form.
// Construction skills (the function-named case skills and the syntax skills)
// ask what the form is *doing* — "What is this dative doing here?", "What kind
// of clause is this?" — with the confusable constructions as the choices, so
// a wrong answer names the pair the learner mixes up.
//
// Candidates come from sentences matched by the skill's `patterns` (together
// with `parse_filter`), plus "gold" sentences: the lesson's own example units
// and the reader's grammar-focus highlights whose label names the
// construction (`highlight_match`). Whitaker's spare parses are trimmed by
// what the sentence shows: the macrons on the form, a preposition before it,
// agreement with a neighbouring word, a vocative only where someone is
// addressed; a reading the entry's own paradigm cannot produce is dropped.
//
// Answer matching (pure, tested): normaliseAnswer, matchesForm, parseFeatures, matchParse, matchFunction.

import { tokenize, stripMacrons } from '../tokenize.js';
import { weekOfUnit, isShelfWeek } from '../sync.js';
import { scopeByChapter, scopeNote } from './chapter.js';

/* ------------------------------------------------------------ parts */
/**
 * A feedback line built from **parts** rather than interpolated into one
 * string ("All Latin text throughout should be mouse-overable for the
 * meaning", 2026-09-11). A plain string is English; `la('…')` is a Latin
 * fragment. The view draws each Latin part as its own `lang="la"` element,
 * which is the whole of what the pointer dictionary needs — `wordsOnDemand`
 * (ui.js) cuts any `lang="la"` element into words the first time the pointer
 * crosses it, so nothing here tokenises anything by hand.
 *
 * English is never marked, and that is half the point: a marked English word
 * would open the dictionary on itself and be read out as Latin by a screen
 * reader.
 *
 * `partsText` is the same line as one string. `ctx.say` reads the rendered
 * `.g-fb__line` textContent, so the parts and the string must agree to the
 * character; every producer here derives its `short` from its `parts` so the
 * two cannot drift. Pure.
 */
export const la = (text) => ({ la: String(text ?? '') });
export const partsText = (parts) => (Array.isArray(parts) ? parts : [parts])
  .map((p) => (p && typeof p === 'object' ? String(p.la ?? '') : String(p ?? '')))
  .join('');
/**
 * A question line built from parts, for a `prompt`. `question` stays the plain
 * string every reader of a prompt has always had; `questionParts` is the same
 * line with its Latin marked, which is what the view draws. Pure.
 */
export const q = (parts) => ({ question: partsText(parts), questionParts: parts });
/** A list of words, each its own Latin fragment: "puella, servus, verbum". Pure. */
export const laList = (words, sep = ', ') => words.flatMap((w, i) => (i ? [sep, la(w)] : [la(w)]));

/* ----------------------------------------------------------- labels */
export const FEATURES = Object.freeze(['case', 'gender', 'number', 'tense', 'mood', 'voice', 'person', 'degree', 'construction', 'form']);
export const CASE_LABEL = {
  nom: { name: 'nominative', plain: 'the subject form' },
  gen: { name: 'genitive', plain: "the 'of' form" },
  dat: { name: 'dative', plain: "the 'to/for' form" },
  acc: { name: 'accusative', plain: 'the object form' },
  abl: { name: 'ablative', plain: "the 'by/with/from' form" },
  voc: { name: 'vocative', plain: 'the address form' },
  loc: { name: 'locative', plain: "the 'at/in' form" },
};
export const TENSE_LABEL = { pres: 'present', impf: 'imperfect', fut: 'future', perf: 'perfect', plupf: 'pluperfect', futperf: 'future perfect' };
export const MOOD_LABEL = { ind: 'indicative', subj: 'subjunctive', imper: 'imperative', inf: 'infinitive' };
export const TM_PLAIN = {
  'pres ind': "the 'is doing / does' tense", 'impf ind': "the 'was doing / used to' tense", 'fut ind': "the 'will do' tense",
  'perf ind': "the 'did / has done' tense", 'plupf ind': "the 'had done' tense", 'futperf ind': "the 'will have done' tense",
  'pres subj': "the 'may / let' form", 'impf subj': "the 'might / would' form", 'perf subj': "the 'may have done' form", 'plupf subj': "the 'might have done' form",
  'pres imper': 'the command form', 'fut imper': "the 'you shall' command", 'pres inf': "the 'to do' form", 'perf inf': "the 'to have done' form", 'fut inf': "the 'to be going to' form",
  'pres ptc': "the '-ing' word", 'perf ptc': "the 'having been done' word", 'fut ptc': "the 'about to' word",
};
const NUMBER_LABEL = { sg: { name: 'singular', plain: 'one' }, pl: { name: 'plural', plain: 'more than one' } };
const GENDER_LABEL = { m: { name: 'masculine', plain: 'he-words' }, f: { name: 'feminine', plain: 'she-words' }, n: { name: 'neuter', plain: 'it-words' }, c: { name: 'masculine or feminine', plain: 'common gender' } };
const VOICE_LABEL = { act: { name: 'active', plain: 'the subject does it' }, pass: { name: 'passive', plain: 'it is done to the subject' }, dep: { name: 'deponent', plain: 'passive form, active meaning' } };
const PERSON_WORD = { 1: '1st person', 2: '2nd person', 3: '3rd person' };
const PERSON_PLAIN = { '1 sg': 'I', '2 sg': 'you (one)', '3 sg': 'he / she / it', '1 pl': 'we', '2 pl': 'you (all)', '3 pl': 'they' };
const DEGREE_LABEL = { pos: { name: 'positive', plain: 'the plain form' }, comp: { name: 'comparative', plain: "the '-er / more' form" }, super: { name: 'superlative', plain: "the '-est / most / very' form" } };
const FORM_LABEL = {
  que: { name: '-que: and', plain: 'joins to the word before it' }, ne: { name: '-ne: a question', plain: 'turns the sentence into a yes/no question' }, ve: { name: '-ve: or', plain: 'an alternative' },
  stem1: { name: 'present stem', plain: 'from the 1st / 2nd principal part' }, stem2: { name: 'perfect stem', plain: 'from the 3rd principal part' }, stem3: { name: 'participle stem', plain: 'from the 4th principal part' },
};
/** A mood on its own, told by what it does rather than by a tense it is paired with. */
const MOOD_PLAIN = { ind: 'it simply happens', subj: "the 'may / might / would' forms", imper: 'the command forms', inf: "the 'to do' forms" };
const MOOD_ONLY_LABEL = { gerund: ['gerund', "the '-ing' noun"], gerundive: ['gerundive', "the 'to be done' adjective"], supine: ['supine', "the '-um / -u' form after motion or an adjective"] };
const CASE_FILLERS = ['nom', 'gen', 'dat', 'acc', 'abl'];
const TM_FILLERS = ['pres ind', 'impf ind', 'perf ind', 'fut ind', 'plupf ind', 'pres subj', 'impf subj', 'perf subj', 'plupf subj'];
const NONFINITE_FILLERS = ['pres inf', 'perf inf', 'pres ptc', 'perf ptc', 'fut ptc', 'pres imper', 'gerund', 'gerundive', 'supine'];
const PERSON_FILLERS = ['1 sg', '2 sg', '3 sg', '1 pl', '2 pl', '3 pl'];
const FILLERS = { case: CASE_FILLERS, gender: ['m', 'f', 'n'], number: ['sg', 'pl'], voice: ['act', 'pass', 'dep'], person: PERSON_FILLERS, degree: ['pos', 'comp', 'super'], form: ['que', 'ne', 've'] };
const MACRON_RE = /[āēīōūȳĀĒĪŌŪȲ]/;

/** True when `v` is the filter value or one of a filter's listed values. Pure. */
export const valueIn = (v, f) => (f == null ? true : Array.isArray(f) ? f.map(String).includes(String(v)) : String(v) === String(f));

/**
 * The dimension a skill's items ask about. Takes a skill (its explicit
 * `feature`, skills.json) or a bare filter (inferred, for older callers and
 * tests): 'case' (nouns, adjectives, pronouns), 'tense' (verbs; participles
 * and infinitives as "perfect participle", "present infinitive"), 'degree',
 * or null (nothing to ask: blank items only).
 */
export function featureKey(skillOrFilter) {
  if (!skillOrFilter || typeof skillOrFilter !== 'object') return null;
  if (Array.isArray(skillOrFilter)) return featureKey(skillOrFilter[0]);
  if (typeof skillOrFilter.feature === 'string') return FEATURES.includes(skillOrFilter.feature) ? skillOrFilter.feature : null;
  if ('feature' in skillOrFilter && skillOrFilter.feature === null) return null;
  const filter = 'parse_filter' in skillOrFilter ? (Array.isArray(skillOrFilter.parse_filter) ? skillOrFilter.parse_filter[0] : skillOrFilter.parse_filter) : skillOrFilter;
  if (!filter || typeof filter !== 'object') return null;
  if (filter.case) return 'case';
  if (filter.tense || filter.mood || filter.deponent) return 'tense';
  if (filter.degree) return 'degree';
  const pos = Array.isArray(filter.pos) ? filter.pos[0] : filter.pos;
  if (pos === 'V' || pos === 'VPAR') return 'tense';
  if (pos === 'N') return 'gender';
  if (pos === 'ADJ' || pos === 'PRON') return 'case';
  return null;
}
const TM_KEY = (key) => key === 'tense' || key === 'mood' || key === 'tm';
const isDeponent = (entry) => entry?.kind === 'dep' || entry?.kind === 'semidep';
const PERFECT_TENSES = new Set(['perf', 'plupf', 'futperf']);
/** The principal-parts stem a form is built on. Pure. */
export function stemOf(p) {
  if (!p) return null;
  if (p.mood === 'supine' || (p.mood === 'ptc' && p.tense !== 'pres') || (p.voice === 'pass' && PERFECT_TENSES.has(p.tense)) || (p.mood === 'inf' && p.tense === 'fut')) return 'stem3';
  if (PERFECT_TENSES.has(p.tense)) return 'stem2';
  if (p.tense || p.mood) return 'stem1';
  return null;
}
/** The value of a feature for one parse (and its entry / skill where the feature lives there). Pure. */
export function featureValue(p, key, entry = null, skill = null) {
  if (!p || !key) return null;
  if (key === 'case') return p.case ?? null;
  if (key === 'gender') return p.gender ?? entry?.gender ?? null;
  if (key === 'number') return p.number ?? null;
  if (key === 'degree') return p.degree || (p.case || entry?.pos === 'ADV' ? 'pos' : null);
  if (key === 'voice') return isDeponent(entry) ? 'dep' : (p.voice ?? null);
  if (key === 'person') return p.person != null && p.number ? `${p.person} ${p.number}` : null;
  if (key === 'construction') return skill?.id ?? null;
  if (key === 'form') return entry?.enc || stemOf(p);
  if (!p.mood) return null;
  if (p.mood === 'ptc' || p.mood === 'inf') return p.tense ? `${p.tense} ${p.mood}` : null;
  if (p.mood === 'gerund' || p.mood === 'gerundive' || p.mood === 'supine') return p.mood;
  if (p.mood === 'imper') return `${p.tense || 'pres'} imper`;
  return p.tense ? `${p.tense} ${p.mood}` : null;
}
/**
 * True when a feature value satisfies the skill's own filter, so it can never
 * be a distractor for it. A filter that says nothing about the feature fits
 * nothing (C1: it must not make every value "fit"). Pure.
 */
export function valueFits(value, filter, key) {
  if (value == null || !filter) return false;
  if (key === 'case' || key === 'gender' || key === 'number' || key === 'degree') return filter[key] != null && valueIn(value, filter[key]);
  if (key === 'voice') return value === 'dep' ? filter.deponent === true : (filter.voice != null && valueIn(value, filter.voice));
  if (key === 'person') { const [pe, nu] = String(value).split(' '); return filter.person != null && valueIn(pe, filter.person) && (filter.number == null || valueIn(nu, filter.number)); }
  if (key === 'form') return filter.enc != null && filter.enc === value;
  if (key === 'construction') return false;
  const [t, m] = String(value).split(' ');
  if (!m) return filter.mood != null && valueIn(value, filter.mood);
  if (filter.tense == null && filter.mood == null) return false;
  return valueIn(t, filter.tense) && valueIn(m, filter.mood);
}
/** { name, plain, full } for a feature value ("dative", "the 'to/for' form", "dative — the 'to/for' form"). `opts.skills` names constructions. */
export function featureLabel(key, value, opts = {}) {
  const mk = (name, plain) => ({ name, plain, full: plain ? `${name} — ${plain}` : name });
  const table = { case: CASE_LABEL, degree: DEGREE_LABEL, gender: GENDER_LABEL, number: NUMBER_LABEL, voice: VOICE_LABEL, form: FORM_LABEL }[key];
  if (table) { const c = table[value]; return c ? mk(c.name, c.plain) : mk(String(value), ''); }
  if (key === 'person') { const [pe, nu] = String(value).split(' '); return mk(`${PERSON_WORD[pe] ?? pe} ${NUMBER_LABEL[nu]?.name ?? nu ?? ''}`.trim(), PERSON_PLAIN[value] ?? ''); }
  if (key === 'construction') {
    const s = opts.skills?.get?.(value);
    const f = s?.function || s?.title || String(value);
    const m = /^(.*?)\s*\((.*)\)\s*$/.exec(f);
    return m ? mk(m[1], m[2]) : mk(f, '');
  }
  if (key == null) return opts.skill ? mk(opts.skill.title, opts.skill.plain) : mk(String(value ?? ''), '');
  if (MOOD_ONLY_LABEL[value]) { const [name, plain] = MOOD_ONLY_LABEL[value]; return mk(name, plain); }
  const [t, m] = String(value).split(' ');
  // A value with no mood beside it is **one half** of the pair: a catalogue's cell axes hand over
  // `pres` or `ind` on their own, where a drill key names both at once (`'pres ind'`). Only the pair
  // had a branch, so a half fell through it and came out of the join with the missing side still
  // attached — the verb tables' "Narrow it" chips read "present undefined" and "ind undefined".
  // Anything else with no space (a lemma axis's chapter number) is its own best name.
  if (!m) return mk(TENSE_LABEL[t] ?? MOOD_LABEL[t] ?? String(value), MOOD_PLAIN[t] ?? '');
  const name = m === 'ptc' ? `${TENSE_LABEL[t] ?? t} participle` : m === 'inf' ? `${TENSE_LABEL[t] ?? t} infinitive` : m === 'imper' ? `${t === 'fut' ? 'future ' : ''}imperative` : `${TENSE_LABEL[t] ?? t} ${MOOD_LABEL[m] ?? m}`;
  const plain = TM_PLAIN[value] ?? (m === 'ptc' ? "the '-ing / having been done' form" : m === 'inf' ? "the 'to do' form" : m === 'imper' ? 'the command form' : '');
  return mk(name, plain);
}

/**
 * The word indexes of a multi-word focus in a sentence: a contiguous run
 * first (*Cane lātrante*), else each word on its own, in order (*habērem* …
 * *emerem*). Macrons and punctuation are ignored. [] when it is not there.
 * Local to this module on purpose: `sets.js` has the same matcher for the UI,
 * and importing it here would make the two modules import each other. Pure.
 */
function spanIndexes(la, parts) {
  const words = tokenize(String(la ?? '')).filter((t) => t.isWord).map((t) => t.form);
  const want = parts.map((w) => tokenize(String(w)).filter((t) => t.isWord).map((t) => t.form)).flat();
  if (!want.length) return [];
  for (let i = 0; i + want.length <= words.length; i++) if (want.every((w, j) => words[i + j] === w)) return want.map((_, j) => i + j);
  const out = [];
  let from = 0;
  for (const w of want) { const at = words.indexOf(w, from); if (at < 0) return []; out.push(at); from = at + 1; }
  return out;
}

/* ----------------------------------------------------------- parses */
const FILTER_KEYS = ['case', 'number', 'gender', 'tense', 'voice', 'mood', 'person', 'degree'];
/** True when a parse satisfies the filter's parse-level keys (each a value or a list). Pure. */
export function parseMatches(p, filter) {
  if (!p || !filter || typeof filter !== 'object' || Array.isArray(filter)) return false;
  for (const k of FILTER_KEYS) {
    if (filter[k] == null) continue;
    const v = k === 'degree' ? (p.degree || (p.case ? 'pos' : undefined)) : p[k];
    if (v == null || !valueIn(v, filter[k])) return false;
  }
  return true;
}
const NOMINAL_POS = new Set(['N', 'ADJ', 'PRON', 'NUM', 'VPAR']);
/**
 * True when the entry itself fits the filter: part of speech, lemma list (`h`),
 * declension (`decl` = cat[0]), deponent. An adverb never satisfies a case
 * filter and a noun never a tense filter, whatever Whitaker lists. Pure.
 */
export function entryAllowed(entry, filter) {
  if (!entry || !filter || typeof filter !== 'object' || Array.isArray(filter)) return false;
  if (filter.pos != null && !valueIn(entry.pos, filter.pos) && !(entry.pos === 'VPAR' && valueIn('V', filter.pos))) return false;
  if (filter.pos == null) {
    if ((filter.case != null || filter.gender != null) && !NOMINAL_POS.has(entry.pos)) return false;
    if ((filter.tense != null || filter.mood != null || filter.voice != null || filter.person != null) && entry.pos !== 'V' && entry.pos !== 'VPAR') return false;
    if (filter.degree != null && entry.pos !== 'ADJ' && entry.pos !== 'ADV') return false;
  }
  if (filter.h != null && !valueIn(entry.h, filter.h)) return false;
  if (filter.enc != null && entry.enc !== filter.enc) return false;
  if (filter.decl != null && !valueIn(entry.cat?.[0], filter.decl)) return false;
  if (filter.deponent === true && !isDeponent(entry)) return false;
  return true;
}
const headSense = (entry) => String(entry?.senses?.[0] ?? '').split(/[;]/)[0].split(',').slice(0, 2).join(',').trim();
export const lemmaGloss = (entry) => (entry ? `${entry.lemma} — ${headSense(entry)}` : '');
/** The head alone: for the rare item whose full citation would spell its own answer (femina *fēminae* f). */
export const headGloss = (entry) => (entry ? `${String(entry.lemma ?? '').split(/[\s,]/)[0]} — ${headSense(entry)}` : '');

/**
 * A small multiple choice over one parse feature: the true value first, then
 * distractors from the feature's own value set. Used by a completed worked
 * example (GRAMMAR-CONTRACT.md §8), which asks for one feature at a time.
 * `[]` when the feature has no value set to draw from. Pure but for `rand`.
 */
export function featureChoices(key, own, { n = 4, rand = Math.random, skills = null, skill = null, pool: given = null } = {}) {
  const pool = given ?? WORKED_POOL[key] ?? (key === 'tm' ? TM_FILLERS : FILLERS[key]);
  if (!pool || own == null) return [];
  // Fisher-Yates: `sort(() => rand() - 0.5)` is not a shuffle — it leaves the first choices near the front,
  // so the same distractors kept coming up first.
  const others = pool.filter((v) => String(v) !== String(own));
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
  others.splice(Math.max(0, n - 1));
  if (!others.length) return [];
  const label = (v) => { const l = workedLabel(key, v, { skills, skill }); return { value: String(v), label: l.name, plain: l.plain, correct: String(v) === String(own) }; };
  const all = [own, ...others].map(label);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return all;
}

/**
 * The value sets a **worked example** asks over, one feature at a time (§8):
 * the tense alone, the mood alone, the person alone — not the tense-and-mood
 * pair the drills use — because the example is built up a feature at a time.
 */
const WORKED_POOL = {
  case: ['nom', 'gen', 'dat', 'acc', 'abl', 'voc'], number: ['sg', 'pl'], gender: ['m', 'f', 'n'], degree: ['pos', 'comp', 'super'],
  voice: ['act', 'pass'], tense: ['pres', 'impf', 'fut', 'perf', 'plupf', 'futperf'], mood: ['ind', 'subj', 'imper', 'inf', 'ptc'], person: ['1', '2', '3'], form: ['que', 'ne', 've'],
};
/** A single feature value's label as a worked example prints it — a tense or a mood on its own, a person without its number. */
function workedLabel(key, value, opts = {}) {
  const mk = (name, plain) => ({ name, plain, full: plain ? `${name} — ${plain}` : name });
  if (key === 'tense') return mk(TENSE_LABEL[value] ?? String(value), '');
  if (key === 'mood') return MOOD_ONLY_LABEL[value] ? mk(MOOD_ONLY_LABEL[value][0], MOOD_ONLY_LABEL[value][1]) : mk(value === 'ptc' ? 'participle' : (MOOD_LABEL[value] ?? String(value)), '');
  if (key === 'person') return mk(PERSON_WORD[value] ?? String(value), '');
  return featureLabel(key, value, opts);
}
/**
 * One feature of a scanned candidate as a worked example gives or asks it
 * (§8): `{ key, label, value, name, plain, pool }` — `label` the feature's own
 * name ("case"), `name` the value's ("dative"). null when the word does not
 * carry the feature (a verb has no case; a noun no tense), so the step drops
 * it rather than asks it. A construction's pool is the skill's confusables
 * and the other constructions of its category. Pure.
 */
export function workedFeature(key, c, { skill = null, skills = null } = {}) {
  const p = c?.parse;
  if (!p || !key) return null;
  let value = null;
  let pool = null;
  if (key === 'case') value = p.case ?? null;
  else if (key === 'number') value = p.number ?? null;
  else if (key === 'gender') value = p.gender ?? (c.entry?.pos === 'N' ? c.entry?.gender : null) ?? null;
  else if (key === 'degree') value = p.degree || (p.case && (c.entry?.pos === 'ADJ' || c.entry?.pos === 'ADV') ? 'pos' : null);
  else if (key === 'voice') value = isDeponent(c.entry) ? 'dep' : (p.voice ?? null);
  else if (key === 'tense') value = p.tense ?? null;
  else if (key === 'mood') value = p.mood ?? null;
  else if (key === 'person') value = p.person != null ? String(p.person) : null;
  else if (key === 'form') value = c.entry?.enc ?? null;
  else if (key === 'construction') {
    value = skill?.id ?? null;
    const same = skills instanceof Map ? [...skills.values()].filter((s) => s.id !== skill?.id && s.feature === 'construction' && s.category === skill?.category).map((s) => s.id) : [];
    pool = [...new Set([...(skill?.confusable_with ?? []), ...same])].filter((id) => !(skills instanceof Map) || skills.has(id));
  }
  if (value == null || value === '' || (value === 'c' && key === 'gender')) return null;
  if (key === 'voice' && value === 'dep') pool = ['act', 'pass', 'dep'];
  const l = workedLabel(key, value, { skill, skills });
  return { key, label: key === 'construction' ? 'what it is doing' : key, value: String(value), name: l.name, plain: l.plain, pool };
}

/* ------------------------------------------- paradigm cell ids (§4a) */
/**
 * The stable id of one paradigm cell, read off the structured `key`
 * paradigms.js already puts on it and never off a section, row or column index
 * (GRAMMAR-CONTRACT.md §4a). The slots are written in one fixed order and the
 * ones the key does not carry are left out; a kind that is neither `nominal`
 * nor `finite` is prefixed with its kind, so a gerund's accusative and a
 * noun's cannot collide. On a **noun** table the gender is the lemma's, not the
 * cell's, so it is left out.
 *
 * This is the same scheme `tests/latin_forms/dump_js_cell_ids.mjs` dumps for
 * `pipeline/test_build_paradigm_catalogue.py`; the two are asserted equal in
 * `tests/grammar.learn-steps.test.mjs`, so the ids the app computes are the
 * ids `paradigms.json` holds. Pure.
 */
export const CELL_SLOT_ORDER = Object.freeze(['degree', 'tense', 'mood', 'voice', 'person', 'case', 'number', 'gender']);
const CELL_KIND_PREFIX = new Set(['imper', 'inf', 'ptc', 'gerund', 'supine']);
export function cellId(key, tableKind) {
  if (!key) return null;
  if (key.kind === 'gerundive') return 'gerundive';
  const slots = Object.fromEntries(CELL_SLOT_ORDER.map((k) => [k, key[k]]));
  if (key.kind === 'nominal' && tableKind === 'noun') slots.gender = null;
  if (key.kind === 'imper' && !slots.tense) slots.tense = 'pres';
  const body = CELL_SLOT_ORDER.filter((k) => slots[k]).map((k) => String(slots[k]));
  if (key.kind === 'nominal' || key.kind === 'finite') return body.join('.');
  if (!CELL_KIND_PREFIX.has(key.kind)) return null;
  return [key.kind, ...body].join('.');
}
/** The stable id of one section of a rendered paradigm, from the keys of its cells (§4a). Pure. */
export function groupId(section) {
  const keys = (section?.rows ?? []).flatMap((r) => (r.cells ?? []).map((c) => c?.key).filter(Boolean));
  if (!keys.length) return null;
  const kinds = new Set(keys.map((k) => k.kind));
  if (kinds.size === 1 && kinds.has('finite')) {
    const tenses = new Set(keys.map((k) => k.tense));
    const moods = new Set(keys.map((k) => k.mood));
    if (tenses.size === 1 && moods.size === 1) return `${[...tenses][0]}.${[...moods][0]}`;
  }
  if (kinds.size === 1 && kinds.has('nominal')) {
    const degrees = new Set(keys.map((k) => k.degree ?? null));
    if (degrees.size === 1) return [...degrees][0] ?? 'cases';
  }
  if ([...kinds].every((k) => k === 'ptc' || k === 'gerundive')) return 'ptc';
  if (kinds.size === 1 && CELL_KIND_PREFIX.has([...kinds][0])) return [...kinds][0];
  return null;
}
/**
 * Every cell of a rendered paradigm by its id: `Map<cell id, { cell, section,
 * row, col, group, rowLabel, colLabel, sectionTitle }>`. The first cell to
 * claim an id keeps it. Pure.
 */
export function tableCells(table) {
  const out = new Map();
  for (const [si, sec] of (table?.sections ?? []).entries()) {
    const group = groupId(sec);
    for (const [ri, row] of (sec.rows ?? []).entries()) {
      for (const [ci, cell] of (row.cells ?? []).entries()) {
        if (!cell || cell.empty || !cell.key) continue;
        const id = cellId(cell.key, table?.kind);
        if (!id || out.has(id)) continue;
        out.set(id, { cell, section: si, row: ri, col: ci, group, rowLabel: row.label ?? '', colLabel: sec.headers?.[ci] ?? '', sectionTitle: sec.title ?? '' });
      }
    }
  }
  return out;
}
/**
 * A cell id as written in a lesson, matched against the ids a table really
 * has. The 88 hand-written teach blocks spell a few of them loosely — the
 * person and the number run together (`impf.subj.act.3sg` for
 * `impf.subj.act.3.sg`), and an adjective's degree is left off (`nom.sg.f` for
 * `pos.nom.sg.f`) — and a step must teach its cell rather than fail on a full
 * stop. Only these two are forgiven, and only when the table names exactly one
 * candidate; anything else is null and the caller degrades. Pure.
 */
export function resolveCellId(id, have) {
  const want = String(id ?? '').trim();
  if (!want) return null;
  const has = (x) => (have instanceof Set ? have.has(x) : have instanceof Map ? have.has(x) : false);
  if (has(want)) return want;
  const split = want.replace(/([123])(sg|pl)(?![a-z0-9])/g, '$1.$2');
  if (split !== want && has(split)) return split;
  for (const degree of ['pos', 'comp', 'super']) if (has(`${degree}.${split}`)) return `${degree}.${split}`;
  return null;
}
/** The ending a cell teaches (`-ō`), or null when the table prints no stem / ending split. Pure. */
export const cellEnding = (cell) => (cell && typeof cell.ending === 'string' && cell.ending ? cell.ending : null);

/* ------------------------------------------------- answer matching */
/** Macron-optional, case-insensitive, punctuation dropped, spaces collapsed. Pure. */
export function normaliseAnswer(s) {
  return stripMacrons(String(s ?? '')).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
/* ------------------------------- the key of an item on a written sentence */
// A skill's own written sentences (§1) are a pool of their own, beside the library's. An item drawn from them
// carries the ordinary generator key with `w:` in front, so "redo what was wrong" can tell the two apart from
// the key alone and rebuild the item where it came from (`createTeachItems.itemByKey`) rather than looking for
// a sentence the library has never heard of. Pure, and the shape is the only contract between them.
export const WRITTEN_PREFIX = 'w:';
export const writtenKey = (key) => (key ? `${WRITTEN_PREFIX}${key}` : null);
export const isWrittenKey = (key) => typeof key === 'string' && key.startsWith(WRITTEN_PREFIX);
export const bareKey = (key) => (isWrittenKey(key) ? key.slice(WRITTEN_PREFIX.length) : key);
/**
 * A shaper that gives a form the same initial capital as `like`. A multiple
 * choice must not be answerable by the shape of its options: the right one is
 * lifted from the sentence, where a word that opens it is capitalised, while
 * the distractors come from the paradigm, which prints them lower case — so
 * the capital alone gave the answer away (QA M-4). Only what is shown
 * changes; `normaliseAnswer` folds case before anything is graded. Pure.
 */
export function matchCapital(like) {
  const first = String(like ?? '').charAt(0);
  const upper = !!first && first === first.toUpperCase() && first !== first.toLowerCase();
  return (form) => {
    const s = String(form ?? '');
    if (!s) return s;
    return (upper ? s.charAt(0).toUpperCase() : s.charAt(0).toLowerCase()) + s.slice(1);
  };
}
/**
 * Does a line the item *shows* spell one of the forms it accepts? Whole words,
 * macrons optional — the same reading the grader does. Nothing an item prints
 * before it is answered may pass this (QA-FINAL B1): not the blanked sentence,
 * not the question, and not the dictionary line, whose citation carries the
 * genitive of a noun and the principal parts of a verb.
 */
export const spellsAnswer = (text, answers) => {
  const hay = ` ${normaliseAnswer(text)} `;
  return (answers || []).some((a) => a && hay.includes(` ${normaliseAnswer(a)} `));
};
/** Latin forms only: v/u and j/i are one letter for matching (never applied to the English of a typed parse). */
const foldVU = (s) => s.replace(/v/g, 'u').replace(/j/g, 'i');
/** True when the typed form matches one of the accepted answers (macrons optional, v/u and j/i folded). Pure. */
export function matchesForm(typed, answers) {
  const t = foldVU(normaliseAnswer(typed));
  if (!t) return false;
  return (answers || []).some((a) => foldVU(normaliseAnswer(a)) === t);
}

/** Latin forms with the macrons kept: case-insensitive, punctuation dropped, v/u and j/i still folded (an orthographic variant, not a length contrast). Pure. */
export function normaliseExact(s) {
  return String(s ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** True when the typed form matches an accepted answer *with its macrons* — for drills where the vowel's length is the exercise (pensum blanks). Pure. */
export function matchesFormExact(typed, answers) {
  const t = foldVU(normaliseExact(typed));
  if (!t) return false;
  return (answers || []).some((a) => foldVU(normaliseExact(a)) === t);
}

const SYN = {
  case: { nominative: 'nom', nom: 'nom', genitive: 'gen', gen: 'gen', dative: 'dat', dat: 'dat', accusative: 'acc', acc: 'acc', ablative: 'abl', abl: 'abl', vocative: 'voc', voc: 'voc', locative: 'loc', loc: 'loc' },
  number: { singular: 'sg', sing: 'sg', sg: 'sg', s: 'sg', plural: 'pl', plur: 'pl', pl: 'pl', p: 'pl' },
  tense: { present: 'pres', pres: 'pres', imperfect: 'impf', impf: 'impf', imperf: 'impf', future: 'fut', fut: 'fut', perfect: 'perf', perf: 'perf', pluperfect: 'plupf', plupf: 'plupf', plup: 'plupf', 'future perfect': 'futperf', futperf: 'futperf', 'fut perf': 'futperf' },
  mood: { indicative: 'ind', ind: 'ind', indic: 'ind', subjunctive: 'subj', subj: 'subj', subjunct: 'subj', imperative: 'imper', imper: 'imper', infinitive: 'inf', inf: 'inf', participle: 'ptc', ptc: 'ptc', gerund: 'gerund', gerundive: 'gerundive', supine: 'supine' },
  voice: { active: 'act', act: 'act', passive: 'pass', pass: 'pass', deponent: 'dep', dep: 'dep' },
  degree: { positive: 'pos', comparative: 'comp', comp: 'comp', superlative: 'super', sup: 'super', super: 'super' },
  person: { '1st': '1', first: '1', '1': '1', '2nd': '2', second: '2', '2': '2', '3rd': '3', third: '3', '3': '3' },
  gender: { masculine: 'm', masc: 'm', m: 'm', feminine: 'f', fem: 'f', f: 'f', neuter: 'n', neut: 'n', n: 'n' },
};
/** The grammatical features named in a typed parse ("dat. sg." → { case: 'dat', number: 'sg' }); a word naming two values of one feature is a contradiction (kept as an array). Pure. */
export function parseFeatures(typed) {
  const text = normaliseAnswer(typed).replace(/\b(the|of|person|form|tense)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const out = {};
  const put = (k, v) => { if (out[k] == null) out[k] = v; else if (out[k] !== v) out[k] = Array.isArray(out[k]) ? [...out[k], v] : [out[k], v]; };
  let rest = text;
  for (const phrase of ['future perfect', 'fut perf']) if (rest.includes(phrase)) { put('tense', 'futperf'); rest = rest.split(phrase).join(' '); }
  for (const w of rest.split(' ').filter(Boolean)) {
    for (const [k, table] of Object.entries(SYN)) {
      if (Object.prototype.hasOwnProperty.call(table, w)) { put(k, table[w]); break; }
    }
  }
  return out;
}
/**
 * A typed parse against what the item expects: every `required` feature must
 * be named with the right value; any other feature named must not contradict
 * the item's parse. Pure.
 */
export function matchParse(typed, expect) {
  const f = parseFeatures(typed);
  const req = expect?.required ?? Object.keys(expect?.values ?? {});
  const vals = expect?.values ?? {};
  for (const k of req) if (f[k] == null || Array.isArray(f[k]) || String(f[k]) !== String(vals[k])) return false;
  for (const [k, v] of Object.entries(f)) if (vals[k] != null && String(v) !== String(vals[k])) return false;
  return true;
}
const keyRe = (k) => new RegExp(`(^|[^a-z])${normaliseAnswer(k).replace(/\s+/g, '\\s+')}([^a-z]|$)`);
/**
 * A typed function ("indirect object", "purpose") against a construction
 * item: right when it names one of the accepted phrases and none of the
 * confusable ones; `confused` = the confusable skill it named instead. Pure.
 */
export function matchFunction(typed, expect) {
  const t = normaliseAnswer(typed);
  if (!t) return { correct: false, confused: null };
  const hit = (expect?.accept || []).some((k) => keyRe(k).test(t));
  let confused = null;
  for (const [k, skill] of Object.entries(expect?.reject || {})) if (keyRe(k).test(t)) { confused = skill; break; }
  return { correct: hit && !confused, confused };
}

/* ---------------------------------------------------------- pool */
/**
 * Used item keys per skill/kind so nothing repeats until the pool is
 * exhausted (localStorage-backed; any getItem/setItem object). `choose` draws
 * from the *whole* key list: the unused keys first, and among those the
 * preferred tiers in order (gold, this week, nouns, short sentences); the
 * used-set resets only when every key has been drawn (`wrapped`).
 */
export function createPool(storage, key = 'l103.grammar.used') {
  let data = {};
  try { data = JSON.parse(storage?.getItem?.(key) || '{}') || {}; } catch { data = {}; }
  const save = () => { try { storage?.setItem?.(key, JSON.stringify(data)); } catch { /* private mode */ } };
  return {
    used(skill, kind) { return new Set(data[`${skill}|${kind}`] ?? []); },
    /** Pick from `keys` one not used yet, preferring the first non-empty `tiers` subset; when every key has been used the pool starts over. Returns the key (see `chooseInfo` for the wrap flag). */
    choose(skill, kind, keys, rand = Math.random, tiers = []) { return this.chooseInfo(skill, kind, keys, rand, tiers)?.key ?? null; },
    /**
     * `want` asks for one exact key back — a redo playing an item the learner
     * missed (GRAMMAR-CONTRACT.md "Redo what was wrong"). The pool hands it
     * over when the key is still in `keys`, marks it used like any other draw,
     * and answers **null** when it has gone (the sentence left the library, the
     * deck changed): the caller then drops the slot quietly rather than
     * substituting a different item under the same name.
     */
    chooseInfo(skill, kind, keys, rand = Math.random, tiers = [], want = null) {
      if (!keys.length) return null;
      const k = `${skill}|${kind}`;
      let used = new Set(data[k] ?? []);
      if (want != null) {
        if (!keys.includes(want)) return null;
        used.add(want);
        data[k] = [...used];
        save();
        return { key: want, wrapped: false, left: keys.filter((x) => !used.has(x)).length, wanted: true };
      }
      let fresh = keys.filter((x) => !used.has(x));
      let wrapped = false;
      if (!fresh.length) { used = new Set(); fresh = keys; wrapped = true; }
      let from = fresh;
      for (const tier of tiers) { const sub = fresh.filter((x) => tier.has(x)); if (sub.length) { from = sub; break; } }
      const pick = from[Math.floor(rand() * from.length)];
      used.add(pick);
      data[k] = [...used];
      save();
      return { key: pick, wrapped, left: fresh.length - 1 };
    },
    reset(skill = null) { if (skill == null) data = {}; else for (const k of Object.keys(data)) if (k.startsWith(`${skill}|`)) delete data[k]; save(); },
  };
}

/* ---------------------------------------------------- patterns */
/** skills.json patterns are Python regexes with a leading (?i); JS takes the flag instead. Bad ones are skipped. Pure. */
export function compilePatterns(patterns) {
  const out = [];
  for (const p of patterns || []) {
    if (typeof p !== 'string') continue;
    const src = p.replace(/^\(\?i\)/, '');
    try { out.push(new RegExp(src, 'gi')); } catch { /* unsupported syntax: skip */ }
  }
  return out;
}
/** Macron-stripped copy of a sentence with a map from original offsets to stripped offsets (æ → ae shifts them). Pure. */
export function strippedText(la) {
  let s = '';
  const map = new Array(la.length + 1);
  for (let i = 0; i < la.length; i++) { map[i] = s.length; s += stripMacrons(la[i]); }
  map[la.length] = s.length;
  return { text: s, map };
}
/** The spans [start, end) of `la` (stripped offsets) that the patterns match. Pure. */
export function patternSpans(la, regexes, stripped = strippedText(la)) {
  const spans = [];
  for (const re of regexes) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(stripped.text)) !== null) {
      if (m[0].length) spans.push([m.index, m.index + m[0].length]);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return spans;
}
const inSpans = (spans, s, e) => spans.some(([a, b]) => s >= a && e <= b);

/* ---------------------------------------------------- candidates */
const weekOf = (id) => weekOfUnit(id);   // w07:… → 7; the review shelf's r07:… → 107 (sync.js)
const genderOk = (cellGender, g) => !cellGender || !g || cellGender === g || (cellGender === 'c' && (g === 'm' || g === 'f')) || (g === 'c' && (cellGender === 'm' || cellGender === 'f'));
/** The paradigm cells one parse names (mirrors paradigms.js keyMatches). Pure. */
export function cellsFor(table, p) {
  const out = [];
  if (!table || !p) return out;
  for (const sec of table.sections ?? []) for (const row of sec.rows ?? []) for (const c of row.cells ?? []) {
    const k = c?.key;
    if (!k || c.empty) continue;
    let ok = false;
    if (k.kind === 'nominal') {
      ok = !!p.case && (!p.mood || p.mood === 'ptc' || p.mood === 'gerundive') && p.case === k.case && (!p.number || !k.number || p.number === k.number) && genderOk(k.gender, p.gender)
        && (!k.degree || (p.degree || 'pos') === k.degree) && (k.degree || !p.degree || p.degree === 'pos') && (!k.mood || p.mood === k.mood) && (k.mood || !p.mood) && (!k.tense || !p.tense || p.tense === k.tense);
    } else if (k.kind === 'finite') ok = p.tense === k.tense && p.mood === k.mood && p.voice === k.voice && String(p.person) === String(k.person) && p.number === k.number;
    else if (k.kind === 'imper') ok = p.mood === 'imper' && p.voice === k.voice && p.number === k.number && (p.tense || 'pres') === k.tense && (!k.person || String(p.person) === String(k.person));
    else if (k.kind === 'inf') ok = p.mood === 'inf' && p.tense === k.tense && p.voice === k.voice;
    else if (k.kind === 'ptc') ok = p.mood === 'ptc' && p.tense === k.tense && p.voice === k.voice;
    else if (k.kind === 'gerundive') ok = p.mood === 'gerundive';
    else if (k.kind === 'gerund') ok = p.mood === 'gerund' && p.case === k.case;
    else if (k.kind === 'supine') ok = p.mood === 'supine' && p.case === k.case;
    if (ok) out.push(c);
  }
  return out;
}
const cellForms = (c) => [c.text, c.alt, ...String(c.text ?? '').split(' / ')].filter(Boolean).map((s) => String(s).replace(/\s+-a -um$/, '').replace(/\s+esse$/, '').replace(/\s+īrī$/, '').trim());
const VOC_CUE_RE = /(^|[\s"'“‘(])(ō|o|mī|mi)$/i;
// Words that are words, whatever Whitaker splits off them: never an enclitic target (itaque, quisque …), never a noun (sēcum = sē + cum).
const LEXICAL_QUE = new Set(['itaque', 'neque', 'quoque', 'undique', 'denique', 'utique', 'atque', 'absque', 'plerumque', 'ubique', 'usque', 'namque', 'quandoque', 'quisque', 'quaeque', 'quidque', 'quodque', 'quemque', 'quamque', 'cuique', 'cuiusque', 'quoque', 'quaque', 'quorumque', 'quarumque', 'quibusque', 'quosque', 'quasque', 'uterque', 'utraque', 'utrumque', 'utriusque', 'utrique', 'utrumque', 'utramque', 'utroque', 'utraque', 'quicumque', 'quaecumque', 'quodcumque', 'quandocumque', 'ubicumque', 'quotienscumque', 'quisquis', 'quidquid', 'quicquid']);
const NEVER_TARGET = new Set(['secum', 'mecum', 'tecum', 'nobiscum', 'vobiscum', 'quocum', 'quacum', 'quibuscum', 'quicum']);
const PREP_GOVERNS = (entry) => (entry?.pos === 'PREP' ? [entry.kind, ...(entry.parses || []).map((p) => p.governs)].filter((g) => g === 'abl' || g === 'acc') : []);

/**
 * Every word in `unit.la` whose dictionary parses satisfy the skill's
 * parse_filter. `ambiguous` — the word also reads as another value of the
 * skill's feature (puellae: genitive or dative; servīs: dative or ablative),
 * so only blank items may use it. `opts`: { paradigm (verifies readings
 * against the entry's own table), patterns (compiled; a token must sit in a
 * match), gold (spans [start, end, source] in unit offsets that count without
 * a pattern), lookup / tokens caches }. Pure given `lookup`.
 */
export function scanUnit(unit, skill, lookup, opts = {}) {
  // An any-of list of filters (the enclitics: [{enc:'que'},{enc:'ne'}]) is scanned filter by filter.
  if (Array.isArray(skill.parse_filter)) return skill.parse_filter.flatMap((f) => scanUnit(unit, { ...skill, parse_filter: f }, lookup, opts));
  const filter = skill.parse_filter;
  if (!filter || typeof filter !== 'object') return [];
  const key = featureKey(skill);
  // A construction is ambiguous through its form: the case (or tense) the filter names, not the function itself.
  const ak = key === 'construction' ? (filter.case ? 'case' : (filter.mood || filter.tense) ? 'tense' : null) : key;
  const la = String(unit.la ?? '');
  const toks = opts.tokens?.(la) ?? tokenize(la);
  const look = opts.lookup ?? lookup;
  const regexes = opts.patterns ?? [];
  const strippedLa = regexes.length ? (opts.stripped?.(la) ?? strippedText(la)) : null;
  const spans = regexes.length ? patternSpans(la, regexes, strippedLa) : null;
  const gold = opts.gold ?? [];
  const macronised = MACRON_RE.test(la);
  const words = toks.filter((t) => t.isWord);
  // Sentence-level cues, once per call: someone is addressed when a 2nd-person verb or an exclamation is about.
  const looked = new Map();
  const lookOf = (t) => { if (!looked.has(t.form)) looked.set(t.form, look(t.form)); return looked.get(t.form); };
  let second = /!/.test(la);
  if (!second) for (const t of words) { if (t.text.length < 2) continue; if ((lookOf(t)?.entries || []).some((e) => (e.pos === 'V' || e.pos === 'VPAR') && (e.parses || []).some((p) => String(p.person) === '2' || p.mood === 'imper'))) { second = true; break; } }
  const between = (a, b) => (a && b ? toks.filter((t) => !t.isWord && t.start >= a.end && t.end <= b.start).map((t) => t.text).join('') : '');
  const nominalReadings = (t) => (lookOf(t)?.entries || []).filter((e) => NOMINAL_POS.has(e.pos) && !e.enc).flatMap((e) => e.parses || []).filter((p) => p.case);
  const out = [];
  for (let wi = 0; wi < words.length; wi++) {
    const t = words[wi];
    if (t.text.length < 2) continue;
    const res = lookOf(t);
    const all = res?.entries || [];
    if (!all.length) continue;
    // The enclitic fallback strips -que from words that are words (quisque, itaque): never a target; nor is sē + cum a noun.
    if (NEVER_TARGET.has(t.form)) continue;
    if (all.some((e) => e.enc) && (LEXICAL_QUE.has(t.form) || all.some((e) => !e.enc && e.pos !== 'ENDING'))) { if (filter.enc) continue; }
    if (res.via === 'enclitic' && all.some((e) => e.pos === 'PRON' || e.pos === 'CONJ' || e.pos === 'ADV')) continue;
    const goldSpan = gold.find(([s, e]) => t.start >= s && t.end <= e) ?? null;
    if (spans && !goldSpan && !inSpans(spans, strippedLa.map[t.start], strippedLa.map[t.end])) continue;
    const entries = all.filter((e) => entryAllowed(e, filter));
    if (!entries.length) continue;
    // A form that reads as a noun *and* as a verb (īrī: Īris or īre) is left alone for every kind: the
    // dictionary's first entry is not always the sentence's, and a drill must never gloss a word wrongly.
    const classOf = (e) => (e.pos === 'V' ? 'verb' : e.pos === 'VPAR' ? null : NOMINAL_POS.has(e.pos) ? 'nominal' : 'other');
    const classes = new Set(all.filter((e) => e.pos !== 'ENDING' && !e.enc && e.pos !== 'PREP').map(classOf).filter(Boolean));
    if (classes.size > 1) continue;
    // What the sentence shows: a preposition governing the word, a vocative cue, the neighbours it could agree with.
    const prev = words[wi - 1], next = words[wi + 1];
    const beforeText = between(prev, t);
    const afterText = between(t, next);
    // A preposition governs the word after it and any nominal (or et / -que) run up to it: "in hortīs magnīs et pulchrīs".
    const governs = new Set();
    for (let j = wi - 1; j >= Math.max(0, wi - 4); j--) {
      const w = words[j];
      if (/[,.;:!?]/.test(between(w, words[j + 1]))) break;
      const es = lookOf(w)?.entries || [];
      const g = es.flatMap(PREP_GOVERNS);
      if (g.length) { for (const x of g) governs.add(x); break; }
      if (!es.some((e) => NOMINAL_POS.has(e.pos)) && w.form !== 'et') break;
    }
    const addressed = VOC_CUE_RE.test(la.slice(0, t.start).trimEnd()) || (/,/.test(beforeText) && /[,!]/.test(afterText)) || (wi === 0 && /^[,!]/.test(afterText.trim()));
    const vocOk = second || addressed;
    const neighbours = [prev && !/[,.;:!?]/.test(beforeText) ? prev : null, next && !/[,.;:!?]/.test(afterText) ? next : null].filter(Boolean);
    // A word standing *directly* after a word that is nothing but a preposition (in, ex — never cum or
    // post, which also read as a conjunction or an adverb) must be in a case that preposition governs.
    // An entry whose readings here are all other cases cannot account for the word, whatever its stem
    // happens to spell: "in Latiō" is not the nominative of a word `latiō lationis f` (QA B2).
    const prepOnly = (w) => { const es = (lookOf(w)?.entries || []).filter((x) => x.pos !== 'ENDING' && !x.enc); return es.length > 0 && es.every((x) => x.pos === 'PREP'); };
    const directGoverns = new Set(prev && !/[,.;:!?]/.test(beforeText) && prepOnly(prev) ? (lookOf(prev)?.entries || []).flatMap(PREP_GOVERNS) : []);
    /** The readings the entry's *own table* gives the printed word in a case the preposition governs. */
    const governedReadings = (e, table) => {
      const out = [];
      const norm = stripMacrons(t.text).toLowerCase();
      const exact = t.text.toLowerCase();
      for (const sec of table?.sections ?? []) for (const row of sec.rows ?? []) for (const c of row.cells ?? []) {
        const k = c?.key;
        if (!k || c.empty || k.kind !== 'nominal' || k.mood || !directGoverns.has(k.case)) continue;
        const forms = cellForms(c);
        if (!forms.some((f) => String(f).toLowerCase() === exact) && !(!macronised && forms.some((f) => stripMacrons(String(f)).toLowerCase() === norm))) continue;
        const p = { case: k.case, number: k.number, gender: k.gender ?? e.gender ?? undefined };
        if (k.degree) p.degree = k.degree;
        if (!out.some((q) => q.case === p.case && q.number === p.number && q.gender === p.gender && q.degree === p.degree)) out.push(p);
      }
      return out;
    };
    const trim = (e, parses) => {
      let ps = parses.filter((p) => p.case !== 'voc' || vocOk);
      if (governs.size && ps.some((p) => p.case && governs.has(p.case))) ps = ps.filter((p) => !p.case || governs.has(p.case));
      const table = opts.paradigm ? opts.paradigm(e) : null;
      // Whitaker's rows for a form can be thinner than the word (montēs: nominative and vocative, no
      // accusative). Where the preposition settles the case, the entry's own table has the last word:
      // it either spells the printed form in that case — and that reading replaces the rows — or it
      // cannot account for the word here at all and the entry is dropped (QA B2).
      if (directGoverns.size && NOMINAL_POS.has(e.pos) && ps.length && ps.every((p) => p.case && !directGoverns.has(p.case))) {
        ps = governedReadings(e, table);
        if (!ps.length) return [];
      }
      if (table) {
        const norm = stripMacrons(t.text).toLowerCase();
        const exact = t.text.toLowerCase();
        const verdict = ps.map((p) => { const cells = cellsFor(table, p); if (!cells.length) return 'unknown'; const forms = cells.flatMap(cellForms); if (forms.some((f) => f.toLowerCase() === exact)) return 'exact'; return forms.some((f) => stripMacrons(f).toLowerCase() === norm) ? 'loose' : 'no'; });
        const kept = verdict.filter((v) => v !== 'no');
        ps = ps.filter((p, i) => verdict[i] !== 'no');
        if (macronised && kept.includes('exact') && kept.includes('loose')) { const v2 = verdict.filter((v) => v !== 'no'); ps = ps.filter((p, i) => v2[i] !== 'loose'); }
      }
      if (NOMINAL_POS.has(e.pos) && new Set(ps.map((p) => p.case)).size > 1 && neighbours.length) {
        const shared = neighbours.flatMap(nominalReadings);
        const agree = ps.filter((p) => shared.some((q) => q.case === p.case && (!p.number || !q.number || q.number === p.number) && genderOk(q.gender, p.gender)));
        if (agree.length && agree.length < ps.length) ps = agree;
      }
      return ps;
    };
    // A word the dictionary holds as both a noun and an adjective (amīcus, Rōmānus, malum) is read as
    // the adjective only where the sentence shows the noun it agrees with: "vir amīcus" yes, "amīcus
    // meus" — whose only neighbour is itself an adjective — no. Without this an *adjective*-agreement
    // drill teaches that the subject noun of its sentence is an adjective (QA B2).
    const nounAlso = all.some((e) => e.pos === 'N' && !e.enc && trim(e, e.parses || []).length > 0);
    const nounNeighbourFor = (p) => neighbours.some((n) => (lookOf(n)?.entries || [])
      .filter((e2) => e2.pos === 'N' && !e2.enc).flatMap((e2) => e2.parses || [])
      .some((q) => q.case === p.case && (!p.number || !q.number || q.number === p.number) && genderOk(q.gender, p.gender)));
    let entry = null, parse = null, verified = false;
    const values = new Set();
    const nominalValues = new Map();   // N vs ADJ readings (Rōmānī): distinct classes when they disagree on the feature
    // A noun reading names the word better than an adjective's (Aemiliae: the name, not "Aemilian"); pronouns next.
    // A capitalised word in the sentence takes a capitalised headword first of all: Mārcō is Mārcus, not mārcēre.
    const capToken = /^[A-ZĀĒĪŌŪȲ]/.test(t.text);
    const named = (e) => (capToken && /^[A-ZĀĒĪŌŪȲ]/.test(String(e.lemma ?? '')) ? 0 : 1);
    const rank = (e) => (e.pos === 'N' ? 0 : e.pos === 'PRON' ? 1 : e.pos === 'V' || e.pos === 'VPAR' ? 2 : 3);
    for (const e of [...entries].sort((a, b) => named(a) - named(b) || rank(a) - rank(b))) {
      let ps = trim(e, e.parses || []);
      if (e.pos === 'ADJ' && nounAlso) ps = ps.filter(nounNeighbourFor);
      const table = opts.paradigm ? opts.paradigm(e) : null;
      const printed = t.text.toLowerCase();
      for (const p of ps) {
        const v = featureValue(p, key, e, skill);
        const av = ak === key ? v : featureValue(p, ak, e, skill);
        if (av) values.add(av);
        if (v && (e.pos === 'N' || e.pos === 'ADJ')) { if (!nominalValues.has(e.pos)) nominalValues.set(e.pos, new Set()); nominalValues.get(e.pos).add(v); }
        if (!entry && parseMatches(p, filter) && (!key || v)) {
          entry = e; parse = p;
          // Verified means the headword's own stem prints *this* word: the cells existing is not enough
          // (`latiō lationis f` has an ablative cell — but it spells lationē, not the book's Latiō).
          const forms = table ? cellsFor(table, p).flatMap(cellForms) : [];
          verified = forms.some((f) => String(f).toLowerCase() === printed)
            || (!macronised && forms.some((f) => stripMacrons(String(f)).toLowerCase() === stripMacrons(printed)));
        }
      }
    }
    if (!entry) continue;
    if (filter.pos == null && nominalValues.size === 2) { const [a, b] = [...nominalValues.values()]; if ([...a].some((v) => !b.has(v)) || [...b].some((v) => !a.has(v))) continue; }
    // Enclitic readings (-que) count only for an enclitic skill; glossary entries that are only endings never do.
    if (entry.pos === 'ENDING' || (filter.enc ? entry.enc !== filter.enc : !!entry.enc)) continue;
    out.push({ unit, token: t, index: wi, entry, parse, ambiguous: values.size > 1, values: [...values], ambKey: ak, value: featureValue(parse, key, entry, skill), gold: goldSpan?.[2] ?? null, verified });
  }
  return out;
}

/* ------------------------------------------------------ generator */
const shuffle = (arr, rand) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
/**
 * "Shorter sentences first", in **words** (GRAMMAR-CONTRACT.md §7.1). It used
 * to be `SHORT_LA = 180` *characters*, which 98.1 % of candidates passed — so
 * the tier was nearly inert and its "short" sentences ran to 36 words. The bar
 * is the one the learner asked for and the one the library itself keeps: five
 * to eight words (§1), the library's own median being seven.
 *
 * It is a **preference inside every other tier**, not a fallback after them: a
 * gold sentence is still drawn before an ordinary one, but the short gold
 * sentences come before the long gold ones. As a tier after gold it would
 * almost never be reached, which is the second half of why it was inert.
 */
export const SHORT_WORDS = 8;
const blankOut = (la, t) => `${la.slice(0, t.start)}___${la.slice(t.end)}`;
const meaningsOf = (la) => tokenize(la).filter((t) => t.isWord).map((t) => ({ text: t.text, form: t.form, start: t.start }));
const firstWord = (lemma) => String(lemma ?? '').split(/[\s,]/)[0];
const PARSE_WORD = { case: 'case', number: 'number', gender: 'gender', tense: 'tense', mood: 'mood', voice: 'voice', person: 'person', degree: 'degree', form: 'ending' };
const joinWords = (ws) => (ws.length <= 1 ? ws.join('') : `${ws.slice(0, -1).join(', ')} and ${ws[ws.length - 1]}`);

/**
 * Sentence sources for the "gold" items: `gold.lessonUnits` (Map skill id →
 * [unit ids] from the lessons' example blocks) and `gold.highlights` (Map unit
 * id → [{ text, label }] from the reader's grammar-focus rows).
 */
export function createItems({ units = [], lookup, paradigm = null, skills, storage = null, rand = Math.random, gold = null, poolKey = undefined, augment = null }) {
  const skillMap = skills instanceof Map ? skills : new Map((skills?.skills ?? skills ?? []).map((s) => [s.id, s]));
  // `poolKey`: a second generator over a different world of sentences keeps its own "already shown" memory —
  // Learn's written sentences (§1) are not the library, and one must not spend the other's pool.
  const pool = poolKey === undefined ? createPool(storage) : createPool(storage, poolKey);
  const cache = new Map();   // skill id → candidates
  const unitList = units.map((u) => ({ ...u, week_n: u.week_n ?? weekOf(u.id) }));

  // Per-form / per-sentence memos: the same forms recur across 4 000 sentences, so a scan is filter checks, not lookups.
  const lookMemo = new Map();
  const look = (form) => { if (!lookMemo.has(form)) lookMemo.set(form, lookup(form)); return lookMemo.get(form); };
  const tokMemo = new Map();
  const toks = (la) => { if (!tokMemo.has(la)) tokMemo.set(la, tokenize(la)); return tokMemo.get(la); };
  const stripMemo = new Map();
  const stripped = (la) => { if (!stripMemo.has(la)) stripMemo.set(la, strippedText(la)); return stripMemo.get(la); };
  const wordMemo = new Map();
  /** How many printed words a sentence has — the bar the "shorter first" tier keeps. */
  const wordCount = (la) => { if (!wordMemo.has(la)) wordMemo.set(la, toks(la).filter((t) => t.isWord).length); return wordMemo.get(la); };
  const tableMemo = new Map();
  function safeParadigm(entry, parse) { try { return paradigm ? paradigm(entry, parse ? [parse] : []) : null; } catch { return null; } }
  const plainTable = (entry) => { const k = entry?.lemma ?? ''; if (!tableMemo.has(k)) tableMemo.set(k, entry ? safeParadigm(entry, null) : null); return tableMemo.get(k); };
  const patMemo = new Map();
  const patternsOf = (skill) => { if (!patMemo.has(skill.id)) patMemo.set(skill.id, compilePatterns(skill.patterns)); return patMemo.get(skill.id); };
  const exclMemo = new Map();
  const excludesOf = (skill) => { if (!exclMemo.has(skill.id)) exclMemo.set(skill.id, compilePatterns(skill.exclude_patterns)); return exclMemo.get(skill.id); };
  const hlMemo = new Map();
  const hlRe = (skill) => { if (!hlMemo.has(skill.id)) { let re = null; try { re = skill.highlight_match ? new RegExp(skill.highlight_match.replace(/^\(\?i\)/, ''), 'i') : null; } catch { re = null; } hlMemo.set(skill.id, re); } return hlMemo.get(skill.id); };

  /** Gold spans for a unit: the whole sentence for a lesson example; the highlighted text for a matching grammar-focus row. */
  function goldSpans(unit, skill) {
    const out = [];
    if ((gold?.lessonUnits?.get?.(skill.id) || []).includes(unit.id)) out.push([0, unit.la.length, 'lesson']);
    const re = hlRe(skill);
    if (re) for (const h of gold?.highlights?.get?.(unit.id) || []) {
      if (!h?.text || !re.test(stripMacrons(String(h.label ?? '')))) continue;
      let at = unit.la.indexOf(h.text);
      if (at < 0) at = stripMacrons(unit.la).toLowerCase().indexOf(stripMacrons(h.text).toLowerCase());
      if (at >= 0) out.push([at, at + h.text.length, 'highlight']);
    }
    return out;
  }
  const scanOpts = (skill, unit) => ({ paradigm: paradigm ? plainTable : null, patterns: patternsOf(skill), gold: goldSpans(unit, skill), lookup: look, tokens: toks, stripped });
  /** A sentence a sibling construction owns (`exclude_patterns`: a result signal word before ut, a verb of commanding …) yields nothing for this skill unless it is gold. */
  const excluded = (unit, skill) => { const ex = excludesOf(skill); if (!ex.length) return false; const st = stripped(unit.la); return ex.some((re) => { re.lastIndex = 0; return re.test(st.text); }); };
  // `augment(unit, skill, found)`: a caller that knows more about a sentence than its forms say — Learn's written
  // sentences name their focus word (§1) — may add to or settle what the scan found. The library has no such hook.
  const scan = (unit, skill) => { const g = goldSpans(unit, skill); if (!g.length && excluded(unit, skill)) return augment ? augment(unit, skill, []) : []; const found = scanUnit(unit, skill, look, { ...scanOpts(skill, unit), gold: g }); return augment ? augment(unit, skill, found) : found; };

  function candidates(skillId) {
    if (!cache.has(skillId)) {
      const skill = skillMap.get(skillId);
      const out = [];
      if (skill && skill.parse_filter) for (const u of unitList) if (typeof u.la === 'string' && u.la) out.push(...scan(u, skill));
      cache.set(skillId, out);
    }
    return cache.get(skillId);
  }
  const drillable = (skillId) => { const s = skillMap.get(skillId); return !!s?.parse_filter && candidates(skillId).length > 0; };

  const key = (skill) => featureKey(skill);
  const labelOf = (k, v, skill = null) => featureLabel(k, v, { skills: skillMap, skill });
  const filterOf = (skill) => (Array.isArray(skill.parse_filter) ? skill.parse_filter[0] : (skill.parse_filter || {}));
  /** The one value a skill stands for in its feature (dative-indirect-object → 'dat'; purpose-clause → its id), or null when it names none. */
  const singleValue = (skill, k) => {
    const f = filterOf(skill);
    if (k === 'construction') return skill.id;
    if (k === 'case' || k === 'gender' || k === 'number' || k === 'degree') return typeof f[k] === 'string' ? f[k] : null;
    if (k === 'voice') return f.deponent === true ? 'dep' : (typeof f.voice === 'string' ? f.voice : null);
    if (k === 'person') return typeof f.number === 'string' && f.person != null && !Array.isArray(f.person) ? `${f.person} ${f.number}` : null;
    if (k === 'form') return typeof f.enc === 'string' ? f.enc : null;
    if (TM_KEY(k)) {
      if (typeof f.mood === 'string' && f.mood === 'imper') return `${typeof f.tense === 'string' ? f.tense : 'pres'} imper`;
      if (typeof f.tense === 'string' && typeof f.mood === 'string') return `${f.tense} ${f.mood}`;
      return typeof f.mood === 'string' && !f.tense && MOOD_ONLY_LABEL[f.mood] ? f.mood : null;
    }
    return null;
  };
  const caseOf = (skill) => { const f = filterOf(skill); return typeof f.case === 'string' ? f.case : null; };
  const constructionSkills = () => [...skillMap.values()].filter((s) => key(s) === 'construction' && s.parse_filter);
  const nonFinite = (v) => /\b(inf|ptc|imper)$/.test(String(v)) || !!MOOD_ONLY_LABEL[v];
  /** The confusable values (with the skill each names) and the fillers a recognise item can offer against `own`. */
  const distractorValues = (skill, own, c = null, { sameCaseOnly = false } = {}) => {
    const k = key(skill);
    const filter = filterOf(skill);
    const cs0 = caseOf(skill);
    const conf = (skill.confusable_with || []).map((id) => skillMap.get(id)).filter((s) => s && key(s) === k && !(sameCaseOnly && cs0 && caseOf(s) !== cs0))
      .map((s) => ({ skill: s.id, value: singleValue(s, k) }))
      .filter((d) => d.value && d.value !== own && !valueFits(d.value, filter, k));
    const seen = new Set(conf.map((x) => x.value));
    let fillers = [];
    if (k === 'construction') {
      const cs = caseOf(skill);
      const others = constructionSkills().filter((s) => s.id !== skill.id && !seen.has(s.id) && !(sameCaseOnly && cs && caseOf(s) !== cs));
      const sameCase = others.filter((s) => cs && caseOf(s) === cs);
      const sameCat = others.filter((s) => !sameCase.includes(s) && s.category === skill.category && (cs ? caseOf(s) != null : caseOf(s) == null));
      fillers = [...shuffle(sameCase, rand), ...shuffle(sameCat, rand)].map((s) => ({ skill: s.id, value: s.id }));
    } else {
      let poolValues = FILLERS[k] ?? TM_FILLERS;
      if (TM_KEY(k)) poolValues = nonFinite(own) ? [...NONFINITE_FILLERS, ...TM_FILLERS] : TM_FILLERS;
      if (k === 'voice' && c && c.entry?.pos !== 'V' && c.entry?.pos !== 'VPAR') poolValues = ['act', 'pass'];
      // A distractor normally may not be a value the skill itself stands for — answering it would be right
      // too. `form` is the exception: enclitics teaches the *contrast* between -que, -ne and -ve, so its own
      // values are the only distractors worth offering. Without this the answer -ne is left with one wrong
      // option, because -que "fits the filter", and a two-way choice is a coin toss.
      const ownValue = (v) => k !== 'form' && valueFits(v, filter, k);
      fillers = shuffle(poolValues.filter((v) => v !== own && !seen.has(v) && !ownValue(v)), rand).map((value) => ({ skill: null, value }));
    }
    return { own, conf: conf.filter((x, i) => conf.findIndex((y) => y.value === x.value) === i), fillers };
  };
  /** Choices for a recognise / parse item: the confusables first, shuffled with fillers; null when fewer than two real choices exist. */
  const choicesFor = (skill, c, k, n = 4, opts = {}) => {
    const { conf, fillers } = distractorValues(skill, c.value, c, opts);
    const options = [...shuffle(conf, rand), ...fillers].slice(0, n - 1);
    if (!options.length) return null;
    return shuffle([{ value: c.value, correct: true, skill: skill.id }, ...options.map((d) => ({ value: d.value, correct: false, skill: d.skill }))], rand)
      .map((ch) => ({ ...ch, label: labelOf(k, ch.value, skill).name, plain: labelOf(k, ch.value, skill).plain }));
  };

  const base = (skill, kind, stage, c, scope = null) => ({
    skill: skill.id, kind, stage, unit_id: c?.unit?.id ?? null, week_n: c?.unit?.week_n ?? null, scope,
    target: c ? { text: c.token.text, form: c.token.form, start: c.token.start, end: c.token.end, index: c.index } : null,
    entry: c?.entry ?? null, parse: c?.parse ?? null,
    meanings: c ? meaningsOf(c.unit.la) : [],
    gold: c?.gold ?? null,
  });
  /** How a wrong answer given another way (a tapped word, a typed case, a typed form) maps back to a confusable skill. */
  const confuseMap = (skill, c, k) => {
    const out = { values: {}, indexes: {}, forms: {} };
    const { conf } = distractorValues(skill, c?.value ?? null, c);
    for (const d of conf) if (d.skill) out.values[d.value] = d.skill;
    if (c) {
      for (const id of skill.confusable_with || []) {
        const s = skillMap.get(id);
        if (!s?.parse_filter) continue;
        for (const x of scan(c.unit, s)) if (x.index !== c.index && !out.indexes[x.index]) out.indexes[x.index] = id;
      }
      // Other cells of the target's own paradigm → the confusable skill that stands for that case / tense (a typed or chart form maps to it).
      const table = plainTable(c.entry);
      const ak = c.ambKey ?? k;
      const skillForValue = (v) => {
        if (k === 'construction') return (skill.confusable_with || []).map((id) => skillMap.get(id)).find((s) => s && key(s) === 'construction' && (ak === 'case' ? caseOf(s) === v : singleValue(s, 'tense') === v))?.id ?? null;
        return out.values[v] ?? null;
      };
      if (table && (ak === 'case' || TM_KEY(ak))) for (const sec of table.sections ?? []) for (const row of sec.rows ?? []) for (const cell of row.cells ?? []) {
        if (!cell?.key || cell.empty) continue;
        const v = cell.key.kind === 'nominal' ? cell.key.case : cell.key.kind === 'finite' ? `${cell.key.tense} ${cell.key.mood}` : null;
        const own = ak === k ? c.value : featureValue(c.parse, ak, c.entry, skill);
        const sid = v && v !== own ? skillForValue(v) : null;
        if (sid) for (const f of cellForms(cell)) out.forms[normaliseAnswer(f)] = sid;
      }
    }
    return out;
  };
  const feedbackFor = (skill, c, k) => {
    const lab = c && c.value ? labelOf(k, c.value, skill) : { name: skill.title, plain: skill.plain, full: skill.plain };
    const table = paradigm && c?.entry ? safeParadigm(c.entry, c.parse) : null;
    const readings = c?.ambiguous ? c.values.map((v) => labelOf(c.ambKey ?? k, v, skill).name).join(' or ') : null;
    const what = k === 'construction' && c?.parse?.case && c.entry.pos !== 'V' ? `${CASE_LABEL[c.parse.case]?.name ?? c.parse.case}, ${lab.name}` : lab.name;
    const parts = c
      ? (c.ambiguous
        ? [la(c.token.text), ' is the form of ', la(c.entry.lemma), ` that fits; the ending could be ${readings} — the sentence decides.`]
        : [la(c.token.text), ` is ${what} — ${lab.plain} — from `, la(c.entry.lemma), '.'])
      : [`${lab.full}.`];
    return {
      short: partsText(parts), parts,
      term: skill.plain, label: lab, table, lemma: c?.entry?.lemma ?? null, sense: c ? headSense(c.entry) : null,
      paradigm: { key: skill.paradigms?.[0] ?? null, highlight: Array.isArray(skill.parse_filter) ? null : skill.parse_filter },
    };
  };

  const pickCandidate = (skill, kind, { unambiguous, currentWeek, currentWeekN, chapter = null, chapterMode = 'own-first', where = null, itemKey = null, unit = null, focus = null, maxWords = null, exclude = null }) => {
    let pool_ = candidates(skill.id);
    if (where) pool_ = pool_.filter(where);
    // A1's short tier: sentences of at most `maxWords` words, or nothing — the caller then widens the draw itself.
    if (maxWords != null) pool_ = pool_.filter((c) => wordCount(c.unit.la) <= maxWords);
    // A teaching step names its own written sentence, and the sentence names its focus word
    // (GRAMMAR-CONTRACT.md §1 and §8): the pool is that one candidate, so the check is on the idea the
    // step just taught. A focus the scanner did not reach falls back to the sentence's other candidates
    // rather than to another sentence — a step never quietly teaches a different example.
    if (unit != null) {
      const inUnit = pool_.filter((c) => c.unit.id === unit);
      if (!inUnit.length) return null;
      // `focus` may name two words; a candidate counts when it sits anywhere in that span.
      const parts = focus ? String(focus).trim().split(/\s+/).filter(Boolean) : [];
      const onFocus = !focus ? []
        : parts.length === 1 ? inUnit.filter((c) => matchesForm(c.token.text, [focus]))
        : inUnit.filter((c) => spanIndexes(c.unit.la, parts).includes(c.index));
      pool_ = onFocus.length ? onFocus : inUnit;
    }
    if (unambiguous) pool_ = pool_.filter((c) => !c.ambiguous);
    else { const clear = pool_.filter((c) => !c.ambiguous); if (clear.length >= 5) pool_ = clear; }   // blank: forms the sentence reads one way, while there are enough
    if (!pool_.length) return null;
    // A chapter scopes the draw before anything else orders it: its own sentences, else the chapters at or
    // before it, else the wider library with the item saying so (chapter.js "the sentence's chapter"). A redo
    // names one exact item, and that item is what it is — the scope would only make it undrawable.
    const scoped = itemKey != null ? { list: pool_, scope: null, counts: null } : scopeByChapter(pool_, chapter, undefined, { mode: chapterMode });
    pool_ = scoped.list;
    const keyOf = (c) => `${kind}:${c.unit.id}:${c.token.form}:${c.index}`;
    // Items already shown in this sitting (A1: nothing repeats until the pool is spent) — when every candidate
    // has been, the draw is empty and the caller decides whether a repeat is allowed now.
    if (exclude?.size) { pool_ = pool_.filter((c) => !exclude.has(keyOf(c)) && !exclude.has(keyOf(c).replace(/^recognise:/, 'recognise-tap:'))); if (!pool_.length) return null; }
    const keys = pool_.map(keyOf);
    // Shorter sentences first: a drill reads one sentence, not a paragraph. It is a preference *inside*
    // each tier below (`nest`), so the lesson's own short example still comes before its long one, and
    // the long ones come only once the short ones are spent.
    const short = new Set(pool_.filter((c) => wordCount(c.unit.la) <= SHORT_WORDS).map(keyOf));
    const nest = (t) => { const s = new Set([...t].filter((k) => short.has(k))); return s.size && s.size < t.size ? [s, t] : [t]; };
    const tiers = [];
    tiers.push(...nest(new Set(pool_.filter((c) => c.gold).map(keyOf))));   // the lesson's own examples and the labelled highlights first
    // The ≈ 20 % current-week slots draw from a course week only (n ≤ 14): a shelf chapter being read is never 'this week'.
    if (currentWeek && currentWeekN != null && !isShelfWeek(currentWeekN)) tiers.push(...nest(new Set(pool_.filter((c) => c.unit.week_n === currentWeekN).map(keyOf))));
    // A function skill drills nouns before pronouns (mihi / tibi teach little about the receiver of a gift), while enough nouns exist.
    if (key(skill) === 'construction' && caseOf(skill)) { const nouns = pool_.filter((c) => c.entry.pos === 'N'); if (nouns.length >= 5) tiers.push(...nest(new Set(nouns.map(keyOf)))); }
    tiers.push(short);
    const got = pool.chooseInfo(skill.id, kind, keys, rand, tiers.filter((t) => t.size), itemKey);
    if (!got) return null;
    const c = pool_[keys.indexOf(got.key)];
    return { c, key: got.key, wrapped: got.wrapped, scope: scopeNote(chapter, scoped.scope, c) };
  };

  // The word the question asks about is Latin and the rest of the line is English, so the two are kept
  // apart: the pointer opens the dictionary on the word and nowhere else.
  const recogniseQuestion = (skill, c, k) => {
    const X = la(c.token.text);
    if (k === 'construction') {
      if (c.parse?.case && (c.entry.pos === 'N' || c.entry.pos === 'PRON' || c.entry.pos === 'ADJ')) return [`What is this ${CASE_LABEL[c.parse.case]?.name ?? c.parse.case} (`, X, ') doing here?'];
      if (c.parse?.mood === 'subj') return [X, ' is subjunctive: what kind of clause is it in?'];
      return ['What is ', X, ' doing here?'];
    }
    const tail = { case: ' here?', gender: '?', number: ' here?', voice: ' here?', person: '?', degree: '?' }[k];
    const lead = { case: 'Which case is ', gender: 'Which gender is ', number: 'Which number is ', voice: 'Which voice is ', person: 'Which person and number is ', degree: 'Which degree is ' }[k];
    if (lead) return [lead, X, tail];
    if (k === 'form') return skill.id === 'principal-parts' ? ['Which stem is ', X, ' built on?'] : ['What does the ending of ', X, ' do here?'];
    return ['Which tense and mood is ', X, ' here?'];
  };

  function recognise(skill, stage, opts) {
    const k = key(skill);
    if (!k) return null;
    // A redo asks for one exact item back, and a recognise item has two shapes over one candidate: the
    // `recognise-tap:` key is the tap-the-word variant, the plain `recognise:` key the multiple choice.
    // The prefix therefore settles `tap` as well as the candidate, so the item comes back as it was.
    const wantTap = opts.itemKey == null ? null : /^recognise-tap:/.test(String(opts.itemKey));
    const got = pickCandidate(skill, 'recognise', { unambiguous: true, ...opts, itemKey: opts.itemKey == null ? null : String(opts.itemKey).replace(/^recognise-tap:/, 'recognise:') });
    if (!got) return null;
    const { c, key: itemKey, wrapped, scope } = got;
    // "What is this dative doing?" offers the dative's other jobs; a construction without a case offers the other clause types.
    const choices = choicesFor(skill, c, k, 4, { sameCaseOnly: k === 'construction' }) ?? choicesFor(skill, c, k);
    if (!choices || choices.length < 2) return null;   // one button is no question
    const lab = labelOf(k, c.value, skill);
    const confuse = confuseMap(skill, c, k);
    // Every other recognise item is "tap the word": the sentence's words are the
    // choices, and any word the skill's filter fits is right (accept = word indexes).
    if (wantTap ?? (opts.tap ?? rand() < 0.5)) {
      const accept = candidates(skill.id).filter((x) => x.unit.id === c.unit.id && x.value === c.value && !x.ambiguous).map((x) => x.index);
      return { ...base(skill, 'recognise', stage, c, scope), key: itemKey.replace(/^recognise:/, 'recognise-tap:'), input: 'tap', repeat: wrapped,
        prompt: { la: c.unit.la, question: `Tap the word that is ${lab.name} — ${lab.plain}`, gloss: null, hint: skill.summary },
        answer: [c.token.text], accept: accept.length ? accept : [c.index], choices: null, confuse, feedback: feedbackFor(skill, c, k) };
    }
    return { ...base(skill, 'recognise', stage, c, scope), key: itemKey, input: 'choice', repeat: wrapped,
      prompt: { la: c.unit.la, ...q(recogniseQuestion(skill, c, k)), gloss: lemmaGloss(c.entry), hint: skill.summary },
      answer: [c.value], choices, confuse, feedback: feedbackFor(skill, c, k) };
  }

  /** What a typed parse must name, per feature: exactly what the question asks. */
  const parseExpect = (skill, c) => {
    const p = c.parse;
    const k = key(skill);
    const dep = isDeponent(c.entry);
    const nominal = { case: p.case, number: p.number, gender: p.gender };
    if (k === 'case' || k === 'number') return { values: nominal, required: p.number ? ['case', 'number'] : ['case'] };
    if (k === 'gender') return { values: nominal, required: p.number ? ['gender', 'case', 'number'] : ['gender', 'case'] };
    if (k === 'degree') return { values: { degree: p.degree || 'pos', case: p.case, number: p.number, gender: p.gender }, required: p.case ? ['degree', 'case', 'number'] : ['degree'] };
    if (p.mood === 'ptc' || p.mood === 'gerundive') return { values: { tense: p.tense, mood: p.mood, voice: dep ? undefined : p.voice, case: p.case, number: p.number, gender: p.gender }, required: [...(p.tense ? ['tense'] : []), ...(p.voice && !dep ? ['voice'] : []), 'case', ...(p.number ? ['number'] : []), ...(p.gender ? ['gender'] : [])] };
    if (p.mood === 'gerund' || p.mood === 'supine') return { values: { mood: p.mood, case: p.case }, required: ['mood', ...(p.case ? ['case'] : [])] };
    if (p.mood === 'inf') return { values: { tense: p.tense, mood: p.mood, voice: dep ? undefined : p.voice }, required: ['tense', 'mood', ...(p.voice && !dep ? ['voice'] : [])] };
    const finite = { tense: p.tense, mood: p.mood, person: p.person != null ? String(p.person) : undefined, number: p.number, voice: dep ? undefined : p.voice };
    // An enclitic is not a verb: it has no tense and no mood, and asking for them produced the answer
    // "undefined undefined" on every parse item of the enclitics skill. What is asked is which ending it is.
    if (k === 'form') return { values: { form: featureValue(p, 'form', c.entry) }, required: ['form'] };
    if (k === 'person') return { values: finite, required: ['person', 'number'] };
    if (k === 'voice') return { values: finite, required: dep ? ['tense', 'mood'] : ['voice', 'tense', 'mood'] };
    if (p.mood === 'imper') return { values: finite, required: ['mood', ...(p.number ? ['number'] : [])] };
    return { values: finite, required: ['tense', 'mood'] };
  };
  const parseName = (skill, p, entry = null) => {
    const k = key(skill);
    const cn = (x) => `${CASE_LABEL[x.case]?.name ?? x.case}${x.number ? ` ${NUMBER_LABEL[x.number]?.name ?? x.number}` : ''}`;
    if (k === 'gender') return `${GENDER_LABEL[p.gender]?.name ?? p.gender ?? ''}${p.case ? `, ${cn(p)}` : ''}`.trim();
    if (k === 'form') { const v = p.enc ?? featureValue(p, 'form', entry); return FORM_LABEL[v]?.name ?? v ?? ''; }
    if (k === 'case' || k === 'number') return cn(p);
    if (k === 'degree') return `${DEGREE_LABEL[p.degree || 'pos']?.name ?? p.degree}${p.case ? `, ${cn(p)}` : ''}`.trim();
    if (p.mood === 'ptc' || p.mood === 'gerundive') return `${labelOf('tense', featureValue(p, 'tense'), skill).name}${p.voice && !isDeponent(entry) ? ` ${VOICE_LABEL[p.voice]?.name ?? p.voice}` : ''}${p.case ? `, ${cn(p)}${p.gender ? ` ${GENDER_LABEL[p.gender]?.name ?? ''}` : ''}` : ''}`.trim();
    if (p.mood === 'gerund' || p.mood === 'supine') return `${p.mood}${p.case ? `, ${CASE_LABEL[p.case]?.name ?? p.case}` : ''}`;
    if (p.mood === 'inf') return `${TENSE_LABEL[p.tense] ?? p.tense} infinitive${p.voice && !isDeponent(entry) ? ` ${VOICE_LABEL[p.voice]?.name}` : ''}`;
    if (p.mood === 'imper') return `imperative${p.number ? ` ${NUMBER_LABEL[p.number]?.name}` : ''}`;
    const who = p.person ? `, ${PERSON_WORD[p.person]} ${NUMBER_LABEL[p.number]?.name ?? ''}` : '';
    if (k === 'person') return `${PERSON_WORD[p.person] ?? p.person} ${NUMBER_LABEL[p.number]?.name ?? p.number ?? ''}`.trim();
    if (k === 'voice') return `${isDeponent(entry) ? 'deponent' : VOICE_LABEL[p.voice]?.name ?? ''} ${TENSE_LABEL[p.tense] ?? p.tense} ${MOOD_LABEL[p.mood] ?? p.mood}${who}`.trim();
    return `${TENSE_LABEL[p.tense] ?? p.tense} ${MOOD_LABEL[p.mood] ?? p.mood}${who}`.trim();
  };
  const parseQuestion = (skill, c, expect) => {
    const p = c.parse;
    if (expect.required.length === 1 && expect.required[0] === 'form') return `What does the ending of ${c.token.text} do here?`;
    const req = expect.required.map((r) => PARSE_WORD[r]).filter(Boolean);
    const tail = p.mood === 'ptc' ? ' (it is a participle)' : p.mood === 'gerundive' ? ' (it is a gerundive)' : '';
    return ['Parse ', la(c.token.text), `: ${joinWords(req)}${tail}`];
  };
  const parsePlaceholder = (expect) => {
    const r = expect.required;
    if (r.includes('form')) return 'e.g. -que: and';
    if (r.includes('degree')) return 'e.g. comparative, nominative singular';
    if (r.includes('gender') && r.includes('tense')) return 'e.g. perfect passive, accusative singular feminine';
    if (r.includes('gender')) return 'e.g. feminine, nominative singular';
    if (r.includes('person')) return 'e.g. 1st person plural';
    if (r.includes('voice')) return 'e.g. passive, present indicative';
    if (r[0] === 'mood') return 'e.g. gerund, accusative';
    if (r.includes('tense')) return 'e.g. imperfect subjunctive';
    return 'e.g. dative singular';
  };
  const functionKeys = (s) => { const f = s?.function || s?.title || s?.id || ''; const head = f.split(' (')[0]; return [...new Set([head, ...(s?.function_keys || [])].map((x) => normaliseAnswer(x)).filter(Boolean))]; };

  function parseItem(skill, stage, opts) {
    const k = key(skill);
    if (!k) return null;
    const got = pickCandidate(skill, 'parse', { unambiguous: true, ...opts });
    if (!got) return null;
    const { c, key: itemKey, wrapped, scope } = got;
    const confuse = confuseMap(skill, c, k);
    if (k === 'construction') {
      // A construction is parsed by its job: "indirect object", "purpose" — choices at stage 1, typed from stage 2.
      const choices = choicesFor(skill, c, k);
      if (!choices || choices.length < 2) return null;
      const caseName = c.parse?.case && c.entry.pos !== 'V' ? CASE_LABEL[c.parse.case]?.name ?? c.parse.case : null;
      const withCase = (ch) => ({ ...ch, label: caseName ? `${CASE_LABEL[caseOf(skillMap.get(ch.value)) ?? c.parse.case]?.name ?? caseName} — ${ch.label}` : ch.label });
      const reject = {};
      for (const ch of choices) if (!ch.correct && ch.skill) for (const kw of functionKeys(skillMap.get(ch.skill))) reject[kw] = ch.skill;
      const expect = { kind: 'function', accept: functionKeys(skill), reject };
      const item = { ...base(skill, 'parse', stage, c, scope), key: itemKey, input: stage >= 2 ? 'type' : 'choice', repeat: wrapped,
        prompt: { la: c.unit.la, ...q(caseName ? (stage >= 2 ? [la(c.token.text), ` is ${caseName}: what is it doing here? (its function)`] : [la(c.token.text), ': which case, and what is it doing here?']) : ['What is ', la(c.token.text), ' doing here? (the construction)']), gloss: lemmaGloss(c.entry), hint: skill.summary, placeholder: 'e.g. indirect object' },
        answer: [labelOf(k, c.value, skill).name], expect, choices: null, confuse, feedback: feedbackFor(skill, c, k) };
      if (item.input === 'choice') { item.choices = choices.map(withCase); item.answer = [c.value]; }
      return item;
    }
    const expect = parseExpect(skill, c);
    const canonical = parseName(skill, c.parse, c.entry);
    const item = { ...base(skill, 'parse', stage, c, scope), key: itemKey, input: stage >= 2 ? 'type' : 'choice', repeat: wrapped,
      prompt: { la: c.unit.la, ...q(parseQuestion(skill, c, expect)), gloss: lemmaGloss(c.entry), hint: skill.summary, placeholder: parsePlaceholder(expect) },
      answer: [canonical], expect, expectKey: k, choices: null, confuse, feedback: feedbackFor(skill, c, k) };
    if (item.input === 'choice') {
      const { conf, fillers } = distractorValues(skill, c.value, c);
      const others = [...shuffle(conf, rand), ...fillers].slice(0, 2);
      const p = c.parse;
      const alt = p.number ? { ...p, number: p.number === 'sg' ? 'pl' : 'sg' } : null;
      const withValue = (d) => {
        if (k === 'case') return { ...p, case: d.value };
        if (k === 'degree') return { ...p, degree: d.value };
        if (k === 'gender') return { ...p, gender: d.value };
        if (k === 'number') return { ...p, number: d.value };
        if (k === 'voice') return { ...p, voice: d.value === 'dep' ? 'pass' : d.value };
        if (k === 'person') { const [pe, nu] = d.value.split(' '); return { ...p, person: pe, number: nu }; }
        if (k === 'form') return { ...p, enc: d.value };
        const [t, m] = d.value.split(' ');
        return m ? { ...p, tense: t, mood: m } : { ...p, mood: t, tense: undefined };
      };
      const entryFor = (d) => (k === 'voice' && d.value === 'dep' ? { ...c.entry, kind: 'dep' } : (k === 'voice' ? { ...c.entry, kind: null } : c.entry));
      const opts_ = [
        { value: canonical, correct: true, skill: skill.id },
        ...(alt ? [{ value: parseName(skill, alt, c.entry), correct: false, skill: null }] : []),
        ...others.map((d) => ({ value: parseName(skill, withValue(d), entryFor(d)), correct: false, skill: d.skill })),
      ];
      const seen = new Set();
      item.choices = shuffle(opts_.filter((o) => o.value && !seen.has(o.value) && seen.add(o.value)), rand).map((o) => ({ ...o, label: o.value }));
      if (item.choices.length < 2) return null;
      item.answer = [canonical];
    }
    return item;
  }

  function blank(skill, stage, opts) {
    const k = key(skill);
    // The item prints the dictionary line ("the right form of soror") and hides the inflected one, so
    // nothing it shows may spell the form it wants back (QA-FINAL B1). Three ways it could, all of
    // them out: the word *is* its own dictionary form (soror); the line carries it anyway, in the
    // citation (sequor, sequī, *secūtus* sum) or in the meaning (nox noctis f — night; prīmā
    // *nocte*…); or the sentence prints the same word a second time, outside the blank.
    const noGiveaway = (c) => {
      const as = [c.token.text, stripMacrons(c.token.text)];
      return !spellsAnswer(lemmaGloss(c.entry), as) && !spellsAnswer(blankOut(c.unit.la, c.token), as);
    };
    const got = pickCandidate(skill, 'blank', { unambiguous: false, ...opts, where: noGiveaway });
    if (!got) return null;
    const { c, key: itemKey, wrapped, scope } = got;
    const answer = [c.token.text, stripMacrons(c.token.text)];
    const lab = c.value ? labelOf(k, c.value, skill) : { name: skill.title, plain: skill.plain };
    const item = { ...base(skill, 'blank', stage, c, scope), key: itemKey, input: stage >= 2 ? 'type' : 'choice', repeat: wrapped,
      prompt: { la: blankOut(c.unit.la, c.token), ...q(['Fill the blank with the right form of ', la(firstWord(c.entry.lemma))]), gloss: lemmaGloss(c.entry), hint: `${lab.name} — ${lab.plain}` },
      answer, choices: null, confuse: confuseMap(skill, c, k), feedback: feedbackFor(skill, c, k) };
    if (item.input === 'choice') {
      const table = plainTable(c.entry);
      const forms = new Set();
      for (const s of table?.sections ?? []) for (const r of s.rows) for (const cell of r.cells) if (cell && !cell.empty && cell.text && cell.text !== '—') forms.add(cell.text.split(' / ')[0]);
      const norm = normaliseAnswer(c.token.text);
      const others = shuffle([...forms].filter((f) => normaliseAnswer(f) !== norm), rand).slice(0, 3);
      if (!others.length) return null;
      // The four options must not differ in anything but the ending. The right one is taken from the sentence,
      // where a sentence-initial word is capitalised (*Mīlite canente…*), while the distractors come from the
      // paradigm, which prints them lower case — so the capital alone answered the item (QA M-4). Every option
      // is shaped like the answer: capital when the blank opens the sentence, lower case otherwise. Grading is
      // unaffected — `normaliseAnswer` folds case before anything is compared.
      const shape = matchCapital(c.token.text);
      item.choices = shuffle([{ value: c.token.text, correct: true }, ...others.map((f) => ({ value: shape(f), correct: false }))], rand).map((o) => ({ ...o, label: o.value, skill: null }));
    }
    return item;
  }

  /** True when a paradigm cell is one the skill drills (nominal, finite and the non-finite tables alike). */
  const cellMatches = (cell, filter, k) => {
    const kk = cell?.key;
    if (!kk || cell.empty || !filter) return false;
    const tm = TM_KEY(k) || k === 'voice' || k === 'person';
    if (kk.kind === 'nominal') {
      if (tm || kk.mood) return false;   // participle cells inside a verb table are not the verb's finite forms
      if (filter.case == null && filter.gender == null && filter.degree == null && filter.number == null && !(filter.pos === 'N' || filter.pos === 'ADJ' || filter.pos === 'PRON' || filter.h || filter.decl)) return false;
      if (filter.case == null && kk.case === 'voc') return false;   // a declension skill drills the cases in use, not the address form
      return valueIn(kk.case, filter.case) && valueIn(kk.number, filter.number) && (filter.degree == null || valueIn(kk.degree ?? 'pos', filter.degree)) && (filter.gender == null || !kk.gender || valueIn(kk.gender, filter.gender));
    }
    if (!tm && k !== 'construction') return false;
    if (kk.kind === 'finite') return (filter.mood == null || valueIn('ind', filter.mood) || valueIn('subj', filter.mood)) && valueIn(kk.tense, filter.tense) && valueIn(kk.mood, filter.mood) && valueIn(kk.voice, filter.voice) && valueIn(kk.person, filter.person);
    if (kk.kind === 'inf') return filter.mood != null && valueIn('inf', filter.mood) && valueIn(kk.tense, filter.tense) && valueIn(kk.voice, filter.voice);
    if (kk.kind === 'imper') return filter.mood != null && valueIn('imper', filter.mood) && valueIn(kk.tense, filter.tense) && valueIn(kk.voice, filter.voice) && valueIn(kk.number, filter.number);
    if (kk.kind === 'ptc') return filter.mood != null && valueIn('ptc', filter.mood) && valueIn(kk.tense, filter.tense) && valueIn(kk.voice, filter.voice);
    if (kk.kind === 'gerundive' || kk.kind === 'gerund' || kk.kind === 'supine') return filter.mood != null && valueIn(kk.kind, filter.mood) && (kk.case == null || valueIn(kk.case, filter.case));
    return false;
  };
  function chart(skill, stage, opts, { full = false } = {}) {
    if (!paradigm) return null;
    const k = key(skill);
    const filter = filterOf(skill);
    // The lemmas the skill's sentences use, one paradigm each; the pool is keyed by lemma + cell.
    // A chart has no sentence, but its word came from one, so the chapter scopes which words it may ask about.
    const scoped = opts.itemKey != null ? { list: candidates(skill.id), scope: null } : scopeByChapter(candidates(skill.id), opts.chapter ?? null, undefined, { mode: opts.chapterMode ?? 'own-first' });
    const seen = new Map();
    for (const c of scoped.list) if (!seen.has(c.entry.h)) seen.set(c.entry.h, c);
    const entries = [...seen.values()];
    if (!entries.length) return null;
    let keys = [];
    let spots = [];
    for (const c of entries) {
      const table = plainTable(c.entry);
      if (!table) continue;
      table.sections.forEach((s, si) => s.rows.forEach((r, ri) => r.cells.forEach((cell, ci) => {
        // A case skill drills the positive section of an adjective table; only a degree skill asks for the comparative or superlative.
        if (k !== 'degree' && table.sections.length > 1 && s.rows[0]?.cells[0]?.key?.kind === 'nominal' && (s.rows[0].cells[0].key.degree ?? 'pos') !== 'pos') return;
        if (cellMatches(cell, filter, k)) { keys.push(`chart:${c.entry.h}:${si}.${ri}.${ci}`); spots.push({ c, table, si, ri, ci }); }
      })));
    }
    if (!keys.length) return null;
    // The citation head is itself a cell of the table (cēna is the nominative singular of cēna;
    // possum is the first person of possum), and the question names the head: "Give the nominative
    // singular of cēna" answers itself — and so, in its own way, does "the present indicative, he /
    // she / it of eō", whose answer is *it*. Cells the question's own words spell are left out of the
    // pool, unless they are all the skill has: then a self-answering chart beats no chart at all.
    const answersOf = (sp) => { const cell = sp.table.sections[sp.si].rows[sp.ri].cells[sp.ci]; return [cell?.text, cell?.alt, ...String(cell?.text ?? '').split(' / ')].filter(Boolean); };
    const shownOf = (sp) => { const sec = sp.table.sections[sp.si]; return `${firstWord(sp.c.entry.lemma)} ${sec.title ?? ''} ${sec.rows[sp.ri].label ?? ''} ${sec.headers?.[sp.ci] ?? ''}`; };
    const open = spots.map((sp, i) => i).filter((i) => !spellsAnswer(shownOf(spots[i]), answersOf(spots[i])));
    if (open.length) { keys = open.map((i) => keys[i]); spots = open.map((i) => spots[i]); }
    if (opts.exclude?.size) { const keep = keys.map((k, i) => i).filter((i) => !opts.exclude.has(keys[i])); if (!keep.length) return null; keys = keep.map((i) => keys[i]); spots = keep.map((i) => spots[i]); }
    const got = pool.chooseInfo(skill.id, 'chart', keys, rand, [], opts.itemKey ?? null);
    if (!got) return null;   // a redo whose cell the table no longer has: dropped, never swapped for another cell
    const spot = spots[keys.indexOf(got.key)];
    const { c, table, si, ri, ci } = spot;
    const section = table.sections[si];
    const cellAnswers = (cell) => [cell.text, ...(cell.alt ? [cell.alt] : []), ...String(cell.text).split(' / ')].filter(Boolean);
    const target = section.rows[ri].cells[ci];
    const colLabel = section.headers?.[ci] ?? '';
    const kind = target.key?.kind;
    const finite = kind === 'finite';
    const nominal = kind === 'nominal';
    // "comparative" / "superlative" is named on an adjective table (G1-03); the positive section needs no label unless the skill is about degree.
    let degreeTitle = nominal && table.sections.length > 1 && section.title ? section.title.replace(/\s*\(.*\)\s*$/, '') : '';
    if (k !== 'degree' && /^positive/i.test(degreeTitle)) degreeTitle = '';
    const genderCols = nominal && (section.headers?.length ?? 0) >= 3;
    // "dative singular" for a noun; "dative sg. masculine, superlative" on an adjective; "imperfect subjunctive, we (passive)" for a verb — the tense and mood are the point.
    const cellLabel = (r, cj = ci) => {
      const col = cj >= 0 ? (section.headers?.[cj] ?? '') : '';
      if (finite) return `${section.title}, ${r.label}${col ? ` (${col})` : ''}`;
      if (nominal) return `${degreeTitle ? `${degreeTitle}, ` : ''}${r.label}${col ? ` ${col}` : ''}`;
      return `${section.title ? `${section.title}: ` : ''}${r.label}${col ? ` (${col})` : ''}`;
    };
    let cells;
    if (full && genderCols && k === 'case') {
      // A case skill on an adjective table fills the case's row across the genders, not a whole gender column (G1-22).
      cells = section.rows[ri].cells.map((cell, cj) => ({ row: ri, col: cj, label: cellLabel(section.rows[ri], cj), answer: cellAnswers(cell), empty: !!cell?.empty })).filter((x) => !x.empty);
    } else if (full) {
      cells = section.rows.map((r, rj) => ({ row: rj, col: ci, label: cellLabel(r), answer: cellAnswers(r.cells[ci]), empty: !!r.cells[ci]?.empty })).filter((x) => !x.empty);
    } else cells = [{ row: ri, col: ci, label: cellLabel(section.rows[ri]), answer: cellAnswers(target) }];
    const cellKey = target.key;
    const lab = nominal && k === 'degree' ? labelOf('degree', cellKey.degree ?? 'pos') : nominal ? labelOf('case', cellKey.case) : finite ? labelOf('tense', `${cellKey.tense} ${cellKey.mood}`)
      : kind === 'inf' || kind === 'ptc' || kind === 'imper' ? labelOf('tense', `${cellKey.tense} ${kind}`) : kind ? labelOf('tense', kind) : { name: skill.title, plain: skill.plain, full: skill.plain };
    const lemma = c.entry.lemma;
    const head = firstWord(lemma);
    // A noun's citation prints its genitive and a verb's its principal parts, and a meaning sometimes
    // quotes a phrase (nox noctis f — night; prīmā *nocte*…), so the dictionary line can be the answer
    // key for the very cell being asked (femina *fēminae* f → "give the genitive singular of femina").
    // The line then gives up as much as it must: the citation, then the meaning (QA-FINAL B1).
    const asked = cells.flatMap((x) => x.answer || []);
    const chartGloss = [lemmaGloss(c.entry), headGloss(c.entry), head].find((g) => !spellsAnswer(g, asked)) ?? head;
    const fullQuestion = full && genderCols && k === 'case' ? [`Fill in the ${cellLabel(section.rows[ri], -1)} of `, la(head), ' in every gender']
      : full ? [`Fill in the ${finite ? `${section.title}${colLabel ? ` (${colLabel})` : ''}` : (degreeTitle ? `${degreeTitle} ` : '') + (colLabel || section.title)} of `, la(head)] : null;
    return { ...base(skill, 'chart', stage, null, scopeNote(opts.chapter ?? null, scoped.scope, c)), key: got.key, input: 'chart', entry: c.entry, lemma, repeat: got.wrapped,
      prompt: { la: null, ...q(full ? fullQuestion : [`Give the ${cellLabel(section.rows[ri])} of `, la(head)]), gloss: chartGloss, hint: `${lab.name} — ${lab.plain}` },
      answer: cellAnswers(target),
      chart: { table, section: si, col: ci, target: { row: ri, col: ci }, cells, full, head },
      meanings: [], confuse: { values: {}, indexes: {}, forms: {} },
      feedback: (() => { const parts = [la(target.text), ` is the ${cellLabel(section.rows[ri])} of `, la(lemma), ` — ${lab.plain}.`];
        return { ...feedbackFor(skill, null, k), short: partsText(parts), parts, table, lemma, sense: headSense(c.entry) }; })() };
  }

  const FNS = { recognise, parse: parseItem, blank, chart: (s, st, o, x) => chart(s, st, o, x) };
  /**
   * An item for a session slot. When the asked kind cannot be built the other
   * kinds are tried — those not in `avoid` (the neighbours' kinds) first — and
   * the item that comes back says which kind it is.
   */
  function generate({ skill: skillId, kind, stage = 1, currentWeek = false, currentWeekN = null, chapter = null, chapterMode = 'own-first', full = false, tap = undefined, avoid = [], itemKey = null, unit = null, focus = null, maxWords = null, exclude = null } = {}) {
    const skill = typeof skillId === 'string' ? skillMap.get(skillId) : skillId;
    if (!skill || !skill.parse_filter) return null;
    const opts = { currentWeek, currentWeekN, chapter, chapterMode, tap, itemKey, unit, focus, maxWords, exclude };
    const fn = FNS[kind];
    if (!fn) return null;
    // A redo asks for one named item (GRAMMAR-CONTRACT.md "Redo what was wrong"). Neither of the two
    // fallbacks below may run for it: a different sentence, or a different kind, would be a different
    // item wearing the same name. Nothing to rebuild → null, and the session drops the slot quietly.
    if (itemKey != null) return fn(skill, stage, opts, { full });
    let item = fn(skill, stage, opts, { full });
    // `unit` / `focus` ride through every fallback: a step's sentence is the step's sentence whatever kind
    // ends up being built on it, and a chart has no sentence at all, so it is not a fallback for one.
    if (!item && currentWeek) item = fn(skill, stage, { currentWeek: false, currentWeekN: null, chapter, chapterMode, tap, unit, focus, maxWords, exclude }, { full });
    if (!item) { // fall back through the other kinds so a session slot is never empty — the neighbours' kinds last
      const allowed = skill.kinds?.length ? skill.kinds : ['recognise', 'chart', 'parse', 'blank'];
      let order = ['blank', 'recognise', 'parse', 'chart'].filter((a) => a !== kind && allowed.includes(a));
      if (unit != null) order = order.filter((a) => a !== 'chart');
      // A word cap is a tier, not a rule about the skill: a slot that found no short sentence of its own kind
      // asks the other kinds for a short one too, and a chart (no sentence) is left to the caller's wider draw.
      if (maxWords != null) order = order.filter((a) => a !== 'chart');
      for (const alt of [...order.filter((a) => !avoid.includes(a)), ...order.filter((a) => avoid.includes(a))]) { item = FNS[alt](skill, stage, { currentWeek: false, currentWeekN: null, chapter, chapterMode, tap, unit, focus, maxWords, exclude }, { full }); if (item) break; }
    }
    return item;
  }

  return { generate, candidates, drillable, pool, skills: skillMap, scan, meaningsOf };
}

/** Whether a cell id (§4a: its slots in fixed order) carries every value a skill's `paradigm_focus` names. Pure. */
export function focusFitsId(id, focus) {
  if (!id || !focus || typeof focus !== 'object') return false;
  const slots = new Set(String(id).split('.'));
  return Object.values(focus).every((v) => v == null || (Array.isArray(v) ? v : [v]).some((x) => slots.has(String(x))));
}

/* ============================================ tables, words and cells (shared) */
/**
 * What a teaching step, the blocked ten and the catalogue all need of a word:
 * its glossary entry, the paradigm it renders (memoised), that table's cells
 * by id, and a cell's label as the chart drills name it.
 */
export function tableHelpers({ lookup, paradigm = null }) {
  const safeTable = (entry) => { try { return paradigm ? paradigm(entry, []) : null; } catch { return null; } };
  const tableMemo = new Map();
  const tableOfEntry = (e) => { const k = `${e?.h}|${e?.lemma}`; if (!tableMemo.has(k)) tableMemo.set(k, safeTable(e)); return tableMemo.get(k); };
  /**
   * A stock or named headword (`'puella'`, or `{ h, key, i, pos }`) as a
   * glossary entry that really renders a table.
   *
   * `fits(got)` is the caller's own test of whether *this* reading of the word
   * is the one it meant — a chart asks whether the table can answer the cells
   * the step named. Headwords are not unique: the glossary has both a noun and
   * an adjective under *mare*, the adjective comes first, its cells carry
   * gender, and a step that named *mare* and asked for `nom.pl` silently got a
   * table with no such cell and built itself on the other word instead (N-15).
   * The first reading that renders a table **and** fits wins; if none fits, the
   * first that renders a table at all is returned, exactly as before, so a
   * caller with no test loses nothing.
   */
  function entryFor(word, { fits = null } = {}) {
    const w = typeof word === 'string' ? { h: word, key: word } : (word ?? {});
    const forms = [w.key, w.h, w.lemma ? String(w.lemma).split(/[\s,]/)[0] : null].filter(Boolean);
    let loose = null;
    for (const f of forms) {
      const entries = lookup(f)?.entries ?? [];
      const ranked = [
        ...entries.filter((e) => e.h === w.h && (!w.pos || e.pos === w.pos)),
        ...(Number.isInteger(w.i) && entries[w.i] ? [entries[w.i]] : []),
        ...entries,
      ];
      for (const e of ranked) {
        const t = tableOfEntry(e);
        if (!t) continue;
        const got = { entry: e, table: t, cells: tableCells(t) };
        if (!fits || fits(got)) return got;
        loose = loose ?? got;
      }
    }
    return loose;
  }
  /** "dative singular" / "imperfect subjunctive, we (passive)" — the cell named as the chart drills name it. */
  function cellLabelOf(spot, table) {
    const nominal = spot.cell.key?.kind === 'nominal';
    const title = nominal && (table?.sections?.length ?? 0) > 1 && spot.sectionTitle ? spot.sectionTitle.replace(/\s*\(.*\)\s*$/, '') : '';
    const deg = /^positive/i.test(title) ? '' : title;
    if (nominal) return `${deg ? `${deg}, ` : ''}${spot.rowLabel}${spot.colLabel ? ` ${spot.colLabel}` : ''}`.trim();
    return `${spot.sectionTitle ? `${spot.sectionTitle}, ` : ''}${spot.rowLabel}${spot.colLabel ? ` (${spot.colLabel})` : ''}`.trim();
  }
  const cellFormsOf = (cell) => [cell.text, ...(cell.alt ? [cell.alt] : []), ...String(cell.text ?? '').split(' / ')].map((x) => String(x ?? '').trim()).filter(Boolean);
  return { entryFor, tableOfEntry, cellLabelOf, cellFormsOf };
}

/* ============================================ Learn's own items (§2, §8) */
/**
 * The items a **teaching step** checks with. Two rules from the contract are
 * structural here rather than checked afterwards:
 *
 * - **A step's check draws from the skill's own written sentences and never
 *   from the library** (§8). The generator below is an ordinary `createItems`
 *   whose entire world is `sentences/<skill>.json`, so there is no library for
 *   a Learn item to come from. It keeps its own pool, and it is never given a
 *   chapter: the written sentences are inside the skill's cumulative
 *   vocabulary by construction (§1), so a ceiling could only narrow what is
 *   already inside it.
 * - **A chart check over several words is one attempt** (§3, §8). The cell is
 *   asked on each word in turn as one item with one box per word, so `judge`
 *   folds them into a single verdict — right only if every word was right —
 *   while `cellResults` still paints each box green or red on its own.
 *
 *   createTeachItems({ skill, sentences, lookup, paradigm, catalogue, storage, rand })
 *     .sentenceItem({ kind, sentence, stage })     → item | null
 *     .chartItem({ key, cells, words, step })      → item | null
 *     .sentence(id) / .sentences                   the written material itself
 */
export function createTeachItems({ skill, sentences = [], lookup, paradigm = null, catalogue = null, skills = null, headwords = null, storage = null, rand = Math.random, poolKey = null }) {
  const list = (sentences ?? []).filter((s) => s && s.id && s.la);
  const byId = new Map(list.map((s) => [s.id, s]));
  const skillMap = skills instanceof Map ? skills : new Map([[skill.id, skill]]);
  // The written sentences as units. `week_n` is deliberately null: nothing scopes them by chapter, because
  // every word in them is already at or before the skill's own chapter (§1).
  const units = list.map((s) => ({ id: s.id, la: s.la, en: s.en || '', week_n: null, part: null }));
  const { entryFor, tableOfEntry, cellLabelOf, cellFormsOf } = tableHelpers({ lookup, paradigm });

  /* ----------------------------------------------- the focus word (§1) */
  // The glossary is keyed by the forms the book prints, so a written sentence's *vocet* or *servō*-the-noun
  // can be a miss for `lookup` and the scanner finds nothing. The sentence names its focus word, and the app's
  // own morphology can name the form: the headword index (§4b) gives every lemma, the lemma's paradigm gives
  // every cell, and the cell that spells the form is the parse. What the author declared settles the reading
  // — *servō* here is the dative, whatever else the ending could be — so the candidate is never ambiguous.
  const wordsOf = (la) => tokenize(la).filter((t) => t.isWord);
  // A focus of two words (an ablative absolute, *itūrum esse*, a contrary-to-fact pair) names a span, not a
  // token: `focusSpan` is every index it covers and `focusIndex` the head, the one a parse settles on. Matching
  // only one token used to leave these sentences with no candidate at all, so the step quietly taught another
  // sentence and the noticing opener could not be answered (§8).
  const focusSpan = (written) => {
    if (!written?.focus) return [];
    const parts = String(written.focus).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      const i = wordsOf(written.la).findIndex((t) => matchesForm(t.text, [written.focus]));
      return i < 0 ? [] : [i];
    }
    return spanIndexes(written.la, parts);
  };
  const focusIndex = (written) => { const s = focusSpan(written); return s.length ? s[0] : -1; };
  const parseOfKey = (key, entry) => {
    if (!key) return null;
    const k = key.kind;
    if (k === 'nominal') { const p = { case: key.case, number: key.number, gender: key.gender ?? entry?.gender ?? undefined }; if (key.degree) p.degree = key.degree; if (key.mood) { p.mood = key.mood; if (key.tense) p.tense = key.tense; if (key.voice) p.voice = key.voice; } return p; }
    if (k === 'finite') return { tense: key.tense, mood: key.mood, voice: key.voice, person: Number(key.person), number: key.number };
    if (k === 'imper') return { mood: 'imper', tense: key.tense ?? 'pres', voice: key.voice, number: key.number, ...(key.person ? { person: Number(key.person) } : {}) };
    if (k === 'inf') return { mood: 'inf', tense: key.tense, voice: key.voice };
    if (k === 'ptc') return { mood: 'ptc', tense: key.tense, voice: key.voice, ...(key.case ? { case: key.case, number: key.number, gender: key.gender } : {}) };
    if (k === 'gerundive') return { mood: 'gerundive', ...(key.case ? { case: key.case, number: key.number, gender: key.gender } : {}) };
    if (k === 'gerund' || k === 'supine') return { mood: k, case: key.case };
    return null;
  };
  const filterOf = (sk) => (Array.isArray(sk.parse_filter) ? sk.parse_filter : [sk.parse_filter]).filter((f) => f && typeof f === 'object');
  let hwEntries = null;
  /** Every headword entry once (the index's rows resolved through the glossary), lazily. */
  const allEntries = () => {
    if (hwEntries) return hwEntries;
    hwEntries = [];
    const seen = new Set();
    for (const row of headwords ?? []) {
      const [h, , key, i] = Array.isArray(row) ? row : [row?.h, row?.pos, row?.key, row?.i];
      const e = lookup(key ?? h)?.entries?.[i ?? 0];
      if (!e || e.enc || seen.has(e)) continue;
      seen.add(e); hwEntries.push(e);
    }
    return hwEntries;
  };
  const low = (x) => stripMacrons(String(x ?? '')).toLowerCase();
  /** The entries that could produce `form`: the direct lookup's, then every headword whose head or a root begins the form. */
  const entriesFor = (form, filters) => {
    const f = low(form);
    const out = [];
    const push = (e) => { if (e && !e.enc && !out.includes(e) && filters.some((fl) => entryAllowed(e, fl))) out.push(e); };
    for (const e of lookup(form)?.entries ?? []) push(e);
    if (!headwords) return out;
    for (const e of allEntries()) {
      const heads = [String(e.h ?? ''), firstWord(e.lemma), ...(e.roots ?? [])].map(low).filter((r) => r.length >= 2);
      if (heads.some((r) => f.startsWith(r) || (r.length >= 4 && f.startsWith(r.slice(0, 4))))) push(e);
    }
    return out;
  };
  /**
   * The scanner's candidate for a written sentence's declared focus, at one index. Two routes, in order: the
   * dictionary's own parse of the printed form (which is all an adverb or any word with no table can offer),
   * then the word's paradigm (for the forms the glossary does not key). Null when neither satisfies the skill.
   */
  const resolveAt = (unit, sk, idx) => {
    const toks = wordsOf(unit.la);
    if (idx < 0 || idx >= toks.length) return null;
    const filters = filterOf(sk);
    if (!filters.length) return null;
    const k = featureKey(sk);
    const tok = toks[idx];
    const made = (entry, parse, value, values) => ({ unit, token: tok, index: idx, entry, parse, ambiguous: false, settled: true, values: [...values], ambKey: k, value, gold: null, verified: true });
    // 1 · the dictionary. A filter that only names the entry (`{pos: 'ADV'}`) is satisfied by the entry alone,
    // so a word with no parses at all still answers it — that is the whole of what an adverb has.
    for (const e of lookup(tok.text)?.entries ?? []) {
      // An enclitic reading is skipped everywhere else, because *-que* on a word is not a word. For the skill
      // that teaches the enclitic it is the whole point, so it is admitted when the filter asks for it.
      if (e.enc && !filters.some((x) => x.enc)) continue;
      const ps = (e.parses || []);
      const values = new Set();
      let hit = null;
      for (const p of (ps.length ? ps : [{}])) {
        const v = featureValue(p, k, e, sk);
        if (v) values.add(v);
        if (!hit && filters.some((x) => parseMatches(p, x) && entryAllowed(e, x))) hit = { p, v };
      }
      if (hit) return made(e, hit.p, hit.v, values);
    }
    return resolveFromTable(unit, sk, idx);
  };
  /**
   * The focus of a written sentence: whichever word of the declared span the skill's own filter can settle
   * on. A periphrastic form (*ventūrum esse*, *clausum est*) is the exception — no single word of it is a
   * future infinitive, the two together are — so when no word answers the filter on its own, the candidate is
   * made on the head with the parse the skill declares. The author said what this sentence teaches; the
   * alternative is to teach a different sentence instead, which §8 forbids.
   */
  const resolveFocus = (unit, sk, written) => {
    const span = focusSpan(written);
    for (const idx of span) { const made = resolveAt(unit, sk, idx); if (made) return made; }
    if (span.length < 2) return null;
    const toks = wordsOf(unit.la);
    const tok = toks[span[0]];
    if (!tok) return null;
    // Only the parse keys of the filter: `pos`, `deponent` and `decl` describe the entry, not the reading.
    const ENTRY_KEYS = new Set(['pos', 'enc', 'h', 'deponent', 'decl']);
    const f = filterOf(sk)[0];
    if (!f) return null;
    const parse = Object.fromEntries(Object.entries(f).filter(([k, v]) => !ENTRY_KEYS.has(k) && v != null && !Array.isArray(v)));
    if (!Object.keys(parse).length) return null;
    const entry = (lookup(tok.text)?.entries ?? []).find((e) => !e.enc) ?? null;
    if (!entry) return null;
    const k = featureKey(sk);
    const value = featureValue(parse, k, entry, sk);
    return { unit, token: tok, index: span[0], entry, parse, ambiguous: false, settled: true, values: value ? [value] : [], ambKey: k, value, gold: null, verified: true };
  };
  /** The candidate made from the word's own paradigm, for the forms the glossary does not key. */
  const resolveFromTable = (unit, sk, idx) => {
    if (idx < 0 || !paradigm) return null;
    const toks = wordsOf(unit.la);
    const t = toks[idx];
    const filters = filterOf(sk);
    if (!filters.length) return null;
    const k = featureKey(sk);
    const printed = t.text.toLowerCase();
    const macronised = /[āēīōūȳĀĒĪŌŪȲ]/.test(t.text);
    let best = null;
    const values = new Set();
    for (const e of entriesFor(t.text, filters)) {
      const table = tableOfEntry(e);
      if (!table) continue;
      for (const [, spot] of tableCells(table)) {
        const forms = [spot.cell.text, spot.cell.alt, ...String(spot.cell.text ?? '').split(' / ')].filter(Boolean).map((x) => String(x).trim());
        const exact = forms.some((x) => x.toLowerCase() === printed);
        const loose = !exact && forms.some((x) => low(x) === low(printed));
        if (!exact && !(loose && !macronised)) continue;
        const parse = parseOfKey(spot.cell.key, e);
        if (!parse) continue;
        const fl = filters.find((x) => parseMatches(parse, x) && entryAllowed(e, x));
        const v = featureValue(parse, k, e, sk);
        if (v) values.add(v);
        if (fl && (!best || (exact && !best.exact))) best = { entry: e, parse, exact, value: v };
      }
    }
    if (!best) return null;
    return { unit, token: t, index: idx, entry: best.entry, parse: best.parse, ambiguous: false, settled: true, values: [...values], ambKey: k, value: best.value, gold: null, verified: true };
  };
  /** After every scan of a written sentence: the declared focus is settled if found, and made from its paradigm if not. */
  const augment = (unit, sk, found) => {
    const written = byId.get(unit.id);
    const span = focusSpan(written);
    if (!span.length) return found;
    // A word of the declared span that the scanner already found is settled by the declaration: the author
    // said what this sentence is teaching, so the reading is not open.
    if (found.some((c) => span.includes(c.index))) return found.map((c) => (span.includes(c.index) ? { ...c, ambiguous: false, settled: true } : c));
    const made = resolveFocus(unit, sk, written);
    return made ? [...found, made] : found;
  };
  // `poolKey`: a second generator over the skill's generated bank (§11b) keeps its own "already shown" memory apart from the written set's.
  const gen = createItems({ units, lookup, paradigm, skills: skillMap, storage, rand, poolKey: poolKey ?? `l103.grammar.teach.${skill.id}`, augment });

  /**
   * One written sentence as a drill item of `kind`. The step names a sentence,
   * but not every hand-written sentence can carry every kind (a form two cases
   * can read is no parse question), so the search is in two passes: the asked
   * kind on the named sentence, then the asked kind on the skill's other
   * written sentences, and only if no written sentence at all can carry it, a
   * kind the named sentence *can* carry. `taught` records which sentence the
   * item is really asking about, so nothing is claimed falsely. Null when the
   * skill's own sentences yield nothing — the library is never reached.
   */
  function sentenceItem({ kind = 'recognise', sentence = null, stage = 1, avoid = null, unshownOnly = false, keyed = false, tap = undefined } = {}) {
    const named = sentence ? byId.get(sentence) : null;
    const seen = (x) => !!avoid?.has?.(x.id);
    // Sentences this Learn has not shown yet come before the ones it has (A1); `unshownOnly` is the blocked
    // ten asking the written pool alone, which answers null once every written sentence has been shown.
    const fits = (x) => x !== named && (!x.kinds.length || x.kinds.includes(kind));
    const rest = [...list.filter((x) => fits(x) && !seen(x)), ...(unshownOnly ? [] : list.filter((x) => fits(x) && seen(x)))];
    const order = named ? [named, ...rest] : (rest.length ? rest : (unshownOnly ? [] : [...list.filter((x) => !seen(x)), ...list.filter(seen)]));
    let loose = null;
    for (const cand of order) {
      // `tap` rides through: a step that words its own question has already decided which shape of
      // `recognise` answers it, and the shape must not be re-tossed per sentence (N-3). `undefined`
      // and `null` both leave the decision to the generator, as a drawn item has always left it.
      const item = gen.generate({ skill: skill.id, kind, stage, chapter: null, unit: cand.id, focus: cand.focus, tap: tap ?? undefined });
      if (!item) continue;
      // A teaching **step's** check is a moment in the step, not a drawable item: it is logged (the history and
      // the timing stay true) but carries no key, so it never enters "redo what was wrong". `keyed` is the
      // drawn item — the blocked ten, "Just drill it", unlimited practice — and a **written** sentence there
      // does get its key, prefixed `w:` so the redo knows to rebuild it from the skill's own sentences rather
      // than from the library (`itemByKey`). Without that the whole rebuilt path logged `item_key: ''` and the
      // redo shelf could never fill (QA M-3). A **generated** sentence stays keyless: §11b, and a bank is
      // re-drawn, not re-addressed. `teachKey` keeps the generator's own key for the tests either way.
      // `repeat: false`: a step names its sentence, and the blocked ten's written tier is ordered by what this Learn has
      // shown (A1), so the generator's own pool wrapping says nothing here and must not print "starting over".
      // A generated sentence's item says so (§11: "labelled as such in its own words") and names its template, so an
      // attempt on it can be told apart from one on a written sentence (`createRunner` copies both into the attempt's meta).
      const isGen = cand.generated === true;
      const made = { ...item, teach: true, teachKey: item.key, key: keyed && !isGen && item.key ? writtenKey(item.key) : null, repeat: false, taught: cand.id, asked: named?.id ?? null, written: cand, generated: isGen, template: isGen ? cand.template ?? null : null };
      if (item.kind === kind) return made;
      loose = loose ?? made;
    }
    return loose;
  }

  const tableOf = (key) => catalogue?.tableOfKey?.(key) ?? null;
  /**
   * A chart check: the named cells, asked on each word in turn, as **one
   * item**. `words` comes from the step (§8) or from the table's own stock
   * words (§4a) — never invented here. A word whose table does not name the
   * cell is passed over; with no word left the caller falls back to a sentence.
   */
  function chartItem({ key = null, cells = [], words = null, step = null } = {}) {
    if (!paradigm) return null;
    const table = tableOf(key);
    const named = table ? catalogue.cells(table.id) : null;
    const stock = table ? catalogue.stock(table.id) : [];
    const lemmas = (words?.length ? words : stock).slice(0, 5);
    if (!lemmas.length) return null;
    // No cells named: the cells the skill's focus picks out of the table (a case skill's dat.sg and dat.pl), at most three.
    const asked = cells?.length ? cells : (named && skill.paradigm_focus ? [...named].filter((id) => focusFitsId(id, skill.paradigm_focus)).slice(0, 3) : []);
    if (!asked.length) return null;
    const boxes = [];
    let head = null;
    let sample = null;
    /** One asked cell on one reading of a word: its id and its spot, or null when that reading has no such cell. */
    const spotOf = (got, raw) => {
      const id = resolveCellId(raw, got.cells) ?? (named ? resolveCellId(raw, named) : null);
      const spot = id ? got.cells.get(id) : null;
      return spot && spot.cell?.text && spot.cell.text !== '—' ? { id, spot } : null;
    };
    // The reading of the word that can answer what the step asked. A headword can be two words — the glossary
    // has an adjective *mare* in front of the noun — and taking the first that renders any table gave a step
    // that named *mare* a gendered adjective table with no `nom.pl` in it, dropped every box, and built the
    // item on the other word while the step's own question went on naming *mare* (N-15).
    const dropped = [];
    for (const w of lemmas) {
      const got = entryFor(w, { fits: (g) => asked.some((raw) => spotOf(g, raw)) });
      if (!got) { dropped.push(typeof w === 'string' ? w : (w?.lemma ?? w?.h ?? '?')); continue; }
      const before = boxes.length;
      for (const raw of asked) {
        const at = spotOf(got, raw);
        if (!at) continue;
        const { id, spot } = at;
        const label = cellLabelOf(spot, got.table);
        boxes.push({
          row: boxes.length, col: 0, cellId: id, key: spot.cell.key, word: firstWord(got.entry.lemma), lemma: got.entry.lemma,
          label: `${firstWord(got.entry.lemma)} · ${label}`, cellLabel: label,
          ending: cellEnding(spot.cell), answer: cellFormsOf(spot.cell),
        });
        head = head ?? label;
        sample = sample ?? got;
      }
      if (boxes.length === before) dropped.push(firstWord(got.entry.lemma));
    }
    // A declared word that yielded no box is a step teaching something other than what it says. It used to
    // go by in silence; now it is on the console, named, so a lesson author or a build check can see it.
    if (dropped.length) console.warn(`[grammar] ${skill.id}: chart on ${table?.id ?? key ?? '?'} asked for ${asked.join(', ')} and could not build ${dropped.join(', ')}`);
    if (!boxes.length) return null;
    const oneCell = new Set(boxes.map((b) => b.cellLabel)).size === 1;
    const heads = [...new Set(boxes.map((b) => b.word))];
    const question = boxes.length === 1 ? [`Give the ${boxes[0].cellLabel} of `, la(boxes[0].word)]
      : oneCell ? [`Give the ${head} of `, ...laList(heads)]
        : ['Fill in these forms of ', ...laList(heads)];
    return {
      skill: skill.id, kind: 'chart', stage: 1, teach: true, taught: null, asked: null, written: null,
      key: null, teachKey: `teach-chart:${table?.id ?? key ?? '?'}#${[...new Set(boxes.map((b) => b.cellId))].join('+')}`,
      input: 'chart', unit_id: null, week_n: null, scope: null, target: null, parse: null, meanings: [], gold: null,
      entry: sample?.entry ?? null, lemma: sample?.entry?.lemma ?? '',
      prompt: { la: null, ...q(question), gloss: '', hint: `${head ?? 'this cell'} — the same job, one word at a time` },
      answer: boxes[0].answer,
      // `byWord`: the boxes are one word each, not a section of one table, so every one of them is asked (the
      // phone's one-cell reduction would answer the rest for the learner) and they read down the page in turn.
      chart: { table: sample?.table ?? null, section: 0, col: 0, target: { row: 0, col: 0 }, cells: boxes, full: false, byWord: true, head: head ?? '', tableId: table?.id ?? null },
      confuse: { values: {}, indexes: {}, forms: {} },
      feedback: {
        ...(() => { const parts = boxes.length === 1
          ? [la(boxes[0].answer[0]), ` is the ${boxes[0].cellLabel} of `, la(boxes[0].lemma), '.']
          : [...boxes.flatMap((b, i) => [i ? ', ' : '', la(b.word), ' → ', la(b.answer[0])]), '.'];
        return { short: partsText(parts), parts }; })(),
        term: skill.plain ?? '', label: { name: head ?? '', plain: '', full: head ?? '' }, table: null, lemma: sample?.entry?.lemma ?? null, sense: null,
        paradigm: { key: table?.id ?? key ?? null, highlight: null },
      },
      step,
    };
  }

  /**
   * The written sentence's focus word as a scanned candidate — its entry, its
   * parse and where it sits in the sentence. What a **worked example** is
   * built from (§8): the features it prints as given and the ones it asks for
   * are this parse's own, never invented. null when the scanner cannot reach
   * the sentence at all.
   */
  function focusOf(sentenceId) {
    const written = byId.get(sentenceId);
    const unit = written ? units.find((u) => u.id === written.id) : null;
    if (!unit) return null;
    const all = gen.scan(unit, skill);
    if (!all.length) return null;
    const clear = all.filter((c) => !c.ambiguous);
    const pool = clear.length ? clear : all;
    const hit = all.find((c) => c.settled) ?? (written.focus ? pool.find((c) => matchesForm(c.token.text, [written.focus])) : null);
    return { written, candidate: hit ?? pool[0] };
  }

  /**
   * One item back by the exact key it was logged under — what "redo what was
   * wrong" needs for an item drawn from a **written** sentence. The key names
   * the kind, the sentence and the token, so the item is rebuilt as it was;
   * null when it cannot be (the sentence was rewritten, the word re-parsed),
   * and the redo then drops that slot quietly, exactly as it does for a
   * library item that has gone. `kind` is the attempt's own, because the key
   * is the pool's key for that kind.
   */
  function itemByKey(key, { kind = null, stage = 1 } = {}) {
    const want = bareKey(key);
    if (!want) return null;
    const k = kind || String(want).split(':')[0].replace(/^recognise-tap$/, 'recognise');
    if (!k) return null;
    const item = gen.generate({ skill: skill.id, kind: k, stage, chapter: null, itemKey: want });
    if (!item) return null;
    const cand = byId.get(item.unit_id) ?? null;
    return { ...item, key: writtenKey(item.key), teachKey: item.key, repeat: false, taught: item.unit_id ?? null, asked: null, written: cand, generated: false, template: null, pool: 'written' };
  }

  return {
    sentenceItem, chartItem, focusOf, itemByKey,
    get sentences() { return list; },
    sentence: (id) => byId.get(id) ?? null,
    /** The lemmas a chart check would really ask about, for the step's own prose and for the tests. */
    chartWords: ({ key = null, words = null } = {}) => { const t = tableOf(key); return (words?.length ? words : (t ? catalogue.stock(t.id) : [])).map((w) => (typeof w === 'string' ? w : w.h)); },
    /** The cell a step reveals, on one word: `{ word, lemma, label, form, ending }` — null when the word does not render it. */
    revealed(key, cellIds, words = null) {
      const table = tableOf(key);
      const named = table ? catalogue.cells(table.id) : null;
      const lemmas = (words?.length ? words : (table ? catalogue.stock(table.id) : [])).slice(0, 3);
      const rows = [];
      for (const raw of cellIds) {
        const cols = [];
        let label = null;
        for (const w of lemmas) {
          const got = entryFor(w);
          if (!got) continue;
          const id = resolveCellId(raw, got.cells) ?? (named ? resolveCellId(raw, named) : null);
          const spot = id ? got.cells.get(id) : null;
          if (!spot || !spot.cell?.text || spot.cell.text === '—') continue;
          label = label ?? cellLabelOf(spot, got.table);
          cols.push({ word: firstWord(got.entry.lemma), lemma: got.entry.lemma, form: spot.cell.text, stem: spot.cell.stem ?? '', ending: cellEnding(spot.cell) });
        }
        if (cols.length) rows.push({ cellId: raw, label, cols });
      }
      return { table, rows };
    },
    pool: gen.pool,
  };
}

/* ============================================ the catalogue's items (§4, §11, §12) */
/**
 * The table id of a glossary entry, from `paradigms.json`'s `select` rules —
 * ordered data, first match wins (§4a) — so the app can name any library
 * word's table without re-implementing paradigms.js. `when` may test `pos`,
 * `h`, `d` / `v` (the two halves of `cat`), `gender`, `not_v`, `cat_is`,
 * `root0_ends_i` and `lemma_matches`. null when no rule matches. Pure.
 */
export function tableIdOf(entry, select) {
  if (!entry || !Array.isArray(select)) return null;
  const cat = Array.isArray(entry.cat) ? entry.cat : [];
  const [d, v] = [cat[0] ?? null, cat[1] ?? null];
  for (const rule of select) {
    const w = rule?.when;
    if (!w || typeof rule.table !== 'string') continue;
    if (w.pos && !w.pos.includes(entry.pos)) continue;
    if (w.h && !w.h.includes(entry.h)) continue;
    if (w.d != null && Number(d) !== Number(w.d)) continue;
    if (w.v && !w.v.map(Number).includes(Number(v))) continue;
    if (w.not_v && w.not_v.map(Number).includes(Number(v))) continue;
    if (w.gender && !w.gender.includes(entry.gender)) continue;
    if (w.cat_is && !w.cat_is.some((c) => Number(c[0]) === Number(d) && Number(c[1]) === Number(v))) continue;
    if (w.root0_ends_i && !/i$/.test(String(entry.roots?.[0] ?? ''))) continue;
    if (w.lemma_matches) { let re; try { re = new RegExp(w.lemma_matches); } catch { continue; } if (!re.test(String(entry.lemma ?? ''))) continue; }
    return rule.table;
  }
  return null;
}

/**
 * The catalogue's own generator (GRAMMAR-CONTRACT.md §4, decision 10; §11 —
 * "endings are already unlimited"): a table, a word, and the cells to drill.
 *
 *   createCatalogueItems({ catalogue, lookup, paradigm, headwords })
 *     .wordEntry(word)                      a stock word or `{ h, key, i }` → { entry, table, cells } | null
 *     .tableOf(entry)                       the catalogue table the entry renders, by the select rules
 *     .search(query, { table })             library headwords beginning with `query`, those that render the table first
 *     .filled(tableId, word)                the rendered paradigm of a word, for "see it filled"
 *     .cellItem({ tableId, cellId, words }) one cell across several words — one box a word, one attempt
 *     .tableItem({ tableId, word, group, cellIds })  the whole table (or one group of it) on one word
 *
 * Every item is the ordinary `chart` shape, so the cells get the same per-cell
 * colour, the same per-cell hint and the same one-attempt scoring as
 * everywhere else; a table item takes `chart.given` from the scaffold (§12).
 * The items log under the first skill that names the table (`table.skills`),
 * which is where the scheduler can use them.
 */
export function createCatalogueItems({ catalogue, lookup, paradigm = null, headwords = null, skills = null, rand = Math.random }) {
  const select = Array.isArray(catalogue?.raw?.select) ? catalogue.raw.select : [];
  const helpers = tableHelpers({ lookup, paradigm });
  const { entryFor, tableOfEntry, cellLabelOf, cellFormsOf } = helpers;
  const skillOf = (table) => (table?.skills ?? []).map((id) => (skills instanceof Map ? skills.get(id) : null)).find(Boolean) ?? null;
  const tableOf = (entry) => { const id = tableIdOf(entry, select); return id ? catalogue.table(id) : null; };
  const low = (x) => stripMacrons(String(x ?? '')).toLowerCase();
  let rows = null;
  const allRows = () => (rows ??= (headwords ?? []).map((r) => (Array.isArray(r) ? { h: r[0], pos: r[1], key: r[2], i: r[3] } : r)).filter((r) => r && typeof r.h === 'string'));
  /** Library headwords whose head begins with `query` (macrons ignored); with `table`, those that render it first and marked `fits`. */
  function search(query, { table = null, limit = 12 } = {}) {
    const q = low(query).trim();
    if (q.length < 2) return [];
    const want = table ? catalogue.table(table) : null;
    const out = [];
    for (const r of allRows()) {
      if (!low(r.h).startsWith(q)) continue;
      const e = lookup(r.key ?? r.h)?.entries?.[r.i ?? 0] ?? null;
      if (!e || e.enc) continue;
      const tid = tableIdOf(e, select);
      if (want && want.part && !partOfPos(e.pos, want.part)) continue;
      out.push({ h: r.h, pos: r.pos, key: r.key, i: r.i, lemma: e.lemma, table: tid, fits: !want || tid === want.id, entry: e });
      if (out.length >= limit * 3) break;
    }
    return out.sort((a, b) => Number(b.fits) - Number(a.fits) || a.h.localeCompare(b.h)).slice(0, limit);
  }
  const partOfPos = (pos, part) => ({ noun: ['N'], adjective: ['ADJ'], pronoun: ['PRON'], verb: ['V', 'VPAR'], numeral: ['NUM', 'ADJ'] }[part] ?? []).includes(pos);
  /** The word's rendered table, its cells by id, and the catalogue table it belongs to. */
  function wordEntry(word, tableId = null) {
    const got = entryFor(word);
    if (!got) return null;
    const table = (tableId && catalogue.table(tableId)) || tableOf(got.entry);
    return { ...got, catalogue: table };
  }
  const cellIdsOf = (table, group = null) => ((typeof table === 'string' ? catalogue.table(table) : table)?.groups ?? []).filter((g) => !group || g.id === group).flatMap((g) => g.cells ?? []);
  /**
   * The chosen axes split by what they select (§5). A **cell** axis (case,
   * number, tense …) says which cells of the table are asked; a **lemma**
   * axis (the gender of the headword, its chapter, deponency) says which
   * words they are asked on. The table's own `axes` declare the scope; an
   * axis it does not declare is read as a cell axis, which is what every slot
   * of a cell id is.
   *
   * Keeping the two apart is the whole point: `narrowCells` keeps a cell only
   * when its id carries a slot for every axis named, and `noun_gender_in_cell_id`
   * is false, so handing it the gender chip dropped every cell of a noun table
   * and emptied "practise one cell across words" outright (QA M-6). Pure.
   */
  function splitAxes(table, axes = {}) {
    const t = typeof table === 'string' ? catalogue.table(table) : table;
    const scope = new Map((t?.axes ?? []).map((a) => [a.id, a.scope === 'lemma' ? 'lemma' : 'cell']));
    const out = { cell: {}, lemma: {} };
    for (const [id, vs] of Object.entries(axes ?? {})) {
      if (!Array.isArray(vs) || !vs.length) continue;
      out[scope.get(id) === 'lemma' ? 'lemma' : 'cell'][id] = [...vs];
    }
    return out;
  }
  /**
   * Does one word answer the lemma axes chosen? A word that says nothing
   * about an axis (a library word whose gender the chip cannot know) is kept
   * — the axis narrows what it can, and never silently drops what it cannot
   * judge. Pure.
   */
  function lemmaFits(table, axes = {}, word = null) {
    const { lemma } = splitAxes(table, axes);
    return Object.entries(lemma).every(([id, vs]) => { const v = word?.[id]; return v == null || vs.map(String).includes(String(v)); });
  }
  /** The cell ids of a table narrowed by cell axes (§5): `{ case: ['dat'], number: ['sg'], … }` — a cell stays when every named axis holds one of its slots. */
  function narrowCells(ids, axes = {}) {
    const wants = Object.entries(axes ?? {}).filter(([, vs]) => Array.isArray(vs) && vs.length);
    if (!wants.length) return ids;
    const slotOf = catalogue.raw?.id_scheme?.slot_of ?? {};
    return ids.filter((id) => { const slots = id.split('.'); return wants.every(([axis, vs]) => slots.some((s) => slotOf[s] === axis && vs.includes(s))); });
  }
  /** One cell asked on each of several words as one item (§8's shape): the word generator for a cell. */
  function cellItem({ tableId, cellId, words = null, step = null } = {}) {
    const table = catalogue.table(tableId);
    if (!table) return null;
    const lemmas = (words?.length ? words : catalogue.stock(table.id)).slice(0, 5);
    const boxes = [];
    let sample = null;
    let head = null;
    for (const w of lemmas) {
      const got = entryFor(w);
      if (!got) continue;
      const id = resolveCellId(cellId, got.cells);
      const spot = id ? got.cells.get(id) : null;
      if (!spot || !spot.cell?.text || spot.cell.text === '—') continue;
      const label = cellLabelOf(spot, got.table);
      boxes.push({ row: boxes.length, col: 0, cellId: id, key: spot.cell.key, word: firstWord(got.entry.lemma), lemma: got.entry.lemma, label: `${firstWord(got.entry.lemma)} · ${label}`, cellLabel: label, ending: cellEnding(spot.cell), answer: cellFormsOf(spot.cell) });
      head = head ?? label; sample = sample ?? got;
    }
    if (!boxes.length) return null;
    const skill = skillOf(table);
    const heads = [...new Set(boxes.map((b) => b.word))];
    return chartShape({ skill, table, boxes, sample, head, question: [`Give the ${head} of `, ...laList(heads)], byWord: true, key: `${table.id}#${boxes[0].cellId}`, step });
  }
  /**
   * The whole table — or one group of it — on one word, as one item with one
   * box a cell, in the table's own reading order. `cellIds` narrows it (the
   * axes); a cell the word does not render is passed over.
   */
  function tableItem({ tableId, word = null, group = null, cellIds = null } = {}) {
    const table = catalogue.table(tableId);
    if (!table) return null;
    const got = entryFor(word ?? catalogue.stock(table.id)[0]);
    if (!got) return null;
    const ids = (cellIds?.length ? cellIds : cellIdsOf(table, group)).map((id) => resolveCellId(id, got.cells)).filter(Boolean);
    const spots = [...new Set(ids)].map((id) => ({ id, spot: got.cells.get(id) })).filter(({ spot }) => spot && spot.cell?.text && spot.cell.text !== '—');
    if (!spots.length) return null;
    // Reading order is the table's own: section, then row, then column.
    spots.sort((a, b) => a.spot.section - b.spot.section || a.spot.row - b.spot.row || a.spot.col - b.spot.col);
    const boxes = spots.map(({ id, spot }) => ({ row: spot.row, col: spot.col, section: spot.section, cellId: id, key: spot.cell.key, word: firstWord(got.entry.lemma), lemma: got.entry.lemma, label: cellLabelOf(spot, got.table), cellLabel: cellLabelOf(spot, got.table), ending: cellEnding(spot.cell), answer: cellFormsOf(spot.cell) }));
    const sections = [...new Set(boxes.map((b) => b.section))];
    const skill = skillOf(table);
    const groupLabel = group ? (table.groups.find((g) => g.id === group)?.label ?? group) : null;
    const what = groupLabel ? `the ${groupLabel}` : sections.length === 1 ? (got.table.sections[sections[0]]?.title ? `the ${got.table.sections[sections[0]].title}` : 'the table') : 'the table';
    return chartShape({ skill, table, boxes, sample: got, head: groupLabel ?? table.label, question: [`Fill in ${what} of `, la(firstWord(got.entry.lemma))], byWord: false, section: sections[0], multi: sections.length > 1, key: `${table.id}@${got.entry.h}#${group ?? 'all'}` });
  }
  /** The common item shape (`chart`), so the UI treats a catalogue item exactly like a drill's chart. */
  function chartShape({ skill, table, boxes, sample, head, question, byWord, section = 0, multi = false, key, step = null }) {
    return {
      skill: skill?.id ?? table.id, kind: 'chart', stage: 1, teach: false, taught: null, asked: null, written: null, catalogue: true,
      key: null, teachKey: key, input: 'chart', unit_id: null, week_n: null, scope: null, target: null, parse: null, meanings: [], gold: null,
      entry: sample?.entry ?? null, lemma: sample?.entry?.lemma ?? '',
      prompt: { la: null, ...q(question), gloss: '', hint: `${head ?? 'this cell'} — ${table.label}` },
      answer: boxes[0].answer,
      chart: { table: sample?.table ?? null, section, col: boxes[0].col, target: { row: boxes[0].row, col: boxes[0].col }, cells: boxes, full: !byWord, byWord, multi, head: head ?? '', tableId: table.id },
      confuse: { values: {}, indexes: {}, forms: {} },
      feedback: {
        // `cellLabel` is English ("dative singular"), the word is Latin: only the Latin halves are marked.
        ...(() => { const parts = boxes.length === 1
          ? [la(boxes[0].answer[0]), ` is the ${boxes[0].cellLabel} of `, la(boxes[0].lemma), '.']
          : [...boxes.flatMap((b, i) => [i ? ', ' : '', byWord ? la(b.word) : String(b.cellLabel ?? ''), ' → ', la(b.answer[0])]), '.'];
        return { short: partsText(parts), parts }; })(),
        term: skill?.plain ?? table.label, label: { name: head ?? '', plain: '', full: head ?? '' }, table: null, lemma: sample?.entry?.lemma ?? null, sense: null,
        paradigm: { key: table.id, highlight: null },
      },
      step,
    };
  }
  /** The rendered paradigm of a word, for "see it filled"; null when the word renders nothing. */
  const filled = (tableId, word = null) => { const t = catalogue.table(tableId); const got = entryFor(word ?? t?.stock?.[0]); return got?.table ?? null; };
  /** The stock words of a table narrowed by the **lemma** axes (§5): gender, chapter, deponency. Cell axes are not the words' business. */
  function stockWords(tableId, axes = {}) {
    const t = catalogue.table(tableId);
    const all = t ? catalogue.stock(t.id) : [];
    return all.filter((w) => lemmaFits(t, axes, w));
  }
  return { search, wordEntry, tableOf, cellItem, tableItem, filled, stockWords, narrowCells, splitAxes, lemmaFits, cellIdsOf, tableIdOf: (e) => tableIdOf(e, select), helpers, rand };
}
