// Boot: pick a store, load the dictionary modules, wire header + reader + panel + audio.
import { createReader, firstUnread, queueReads, playbackRead, weekHasLines } from './reader.js';
import { createWordPanel } from './wordpanel.js';
import { initSettings, applyToDocument, clampPanelWidth, rateMenu, fmtRate, listenStatusText, synthHintText, progressText, studyLog, timeLeftText, activeSlice } from './settings.js';
import { clampRate, normaliseLastPosition, progressByWeek, localDay, readSettled } from './sync.js';

const $ = (sel, root = document) => root.querySelector(sel);
const LS_WEEK = 'l103.week';
const LS_HINT_TRANSLATION = 'l103.hint.translation';   // "1" once the first-run Translation hint has been shown
const NOTICE_MS = 5000;
const READ_FLUSH_MS = 500;       // reader `read` events are batched this long before one store.markRead()
const POSITION_SAVE_MS = 1000;   // settings.lastPosition is written this long after the current sentence last changed
const PLAYED_MIN_MS = 1500;      // playback counts a sentence as read only after this much actual playing (or 80% of a shorter one) — see playbackRead()
const PICTURE_REFRESH_MS = 5 * 60 * 1000;   // how often a long session asks the store for the week's picture URLs (re-signed past 50 min, swapped in place)
const ACTIVE_TICK_MS = 15 * 1000;     // the study-log ticker (CONTRACT.md "Study log"): each tick banks its length while the learner is active
const ACTIVE_IDLE_MS = 60 * 1000;     // …"active" = pointer / key / scroll / touch within this long, or audio playing
const ACTIVE_FLUSH_MS = 60 * 1000;    // banked time is written to the store this often (and at once when the tab hides)

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

  const remote = { lookups: false, settings: false, alignments: false, weeks: false, progress: false, study: false };
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
  // Reading progress (CONTRACT.md): `progressRows` unit id → the row (read_at, reads, last_read_at — the reader's
  // timers, the read batching and the study log's review figures), `progress` unit id → read_at (counts, Continue,
  // the weeks menu: first reads only). Kept apart from the lookups; never reset with them.
  const hasProgress = typeof store.getProgress === 'function';
  let progressRows = new Map();
  let progress = new Map();
  async function loadProgress() {
    progressRows = await (store.getProgressRows?.() ?? store.getProgress());
    progress = new Map([...progressRows].map(([id, r]) => [id, r && typeof r === 'object' ? r.read_at : r]));
  }
  if (hasProgress) await loadProgress();
  // Study log (CONTRACT.md): active ms per local day. Feeds the time-left estimates and Settings → Progress.
  const hasStudy = hasProgress && typeof store.getStudyDays === 'function';
  let studyDays = hasStudy ? await store.getStudyDays() : new Map();
  let stats = null;   // studyLog() over `progress` + `studyDays`, recomputed by paintProgress()

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
  const reader = createReader({ root: readerEl, tokenize: tok.tokenize, describeForm, live, listen: $('#listen'), plain, progressBar: $('#progress'), readSettled });
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
    // …and its word rows from the words already looked up in that sentence.
    getTokens: (id) => reader.wordTokens(id),
    getLookups: () => lookups,
    getHighlights: (id) => reader.highlightsOf(id),
  });
  window.latinReader = { reader, panel, store, audio };   // documented hooks (see README-ui.md)

  reader.on('word', (w) => panel.showWord(w));
  reader.on('note', (n) => panel.showNote(n));
  // Sentence view's "Section summary" button: the part's summary in the panel / popup.
  reader.on('summary', ({ part, unitId, el, body }) => panel.showSummary({ part: part.part, body, unitId, el }));
  // Sentence view moved on (Next / Previous, j / k, chapter playback): an open side-panel stack follows the sentence.
  // Sentence view always shows the current sentence's stack; passage view only follows once the panel is open.
  reader.on('navigate', ({ unit }) => { if (unit) panel.showSentence(unit.id, { open: reader.getView() === 'sentence' }); });

  /* ------------------------------------------------------ header */
  const weeks = await store.getWeeks();
  // Public course outline (all 14 weeks) — merged with what the library holds.
  let course = [];
  try { course = await (await fetch('./data/course.json')).json(); } catch { /* fall back to library weeks only */ }
  const outline = course.length ? course : weeks;
  const weekBtn = $('#week-btn');
  const weeksDialog = $('#weeks');
  const weeksList = $('#weeks-list');
  // Sentences per week, for the menu's "42 of 93 sentences": the row's
  // unit_count when the library carries it, else the cached units' length
  // (read once per week, on the first open of the menu).
  const weekTotals = new Map();
  async function ensureWeekTotals() {
    await Promise.all(weeks.map(async (w) => {
      if (weekTotals.has(w.n)) return;
      if (Number.isFinite(Number(w.unit_count)) && w.unit_count > 0) { weekTotals.set(w.n, Number(w.unit_count)); return; }
      try { weekTotals.set(w.n, (await store.getUnits(w.n)).length); } catch { /* the row stays without a count */ }
    }));
  }
  function renderWeeksMenu(currentN) {
    const byWeek = progressByWeek(progress);
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
      // A thin bar and "42 of 93 sentences" / "not started" / "finished ✓" for every week in the library.
      const total = weekTotals.get(c.n) ?? 0;
      if (lib && hasProgress && total > 0) {
        const read = Math.min(total, byWeek.get(c.n) ?? 0);
        const prog = document.createElement('span'); prog.className = 'weeks__progress';
        prog.dataset.state = read === 0 ? 'none' : read >= total ? 'done' : 'part';
        const bar = document.createElement('span'); bar.className = 'weeks__bar'; bar.setAttribute('aria-hidden', 'true');
        const fill = document.createElement('span'); fill.className = 'weeks__bar-fill'; fill.style.width = `${Math.round((read / total) * 100)}%`;
        bar.append(fill);
        const count = document.createElement('span'); count.className = 'weeks__count'; count.textContent = progressText(read, total);
        prog.append(bar, count);
        // "· about 2 h left" at the current pace (timeLeftText; "finished ✓" already says the rest).
        const left = timeLeftFor(read, total);
        if (left) { const l = document.createElement('span'); l.className = 'weeks__left'; l.textContent = `· ${left}`; prog.append(l); }
        b.append(prog);
      }
      li.append(b);
      return li;
    }));
  }
  function setWeekButton(n) {
    const c = outline.find((w) => w.n === n) || weeks.find((w) => w.n === n);
    weekBtn.querySelector('.week__num').textContent = `Week ${n}`;
    weekBtn.querySelector('.week__title').textContent = c?.title ?? '';
  }
  weekBtn.addEventListener('click', async () => {
    await ensureWeekTotals();
    renderWeeksMenu(weekN);
    if (!weeksDialog.open) weeksDialog.showModal();
    weeksList.querySelector('[aria-current="true"]')?.focus();
  });
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
  // The week to open: the last position (synced through settings) beats the device's own last week.
  const lastPos = normaliseLastPosition(settings.lastPosition);
  let weekN = Number(localStorage.getItem(LS_WEEK)) || weeks[0]?.n || 1;
  if (lastPos && weeks.some((w) => w.n === lastPos.week_n)) weekN = lastPos.week_n;
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
      rows,   // the alignment itself (start_ms order): trackPlayback() reads where each sentence ends and which comes next
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
      trackPlayback(st);
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

  /* ------------------------------------------- reading progress */
  // What counts as read (CONTRACT.md "Reading progress"): the reader says
  // when a sentence has been shown / in view long enough or moved past
  // (`read` events); playback is judged here from audio.onState — a sentence
  // chapter playback moved past to the next one, or one whose own playback
  // ran to its end (playbackRead() in reader.js; a Stop partway or a jump
  // never counts, paused time does not count). Ids are batched (queueReads,
  // READ_FLUSH_MS) into one store.markRead(); nothing is ever un-marked
  // automatically. A sentence read ≥ 30 min ago (readSettled) is queued
  // again — the store counts that pass as a review (CONTRACT.md "Reviews").
  const readQueue = new Set();
  let readTimer = 0;
  function noteRead(ids) {
    if (!hasProgress || !queueReads(readQueue, ids, progressRows, readSettled).length) return;
    if (!readTimer) readTimer = setTimeout(flushReads, READ_FLUSH_MS);
  }
  // A reset drops whatever was noticed but not yet saved, so nothing marked a moment before comes back after it.
  function dropReads() {
    clearTimeout(readTimer);
    readTimer = 0;
    readQueue.clear();
  }
  async function flushReads() {
    clearTimeout(readTimer);
    readTimer = 0;
    const ids = [...readQueue];
    readQueue.clear();
    if (!ids.length) return;
    try { await store.markRead(ids); } catch (e) { console.warn('[progress] not saved', e?.message || e); }
    await loadProgress();
    paintProgress();
  }
  reader.on('read', ({ unitIds }) => noteRead(unitIds));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushReads(); });   // a tab closed mid-batch keeps its reads
  // The sentence under the cursor and how long it has actually played
  // (`ms`, paused stretches left out: `since` is only set while playing).
  let played = { id: null, playing: false, since: 0, ms: 0 };
  function trackPlayback(st) {
    const now = Date.now();
    const cur = st.mode === 'idle' || st.mode === 'align' ? null : st.currentUnit;
    if (cur === played.id) {   // the same sentence: only the clock moves (a pause stops it)
      if (st.playing && !played.playing) played.since = now;
      else if (!st.playing && played.playing) played.ms += now - played.since;
      played.playing = !!st.playing;
      return;
    }
    const prev = played;
    if (prev.playing) prev.ms += now - prev.since;
    played = { id: cur, playing: !!st.playing, since: now, ms: 0 };
    if (!prev.id) return;
    const read = playbackRead({
      prevId: prev.id, nextId: cur, playedMs: prev.ms, atMs: st.currentTimeMs, error: st.error,
      rows: audioState?.rows ?? [], durationMs: st.durationMs, minMs: PLAYED_MIN_MS,
    });
    if (read) noteRead([prev.id]);
  }

  // The progress line ("42 of 93 read · Continue →") that reader.js keeps
  // under the first part title / the sentence meta line, the weeks menu's
  // rows and Settings → Progress all read the same map; paintProgress() is
  // the one repaint after a batch, a reset or a change from another device.
  const progressEl = $('#progress');
  const progressTextEl = $('[data-progress-text]');
  const progressLeft = $('[data-progress-left]');
  const progressLeftText = $('[data-progress-left-text]');
  const progressContinue = $('[data-progress-continue]');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const readInWeek = () => units.reduce((n, u) => n + (progress.has(u.id) ? 1 : 0), 0);
  // "about 45 min left" for a week: unread ÷ pace (CONTRACT.md "Estimated time left"); '' when finished or without the study log.
  const timeLeftFor = (read, total) => (hasStudy && total > 0 && read < total ? timeLeftText(total - read, (stats ??= studyLog({ progress: progressRows, studyDays })).pace) : '');
  function paintProgress() {
    reader.setProgress?.(progressRows);
    stats = hasStudy ? studyLog({ progress: progressRows, studyDays }) : null;
    if (!progressEl) return;
    progressEl.hidden = !hasProgress || !units.length;
    if (progressEl.hidden) return;
    const read = readInWeek();
    progressEl.dataset.state = read === 0 ? 'none' : read >= units.length ? 'done' : 'part';
    progressTextEl.textContent = cap(progressText(read, units.length, { noun: 'read' }));
    const left = timeLeftFor(read, units.length);
    if (progressLeft) { progressLeft.hidden = !left; if (progressLeftText) progressLeftText.textContent = left; }
    progressContinue.hidden = read >= units.length;
    if (weeksDialog.open) renderWeeksMenu(weekN);
    settingsUI?.refreshProgress?.();
  }

  /* ------------------------------------------------- active time (study log) */
  // A 15 s ticker banks its length while the tab is visible and the learner
  // was active within the last minute (pointer / keys / scroll / touch) or
  // audio is playing (activeSlice() in settings.js, pure). The bank is
  // written every minute — store.addActiveTime(day, ms), day = the local
  // date — and at once when the tab hides or the page is left; a day change
  // mid-session flushes to the day that is ending first.
  let lastActivity = 0;                 // nothing counts until the learner actually does something
  let lastTick = Date.now();
  let lastFlush = Date.now();
  let banked = { day: localDay(), ms: 0 };
  const bump = () => { lastActivity = Date.now(); };
  if (hasStudy) {
    // The learner's own input only — never `scroll`: the boot resume, Continue and every re-placing scroll programmatically, and an untouched page must bank nothing.
    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, bump, { passive: true, capture: true });
    setInterval(tickActive, ACTIVE_TICK_MS);
    // The tab is hidden by the time the event fires; the stretch since the
    // last tick was on screen, so the closing tick counts it as visible.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { tickActive({ closing: true }); flushActive(); }
      else { lastTick = Date.now(); }   // time away is never banked
    });
    window.addEventListener('pagehide', () => { tickActive({ closing: true }); flushActive(); });
  }
  function tickActive({ closing = false } = {}) {
    const now = Date.now();
    const dt = now - lastTick;
    lastTick = now;
    const day = localDay(new Date(now));
    if (day !== banked.day) { flushActive(); banked = { day, ms: 0 }; }
    banked.ms += activeSlice({ visible: closing || document.visibilityState === 'visible', now, lastActivity, playing: !!audio?.status?.().playing, dt, idleMs: ACTIVE_IDLE_MS, tickMs: ACTIVE_TICK_MS });
    if (now - lastFlush >= ACTIVE_FLUSH_MS) flushActive();
  }
  // The bank is emptied for the ticks that land during the await and put
  // back if the store fails (quota, private mode): the minutes wait for the
  // next flush instead of vanishing. (A day boundary crossed during a failed
  // await leaves them under the new day: a slice of seconds, at most.)
  async function flushActive() {
    lastFlush = Date.now();
    const { day, ms } = banked;
    if (!hasStudy || ms <= 0) return;
    banked = { day, ms: 0 };
    try { await store.addActiveTime(day, Math.round(ms)); } catch (e) {
      console.warn('[study] not saved', e?.message || e);
      banked.ms += ms;
      return;
    }
    studyDays = await store.getStudyDays();
    paintProgress();
  }
  // Continue: the first sentence not yet read, else the last position, else the first sentence.
  progressContinue?.addEventListener('click', () => {
    const target = firstUnread(units, progress)
      ?? units.find((u) => u.id === settings.lastPosition?.unit_id)
      ?? units[0];
    if (target) reader.goToUnit(target.id);
  });

  /* ---------------------------------------------- last position */
  // settings.lastPosition = { week_n, unit_id, view, at }: written (debounced)
  // whenever the reader's current sentence changes in either view — through
  // store.setLastPosition() (its own patch: no shell repaint, and the settings
  // row's updated_at is not bumped), only when the place really changed
  // (positionKey starts as the loaded position), and only once boot is over
  // (positionArmed): the boot render and the resume never write, so a saved
  // place the library no longer has is kept for the device that has it.
  let positionTimer = 0;
  let positionArmed = false;
  const posKey = (lp) => (lp ? `${lp.week_n}|${lp.unit_id}|${lp.view}` : null);
  let positionKey = posKey(lastPos);   // `${week}|${unit}|${view}` last written / loaded, so the same place is not written twice
  reader.on('position', ({ unit, view }) => {
    if (!positionArmed || !unit || unitsWeek !== weekN) return;
    const lp = { week_n: weekN, unit_id: unit.id, view, at: new Date().toISOString() };
    clearTimeout(positionTimer);
    if (posKey(lp) === positionKey) { positionTimer = 0; return; }
    positionTimer = setTimeout(() => { positionTimer = 0; savePosition(lp); }, POSITION_SAVE_MS);
  });
  async function savePosition(lp) {
    if (posKey(lp) === positionKey) return;
    positionKey = posKey(lp);
    try {
      const saved = await (store.setLastPosition ? store.setLastPosition(lp) : store.setSettings({ lastPosition: lp }));
      settings = { ...settings, lastPosition: saved?.lastPosition ?? lp };
      mirror(settings);
    } catch (e) {
      console.warn('[position] not saved', e?.message || e);
    }
  }

  /* ---------------------------------------------------- pictures */
  // The textbook's illustrations (CONTRACT.md "Pictures"): loaded with the
  // week while settings.showPictures is on — the store signs their URLs then,
  // in batches — and re-asked of the store when the setting comes back on, so
  // a signature that expired meanwhile is fresh. Off → nothing is fetched.
  const picturesOn = () => settings.showPictures !== false;
  async function loadPictures(n) {
    if (!picturesOn() || typeof store.getPictures !== 'function') return [];
    try { return (await store.getPictures(n)) ?? []; }
    catch (e) { console.warn('[pictures] not loaded for week', n, e?.message || e); return []; }
  }
  let picturesShown = picturesOn();   // what the current render was made with
  let pictureRows = [];               // what the reader was last given, to see whether a refresh changed any URL
  const pictureUrls = (rows) => rows.map((p) => `${p.id}=${p.url ?? ''}`).join('\n');
  async function refreshPictures() {
    const n = weekN;
    const rows = await loadPictures(n);
    if (n !== weekN || n !== unitsWeek) return;
    if (pictureUrls(rows) === pictureUrls(pictureRows)) return;   // nothing re-signed: the page is left alone
    pictureRows = rows;
    reader.setPictures(rows);   // the same pictures with new URLs are swapped into the <img>s in place
  }
  // Signed URLs last an hour: a long session asks the store again every few
  // minutes and when the tab comes back, so a re-render after the hour never
  // refetches an expired URL (the store re-signs only rows past 50 min).
  setInterval(() => { if (document.visibilityState === 'visible' && picturesOn() && unitsWeek != null) refreshPictures(); }, PICTURE_REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && picturesOn() && unitsWeek != null) refreshPictures(); });

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
    const [us, highlights, info, pictures] = await Promise.all([store.getUnits(n), store.getHighlights(n), audioInfo(n), loadPictures(n)]);
    if (n !== weekN) return;   // the user moved on while this loaded
    units = us;
    unitsWeek = n;
    weekTotals.set(n, us.length);
    audioState = info;
    pictureRows = pictures;
    document.title = `Week ${n} · ${week?.title ?? ''} — Latin 103`;
    const focusBtn = $('[data-toggle="highlights"] .toggle__label');
    focusBtn.textContent = week?.focus?.label ?? 'Grammar focus';
    focusBtn.closest('button').setAttribute('aria-label', week?.focus?.label ? `Grammar focus: ${week.focus.label}` : 'Grammar focus');
    // One render: audio availability, lookups, pictures and the reading progress ride along with the week.
    reader.setWeek(week, units, highlights, { audio: playable(info), lookups, pictures, progress: progressRows });
    panel.close({ user: false });   // a week change, not the learner's choice: sentence view may open the stack again
    paintProgress();
    settingsUI?.refreshAudio();
    settingsUI?.render(settings);   // the Grammar focus switch names this week's focus
  }

  // View toggle
  const viewBtns = [...document.querySelectorAll('.seg__btn[data-view]')];
  function setView(v) {
    reader.setView(v);
    viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    try { localStorage.setItem('l103.view', v); } catch { /* ignore */ }
    // Entering sentence view: the panel shows that sentence's stack straight away
    // (unless the learner closed it, wordpanel.js). Leaving it: a stack with
    // nothing in it closes again, so a tablet gets its margin gutter back.
    if (v === 'sentence') { const cur = reader.getCurrentUnit?.(); if (cur) panel.showSentence(cur.id, { open: true }); }
    else panel.closeIfEmpty?.();
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
    pictures: { get: (s = settings) => s.showPictures !== false, set: (on) => ({ showPictures: on }) },   // settings-only: the textbook's illustrations
    bookLines: { get: (s = settings) => s.lineMode === 'book', set: (on) => ({ lineMode: on ? 'book' : 'flow' }) },   // settings-only: passage view laid out as printed (CONTRACT.md "Book lines")
  };
  /**
   * `settle`: the learner's own Book lines switch — the reader puts the current
   * sentence back on its line after the re-render (never for a change from
   * another device). Every toggle reflows the text above the viewport, so the
   * whole pass runs under reader.keepInView(): the sentence in view stays put.
   */
  function applyDisplay({ settle = false, first = null } = {}) {
    reader.keepInView(() => { first?.(); applyDisplayNow({ settle }); });   // `first`: applyToDocument — the type / notes size and theme change the layout too, so it runs under the same hold
  }
  function applyDisplayNow({ settle }) {
    paintRate();

    readerEl.dataset.english = settings.showEnglish;
    readerEl.dataset.highlights = settings.showHighlights ? 'on' : 'off';
    readerEl.dataset.underlines = settings.showUnderlines ? 'on' : 'off';
    readerEl.dataset.margin = settings.showMargin !== false ? 'on' : 'off';
    readerEl.dataset.summaries = toggles.summaries.get() ? 'on' : 'off';   // hides the Summary disclosures and sentence view's button
    readerEl.dataset.glossEn = toggles.glossEnglish.get() ? 'on' : 'off';   // every gloss's English shown, the per-gloss "en" chips hidden
    readerEl.dataset.pictures = picturesOn() ? 'on' : 'off';
    // Book lines: the reader re-renders passage view on a change (a no-op before the first week and when nothing changed).
    readerEl.dataset.lineMode = toggles.bookLines.get() ? 'book' : 'flow';
    reader.setLineMode(readerEl.dataset.lineMode, { settle });
    if (picturesOn() !== picturesShown && unitsWeek != null) {   // switched on: fetch (re-sign) and render; off: the CSS hides them and the rows are dropped
      picturesShown = picturesOn();
      if (picturesShown) refreshPictures(); else { pictureRows = []; reader.setPictures([]); }
    }
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
    applyDisplay({ settle: 'lineMode' in patch, first: () => applyToDocument(settings) });
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
    applyToDocument: (s) => reader.keepInView(() => applyToDocument(s)),   // the dialog's live preview of a size step reflows the text: under the same hold as the save
    onChange: (s, patch) => { if ('compact' in patch) { panel.refresh(); if (reader.getView() === 'sentence') reader.rerender(); } },
    toggles,
    focusLabel: () => weeks.find((w) => w.n === weekN)?.focus?.label ?? outline.find((w) => w.n === weekN)?.focus?.label ?? '',
    hasLines: () => unitsWeek == null || weekHasLines(units),   // the Book lines switch explains itself while the week has no printed-line data (unknown until a week is in: no hint yet)
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
    progress: hasProgress ? {
      weekLabel: () => `week ${weekN}`,
      info: () => ({ read: readInWeek(), total: units.length, all: progress.size }),
      // Each returns the line the dialog shows (it is modal: a #notice behind its backdrop would go unseen).
      async resetWeek() {
        const n = weekN;
        dropReads();
        await store.resetProgress(n);
        await loadProgress();
        paintProgress();
        return `Week ${n}: reading progress reset. Looked-up words are untouched.`;
      },
      async resetAll() {
        dropReads();
        await store.resetProgress(null);
        await loadProgress();
        paintProgress();
        return 'All reading progress reset. Looked-up words are untouched.';
      },
      // The study log (CONTRACT.md): the figures the dialog draws, and its own clear — reading progress stays.
      study: hasStudy ? {
        log: () => stats ?? (stats = studyLog({ progress: progressRows, studyDays })),
        async clear() {
          banked = { day: localDay(), ms: 0 };
          await store.clearStudyLog();
          studyDays = await store.getStudyDays();
          paintProgress();
          return 'Study log cleared. Reading progress and looked-up words are untouched.';
        },
      } : null,
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
      positionKey = posKey(normaliseLastPosition(settings.lastPosition));   // another device's position: this one writes again on its next move
      mirror(settings); applyDisplay({ first: () => applyToDocument(settings) }); settingsUI.render(settings);
    }
    if (kind === 'alignments') { audio?.invalidate?.(weekN); refreshAudioAvailability(); }
    if (kind === 'weeks' && unitsWeek != null && unitsWeek === weekN && picturesOn()) refreshPictures();   // pictures the sync's once-check fetched for the open week show now, not on the next refresh

    if (kind === 'progress' && hasProgress) { await loadProgress(); paintProgress(); }
    if (kind === 'study' && hasStudy) { studyDays = await store.getStudyDays(); paintProgress(); }
  };
  // Anything that arrived during boot (settings/lookups are re-read below via loadWeek + the synced read above).
  if (remote.lookups) onRemoteChange('lookups');
  if (remote.progress) onRemoteChange('progress');
  if (remote.study) onRemoteChange('study');

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    // A modal dialog (Settings, the weeks menu) owns Escape: its own cancel closes it, the panel stack behind it is left alone.
    if (settingsDialog.open || weeksDialog.open) return;
    if (e.key === 'Escape') { if (panel.isOpen()) { e.preventDefault(); panel.escape(); } return; }   // stack: back / collapse the open row / close
    if ($('#popup').open) return;
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
  // The view is the device's own (l103.view); the sentence is the synced last position, in either view.
  setView(localStorage.getItem('l103.view') === 'sentence' ? 'sentence' : 'passage');
  if (lastPos && lastPos.week_n === weekN && units.length) reader.goToUnit(lastPos.unit_id, { quiet: true });
  // From here on the reader's moves are the learner's: positions are written again (never the boot render's or a failed resume's).
  clearTimeout(positionTimer);
  positionTimer = 0;
  positionArmed = true;
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
