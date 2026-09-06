// Grammar section views: the skill map, the lesson, the Learn flow, the
// Practice setup, the session runner (type / choice / chart / tap), feedback,
// the end-of-session summary and the stats page. Calm tone, no gamification.
// Every Latin word in a drill is tappable for its entry (a small popover built
// from dictionary.describe); the target's dictionary form sits under the item.

import { chapters, roman, inline, loadLesson, KEY_CLASS, KEY_MODELS, entryOfClass, highlightParses } from './lessons.js';
import { renderParadigm } from '../wordpanel.js';
import { isShelfWeek } from '../sync.js';
import { tokenize } from '../tokenize.js';
import { decay, isDue, overdueRatio, newState, addToPractice, reviewFirst, suggestToday, inRotation, buildPairSession, DAY_MS } from './scheduler.js';
import { createLearn, createPractice, createBlockedFive, boxHints, normaliseHintMode, HINT_MODES, HINT_MODE_LABEL } from './session.js';
import { featureLabel, featureKey } from './items.js';
import { setsOfChapter, setChapters, phraseIndexes } from './sets.js';
import { spine, spineRows, chapterMaterial, chapterProgress, chapterPool, chapterSummary, normaliseView } from './chapter.js';
import { orderInput, matchInput } from './inputs.js';
import { buildToday, fmtMinutes } from './today.js';
import * as stats from './stats.js';
import { localDay } from './stats.js';
import { buildChart, buildSheet, printDocument } from './print.js';

const LS_SESSION = 'l103.grammar.session';      // the practice session in progress (plan, position, log) — Back / Reload can resume it
const LS_QUEUE = 'l103.grammar.learnQueue';     // "Start all as new": the skills still to go through Learn
const LS_LEARN = 'l103.grammar.learn';          // a chapter set's Learn pass in progress: how far through the deck (session.js batches it)
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
      ['map', 'practice', 'stats'].map((v) => h('button', { type: 'button', class: 'g-nav__btn', 'aria-current': (view.name === v || (v === 'practice' && ['setup', 'session', 'blocked', 'summary'].includes(view.name)) || (v === 'map' && ['lesson', 'learn'].includes(view.name)) || (v === 'stats' && view.name === 'history')) ? 'page' : null, onclick: () => render(v === 'practice' ? 'setup' : v) },
        { map: 'Skills', practice: 'Practice', stats: 'Stats' }[v])));
    body = h('div', { class: 'g-body' });
    root.replaceChildren(h('div', { class: 'g' }, nav, body));
    const fn = { map: renderMap, lesson: renderLessonView, learn: renderLearnStart, setup: renderSetup, session: renderPracticeStart, blocked: renderBlocked, stats: renderStats, history: renderHistory, summary: () => renderMap() };
    (fn[view.name] ?? renderMap)(view.params);
    document.title = `Grammar — Latin 103`;
  }
  /** Show a view. Each is a history entry (Back walks the section's views; a session in progress resumes); the new heading takes focus. */
  function render(name, params = {}, { push = true, focus = true } = {}) {
    closePop();
    // The map is 87 rows long: coming back from a lesson or a history page at scrollY 0 means hunting
    // for the skill you left (QA-B10). Its place is kept and restored; every other view opens at the top.
    if (view.name === 'map' && name !== 'map') mapScroll[mapView] = window.scrollY;
    view = { name, params };
    if (push) { try { history.pushState({ grammar: { name, params: name === 'session' ? { ...params, resume: true } : params } }, ''); } catch { /* file: URLs */ } }
    draw();
    // Each of the two map views keeps its own place: coming back from a lesson lands where it was left, in the view it was left in.
    window.scrollTo({ top: name === 'map' ? (params.chapter != null ? 0 : mapScroll[mapView]) : 0 });
    if (focus) body.querySelector('h1')?.focus?.({ preventScroll: true });
  }
  const mapScroll = { topic: 0, chapter: 0 };
  // Which of the two Grammar views the map shows — By topic (the category map) or By chapter (the book's spine).
  // Remembered in settings.grammar.view, so the choice survives a reload and a return from a lesson.
  let mapView = normaliseView(ctx.prefs?.().view);
  // The light instance behind the weeks-menu Today card has no generator, so it must never paint the
  // map: every row would read "no sentences in the library yet" until `init()` replaced it (QA-1).
  function refresh() { if (!ctx.items) return; if (['map', 'stats', 'history'].includes(view.name) && showing()) draw(); repaintPanels(); }
  /** True while the section itself is the thing on screen: `draw()` renames the document, so it must not run behind a chapter page. */
  const showing = () => (ctx.section?.() ?? 'grammar') === 'grammar';
  // The chapter pages' grammar panels (index.js's mountChapterGrammar). They are repainted whenever the
  // section's own state changes, and dropped as soon as the shell has taken their element out of the document.
  const panels = new Set();
  function repaintPanels() { for (const p of [...panels]) { if (!p.el?.isConnected) { panels.delete(p); continue; } chapterPanel(p.el, { chapter: p.chapter }); } }
  /** Redraw what is on screen: the current view when the section is showing, and every mounted chapter panel. */
  function repaint() { if (showing() && body) draw(); repaintPanels(); }
  // The new heading takes focus whenever the body is replaced and focus has nowhere to be (a view arriving after a lesson fetch, the end of a session) — G1-09.
  const setBody = (...nodes) => { body.replaceChildren(...nodes.flat(Infinity).filter(Boolean)); const f = body.querySelector('h1'); if (f) { f.tabIndex = -1; const a = document.activeElement; if (!a || a === document.body || !body.contains(a)) f.focus({ preventScroll: true }); } };
  // The section may be built twice in a life: once cheaply for the weeks-menu Today card, then in full when Grammar is
  // opened. `dispose()` takes the first instance's listener off so the two never both answer a Back.
  const onPop = (e) => {
    const g = e.state?.grammar;
    if (!g || ctx.section?.() === 'read') return;
    render(g.name, g.params ?? {}, { push: false });
  };
  window.addEventListener('popstate', onPop);
  const dispose = () => window.removeEventListener('popstate', onPop);

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
  /**
   * The target's dictionary line under the sentence ("puellae — from puella, girl").
   * A `blank` item has taken its target *out* of the sentence, so printing the
   * inflected form there would print the answer one line above the input (QA B1):
   * a blank shows the dictionary form and its meaning, and nothing else.
   */
  function glossNode(item) {
    const [cite, ...rest] = String(item.prompt.gloss).split(' — ');
    const meaning = rest.join(' — ');
    const dict = h('span', { lang: 'la', class: 'entry__cite', text: cite });
    if (item.kind === 'blank' || !item.target?.text) return h('p', { class: 'g-gloss' }, dict, ` — ${meaning}`);
    return h('p', { class: 'g-gloss' }, h('span', { lang: 'la', text: item.target.text }), ' — from ', dict, `, ${meaning}`);
  }
  /** "Show all meanings": every word's first reading under the sentence. */
  function glossList(item) {
    // A blank item's `meanings` still carry the word the blank replaced; listing it would hand over the answer.
    const hide = item.kind === 'blank' ? item.target?.start ?? null : null;
    const rows = (item.meanings || []).filter((m) => hide == null || m.start !== hide).map((m) => {
      // The *printed* word, macrons and all — `m.form` is stripped, and stripped means māla (apples)
      // reads as mala (bad). Where the dictionary cannot tell the two apart it says so, and both
      // readings are shown rather than one of them chosen (QA B3).
      const res = dict.lookup(m.text);
      const sense = (e) => { const d = e ? dict.describe(e, { compact: true, form: m.text }) : null; return d ? String(d.meaning).split(/\s+·\s+/)[0] : null; };
      const head = (e) => String((e?.senses || [])[0] ?? '');
      const readings = [];
      for (const e of res.ambiguous ? res.entries : res.entries.slice(0, 1)) {
        if (readings.length >= 3 || readings.some((r) => r.head === head(e))) continue;
        const s = sense(e);
        if (s && !readings.some((r) => r.text === s)) readings.push({ head: head(e), text: s });
      }
      const text = readings.length ? readings.map((r) => r.text).join(' · or ') : 'not in the glossary';
      return h('li', {}, h('span', { lang: 'la', class: 'g-all__la', text: m.text }), ' — ', h('span', { class: `g-all__en${readings.length ? '' : ' g-quiet'}`, text }));
    });
    return h('ul', { class: 'g-all', 'aria-label': 'All meanings' }, rows);
  }

  /* -------------------------------------------------------------- map */
  /** Switch between the two ways of browsing the grammar; the choice is remembered (GRAMMAR-CONTRACT.md "Chapter spine"). */
  function setMapView(next) {
    const v = normaliseView(next);
    if (v === mapView) return;
    mapScroll[mapView] = window.scrollY;
    mapView = v;
    ctx.savePrefs?.({ view: v });     // savePrefs swallows its own failures; the view is right either way for this visit
    view.params = { ...view.params, chapter: undefined };
    draw();
    window.scrollTo({ top: mapScroll[mapView] });
  }
  const viewSwitch = () => h('div', { class: 'g-seg g-seg--views', role: 'group', 'aria-label': 'Browse the grammar' },
    [['topic', 'By topic'], ['chapter', 'By chapter']].map(([v, label]) => btn(label, { 'aria-pressed': String(mapView === v), onclick: () => setMapView(v) }, 'g-seg__btn')));

  /** Today: the daily plan (today.js), with the run in progress and the "start all as new" queue above it. Both map views carry it. */
  function todaySection() {
    const saved = readJSON(LS_SESSION, null);
    const queue = (readJSON(LS_QUEUE, []) || []).filter((id) => skills.has(id) && stateOf(id).state !== 'practising' && stateOf(id).state !== 'mastered');
    return h('section', { class: 'g-today', 'aria-labelledby': 'g-today-h' },
      h('h2', { id: 'g-today-h', class: 'g-h2', text: 'Today' }),
      saved?.queue?.length && saved.index < saved.queue.length ? h('p', { class: 'g-today__line' }, `A practice session is in progress (${Math.min(saved.index, saved.queue.length)} of ${saved.queue.length} answered). `, btn('Resume', { onclick: () => render('session', { ...(saved.params ?? {}), resume: true }) }, 'btn btn--primary g-today__btn'), ' ', btn('Discard', { onclick: () => { writeJSON(LS_SESSION, null); draw(); } }, 'btn btn--quiet g-today__btn')) : null,
      queue.length ? h('p', { class: 'g-today__line' }, `Learning in book order: ${queue.length} skill${queue.length === 1 ? '' : 's'} to go, next `, h('button', { type: 'button', class: 'g-link', onclick: () => render('learn', { skill: queue[0], queue: queue.slice(1) }) }, titleOf(queue[0])), '. ', btn('Stop the run', { onclick: () => { writeJSON(LS_QUEUE, null); draw(); } }, 'btn btn--quiet g-today__btn')) : null,
      todayCard({ place: 'map', bare: true }));
  }

  function renderMap(params = {}) {
    if (mapView === 'chapter') return renderSpine(params);
    const now = Date.now();
    const states = gstore.getStates();
    const cw = ctx.currentWeekSkills();
    const rf = reviewFirst({ weekSkills: cw, skills, states, now });
    const filter = view.params.category ?? 'all';

    const head = h('header', { class: 'g-head' },
      h('h1', { class: 'g-title', text: 'Skills' }),
      // The pensa arrive from the private library, so the lede only promises them once some are here.
      h('p', { class: 'g-lede', text: `${index.skills.size} skills in book order, with each chapter's questions, vocabulary${[...skills.values()].some((s) => s.set === 'pensum') ? ' and pensa' : ''}. Start a skill as new to learn it in one sitting, or add it straight to mixed practice.` }));

    const todayNode = todaySection();

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
      btn('Print charts', { onclick: () => printCharts(filter), 'aria-label': filter === 'all' ? 'Print the paradigm charts of every skill' : `Print the paradigm charts of the ${filter.replace('-', ' ')} skills` }, 'btn btn--quiet'),
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
      // The count is of what the filter is showing: "0 of 4 mastered" over three set rows read as a miscount (m18).
      const counted = [...shown, ...shownSets];
      const mastered = counted.filter((s) => stateOf(s.id).state === 'mastered').length;
      return h('section', { class: 'g-chap', 'aria-labelledby': `g-chap-${chapter}` },
        h('h2', { id: `g-chap-${chapter}`, class: 'g-chap__h' }, h('span', { class: 'g-chap__num', text: `Cap. ${roman(chapter)}` }), counted.length ? h('span', { class: 'g-chap__count', text: `${mastered} of ${counted.length} mastered` }) : null),
        shown.length ? h('ul', { class: 'g-skills' }, shown.map((s) => skillRow(s))) : null,
        shownSets.length ? h('div', { class: 'g-sets' }, h('h3', { class: 'g-sets__h', text: 'Chapter sets' }), h('ul', { class: 'g-skills g-skills--sets' }, shownSets.map((s) => setRow(s)))) : null);
    });

    setBody(head, viewSwitch(), todayNode, reviewNode, filterNode, bulk, chapterNodes);
  }

  /* -------------------------------------------------- by chapter (the spine) */
  /**
   * The book's spine: chapters I–XXXIV in order, each holding its own skills
   * and chapter sets and saying how much of it is mastered. The chapter being
   * read (or the one a link named) is open; the rest are folded away, so 34
   * chapters stay a page you can read down.
   */
  function renderSpine(params = {}) {
    const rows = spineRows({ chapters: ctx.chapters ?? null, skills, order: index.order, sets: ctx.sets ?? new Map(), state: stateOf, drillable: ctx.items ? drillable : () => true });
    const here = params.chapter != null ? Number(params.chapter) : ctx.currentChapter?.() ?? null;
    // Which chapters are unfolded is the learner's: the view is redrawn on every state change, and a redraw
    // must not close what they opened. null = nothing chosen yet, so the chapter being read opens itself.
    if (params.chapter != null) { spineOpen = spineOpen ?? new Set(); spineOpen.add(Number(params.chapter)); }
    const done = rows.filter((r) => r.progress.total && r.progress.mastered === r.progress.total).length;
    const head = h('header', { class: 'g-head' },
      h('h1', { class: 'g-title', text: 'Skills' }),
      h('p', { class: 'g-lede', text: `The book's chapters in order, each with the grammar it introduces and its own questions, vocabulary${[...skills.values()].some((s) => s.set === 'pensum') ? ' and pensa' : ''}. Open a chapter to see what is in it.${done ? ` ${done} chapter${done === 1 ? ' is' : 's are'} fully mastered.` : ''}` }));
    const sections = rows.map((c) => {
      const open = spineOpen ? spineOpen.has(c.n) : (here != null && c.n === here);
      const onToggle = (e) => { if (!spineOpen) spineOpen = new Set(here != null ? [here] : []); if (e.currentTarget.open) spineOpen.add(c.n); else spineOpen.delete(c.n); };
      return h('section', { class: 'g-chap g-chap--spine', id: `g-ch-${c.n}` },
        h('details', { class: 'g-chap__d', open: open || null, ontoggle: onToggle },
          h('summary', { class: 'g-chap__sum' },
            h('h2', { class: 'g-chap__h g-chap__h--sum' }, h('span', { class: 'g-chap__num', text: `Cap. ${c.roman}` }), c.title ? h('span', { class: 'g-chap__title', text: c.title }) : null),
            h('span', { class: 'g-chap__count', text: chapterSummary(c.progress) })),
          h('div', { class: 'g-chap__body' }, chapterBody(c))));
    });
    setBody(head, viewSwitch(), todaySection(), sections);
    // The chapter a link named, or — the first time the spine is opened — the one being read: brought into view once.
    // A redraw after an answer must leave the page where the learner left it.
    if (here != null && (params.chapter != null || (!spineScrolled && !mapScroll.chapter))) {
      spineScrolled = true;
      requestAnimationFrame(() => document.getElementById(`g-ch-${here}`)?.scrollIntoView?.({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    }
  }
  let spineOpen = null;
  let spineScrolled = false;

  /**
   * One chapter's grammar as a list of nodes: its skills, its chapter sets and
   * the ways into practising it. Shared by the by-chapter view and by the
   * chapter page's panel (`chapterPanel`), so a chapter reads the same in both.
   * `known` false = the section has not loaded its generator yet, so nothing
   * claims what can or cannot be drilled.
   */
  function chapterBody(row, { from = null, nav = null, known = !!ctx.items } = {}) {
    const go = nav ?? ((name, params) => render(name, { ...params, from }));
    const { material, progress } = row;
    const out = [];
    if (!material.members.length) { out.push(h('p', { class: 'g-quiet', text: 'This chapter introduces no grammar of its own.' })); return out; }
    if (material.skills.length) out.push(h('ul', { class: 'g-skills' }, material.skills.map((s) => skillRow(s, { go, known }))));
    if (material.sets.length) out.push(h('div', { class: 'g-sets' }, h('h3', { class: 'g-sets__h', text: 'Chapter sets' }), h('ul', { class: 'g-skills g-skills--sets' }, material.sets.map((s) => setRow(s, { go, known })))));
    if (!known) { out.push(h('p', { class: 'g-quiet', text: 'Reading the library to see what can be practised…' })); return out; }
    const pool = chapterPool(material, { state: stateOf, drillable });
    if (pool.rotation.length) {
      out.push(h('div', { class: 'g-chap__acts' },
        btn('Practise this chapter', { onclick: () => go('session', { chapter: material.chapter }), 'aria-label': `Practise chapter ${row.roman}` }, 'btn btn--primary'),
        h('p', { class: 'g-quiet', text: `A mixed session of ten, drawn only from this chapter: ${pool.rotation.length} of the ${progress.drillable} it can drill ${pool.rotation.length === 1 ? 'is' : 'are'} in rotation.` })));
    } else if (pool.addable.length) {
      out.push(h('div', { class: 'g-chap__acts' },
        btn('Add this chapter to mixed practice', { onclick: () => addChapter(material) }, 'btn'),
        h('p', { class: 'g-quiet', text: 'Nothing from this chapter is in mixed practice yet. Learn a skill above, or add them all and they will come up as they fall due.' })));
    } else if (progress.drillable) {
      out.push(h('p', { class: 'g-quiet', text: 'Everything here is still being learned.' }));
    } else {
      out.push(h('p', { class: 'g-quiet', text: 'Nothing in this chapter can be drilled yet — the lessons are here to read.' }));
    }
    return out;
  }

  /** "Add this chapter to mixed practice": the chapter's new, drillable skills and sets, by the same route as the map's bulk add. */
  async function addChapter(material) {
    const pool = chapterPool(material, { state: stateOf, drillable });
    if (!pool.addable.length) { ctx.say('Nothing new to add in this chapter.'); return; }
    if (!confirm(`Add ${pool.addable.length} item${pool.addable.length === 1 ? '' : 's'} from chapter ${roman(material.chapter)} to mixed practice? Each will be practised as it comes up, without a lesson first.`)) return;
    for (const id of pool.addable) await gstore.setState(addToPractice(gstore.getState(id) ?? id));
    ctx.say(`${pool.addable.length} added from chapter ${roman(material.chapter)}.`);
    repaint();
  }

  /**
   * The chapter page's grammar panel (`mountChapterGrammar` in index.js): the
   * same rows and the same actions as the map, rendered into the shell's own
   * element. Its links open the Grammar section and carry a way back to this
   * chapter.
   */
  function chapterPanel(el, { chapter, known = !!ctx.items } = {}) {
    if (!el) return;
    const n = Number(chapter);
    const tracked = [...panels].find((p) => p.el === el);
    if (tracked) tracked.chapter = n; else panels.add({ el, chapter: n });
    const entry = spine(ctx.chapters ?? null).find((c) => c.n === n) ?? null;
    const material = chapterMaterial(n, { skills, order: index.order, sets: ctx.sets ?? new Map(), entry });
    const progress = chapterProgress(material, { state: stateOf, drillable: known ? drillable : () => true });
    const row = { n, roman: entry?.roman ?? roman(n), title: entry?.title ?? '', material, progress };
    const nav = (name, params) => (ctx.go ? ctx.go(name, { ...params, from: { chapter: n } }) : render(name, { ...params, from: { chapter: n } }));
    el.replaceChildren(h('div', { class: 'g-chapter' },
      h('header', { class: 'g-chapter__head' },
        // The chapter page's own tab already says "Grammar"; the heading is there for a screen reader
        // walking the page's structure, and the line under it is what the eye needs — the counts.
        h('h2', { class: 'g-chapter__h visually-hidden', text: `Grammar of chapter ${entry?.roman ?? roman(n)}` }),
        h('p', { class: 'g-chapter__sum', text: chapterSummary(progress) })),
      ...chapterBody(row, { nav, known })));
  }

  function skillRow(s, { go = null, known = true } = {}) {
    const nav = go ?? ((name, params) => render(name, params));
    const st = stateOf(s.id);
    const acts = [];
    const lessonBtn = btn('Lesson', { onclick: () => nav('lesson', { skill: s.id }) }, 'btn btn--quiet');
    // `known` false: the panel has states but no generator yet, so the row says nothing about what can be drilled (QA-B1's rule).
    const can = known ? drillable(s.id) : null;
    if (!known || !can) {
      // No sentence in the library fits (the metre skills by design): the lesson stands, nothing to drill (M8).
      acts.push(lessonBtn);
    } else if (st.state === 'new') {
      acts.push(btn('Start as new', { onclick: () => nav('learn', { skill: s.id }) }, 'btn'), btn('Add to mixed practice', { onclick: () => addSkill(s.id) }, 'btn btn--quiet'), lessonBtn);
    } else if (st.state === 'learning') {
      acts.push(btn('Continue learning', { onclick: () => nav('learn', { skill: s.id }) }, 'btn'), lessonBtn);
    } else if (st.state === 'lapsed') {
      acts.push(btn('Re-learn', { onclick: () => nav('learn', { skill: s.id }) }, 'btn'), btn('Practise this skill', { onclick: () => nav('blocked', { skill: s.id }) }, 'btn btn--quiet'), lessonBtn);
    } else {
      acts.push(btn('Practise this skill', { onclick: () => nav('blocked', { skill: s.id }) }, 'btn'), lessonBtn);
    }
    if (gstore.countAttempts(s.id)) acts.push(btn('History', { onclick: () => nav('history', { skill: s.id }), 'aria-label': `History of ${s.title}` }, 'btn btn--quiet'));
    if (known) acts.push(btn('Reset', { onclick: () => resetSkill(s.id), 'aria-label': `Reset ${s.title}` }, 'btn btn--quiet g-skill__reset'));
    return h('li', { class: 'g-skill', 'data-state': st.state },
      h('div', { class: 'g-skill__main' },
        h('button', { type: 'button', class: 'g-skill__title', onclick: () => nav('lesson', { skill: s.id }) }, s.title),
        h('p', { class: 'g-skill__plain', text: `${s.plain} · ${s.course} week ${s.week ?? '—'}` }),
        h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': can === false ? 'none' : st.state, 'aria-hidden': 'true' }), can === false ? (s.parse_filter ? 'no sentences in the library yet' : 'lesson only — no drill') : dueText(st))),
      h('div', { class: 'g-skill__acts' }, acts));
  }
  /** A chapter set as a row: Questions · Vocabulary (· English → Latin, optional) · Pensa — the same actions and states as a skill; pensa have no Learn. */
  function setRow(s, { go = null, known = true } = {}) {
    const nav = go ?? ((name, params) => render(name, params));
    const st = stateOf(s.id);
    const can = known ? drillable(s.id) : null;
    const acts = [];
    const learnable = s.set !== 'pensum';
    if (can === false) acts.push(h('span', { class: 'g-quiet', text: 'nothing here yet' }));
    else if (can === null) { /* not known yet: the row states its counts and nothing else */ }
    // A new set offers the two documented routes only — Start as new, or Add to mixed practice. "Practise" bypassed
    // both and put the row into rotation without the learner choosing (m16); a pensum has no Learn, so it keeps it.
    else if (st.state === 'new') { if (learnable) acts.push(btn('Start as new', { onclick: () => nav('learn', { skill: s.id }) }, 'btn')); acts.push(btn('Add to mixed practice', { onclick: () => addSkill(s.id) }, learnable ? 'btn btn--quiet' : 'btn')); if (!learnable) acts.push(btn('Practise', { onclick: () => nav('blocked', { skill: s.id }) }, 'btn btn--quiet')); }
    else if (st.state === 'learning') acts.push(btn('Continue learning', { onclick: () => nav('learn', { skill: s.id }) }, 'btn'));
    else if (st.state === 'lapsed') { if (learnable) acts.push(btn('Re-learn', { onclick: () => nav('learn', { skill: s.id }) }, 'btn')); acts.push(btn('Practise', { onclick: () => nav('blocked', { skill: s.id }) }, learnable ? 'btn btn--quiet' : 'btn')); }
    else acts.push(btn('Practise', { onclick: () => nav('blocked', { skill: s.id }) }, 'btn'));
    if (gstore.countAttempts(s.id)) acts.push(btn('History', { onclick: () => nav('history', { skill: s.id }), 'aria-label': `History of ${s.title}` }, 'btn btn--quiet'));
    if (known) acts.push(btn('Reset', { onclick: () => resetSkill(s.id), 'aria-label': `Reset ${s.title}` }, 'btn btn--quiet g-skill__reset'));
    const what = s.set === 'questions' ? `${s.count} question${s.count === 1 ? '' : 's'}${s.data?.title ? ` · ${s.data.title}` : ''}` : s.set === 'vocab' ? `${s.count} word${s.count === 1 ? '' : 's'}${s.rev ? ' · English → Latin, an optional extra deck' : ' · Latin → English'}` : `${s.data?.A.length ?? 0} A · ${s.data?.B.length ?? 0} B · ${s.data?.C.length ?? 0} C · practise only`;
    return h('li', { class: 'g-skill g-skill--set', 'data-state': st.state, 'data-set': s.set },
      h('div', { class: 'g-skill__main' },
        h('p', { class: 'g-skill__title g-skill__title--set', text: s.rev ? `${SET_ROW_LABEL[s.set]} · English → Latin` : SET_ROW_LABEL[s.set] }),
        h('p', { class: 'g-skill__plain', text: what }),
        h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': can === false ? 'none' : st.state, 'aria-hidden': 'true' }), can === false ? 'no items yet' : dueText(st))),
      h('div', { class: 'g-skill__acts' }, acts));
  }
  const drillable = (id) => ctx.drillable(id);
  async function addSkill(id) {
    if (!drillable(id)) { ctx.say(`${titleOf(id)} has no drillable sentences yet.`); return; }
    await gstore.setState(addToPractice(gstore.getState(id) ?? id)); ctx.say(`${titleOf(id)} added to mixed practice.`); repaint();
  }
  async function bulkAdd() {
    // A skill already in Learn keeps its run: the bulk add used to move it to `practising` and throw the round away (m17).
    const ids = [...skills.keys()].filter((id) => !skills.get(id).rev && !inRotation(stateOf(id)) && stateOf(id).state !== 'learning' && drillable(id));
    if (!ids.length) { ctx.say('Every skill with sentences is already in mixed practice.'); return; }
    if (!confirm(`Add ${ids.length} skill${ids.length === 1 ? '' : 's'} to mixed practice? Each will be practised as it comes up, without a lesson first.`)) return;
    for (const id of ids) await gstore.setState(addToPractice(gstore.getState(id) ?? id));
    ctx.say(`${ids.length} skills added.`); repaint();
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
    await gstore.resetSkill(id); items.pool.reset(id); ctx.say(`${titleOf(id)} reset.`); repaint();
  }
  async function resetAll() {
    if (!confirm('Reset every skill? All grammar progress, attempts and confusions are removed, including any session in progress. The reading progress and looked-up words are untouched.')) return;
    await gstore.resetAll();
    items.pool.reset();
    // Everything the reset used to leave behind: the saved practice session (resuming it re-created skill states from
    // the pre-reset queue), the "start all as new" run, a set's half-finished Learn pass, and today's dismissal (M4).
    writeJSON(LS_SESSION, null); writeJSON(LS_QUEUE, null); writeJSON(LS_LEARN, null);
    if (ctx.settings?.todayDismissed) await ctx.saveSetting?.({ todayDismissed: null });
    ctx.say('All grammar progress reset.');
    repaint();
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
  /** "Week 3 · Fabulae Syrae 1: Mīnōs", or a shelf's own name: "Familia Romana cap. VII", "Colloquia Personarum VII". */
  function unitRefText(u) {
    const m = /^([wrc])(\d+):/.exec(String(u.id ?? ''));
    const part = u.part ? ` · ${u.part}` : '';
    if (m && m[1] === 'r') return `Familia Romana cap. ${roman(Number(m[2]))}${part}`;
    if (m && m[1] === 'c') return `Colloquia Personarum ${roman(Number(m[2]))}${part}`;
    const n = u.week_n ?? (m ? Number(m[2]) : null);
    return `${n != null ? `Week ${n}` : 'Library'}${part}`;
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
  async function renderLessonView({ skill: id, from = null }) {
    const skill = skills.get(id);
    if (!skill) return renderMap();
    const st = stateOf(id);
    setBody(h('p', { class: 'g-loading', text: 'Loading the lesson…' }));
    const lesson = await lessonOf(id);
    const acts = [];
    if (st.state === 'new' || st.state === 'lapsed') acts.push(btn(st.state === 'lapsed' ? 'Re-learn this skill' : 'Start learning', { onclick: () => render('learn', { skill: id, from }) }, 'btn btn--primary'));
    if (st.state === 'learning') acts.push(btn('Continue learning', { onclick: () => render('learn', { skill: id, from }) }, 'btn btn--primary'));
    if (st.state === 'new') acts.push(btn('Add to mixed practice', { onclick: async () => { await addSkill(id); render('lesson', { skill: id, from }); } }, 'btn'));
    if (inRotation(st)) acts.push(btn('Practise this skill', { onclick: () => startBlocked(id, from) }, 'btn btn--primary'));
    // Printable charts (GRAMMAR-CONTRACT.md, wave 3): the chart alone, one table a page with the focus cells boxed,
    // or the whole sheet — rule, forms and examples. Offered only where there is something to put on the paper.
    if (!skill.set && chartTable(skill)) acts.push(btn('Print chart', { onclick: () => printChart(skill) }, 'btn btn--quiet'));
    if (!skill.set) acts.push(btn('Print sheet', { onclick: () => printSheet(skill) }, 'btn btn--quiet'));
    if (gstore.countAttempts(id)) acts.push(btn('History', { onclick: () => render('history', { skill: id, from }) }, 'btn btn--quiet'));
    setBody(
      backButton(from),
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
  async function renderLearnStart({ skill: id, queue = [], from = null }) {
    const skill = skills.get(id);
    if (!skill) return renderMap();
    if (skill.set === 'pensum') { startBlocked(id, from); return; }   // pensa are practised, never learned in a sitting
    // A chapter set's Learn pass is resumable: how far through the deck it is survives Back, a reload and a detour
    // (the pool already remembers which items have been shown, so a resumed batch never repeats one) — CR M8.
    const savedLearn = readJSON(LS_LEARN, null);
    const resume = skill.set && savedLearn?.skill === id && Number(savedLearn.seen) > 0 ? { seen: Number(savedLearn.seen) } : null;
    const onProgress = (pr) => writeJSON(LS_LEARN, pr.seen > 0 && pr.seen < pr.total ? { skill: pr.skill, seen: pr.seen, at: Date.now() } : null);
    const learn = createLearn({ skill, gstore, items, resume, onProgress });
    await learn.begin();
    const lesson = skill.set ? null : await lessonOf(id);
    const steps = skill.set ? [skill.set === 'vocab' ? 'The deck, a batch at a time' : 'The passage\'s questions', 'Blocked 10'] : ['Lesson', 'Examples', 'Guided 5', 'Blocked 10'];
    const stepper = (i) => h('ol', { class: 'g-steps', 'aria-label': 'Learn steps' }, steps.map((s, j) => h('li', { class: 'g-steps__s', 'aria-current': i === j ? 'step' : null, text: s })));
    const finishQueue = () => { writeJSON(LS_QUEUE, queue.length ? queue.slice(1) : null); if (queue.length) render('learn', { skill: queue[0], queue: queue.slice(1) }); else leaveTo(from); };
    if (queue.length) writeJSON(LS_QUEUE, queue);

    const showLesson = () => setBody(stepper(0), lessonHeader(skill, stateOf(id)), h('article', { class: 'g-lesson' }, lessonBlocks(skill, lesson, { learn: true })),
      h('div', { class: 'g-acts' }, btn('Continue to the examples', { onclick: showExamples }, 'btn btn--primary'), btn(from ? backLabel(from).replace('← ', 'Back to ') : 'Back to skills', { onclick: () => leaveTo(from) }, 'btn btn--quiet')));

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
    const showGuided = (opts = {}) => {
      const first = opts.more ? learn.moreGuided() : learn.startGuided();
      if (!first) { setBody(stepper(guidedStep), h('p', { class: 'g-quiet', text: skill.set ? 'This set has no items yet.' : 'No sentences in the library fit this skill yet, so there is nothing to drill. Add the review shelf or another week and come back.' }), h('div', { class: 'g-acts' }, backButton(from, 'btn'))); return; }
      const seenBefore = learn.seen;
      const thing = skill.set === 'vocab' ? 'words' : 'questions';
      const note = skill.set
        ? `${skill.set === 'vocab' ? 'Each word with its dictionary line after it' : 'Each question with the answering sentence after it'}. ${seenBefore + 1}–${Math.min(learn.total, seenBefore + learn.batchSize)} of ${learn.total} ${thing}; you can stop after any batch and pick it up here.`
        : 'Five items with the hint open. Take your time.';
      runSession({ runner: learn.runner, title: `${skill.set ? 'Through the deck' : 'Guided drill'} · ${skill.title}`, note, mode: 'learn', hintOpen: !skill.set, stepper: stepper(guidedStep), lesson, onDone: skill.set ? showBatchEnd : showBlocked });
    };
    /** After a batch: how far through the deck, and the three honest ways on — another batch, the blocked ten, or stop. */
    const showBatchEnd = (summary) => {
      const left = learn.left;
      const thing = skill.set === 'vocab' ? 'word' : 'question';
      setBody(stepper(guidedStep), h('header', { class: 'g-head' },
        h('h1', { class: 'g-title', text: left ? 'Batch done' : 'Through the deck' }),
        h('p', { class: 'g-lede', text: left
          ? `${summary.right} of ${summary.total} right · ${learn.seen} of ${learn.total} ${thing}s seen, ${left} to go. Stopping here keeps your place.`
          : `${summary.right} of ${summary.total} right · all ${learn.total} ${thing}s seen. Ten more, mixed, and this set joins your mixed practice.` })),
        h('p', { class: 'g-prog__wrap' }, h('progress', { class: 'g-prog', max: String(learn.total), value: String(learn.seen), 'aria-label': `${learn.seen} of ${learn.total} ${thing}s seen` })),
        h('div', { class: 'g-acts' },
          left ? btn(`Another ${Math.min(learn.batchSize, left)}`, { onclick: () => showGuided({ more: true }) }, 'btn btn--primary') : null,
          btn('Go on to the ten', { onclick: showBlocked }, left ? 'btn' : 'btn btn--primary'),
          btn('Stop for now', { onclick: () => leaveTo(from) }, 'btn btn--quiet')));
      ctx.say(left ? `${learn.seen} of ${learn.total} seen.` : 'Through the deck.');
    };
    const showBlocked = () => {
      const first = learn.startBlocked();
      if (!first) { leaveTo(from); return; }
      runSession({ runner: learn.runner, title: `Blocked drill · ${skill.title}`, note: skill.set ? 'Ten more from this set. Six of ten and it joins your mixed practice.' : 'Ten items, this skill only. Hints are behind a button; feedback after each.', mode: 'learn', hintOpen: false, stepper: stepper(blockedStep), lesson, onDone: async () => showResult(await learn.finishBlocked()) });
    };
    const showResult = (r) => {
      const missedKinds = [...new Set(r.missed.map((a) => a.kind))];
      const passed = r.passed;
      if (passed && readJSON(LS_LEARN, null)?.skill === id) writeJSON(LS_LEARN, null);
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
          passed ? [btn(queue.length ? `Next: ${titleOf(queue[0])}` : (from ? backLabel(from).replace('← ', 'Back to ') : 'Back to skills'), { onclick: finishQueue }, 'btn btn--primary'), btn('Practise now', { onclick: () => startBlocked(id, from) }, 'btn')]
            : [btn('Another ten', { onclick: showBlocked }, 'btn btn--primary'), skill.set ? btn(learn.left ? `The next ${Math.min(learn.batchSize, learn.left)}` : 'Through the deck again', { onclick: () => showGuided({ more: !!learn.left }) }, 'btn') : btn('Re-read the lesson', { onclick: showLesson }, 'btn'), btn('Stop for now', { onclick: () => leaveTo(from) }, 'btn btn--quiet')]));
      ctx.say(passed ? `${skill.title} learned.` : 'Not yet; another ten items are ready.');
    };
    if (skill.set) showGuided(); else showLesson();
  }

  /* --------------------------------------------------------- practice */
  // `from` is the chapter page this was opened from, when it was (the by-chapter view's "Practise"): it names
  // the Back button and the way out. Without the parameter the view crashed on `from` the moment it was drawn.
  function renderSetup({ from = null } = {}) {
    const prefs = ctx.prefs();
    const states = gstore.getStates();
    const rotation = [...skills.keys()].filter((id) => inRotation(stateOf(id)) && drillable(id));
    const cw = [...ctx.currentWeekSkills(), ...(ctx.currentWeekSets?.() ?? [])];
    const onShelf = isShelfWeek(ctx.currentWeekN());
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
        h('span', { class: 'g-preset__text' }, h('b', { text: label }), h('small', { text: disabled ? (onShelf && !cw.length ? 'Reading a shelf chapter — no course week is current.' : 'No skill from this week is in practice yet.') : (key === 'this-week' ? `${desc} The week's questions, vocabulary and pensa count as its skills.` : key === 'review-heavy' || key === 'even' ? `${desc} Chapter sets take at most three items in ten.` : desc) })));
    }));
    const pick = h('div', { class: 'g-preset__pick', hidden: preset !== 'one-skill' }, h('span', { class: 'g-label', text: 'Skill' }), skillSelect);
    // Hints, per answer box (GRAMMAR-CONTRACT.md). One setting for every session, wherever it is started from —
    // the Today card and a chapter page never pass through this screen, so the choice is remembered, not asked for.
    let hints = prefs.hints;
    const hintList = h('div', { class: 'g-presets', role: 'radiogroup', 'aria-label': 'Hints' }, HINT_MODES.map((key) => {
      const [label, desc] = HINT_MODE_LABEL[key];
      return h('label', { class: 'g-preset' },
        h('input', { type: 'radio', name: 'g-hintmode', value: key, checked: hints === key ? true : null, onchange: () => { hints = key; } }),
        h('span', { class: 'g-preset__text' }, h('b', { text: label }), h('small', { text: desc })));
    }));
    const start = async () => {
      await ctx.savePrefs({ preset, size, oneSkill, hints });
      render('session', { preset, size, oneSkill, from });
    };
    setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Practice' }),
      // "Confusion pair" is reserved for a pair the learner's answers have actually crossed (the Stats
      // page's "What you mix up"). This count is of pairs the map *declares* confusable and that are
      // both due — a different thing, and it said the same words one tab away (QA-B6).
      h('p', { class: 'g-lede', text: `${rotation.length} skill${rotation.length === 1 ? '' : 's'} in rotation · ${today.due.length + (today.setsDue?.length ?? 0)} due${today.pairs ? ` · ${today.pairs} pair${today.pairs === 1 ? '' : 's'} that are easy to cross` : ''}.` })),
      h('section', { class: 'g-setup' },
        h('div', { class: 'g-setup__row' }, h('span', { class: 'g-label', text: 'Items' }), sizeGroup),
        h('div', { class: 'g-setup__row g-setup__row--col' }, h('span', { class: 'g-label', text: 'Mix' }), presetList, pick),
        h('div', { class: 'g-setup__row g-setup__row--col' }, h('span', { class: 'g-label', text: 'Hints' }), hintList,
          h('p', { class: 'g-quiet', text: 'Every answer box has its own hint — a typed field, each cell of a chart, each blank of a pensum, each word of an order or match item. A hint never spells the answer; this choice holds for every session.' }))),
      h('div', { class: 'g-acts' }, btn('Start', { onclick: start }, 'btn btn--primary'), btn(from ? backLabel(from).replace('← ', 'Back to ') : 'Back to skills', { onclick: () => leaveTo(from) }, 'btn btn--quiet')));
  }
  function renderPracticeStart({ preset = 'review-heavy', size = 10, oneSkill = null, pair = null, resume = false, chapter = null, from = null }) {
    // A confusion pair's Start: ten items alternating exactly those two skills (GRAMMAR-CONTRACT.md, wave 3).
    // It is not a preset — nothing else is let in — so it is built here and handed to the runner as a finished plan.
    if (Array.isArray(pair) && pair.length === 2) { startPair(pair, size ?? 10); return; }
    // "Practise this chapter": the same mixed session, with the chapter's own skills and sets as its whole world —
    // so the interleaving, the confusable pairs and the chapter-set window all hold, and the re-queue and the
    // filler can reach nothing outside the chapter either.
    const params = chapter != null ? { chapter: Number(chapter), size: size ?? 10, from } : { preset, size, oneSkill, from };
    // A session in progress is kept in localStorage (plan, position, answers) so Back or Reload offers to resume it (G1-08).
    const saved = resume ? readJSON(LS_SESSION, null) : null;
    const usable = saved?.queue?.length && saved.index < saved.queue.length ? saved : null;
    if (usable) Object.assign(params, usable.params ?? {});
    const ch = params.chapter ?? null;
    let world = skillsIndex;
    if (ch != null) {
      const material = chapterMaterial(ch, { skills, order: index.order, sets: ctx.sets ?? new Map() });
      const pool = chapterPool(material, { state: stateOf, drillable });
      // A lapsed row is asked for on purpose here, as it is in "Practise this skill": it re-enters the rotation
      // now, so the answers that follow are not judged early (M1).
      for (const id of pool.lapsed) gstore.setState(addToPractice(gstore.getState(id) ?? id));
      if (!pool.rotation.length) {
        writeJSON(LS_SESSION, null);
        setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: `Chapter ${roman(ch)}` }),
          h('p', { class: 'g-lede', text: pool.map.size ? 'Nothing from this chapter is in mixed practice yet. Learn one of its skills, or add them to practice, and this will build a session from them alone.' : 'Nothing in this chapter can be drilled yet — its lessons are there to read.' })),
          h('div', { class: 'g-acts' }, backButton(params.from ?? { chapter: ch }, 'btn')));
        return;
      }
      world = { skills: pool.map };
    }
    const onChange = (snap) => writeJSON(LS_SESSION, snap.index < snap.queue.length ? { ...snap, params, at: Date.now() } : null);
    const practice = createPractice({ gstore, items, skillsIndex: world, currentWeekN: ctx.currentWeekN(), currentWeekSkills: ch != null ? [] : [...ctx.currentWeekSkills(), ...(ctx.currentWeekSets?.() ?? [])], preset: ch != null ? 'review-heavy' : params.preset, size: params.size, oneSkill: ch != null ? null : params.oneSkill, resume: usable ? { queue: usable.queue, index: usable.index, log: usable.log } : null, onChange });
    const first = practice.start();
    if (!first) { writeJSON(LS_SESSION, null); setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Nothing to practise' }), h('p', { class: 'g-lede', text: ch != null ? `No sentences in the library fit chapter ${roman(ch)}'s skills yet.` : 'No sentences in the library fit the skills in rotation yet.' })), h('div', { class: 'g-acts' }, backButton(params.from, 'btn'))); return; }
    if (usable) ctx.say('Session resumed.');
    const title = ch != null ? `Practise · Cap. ${roman(ch)}` : `Practice · ${(PRESET_LABEL[params.preset] ?? PRESET_LABEL['review-heavy'])[0]}`;
    runSession({ runner: practice.runner, title, mode: 'practice', hintOpen: false, practiceLink: true, open: practice.open, more: () => practice.more(), onDone: (summary) => { writeJSON(LS_SESSION, null); renderSummary(summary, params); } });
  }
  /** "Practise this skill": a view of its own, so Back leaves it and a chapter page can open it through `ctx.go`. */
  const startBlocked = (id, from = null) => render('blocked', { skill: id, from });
  function renderBlocked({ skill: id, from = null }) {
    const skill = skills.get(id);
    if (!skill) return renderMap();
    const st = gstore.getState(id);
    // A skill still in Learn keeps learning (m14); a lapsed or new one enters the rotation now, so the answers that follow are not judged "early" (M1).
    if (st?.state === 'learning' && skill.set !== 'pensum') { render('learn', { skill: id, from }); return; }
    if (!inRotation(st) || decay(st).state === 'lapsed') gstore.setState(addToPractice(st ?? id));
    const practice = createBlockedFive({ skill, gstore, items, skillsIndex });
    const first = practice.start();
    if (!first) { setBody(h('p', { class: 'g-quiet', text: 'No sentences fit this skill yet.' }), h('div', { class: 'g-acts' }, backButton(from))); return; }
    runSession({ runner: practice.runner, title: `Practise · ${skill.title}`, mode: 'practice', hintOpen: false, onDone: (summary) => renderSummary(summary, { preset: 'one-skill', size: 5, oneSkill: id, from }) });
  }
  /**
   * The way back from a view opened elsewhere: the chapter page it came from
   * (the shell's own route, when it has given us one), else the by-chapter view
   * of the map, else the map. Every view that can be reached from a chapter
   * carries `from`.
   */
  function leaveTo(from) {
    // The shell's own router (`onChapterNav`): back to the chapter page, on its Grammar tab.
    if (from?.chapter != null && typeof ctx.openChapter === 'function') { ctx.openChapter(Number(from.chapter), 'grammar'); return; }
    if (from?.chapter != null) { mapView = 'chapter'; render('map', { chapter: Number(from.chapter) }); return; }
    render('map');
  }
  const backLabel = (from) => (from?.chapter != null ? `← Cap. ${roman(Number(from.chapter))}` : '← Skills');
  const backButton = (from, cls = 'btn btn--quiet g-back') => btn(backLabel(from), { onclick: () => leaveTo(from) }, cls);
  function renderSummary(summary, params) {
    view = { name: 'summary', params };
    // A self-graded "partly" counts towards the scheduler but is not a clean right: it is named, not folded in (m4).
    const partly = summary.partly ?? 0;
    const clean = summary.right - partly;
    const acc = summary.total ? Math.round((clean / summary.total) * 100) : 0;
    const added = summary.added ?? 0;
    setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Session over' }),
      h('p', { class: 'g-lede', text: `${clean} of ${summary.total} right${partly ? `, ${partly} partly` : ''} (${acc}%) · ${summary.skills.length} skill${summary.skills.length === 1 ? '' : 's'} · ${stats.fmtMin(summary.ms)}${summary.hinted ? ` · ${summary.hinted} with a hint` : ''}.` }),
      added ? h('p', { class: 'g-quiet', text: `${summary.asked} items were asked for; ${added} more came back after a wrong answer.` }) : null),
      summary.wrong.length ? h('section', {}, h('h2', { class: 'g-h2', text: 'Worth another look' }), h('ul', { class: 'g-chips' }, summary.wrong.map((id) => h('li', {}, h('button', { type: 'button', class: 'g-chip', onclick: () => startBlocked(id, params?.from ?? null) }, titleOf(id), h('span', { class: 'g-chip__state', text: ' · practise' })))))) : h('p', { class: 'g-quiet', text: 'Nothing missed.' }),
      h('div', { class: 'g-acts' }, btn(params?.chapter != null ? `Another chapter ${roman(params.chapter)} session` : 'Another session', { onclick: () => render('session', params) }, 'btn btn--primary'), btn(params?.from?.chapter != null ? backLabel(params.from).replace('← ', '') : 'Skills', { onclick: () => leaveTo(params?.from ?? null) }, 'btn btn--quiet'), btn('Stats', { onclick: () => render('stats') }, 'btn btn--quiet')));
    body.querySelector('h1')?.focus?.({ preventScroll: true });   // a keyboard session ends on the summary, not at the top of the page (G1-09)
    ctx.say(`Session over: ${summary.right} of ${summary.total} right.`);
  }

  /* ----------------------------------------------------------- runner */
  /**
   * The beat between a right answer and the next item. Long enough to read the
   * one-line feedback, short enough that the session never waits on a click
   * ("a correct answer moves the session on by itself"). Enter, the forward
   * arrow, or answering nothing at all skips it; the back arrow cancels it, and
   * stepping back is how the learner re-reads a line they missed.
   */
  const ADVANCE_MS = 1400;
  /**
   * Drives one runner in the body: item → answer → feedback → on. `open`
   * sessions offer "ten more" at the end; `practiceLink` shows "Practise this
   * skill" in the feedback (a five-item set that returns here afterwards).
   *
   * Session flow (GRAMMAR-CONTRACT.md, 2026-09-06):
   * - a **right** answer advances by itself after `ADVANCE_MS`; Enter at once;
   * - a **wrong** answer holds the item, with its result and its explanation,
   *   and "Try again" builds the same item fresh. Only the forward arrow gets
   *   past it. The runner logs the first answer and nothing after it;
   * - **back / forward** walk the items already seen. A page is kept exactly as
   *   it was left — its inputs already disabled by `submit()` — so a step back
   *   is a replay, never a second grading. Left and right arrow keys do the
   *   same when focus is not in a field or in an input that uses them itself.
   */
  function runSession({ runner, title, note = '', mode, hintOpen = false, stepper = null, lesson = null, onDone, practiceLink = false, open = false, more = null }) {
    const wrap = h('div', { class: 'g-run' });
    const backB = btn([h('span', { 'aria-hidden': 'true', text: '←' })], { 'aria-label': 'Back to the previous item', onclick: () => go(-1) }, 'g-runnav__b');
    const fwdB = btn([h('span', { 'aria-hidden': 'true', text: '→' })], { 'aria-label': 'On to the next item', onclick: () => go(1) }, 'g-runnav__b');
    const posEl = h('span', { class: 'g-runnav__pos' });
    const nav = h('nav', { class: 'g-runnav', 'aria-label': 'This session' }, backB, posEl, fwdB);
    setBody(stepper, nav, wrap);
    const pages = [];        // queue index → the rendered page, kept so a step back shows it as it was left
    let beat = null;
    const clearBeat = () => { if (beat) { clearTimeout(beat); beat = null; } };
    /** Human position: the made items up to here, out of the made items in all (skipped slots are not counted). */
    const paintNav = () => {
      const i = runner.position;
      let at = 0;
      let total = 0;
      for (let j = 0; j < runner.length; j++) { const made = j <= runner.frontier ? !!runner.itemAt(j) : true; if (!made) continue; total += 1; if (j <= i) at += 1; }
      posEl.textContent = runner.current ? `${at} of ${total}` : `${total} of ${total}`;
      posEl.setAttribute('aria-label', `Item ${at} of ${total}`);
      backB.disabled = !runner.canBack;
      fwdB.disabled = !runner.canForward;
      nav.dataset.replay = runner.replay ? 'true' : 'false';
    };
    function finish() {
      clearBeat();
      const summary = runner.summary();
      if (open && more) {   // open-ended: ten more before the summary
        wrap.replaceChildren(h('div', { class: 'g-open' }, h('p', { class: 'g-lede', text: `${summary.right} of ${summary.total} so far.` }),
          h('div', { class: 'g-acts' }, btn('Ten more', { onclick: () => { more(); step(); } }, 'btn btn--primary'), btn('Finish', { onclick: () => onDone(summary) }, 'btn'))));
        paintNav();
        wrap.querySelector('button')?.focus({ preventScroll: true });
        return;
      }
      onDone(summary);
    }
    /** Move by one item. -1 back (a replay), +1 forward (past an answered item, whichever way it went). */
    function go(dir) {
      clearBeat();
      if (dir < 0) { if (!runner.canBack) return; runner.back(); }
      else { if (!runner.canForward) return; runner.forward(); }
      step({ announce: true });
    }
    /** Build (or rebuild, for a retry) the page for the item on screen. */
    function build(i, item, { fresh = false } = {}) {
      const grown = runner.added > 0 ? `${runner.added} item${runner.added === 1 ? '' : 's'} came back after a wrong answer${runner.capped ? '. The session is full now — anything still missed comes back next time' : ''}.` : '';
      const page = h('div', { class: 'g-page' });
      page.append(itemNode(item, {
        title, note: [note, grown].filter(Boolean).join(' '), position: i, hintOpen, onHint: () => runner.hint(),
        onAnswer: async (value) => {
          const result = await runner.answer(value);
          const fb = feedbackNode(item, result, { lesson, mode, practiceLink,
            onNext: () => go(1),
            onRetry: result.correct ? null : () => { pages[i] = build(i, item, { fresh: true }); wrap.replaceChildren(pages[i]); paintNav(); focusPage(pages[i]); ctx.say('Try that one again.'); },
            onPractice: () => nested(item.skill) });
          page.append(fb);
          page.dataset.result = result.correct ? 'ok' : 'bad';
          paintNav();
          ctx.say(`${fb.querySelector('.g-fb__line')?.textContent ?? ''}${result.correct ? ' Moving on.' : ''}`);
          fb.scrollIntoView({ block: 'nearest' });
          if (result.correct) { fb.querySelector('.g-fb__next')?.focus({ preventScroll: true }); clearBeat(); beat = setTimeout(() => { beat = null; go(1); }, ADVANCE_MS); }
          else fb.querySelector('.g-fb__retry, .g-fb__next')?.focus({ preventScroll: true });
        },
      }));
      if (fresh) page.dataset.retry = 'true';
      return page;
    }
    const focusPage = (page) => { (page.querySelector('.g-fb__retry, .g-fb__next') ?? page.querySelector('.g-q'))?.focus?.({ preventScroll: true }); };
    function step({ announce = false } = {}) {
      closePop();
      clearBeat();
      const cur = runner.current;
      if (!cur) { finish(); return; }
      const i = runner.position;
      if (!pages[i]) pages[i] = build(i, cur.item);
      wrap.replaceChildren(pages[i]);
      ctx.current = cur.item;
      paintNav();
      if (announce) ctx.say(runner.replay ? `${posEl.textContent}, already answered.` : posEl.textContent);
      // A replayed item is read, not answered, so focus stays on the arrows. The back arrow is disabled at the
      // first item, and focusing a disabled button drops focus on the body — outside `#grammar`, where the
      // section's own keydown guard means the arrow keys would never be heard again (QA, keyboard-only pass).
      if (runner.replay) { (backB.disabled ? fwdB : backB).focus({ preventScroll: true }); return; }
      focusPage(pages[i]);
    }
    // Left / right arrows step through the session, but never when focus is in a field, and never inside an
    // input that uses the arrows itself (order and match move focus along their own buttons with them).
    // The listener sits on the section's own root, not on the document: index.js stops keydown from leaving
    // `#grammar` (so the reader's letter shortcuts cannot fire from inside a drill), and a document-level
    // handler would therefore never hear an arrow pressed in a session.
    const onKey = (e) => {
      if (!wrap.isConnected) { root.removeEventListener('keydown', onKey); return; }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target;
      if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '')) return;
      if (t?.closest?.('.g-order, .g-match, .g-chart, .g-pop')) return;
      e.preventDefault();
      go(e.key === 'ArrowLeft' ? -1 : 1);
    };
    root.addEventListener('keydown', onKey);
    /** "Practise this skill": a five-item blocked set, then back to this session's place (the feedback stays where it was). */
    function nested(skillId) {
      const skill = skills.get(skillId);
      const sub = createBlockedFive({ skill, gstore, items, skillsIndex });
      if (!sub.start()) { ctx.say('No more sentences for this skill right now.'); return; }
      clearBeat();
      const saved = [...wrap.childNodes];
      const subWrap = h('div', { class: 'g-run g-run--sub' });
      wrap.replaceChildren(h('p', { class: 'g-sub__note', text: `A short set on ${skill.title}; the session continues afterwards.` }), subWrap);
      const subStep = () => {
        closePop();
        const cur = sub.runner.current;
        if (!cur) { wrap.replaceChildren(...saved); wrap.querySelector('.g-fb__next')?.focus({ preventScroll: true }); ctx.say('Back to the session.'); return; }
        const paint = () => {
          subWrap.replaceChildren(itemNode(cur.item, { title: `Practise · ${skill.title}`, position: sub.runner.position, hintOpen, onHint: () => sub.runner.hint(),
            onAnswer: async (value) => {
              const result = await sub.runner.answer(value);
              const fb = feedbackNode(cur.item, result, { lesson: null, mode: 'practice', practiceLink: false,
                onNext: () => { sub.runner.forward(); subStep(); },
                onRetry: result.correct ? null : paint });
              subWrap.append(fb);
              ctx.say(fb.querySelector('.g-fb__line')?.textContent ?? '');
              if (result.correct) { fb.querySelector('.g-fb__next')?.focus({ preventScroll: true }); clearBeat(); beat = setTimeout(() => { beat = null; sub.runner.forward(); subStep(); }, ADVANCE_MS); }
              else fb.querySelector('.g-fb__retry, .g-fb__next')?.focus({ preventScroll: true });
            } }));
          subWrap.querySelector('.g-q')?.focus?.({ preventScroll: true });
        };
        paint();
      };
      subStep();
    }
    step();
  }

  function itemNode(item, { title, note = '', position, hintOpen, onHint, onAnswer }) {
    const skill = skills.get(item.skill);
    ctx.current = item;   // the item on screen (window.latinGrammar.current — tests / debugging)
    // The position moved out of the item and into the session's nav bar, where the arrows are and where it
    // stays true as the session grows: a page is kept as it was left, so a number printed on it would go stale.
    const node = h('section', { class: 'g-item', 'data-kind': item.kind, 'data-input': item.input, 'data-pos': String(position) });
    node.append(h('p', { class: 'g-item__meta' }, h('span', { class: 'g-item__title', text: title })));
    if (note) node.append(h('p', { class: 'g-quiet g-item__note', text: note }));
    node.append(h('p', { class: 'g-item__skill', text: `${skill?.title ?? item.skill} · ${KIND_LABEL[item.kind] ?? item.kind}${item.pensum ? ` ${item.pensum}` : ''}` }));
    if (item.repeat) node.append(h('p', { class: 'g-quiet g-item__note', text: item.set ? 'Every item of this set has come up once; starting over.' : 'Every sentence for this skill has come up once; starting over.' }));
    let submitted = false;
    const submit = (v) => { if (submitted) return; submitted = true; node.querySelectorAll('button, input, textarea').forEach((el) => { if (!el.closest('.g-hint') && !el.closest('.g-hints') && !el.classList.contains('g-hintb') && !el.classList.contains('g-w') && !el.closest('.g-all-switch') && !el.closest('.g-q-en')) el.disabled = true; }); node.dispatchEvent(new CustomEvent('g-answered')); onAnswer(v); };
    // The hints for this item's answer boxes. `hintOpen` (Learn's guided five) forces them open, unless the
    // learner has turned hints off altogether — that choice is theirs and outranks the phase's default.
    const effMode = hintMode() === 'off' ? 'off' : (hintOpen ? 'always' : hintMode());
    const boxes = effMode === 'off' ? [] : boxHints(item, { skill, describe: describeWord });
    const boxIn = (ids) => { const want = new Set(ids.map(String)); return boxes.filter((b) => want.has(String(b.id))); };
    const shownBoxes = item.input === 'chart' ? boxIn(chartCells(item).map((c) => item.chart.cells.indexOf(c)))
      : ['inline', 'bank', 'match', 'order'].includes(item.input) ? boxes : [];
    const hintPanel = shownBoxes.length ? boxHintPanel(shownBoxes, { mode: effMode, onHint: () => { if (!submitted) onHint(); } }) : null;
    const hintFor = (id, opts) => hintPanel?.control(id, opts) ?? null;
    const question = (text) => h('p', { class: 'g-q', tabindex: '-1', text });
    // The English of a question on demand (a question set, Pensum C): never shown first.
    const englishOf = (en) => (en ? h('details', { class: 'g-q-en' }, h('summary', { class: 'g-hint__s', text: 'In English' }), h('p', { class: 'g-hint__rule', text: en })) : null);
    const tapMode = item.input === 'tap';
    // The sentence (tap items answer by tapping); a question shows its question first, the sentence under it when it is a tap item.
    if (item.kind === 'question' || (item.kind === 'pensum' && item.pensum === 'C')) {
      // The question's own words are tappable for their entry: plan §3 promises word by word, and a `type` or
      // `choice` question used to be plain text with only whole-question English behind a disclosure (m14).
      const qNode = latin(item.prompt.question, { cls: 'g-q g-q--la' });
      qNode.tabIndex = -1;
      // `Element.append` stringifies null, so a Pensum C item (no English) printed the word "null" under its question.
      node.append(...[qNode, englishOf(item.prompt.en)].filter(Boolean));
      if (!item.prompt.la && item.meanings?.length) {
        const sw = h('label', { class: 'switch g-all-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: allMeanings ? true : null, onchange: (e) => { allMeanings = e.target.checked; const l = node.querySelector('.g-all'); if (l) l.hidden = !allMeanings; } }), h('span', { class: 'switch__ui', 'aria-hidden': 'true' }), h('span', { class: 'switch__text', text: 'Show all meanings' }));
        node.append(sw, Object.assign(glossList(item), { hidden: !allMeanings }));
      }
      if (item.prompt.la) {
        node.append(latin(item.prompt.la, { tap: tapMode ? (i, el) => { if (submitted) return; el.classList.add('is-picked'); submit(i); } : null, cls: tapMode ? 'g-la--tap' : '' }));
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
      if (item.prompt.gloss) node.append(glossNode(item));
    } else if (item.prompt.la) {
      node.append(latin(item.prompt.la, { target: tapMode || item.kind === 'blank' ? null : item.target?.index ?? null, tap: tapMode ? (i, el) => { if (submitted) return; el.classList.add('is-picked'); submit(i); } : null, cls: tapMode ? 'g-la--tap' : '' }));
      node.append(question(item.prompt.question));
      if (item.prompt.gloss) node.append(glossNode(item));
      const sw = h('label', { class: 'switch g-all-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: allMeanings ? true : null, onchange: (e) => { allMeanings = e.target.checked; const l = node.querySelector('.g-all'); if (l) l.hidden = !allMeanings; } }), h('span', { class: 'switch__ui', 'aria-hidden': 'true' }), h('span', { class: 'switch__text', text: 'Show all meanings' }));
      node.append(sw, Object.assign(glossList(item), { hidden: !allMeanings }));
    } else {
      node.append(question(item.input === 'chart' ? chartQuestion(item) : item.prompt.question));
      if (item.prompt.gloss) node.append(glossNode(item));
    }
    // Input
    const latinTyped = item.kind === 'blank' || item.kind === 'transform' || item.kind === 'question' || item.kind === 'pensum' || (item.kind === 'vocab' && skill?.rev);
    if (item.input === 'choice') {
      const group = h('div', { class: 'g-choices', role: 'group', 'aria-label': 'Answers' }, item.choices.map((c, i) => btn([h('span', { class: 'g-choice__n', 'aria-hidden': 'true', text: `${i + 1}` }), h('span', { class: 'g-choice__label', lang: item.kind === 'blank' || item.kind === 'question' || (item.kind === 'vocab' && skill?.rev) ? 'la' : null, text: c.label }), c.plain ? h('span', { class: 'g-choice__plain', text: c.plain }) : null], { 'data-value': c.value, onclick: (e) => { e.currentTarget.classList.add('is-picked'); submit(c.value); } }, 'g-choice')));
      node.append(group, h('p', { class: 'g-keys', text: 'Keys 1–4 choose an answer.' }));
      // After an answer the list itself says which was right, not only the prose beneath it (m13).
      node.addEventListener('g-answered', () => { for (const b of group.children) b.classList.toggle('is-answer', item.choices[[...group.children].indexOf(b)]?.correct === true); });
      node.addEventListener('keydown', (e) => { const n = Number(e.key); if (n >= 1 && n <= item.choices.length && !submitted && e.target.tagName !== 'INPUT') { e.preventDefault(); group.children[n - 1].click(); } });
    } else if (item.input === 'type') {
      const input = h('input', { type: 'text', class: 'g-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', lang: latinTyped ? 'la' : 'en', 'aria-label': item.kind === 'blank' ? 'The missing form' : 'Your answer', placeholder: item.kind === 'blank' ? 'the form (macrons optional)' : (item.prompt.placeholder ?? 'e.g. dative singular') });
      const check = btn('Check', {}, 'btn btn--primary'); check.type = 'submit';
      const form = h('form', { class: 'g-type', onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) submit(input.value); } }, input, check);
      node.append(form);
      setTimeout(() => input.focus({ preventScroll: true }), 0);
    } else if (item.input === 'chart') {
      node.append(chartInput(item, submit, hintFor));
    } else if (item.input === 'tap') {
      node.append(h('p', { class: 'g-keys g-keys--tap', text: 'Tap a word in the sentence.' }));
    } else if (item.input === 'order') {
      const w = orderInput({ chunks: item.chunks, display: item.display ?? null, scrambled: item.scrambled, onSubmit: submit, live: ctx.live });
      node.append(w.node);
      if (hintPanel) w.node.append(hintPanel.row());
      setTimeout(() => w.focus(), 0);
    } else if (item.input === 'match') {
      const w = matchInput({ pairs: item.pairs, right: item.right, onSubmit: submit, live: ctx.live });
      node.append(w.node);
      if (hintPanel) w.node.append(hintPanel.row());
      setTimeout(() => w.focus(), 0);
    } else if (item.input === 'inline') {
      node.append(inlineInput(item, submit, hintFor));
    } else if (item.input === 'bank') {
      node.append(bankInput(item, submit, hintFor));
    } else if (item.input === 'self') {
      node.append(selfInput(item, submit));
    }
    // Hints, one per answer box (GRAMMAR-CONTRACT.md "Hints, per answer box"). A single-box item keeps the
    // familiar disclosure under the input; a chart, a pensum, an order or a match item gets a control per box
    // and a panel under the input, so a hint never covers the box or the sentence it belongs to.
    const table = item.entry && item.kind !== 'chart' ? (() => { try { return par.paradigm(item.entry, []); } catch { return null; } })() : null;
    const pt = table ? renderParadigm(table) : null;
    if (pt) pt.open = true;
    const hintOnce = () => { if (!submitted) onHint(); };
    if (hintPanel) { node.append(hintPanel.node); if (hintPanel.always) hintOnce(); }
    else if (effMode !== 'off' && boxes[0]) {
      const box = boxes[0];
      const alwaysOn = effMode === 'always';
      const body = h('div', { class: 'g-hint__body' }, h('p', { class: 'g-hint__rule', text: box.levels[0] }));
      const deep = () => { if (box.levels[1]) body.append(h('p', { class: 'g-hint__rule g-hint__rule--deep', text: box.levels[1] })); if (pt) body.append(pt); };
      const more = (box.levels[1] || pt) ? btn('Tell me more', { onclick: (e) => { e.currentTarget.remove(); deep(); } }, 'g-link g-hint__more') : null;
      const hint = h('details', { class: 'g-hint', open: alwaysOn ? true : null },
        h('summary', { class: 'g-hint__s' }, h('span', { 'aria-hidden': 'true', text: 'Hint' }), h('span', { class: 'visually-hidden', text: `Hint for ${box.label}` })),
        body, more);
      hint.addEventListener('toggle', () => { if (hint.open) hintOnce(); });
      if (alwaysOn) hintOnce();
      node.append(hint);
    }
    return node;
  }

  /* ------------------------------------------------------------- hints */
  /** The learner's hint mode: *Press for a hint* (default), *Always show*, *No hints*. */
  const hintMode = () => normaliseHintMode(ctx.prefs?.().hints);
  /** A word's dictionary line, for the hints on a reorder item's chips (their words cannot be tapped: tapping places them). */
  const describeWord = (form, text) => {
    try {
      const e = dict.lookup(form).entries[0];
      if (!e) return null;
      const d = dict.describe(e, { compact: true, form: text });
      return { lemma: d?.lemma ?? null, meaning: String(d?.meaning ?? '').split(/\s+·\s+/)[0] || null, parse: d?.parse ?? null };
    } catch { return null; }
  };
  /**
   * One hint per answer box for a multi-box item. Each box gets a small control
   * ("?"); the hint itself opens in a panel under the input, so it never covers
   * the box or the sentence. Level two is a second press ("Tell me more").
   * `always` shows every panel from the start and counts the answer as hinted.
   */
  function boxHintPanel(boxes, { mode, onHint }) {
    const always = mode === 'always';
    const uid = `gh${Math.random().toString(36).slice(2, 8)}`;
    const rows = new Map();
    const list = h('div', { class: 'g-hints', role: 'group', 'aria-label': 'Hints' });
    for (const b of boxes) {
      const body = h('div', { class: 'g-hints__body' }, h('p', { class: 'g-hint__rule', text: b.levels[0] }));
      // Level two stays a second press even under *Always show*: "every box shows its hint from the start" is the
      // first level, what the box is being asked for; the rule behind it is still the deeper look.
      const more = b.levels[1] ? btn('Tell me more', { onclick: (e) => { e.currentTarget.remove(); body.append(h('p', { class: 'g-hint__rule g-hint__rule--deep', text: b.levels[1] })); } }, 'g-link g-hint__more') : null;
      const row = h('div', { class: 'g-hints__row', id: `${uid}-${b.id}`, hidden: always ? null : true },
        h('p', { class: 'g-hints__for', text: b.label }), body, more);
      rows.set(String(b.id), row);
      list.append(row);
    }
    const control = (id, { label = false } = {}) => {
      const row = rows.get(String(id));
      const b = boxes.find((x) => String(x.id) === String(id));
      if (!row || !b) return null;
      return h('button', { type: 'button', class: `g-hintb${label ? ' g-hintb--wide' : ''}`, 'aria-expanded': String(always), 'aria-controls': row.id, 'aria-label': `Hint for ${b.label}`,
        onclick: (e) => {
          const opening = row.hidden;
          row.hidden = !opening;
          e.currentTarget.setAttribute('aria-expanded', String(opening));
          if (opening) { onHint?.(); row.scrollIntoView({ block: 'nearest' }); }
        } },
        h('span', { 'aria-hidden': 'true', text: '?' }), label ? h('span', { 'aria-hidden': 'true', class: 'g-hintb__w', lang: 'la', text: b.label }) : null);
    };
    /** For order and match, whose boxes are buttons the learner taps: a labelled row under the input, never a mark on the chip itself. */
    const row = () => h('div', { class: 'g-hintrow' }, h('span', { class: 'g-label', text: 'Hints' }), boxes.map((b) => control(b.id, { label: true })));
    return { node: list, control, row, always };
  }

  /** Pensum A: the sentence with an input for each ending, inline after its stem. Submits { blankIndex: typed }. */
  function inlineInput(item, submit, hintFor = () => null) {
    const inputs = new Map();
    // A div, not a p: each blank carries its own hint button beside it, and a button is fine in a paragraph
    // but the hint panel that follows the sentence is not — the sentence keeps its look through `.g-la`.
    const p = h('div', { class: 'g-la g-pensum', lang: 'la' });
    for (const seg of item.segments) {
      if (seg.blank == null) { p.append(seg.text); continue; }
      const b = item.blanks[seg.blank];
      if (!b) continue;
      const inp = h('input', { type: 'text', class: 'g-input g-input--end', lang: 'la', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': `Ending after ${b.stem || 'the stem'}${b.note ? ` (${b.note})` : ''}`, placeholder: '…', size: String(Math.max(2, Math.min(6, (b.answers[0] ?? '').length + 1))) });
      inputs.set(seg.blank, inp);
      // The stem is already printed: it ends the prose segment before this blank ("Rōma in Itali_ est."). Printing
      // `b.stem` here too gave every Pensum A item a doubled stem — "Rōma in ItaliItali__ est." (C1). It stays in the
      // input's aria-label, which is where a screen-reader user needs it.
      p.append(h('span', { class: 'g-pensum__blank' }, inp, hintFor(seg.blank)));
    }
    const check = btn('Check', {}, 'btn btn--primary'); check.type = 'submit';
    const form = h('form', { class: 'g-chart', onsubmit: (e) => { e.preventDefault(); const v = {}; item.blanks.forEach((b, i) => { v[i] = inputs.get(i)?.value ?? ''; }); submit(v); } }, p, h('div', { class: 'g-chart__acts' }, check), h('p', { class: 'g-keys', text: 'Tab moves to the next ending; Enter checks.' }));
    setTimeout(() => form.querySelector('input')?.focus({ preventScroll: true }), 0);
    return form;
  }
  /** Pensum B: the sentence with word blanks and a tappable bank. Submits { blankIndex: word }. */
  function bankInput(item, submit, hintFor = () => null) {
    const filled = {};
    const slots = new Map();
    const p = h('div', { class: 'g-la g-pensum', lang: 'la' });
    for (const seg of item.segments) {
      if (seg.blank == null) { p.append(seg.text); continue; }
      const i = seg.blank;
      const slot = h('button', { type: 'button', class: 'g-pensum__slot', lang: 'la', 'aria-label': `Blank ${i + 1}: empty`, onclick: () => { if (filled[i] != null) { delete filled[i]; paint(); } } }, '\u00a0');
      slots.set(i, slot);
      p.append(slot, hintFor(i));
    }
    // Tiles are identified by their position in the bank, never by their text: a sentence that wants the same word
    // twice offers two tiles (sets.js builds the bank as a multiset), and disabling "by text" left Check unreachable (M3).
    const bankBtns = item.bank.map((w, t) => h('button', { type: 'button', class: 'g-order__w', lang: 'la', text: w, 'data-tile': String(t), onclick: () => { const next = item.blanks.findIndex((_, i) => filled[i] == null); if (next < 0) return; filled[next] = t; paint(); } }));
    const check = btn('Check', {}, 'btn btn--primary'); check.type = 'submit';
    const paint = () => {
      for (const [i, slot] of slots) { const t = filled[i]; const w = t == null ? null : item.bank[t]; slot.textContent = w ?? '\u00a0'; slot.classList.toggle('is-filled', w != null); slot.setAttribute('aria-label', w != null ? `Blank ${i + 1}: ${w}; tap to empty` : `Blank ${i + 1}: empty`); }
      const used = new Set(Object.values(filled));
      bankBtns.forEach((b, t) => { b.disabled = used.has(t); b.classList.toggle('is-used', used.has(t)); });
      check.disabled = item.blanks.some((_, i) => filled[i] == null);
    };
    const form = h('form', { class: 'g-chart', onsubmit: (e) => { e.preventDefault(); const v = {}; item.blanks.forEach((_, i) => { v[i] = filled[i] == null ? '' : item.bank[filled[i]]; }); submit(v); } }, p, h('div', { class: 'g-order__bank', role: 'group', 'aria-label': 'Word bank' }, bankBtns), h('div', { class: 'g-chart__acts' }, check), h('p', { class: 'g-keys', text: 'Tab to a word and press Enter to put it in the next empty blank; a filled blank empties when chosen.' }));
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
  function chartInput(item, submit, hintFor = () => null) {
    const { chart } = item;
    const cells = chartCells(item);
    const inputs = new Map();   // index into chart.cells → input
    const mk = (i, label) => { const inp = h('input', { type: 'text', class: 'g-input g-input--cell', lang: 'la', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': label, placeholder: '…' }); inputs.set(i, inp); return inp; };
    // Each cell that is filled in carries its own hint: four cells means four hints, each about its own cell.
    const cellIn = (i, label) => h('span', { class: 'g-cellwrap' }, mk(i, label), hintFor(i));
    // Cells not shown (phones show one) are judged as right: only what was asked counts.
    const collect = () => { const v = {}; chart.cells.forEach((c, i) => { v[i] = inputs.has(i) ? inputs.get(i).value : c.answer[0]; }); return v; };
    const form = h('form', { class: 'g-chart', onsubmit: (e) => { e.preventDefault(); submit(collect()); } });
    if (cells.length === 1) {
      const c = cells[0];
      const i = chart.cells.indexOf(c);
      form.append(h('div', { class: 'g-chart__one' }, h('label', { class: 'g-label', for: `gc-${i}` }, `${item.lemma.split(/[\s,]/)[0]} · ${c.label}`), cellIn(i, c.label)));
      inputs.get(i).id = `gc-${i}`;
    } else {
      const sec = chart.table.sections[chart.section];
      const tbl = h('table', { class: 'pt g-chart__t' }, sec.title ? h('caption', { class: 'pt__caption', text: `${item.lemma} · ${sec.title}` }) : null,
        sec.headers?.length ? h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'pt__corner', 'aria-label': 'form' }), sec.headers.map((hd) => h('th', { scope: 'col', text: hd })))) : null,
        h('tbody', {}, sec.rows.map((r, ri) => h('tr', {}, h('th', { scope: 'row', text: r.label }), r.cells.map((cell, ci) => {
          const idx = chart.cells.findIndex((c) => c.row === ri && c.col === ci);
          if (idx >= 0) return h('td', { class: 'pt__cell g-chart__in' }, cellIn(idx, chart.cells[idx].label));
          return h('td', { class: `pt__cell${cell?.empty ? ' is-empty' : ''}`, lang: 'la', text: cell?.empty ? '—' : cell?.text ?? '—' });
        })))));
      form.append(h('div', { class: 'pt__scroll' }, tbl));
    }
    const check = btn('Check', {}, 'btn btn--primary'); check.type = 'submit';
    form.append(h('div', { class: 'g-chart__acts' }, check), h('p', { class: 'g-keys', text: 'Tab moves to the next cell; Enter checks.' }));
    setTimeout(() => form.querySelector('input')?.focus({ preventScroll: true }), 0);
    return form;
  }

  /**
   * The case (and number) a Latin form carries, read off the word's own
   * paradigm — used only where two forms differ by a macron alone, so the
   * feedback can say *which* two forms they are. null when the dictionary or
   * the table cannot settle it, and the caller then says only that the macron
   * is the difference.
   */
  function formLabel(form) {
    try {
      const entry = dict.lookup(form).entries[0];
      if (!entry) return null;
      const t = par.paradigm(entry, []);
      const want = String(form).normalize('NFC').toLowerCase();
      const found = new Set();
      for (const sec of t?.sections ?? []) for (const row of sec.rows ?? []) for (const c of row.cells ?? []) {
        if (!c || c.empty || !c.key?.case) continue;
        if (String(c.text ?? '').split(' / ').some((f) => f.trim().normalize('NFC').toLowerCase() === want)) found.add(`${featureLabel('case', c.key.case).name}${c.key.number ? ` ${c.key.number === 'sg' ? 'singular' : 'plural'}` : ''}`);
      }
      // Two readings are named as two (nom. and voc. sg. really are the same form); more than two says nothing useful.
      if (!found.size || found.size > 2) return null;
      const [x, y] = [...found];
      return y ? `${x.replace(/ (singular|plural)$/, '')} or ${y}` : x;
    } catch { return null; }
  }
  /** "Italia is the nominative singular; after in the blank wants the ablative Italiā — the macron is the whole difference." */
  function macronLine(c) {
    const given = String(c.given ?? '').trim();
    const want = String(c.expected ?? '').trim();
    const gl = formLabel(given);
    const wl = formLabel(want);
    const head = gl ? `${given} is the ${gl}` : `You wrote ${given}`;
    const tail = wl ? `here the blank wants the ${wl}, ${want}` : `the blank wants ${want}${c.note ? ` (${c.note})` : ''}`;
    const note = wl && c.note ? ` (${c.note})` : '';
    return `${head}; ${tail}${note} — they differ only in the macron, and that macron is the ending.`;
  }

  function feedbackNode(item, result, { lesson, mode, practiceLink, onNext, onRetry = null, onPractice = null }) {
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
      // A pensum blank is macron-sensitive, so a miss that is *only* a macron gets named for what it is — the whole
      // point of Ørberg's Pensum B for chapter I is Italia (nominative) against Italiā (ablative after in) — M3.
      const macron = wrong.filter((c) => c.macron);
      line = macron.length === wrong.length
        ? `${macron.map((c) => macronLine(c)).join(' ')} ${fb.short}`
        : `${wrong.length === 1 ? 'One blank' : `${wrong.length} blanks`} off: ${wrong.map((c) => `${c.given || '—'} → ${c.expected}`).join(', ')}. ${fb.short}`;
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
      // "Reached from the skill map and from an item's feedback" (GRAMMAR-CONTRACT.md, wave 3). Inside the
      // expandable, so a keyboard Enter on Next can never land on it by accident mid-session.
      h('p', { class: 'g-fb__hist' }, h('button', { type: 'button', class: 'g-link', onclick: () => render('history', { skill: item.skill }) }, `How ${skill?.title ?? 'this skill'} has gone`)),
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
    // Green for right, red for wrong — and never colour alone. The mark (✓ / ✗ / ~) survives greyscale and a
    // black-and-white print, the line says the word, and the visually-hidden label says it again for a screen
    // reader that never sees either. `data-ok` carries the colour in grammar.css, both themes.
    const verdict = result.partial ? 'Partly right.' : ok ? 'Correct.' : 'Not right.';
    // A wrong answer holds the item and the learner tries again; only the first answer was logged, and saying so
    // is what keeps a retry from feeling like cheating (GRAMMAR-CONTRACT.md "Session flow").
    const again = result.retry
      ? h('p', { class: 'g-fb__again' }, ok
        ? 'Right this time. Your first answer to this item is the one already counted, so the skill is unchanged.'
        : 'Try it once more — your first answer to this item is the one already counted.')
      : (!ok && onRetry ? h('p', { class: 'g-fb__again', text: 'Have another go. Only your first answer counts towards the skill, so trying again costs nothing.' }) : null);
    const node = h('div', { class: 'g-fb', 'data-ok': String(ok), 'data-partial': result.partial ? 'true' : null, 'data-retry': result.retry ? 'true' : null },
      h('p', { class: 'g-fb__line' }, h('span', { class: 'g-fb__mark', 'aria-hidden': 'true', text: ok ? (result.partial ? '~' : '✓') : '✗' }), h('span', { class: 'visually-hidden', text: `${verdict} ` }), ' ', line),
      answerBlock,
      isSet && item.kind !== 'question' && item.kind !== 'pensum' ? null : details,
      again,
      h('div', { class: 'g-fb__acts' },
        !ok && onRetry ? btn('Try again', { onclick: onRetry }, 'btn btn--primary g-fb__retry') : null,
        btn(ok ? 'Next' : 'Move on', { onclick: onNext, 'aria-label': ok ? 'Next item' : 'Move on to the next item without getting this one right' }, `btn ${ok ? 'btn--primary' : 'btn--quiet'} g-fb__next`),
        practiceLink && mode === 'practice' && onPractice ? btn(`Practise ${skill?.title ?? 'this skill'}`, { onclick: onPractice }, 'btn btn--quiet') : null));
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
    const plan = buildToday({ states: gstore.getStates(), skills, currentWeek: ctx.currentWeekSkills(), weekChapter: ctx.currentChapter?.() ?? null, attempts: gstore.getAttempts(), unread: place === 'weeks' ? unread : 0, pace, now, dismissed: ctx.settings?.todayDismissed ?? null, drillable: ctx.items ? drillable : null });
    // The day is read at click time, not at render: the map is a long-lived node, and dismissing at 00:01 a card
    // drawn at 23:58 used to store yesterday's date, so the card came straight back (m8).
    const repaint = () => { if (place === 'map') { draw(); return; } const next = todayCard({ place, bare, unread, pace }); const holder = node.parentNode; if (next) node.replaceWith(next); else { node.remove(); if (holder && holder.id === 'weeks-today') holder.hidden = true; } };
    const dismiss = async () => {
      const ok = await ctx.saveSetting?.({ todayDismissed: localDay(Date.now()) });
      // A failed save was announced as a success, and the card came back on reload with no explanation (m20).
      ctx.say(ok === false ? 'Today\'s plan could not be hidden; it will be here next time.' : 'Today\'s plan hidden for today.');
      if (ok !== false) repaint();
    };
    const restore = async () => { await ctx.saveSetting?.({ todayDismissed: null }); repaint(); };
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
      // "Today · about 109 min" read as a quota. The lines are a day's share now, and the total says what it is (GRAMMAR-PLAN §5: never forced).
      bare ? null : h('h3', { class: 'g-plan__h' }, 'Today', plan.minutes ? h('span', { class: 'g-plan__total', text: ` · about ${Math.round(plan.minutes)} min if you do it all` }) : null),
      rows.length ? h('ul', { class: 'g-plan__list' }, rows) : h('p', { class: 'g-today__line g-quiet', text: place === 'weeks' ? 'Nothing suggested for today — open Grammar to start a skill or add one to practice.' : 'Nothing suggested for today. Start a skill as new below, or add one to mixed practice.' }),
      h('p', { class: 'g-plan__foot' }, bare && plan.minutes ? h('span', { class: 'g-quiet', text: `${fmtMinutes(plan.minutes)} in all · ` }) : null, h('button', { type: 'button', class: 'g-link', onclick: dismiss }, 'Not today')));
    return node;
  }

  /* ------------------------------------------------------------ stats */
  /** How many of a skill's attempts the history view reads at most: a long log is windowed, never walked whole on a phone. */
  const HISTORY_WINDOW = 400;
  const HISTORY_DAYS = 21;

  function renderStats() {
    const now = Date.now();
    const ids = [...skills.keys()];
    const states = gstore.getStates();
    const attempts = gstore.getAttempts();
    const by = stats.byState(new Map(ids.map((id) => [id, stateOf(id)])), ids);
    const t = stats.totals(attempts, now);
    const days = stats.perDay(attempts, { days: 7, now }).filter((d) => d.items);
    const per = stats.perSkill(attempts, ids);
    const pairs = stats.confusionPairs(gstore.getConfusions(), skills);
    const dl = (label, value) => [h('dt', { text: label }), h('dd', { text: String(value) })];
    setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Stats' }), h('p', { class: 'g-lede', text: 'Grammar only — the reading study log is in Settings.' })),
      // The tally runs over the map *and* the chapter sets, so it reaches 95 where the map's lede says
       // 87 skills. Nothing reconciled the two figures; now the heading does (QA-B7).
      h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Skills' }),
        h('p', { class: 'g-quiet', text: `${index.skills.size} skill${index.skills.size === 1 ? '' : 's'}${ctx.sets?.size ? ` and ${ctx.sets.size} chapter set${ctx.sets.size === 1 ? '' : 's'}` : ''}, counted together.` }),
        h('dl', { class: 'g-dl' }, ['mastered', 'practising', 'learning', 'lapsed', 'new'].map((s) => dl(cap(s), by[s])))),
      h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Items' }),
        h('dl', { class: 'g-dl' }, dl('Today', t.today ? `${t.today} · ${stats.fmtPct(t.accToday)} right` : '0'), dl('Last 7 days', t.week ? `${t.week} · ${stats.fmtPct(t.accWeek)} right` : '0'), dl('All time', t.all ? `${t.all} · ${stats.fmtPct(t.accAll)} right · ${stats.fmtMin(t.ms)}` : '0')),
        days.length ? h('table', { class: 'study__table g-table' }, h('caption', { class: 'visually-hidden', text: 'Items per day, last 7 days' }),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Day' }), h('th', { scope: 'col', class: 'study__num', text: 'Items' }), h('th', { scope: 'col', class: 'study__num', text: 'Right' }))),
          h('tbody', {}, [...days].reverse().map((d) => h('tr', {}, h('th', { scope: 'row', text: fmtDay(d.day) }), h('td', { class: 'study__num', text: String(d.items) }), h('td', { class: 'study__num', text: stats.fmtPct(Math.round((d.right / d.items) * 100)) }))))) : h('p', { class: 'g-quiet', text: 'No items in the last seven days.' })),
      confusionSection(pairs),
      h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Per skill · last 10' }),
        h('ul', { class: 'g-perskill' }, ids.filter((id) => per.get(id)?.total).map((id) => { const p = per.get(id); return h('li', { class: 'g-perskill__row' },
          h('span', { class: 'g-perskill__name' }, h('span', { class: 'g-dot', 'data-state': stateOf(id).state, 'aria-hidden': 'true' }), h('button', { type: 'button', class: 'g-link', onclick: () => render('history', { skill: id }), 'aria-label': `History of ${titleOf(id)}` }, titleOf(id))),
          h('span', { class: 'g-perskill__dots', 'aria-label': `${p.right} of ${p.recent.length} right` }, p.recent.map((a) => h('span', { class: `g-tick${a.correct ? ' is-ok' : ''}${a.hinted ? ' is-hinted' : ''}`, 'aria-hidden': 'true', text: a.correct ? '✓' : '✗' }))),
          h('span', { class: 'g-perskill__acc', text: `${p.right} of ${p.recent.length}${p.hinted ? ` · ${p.hinted} hinted` : ''}` })); })),
        ids.every((id) => !per.get(id)?.total) ? h('p', { class: 'g-quiet', text: 'Nothing practised yet.' }) : null));
  }

  /**
   * "What you mix up": the top confusion pairs, each with a plain-words line
   * saying what separates the two and a Start that practises exactly those two
   * skills, alternating (GRAMMAR-CONTRACT.md, wave 3). The reason comes from
   * the lessons' own confusion blocks where they have one, so it arrives after
   * the fetch; the pair's own `plain` glosses stand in the meantime.
   */
  function confusionSection(pairs) {
    const section = h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'What you mix up' }));
    if (!pairs.length) {
      section.append(h('p', { class: 'g-quiet', text: 'Nothing yet. When a wrong answer names another skill — an ablative answered as a dative, a result clause taken for a purpose clause — the pair is counted here, with a way to practise the two against each other.' }));
      return section;
    }
    section.append(h('p', { class: 'g-quiet', text: 'The pairs your answers have crossed, most often first. Ten items alternating the two is what tells them apart.' }));
    section.append(h('ul', { class: 'g-pairs' }, pairs.map((c) => {
      const a = skills.get(c.a);
      const b = skills.get(c.b);
      // The reason is lesson prose, so it carries the lessons' own emphasis (*servīs* set in Latin italics).
      const why = h('p', { class: 'g-pair__why' }, inline(stats.confusionReason(a, b, {})));
      // The lessons say it better than the glosses do; they are fetched once and swapped in.
      Promise.all([lessonOf(c.a), lessonOf(c.b)])
        .then(([lessonA, lessonB]) => { why.replaceChildren(inline(stats.confusionReason(a, b, { lessonA, lessonB }))); })
        .catch(() => { /* the gloss line already stands */ });
      const direction = c.ba
        ? `${c.ab} × ${titleOf(c.a)} answered as ${titleOf(c.b)} · ${c.ba} the other way round`
        : `${c.ab} × ${titleOf(c.a)} answered as ${titleOf(c.b)}`;
      // The count is its own line-box, not a " · 5 times" tail: as a tail it wrapped and the next line
      // began with the separator (QA-B8). It sits beside the names, and under them when they fill the row.
      return h('li', { class: 'g-pair' },
        h('p', { class: 'g-pair__names' },
          h('span', { class: 'g-pair__who' },
            h('button', { type: 'button', class: 'g-link', onclick: () => render('history', { skill: c.a }) }, titleOf(c.a)),
            ' and ',
            h('button', { type: 'button', class: 'g-link', onclick: () => render('history', { skill: c.b }) }, titleOf(c.b))),
          h('span', { class: 'g-pair__count', text: `${c.count} time${c.count === 1 ? '' : 's'}` })),
        why,
        h('p', { class: 'g-pair__dir g-quiet', text: direction }),
        h('div', { class: 'g-pair__acts' },
          btn('Start', { onclick: () => render('session', { pair: [c.a, c.b], size: 10 }), 'aria-label': `Practise ${titleOf(c.a)} against ${titleOf(c.b)}: ten items` }, 'btn'),
          h('span', { class: 'g-quiet', text: 'ten items, these two only' })));
    })));
    return section;
  }

  /**
   * The confusion pair's session: a plan that alternates the two skills and
   * nothing else. It is not kept in LS_SESSION — Back or a reload
   * builds a fresh ten on the same pair, which is what the Start promises;
   * only the mixed practice session is worth resuming mid-queue.
   */
  function startPair(pair, size = 10) {
    const [a, b] = pair;
    if (!skills.has(a) || !skills.has(b)) { render('stats'); return; }
    // Both must be answerable before they can be practised; a lapsed or new row joins the rotation now, so the
    // answers that follow are judged as practice rather than as an early review (as startBlocked does, M1).
    // Unlike startBlocked this does not divert a *learning* skill back into Learn: the learner asked for the
    // pair, and half a pair is not a session (G3-12).
    for (const id of [a, b]) {
      if (!drillable(id)) {
        setBody(h('header', { class: 'g-head' }, h('h1', { class: 'g-title', text: 'Not yet' }), h('p', { class: 'g-lede', text: `${titleOf(id)} has no sentences in the library to drill, so the pair cannot be practised together yet.` })),
          h('div', { class: 'g-acts' }, btn('Back to stats', { onclick: () => render('stats') }, 'btn')));
        return;
      }
      const st = gstore.getState(id);
      if (!inRotation(st) || decay(st).state === 'lapsed') gstore.setState(addToPractice(st ?? id));
    }
    const plan = buildPairSession({ a, b, states: gstore.getStates(), skills, size, seed: Math.floor(Math.random() * 1e9) });
    // `fill: null`: nothing but these two ever enters — the Start promised so. `pair` is what lets a miss
    // come back at all: the plan alternates, so the re-queue arrives as the pair itself (G3-04).
    const practice = createPractice({ plan, gstore, items, skillsIndex, currentWeekN: ctx.currentWeekN(), preset: 'even', size, rand: Math.random, fill: null, pair: [a, b] });
    const first = practice.start();
    if (!first) { setBody(h('p', { class: 'g-quiet', text: 'No sentences fit these two skills yet.' }), h('div', { class: 'g-acts' }, btn('Back to stats', { onclick: () => render('stats') }, 'btn'))); return; }
    ctx.say(`${titleOf(a)} against ${titleOf(b)}: ${plan.length} items.`);
    runSession({ runner: practice.runner, title: `${titleOf(a)} · ${titleOf(b)}`, note: 'The two alternate: the same forms, asked either way round.', mode: 'practice', hintOpen: false, practiceLink: true, onDone: (summary) => renderSummary(summary, { pair: [a, b], size }) });
  }

  /* ---------------------------------------------------------- history */
  /**
   * One skill's own page (GRAMMAR-CONTRACT.md, wave 3): how the attempts went,
   * how stability and stage moved, the last twenty items with the learner's own
   * answers beside the right ones, and the skill's confusions. Everything is
   * read from `drill_attempts` and `confusions` — no new tables — and the log
   * is windowed to its tail, so a skill with thousands of rows still opens at
   * once on a phone.
   */
  function renderHistory({ skill: id, from = null }) {
    const skill = skills.get(id);
    if (!skill) { render('map'); return; }
    const now = Date.now();
    const st = stateOf(id);
    const total = gstore.countAttempts(id);
    const rows = gstore.getAttempts({ skill: id, limit: HISTORY_WINDOW });
    // The store has already trimmed the rows, so the lifetime count has to be handed in: deriving it
    // from the list made the parts add up to something other than the stated total (QA-B2).
    const hist = stats.skillHistory(rows, { last: 20, days: HISTORY_DAYS, now, max: HISTORY_WINDOW, total });
    const confs = stats.confusionsOf(id, gstore.getConfusions(), skills);
    const dl = (label, ...value) => [h('dt', { text: label }), h('dd', {}, ...value)];

    const acts = [];
    if (drillable(id)) acts.push(btn('Practise this skill', { onclick: () => startBlocked(id, from) }, 'btn btn--primary'));
    acts.push(btn('Lesson', { onclick: () => render('lesson', { skill: id, from }) }, 'btn btn--quiet'));
    if (!skill.set && chartTable(skill)) acts.push(btn('Print chart', { onclick: () => printChart(skill) }, 'btn btn--quiet'));

    const head = [
      backButton(from),
      h('header', { class: 'g-head' },
        skill.set ? null : h('p', { class: 'g-kicker', text: `Cap. ${roman(skill.chapter)} · ${skill.course} week ${skill.week ?? '—'} · ${cap(String(skill.category ?? '').replace('-', ' '))}` }),
        h('h1', { class: 'g-title', text: skill.title }),
        h('p', { class: 'g-lede', text: 'History' }),
        h('p', { class: 'g-skill__state' }, h('span', { class: 'g-dot', 'data-state': st.state, 'aria-hidden': 'true' }), dueText(st, now))),
      h('div', { class: 'g-acts' }, acts),
    ];

    if (!total) {
      setBody(head, h('p', { class: 'g-quiet', text: 'This skill has not been practised yet, so there is nothing to look back on. Its history starts with the first item answered.' }));
      return;
    }

    const c = hist.counts;
    const shown = hist.read;
    const attemptsSection = h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Attempts' }),
      h('dl', { class: 'g-dl' },
        dl('In all', `${total} item${total === 1 ? '' : 's'}`),
        // Right / hinted / wrong are counted over the window, so on a long log they add up to `shown`,
        // not to `total`. The percentage says which figure it is over rather than reading as a lifetime.
        dl(hist.windowed ? `Right of the last ${shown}` : 'Right', `${c.right}${shown ? ` · ${Math.round((c.right / shown) * 100)}%` : ''}`),
        dl('With a hint', String(c.hinted)),
        dl('Wrong', String(c.wrong))),
      hist.windowed ? h('p', { class: 'g-quiet', text: `Right, with a hint and wrong count the last ${shown} attempts — they add up to ${shown}, not to ${total}. The ${total - shown} before them are counted only in "In all".` }) : null,
      sparkStrip(hist.perDay));

    const last = hist.trail[hist.trail.length - 1] ?? null;
    const movedSection = h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'How it moved' }),
      h('dl', { class: 'g-dl' },
        dl('Stability', stats.fmtStability(st.stability_days)),
        dl('Stage', `${st.stage} of 3`),
        dl('State', cap(st.state)),
        dl('Next review', dueText(st, now).split(' · ').slice(1).join(' · ') || '—')),
      hist.trail.length > 1 ? trailChart(hist.trail) : null,
      hist.stageChanges.length
        ? h('ul', { class: 'g-trail__steps' }, hist.stageChanges.map((sc) => h('li', { text: `Stage ${sc.from} → ${sc.to} · ${fmtWhen(sc.at)}` })))
        : h('p', { class: 'g-quiet', text: `Still at stage ${st.stage}: four right in a row at this stage moves it up.` }),
      // The replay now includes Learn's own pass (stats.progressTrail), so the two figures normally agree.
      // What it cannot see is a reset: the log survives one, the row does not.
      last && Math.abs((Number(last.stability) || 0) - (Number(st.stability_days) || 0)) > 0.25
        ? h('p', { class: 'g-quiet', text: 'The curve is replayed from the attempts — the answers, and Learn’s own pass where the log shows one. It can still differ from the stability above when the skill was reset by hand, which the log does not record.' })
        : null);

    const itemsSection = h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: `The last ${hist.recent.length === 1 ? 'item' : `${hist.recent.length} items`}` }),
      h('div', { class: 'g-hist__scroll' },
        h('table', { class: 'study__table g-table g-hist__table' },
          h('caption', { class: 'visually-hidden', text: `The last ${hist.recent.length} items on ${skill.title}` }),
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col', text: 'When' }),
            h('th', { scope: 'col', text: 'Item' }),
            h('th', { scope: 'col', text: 'You' }),
            h('th', { scope: 'col', text: 'The answer' }))),
          h('tbody', {}, hist.recent.map((a) => h('tr', { class: a.correct ? null : 'is-wrong' },
            // Right and wrong were a colour and an aria-hidden glyph, so a screen reader — and anyone who
            // cannot separate the two inks — was told nothing (G3-08). The word is in the row header.
            h('th', { scope: 'row' },
              h('span', { class: `g-tick${a.correct ? ' is-ok' : ''}${a.hinted ? ' is-hinted' : ''}`, 'aria-hidden': 'true', text: a.correct ? '✓' : '✗' }),
              h('span', { class: 'visually-hidden', text: `${a.correct ? 'Right' : 'Wrong'}${a.hinted && a.correct ? ', with a hint' : ''}. ` }),
              ' ', h('span', { text: fmtWhen(a.at) })),
            h('td', {}, h('span', { class: 'g-hist__kind', text: a.kind }), a.mode === 'learn' ? h('span', { class: 'g-hist__mode', text: ' learn' }) : null),
            // Only the kinds that actually produce Latin are marked as Latin: a choice, a parse or a
            // self-graded translate holds English ("time when", "graded partly"), and a Latin voice
            // reading English is worse than none (QA-B5).
            h('td', { class: 'g-hist__given', lang: latinAnswer(a) ? 'la' : null, text: a.given || '—' }),
            h('td', { class: 'g-hist__want', lang: latinAnswer(a) ? 'la' : null, text: a.expected || '—' })))))));

    const confSection = h('section', { class: 'g-stat' }, h('h2', { class: 'g-h2', text: 'Confusions' }),
      confs.length
        ? h('ul', { class: 'g-conf' }, confs.map((x) => h('li', {},
            `${titleOf(x.other)} · ${x.count} time${x.count === 1 ? '' : 's'} — ${confDirection(x)}. `,
            h('button', { type: 'button', class: 'g-link', onclick: () => render('session', { pair: [id, x.other], size: 10 }) }, 'practise the pair'))))
        : h('p', { class: 'g-quiet', text: 'None recorded for this skill.' }));

    setBody(head, attemptsSection, movedSection, itemsSection, confSection);
  }

  /**
   * The drill kinds whose answer and expected answer are Latin words. `recognise`
   * and `parse` are answered with English feature names ("time when", "dative
   * singular"), `translate` with a self-grade, and a vocabulary row does not say
   * which way the deck ran — so none of those is marked `lang="la"`.
   */
  const LATIN_ANSWER_KINDS = new Set(['chart', 'blank', 'transform', 'reorder', 'question', 'pensum']);
  const latinAnswer = (a) => !a.self && LATIN_ANSWER_KINDS.has(a.kind);

  /** Which way round a confusion went, said without arithmetic in brackets. */
  const confDirection = (x) => (x.mine === x.count ? 'always this skill answered as that one'
    : x.mine === 0 ? 'always that one answered as this skill'
    : `${x.mine} this skill answered as that one, ${x.count - x.mine} the other way round`);

  /** Items per day over the history window: one bar a day, the whole strip labelled, the figures said in words underneath. */
  function sparkStrip(perDay) {
    const max = Math.max(1, ...perDay.map((d) => d.items));
    const items = perDay.reduce((n, d) => n + d.items, 0);
    const active = perDay.filter((d) => d.items).length;
    return h('div', { class: 'g-spark__wrap' },
      h('ol', { class: 'g-spark', 'aria-label': `Items per day over the last ${perDay.length} days` },
        perDay.map((d) => h('li', { class: 'g-spark__d', 'data-empty': d.items ? null : '', style: `--h:${d.items ? Math.max(0.12, d.items / max) : 0}`, title: `${fmtDay(d.day)}: ${d.items} item${d.items === 1 ? '' : 's'}${d.items ? `, ${d.right} right` : ''}` },
          h('span', { class: 'visually-hidden', text: `${fmtDay(d.day)}: ${d.items} items${d.items ? `, ${d.right} right, ${d.wrong} wrong` : ''}` })))),
      h('p', { class: 'g-quiet', text: items ? `${items} item${items === 1 ? '' : 's'} on ${active} day${active === 1 ? '' : 's'} in the last ${perDay.length}.` : `Nothing in the last ${perDay.length} days.` }));
  }

  /**
   * The stability curve, replayed from the attempts. An inline SVG polyline —
   * no library, no colour it cannot lose: the line is ink, a wrong answer is a
   * gap in it. The reading is given in words beside it, so nothing depends on
   * seeing the shape.
   */
  function trailChart(trail) {
    const W = 320;
    const H = 56;
    const vals = trail.map((t) => Number(t.stability) || 0);
    const max = Math.max(...vals, 1);
    const x = (i) => (trail.length === 1 ? W : (i / (trail.length - 1)) * W);
    const y = (v) => H - (v / max) * (H - 4) - 2;
    const points = trail.map((t, i) => `${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'g-trail');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-label', `Stability over the last ${trail.length} attempts, from ${stats.fmtStability(vals[0])} to ${stats.fmtStability(vals[vals.length - 1])}; the highest it reached was ${stats.fmtStability(max)}.`);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('class', 'g-trail__line');
    line.setAttribute('points', points);
    svg.append(line);
    // Every wrong answer, where the curve dropped: the shape alone would not say which dips were misses.
    // A tick, not a dot — the box is stretched to the width of the page, and a circle would print as an ellipse.
    for (let i = 0; i < trail.length; i++) {
      if (trail[i].correct) continue;
      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tick.setAttribute('class', 'g-trail__miss');
      tick.setAttribute('x1', x(i).toFixed(1));
      tick.setAttribute('x2', x(i).toFixed(1));
      tick.setAttribute('y1', (y(vals[i]) - 5).toFixed(1));
      tick.setAttribute('y2', (y(vals[i]) + 5).toFixed(1));
      svg.append(tick);
    }
    return h('figure', { class: 'g-trail__fig' }, svg,
      h('figcaption', { class: 'g-quiet', text: `Stability over the last ${trail.length} attempts · highest ${stats.fmtStability(max)}. A tick marks a wrong answer.` }));
  }

  /** "3 Sep, 14:20" — when an attempt was made; the year only when it was not this one. */
  function fmtWhen(at) {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return '—';
    const opts = { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleString(undefined, opts);
  }

  /* ------------------------------------------------------------ print */
  /** The paradigm a skill's chart prints: its own focus cells lit, exactly as the lesson lights them. */
  const chartTable = (skill) => paradigmFor(skill, null);
  /** How many book examples a printed skill sheet carries (`Math.max(3, …Math.min(3, …))` was always 3 — G3-10). */
  const SHEET_EXAMPLES = 3;
  /** Above this many skills the bulk print asks first and builds in chunks, yielding so its own message can paint. */
  const BULK_ASK = 20;
  const BULK_CHUNK = 8;
  const yieldToPaint = () => new Promise((r) => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(r, 0)); else setTimeout(r, 0); });

  /** One skill's chart, one table a page, its focus cells boxed. */
  function printChart(skill) {
    const table = chartTable(skill);
    if (!table) { ctx.say(`${skill.title} has no paradigm table to print.`); return; }
    // A browser with no printing at all told the learner nothing before (G3-10).
    if (!printDocument(buildChart({ skill, paradigm: table, roman }), { title: `${skill.title} — chart` })) ctx.say('This browser cannot print from the app. Use the browser’s own Print in its menu.');
  }

  /** The skill sheet: the lesson's rule, the paradigm and its examples on paper. */
  async function printSheet(skill) {
    const lesson = await lessonOf(skill.id);
    const rule = (lesson?.core ?? []).find((b) => b.type === 'rule')?.text ?? '';
    const exBlock = (lesson?.core ?? []).find((b) => b.type === 'examples') ?? { units: [], invented: [] };
    const ids = exBlock.units || [];
    const examples = exampleUnits(skill, ids, SHEET_EXAMPLES)
      .map(({ unit: u, own }) => ({ la: u.la, en: u.en || '', ref: `${unitRefText(u)}${own ? '' : ' · from the library'}` }));
    for (const ex of exBlock.invented || []) examples.push({ la: ex.la, en: ex.en || '', ref: 'Invented example' });
    const confBlock = (lesson?.core ?? []).find((b) => b.type === 'confusion');
    const confusion = confBlock ? { title: titleOf(confBlock.with), text: String(confBlock.text ?? '').replace(/\*\*?/g, '') } : null;
    if (!printDocument(buildSheet({ skill, paradigm: chartTable(skill), rule: String(rule).replace(/\*\*?/g, ''), examples, confusion, roman }), { title: `${skill.title} — sheet` })) ctx.say('This browser cannot print from the app. Use the browser’s own Print in its menu.');
  }

  /**
   * The map's Print charts: every skill the filter is showing that has a
   * paradigm, one table a page.
   *
   * Three things the first version got wrong (G3-09, QA-I2). The "Building…"
   * message could never paint, because a synchronous loop over 87 skills — each
   * a full library scan for its candidates — followed it on the same tick; the
   * confirm came *after* all that work, so declining wasted thirteen seconds of
   * blocked main thread; and "All" is 777 sheets, which is a filing cabinet
   * rather than a study aid. So: a category filter prints straight through
   * (that is the default and the recommended route), "All" asks before any work
   * is done, and the build yields to the browser every few skills, so the
   * message shows and the page keeps answering.
   */
  async function printCharts(filter = 'all') {
    const shown = [...index.skills.values()].filter((s) => filter === 'all' || s.category === filter);
    if (!shown.length) { ctx.say('No skills are shown under this filter.'); return; }
    if (filter === 'all' && shown.length > BULK_ASK
      && !confirm(`Print the charts of all ${shown.length} skills? That is several hundred sheets. Cancel to choose a category above and print just those.`)) {
      ctx.say('Nothing printed. Choose a category above, then Print charts again.');
      root.querySelector('.g-filter')?.scrollIntoView({ block: 'nearest' });
      root.querySelector('.g-filter__btn')?.focus?.({ preventScroll: true });
      return;
    }
    const frag = document.createDocumentFragment();
    let skillCount = 0;
    let pages = 0;
    if (shown.length > BULK_ASK) { ctx.say(`Building the charts for ${shown.length} skills…`); await yieldToPaint(); }
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i];
      const table = chartTable(s);
      const node = table ? buildChart({ skill: s, paradigm: table, roman }) : null;
      if (node) { pages += node.childElementCount; skillCount += 1; frag.append(node); }
      if (shown.length > BULK_ASK && (i + 1) % BULK_CHUNK === 0) await yieldToPaint();
    }
    if (!pages) { ctx.say('None of the skills shown has a paradigm table to print.'); return; }
    if (!confirm(`Print ${pages} page${pages === 1 ? '' : 's'} — the charts of ${skillCount} skill${skillCount === 1 ? '' : 's'}, one table a page?`)) { ctx.say('Nothing printed.'); return; }
    if (!printDocument(frag, { title: filter === 'all' ? 'Latin 103 — paradigm charts' : `Latin 103 — ${filter.replace('-', ' ')} charts` })) ctx.say('This browser cannot print from the app. Use the browser’s own Print in its menu.');
  }

  const fmtDay = (day) => { const d = new Date(`${day}T12:00:00`); return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };

  return { render, refresh, repaint, todayCard, chapterPanel, dispose };
}
