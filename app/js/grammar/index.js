// Grammar section (GRAMMAR-PLAN.md / GRAMMAR-CONTRACT.md): mount, the Read /
// Grammar switch, data loading and the router. Nothing here runs until the
// learner opens Grammar for the first time (or the device last left it open);
// the reader is untouched either way — the section only hides the reader's
// layout with `hidden` and shows its own <section id="grammar">.
//
//   mountGrammar({ store, dict, par, reader, settings, saveSettings })   from main.js, after boot

import { loadSkills, weekSkills, lessonExampleUnits } from './lessons.js';
import { createGrammarStore } from './store-grammar.js';
import { createItems } from './items.js';
import { createUI } from './ui.js';

const LS_SECTION = 'l103.section';
const LS_WEEK = 'l103.week';
const LS_COURSE_WEEK = 'l103.grammar.courseWeek';   // the last *course* week read, kept while the reader is on the review shelf (G1-12)
const SHELF_BASE = 100;

export async function mountGrammar({ store, dict, par, reader = null, settings = {}, saveSettings = null }) {
  const root = document.getElementById('grammar');
  const buttons = [...document.querySelectorAll('[data-section]')];
  const layout = document.querySelector('.layout');
  const live = document.getElementById('live');
  if (!root || !buttons.length || !layout) return null;

  const fixture = document.documentElement.dataset.fixture === '1';
  let hooks = null;
  if (!fixture) { try { hooks = (await import('../store.js')).grammarHooks; } catch (e) { console.warn('[grammar] store hooks missing; keeping progress on this device only', e?.message || e); } }

  const drillableMemo = new Map();
  const ctx = {
    store, dict, par, reader, live, root, fixture,
    settings, saveSettings,
    index: null, gstore: null, items: null, units: [], weeks: [],
    /** The reader's current week (the device's own, or the synced last position). */
    currentWeekN() {
      const lp = ctx.settings?.lastPosition?.week_n;
      const n = Number(localStorage.getItem(LS_WEEK)) || lp || null;
      if (Number.isFinite(n) && n > 0 && n < SHELF_BASE) { try { localStorage.setItem(LS_COURSE_WEEK, String(n)); } catch { /* ignore */ } }
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    /** The last course week (n ≤ 14): the current week while it is one, else the one read before the review shelf. */
    currentCourseWeekN() {
      const n = ctx.currentWeekN();
      if (n != null && n < SHELF_BASE) return n;
      const lp = ctx.settings?.lastPosition?.week_n;
      if (Number.isFinite(lp) && lp > 0 && lp < SHELF_BASE) return lp;
      const saved = Number(localStorage.getItem(LS_COURSE_WEEK)) || null;
      return saved && saved < SHELF_BASE ? saved : null;
    },
    /** The 103 skills introduced this week (the last course week: a shelf chapter being read keeps the week's suggestions). */
    currentWeekSkills() { const n = ctx.currentCourseWeekN(); return n ? weekSkills(ctx.index, n) : []; },
    /** True when a skill can produce a drill item at all (a parse filter and at least one sentence in the library), memoised. */
    drillable(id) { if (!drillableMemo.has(id)) drillableMemo.set(id, !!ctx.items?.drillable(id)); return drillableMemo.get(id); },
    /** The grammar preferences kept in settings (unknown keys ride along in the settings blob). */
    prefs() { const g = ctx.settings?.grammar; return { preset: g?.preset ?? 'review-heavy', size: g?.size === null ? null : (Number(g?.size) || 10), oneSkill: g?.oneSkill ?? null }; },
    async savePrefs(patch) {
      const next = { ...(ctx.settings?.grammar ?? {}), ...patch };
      ctx.settings = { ...ctx.settings, grammar: next };
      try { if (saveSettings) ctx.settings = (await saveSettings({ grammar: next })) ?? ctx.settings; } catch (e) { console.warn('[grammar] preferences not saved', e?.message || e); }
    },
    section: () => document.documentElement.dataset.section ?? 'read',
    say(text) { if (live) live.textContent = text; },
  };

  let ui = null;
  let initP = null;
  async function init() {
    if (initP) return initP;
    initP = (async () => {
      root.replaceChildren(Object.assign(document.createElement('p'), { className: 'g-loading', textContent: 'Loading the grammar section…' }));
      ctx.index = await loadSkills();
      ctx.gstore = createGrammarStore({ mode: hooks ? 'idb' : 'local', hooks });
      await ctx.gstore.ready();
      // Every week in the library, review shelf included: the sentences the items are built from — with the
      // reader's grammar-focus highlights (gold items for the construction they name) and the lessons' own examples.
      ctx.weeks = await store.getWeeks();
      const lists = await Promise.all(ctx.weeks.map((w) => store.getUnits(w.n).catch(() => [])));
      ctx.units = lists.flat().filter((u) => u && typeof u.la === 'string');
      const highlights = new Map();
      const hlLists = await Promise.all(ctx.weeks.map((w) => (w.n > SHELF_BASE ? Promise.resolve([]) : store.getHighlights(w.n).catch(() => []))));
      for (const h of hlLists.flat()) { if (!h?.unit_id || !h?.text) continue; if (!highlights.has(h.unit_id)) highlights.set(h.unit_id, []); highlights.get(h.unit_id).push({ text: h.text, label: h.label ?? '', note: h.note ?? '' }); }
      const lessonUnits = new Map();
      await Promise.all([...ctx.index.skills.values()].filter((s) => s.feature === 'construction').map(async (s) => { try { lessonUnits.set(s.id, await lessonExampleUnits(s.id)); } catch { lessonUnits.set(s.id, []); } }));
      ctx.items = createItems({ units: ctx.units, lookup: dict.lookup, paradigm: par.paradigm, skills: ctx.index.skills, storage: localStorage, gold: { highlights, lessonUnits } });
      ui = createUI(ctx);
      window.latinGrammar = ctx;   // documented hook (like window.latinReader): the section's context and the item on screen
      ctx.gstore.onChange(() => ui.refresh());
      try { history.replaceState({ grammar: { name: 'map', params: {} } }, ''); } catch { /* file: */ }
      ui.render('map', {}, { push: false, focus: false });
      // The pools of the other skills warm up in idle time, so the map's "no sentences yet" rows appear without a stall.
      const rest = [...ctx.index.skills.keys()];
      const warm = (deadline) => { while (rest.length && (deadline?.timeRemaining?.() ?? 8) > 4) ctx.drillable(rest.shift()); if (rest.length) schedule(warm); else ui.refresh(); };
      const schedule = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(() => fn(null), 50));
      schedule(warm);
    })().catch((e) => {
      console.error('[grammar] failed to start', e);
      root.replaceChildren(Object.assign(document.createElement('p'), { className: 'g-loading', textContent: `The grammar section could not start: ${e?.message ?? e}` }));
    });
    return initP;
  }

  // The reader's place and title are kept while Grammar is open and put back on return (G1-06 / G1-07).
  let readerScroll = 0;
  let readerTitle = null;
  function setSection(name, { focus = false } = {}) {
    const grammar = name === 'grammar';
    const was = document.documentElement.dataset.section;
    if (grammar && was !== 'grammar') { readerScroll = window.scrollY; readerTitle = document.title; }
    document.documentElement.dataset.section = grammar ? 'grammar' : 'read';
    layout.hidden = grammar;
    root.hidden = !grammar;
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.section === (grammar ? 'grammar' : 'read')));
    try { localStorage.setItem(LS_SECTION, grammar ? 'grammar' : 'read'); } catch { /* ignore */ }
    if (grammar) { init().then(() => { if (focus) root.querySelector('h1, h2, [tabindex="-1"]')?.focus?.({ preventScroll: true }); }); ui?.refresh(); }
    else {
      document.title = readerTitle && !/^Grammar — /.test(readerTitle) ? readerTitle : document.title.replace(/^Grammar — /, '');
      if (was === 'grammar') { const y = readerScroll; requestAnimationFrame(() => window.scrollTo({ top: y })); if (focus) document.querySelector('#reader h1, #main [tabindex="-1"], #main h2')?.focus?.({ preventScroll: true }); }
    }
  }
  for (const b of buttons) b.addEventListener('click', () => setSection(b.dataset.section, { focus: true }));
  // The reader's letter shortcuts (e / h / m / a, j / k) must not fire from inside the section.
  root.addEventListener('keydown', (e) => { if (!e.altKey && !e.ctrlKey && !e.metaKey && e.key !== 'Tab' && e.key !== 'Escape') e.stopPropagation(); });

  let last = 'read';
  try { last = localStorage.getItem(LS_SECTION) || 'read'; } catch { /* ignore */ }
  if (last === 'grammar') setSection('grammar');
  else setSection('read');

  return { open: () => setSection('grammar'), close: () => setSection('read'), ctx };
}
