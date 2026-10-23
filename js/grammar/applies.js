// Which conjugations, declensions and words a skill's rule is for (2026-10-23: "on explanations like this it should
// always say which conjugations it applies for, if it applies to all"). Read off the skill's own `paradigms` — the
// tables skills.json says it is practised on — so a step that shows one example table (the 1st conjugation, amō)
// still says the rule is every conjugation's. Pure.
//
//   appliesTo(paradigms)          → "all four conjugations (and the 3rd's -iō verbs), and sum, eō and ferō" | ''
//   exampleOf(tableId, label)     → "The table is the 1st conjugation (-āre): amō." | ''

const CONJ = { conj1: '1st', conj2: '2nd', conj3: '3rd', conj4: '4th' };
const DECL = { decl1: 1, decl2m: 2, decl2n: 2, decl2r: 2, decl3: 3, decl3i: 3, decl3n: 3, decl3in: 3, decl4: 4, decl4n: 4, domus: 4, decl5: 5 };
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th'];
const ADJ = { adj12: '1st/2nd-declension', adj3: '3rd-declension', adjcomp: 'compared' };
/** The words a table of one word stands for, as the book names them. */
const WORD = { sum: 'sum', possum: 'possum', eo: 'eō', fero: 'ferō', volo: 'volō', nolo: 'nōlō', malo: 'mālō', fio: 'fīō',
  hic: 'hic', ille: 'ille', is: 'is', iste: 'iste', ipse: 'ipse', qui: 'quī', quis: 'quis', ego: 'ego', tu: 'tū', se: 'sē' };

const and = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function appliesTo(paradigms) {
  const ids = [...new Set((paradigms ?? []).filter((x) => typeof x === 'string'))];
  if (!ids.length) return '';
  const parts = [];
  const conj = ids.filter((x) => CONJ[x]).map((x) => CONJ[x]);
  const io = ids.includes('conj3io');
  if (conj.length === 4) parts.push(`all four conjugations${io ? ' (and the 3rd’s -iō verbs)' : ''}`);
  else if (conj.length || io) parts.push(`the ${and([...conj, ...(io ? ['3rd -iō'] : [])])} conjugation${conj.length + (io ? 1 : 0) > 1 ? 's' : ''}`);
  const decl = [...new Set(ids.filter((x) => DECL[x]).map((x) => DECL[x]))].sort();
  if (decl.length === 5) parts.push('all five declensions');
  else if (decl.length) parts.push(`the ${and(decl.map((n) => ORD[n]))} declension${decl.length > 1 ? 's' : ''}`);
  const adj = ids.filter((x) => ADJ[x]).map((x) => ADJ[x]);
  if (adj.length) parts.push(`${and(adj)} adjectives`);
  const words = ids.filter((x) => WORD[x]).map((x) => WORD[x]);
  if (!parts.length) return and(words);
  return words.length ? `${and(parts)}; also ${and(words)}` : and(parts);
}

/** The example a step's table is: "The table is the 1st conjugation (-āre): amō." */
export function exampleOf(tableId, { label = '', example = '' } = {}) {
  if (!tableId) return '';
  const name = label || (CONJ[tableId] ? `${CONJ[tableId]} conjugation` : DECL[tableId] ? `${ORD[DECL[tableId]]} declension` : WORD[tableId] ?? tableId);
  const word = String(example ?? '').split(/[\s,]/)[0];
  const lead = WORD[tableId] ? `The table is ${name}` : `The table is the ${name.replace(/^the /, '')}`;
  return `${lead}${word && !WORD[tableId] ? `: ${word}` : ''} — one example of the rule.`;
}
