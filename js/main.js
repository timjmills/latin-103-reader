// Boot: pick a store, load the dictionary modules, wire header + reader + panel + audio.
import { createReader } from './reader.js';
import { createWordPanel } from './wordpanel.js';
import { initSettings, applyToDocument, clampPanelWidth, rateMenu, fmtRate, listenStatusText, synthHintText } from './settings.js';
import { clampRate } from './sync.js';

const $ = (sel, root = document) => root.querySelector(sel);
const LS_WEEK = 'l103.week';
const LS_HINT_TRANSLATION = 'l103.hint.translation';   // "1" once the first-run Translation hint has been shown
const NOTICE_MS = 5000;

async function pickStore() {
  const params = new URLSearchParams(location.search);
  let fixture = params.has('fixture');
  if (!fixture) {
    // app/config.js (beside index.html). A missing or broken config is a boot
    // error, never a silent fall-back to the fixture store.
    let cfg;
    try { cfg = await import('../config.js'); }
    catch (e) { throw new Error(`config.js could not be loaded (${e?.message ?? e}). Add ?fixture=1 to the URL to read the local fixture instead.`); }
    fixture = !cfg.SUPABASE_URL;
  }
  // audio.js takes the store from attach(), so it works with either store.
  const audioMod = await optional('./audio.js');
  const audio = audioMod?.audio ?? null;
  if (fixture) { const m = await import('./store-fixture.js'); return { store: m.store, auth: m.auth, fixture: true, audio, registerServiceWorker: null }; }
  const [storeMod, { auth }] = await Promise.all([import('./store.js'), import('./auth.js')]);
  return { store: storeMod.store, auth, fixture: false, audio, registerServiceWorker: storeMod.registerServiceWorker ?? null };
}

async function optional(path) { try { return await import(path); } catch (e) { console.warn('[boot] optional module missing', path, e?.message); return null; } }

async function boot() {
  const [{ store, auth, fixture, audio, registerServiceWorker }, tok, dict, par] = await Promise.all([
    pickStore(),
    import('./tokenize.js'),
    import('./dictionary.js'),
    import('./paradigms.js'),
  ]);
  document.documentElement.dataset.fixture = fixture ? '1' : '0';

  // Sign-in gate (real store only): E's auth.js shows its own form and resolves once signed in.
  if (!fixture) {
    if (auth.ensureSignedIn) await auth.ensureSignedIn();
    else if (!auth.user()) throw new Error('Not signed in and auth.ensureSignedIn() is not available.');
  }

  // Settings first so the shell is right while data loads. Before ready() the
  // store answers from its localStorage mirror; a fresh device gets the synced
  // row only once ready() has pulled it, so the subscription goes in first and
  // the settings are re-read afterwards.
  let settings = await store.getSettings();
  applyToDocument(settings);
  mirror(settings);
  function mirror(s) { try { localStorage.setItem('latin103.settings', JSON.stringify(s)); } catch { /* ignore */ } }

  const remote = { lookups: false, settings: false, alignments: false, weeks: false };
  let onRemoteChange = (kind) => { remote[kind] = true; };   // buffered until the UI exists
  store.onChange?.((kind) => onRemoteChange(kind));

  await Promise.all([store.ready(), dict.loadGlossary('./data/glossary.json').catch((e) => console.warn('[dict] glossary not loaded', e))]);

  const synced = await store.getSettings();
  if (JSON.stringify(synced) !== JSON.stringify(settings)) { settings = synced; applyToDocument(settings); mirror(settings); }

  const live = $('#live');
  const layout = $('.layout');
  // The sticky header's height feeds the side panel's offset and scroll margins.
  const bar = $('.bar');
  const setBarHeight = () => document.documentElement.style.setProperty('--bar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
  new ResizeObserver(setBarHeight).observe(bar);
  setBarHeight();
  const readerEl = $('#reader');
  let lookups = await store.getLookups();

  // Short visible status line + the live region (play errors and the like).
  const noticeEl = $('#notice');
  let noticeTimer = 0;
  function notify(text) {
    if (live) live.textContent = text;
    noticeEl.textContent = text;
    noticeEl.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { noticeEl.hidden = true; }, NOTICE_MS);
  }

  // Which entry the learner picked in the switcher, per form (memory only).
  const chosenEntry = new Map();
  const describeForm = (form) => {
    const r = dict.lookup(form);
    if (!r.entries.length) return null;
    const entry = r.entries[chosenEntry.get(form) ?? 0] ?? r.entries[0];
    return dict.describe(entry, { compact: !!settings.compact, form });
  };

  // "In plain words" under every note: settings.plainOpen is the learner's last
  // choice, so the disclosures stay open once one has been opened.
  const plain = { get: () => !!settings.plainOpen, set: (on) => { if (!!settings.plainOpen !== !!on) saveSettings({ plainOpen: !!on }); } };
  const reader = createReader({ root: readerEl, tokenize: tok.tokenize, describeForm, live, listen: $('#listen'), plain });
  const panel = createWordPanel({
    dialog: $('#popup'), aside: $('#panel'), layout,
    lookup: dict.lookup, describe: dict.describe, paradigm: par.paradigm, store,
    getSettings: () => settings,
    getLookupRecord: (form) => lookups.get(form),
    entryIndex: { get: (form) => chosenEntry.get(form), set: (form, i) => { chosenEntry.set(form, i); if (reader.getView() === 'sentence') reader.rerender(); } },
    onLookupsChanged: async () => { lookups = await store.getLookups(); reader.setLookups(lookups); },
    onWord: (w) => panel.showWord(w),   // a Latin word tapped inside a section summary shown in the panel
    live,
    plain,
    // The side panel's stack names its sentence and seeds the note row from the unit itself.
    getUnit: (id) => units.find((u) => u.id === id) ?? null,
    getWeek: () => weeks.find((w) => w.n === weekN) ?? null,
  });
  window.latinReader = { reader, panel, store, audio };   // documented hooks (see README-ui.md)

  reader.on('word', (w) => panel.showWord(w));
  reader.on('note', (n) => panel.showNote(n));
  // Sentence view's "Section summary" button: the part's summary in the panel / popup.
  reader.on('summary', ({ part, unitId, el, body }) => panel.showSummary({ part: part.part, body, unitId, el }));
  // Sentence view moved on (Next / Previous, j / k, chapter playback): an open side-panel stack follows the sentence.
  reader.on('navigate', ({ unit }) => { if (unit) panel.showSentence(unit.id); });

  /* ------------------------------------------------------ header */
  const weeks = await store.getWeeks();
  // Public course outline (all 14 weeks) — merged with what the library holds.
  let course = [];
  try { course = await (await fetch('./data/course.json')).json(); } catch { /* fall back to library weeks only */ }
  const outline = course.length ? course : weeks;
  const weekBtn = $('#week-btn');
  const weeksDialog = $('#weeks');
  const weeksList = $('#weeks-list');
  function renderWeeksMenu(currentN) {
    weeksList.replaceChildren(...outline.map((c) => {
      const lib = weeks.find((w) => w.n === c.n);
      const li = document.createElement('li');
      li.className = 'weeks__item';
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'weeks__row'; b.dataset.n = String(c.n);
      if (!lib) b.disabled = true;
      if (c.n === currentN) b.setAttribute('aria-current', 'true');
      const n = document.createElement('span'); n.className = 'weeks__n'; n.textContent = String(c.n);
      const name = document.createElement('span'); name.className = 'weeks__name'; name.lang = 'la'; name.textContent = lib?.title ?? c.title;
      const meta = document.createElement('span'); meta.className = 'weeks__meta';
      meta.textContent = [c.reading, c.focus?.label].filter(Boolean).join(' — ');
      const state = document.createElement('span'); state.className = 'weeks__state';
      state.textContent = lib ? (c.n === currentN ? 'Reading now' : '') : 'Not added yet';
      b.append(n, name, meta, state);
      li.append(b);
      return li;
    }));
  }
  function setWeekButton(n) {
    const c = outline.find((w) => w.n === n) || weeks.find((w) => w.n === n);
    weekBtn.querySelector('.week__num').textContent = `Week ${n}`;
    weekBtn.querySelector('.week__title').textContent = c?.title ?? '';
  }
  weekBtn.addEventListener('click', () => { renderWeeksMenu(weekN); weeksDialog.showModal(); weeksList.querySelector('[aria-current="true"]')?.focus(); });
  weeksDialog.querySelector('[data-close="weeks"]').addEventListener('click', () => weeksDialog.close());
  weeksDialog.addEventListener('click', (e) => { if (e.target === weeksDialog) weeksDialog.close(); });
  weeksList.addEventListener('click', (e) => {
    const b = e.target.closest('.weeks__row'); if (!b || b.disabled) return;
    weeksDialog.close(); loadWeek(Number(b.dataset.n));
  });
  // Arrow keys move between the rows (Home/End to the first/last); Tab still works.
  weeksList.addEventListener('keydown', (e) => {
    const rows = [...weeksList.querySelectorAll('.weeks__row')];
    const i = rows.indexOf(e.target);
    if (i < 0) return;
    const next = { ArrowDown: Math.min(rows.length - 1, i + 1), ArrowUp: Math.max(0, i - 1), Home: 0, End: rows.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    rows[next].focus();
  });
  let weekN = Number(localStorage.getItem(LS_WEEK)) || weeks[0]?.n || 1;
  if (!weeks.some((w) => w.n === weekN)) weekN = weeks[0]?.n ?? 1;
  let units = [];
  let unitsWeek = null;   // the week `units` belongs to
  let settingsUI = null;

  /* ------------------------------------------------------- audio */
  // Per-unit play buttons need a recording AND an alignment (playUnit rejects otherwise).
  async function audioInfo(n = weekN) {
    const [url, rows, us] = await Promise.all([
      Promise.resolve(store.getAudioUrl(n)).catch(() => null),
      Promise.resolve(store.getAlignment(n)).catch(() => []),
      n === unitsWeek ? units : store.getUnits(n),   // `units` may still be the previous week's while a new one loads
    ]);
    return {
      hasAudio: !!url, alignedCount: rows.length, total: us.length, alignedIds: new Set(rows.map((r) => r.unit_id)),
      synthIds: new Set(rows.filter((r) => r.synth).map((r) => r.unit_id)),   // units read by a synthesised voice (the listen bar says so)
      durationMs: audio?.alignmentEndMs?.(rows) ?? 0,   // from the alignment, so the listen bar can say "14 min" before the file is fetched
    };
  }
  // Which units get a play button: only aligned ones, only when there is a
  // recording, and only while the Audio toggle (settings.showAudio) is on.
  const audioOn = () => settings.showAudio !== false;
  const playable = (info) => (audio && audioOn() && info.hasAudio && info.alignedCount > 0 ? info.alignedIds : false);
  let audioState = null;   // the current week's audioInfo(), re-read on every week load / upload / alignment

  async function refreshAudioAvailability() {
    const n = weekN;
    const info = await audioInfo(n);
    if (n !== weekN) return;
    audioState = info;
    reader.setAudioAvailable(playable(info));
    settingsUI?.refreshAudio();
    paintListen();
  }

  const transport = $('#transport');
  const transportPos = $('[data-transport-pos]');
  const transportPause = $('[data-transport="pause"]');
  // While the (fixed) transport is shown, #main gets that much bottom padding
  // (reader.css reads --transport-h + html[data-transport]) so the last
  // sentence and sentence view's Next stay reachable underneath it.
  const setTransportHeight = () => {
    const h = transport.hidden ? 0 : Math.round(transport.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--transport-h', `${h}px`);
    document.documentElement.dataset.transport = transport.hidden ? 'off' : 'on';
  };
  new ResizeObserver(setTransportHeight).observe(transport);
  // Playback speed: the "1.0×" buttons in the transport and the listen bar
  // open the same chip row as Settings → Audio (rateMenu() in settings.js);
  // all three write settings.audioRate and paintRate() keeps them in step.
  const pickRate = (r) => saveSettings({ audioRate: r });
  const transportRate = rateMenu({ btn: $('[data-transport="rate"]'), row: $('#transport-rates'), scope: transport, onPick: pickRate });
  const listen = $('#listen');
  const listenRate = rateMenu({ btn: $('[data-listen="rate"]'), row: $('#listen-rates'), scope: listen, onPick: pickRate });
  const rate = () => clampRate(settings.audioRate);
  function paintRate() {
    const r = rate();
    audio?.setRate?.(r);
    transportRate?.paint(r);
    listenRate?.paint(r);
  }
  function paintTransport(st) {
    const active = st.mode === 'all';
    if (active) {
      const i = units.findIndex((u) => u.id === st.currentUnit);
      transportPos.textContent = i >= 0 ? `sentence ${i + 1} of ${units.length}` : '';
      transportPause.textContent = st.playing ? 'Pause' : 'Resume';
    }
    if (transport.hidden !== !active) {
      transport.hidden = !active;
      setTransportHeight();
      if (!active) transportRate?.close();
      if (active && live) live.textContent = `Playing chapter at ${fmtRate(rate())}.`;   // once, at the start; the sentences are not read out as they play
    }
  }
  if (audio) {
    audio.attach({
      setPlayingUnit: (id) => reader.setPlayingUnit(id),
      setPlayingWord: (id, i) => reader.setPlayingWord(id, i),
      wordTexts: (id) => reader.wordTexts(id),
    }, store);
    let lastError = null;
    let lastMode = 'idle';
    audio.onState?.((st) => {
      paintTransport(st);
      paintListen(st);
      if (st.mode === 'idle' && lastMode !== 'idle') listenRate?.close();   // playback over: the speed row folds away too
      lastMode = st.mode;
      if (st.error !== lastError) { lastError = st.error; if (st.error) notify(st.error); }
    });
    transportPause.addEventListener('click', () => { if (audio.status().playing) audio.pause(); else audio.resume(); });
    // Stop hides the transport under the keyboard: focus goes to the listen bar's Play button (the bar is painted synchronously by stop()).
    $('[data-transport="stop"]').addEventListener('click', () => { audio.stop(); if (!listenPlay.hidden && !listen.hidden) listenPlay.focus(); });
  }
  reader.on('play', ({ unitId, weekN: n }) => {
    document.dispatchEvent(new CustomEvent('latin-reader:play-unit', { detail: { unitId, weekN: n } }));
    if (!audio) { notify('Audio playback is not available.'); return; }
    audio.playUnit(unitId).catch((e) => notify(e?.message || 'Could not play this sentence.'));
  });

  /* ------------------------------------------------- listen bar (in the text) */
  // #listen sits at the top of the passage / above the sentence (reader.js moves
  // it into every render): "Play passage" or "Play sentence" + "Play from here",
  // Pause / Stop while anything plays, the speed menu (the same chips as the
  // transport and Settings → Audio) and a status line. With nothing to play, or
  // the Audio toggle off, it shows one quiet line instead of disappearing.
  const listenPlay = $('[data-listen="play"]');
  const listenFrom = $('[data-listen="from"]');
  const listenPause = $('[data-listen="pause"]');
  const listenStop = $('[data-listen="stop"]');
  const listenStatus = $('[data-listen-status]');
  const listenSynth = $('[data-listen-synth]');
  const listenQuiet = $('[data-listen-quiet]');
  function paintListen(st = audio?.status?.() ?? { mode: 'idle', playing: false }) {
    if (!listen) return;
    const focused = document.activeElement;   // read before anything is hidden: hiding the focused button blurs it
    listen.hidden = !units.length;
    const info = audioState;
    let quiet = '';
    if (!audio) quiet = 'Audio playback is not available in this build.';
    else if (!info) quiet = 'Checking for a recording…';
    else if (!info.hasAudio) quiet = 'No recording for this week yet';
    else if (!info.alignedCount) quiet = 'Recording uploaded — align it in Settings → Audio to listen';
    else if (!audioOn()) quiet = 'Audio is off — turn it on in the toolbar';
    const active = st.mode === 'all' || st.mode === 'unit';
    listen.dataset.state = quiet ? 'quiet' : active ? 'playing' : 'ready';
    listenQuiet.textContent = quiet;
    if (quiet) { listenRate?.close(); return; }
    const sentence = reader.getView() === 'sentence';
    const unit = reader.currentUnit();
    const aligned = !sentence || !!(unit && info.alignedIds.has(unit.id));
    listenPlay.hidden = active;
    listenPlay.disabled = !aligned;
    listenPlay.querySelector('[data-listen-label]').textContent = sentence ? 'Play sentence' : 'Play passage';
    listenFrom.hidden = active || !sentence;
    listenFrom.disabled = !aligned;
    listenPause.hidden = !active;
    listenPause.textContent = st.playing ? 'Pause' : 'Resume';
    listenStop.hidden = !active;
    const index = st.mode === 'all' ? units.findIndex((u) => u.id === st.currentUnit) : -1;
    // The element's duration only once it holds *this* week's file (after a
    // week switch it is still the previous recording's until the next play);
    // otherwise the alignment's own end — also the right figure when two weeks
    // share one recording.
    const durationMs = st.weekN === weekN && st.durationMs > 0 ? st.durationMs : info.durationMs;
    listenStatus.textContent = aligned
      ? listenStatusText({ ...info, durationMs }, st, { index })
      : 'This sentence has not been aligned yet';
    const synth = synthHintText({ sentence, unitSynth: !!(unit && info.synthIds?.has(unit.id)), anySynth: (info.synthIds?.size ?? 0) > 0 });
    listenSynth.textContent = synth;
    listenSynth.hidden = !synth;
    // Play → Pause (and back) swaps the button under the keyboard: keep focus in the bar.
    if (focused && listen.contains(focused) && focused.hidden) (active ? listenPause : listenPlay).focus({ preventScroll: true });
  }
  if (listen && audio) {
    const tryPlay = (p) => p.catch((e) => notify(e?.message || 'Could not play the recording.'));
    listenPlay.addEventListener('click', () => {
      const u = reader.currentUnit();
      if (reader.getView() === 'sentence' && u) tryPlay(audio.playUnit(u.id));
      else tryPlay(audio.playAll(units[0]?.id ?? null));   // the whole passage, from its first sentence (playAll needs a unit to know the week)
    });
    listenFrom.addEventListener('click', () => { const u = reader.currentUnit(); if (u) tryPlay(audio.playAll(u.id)); });
    listenPause.addEventListener('click', () => { if (audio.status().playing) audio.pause(); else audio.resume(); });
    listenStop.addEventListener('click', () => audio.stop());
  }
  reader.on('render', () => paintListen());

  async function loadWeek(n) {
    weekN = n;
    setWeekButton(n);
    if (!weeks.length) {
      // Signed in, but nothing seeded yet: say so instead of showing a blank page.
      readerEl.replaceChildren(Object.assign(document.createElement('div'), { className: 'empty-library' }));
      const box = readerEl.firstChild;
      box.innerHTML = '<h2>Your library is empty</h2>'
        + '<p>You are signed in, but no weeks have been loaded into your account yet.</p>'
        + '<p>On your computer, open the project folder and run <code>node scripts/seed.mjs</code> (see README, step 5). Then reload this page.</p>';
      document.title = 'Latin 103 Reader';
      return;
    }
    try { localStorage.setItem(LS_WEEK, String(n)); } catch { /* ignore */ }
    audio?.stop?.();
    const week = weeks.find((w) => w.n === n);
    const [us, highlights, info] = await Promise.all([store.getUnits(n), store.getHighlights(n), audioInfo(n)]);
    if (n !== weekN) return;   // the user moved on while this loaded
    units = us;
    unitsWeek = n;
    audioState = info;
    document.title = `Week ${n} · ${week?.title ?? ''} — Latin 103`;
    const focusBtn = $('[data-toggle="highlights"] .toggle__label');
    focusBtn.textContent = week?.focus?.label ?? 'Grammar focus';
    focusBtn.closest('button').setAttribute('aria-label', week?.focus?.label ? `Grammar focus: ${week.focus.label}` : 'Grammar focus');
    // One render: audio availability and lookups ride along with the week.
    reader.setWeek(week, units, highlights, { audio: playable(info), lookups });
    panel.close();
    settingsUI?.refreshAudio();
    settingsUI?.render(settings);   // the Grammar focus switch names this week's focus
  }

  // View toggle
  const viewBtns = [...document.querySelectorAll('.seg__btn[data-view]')];
  function setView(v) {
    reader.setView(v);
    viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    try { localStorage.setItem('l103.view', v); } catch { /* ignore */ }
  }
  viewBtns.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  // Display toggles → settings. The same map drives the toolbar buttons, the
  // letter keys and the Reading switches in the settings dialog.
  const toggles = {
    english: { get: (s = settings) => s.showEnglish === 'interleaved', set: (on) => ({ showEnglish: on ? 'interleaved' : 'hidden' }) },
    highlights: { get: (s = settings) => !!s.showHighlights, set: (on) => ({ showHighlights: on }) },
    underlines: { get: (s = settings) => !!s.showUnderlines, set: (on) => ({ showUnderlines: on }) },
    margin: { get: (s = settings) => s.showMargin !== false, set: (on) => ({ showMargin: on }) },
    audio: { get: (s = settings) => s.showAudio !== false, set: (on) => ({ showAudio: on }) },
    summaries: { get: (s = settings) => s.showSummaries !== false, set: (on) => ({ showSummaries: on }) },   // settings-only: no toolbar button
    glossEnglish: { get: (s = settings) => !!s.showGlossEnglish, set: (on) => ({ showGlossEnglish: on }) },   // settings-only: the English under every margin gloss
  };
  function applyDisplay() {
    paintRate();
    readerEl.dataset.english = settings.showEnglish;
    readerEl.dataset.highlights = settings.showHighlights ? 'on' : 'off';
    readerEl.dataset.underlines = settings.showUnderlines ? 'on' : 'off';
    readerEl.dataset.margin = settings.showMargin !== false ? 'on' : 'off';
    readerEl.dataset.summaries = toggles.summaries.get() ? 'on' : 'off';   // hides the Summary disclosures and sentence view's button
    readerEl.dataset.glossEn = toggles.glossEnglish.get() ? 'on' : 'off';   // every gloss's English shown, the per-gloss "en" chips hidden
    // Audio off: no play buttons, no cursor, no transport — playback stops (stop() clears the highlight and hides #transport).
    readerEl.dataset.audio = audioOn() ? 'on' : 'off';
    if (!audioOn() && audio && audio.status().mode !== 'idle') audio.stop();
    if (audioState) reader.setAudioAvailable(playable(audioState));
    paintListen();
    for (const [k, t] of Object.entries(toggles)) $(`[data-toggle="${k}"]`)?.setAttribute('aria-pressed', String(t.get()));
    applyPanelWidth(settings.panelWidth);
    reader.reflow();
  }

  /* ---------------------------------------------- side panel width */
  // The divider between the text and the panel: pointer drag or arrow keys.
  // The chosen width is clamped to [--panel-min, --panel-max] (tokens.css)
  // and stored in settings.panelWidth (px); null keeps the CSS default.
  const divider = $('#divider');
  const panelEl = $('#panel');
  const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // --panel-min / --panel-max are registered <length> properties, so their
  // computed values come back in px; the unit parse covers browsers without
  // @property, where the declared value ("18rem", "60vw") is returned as is.
  function cssPx(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = /^(-?\d*\.?\d+)(px|rem|em|vw|vh)?$/.exec(v);
    if (!m) return fallback;
    const n = parseFloat(m[1]);
    switch (m[2] || 'px') {
      case 'px': return n;
      case 'vw': return n * window.innerWidth / 100;
      case 'vh': return n * window.innerHeight / 100;
      default: return n * remPx();
    }
  }
  const panelBounds = () => ({
    min: Math.round(cssPx('--panel-min', 18 * remPx())),
    max: Math.round(cssPx('--panel-max', window.innerWidth * 0.6)),
  });
  function applyPanelWidth(px) {
    const { min, max } = panelBounds();
    const w = clampPanelWidth(px, min, max);
    if (w == null) layout.style.removeProperty('--panel-w');
    else layout.style.setProperty('--panel-w', `${w}px`);
    const now = w ?? (Math.round(panelEl.getBoundingClientRect().width) || min);
    divider.setAttribute('aria-valuemin', String(min));
    divider.setAttribute('aria-valuemax', String(max));
    divider.setAttribute('aria-valuenow', String(now));
    divider.setAttribute('aria-valuetext', `Panel ${now} pixels wide`);
  }
  let panelSaveTimer = 0;
  let drag = null;   // the pointer drag in progress on the divider, if any
  // While a drag or its debounced save is still in flight, the live width
  // beats whatever (older) panelWidth a store round-trip hands back.
  const panelBusy = () => !!drag || !!panelSaveTimer;
  function setPanelWidth(px, { persist = true } = {}) {
    const { min, max } = panelBounds();
    const w = clampPanelWidth(px, min, max);
    settings = { ...settings, panelWidth: w };
    applyPanelWidth(w);
    reader.reflow();
    if (!persist) return;
    clearTimeout(panelSaveTimer);
    panelSaveTimer = setTimeout(() => { panelSaveTimer = 0; saveSettings({ panelWidth: w }); }, 250);
  }
  if (divider) {
    divider.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, w: panelEl.getBoundingClientRect().width, prev: settings.panelWidth };
      try { divider.setPointerCapture(e.pointerId); } catch { /* no capturable pointer: moves still arrive while over the divider */ }
      divider.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      e.preventDefault();
    });
    divider.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      // Past the right edge the width goes to zero or below; that is "as narrow
      // as it gets", never the reset that clampPanelWidth() reads a null as.
      setPanelWidth(Math.max(panelBounds().min, drag.w + (drag.x - e.clientX)), { persist: false });
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      divider.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
      setPanelWidth(panelEl.getBoundingClientRect().width);
      if (live) live.textContent = divider.getAttribute('aria-valuetext');
    };
    divider.addEventListener('pointerup', endDrag);
    divider.addEventListener('pointercancel', endDrag);
    divider.addEventListener('lostpointercapture', endDrag);
    // Escape abandons a pointer drag and puts the width back where it started.
    const cancelDrag = () => {
      if (!drag) return;
      const { id, prev } = drag;
      drag = null;
      divider.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
      try { divider.releasePointerCapture(id); } catch { /* already released */ }
      setPanelWidth(prev, { persist: false });
      if (live) live.textContent = 'Resize cancelled.';
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drag) { e.preventDefault(); e.stopPropagation(); cancelDrag(); }
    }, true);
    // APG window-splitter keys: Right/Up widen the panel, Left/Down narrow it,
    // Home = narrowest, End = widest. Handled keys stop here so sentence view
    // never also treats them as navigation.
    divider.addEventListener('keydown', (e) => {
      const cur = panelEl.getBoundingClientRect().width;
      const { min, max } = panelBounds();
      const step = e.shiftKey ? 64 : 16;
      const next = { ArrowRight: cur + step, ArrowUp: cur + step, ArrowLeft: cur - step, ArrowDown: cur - step, Home: min, End: max }[e.key];
      if (next == null) return;
      e.preventDefault();
      e.stopPropagation();
      setPanelWidth(next);
      if (live) live.textContent = divider.getAttribute('aria-valuetext');
    });
    divider.addEventListener('dblclick', () => { setPanelWidth(null); if (live) live.textContent = `Panel width reset. ${divider.getAttribute('aria-valuetext')}`; });
    window.addEventListener('resize', () => applyPanelWidth(settings.panelWidth));
  }
  async function saveSettings(patch) {
    const saved = (await store.setSettings(patch)) ?? patch;
    const livePanel = settings.panelWidth;
    settings = { ...settings, ...saved };
    if (panelBusy()) settings.panelWidth = livePanel;
    mirror(settings);
    applyToDocument(settings);
    applyDisplay();
    settingsUI?.render(settings);   // the dialog mirrors every control that lives elsewhere (toolbar toggles, transport speed)
    if ('audioRate' in patch && live) live.textContent = fmtRate(settings.audioRate);   // just the new rate; the chip's aria-pressed says the rest
    if ('showEnglish' in patch) dismissHint();
    return settings;
  }
  for (const [k, t] of Object.entries(toggles)) {
    $(`[data-toggle="${k}"]`)?.addEventListener('click', () => saveSettings(t.set(!t.get())));
  }

  /* ------------------------------------------ first-run hint (translation) */
  // Shown once, under the Translation toggle, while the translation is hidden;
  // dismissed by "Got it" or by switching the translation on. Never again after.
  const hint = $('#hint-translation');
  const hintFor = $('[data-toggle="english"]');
  function placeHint() {
    if (!hint || hint.hidden) return;
    // The hint is a row of the header (it pushes the text down rather than
    // covering the part heading): its left edge sits under the toggle, kept
    // inside the header's content box, and the caret points at the toggle's centre.
    const r = hintFor.getBoundingClientRect();
    const box = bar.querySelector('.bar__main').getBoundingClientRect();
    const w = hint.offsetWidth;
    const left = Math.max(0, Math.min(r.left - box.left, box.width - w));
    hint.style.marginLeft = `${Math.round(left)}px`;
    const caret = Math.max(14, Math.min(w - 14, r.left + r.width / 2 - (box.left + left)));
    hint.style.setProperty('--hint-caret', `${Math.round(caret)}px`);
  }
  function dismissHint() {
    if (!hint || hint.hidden) return;
    hint.hidden = true;
    window.removeEventListener('resize', placeHint);
  }
  function maybeShowHint() {
    if (!hint || toggles.english.get()) return;
    let seen = '1';
    try { seen = localStorage.getItem(LS_HINT_TRANSLATION) ?? ''; } catch { /* no storage: the hint is skipped rather than shown every time */ }
    if (seen) return;
    try { localStorage.setItem(LS_HINT_TRANSLATION, '1'); } catch { return; }
    hint.hidden = false;
    placeHint();
    window.addEventListener('resize', placeHint);
    if (live) live.textContent = hint.querySelector('.hint__text').textContent;
  }
  hint?.querySelector('[data-hint-dismiss]').addEventListener('click', () => { dismissHint(); hintFor.focus(); });

  // Settings dialog (+ the Audio section for the current week)
  const settingsDialog = $('#settings');
  const settingsBtn = $('#settings-btn');
  settingsUI = initSettings(settingsDialog, {
    get: () => settings,
    set: saveSettings,
    onChange: (s, patch) => { if ('compact' in patch) { panel.refresh(); if (reader.getView() === 'sentence') reader.rerender(); } },
    toggles,
    focusLabel: () => weeks.find((w) => w.n === weekN)?.focus?.label ?? outline.find((w) => w.n === weekN)?.focus?.label ?? '',
    audio: audio ? {
      weekLabel: () => `week ${weekN}`,
      info: () => audioInfo(),
      async upload(file) {
        const n = weekN;
        await store.uploadAudio(n, file);
        audio.invalidate?.(n);
        await refreshAudioAvailability();
      },
      align: () => {
        const n = weekN;
        audio.startAlignment(n)
          .then(async (rows) => { if (rows) { audio.invalidate?.(n); await refreshAudioAvailability(); notify(`Week ${n} aligned: ${rows.length} of ${units.length} sentences.`); } })
          .catch((e) => notify(e?.message || 'Alignment failed.'))
          .finally(() => settingsBtn.focus());
      },
      // "Play chapter" from the menu turns the toolbar Audio toggle back on first: playback without its cursor would be a puzzle.
      play: async () => { if (!audioOn()) await saveSettings({ showAudio: true }); return audio.playAll(reader.currentUnit()?.id ?? null); },
      pause: () => audio.pause(),
      resume: () => audio.resume(),
      stop: () => audio.stop(),
      onState: (cb) => audio.onState?.(cb),
    } : null,
    onSignOut: async () => { try { await auth.signOut(); } finally { if (fixture) location.reload(); } },
  });
  settingsBtn.addEventListener('click', () => settingsUI.open());

  // Sync from another device / tab
  onRemoteChange = async (kind) => {
    if (kind === 'lookups') { lookups = await store.getLookups(); reader.setLookups(lookups); panel.refresh(); }
    if (kind === 'settings') {
      const livePanel = settings.panelWidth;
      settings = await store.getSettings();
      if (panelBusy()) settings = { ...settings, panelWidth: livePanel };
      mirror(settings); applyToDocument(settings); applyDisplay(); settingsUI.render(settings);
    }
    if (kind === 'alignments') { audio?.invalidate?.(weekN); refreshAudioAvailability(); }
  };
  // Anything that arrived during boot (settings/lookups are re-read below via loadWeek + the synced read above).
  if (remote.lookups) onRemoteChange('lookups');

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === 'Escape') { if (panel.isOpen()) { e.preventDefault(); panel.escape(); } return; }   // stack: back / collapse the open row / close
    if ($('#popup').open || settingsDialog.open || weeksDialog.open) return;
    if (audio?.status?.().mode === 'align') return;   // the alignment overlay owns the keyboard (it also stops propagation)
    if (reader.getView() === 'sentence') {
      if (e.key === 'j' || e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); reader.next(); return; }
      if (e.key === 'k' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); reader.prev(); return; }
    }
    if (e.key === 'e') saveSettings(toggles.english.set(!toggles.english.get()));
    if (e.key === 'h') saveSettings(toggles.highlights.set(!toggles.highlights.get()));
    if (e.key === 'm') saveSettings(toggles.margin.set(!toggles.margin.get()));
    if (e.key === 'a') saveSettings(toggles.audio.set(!toggles.audio.get()));
  });

  applyDisplay();
  await loadWeek(weekN);
  setView(localStorage.getItem('l103.view') === 'sentence' ? 'sentence' : 'passage');
  document.documentElement.dataset.ready = '1';
  maybeShowHint();
  if (!fixture) registerServiceWorker?.()?.catch?.((e) => console.warn('[sw] registration failed', e));
}

boot().catch((err) => {
  console.error(err);
  const el = $('#boot-error');
  el.hidden = false;
  el.querySelector('code').textContent = err?.message ?? String(err);
});
