// Grammar section (GRAMMAR-PLAN.md / GRAMMAR-CONTRACT.md): mount, the Read /
// Grammar switch, data loading and the router. Nothing here runs until the
// learner opens Grammar for the first time (or the device last left it open,
// or the weeks menu asks for the Today card); the reader is untouched either
// way — the section only hides the reader's layout with `hidden` and shows
// its own <section id="grammar">.
//
//   mountGrammar({ store, dict, par, reader, settings, saveSettings })   from main.js, after boot
//     → { open, close, ctx, todayCard({ unread, pace }) → Promise<node | null> }   (the card the weeks menu shows)

import { loadSkills, weekSkills, lessonExampleUnits } from './lessons.js';
import { createGrammarStore } from './store-grammar.js';
import { createItems } from './items.js';
import { createStage3 } from './stage3.js';
import { createSetLoader, createSetItems, setSkills, groupPensa, chapterOfWeek, manifestChapters } from './sets.js';
import { roman } from '../sync.js';
import { createGenerator } from './generate.js';
import { createUI } from './ui.js';

const LS_SECTION = 'l103.section';
const LS_WEEK = 'l103.week';
const LS_COURSE_WEEK = 'l103.grammar.courseWeek';   // the last *course* week read, kept while the reader is on the review shelf (G1-12)
const SHELF_BASE = 100;
// The public chapter sets ship with the app; `?fixture=1` reads two chapters of each from tests/fixtures/grammar/ (served from the repo root).
const DATA_BASE = new URL('../../data/grammar/', import.meta.url);
const FIXTURE_BASE = new URL('../../../tests/fixtures/grammar/', import.meta.url);

export async function mountGrammar({ store, dict, par, reader = null, settings = {}, saveSettings = null }) {
  const root = document.getElementById('grammar');
  const buttons = [...document.querySelectorAll('[data-section]')];
  const layout = document.querySelector('.layout');
  const live = document.getElementById('live');
  if (!root || !buttons.length || !layout) return null;

  const fixture = document.documentElement.dataset.fixture === '1';
  let hooks = null;
  if (!fixture) { try { hooks = (await import('../store.js')).grammarHooks; } catch (e) { console.warn('[grammar] store hooks missing; keeping progress on this device only', e?.message || e); } }
  const dataBase = fixture ? FIXTURE_BASE : DATA_BASE;
  const fetchJson = async (name) => { const res = await fetch(new URL(name, dataBase)); if (!res.ok) throw new Error(`${name}: ${res.status}`); return res.json(); };
  // The fixture pensa: tests/fixtures/grammar/pensa/index.json lists the chapters, NN.json holds the rows (the real store pulls public.pensa).
  const localPensa = fixture ? async () => { const chapters = manifestChapters(await fetchJson('pensa/index.json')) ?? []; const docs = await Promise.all(chapters.map((c) => fetchJson(`pensa/${String(c).padStart(2, '0')}.json`).catch(() => null))); return docs.flatMap((d) => (Array.isArray(d) ? d : Array.isArray(d?.rows) ? d.rows : [])); } : null;

  const drillableMemo = new Map();
  const ctx = {
    store, dict, par, reader, live, root, fixture,
    settings, saveSettings,
    index: null, gstore: null, items: null, units: [], weeks: [], sets: new Map(), skills: new Map(),
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
    /** The chapter the current week reads (a shelf chapter or the course week's Familia Romana chapter), for its question set and vocabulary deck. */
    currentChapter() { const n = ctx.currentWeekN(); const w = ctx.weeks.find((x) => x.n === n); return w ? chapterOfWeek(w) : null; },
    /** The chapter sets that belong to the current week (its chapter's questions, vocabulary and pensa), for the "this week" preset. */
    currentWeekSets() { const c = ctx.currentChapter(); return c == null ? [] : [...ctx.sets.values()].filter((s) => s.chapter === c && !s.rev).map((s) => s.id); },
    /** True when a skill can produce a drill item at all (a parse filter and at least one sentence in the library; a set with items), memoised. */
    drillable(id) { if (ctx.skills.get(id)?.set) return !!ctx.items?.drillable(id); if (!drillableMemo.has(id)) drillableMemo.set(id, !!ctx.items?.drillable(id)); return drillableMemo.get(id); },
    /** The grammar preferences kept in settings (unknown keys ride along in the settings blob). */
    prefs() { const g = ctx.settings?.grammar; return { preset: g?.preset ?? 'review-heavy', size: g?.size === null ? null : (Number(g?.size) || 10), oneSkill: g?.oneSkill ?? null }; },
    async savePrefs(patch) {
      const next = { ...(ctx.settings?.grammar ?? {}), ...patch };
      ctx.settings = { ...ctx.settings, grammar: next };
      try { if (saveSettings) ctx.settings = (await saveSettings({ grammar: next })) ?? ctx.settings; } catch (e) { console.warn('[grammar] preferences not saved', e?.message || e); }
    },
    /** Any other settings key (todayDismissed). */
    /** Any other settings key (todayDismissed). Returns false when the write failed, so the caller does not report success (m20). */
    async saveSetting(patch) {
      ctx.settings = { ...ctx.settings, ...patch };
      try { if (saveSettings) ctx.settings = (await saveSettings(patch)) ?? ctx.settings; } catch (e) { console.warn('[grammar] setting not saved', e?.message || e); return false; }
      return true;
    },
    section: () => document.documentElement.dataset.section ?? 'read',
    say(text) { if (live) live.textContent = text; },
    /** Open the section on a view (the Today card's Start buttons, from the weeks menu). */
    go(view, params = {}) { if (view === 'read') { setSection('read', { focus: true }); return; } setSection('grammar'); init().then(() => ui?.render(view, params)); },
  };

  let ui = null;
  let initP = null;
  let lightP = null;
  let baseItems = null;
  // One loader for the whole section: the cheap Today card fetches the current chapter through it, and the full
  // section's loadAll later reuses everything already in its cache.
  const loader = createSetLoader({ fetchJson });
  /** The chapter sets as skills, from the public files and the store's pensa; rebuilt when the pensa change. */
  function buildSets(loaded) {
    ctx.sets = setSkills({ questions: loaded.questions, vocab: loaded.vocab, pensa: groupPensa(ctx.gstore.getPensa()), weeks: ctx.weeks });
    ctx.skills = new Map([...ctx.index.skills, ...ctx.sets]);
    const setItems = createSetItems({ sets: ctx.sets, units: ctx.units, pool: baseItems.pool });
    ctx.items = createGenerator({ items: baseItems, stage3: createStage3({ items: baseItems, paradigm: par.paradigm }), sets: setItems, skills: ctx.skills });
  }
  async function init() {
    if (initP) return initP;
    initP = (async () => {
      root.replaceChildren(Object.assign(document.createElement('p'), { className: 'g-loading', textContent: 'Loading the grammar section…' }));
      ctx.index = await loadSkills();
      ctx.gstore = createGrammarStore({ mode: hooks ? 'idb' : 'local', hooks, localPensa });
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
      baseItems = createItems({ units: ctx.units, lookup: dict.lookup, paradigm: par.paradigm, skills: ctx.index.skills, storage: localStorage, gold: { highlights, lessonUnits } });
      // The chapter sets: question sets and vocabulary decks (public), pensa (private, through the grammar store).
      const loaded = await loader.loadAll();
      buildSets(loaded);
      ui?.dispose?.();
      ui = createUI(ctx);
      window.latinGrammar = ctx;   // documented hook (like window.latinReader): the section's context and the item on screen
      let pensaCount = ctx.gstore.getPensa().length;
      ctx.gstore.onChange(() => { const n = ctx.gstore.getPensa().length; if (n !== pensaCount) { pensaCount = n; buildSets(loaded); } ui.refresh(); });
      try { history.replaceState({ grammar: { name: 'map', params: {} } }, ''); } catch { /* file: */ }
      if (ctx.section() === 'grammar') ui.render('map', {}, { push: false, focus: false });
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

  /**
   * The cheap path behind the weeks menu's Today card (CR M6 / QA). Opening the
   * week button used to boot the whole section: every week's units and
   * highlights, every construction lesson's examples, and all 68 chapter JSON
   * files. It now loads the skill map, the grammar store and **the current
   * chapter's two files**, and builds the card from those; a set the learner
   * already has in rotation but whose file is not loaded gets a stub row with
   * its title and state, which is all the card prints. Opening Grammar itself
   * still runs the full `init()`.
   */
  async function lightInit() {
    if (initP) { await initP; return; }
    if (lightP) return lightP;
    lightP = (async () => {
      ctx.index = ctx.index ?? await loadSkills();
      if (!ctx.gstore) { ctx.gstore = createGrammarStore({ mode: hooks ? 'idb' : 'local', hooks, localPensa }); await ctx.gstore.ready(); }
      if (!ctx.weeks.length) ctx.weeks = await store.getWeeks();
      const chapter = ctx.currentChapter();
      const loaded = chapter != null ? await loader.loadChapter(chapter) : { questions: new Map(), vocab: new Map() };
      const sets = setSkills({ questions: loaded.questions, vocab: loaded.vocab, pensa: groupPensa(ctx.gstore.getPensa()), weeks: ctx.weeks });
      // A vocabulary deck in rotation from another chapter: the card names it and offers ten due items; its own file
      // is fetched when the section opens. `count` is unknown here, so the row claims no more than a session holds.
      for (const [id] of ctx.gstore.getStates()) {
        const m = /^(questions|vocab|pensum)-(\d{2})(-rev)?$/.exec(id);
        if (!m || sets.has(id)) continue;
        const c = Number(m[2]);
        const label = m[1] === 'questions' ? 'Questions' : m[1] === 'vocab' ? 'Vocabulary' : 'Pensa';
        sets.set(id, { id, set: m[1] === 'questions' ? 'questions' : m[1], chapter: c, rev: !!m[3], title: `${label} · Cap. ${roman(c)}${m[3] ? ' · English → Latin' : ''}`, plain: '', kinds: [m[1] === 'questions' ? 'question' : m[1] === 'vocab' ? 'vocab' : 'pensum'], count: 10, confusable_with: [], prereqs: [], stub: true });
      }
      ctx.sets = sets;
      ctx.skills = new Map([...ctx.index.skills, ...ctx.sets]);
      ui = createUI(ctx);   // no `items`: the card falls back to "a skill with a parse filter is drillable"
    })().catch((e) => { console.warn('[grammar] the Today card could not be built', e?.message || e); lightP = null; throw e; });
    return lightP;
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
    if (grammar) { init().then(() => { if (was !== 'grammar' && ui && !root.querySelector('.g')) ui.render('map', {}, { push: false, focus: false }); if (focus) root.querySelector('h1, h2, [tabindex="-1"]')?.focus?.({ preventScroll: true }); }); ui?.refresh(); }
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

  return {
    open: () => setSection('grammar'), close: () => setSection('read'), ctx,
    /** The Today card for the weeks menu (main.js): null while the plan is dismissed for the day or the section failed to start. */
    async todayCard(opts = {}) { await lightInit(); return ui ? ui.todayCard({ ...opts, place: 'weeks' }) : null; },
  };
}
