// Both voices on one page (2026-10-24: "is this skill supposed to have the passive forms too? I have not
// encountered them yet" — "put them always on the same pages with an explanation to the active but put them
// below … fix all the pages/charts"). A skill whose forms come in both voices (its filter names a tense or mood
// and no voice: the future perfect, the subjunctives, the pluperfect) is practised in both, so every page of its
// lesson that shows or asks active forms shows and asks the same forms in the passive too, below them, with a
// line on how the passive is made. Pages that already ask a passive keep theirs; a word with no passive (sum,
// eō) simply has no passive boxes. Pure: no DOM, no fetch.
//
//   withPassive(skill, lesson) → the lesson, its steps widened (a copy; the input is untouched)
//   passiveNote(cellId)        → how the passive of that cell's tense and mood is made, or ''

const filters = (skill) => [].concat(skill?.parse_filter ?? []).filter((f) => f && typeof f === 'object');

/** Both voices are the skill's: it names a tense or mood of a verb, and no voice. */
export function bothVoices(skill) {
  const fs = filters(skill);
  if (!fs.length) return false;
  return fs.some((f) => (f.tense || f.mood) && !f.case && !f.degree)
    && fs.every((f) => f.voice == null && f.deponent !== true)
    && !fs.some((f) => [].concat(f.mood ?? []).some((m) => ['ptc', 'inf', 'gerund', 'gerundive', 'supine'].includes(m)));
}

const passOf = (id) => (typeof id === 'string' && id.includes('.act.') ? id.replace('.act.', '.pass.') : null);
/** The active ids, then their passives that are not already there. */
function widen(ids) {
  if (!Array.isArray(ids) || !ids.some((id) => passOf(id))) return ids;
  const have = new Set(ids);
  const more = ids.map(passOf).filter((p) => p && !have.has(p));
  return more.length ? [...ids, ...more] : ids;
}

const AUX = {
  'perf.ind': 'sum, es, est, sumus, estis, sunt',
  'plupf.ind': 'eram, erās, erat, erāmus, erātis, erant',
  'futperf.ind': 'erō, eris, erit, erimus, eritis, erunt',
  'perf.subj': 'sim, sīs, sit, sīmus, sītis, sint',
  'plupf.subj': 'essem, essēs, esset, essēmus, essētis, essent',
};
const ENDS = '-r, -ris, -tur, -mur, -minī, -ntur';

export function passiveNote(cellId) {
  const [tense, mood] = String(cellId ?? '').split('.');
  const tm = `${tense}.${mood}`;
  if (AUX[tm]) return `The passive is two words: the perfect participle — the 4th principal part with -us, -a, -um (-ī, -ae, -a for more than one), agreeing with the subject — and ${AUX[tm]}. Never the active's endings on the perfect stem.`;
  if (tm === 'pres.subj') return `The passive keeps the active's stem and vowel and takes the passive endings: ${ENDS}.`;
  if (tm === 'impf.subj') return `The passive: the 2nd principal part (the infinitive) + ${ENDS}.`;
  if (tm === 'pres.ind') return `The passive: the same stem with the passive endings -or, ${ENDS.slice(4)}.`;
  if (tm === 'impf.ind') return `The passive: the same stem and tense sign (-ba-, -ēba-) with ${ENDS}.`;
  if (tm === 'fut.ind') return 'The passive: the same stem and tense sign with the passive endings — -bor, -beris, -bitur … (1st, 2nd); -ar, -ēris, -ētur … (3rd, 4th).';
  if (tm === 'fut.imper') return 'The passive command: -tor to you (one) and to him or her, -ntor to them.';
  if (tm === 'pres.imper') return 'The passive (and deponent) command: stem + -re to one person, + -minī to more than one.';
  return '';
}

export function withPassive(skill, lesson) {
  if (!lesson || !bothVoices(skill)) return lesson;
  const teach = Array.isArray(lesson.teach) ? lesson.teach : (lesson.teach?.steps ?? null);
  if (!Array.isArray(teach)) return lesson;
  let changed = false;
  const steps = teach.map((step) => {
    if (!step || typeof step !== 'object') return step;
    const out = { ...step };
    let first = null;
    if (step.check?.kind === 'chart' && Array.isArray(step.check.cells)) {
      const cells = widen(step.check.cells);
      if (cells !== step.check.cells) { out.check = { ...step.check, cells }; first = first ?? step.check.cells.find(passOf); }
    }
    if (step.show?.kind === 'paradigm' && Array.isArray(step.show.reveal)) {
      const reveal = widen(step.show.reveal);
      if (reveal !== step.show.reveal) { out.show = { ...step.show, reveal }; first = first ?? step.show.reveal.find(passOf); }
    }
    if (!first) return step;
    changed = true;
    const note = passiveNote(first);
    if (note && !out.passive) out.passive = note;
    return out;
  });
  if (!changed) return lesson;
  return Array.isArray(lesson.teach) ? { ...lesson, teach: steps } : { ...lesson, teach: { ...lesson.teach, steps } };
}
