// One generator over every kind: the wave-1 kinds (items.js), the stage-3
// kinds (stage3.js) and the chapter sets (sets.js). session.js and ui.js talk
// to this object only; it keeps items.js's interface (generate, drillable,
// candidates, pool, scan, skills) and adds the merged skill map.
//
//   createGenerator({ items, stage3, sets, skills }) — `skills` = grammar skills ∪ set skills

import { STAGE3_KINDS } from './stage3.js';
import { SET_KINDS } from './sets.js';

export function createGenerator({ items, stage3 = null, sets = null, skills }) {
  const skillMap = skills;
  function generate(slot = {}) {
    const { skill: id, kind } = slot;
    const skill = typeof id === 'string' ? skillMap.get(id) : id;
    if (!skill) return null;
    if (skill.set) return sets ? sets.generate({ ...slot, skill }) : null;
    if (STAGE3_KINDS.includes(kind)) {
      const item = stage3?.generate({ ...slot, skill }) ?? null;
      if (item) return item;
      // Nothing of that kind for the skill (no short sentence, no English, no unambiguous cell): a wave-1 kind instead, the neighbours' kinds last.
      const allowed = skill.kinds?.length ? skill.kinds : ['recognise', 'chart', 'parse', 'blank'];
      const avoid = slot.avoid ?? [];
      const order = ['blank', 'parse', 'recognise', 'chart'].filter((k) => allowed.includes(k));
      for (const alt of [...order.filter((k) => !avoid.includes(k)), ...order.filter((k) => avoid.includes(k))]) { const it = items.generate({ ...slot, skill, kind: alt }); if (it) return it; }
      return null;
    }
    if (SET_KINDS.includes(kind)) return null;
    return items.generate({ ...slot, skill });
  }
  const drillable = (id) => { const s = skillMap.get(id); if (!s) return false; return s.set ? !!sets?.drillable(id) : items.drillable(id); };
  return {
    generate, drillable,
    candidates: (id) => (skillMap.get(id)?.set ? [] : items.candidates(id)),
    scan: (u, s) => items.scan(u, s),
    pool: items.pool,
    skills: skillMap,
    meaningsOf: items.meaningsOf,
  };
}
