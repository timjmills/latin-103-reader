// Grammar section (GRAMMAR-PLAN.md / GRAMMAR-CONTRACT.md): mount, the Read /
// Grammar switch, data loading and the router. Nothing here runs until the
// learner opens Grammar for the first time (or the device last left it open);
// the reader is untouched either way — the section only hides the reader's
// layout with `hidden` and shows its own <section id="grammar">.
//
//   mountGrammar({ store, dict, par, reader, settings, saveSettings })   from main.js, after boot

import { loadSkills, weekSkills } from './lessons.js';
import { createGrammarStore } from './store-grammar.js';
import { createItems } from './items.js';
import { createUI } from './ui.js';

const LS_SECTION = 'l103.section';
const LS_WEEK = 'l103.week';

export async function mountGrammar({ store, dict, par, reader = null, settings = {}, saveSettings = null }) {
  const root = document.getElementById('grammar');
  const buttons = [...document.querySelectorAll('[data-section]')];
  const layout = document.querySelector('.layout');
  const live = document.getElementById('live');
  if (!root || !buttons.length || !layout) return null;

  const fixture = document.documentElement.dataset.fixture === '1';
  let hooks = null;
  if (!fixture) { try { hooks = (await import('../store.js')).grammarHooks; } catch (e) { console.warn('[grammar] store hooks missing; keeping progress on this device only', e?.message || e); } }

  const ctx = {
    store, dict, par, reader, live, root, fixture,
    settings, saveSettings,
    index: null, gstore: null, items: null, units: [], weeks: [],
    /** The reader's current week (the device's own, or the synced last position). */
    currentWeekN() {
      const lp = ctx.settings?.lastPosition?.week_n;
      const n = Number(localStorage.getItem(LS_WEEK)) || lp || null;
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    /** The 103 skills introduced this week (the week must be a course week, not the review shelf). */
    currentWeekSkills() { const n = ctx.currentWeekN(); return n && n < 100 ? weekSkills(ctx.index, n) : []; },
    /** The grammar preferences kept in settings (unknown keys ride along in the settings blob). */
    prefs() { const g = ctx.settings?.grammar; return { preset: g?.preset ?? 'review-heavy', size: g?.size === null ? null : (Number(g?.size) || 10), oneSkill: g?.oneSkill ?? null }; },
    async savePrefs(patch) {
      const next = { ...(ctx.settings?.grammar ?? {}), ...patch };
      ctx.settings = { ...ctx.settings, grammar: next };
      try { if (saveSettings) ctx.settings = (await saveSettings({ grammar: next })) ?? ctx.settings; } catch (e) { console.warn('[grammar] preferences not saved', e?.message || e); }
    },
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
      // Every week in the library, review shelf included: the sentences the items are built from.
      ctx.weeks = await store.getWeeks();
      const lists = await Promise.all(ctx.weeks.map((w) => store.getUnits(w.n).catch(() => [])));
      ctx.units = lists.flat().filter((u) => u && typeof u.la === 'string');
      ctx.items = createItems({ units: ctx.units, lookup: dict.lookup, paradigm: par.paradigm, skills: ctx.index.skills, storage: localStorage });
      ui = createUI(ctx);
      window.latinGrammar = ctx;   // documented hook (like window.latinReader): the section's context and the item on screen
      ctx.gstore.onChange(() => ui.refresh());
      ui.render('map');
    })().catch((e) => {
      console.error('[grammar] failed to start', e);
      root.replaceChildren(Object.assign(document.createElement('p'), { className: 'g-loading', textContent: `The grammar section could not start: ${e?.message ?? e}` }));
    });
    return initP;
  }

  function setSection(name, { focus = false } = {}) {
    const grammar = name === 'grammar';
    document.documentElement.dataset.section = grammar ? 'grammar' : 'read';
    layout.hidden = grammar;
    root.hidden = !grammar;
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.section === (grammar ? 'grammar' : 'read')));
    try { localStorage.setItem(LS_SECTION, grammar ? 'grammar' : 'read'); } catch { /* ignore */ }
    if (grammar) { init().then(() => { if (focus) root.querySelector('h1, h2, [tabindex="-1"]')?.focus?.({ preventScroll: true }); }); ui?.refresh(); }
    else document.title = document.title.replace(/^Grammar — /, '');
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
