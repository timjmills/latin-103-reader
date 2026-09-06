// Grammar section views: the skill map, the lesson, the Learn flow, the
// Practice setup, the session runner (type / choice / chart / tap), feedback,
// the end-of-session summary and the stats page. Calm tone, no gamification.
// Every Latin word in a drill is tappable for its entry (a small popover built
// from dictionary.describe); the target's dictionary form sits under the item.

import { chapters, roman, inline, loadLesson, KEY_CLASS, KEY_MODELS, entryOfClass, highlightParses } from './lessons.js';
import { renderParadigm } from '../wordpanel.js';
import { tokenize } from '../tokenize.js';
import { decay, isDue, overdueRatio, newState, addToPractice, reviewFirst, suggestToday, inRotation, DAY_MS } from './scheduler.js';
import { createLearn, createPractice, createBlockedFive } from './session.js';
import { featureLabel, featureKey } from './items.js';
import { setsOfChapter, setChapters, phraseIndexes } from './sets.js';
import { orderInput, matchInput } from './inputs.js';
import { buildToday, fmtMinutes } from './today.js';
import * as stats from './stats.js';

const LS_SESSION = 'l103.grammar.session';      // the practice session in progress (plan, position, log) — Back / Reload can resume it
const LS_QUEUE = 'l103.grammar.learnQueue';     // "Start all as new": the skills still to go through Learn
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
const phone = () => matchMedia('(max-width: 767.98px)').matches;
const STATE_LABEL = { new: 'new', learning: 'learning', practising: 'practising', mastered: 'mastered', lapsed: 'lapsed' };
const PRESET_LABEL = {
  'review-heavy': ['Review-heavy', 'Due skills first, with confusable pairs. The default.'],
  'this-week': ['This week', "Two thirds from this week's new skills, the rest due reviews."],
  even: ['Even mix', 'Random across everything in rotation.'],
  'one-skill': ['One skill', 'A blocked set on a skill you choose.'],
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const KIND_LABEL = { recognise: 'recognise', chart: 'chart', parse: 'parse', blank: 'blank', transform: 'transform', reorder: 'reorder', translate: 'translate', question: 'question', vocab: 'vocabulary', pensum: 'pensum' };
const SET_ROW_LABEL = { questions: 'Questions', vocab: 'Vocabulary', pensum: 'Pensa' };

function dueText(s, now = Date.now()) {
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

export function createUI(ctx) {
  const { root, index, gstore, dict, par } = ctx;
  // The grammar skills and the chapter sets (questions-NN, vocab-NN[-rev], pensum-NN) as one map: the scheduler treats them alike.
  const skills = ctx.skills ?? index.skills;
  const skillsIndex = { skills };
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
      ['map', 'practice', 'stats'].map((v) => h('button', { type: 'button', class: 'g-nav__btn', 'aria-current': (view.name === v || (v === 'practice' && ['setup', 'session', 'summary'].includes(view.name)) || (v === 'map' && ['lesson', 'learn'].includes(view.name))) ? 'page' : null, onclick: () => render(v === 'practice' ? 'setup' : v) },
        { map: 'Skills', practice: 'Practice', stats: 'Stats' }[v])));
    body = h('div', { class: 'g-body' });
    root.replaceChildren(h('div', { class: 'g' }, nav, body));
    const fn = { map: renderMap, lesson: renderLessonView, learn: renderLearnStart, setup: renderSetup, session: renderPracticeStart, stats: renderStats, summary: () => renderMap() };
    (fn[view.name] ?? renderMap)(view.params);
    document.title = `Grammar — Latin 103`;
  }
  /** Show a view. Each is a history entry (Back walks the section's views; a session in progress resumes); the new heading takes focus. */
  function render(name, params = {}, { push = true, focus = true } = {}) {
    closePop();
    view = { name, params };
    if (push) { try { history.pushState({ grammar: { name, params: name === 'session' ? { ...params, resume: true } : params } }, ''); } catch { /* file: URLs */ } }
    draw();
    window.scrollTo({ top: 0 });
    if (focus) body.querySelector('h1')?.focus?.({ preventScroll: true });
  }
  function refresh() { if (view.name === 'map' || view.name === 'stats') draw(); }
  // The new heading takes focus whenever the body is replaced and focus has nowhere to be (a view arriving after a lesson fetch, the end of a session) — G1-09.
  const setBody = (...nodes) => { body.replaceChildren(...nodes.flat(Infinity).filter(Boolean)); const f = body.querySelector('h1'); if (f) { f.tabIndex = -1; const a = document.activeElement; if (!a || a === document.body || !body.contains(a)) f.focus({ preventScroll: true }); } };
  window.addEventListener('popstate', (e) => {
    const g = e.state?.grammar;
    if (!g || ctx.section?.() === 'read') return;
    render(g.name, g.params ?? {}, { push: false });
  });

  /* ------------------------------------------------------ gloss popover */
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', onDocDown, true); } }
  function onDocDown(e) { if (pop && !pop.contains(e.target) && !e.target.closest?.('.g-w')) closePop(); }
  function showGloss(wordEl, form, text, unitLa = '') {
    closePop();
    const r = dict.lookup(form);
    const entries = r.entries.slice(0, 4);
    const described = entries.map((entry) => dict.describe(entry, { compact: !!ctx.settings?.compact, form: text, context: unitLa }));
    // Every reading the dictionary has (the reader's panel offers them too): the first in full, the others compact.
    const block = (d, i) => h('div', { class: `g-pop__entry${i ? ' g-pop__entry--alt' : ''}` },
      h('p', { class: 'g-pop__meaning' }, String(d.meaning ?? '').split(/\s+·\s+/).map((m, j) => [j ? h('br') : null, m])),
      d.parse ? h('p', { class: 'g-pop__parse', text: d.parse }) : null,
      h('p', { class: 'g-pop__lemma' }, h('span', { lang: 'la', class: 'entry__cite', text: d.lemma }), d.category ? ` · ${d.category}` : ''));
    pop = h('div', { class: 'g-pop', role: 'dialog', 'aria-label': `Word: ${text}` },
      h('p', { class: 'g-pop__form', lang: 'la', text }),
      described.length ? described.map(block) : h('p', { class: 'g-pop__meaning g-pop__miss', text: 'Not in the dictionary' }),
      r.entries.length > 1 ? h('p', { class: 'g-pop__more', text: `${r.entries.length} entries${r.entries.length > entries.length ? ` — the first ${entries.length} shown` : ''}` }) : null,
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
    pop.querySelector('.g-pop__close').focus({ preventScroll: true });
  }

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
      const b = h('button', { type: 'button', class: `g-w${targets.has(i) ? ' g-w--target' : ''}`, 'data-form': t.form, 'data-index': String(i), lang: 'la', text: t.text,
        onclick: (e) => { if (tap) tap(i, e.currentTarget); else showGloss(e.currentTarget, t.form, t.text, la); } });
      if (tap) b.setAttribute('aria-label', `${t.text}: choose this word`);
      p.append(b);
      last = b;
    }
    return p;
  }
  /** "Show all meanings": every word's first reading under the sentence. */
  function glossList(item) {
    const rows = (item.meanings || []).map((m) => {
      const e = dict.lookup(m.form).entries[0];
      const d = e ? dict.describe(e, { compact: true, form: m.text }) : null;
      return h('li', {}, h('span', { lang: 'la', class: 'g-all__la', text: m.text }), ' — ', h('span', { class: 'g-all__en', text: d ? String(d.meaning).split(/\s+·\s+/)[0] : '?' }));
    });
    return h('ul', { class: 'g-all', 'aria-label': 'All meanings' }, rows);
  }

  /* -------------------------------------------------------------- map */
  function renderMap() {
    const now = Date.now();
    const states = gstore.getStates();
    const cw = ctx.currentWeekSkills();
    const rf = reviewFirst({ weekSkills: cw, skills, states, now });
    const filter = view.params.category ?? 'all';
    const saved = readJSON(LS_SESSION, null);
    const queue = (readJSON(LS_QUEUE, []) || []).filter((id) => skills.has(id) && stateOf(id).state !== 'practising' && stateOf(id).state !== 'mastered');

    const head = h('header', { class: 'g-head' },
      h('h1', { class: 'g-title', text: 'Skills' }),
      // The pensa arrive from the private library, so the lede only promises them once some are here.
      h('p', { class: 'g-lede', text: `${index.skills.size} skills in book order, with each chapter's questions, vocabulary${[...skills.values()].some((s) => s.set === 'pensum') ? ' and pensa' : ''}. Start a skill as new to learn it in one sitting, or add it straight to mixed practice.` }));

    // Today: the daily plan (today.js) — with the run in progress and the "start all as new" queue above it.
    const todayNode = h('section', { class: 'g-today', 'aria-labelledby': 'g-today-h' },
      h('h2', { id: 'g-today-h', class: 'g-h2', text: 'Today' }),
      saved?.queue?.length && saved.index < saved.queue.length ? h('p', { class: 'g-today__line' }, `A practice session is in progress (${Math.min(saved.index, saved.queue.length)} of ${saved.queue.length} answered). `, btn('Resume', { onclick: () => render('session', { ...(saved.params ?? {}), resume: true }) }, 'btn btn--primary g-today__btn'), ' ', btn('Discard', { onclick: () => { writeJSON(LS_SESSION, null); draw(); } }, 'btn btn--quiet g-today__btn')) : null,
      queue.length ? h('p', { class: 'g-today__line' }, `Learning in book order: ${queue.length} skill${queue.length === 1 ? '' : 's'} to go, next `, h('button', { type: 'button', class: 'g-link', onclick: () => render('learn', { skill: queue[0], queue: queue.slice(1) }) }, titleOf(queue[0])), '. ', btn('Stop the run', { onclick: () => { writeJSON(LS_QUEUE, null); draw(); } }, 'btn btn--quiet g-today__btn')) : null,
      todayCard({ place: 'map', bare: true }));

    const reviewNode = rf.length ? h('section', { class: 'g-review', 'aria-labelledby': 'g-review-h' },
      h('h2', { id: 'g-review-h', class: 'g-h2', text: `Review first · week ${ctx.currentCourseWeekN()}` }),   // the last course week: a shelf chapter being read keeps it (G1-12)
      h('p', { class: 'g-quiet', text: "The prerequisites of this week's new skills, the most decayed first." }),
      h('ul', { class: 'g-chips' }, rf.map((r) => h('li', {}, h('button', { type: 'button', class: 'g-chip', 'data-state': r.state, onclick: () => render('lesson', { skill: r.skill }) }, titleOf(r.skill), h('span', { class: 'g-chip__state', text: ` · ${STATE_LABEL[r.state]}` })))))) : null;

    const cats = ['all', ...index.categories, ...(ctx.sets?.size ? ['sets'] : [])];
    const filterNode = h('div', { class: 'g-filter', role: 'group', 'aria-label': 'Filter by category' },
      cats.map((c) => btn(c === 'all' ? 'All' : c === 'sets' ? 'Chapter sets' : cap(c.replace('-', ' ')), { 'aria-pressed': String(filter === c), onclick: () => { view.params.category = c; draw(); } }, 'g-filter__btn')));

    const bulk = h('div', { class: 'g-bulk' },
      btn('Add all to mixed practice', { onclick: () => bulkAdd() }, 'btn btn--quiet'),
      btn('Start all as new', { onclick: () => bulkNew() }, 'btn btn--quiet'),
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
      const mastered = list.filter((s) => stateOf(s.id).state === 'mastered').length;
      return h('section', { class: 'g-chap', 'aria-labelledby': `g-chap-${chapter}` },
        h('h2', { id: `g-chap-${chapter}`, class: 'g-chap__h' }, h('span', { class: 'g-chap__num', text: `Cap. ${roman(chapter)}` }), list.length ? h('span', { class: 'g-chap__count', text: `${mastered} of ${list.length} mastered` }) : null),
        shown.length ? h('ul', { class: 'g-skills' }, shown.map(skillRow)) : null,
        shownSets.length ? h('div', { class: 'g-sets' }, h('h3', { class: 'g-sets__h', text: 'Chapter sets' }), h('ul', { class: 'g-skills g-skills--sets' }, shownSets.map(setRow))) : null);
    });

    setBody(head, todayNode, reviewNode, filterNode, bulk, chapterNodes);
  }

  function skillRow(s) {
    const st = stateOf(s.id);
    const acts = [];
    const lessonBtn = btn('Lesson', { onclick: () => render('lesson', { skill: s.id }) }, 'btn btn--quiet');
    const can = drillable(s.id);
    if (!can) {
      // No sentence in the library fits (the metre skills by design): the lesson stands, nothing to drill (M8).
      acts.push(lessonBtn);
    } else if (st.state === 'new') {
      acts.push(btn('Start as new', { onclick: () => render('learn', { skill: s.id }) }, 'btn'), btn('Add to mixed practice', { onclick: () => addSkill(s.id) }, 'btn btn--quiet'), lessonBtn);
    } else if (st.state === 'learning') {
      acts.push(btn('Continue learning', { onclick: () => render('learn', { skill: s.id }) }, 'btn'), lessonBtn);
    } else if (st.state === 'lapsed') {
      acts.push(btn('Re-learn', { onclick: () => render('learn', { skill: s.id }) }, 'btn'), btn('Practise this skill', { onclick: () => startBlocked(s.id) }, 'btn btn--quiet'), lessonBtn);
    } else {
      acts.push(btn('Practise this skill', { onclick: () => startBlocked(s.id) }, 'btn'), lessonBtn);
    }
    acts.push(btn('Reset', { onclick: () => resetSkill(s.id), 'aria-label': `Reset ${s.title}` }, 'btn btn--quiet g-skill__reset'));
    return h('li', { class: 'g-skill', 'data-state': st.state },
      h('div', { class: 'g-skill__main' },
        h('button', { type: 'button', class: 'g-skill__title', onclick: () => render('lesson', { skill: s.id }) }, s.title),
        h('p', { class: 'g-skill__plain', text: `${s.plain} · ${s.course} week ${s.week ?? '—'}` }),
        h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': can ? st.state : 'none', 'aria-hidden': 'true' }), can ? dueText(st) : (s.parse_filter ? 'no sentences in the library yet' : 'lesson only — no drill'))),
      h('div', { class: 'g-skill__acts' }, acts));
  }
  /** A chapter set as a row: Questions · Vocabulary (· English → Latin, optional) · Pensa — the same actions and states as a skill; pensa have no Learn. */
  function setRow(s) {
    const st = stateOf(s.id);
    const can = drillable(s.id);
    const acts = [];
    const learnable = s.set !== 'pensum';
    if (!can) acts.push(h('span', { class: 'g-quiet', text: 'nothing here yet' }));
    else if (st.state === 'new') { if (learnable) acts.push(btn('Start as new', { onclick: () => render('learn', { skill: s.id }) }, 'btn')); acts.push(btn('Add to mixed practice', { onclick: () => addSkill(s.id) }, learnable ? 'btn btn--quiet' : 'btn'), btn('Practise', { onclick: () => startBlocked(s.id) }, 'btn btn--quiet')); }
    else if (st.state === 'learning') acts.push(btn('Continue learning', { onclick: () => render('learn', { skill: s.id }) }, 'btn'));
    else if (st.state === 'lapsed') { if (learnable) acts.push(btn('Re-learn', { onclick: () => render('learn', { skill: s.id }) }, 'btn')); acts.push(btn('Practise', { onclick: () => startBlocked(s.id) }, learnable ? 'btn btn--quiet' : 'btn')); }
    else acts.push(btn('Practise', { onclick: () => startBlocked(s.id) }, 'btn'));
    acts.push(btn('Reset', { onclick: () => resetSkill(s.id), 'aria-label': `Reset ${s.title}` }, 'btn btn--quiet g-skill__reset'));
    const what = s.set === 'questions' ? `${s.count} question${s.count === 1 ? '' : 's'}${s.data?.title ? ` · ${s.data.title}` : ''}` : s.set === 'vocab' ? `${s.count} word${s.count === 1 ? '' : 's'}${s.rev ? ' · English → Latin, an optional extra deck' : ' · Latin → English'}` : `${s.data?.A.length ?? 0} A · ${s.data?.B.length ?? 0} B · ${s.data?.C.length ?? 0} C · practise only`;
    return h('li', { class: 'g-skill g-skill--set', 'data-state': st.state, 'data-set': s.set },
      h('div', { class: 'g-skill__main' },
        h('p', { class: 'g-skill__title g-skill__title--set', text: s.rev ? `${SET_ROW_LABEL[s.set]} · English → Latin` : SET_ROW_LABEL[s.set] }),
        h('p', { class: 'g-skill__plain', text: what }),
        h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': can ? st.state : 'none', 'aria-hidden': 'true' }), can ? dueText(st) : 'no items yet')),
      h('div', { class: 'g-skill__acts' }, acts));
  }
  const drillable = (id) => ctx.drillable(id);
  async function addSkill(id) {
    if (!drillable(id)) { ctx.say(`${titleOf(id)} has no drillable sentences yet.`); return; }
    await gstore.setState(addToPractice(gstore.getState(id) ?? id)); ctx.say(`${titleOf(id)} added to mixed practice.`); draw();
  }
  async function bulkAdd() {
    const ids = [...skills.keys()].filter((id) => !skills.get(id).rev && !inRotation(stateOf(id)) && drillable(id));
    if (!ids.length) { ctx.say('Every skill with sentences is already in mixed practice.'); return; }
    if (!confirm(`Add ${ids.length} skill${ids.length === 1 ? '' : 's'} to mixed practice? Each will be practised as it comes up, without a lesson first.`)) return;
    for (const id of ids) await gstore.setState(addToPractice(gstore.getState(id) ?? id));
    ctx.say(`${ids.length} skills added.`); draw();
  }
  async function bulkNew() {
    const ids = [...skills.keys()].filter((id) => stateOf(id).state === 'new' && drillable(id) && !skills.get(id).rev && skills.get(id).set !== 'pensum');
    if (!ids.length) { ctx.say('No skill is still new.'); return; }
    if (!confirm(`Start all ${ids.length} new skills through Learn, one after another, in book order?`)) return;
    writeJSON(LS_QUEUE, ids.slice(1));   // the run survives a detour, a reload or Back (G1-11)
    render('learn', { skill: ids[0], queue: ids.slice(1) });
  }
  async function resetSkill(id) {
    if (!confirm(`Reset ${titleOf(id)}? Its progress, attempts and confusions are removed.`)) return;
    await gstore.resetSkill(id); items.pool.reset(id); ctx.say(`${titleOf(id)} reset.`); draw();
  }
  async function resetAll() {
    if (!confirm('Reset every skill? All grammar progress, attempts and confusions are removed. The reading progress and looked-up words are untouched.')) return;
    await gstore.resetAll(); items.pool.reset(); ctx.say('All grammar progress reset.'); draw();
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
      if (b.type === 'p') out.push(h('p', { class: 'g-lesson__p' }, inline(b.text)));
      else if (b.type === 'english') out.push(h('p', { class: 'g-lesson__english' }, h('span', { class: 'g-lesson__tag', text: 'In English' }), ' ', inline(b.text)));
      else if (b.type === 'rule') out.push(h('p', { class: 'g-lesson__rule', 'data-rule': '' }, inline(b.text)));
      else if (b.type === 'paradigm') { const t = paradigmFor(skill, b); const node = t && renderParadigm(t); if (node) { node.open = true; out.push(h('div', { class: 'g-lesson__pt' }, node)); } }
      else if (b.type === 'examples') out.push(examplesBlock(skill, b));
      else if (b.type === 'confusion') out.push(h('div', { class: 'g-lesson__conf', 'data-conf': '' }, h('p', { class: 'g-lesson__tag', text: `Not to be confused with ${titleOf(b.with)}` }), h('p', {}, inline(b.text))));
    }
    if (lesson?.more?.length) out.push(h('details', { class: 'g-more' }, h('summary', { class: 'g-more__s', text: 'More' }), lesson.more.map((b) => h('p', { class: 'g-lesson__p' }, inline(b.text)))));
    if (lesson?.sources?.length) out.push(h('p', { class: 'g-sources', text: `Sources: ${lesson.sources.join(' · ')}` }));
    if (!lesson) out.push(h('p', { class: 'g-lesson__p g-quiet', text: 'This lesson has not been written yet. The summary above and the examples below still stand.' }), examplesBlock(skill, { units: [], invented: [] }, { fallback: 3 }));
    return out;
  }
  /** "Week 3 · Fabulae Syrae 1: Mīnōs" or, for the review shelf, "Familia Romana cap. VII". */
  function unitRefText(u) {
    const m = /^([wr])(\d+):/.exec(String(u.id ?? ''));
    if (m && m[1] === 'r') return `Familia Romana cap. ${roman(Number(m[2]))}${u.part ? ` · ${u.part}` : ''}`;
    const n = u.week_n ?? (m ? Number(m[2]) : null);
    return `${n != null ? `Week ${n}` : 'Library'}${u.part ? ` · ${u.part}` : ''}`;
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
  async function renderLessonView({ skill: id }) {
    const skill = skills.get(id);
    if (!skill) return renderMap();
    const st = stateOf(id);
    setBody(h('p', { class: 'g-loading', text: 'Loading the lesson…' }));
    const lesson = await lessonOf(id);
    const acts = [];
    if (st.state === 'new' || st.state === 'lapsed') acts.push(btn(st.state === 'lapsed' ? 'Re-learn this skill' : 'Start learning', { onclick: () => render('learn', { skill: id }) }, 'btn btn--primary'));
    if (st.state === 'learning') acts.push(btn('Continue learning', { onclick: () => render('learn', { skill: id }) }, 'btn btn--primary'));
    if (st.state === 'new') acts.push(btn('Add to mixed practice', { onclick: async () => { await addSkill(id); render('lesson', { skill: id }); } }, 'btn'));
    if (inRotation(st)) acts.push(btn('Practise this skill', { onclick: () => startBlocked(id) }, 'btn btn--primary'));
    setBody(
      btn('← Skills', { onclick: () => render('map') }, 'btn btn--quiet g-back'),
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
  async function renderLearnStart({ skill: id, queue = [] }) {
    const skill = skills.get(id);
    if (!skill) return renderMap();
    if (skill.set === 'pensum') { startBlocked(id); return; }   // pensa are practised, never learned in a sitting
    const learn = createLearn({ skill, gstore, items });
    await learn.begin();
    const lesson = skill.set ? null : await lessonOf(id);
    const steps = skill.set ? [skill.set === 'vocab' ? 'The deck, once through' : 'The passage\'s questions', 'Blocked 10'] : ['Lesson', 'Examples', 'Guided 5', 'Blocked 10'];
    const stepper = (i) => h('ol', { class: 'g-steps', 'aria-label': 'Learn steps' }, steps.map((s, j) => h('li', { class: 'g-steps__s', 'aria-current': i === j ? 'step' : null, text: s })));
    const finishQueue = () => { writeJSON(LS_QUEUE, queue.length ? queue.slice(1) : null); if (queue.length) render('learn', { skill: queue[0], queue: queue.slice(1) }); else render('map'); };
    if (queue.length) writeJSON(LS_QUEUE, queue);

    const showLesson = () => setBody(stepper(0), lessonHeader(skill, stateOf(id)), h('article', { class: 'g-lesson' }, lessonBlocks(skill, lesson, { learn: true })),
      h('div', { class: 'g-acts' }, btn('Continue to the examples', { onclick: showExamples }, 'btn btn--primary'), btn('Back to skills', { onclick: () => render('map') }, 'btn btn--quiet')));

    const showExamples = () => {
      const exBlock = (lesson?.core ?? []).find((b) => b.type === 'examples') ?? { units: [], invented: [] };
      const units = exampleUnits(skill, exBlock.units || [], 3, { maxLen: 150 }).slice(0, 3);
      const k = featureKey(skill);
      const rows = units.map(({ unit: u, own }) => {
        const all = items.scan(u, skill);
        // Parse aloud the readings the sentence settles; a form that could be read another way is named only when nothing else fits.
        const cands = all.some((c) => !c.ambiguous) ? all.filter((c) => !c.ambiguous) : all;
        const focus = cands.find((c) => !c.ambiguous && c.entry.pos === 'N') ?? cands[0] ?? null;
        const parsed = cands.map((c) => {
          // The gloss and the label come from the parse that matched, not the entry's first reading (G1-04).
          const d = dict.describe({ ...c.entry, parses: [c.parse] }, { compact: false, form: c.token.text, context: u.la });
          const lab = featureLabel(k, c.value, { skills, skill });
          const what = k === 'construction' && c.parse?.case && c.entry.pos !== 'V' ? `${featureLabel('case', c.parse.case).name}, ${lab.name}` : lab.name;
          return h('li', {}, h('b', { lang: 'la', text: c.token.text }), ` — ${String(d.meaning).split(/\s+·\s+/)[0]} — ${what}, ${lab.plain}${c.ambiguous ? ' (the ending could also be read another way; the sentence decides)' : ''}.`);
        });
        return h('li', { class: 'g-ex__item' }, latin(u.la, { target: focus?.index ?? null }), u.en ? h('p', { class: 'g-ex__en', text: u.en }) : null, h('p', { class: 'g-ex__ref', text: `${own ? '' : 'From the library · '}${unitRefText(u)}` }), h('ul', { class: 'g-ex__parsed' }, parsed));
      });
      for (const ex of (exBlock.invented || []).slice(0, Math.max(0, 3 - rows.length))) {
        const ti = ex.focus ? phraseIndexes(ex.la, ex.focus) : [];
        rows.push(h('li', { class: 'g-ex__item g-ex__item--inv' }, latin(ex.la, { target: ti.length ? ti : null }), h('p', { class: 'g-ex__en', text: ex.en }), h('p', { class: 'g-ex__ref', text: 'Invented example' })));
      }
      setBody(stepper(1), h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Worked examples' }), h('p', { class: 'g-lede', text: `Three sentences with ${skill.plain}, each parsed in plain words. Tap any word for its entry.` })),
        h('ul', { class: 'g-ex g-ex--worked' }, rows),
        h('div', { class: 'g-acts' }, btn('Start the guided drill', { onclick: showGuided }, 'btn btn--primary'), btn('Back to the lesson', { onclick: showLesson }, 'btn btn--quiet')));
    };

    const guidedStep = skill.set ? 0 : 2;
    const blockedStep = skill.set ? 1 : 3;
    const showGuided = () => {
      const first = learn.startGuided();
      if (!first) { setBody(stepper(guidedStep), h('p', { class: 'g-quiet', text: skill.set ? 'This set has no items yet.' : 'No sentences in the library fit this skill yet, so there is nothing to drill. Add the review shelf or another week and come back.' }), h('div', { class: 'g-acts' }, btn('Back to skills', { onclick: () => render('map') }, 'btn'))); return; }
      const note = skill.set === 'vocab' ? `Every word of the deck once, with its dictionary line after each. ${learn.deckSize} words.` : skill.set === 'questions' ? `Every question about the passage once; the answering sentence is shown after each. ${learn.deckSize} questions.` : 'Five items with the hint open. Take your time.';
      runSession({ runner: learn.runner, title: `${skill.set ? 'Once through' : 'Guided drill'} · ${skill.title}`, note, mode: 'learn', hintOpen: !skill.set, stepper: stepper(guidedStep), lesson, onDone: showBlocked });
    };
    const showBlocked = () => {
      const first = learn.startBlocked();
      if (!first) { render('map'); return; }
      runSession({ runner: learn.runner, title: `Blocked drill · ${skill.title}`, note: skill.set ? 'Ten more from this set. Six of ten and it joins your mixed practice.' : 'Ten items, this skill only. Hints are behind a button; feedback after each.', mode: 'learn', hintOpen: false, stepper: stepper(blockedStep), lesson, onDone: async () => showResult(await learn.finishBlocked()) });
    };
    const showResult = (r) => {
      const missedKinds = [...new Set(r.missed.map((a) => a.kind))];
      const passed = r.passed;
      setBody(stepper(blockedStep), h('header', { class: 'g-head' },
        h('h1', { class: 'g-title', text: passed ? 'Learned' : 'Not yet' }),
        h('p', { class: 'g-lede', text: passed
          ? (skill.set ? `${r.correct} of ${r.total}. ${skill.title} joins your mixed practice; its first review is due tomorrow.` : `${r.correct} of ${r.total} across ${r.kinds} kinds. ${skill.title} joins your mixed practice; its first review is due tomorrow.`)
          : (skill.set ? `${r.correct} of ${r.total} — the bar is six of ten. Nothing is lost: another ten are ready when you are.` : `${r.correct} of ${r.total}${r.kinds < 2 && r.correct >= 6 ? ', but all of one kind' : ''} — the bar is six of ten across two kinds. Nothing is lost: a fresh set of ten is ready when you are.`) })),
        !passed && r.missed.length ? h('section', { class: 'g-missed' }, h('h2', { class: 'g-h2', text: 'What was missed' }),
          h('ul', { class: 'g-missed__list' }, r.missed.map((a) => h('li', {}, h('span', { class: 'g-missed__kind', text: a.kind }), ' ', h('span', { lang: 'la', text: a.answer || '—' }), ' → ', h('span', { lang: 'la', text: a.expected })))),
          skill.set ? null : h('p', { class: 'g-quiet', text: `Kinds missed: ${missedKinds.join(', ')}. The lesson's rule and the confusion note are below.` }),
          skill.set ? null : h('article', { class: 'g-lesson g-lesson--lit' }, (lesson?.core ?? []).filter((b) => b.type === 'rule' || b.type === 'confusion').map((b) => b.type === 'rule' ? h('p', { class: 'g-lesson__rule is-lit' }, inline(b.text)) : h('div', { class: 'g-lesson__conf is-lit' }, h('p', { class: 'g-lesson__tag', text: `Not to be confused with ${titleOf(b.with)}` }), h('p', {}, inline(b.text)))))) : null,
        h('div', { class: 'g-acts' },
          passed ? [btn(queue.length ? `Next: ${titleOf(queue[0])}` : 'Back to skills', { onclick: finishQueue }, 'btn btn--primary'), btn('Practise now', { onclick: () => startBlocked(id) }, 'btn')]
            : [btn('Another ten', { onclick: showBlocked }, 'btn btn--primary'), skill.set ? btn('Once through again', { onclick: showGuided }, 'btn') : btn('Re-read the lesson', { onclick: showLesson }, 'btn'), btn('Stop for now', { onclick: () => render('map') }, 'btn btn--quiet')]));
      ctx.say(passed ? `${skill.title} learned.` : 'Not yet; another ten items are ready.');
    };
    if (skill.set) showGuided(); else showLesson();
  }

  /* --------------------------------------------------------- practice */
  function renderSetup() {
    const prefs = ctx.prefs();
    const states = gstore.getStates();
    const rotation = [...skills.keys()].filter((id) => inRotation(stateOf(id)) && drillable(id));
    const cw = [...ctx.currentWeekSkills(), ...(ctx.currentWeekSets?.() ?? [])];
    const onShelf = ctx.currentWeekN() != null && ctx.currentWeekN() > 100;
    const today = suggestToday({ states, skills, currentWeek: cw });
    let size = prefs.size;
    let preset = prefs.preset;
    let oneSkill = prefs.oneSkill && rotation.includes(prefs.oneSkill) ? prefs.oneSkill : rotation[0] ?? null;
    if (!rotation.length) {
      setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Practice' }), h('p', { class: 'g-lede', text: 'Nothing is in mixed practice yet. Learn a skill, or add one straight to practice from the skill map.' })),
        h('div', { class: 'g-acts' }, btn('Go to the skills', { onclick: () => render('map') }, 'btn btn--primary')));
      return;
    }
    const sizes = [5, 10, 15, null];
    const sizeGroup = h('div', { class: 'g-seg', role: 'group', 'aria-label': 'Session size' }, sizes.map((n) => btn(n == null ? 'Open' : String(n), { 'aria-pressed': String(size === n), onclick: (e) => { size = n; for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, 'g-seg__btn')));
    const skillSelect = h('select', { class: 'g-select', 'aria-label': 'Skill', onchange: (e) => { oneSkill = e.target.value; } }, rotation.map((id) => h('option', { value: id, selected: id === oneSkill ? true : null }, titleOf(id))));
    const presetList = h('div', { class: 'g-presets', role: 'radiogroup', 'aria-label': 'Mix' }, Object.entries(PRESET_LABEL).map(([key, [label, desc]]) => {
      const disabled = key === 'this-week' && !cw.some((id) => rotation.includes(id));
      return h('label', { class: `g-preset${disabled ? ' is-disabled' : ''}` },
        h('input', { type: 'radio', name: 'g-preset', value: key, checked: preset === key ? true : null, disabled: disabled ? true : null, onchange: () => { preset = key; skillSelect.closest('.g-preset__pick').hidden = key !== 'one-skill'; } }),
        h('span', { class: 'g-preset__text' }, h('b', { text: label }), h('small', { text: disabled ? (onShelf && !cw.length ? 'Reading the review shelf — no course week is current.' : 'No skill from this week is in practice yet.') : (key === 'this-week' ? `${desc} The week's questions, vocabulary and pensa count as its skills.` : key === 'review-heavy' || key === 'even' ? `${desc} Chapter sets take at most three items in ten.` : desc) })));
    }));
    const pick = h('div', { class: 'g-preset__pick', hidden: preset !== 'one-skill' }, h('span', { class: 'g-label', text: 'Skill' }), skillSelect);
    const start = async () => {
      await ctx.savePrefs({ preset, size, oneSkill });
      render('session', { preset, size, oneSkill });
    };
    setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Practice' }),
      h('p', { class: 'g-lede', text: `${rotation.length} skill${rotation.length === 1 ? '' : 's'} in rotation · ${today.due.length + (today.setsDue?.length ?? 0)} due${today.pairs ? ` · ${today.pairs} confusion pair${today.pairs === 1 ? '' : 's'} to work on` : ''}.` })),
      h('section', { class: 'g-setup' },
        h('div', { class: 'g-setup__row' }, h('span', { class: 'g-label', text: 'Items' }), sizeGroup),
        h('div', { class: 'g-setup__row g-setup__row--col' }, h('span', { class: 'g-label', text: 'Mix' }), presetList, pick)),
      h('div', { class: 'g-acts' }, btn('Start', { onclick: start }, 'btn btn--primary'), btn('Back to skills', { onclick: () => render('map') }, 'btn btn--quiet')));
  }
  function renderPracticeStart({ preset = 'review-heavy', size = 10, oneSkill = null, resume = false }) {
    const params = { preset, size, oneSkill };
    // A session in progress is kept in localStorage (plan, position, answers) so Back or Reload offers to resume it (G1-08).
    const saved = resume ? readJSON(LS_SESSION, null) : null;
    const usable = saved?.queue?.length && saved.index < saved.queue.length ? saved : null;
    if (usable) Object.assign(params, usable.params ?? {});
    const onChange = (snap) => writeJSON(LS_SESSION, snap.index < snap.queue.length ? { ...snap, params, at: Date.now() } : null);
    const practice = createPractice({ gstore, items, skillsIndex, currentWeekN: ctx.currentWeekN(), currentWeekSkills: [...ctx.currentWeekSkills(), ...(ctx.currentWeekSets?.() ?? [])], preset: params.preset, size: params.size, oneSkill: params.oneSkill, resume: usable ? { queue: usable.queue, index: usable.index, log: usable.log } : null, onChange });
    const first = practice.start();
    if (!first) { writeJSON(LS_SESSION, null); setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Nothing to practise' }), h('p', { class: 'g-lede', text: 'No sentences in the library fit the skills in rotation yet.' })), h('div', { class: 'g-acts' }, btn('Back to skills', { onclick: () => render('map') }, 'btn'))); return; }
    if (usable) ctx.say('Session resumed.');
    runSession({ runner: practice.runner, title: `Practice · ${PRESET_LABEL[params.preset][0]}`, mode: 'practice', hintOpen: false, practiceLink: true, open: practice.open, more: () => practice.more(), onDone: (summary) => { writeJSON(LS_SESSION, null); renderSummary(summary, params); } });
  }
  function startBlocked(id) {
    const skill = skills.get(id);
    const st = gstore.getState(id);
    // A skill still in Learn keeps learning (m14); a lapsed or new one enters the rotation now, so the answers that follow are not judged "early" (M1).
    if (st?.state === 'learning' && skill.set !== 'pensum') { render('learn', { skill: id }); return; }
    if (!inRotation(st) || decay(st).state === 'lapsed') gstore.setState(addToPractice(st ?? id));
    const practice = createBlockedFive({ skill, gstore, items, skillsIndex });
    view = { name: 'session', params: { oneSkill: id } };
    try { history.pushState({ grammar: { name: 'map', params: {} } }, ''); } catch { /* file: */ }
    draw();
    const first = practice.start();
    if (!first) { setBody(h('p', { class: 'g-quiet', text: 'No sentences fit this skill yet.' }), h('div', { class: 'g-acts' }, btn('Back to skills', { onclick: () => render('map') }, 'btn'))); return; }
    runSession({ runner: practice.runner, title: `Practise · ${skill.title}`, mode: 'practice', hintOpen: false, onDone: (summary) => renderSummary(summary, { preset: 'one-skill', size: 5, oneSkill: id }) });
  }
  function renderSummary(summary, params) {
    view = { name: 'summary', params };
    const acc = summary.total ? Math.round((summary.right / summary.total) * 100) : 0;
    setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Session over' }),
      h('p', { class: 'g-lede', text: `${summary.right} of ${summary.total} right (${acc}%) · ${summary.skills.length} skill${summary.skills.length === 1 ? '' : 's'} · ${stats.fmtMin(summary.ms)}${summary.hinted ? ` · ${summary.hinted} with a hint` : ''}.` })),
      summary.wrong.length ? h('section', {}, h('h2', { class: 'g-h2', text: 'Worth another look' }), h('ul', { class: 'g-chips' }, summary.wrong.map((id) => h('li', {}, h('button', { type: 'button', class: 'g-chip', onclick: () => startBlocked(id) }, titleOf(id), h('span', { class: 'g-chip__state', text: ' · practise' })))))) : h('p', { class: 'g-quiet', text: 'Nothing missed.' }),
      h('div', { class: 'g-acts' }, btn('Another session', { onclick: () => render('session', params) }, 'btn btn--primary'), btn('Skills', { onclick: () => render('map') }, 'btn btn--quiet'), btn('Stats', { onclick: () => render('stats') }, 'btn btn--quiet')));
    body.querySelector('h1')?.focus?.({ preventScroll: true });   // a keyboard session ends on the summary, not at the top of the page (G1-09)
    ctx.say(`Session over: ${summary.right} of ${summary.total} right.`);
  }

  /* ----------------------------------------------------------- runner */
  /**
   * Drives one runner in the body: item → answer → feedback → next. `open`
   * sessions offer "ten more" at the end; `practiceLink` shows "Practise this
   * skill" in the feedback (a five-item set that returns here afterwards).
   */
  function runSession({ runner, title, note = '', mode, hintOpen = false, stepper = null, lesson = null, onDone, practiceLink = false, open = false, more = null }) {
    const wrap = h('div', { class: 'g-run' });
    setBody(stepper, wrap);
    function finish() {
      const summary = runner.summary();
      if (open && more) {   // open-ended: ten more before the summary
        wrap.replaceChildren(h('div', { class: 'g-open' }, h('p', { class: 'g-lede', text: `${summary.right} of ${summary.total} so far.` }),
          h('div', { class: 'g-acts' }, btn('Ten more', { onclick: () => { more(); step(); } }, 'btn btn--primary'), btn('Finish', { onclick: () => onDone(summary) }, 'btn'))));
        wrap.querySelector('button')?.focus({ preventScroll: true });
        return;
      }
      onDone(summary);
    }
    function step() {
      closePop();
      const cur = runner.current;
      if (!cur) { finish(); return; }
      const { item } = cur;
      wrap.replaceChildren(itemNode(item, {
        title, note, position: runner.position + 1, length: runner.length, hintOpen, onHint: () => runner.hint(),
        onAnswer: async (value) => {
          const result = await runner.answer(value);
          const next = () => { runner.next(); step(); };
          wrap.append(feedbackNode(item, result, { lesson, mode, practiceLink, onNext: next, onPractice: () => nested(item.skill) }));
          wrap.querySelector('.g-fb__next')?.focus({ preventScroll: true });
          ctx.say(wrap.querySelector('.g-fb__line')?.textContent ?? '');
          wrap.querySelector('.g-fb')?.scrollIntoView({ block: 'nearest' });
        },
      }));
      wrap.querySelector('.g-q')?.focus?.({ preventScroll: true });
    }
    /** "Practise this skill": a five-item blocked set, then back to this session's place (the feedback stays where it was). */
    function nested(skillId) {
      const skill = skills.get(skillId);
      const sub = createBlockedFive({ skill, gstore, items, skillsIndex });
      if (!sub.start()) { ctx.say('No more sentences for this skill right now.'); return; }
      const saved = [...wrap.childNodes];
      const subWrap = h('div', { class: 'g-run g-run--sub' });
      wrap.replaceChildren(h('p', { class: 'g-sub__note', text: `A short set on ${skill.title}; the session continues afterwards.` }), subWrap);
      const subStep = () => {
        closePop();
        const cur = sub.runner.current;
        if (!cur) { wrap.replaceChildren(...saved); wrap.querySelector('.g-fb__next')?.focus({ preventScroll: true }); ctx.say('Back to the session.'); return; }
        subWrap.replaceChildren(itemNode(cur.item, { title: `Practise · ${skill.title}`, position: sub.runner.position + 1, length: sub.runner.length, hintOpen: false, onHint: () => sub.runner.hint(),
          onAnswer: async (value) => {
            const result = await sub.runner.answer(value);
            subWrap.append(feedbackNode(cur.item, result, { lesson: null, mode: 'practice', practiceLink: false, onNext: () => { sub.runner.next(); subStep(); } }));
            subWrap.querySelector('.g-fb__next')?.focus({ preventScroll: true });
            ctx.say(subWrap.querySelector('.g-fb__line')?.textContent ?? '');
          } }));
        subWrap.querySelector('.g-q')?.focus?.({ preventScroll: true });
      };
      subStep();
    }
    step();
  }

  function itemNode(item, { title, note = '', position, length, hintOpen, onHint, onAnswer }) {
    const skill = skills.get(item.skill);
    ctx.current = item;   // the item on screen (window.latinGrammar.current — tests / debugging)
    const node = h('section', { class: 'g-item', 'data-kind': item.kind, 'data-input': item.input, 'aria-label': `Item ${position} of ${length}` });
    node.append(h('p', { class: 'g-item__meta' }, h('span', { class: 'g-item__title', text: title }), h('span', { class: 'g-item__pos', text: `· ${position} of ${length}` })));
    if (note) node.append(h('p', { class: 'g-quiet g-item__note', text: note }));
    node.append(h('p', { class: 'g-item__skill', text: `${skill?.title ?? item.skill} · ${KIND_LABEL[item.kind] ?? item.kind}${item.pensum ? ` ${item.pensum}` : ''}` }));
    if (item.repeat) node.append(h('p', { class: 'g-quiet g-item__note', text: item.set ? 'Every item of this set has come up once; starting over.' : 'Every sentence for this skill has come up once; starting over.' }));
    let submitted = false;
    const submit = (v) => { if (submitted) return; submitted = true; node.querySelectorAll('button, input, textarea').forEach((el) => { if (!el.closest('.g-hint') && !el.classList.contains('g-w') && !el.closest('.g-all-switch') && !el.closest('.g-q-en')) el.disabled = true; }); onAnswer(v); };
    const question = (text) => h('p', { class: 'g-q', tabindex: '-1', text });
    // The English of a question on demand (a question set, Pensum C): never shown first.
    const englishOf = (en) => (en ? h('details', { class: 'g-q-en' }, h('summary', { class: 'g-hint__s', text: 'In English' }), h('p', { class: 'g-hint__rule', text: en })) : null);
    const tapMode = item.input === 'tap';
    // The sentence (tap items answer by tapping); a question shows its question first, the sentence under it when it is a tap item.
    if (item.kind === 'question' || (item.kind === 'pensum' && item.pensum === 'C')) {
      node.append(question(item.prompt.question), englishOf(item.prompt.en));
      if (item.prompt.la) {
        node.append(latin(item.prompt.la, { tap: tapMode ? (i, el) => { el.classList.add('is-picked'); submit(i); } : null, cls: tapMode ? 'g-la--tap' : '' }));
        const sw = h('label', { class: 'switch g-all-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: allMeanings ? true : null, onchange: (e) => { allMeanings = e.target.checked; const l = node.querySelector('.g-all'); if (l) l.hidden = !allMeanings; } }), h('span', { class: 'switch__ui', 'aria-hidden': 'true' }), h('span', { class: 'switch__text', text: 'Show all meanings' }));
        node.append(sw, Object.assign(glossList(item), { hidden: !allMeanings }));
      }
    } else if (item.kind === 'vocab') {
      // Vocabulary withholds the meaning by design (plan §3): the word stands alone, the dictionary line comes after.
      if (item.input === 'match') node.append(question(item.prompt.question));
      else node.append(h('p', { class: 'g-la g-vocab__word', lang: item.word && !skill?.rev ? 'la' : null, text: skill?.rev ? item.word.meaning : item.word.lemma }), question(item.prompt.question));
    } else if (item.kind === 'pensum') {
      node.append(question(item.prompt.question));
    } else if (item.input === 'order') {
      node.append(question(item.prompt.question));
      if (item.prompt.gloss) node.append(h('p', { class: 'g-gloss' }, h('span', { lang: 'la', text: item.target?.text ?? '' }), ' — from ', h('span', { lang: 'la', class: 'entry__cite', text: item.prompt.gloss.split(' — ')[0] }), `, ${item.prompt.gloss.split(' — ').slice(1).join(' — ')}`));
    } else if (item.prompt.la) {
      node.append(latin(item.prompt.la, { target: tapMode || item.kind === 'blank' ? null : item.target?.index ?? null, tap: tapMode ? (i, el) => { el.classList.add('is-picked'); submit(i); } : null, cls: tapMode ? 'g-la--tap' : '' }));
      node.append(question(item.prompt.question));
      if (item.prompt.gloss) node.append(h('p', { class: 'g-gloss' }, h('span', { lang: 'la', text: item.target?.text ?? '' }), ' — from ', h('span', { lang: 'la', class: 'entry__cite', text: item.prompt.gloss.split(' — ')[0] }), `, ${item.prompt.gloss.split(' — ').slice(1).join(' — ')}`));
      const sw = h('label', { class: 'switch g-all-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: allMeanings ? true : null, onchange: (e) => { allMeanings = e.target.checked; const l = node.querySelector('.g-all'); if (l) l.hidden = !allMeanings; } }), h('span', { class: 'switch__ui', 'aria-hidden': 'true' }), h('span', { class: 'switch__text', text: 'Show all meanings' }));
      node.append(sw, Object.assign(glossList(item), { hidden: !allMeanings }));
    } else {
      node.append(question(item.input === 'chart' ? chartQuestion(item) : item.prompt.question));
      if (item.prompt.gloss) node.append(h('p', { class: 'g-gloss' }, h('span', { lang: 'la', class: 'entry__cite', text: item.prompt.gloss.split(' — ')[0] }), ` — ${item.prompt.gloss.split(' — ').slice(1).join(' — ')}`));
    }
    // Input
    const latinTyped = item.kind === 'blank' || item.kind === 'transform' || item.kind === 'question' || item.kind === 'pensum' || (item.kind === 'vocab' && skill?.rev);
    if (item.input === 'choice') {
      const group = h('div', { class: 'g-choices', role: 'group', 'aria-label': 'Answers' }, item.choices.map((c, i) => btn([h('span', { class: 'g-choice__n', 'aria-hidden': 'true', text: `${i + 1}` }), h('span', { class: 'g-choice__label', lang: item.kind === 'blank' || item.kind === 'question' || (item.kind === 'vocab' && skill?.rev) ? 'la' : null, text: c.label }), c.plain ? h('span', { class: 'g-choice__plain', text: c.plain }) : null], { 'data-value': c.value, onclick: (e) => { e.currentTarget.classList.add('is-picked'); submit(c.value); } }, 'g-choice')));
      node.append(group, h('p', { class: 'g-keys', text: 'Keys 1–4 choose an answer.' }));
      node.addEventListener('keydown', (e) => { const n = Number(e.key); if (n >= 1 && n <= item.choices.length && !submitted && e.target.tagName !== 'INPUT') { e.preventDefault(); group.children[n - 1].click(); } });
    } else if (item.input === 'type') {
      const input = h('input', { type: 'text', class: 'g-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', lang: latinTyped ? 'la' : 'en', 'aria-label': item.kind === 'blank' ? 'The missing form' : 'Your answer', placeholder: item.kind === 'blank' ? 'the form (macrons optional)' : (item.prompt.placeholder ?? 'e.g. dative singular') });
      const check = btn('Check', {}, 'btn btn--primary'); check.type = 'submit';
      const form = h('form', { class: 'g-type', onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) submit(input.value); } }, input, check);
      node.append(form);
      setTimeout(() => input.focus({ preventScroll: true }), 0);
    } else if (item.input === 'chart') {
      node.append(chartInput(item, submit));
    } else if (item.input === 'tap') {
      node.append(h('p', { class: 'g-keys g-keys--tap', text: 'Tap a word in the sentence.' }));
    } else if (item.input === 'order') {
      const w = orderInput({ chunks: item.chunks, scrambled: item.scrambled, onSubmit: submit, live: ctx.live });
      node.append(w.node);
      setTimeout(() => w.focus(), 0);
    } else if (item.input === 'match') {
      const w = matchInput({ pairs: item.pairs, right: item.right, onSubmit: submit, live: ctx.live });
      node.append(w.node);
      setTimeout(() => w.focus(), 0);
    } else if (item.input === 'inline') {
      node.append(inlineInput(item, submit));
    } else if (item.input === 'bank') {
      node.append(bankInput(item, submit));
    } else if (item.input === 'self') {
      node.append(selfInput(item, submit));
    }
    // Hint: the rule and the plain paradigm (no cell lit). Opening it is logged.
    const table = item.entry && item.kind !== 'chart' ? (() => { try { return par.paradigm(item.entry, []); } catch { return null; } })() : null;
    const pt = table ? renderParadigm(table) : null;
    if (pt) pt.open = true;
    const hint = h('details', { class: 'g-hint', open: hintOpen ? true : null }, h('summary', { class: 'g-hint__s', text: 'Hint' }), h('p', { class: 'g-hint__rule', text: item.prompt.hint }), pt);
    hint.addEventListener('toggle', () => { if (hint.open && !submitted) onHint(); });
    if (hintOpen) onHint();
    node.append(hint);
    return node;
  }

  /** Pensum A: the sentence with an input for each ending, inline after its stem. Submits { blankIndex: typed }. */
  function inlineInput(item, submit) {
    const inputs = new Map();
    const p = h('p', { class: 'g-la g-pensum' , lang: 'la' });
    for (const seg of item.segments) {
      if (seg.blank == null) { p.append(seg.text); continue; }
      const b = item.blanks[seg.blank];
      if (!b) continue;
      const inp = h('input', { type: 'text', class: 'g-input g-input--end', lang: 'la', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': `Ending after ${b.stem || 'the stem'}${b.note ? ` (${b.note})` : ''}`, placeholder: '…', size: String(Math.max(2, Math.min(6, (b.answers[0] ?? '').length + 1))) });
      inputs.set(seg.blank, inp);
      p.append(h('span', { class: 'g-pensum__blank' }, h('span', { class: 'g-pensum__stem', text: b.stem }), inp));
    }
    const check = btn('Check', {}, 'btn btn--primary'); check.type = 'submit';
    const form = h('form', { class: 'g-chart', onsubmit: (e) => { e.preventDefault(); const v = {}; item.blanks.forEach((b, i) => { v[i] = inputs.get(i)?.value ?? ''; }); submit(v); } }, p, h('div', { class: 'g-chart__acts' }, check), h('p', { class: 'g-keys', text: 'Tab moves to the next ending; Enter checks.' }));
    setTimeout(() => form.querySelector('input')?.focus({ preventScroll: true }), 0);
    return form;
  }
  /** Pensum B: the sentence with word blanks and a tappable bank. Submits { blankIndex: word }. */
  function bankInput(item, submit) {
    const filled = {};
    const slots = new Map();
    const p = h('p', { class: 'g-la g-pensum', lang: 'la' });
    for (const seg of item.segments) {
      if (seg.blank == null) { p.append(seg.text); continue; }
      const i = seg.blank;
      const slot = h('button', { type: 'button', class: 'g-pensum__slot', lang: 'la', 'aria-label': `Blank ${i + 1}: empty`, onclick: () => { if (filled[i] != null) { delete filled[i]; paint(); } } }, '\u00a0');
      slots.set(i, slot);
      p.append(slot);
    }
    const bankBtns = item.bank.map((w) => h('button', { type: 'button', class: 'g-order__w', lang: 'la', text: w, onclick: () => { const next = item.blanks.findIndex((_, i) => filled[i] == null); if (next < 0) return; filled[next] = w; paint(); } }));
    const check = btn('Check', {}, 'btn btn--primary'); check.type = 'submit';
    const paint = () => {
      for (const [i, slot] of slots) { const w = filled[i]; slot.textContent = w ?? '\u00a0'; slot.classList.toggle('is-filled', w != null); slot.setAttribute('aria-label', w != null ? `Blank ${i + 1}: ${w}; tap to empty` : `Blank ${i + 1}: empty`); }
      const used = new Set(Object.values(filled));
      for (const b of bankBtns) b.disabled = used.has(b.textContent);
      check.disabled = item.blanks.some((_, i) => filled[i] == null);
    };
    const form = h('form', { class: 'g-chart', onsubmit: (e) => { e.preventDefault(); submit({ ...filled }); } }, p, h('div', { class: 'g-order__bank', role: 'group', 'aria-label': 'Word bank' }, bankBtns), h('div', { class: 'g-chart__acts' }, check), h('p', { class: 'g-keys', text: 'Tab to a word and press Enter to put it in the next empty blank; a filled blank empties when chosen.' }));
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

  /** The cells a chart item shows: all of them, or the target cell alone on a phone. */
  const chartCells = (item) => { const { chart } = item; if (phone() && chart.cells.length > 1) return [chart.cells.find((c) => c.row === chart.target.row && c.col === chart.target.col) ?? chart.cells.find((c) => c.row === chart.target.row) ?? chart.cells[0]]; return chart.cells; };
  /** The question as asked of the cells shown ("Give the accusative singular of cāsus" when a phone shows one cell). */
  const chartQuestion = (item) => { const cells = chartCells(item); return cells.length === 1 && item.chart.cells.length > 1 ? `Give the ${cells[0].label} of ${item.chart.head ?? item.lemma.split(/[\s,]/)[0]}` : item.prompt.question; };
  /** The paradigm section with inputs in the cells to fill (a compact single row on phones). */
  function chartInput(item, submit) {
    const { chart } = item;
    const cells = chartCells(item);
    const inputs = new Map();   // index into chart.cells → input
    const mk = (i, label) => { const inp = h('input', { type: 'text', class: 'g-input g-input--cell', lang: 'la', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': label, placeholder: '…' }); inputs.set(i, inp); return inp; };
    // Cells not shown (phones show one) are judged as right: only what was asked counts.
    const collect = () => { const v = {}; chart.cells.forEach((c, i) => { v[i] = inputs.has(i) ? inputs.get(i).value : c.answer[0]; }); return v; };
    const form = h('form', { class: 'g-chart', onsubmit: (e) => { e.preventDefault(); submit(collect()); } });
    if (cells.length === 1) {
      const c = cells[0];
      const i = chart.cells.indexOf(c);
      form.append(h('label', { class: 'g-chart__one' }, h('span', { class: 'g-label', text: `${item.lemma.split(/[\s,]/)[0]} · ${c.label}` }), mk(i, c.label)));
    } else {
      const sec = chart.table.sections[chart.section];
      const tbl = h('table', { class: 'pt g-chart__t' }, sec.title ? h('caption', { class: 'pt__caption', text: `${item.lemma} · ${sec.title}` }) : null,
        sec.headers?.length ? h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'pt__corner', 'aria-label': 'form' }), sec.headers.map((hd) => h('th', { scope: 'col', text: hd })))) : null,
        h('tbody', {}, sec.rows.map((r, ri) => h('tr', {}, h('th', { scope: 'row', text: r.label }), r.cells.map((cell, ci) => {
          const idx = chart.cells.findIndex((c) => c.row === ri && c.col === ci);
          if (idx >= 0) return h('td', { class: 'pt__cell g-chart__in' }, mk(idx, chart.cells[idx].label));
          return h('td', { class: `pt__cell${cell?.empty ? ' is-empty' : ''}`, lang: 'la', text: cell?.empty ? '—' : cell?.text ?? '—' });
        })))));
      form.append(h('div', { class: 'pt__scroll' }, tbl));
    }
    const check = btn('Check', {}, 'btn btn--primary'); check.type = 'submit';
    form.append(h('div', { class: 'g-chart__acts' }, check));
    setTimeout(() => form.querySelector('input')?.focus({ preventScroll: true }), 0);
    return form;
  }

  function feedbackNode(item, result, { lesson, mode, practiceLink, onNext, onPractice }) {
    const skill = skills.get(item.skill);
    const fb = item.feedback;
    const ok = result.correct;
    const isSet = !!item.set;
    let line;
    if (item.input === 'self') line = result.given === 'right' ? `Right, by your own account. ${fb.short}` : result.given === 'partly' ? `Partly — worth another look. ${fb.short}` : `Not this time. ${fb.short}`;
    else if (ok) line = `Right. ${fb.short}`;
    else if (item.input === 'tap') {
      const tapped = item.meanings?.find((m) => m.text === result.given);
      const e = tapped ? dict.lookup(tapped.form).entries[0] : null;
      const d = e ? dict.describe(e, { compact: false, form: tapped.text }) : null;
      line = `You tapped ${result.given}${d ? ` — ${d.parse}` : ''}; the word that fits is ${result.expected}. ${fb.short}`;
    } else if (item.input === 'choice' && result.choice) {
      const given = result.choice.plain ? `${result.choice.label} (${result.choice.plain})` : result.choice.label;
      line = `You chose ${given}; the answer is ${result.expected}. ${fb.short}`;
    } else if ((item.input === 'chart' || item.input === 'inline' || item.input === 'bank') && result.cells) {
      const wrong = result.cells.filter((c) => !c.ok);
      line = `${wrong.length === 1 ? 'One blank' : `${wrong.length} blanks`} off: ${wrong.map((c) => `${c.given || '—'} → ${c.expected}`).join(', ')}. ${fb.short}`;
    } else if (item.input === 'match' && result.cells) {
      const wrong = result.cells.filter((c) => !c.ok);
      line = `${wrong.length === 1 ? 'One pair' : `${wrong.length} pairs`} off: ${wrong.map((c) => `${c.la} is ${c.expected}`).join('; ')}.`;
    // The learner's order usually ends on a word that carries its own punctuation, so a full stop after it would read as a typo.
    } else if (item.input === 'order') line = `Not quite — you had: ${result.given}${/[.!?,;:]$/.test(String(result.given).trim()) ? '' : '.'} ${fb.short}`;
    else line = `You answered ${result.given || '—'}; the answer is ${result.expected}. ${fb.short}`;

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
      lit ? h('div', { class: 'g-fb__pt' }, lit) : null,
      unit && !isSet && item.kind !== 'transform' && item.kind !== 'reorder' ? h('div', { class: 'g-fb__ctx' }, h('p', { class: 'g-lesson__tag', text: 'In the sentence' }), latin(unit.la, { target: item.target?.index ?? null }), unit.en ? h('p', { class: 'g-ex__en', text: unit.en }) : null) : null);
    details?.addEventListener('toggle', async () => {
      if (!details.open) return;
      const slot = details.querySelector('.g-fb__rule');
      if (slot.childElementCount || isSet) return;
      const l = lesson ?? await lessonOf(item.skill);
      const rule = (l?.core ?? []).find((b) => b.type === 'rule');
      const conf = (l?.core ?? []).find((b) => b.type === 'confusion' && (!result.attempt?.confused_with || b.with === result.attempt.confused_with));
      if (rule) slot.append(h('p', { class: 'g-lesson__rule is-lit' }, inline(rule.text)));
      if (!ok && conf) slot.append(h('div', { class: 'g-lesson__conf' }, h('p', { class: 'g-lesson__tag', text: `Not to be confused with ${titleOf(conf.with)}` }), h('p', {}, inline(conf.text))));
    }, { once: false });
    const node = h('div', { class: 'g-fb', 'data-ok': String(ok), 'data-partial': result.partial ? 'true' : null },
      h('p', { class: 'g-fb__line' }, h('span', { class: 'g-fb__mark', 'aria-hidden': 'true', text: ok ? (result.partial ? '~' : '✓') : '✗' }), ' ', line),
      answerBlock,
      isSet && item.kind !== 'question' && item.kind !== 'pensum' ? null : details,
      h('div', { class: 'g-fb__acts' }, btn('Next', { onclick: onNext }, 'btn btn--primary g-fb__next'), practiceLink && mode === 'practice' ? btn(`Practise ${skill?.title ?? 'this skill'}`, { onclick: onPractice }, 'btn btn--quiet') : null));
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('g-fb__next')) { e.preventDefault(); onNext(); } });
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
    const plan = buildToday({ states: gstore.getStates(), skills, currentWeek: ctx.currentWeekSkills(), weekChapter: ctx.currentChapter?.() ?? null, attempts: gstore.getAttempts(), unread: place === 'weeks' ? unread : 0, pace, now, dismissed: ctx.settings?.todayDismissed ?? null, drillable });
    const dismiss = async () => { await ctx.saveSetting?.({ todayDismissed: plan.day }); ctx.say('Today\'s plan hidden for today.'); if (place === 'map') draw(); else node.replaceWith(todayCard({ place, bare, unread, pace }) ?? ''); };
    const restore = async () => { await ctx.saveSetting?.({ todayDismissed: null }); if (place === 'map') draw(); else node.replaceWith(todayCard({ place, bare, unread, pace }) ?? ''); };
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
      bare ? null : h('h3', { class: 'g-plan__h' }, 'Today', plan.minutes ? h('span', { class: 'g-plan__total', text: ` · ${fmtMinutes(plan.minutes)}` }) : null),
      rows.length ? h('ul', { class: 'g-plan__list' }, rows) : h('p', { class: 'g-today__line g-quiet', text: place === 'weeks' ? 'Nothing suggested for today — open Grammar to start a skill or add one to practice.' : 'Nothing suggested for today. Start a skill as new below, or add one to mixed practice.' }),
      h('p', { class: 'g-plan__foot' }, bare && plan.minutes ? h('span', { class: 'g-quiet', text: `${fmtMinutes(plan.minutes)} in all · ` }) : null, h('button', { type: 'button', class: 'g-link', onclick: dismiss }, 'Not today')));
    return node;
  }

  /* ------------------------------------------------------------ stats */
  function renderStats() {
    const now = Date.now();
    const ids = [...skills.keys()];
    const states = gstore.getStates();
    const attempts = gstore.getAttempts();
    const by = stats.byState(new Map(ids.map((id) => [id, stateOf(id)])), ids);
    const t = stats.totals(attempts, now);
    const days = stats.perDay(attempts, { days: 7, now }).filter((d) => d.items);
    const per = stats.perSkill(attempts, ids);
    const conf = stats.confusionList(gstore.getConfusions(), skills);
    const dl = (label, value) => [h('dt', { text: label }), h('dd', { text: String(value) })];
    setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Stats' }), h('p', { class: 'g-lede', text: 'Grammar only — the reading study log is in Settings.' })),
      h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Skills' }),
        h('dl', { class: 'g-dl' }, ['mastered', 'practising', 'learning', 'lapsed', 'new'].map((s) => dl(cap(s), by[s])))),
      h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Items' }),
        h('dl', { class: 'g-dl' }, dl('Today', t.today ? `${t.today} · ${stats.fmtPct(t.accToday)} right` : '0'), dl('Last 7 days', t.week ? `${t.week} · ${stats.fmtPct(t.accWeek)} right` : '0'), dl('All time', t.all ? `${t.all} · ${stats.fmtPct(t.accAll)} right · ${stats.fmtMin(t.ms)}` : '0')),
        days.length ? h('table', { class: 'study__table g-table' }, h('caption', { class: 'visually-hidden', text: 'Items per day, last 7 days' }),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Day' }), h('th', { scope: 'col', class: 'study__num', text: 'Items' }), h('th', { scope: 'col', class: 'study__num', text: 'Right' }))),
          h('tbody', {}, [...days].reverse().map((d) => h('tr', {}, h('th', { scope: 'row', text: fmtDay(d.day) }), h('td', { class: 'study__num', text: String(d.items) }), h('td', { class: 'study__num', text: stats.fmtPct(Math.round((d.right / d.items) * 100)) }))))) : h('p', { class: 'g-quiet', text: 'No items in the last seven days.' })),
      h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Per skill · last 10' }),
        h('ul', { class: 'g-perskill' }, ids.filter((id) => per.get(id)?.total).map((id) => { const p = per.get(id); return h('li', { class: 'g-perskill__row' },
          h('span', { class: 'g-perskill__name' }, h('span', { class: 'g-dot', 'data-state': stateOf(id).state, 'aria-hidden': 'true' }), titleOf(id)),
          h('span', { class: 'g-perskill__dots', 'aria-label': `${p.right} of ${p.recent.length} right` }, p.recent.map((a) => h('span', { class: `g-tick${a.correct ? ' is-ok' : ''}${a.hinted ? ' is-hinted' : ''}`, 'aria-hidden': 'true', text: a.correct ? '✓' : '✗' }))),
          h('span', { class: 'g-perskill__acc', text: `${p.right} of ${p.recent.length}${p.hinted ? ` · ${p.hinted} hinted` : ''}` })); })),
        ids.every((id) => !per.get(id)?.total) ? h('p', { class: 'g-quiet', text: 'Nothing practised yet.' }) : null),
      h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Confusions' }),
        conf.length ? h('ul', { class: 'g-conf' }, conf.map((c) => h('li', {}, `${titleOf(c.a)} answered as ${titleOf(c.b)} · ${c.count} time${c.count === 1 ? '' : 's'}`, ' ', h('button', { type: 'button', class: 'g-link', onclick: () => startBlocked(c.a) }, 'practise')))) : h('p', { class: 'g-quiet', text: 'No confusions recorded — a wrong choice that names another skill is counted here.' })));
  }
  const fmtDay = (day) => { const d = new Date(`${day}T12:00:00`); return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };

  return { render, refresh, todayCard };
}
