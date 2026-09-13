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
import { roman, isShelfWeek } from '../sync.js';
import { createGenerator } from './generate.js';
import { createUI, learnCache } from './ui.js';
import { normaliseHintMode } from './session.js';
import { CHAPTER_MAX } from './chapter.js';

/**
 * The book's chapters, from `app/js/chapters.js` (owner A: the single source of
 * truth for chapter → readings / grammar). It is loaded lazily and once; until
 * it exists the section falls back to the numerals alone, so the by-chapter
 * view and a chapter page still work — with no titles and no readings, which is
 * all the grammar side ever reads from it.
 */
let chaptersP = null;
async function loadChapters() {
  if (!chaptersP) chaptersP = (async () => {
    try {
      const m = await import('../chapters.js');
      const list = typeof m.chapters === 'function' ? m.chapters() : m.chapters;
      if (Array.isArray(list) && list.length) return list;
      console.warn('[grammar] chapters.js exports no chapter list; falling back to the numerals');
    } catch (e) { console.warn('[grammar] chapters.js not available yet; the spine is the numerals alone', e?.message || e); }
    return null;
  })();
  return chaptersP;
}

/**
 * The `drillable` memo, kept pure so the sequence that broke it can be tested
 * without a DOM (QA-1). Asking whether a skill can produce an item means
 * scanning the library, so the answer is cached — but **only when there is a
 * generator to answer it**. `lightInit()` builds a `ui` for the weeks-menu
 * Today card while `ctx.items` is still null, and `setSection('grammar')`
 * repaints from that instance; before this the map's 87 misses were cached as
 * `false` and the whole section went quiet for the rest of the session.
 * A skill with a `set` is never memoised at all (a deck's item pool changes as
 * the learner works through it), and `clear()` runs whenever the generator is
 * rebuilt. `items()` / `skills()` are getters, so the memo follows the context.
 */
export function createDrillableMemo({ items, skills }) {
  const memo = new Map();
  return {
    clear() { memo.clear(); },
    get size() { return memo.size; },
    drillable(id) {
      const gen = items();
      if (!gen) return false;                       // no generator yet: answer, never remember
      if (skills()?.get?.(id)?.set) return !!gen.drillable(id);
      if (!memo.has(id)) memo.set(id, !!gen.drillable(id));
      return memo.get(id);
    },
  };
}

const LS_SECTION = 'l103.section';
const LS_WEEK = 'l103.week';
const LS_COURSE_WEEK = 'l103.grammar.courseWeek';   // the last *course* week read, kept while the reader is on a shelf (review or colloquia) — G1-12
/** A course week: not on either shelf (review 101–199, colloquia 201–299). */
const isCourseWeek = (n) => Number.isFinite(n) && n > 0 && !isShelfWeek(n);
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

  const drillableMemo = createDrillableMemo({ items: () => ctx.items, skills: () => ctx.skills });
  const ctx = {
    store, dict, par, reader, live, root, fixture,
    settings, saveSettings,
    index: null, gstore: null, items: null, units: [], weeks: [], sets: new Map(), skills: new Map(),
    // The book's spine (app/js/chapters.js), null until it has loaded; and the shell's way back to a chapter
    // page, which it may set through `onChapterNav` so a lesson opened from a chapter returns to it.
    chapters: null, openChapter: null, leaveChapter: null,
    /** The reader's current week (the device's own, or the synced last position). */
    currentWeekN() {
      const lp = ctx.settings?.lastPosition?.week_n;
      const n = Number(localStorage.getItem(LS_WEEK)) || lp || null;
      if (isCourseWeek(n)) { try { localStorage.setItem(LS_COURSE_WEEK, String(n)); } catch { /* ignore */ } }
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    /** The last course week (n ≤ 14): the current week while it is one, else the one read before the shelf. */
    currentCourseWeekN() {
      const n = ctx.currentWeekN();
      if (isCourseWeek(n)) return n;
      const lp = ctx.settings?.lastPosition?.week_n;
      if (isCourseWeek(lp)) return lp;
      const saved = Number(localStorage.getItem(LS_COURSE_WEEK)) || null;
      return isCourseWeek(saved) ? saved : null;
    },
    /** The 103 skills introduced this week (the last course week: a shelf chapter being read keeps the week's suggestions). */
    currentWeekSkills() { const n = ctx.currentCourseWeekN(); return n ? weekSkills(ctx.index, n) : []; },
    /** The chapter the current week reads (a shelf chapter or the course week's Familia Romana chapter), for its question set and vocabulary deck. */
    currentChapter() { const n = ctx.currentWeekN(); const w = ctx.weeks.find((x) => x.n === n); return w ? chapterOfWeek(w) : null; },
    /** The chapter sets that belong to the current week (its chapter's questions, vocabulary and pensa), for the "this week" preset. */
    currentWeekSets() { const c = ctx.currentChapter(); return c == null ? [] : [...ctx.sets.values()].filter((s) => s.chapter === c && !s.rev).map((s) => s.id); },
    /** True when a skill can produce a drill item at all (a parse filter and at least one sentence in the library; a set with items), memoised — see createDrillableMemo. */
    drillable(id) { return drillableMemo.drillable(id); },
    /** The grammar preferences kept in settings (unknown keys ride along in the settings blob). */
    // `hints` is the per-answer-box hint mode ('press' | 'always' | 'off'), riding in the same blob as the rest.
    // `populations` is what the mixed set may mix and `unstudied` whether it may reach material never opened.
    // Both are the learner's and ride in the same blob: `null` means "not chosen yet", which is not the same as
    // the empty choice `[]`, so "none" survives a reload like any other setting. Since the grid (§26) the list
    // holds two kinds of token — a whole column, `'vocab'`, or one cell, `'vocab:26'` — and the key keeps its
    // name because the old whole-column values are still valid ones: a device on an older build reads the
    // columns it knows and ignores the cells, rather than reading the whole setting as nothing.
    prefs() { const g = ctx.settings?.grammar; return { preset: g?.preset ?? 'review-heavy', size: g?.size === null ? null : (Number(g?.size) || 10), oneSkill: g?.oneSkill ?? null, view: g?.view === 'chapter' ? 'chapter' : 'topic', hints: normaliseHintMode(g?.hints), populations: Array.isArray(g?.populations) ? g.populations : null, unstudied: g?.unstudied == null ? null : !!g.unstudied }; },
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
    /** Open the section on a view (the Today card's Start buttons in the weeks menu; a chapter panel's actions). */
    go(view, params = {}) {
      leaveChapterPage();
      if (view === 'read') { setSection('read', { focus: true }); return; }
      setSection('grammar');
      init().then(() => ui?.render(view, params));
    },
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
    drillableMemo.clear();   // a new generator answers afresh (QA-1)
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
      ctx.chapters = ctx.chapters ?? await loadChapters();
      ctx.gstore = createGrammarStore({ mode: hooks ? 'idb' : 'local', hooks, localPensa, learnCache: learnCache() });
      await ctx.gstore.ready();
      // Every week in the library, review shelf included: the sentences the items are built from — with the
      // reader's grammar-focus highlights (gold items for the construction they name) and the lessons' own examples.
      ctx.weeks = await store.getWeeks();
      const lists = await Promise.all(ctx.weeks.map((w) => store.getUnits(w.n).catch(() => [])));
      ctx.units = lists.flat().filter((u) => u && typeof u.la === 'string');
      // `?fixture=1`: the fixture chapter sets refer to the fixture's own invented sentences (their span
      // references index those), so they stand in front of whatever the fixture store loaded for the same id.
      if (fixture) {
        const own = await fetchJson('units.json').catch(() => null);
        const list = (Array.isArray(own?.units) ? own.units : []).filter((u) => u && typeof u.la === 'string');
        if (list.length) { const ids = new Set(list.map((u) => u.id)); ctx.units = [...list, ...ctx.units.filter((u) => !ids.has(u.id))]; }
      }
      const highlights = new Map();
      const hlLists = await Promise.all(ctx.weeks.map((w) => (isShelfWeek(w.n) ? Promise.resolve([]) : store.getHighlights(w.n).catch(() => []))));
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
      ctx.chapters = ctx.chapters ?? await loadChapters();
      if (!ctx.gstore) { ctx.gstore = createGrammarStore({ mode: hooks ? 'idb' : 'local', hooks, localPensa, learnCache: learnCache() }); await ctx.gstore.ready(); }
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

  /**
   * A view opened from a chapter page has to leave that page first: the shell
   * hides the whole section while `html[data-page="chapter"]` is set, so a
   * lesson or a session would run behind it. The shell's own way out is
   * `onLeaveChapter`; without it we clear the chapter route, which its
   * hashchange handler reads as "no chapter".
   */
  function leaveChapterPage() {
    if (document.documentElement.dataset.page !== 'chapter') return;
    if (typeof ctx.leaveChapter === 'function') { ctx.leaveChapter(); return; }
    if (location.hash) { try { location.hash = ''; } catch { /* file: */ } }
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

  /**
   * The grammar of one chapter, rendered into the shell's own element on a
   * chapter page (GRAMMAR-CONTRACT.md "Chapter spine"): the chapter's skills
   * with their states and the actions the map offers, its question set,
   * vocabulary deck and pensa, and "Practise this chapter".
   *
   * It paints twice on a cold start — the rows and their states as soon as the
   * skill map and the store are there, then the whole thing once the library
   * has been read — because what can be drilled cannot be known before the
   * generator exists, and a row must never claim otherwise (QA-B1's rule).
   * Returns a small handle: `refresh()` repaints it, `destroy()` empties it.
   */
  async function mountChapterPanel(el, { chapter } = {}) {
    const n = Number(chapter);
    if (!el) return null;
    if (!Number.isFinite(n) || n < 1 || n > CHAPTER_MAX) { console.warn(`[grammar] no such chapter: ${chapter}`); return null; }
    el.replaceChildren(Object.assign(document.createElement('p'), { className: 'g-loading', textContent: 'Loading this chapter’s grammar…' }));
    try {
      if (!initP) { await lightInit(); ui?.chapterPanel?.(el, { chapter: n, known: false }); }
      await init();
      ui?.chapterPanel?.(el, { chapter: n });
    } catch (e) {
      console.error('[grammar] the chapter panel could not be built', e);
      el.replaceChildren(Object.assign(document.createElement('p'), { className: 'g-loading', textContent: `This chapter’s grammar could not be loaded: ${e?.message ?? e}` }));
      return null;
    }
    return { chapter: n, refresh: () => ui?.chapterPanel?.(el, { chapter: n }), destroy: () => el.replaceChildren() };
  }
  mounted = { mountChapterPanel };

  return {
    open: () => setSection('grammar'), close: () => setSection('read'), ctx,
    /** The Today card for the weeks menu (main.js): null while the plan is dismissed for the day or the section failed to start. */
    async todayCard(opts = {}) { await lightInit(); return ui ? ui.todayCard({ ...opts, place: 'weeks' }) : null; },
    /** A chapter page's grammar section (also exported on its own, below). */
    mountChapterGrammar: mountChapterPanel,
    /**
     * How the section gets back to a chapter page: the shell passes its own
     * router (`(n) => location.hash = `#/chapter/${n}``), and a lesson, a
     * history page or a session opened from a chapter offers "← Cap. VII".
     * Without it the section falls back to its own by-chapter view.
     */
    onChapterNav(fn) { ctx.openChapter = typeof fn === 'function' ? fn : null; },
    /**
     * How the section leaves a chapter page when one of its rows opens a
     * lesson, a history page or a session: the shell passes its own `goHome`.
     * Without it the section clears the chapter route itself, which the
     * shell's hashchange handler reads the same way.
     */
    onLeaveChapter(fn) { ctx.leaveChapter = typeof fn === 'function' ? fn : null; },
  };
}

/** The section instance `mountGrammar` created, so the shell can reach the chapter panel as a plain import. */
let mounted = null;
/**
 * `mountChapterGrammar(el, { chapter })` — the chapter page's grammar section.
 * Call `mountGrammar()` first (main.js does, at the end of boot); this is the
 * same function the returned handle carries.
 */
export async function mountChapterGrammar(el, opts = {}) {
  if (!mounted) { console.warn('[grammar] mountChapterGrammar before mountGrammar: nothing to render into'); return null; }
  return mounted.mountChapterPanel(el, opts);
}
