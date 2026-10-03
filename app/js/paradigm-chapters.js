// Which chapter of Familia Romana teaches each cell of a paradigm table
// (2026-10-03: "tie these to the chapters for the specific parts of the
// paradigm"). The answer comes from the skill map (data/grammar/skills.json),
// the same rows the Grammar section teaches from: every form skill names its
// chapter and, in `parse_filter`, the forms it covers — "present indicative
// active, 3rd person" (cap. III), "the dative" (cap. VII), "the imperfect
// subjunctive" (cap. XXVIII). Nothing here is a second copy of that map.
//
// A cell's chapter is read in three steps:
//   1. The earliest form skill that covers the cell *and names what the cell
//      is*: its tense for a verb form, its mood for an infinitive, participle,
//      command or gerund, its case for a noun form. So the present 3rd person
//      says cap. III while "I / you / we" wait for the personal endings at
//      cap. XV, and a skill that only says "the subjunctive" (wishes with
//      utinam) never decides when the perfect subjunctive is taught. The
//      compound perfect passive (amātus est) that no tense skill names is
//      taught with its participle, cap. XXI.
//   2. A floor from what the table *is*: a skill that picks out whole words
//      (a declension, a pronoun, deponents) — the dative of rēx is not taught
//      before the third declension is, cap. IX.
//   3. A floor from the degree: a comparative's cases come with the
//      comparative, cap. XII.
// null when no skill covers the cell; such a cell is asked only when the
// learner chooses the whole table.

import { keyParse } from './paradigms.js';

const CELL_DIMS = ['case', 'tense', 'mood', 'voice', 'person', 'number', 'degree'];
const NONFINITE = new Set(['inf', 'imper', 'ptc', 'gerund', 'gerundive', 'supine']);
const NOMINAL = new Set(['N', 'ADJ', 'PRON', 'NUM']);

const valueIn = (v, want) => (Array.isArray(want) ? want.map(String).includes(String(v)) : String(want) === String(v));
const branches = (f) => (Array.isArray(f) ? f : f ? [f] : []);
const isDeponent = (entry) => entry?.kind === 'dep' || entry?.kind === 'semidep';
const posOf = (entry) => (entry?.pos === 'VPAR' ? 'V' : entry?.pos);

/** Does the filter's word-level part (pos, h, decl, deponent, a noun's gender) fit the entry? Pure. */
function wordFits(f, entry) {
  if (f.enc) return false;
  const pos = posOf(entry);
  if (f.pos != null) {
    // A case skill names nouns, but an adjective or a pronoun takes the same cases.
    const ok = valueIn(pos, f.pos) || (f.pos === 'N' && f.case != null && NOMINAL.has(pos));
    if (!ok) return false;
  }
  if (f.h != null && !valueIn(entry.h, f.h)) return false;
  if (f.decl != null && !valueIn(entry.cat?.[0], f.decl)) return false;
  if (f.deponent === true && !isDeponent(entry)) return false;
  if (f.gender != null && f.pos === 'N' && !valueIn(entry.gender, f.gender)) return false;
  return true;
}

/** Does the filter fit the cell, naming what the cell is (see the head of this file)? Pure. */
/** Does the cell have every feature the filter names (whatever else it is)? Pure. */
function dimsMatch(f, p) {
  for (const k of CELL_DIMS) if (f[k] != null && (p[k] == null || !valueIn(p[k], f[k]))) return false;
  return !(f.gender != null && f.pos !== 'N' && (p.gender == null || !valueIn(p.gender, f.gender)));
}

function cellFits(f, p) {
  if (!dimsMatch(f, p)) return false;
  if (p.mood && NONFINITE.has(p.mood)) return f.mood != null && (p.mood === 'imper' || !p.tense || f.tense != null);
  if (p.tense) return f.tense != null;
  if (p.case) return f.case != null;
  return true;
}

const hasCellDims = (f) => CELL_DIMS.some((k) => f[k] != null) || (f.gender != null && f.pos !== 'N');

/**
 * The chapter that teaches `key` (a paradigms.js cell key) of `entry`, from
 * `skills` (skills.json rows). null when no skill covers it. Pure.
 */
export function cellChapter(skills, entry, key) {
  if (!entry || !key) return null;
  const p = keyParse(key);
  if (!p) return null;
  let floor = null;
  let degreeFloor = null;
  let wordFloor = null;
  const earliest = (q) => {
    let ch = null;
    for (const s of skills ?? []) {
      const n = Number(s.chapter);
      if (!Number.isFinite(n) || !s.paradigms?.length) continue;   // a construction, not a form: it does not say when a form is taught
      for (const f of branches(s.parse_filter)) {
        if (!wordFits(f, entry)) continue;
        if (q === p) {
          // A skill that names the word itself for a mood or a degree (melior · optimus with the irregular
          // comparison, cap. XIX; nōlī with its infinitive, cap. XX) is when *this* word's form is taught,
          // whatever a general skill says. Its present indicative is left to the general skills: the
          // irregular-verbs row (cap. XV) teaches sum's "I / you", not est.
          if (f.h != null && valueIn(entry.h, f.h) && dimsMatch(f, q) && (f.degree != null || (f.mood != null && !valueIn('ind', f.mood)))) {
            wordFloor = wordFloor == null ? n : Math.max(wordFloor, n);
          }
          // What the table is (a declension, a pronoun, deponents) and the degree set floors.
          if (!hasCellDims(f) ? (f.h != null || f.decl != null) : (f.deponent === true && isDeponent(entry))) floor = floor == null ? n : Math.min(floor, n);
          if (p.degree && p.degree !== 'pos' && f.degree != null && f.case == null && valueIn(p.degree, f.degree)) degreeFloor = degreeFloor == null ? n : Math.min(degreeFloor, n);
        }
        if (hasCellDims(f) && cellFits(f, q) && (ch == null || n < ch)) ch = n;
      }
    }
    return ch;
  };
  let ch = earliest(p);
  // The compound perfect passive (amātus sum …) that no tense skill names is taught with its participle.
  if (ch == null && p.voice === 'pass' && ['perf', 'plupf', 'futperf'].includes(p.tense)) ch = earliest({ mood: 'ptc', tense: 'perf', voice: 'pass' });
  if (ch == null) return null;
  return Math.max(ch, floor ?? 0, degreeFloor ?? 0, wordFloor ?? 0);
}

let skillsPromise = null;
/** skills.json, fetched once (the service worker has it cached). [] when it cannot be had. */
export function loadFormSkills() {
  skillsPromise ??= fetch(new URL('../data/grammar/skills.json', import.meta.url))
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (Array.isArray(d) ? d : d?.skills ?? []))
    .catch(() => { skillsPromise = null; return []; });
  return skillsPromise;
}
