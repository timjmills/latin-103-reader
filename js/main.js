// Boot: pick a store, load the dictionary modules, wire header + reader + panel + audio.
import { createReader } from './reader.js';
import { createWordPanel } from './wordpanel.js';
import { initSettings, applyToDocument } from './settings.js';

const $ = (sel, root = document) => root.querySelector(sel);
const LS_WEEK = 'l103.week';
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

  const reader = createReader({ root: readerEl, tokenize: tok.tokenize, describeForm, live });
  const panel = createWordPanel({
    dialog: $('#popup'), aside: $('#panel'), layout,
    lookup: dict.lookup, describe: dict.describe, paradigm: par.paradigm, store,
    getSettings: () => settings,
    getLookupRecord: (form) => lookups.get(form),
    entryIndex: { get: (form) => chosenEntry.get(form), set: (form, i) => { chosenEntry.set(form, i); if (reader.getView() === 'sentence') reader.rerender(); } },
    onLookupsChanged: async () => { lookups = await store.getLookups(); reader.setLookups(lookups); },
    live,
  });
  window.latinReader = { reader, panel, store, audio };   // documented hooks (see README-ui.md)

  reader.on('word', (w) => panel.showWord(w));
  reader.on('note', (n) => panel.showNote(n));

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
  let weekN = Number(localStorage.getItem(LS_WEEK)) || weeks[0]?.n || 1;
  if (!weeks.some((w) => w.n === weekN)) weekN = weeks[0]?.n ?? 1;
  let units = [];
  let settingsUI = null;

  /* ------------------------------------------------------- audio */
  // Per-unit play buttons need a recording AND an alignment (playUnit rejects otherwise).
  async function audioInfo(n = weekN) {
    const [url, rows, us] = await Promise.all([
      Promise.resolve(store.getAudioUrl(n)).catch(() => null),
      Promise.resolve(store.getAlignment(n)).catch(() => []),
      n === weekN && units.length ? units : store.getUnits(n),
    ]);
    return { hasAudio: !!url, alignedCount: rows.length, total: us.length, alignedIds: new Set(rows.map((r) => r.unit_id)) };
  }
  // Which units get a play button: only aligned ones, only when there is a recording.
  const playable = (info) => (audio && info.hasAudio && info.alignedCount > 0 ? info.alignedIds : false);

  async function refreshAudioAvailability() {
    const n = weekN;
    const info = await audioInfo(n);
    if (n === weekN) reader.setAudioAvailable(playable(info));
    settingsUI?.refreshAudio();
  }

  const transport = $('#transport');
  const transportPos = $('[data-transport-pos]');
  const transportPause = $('[data-transport="pause"]');
  function paintTransport(st) {
    const active = st.mode === 'all';
    if (active) {
      const i = units.findIndex((u) => u.id === st.currentUnit);
      transportPos.textContent = i >= 0 ? `sentence ${i + 1} of ${units.length}` : '';
      transportPause.textContent = st.playing ? 'Pause' : 'Resume';
    }
    if (transport.hidden !== !active) {
      transport.hidden = !active;
      if (active && live) live.textContent = 'Playing the chapter. Pause and Stop are at the bottom of the page.';
    }
  }
  if (audio) {
    audio.attach({ setPlayingUnit: (id) => reader.setPlayingUnit(id) }, store);
    let lastError = null;
    audio.onState?.((st) => {
      paintTransport(st);
      if (st.error !== lastError) { lastError = st.error; if (st.error) notify(st.error); }
    });
    transportPause.addEventListener('click', () => { if (audio.status().playing) audio.pause(); else audio.resume(); });
    $('[data-transport="stop"]').addEventListener('click', () => audio.stop());
  }
  reader.on('play', ({ unitId, weekN: n }) => {
    document.dispatchEvent(new CustomEvent('latin-reader:play-unit', { detail: { unitId, weekN: n } }));
    if (!audio) { notify('Audio playback is not available.'); return; }
    audio.playUnit(unitId).catch((e) => notify(e?.message || 'Could not play this sentence.'));
  });

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
    document.title = `Week ${n} · ${week?.title ?? ''} — Latin 103`;
    const focusBtn = $('[data-toggle="highlights"] .toggle__label');
    focusBtn.textContent = week?.focus?.label ?? 'Grammar focus';
    focusBtn.closest('button').setAttribute('aria-label', week?.focus?.label ? `Grammar focus: ${week.focus.label}` : 'Grammar focus');
    // One render: audio availability and lookups ride along with the week.
    reader.setWeek(week, units, highlights, { audio: playable(info), lookups });
    panel.close();
    settingsUI?.refreshAudio();
  }

  // View toggle
  const viewBtns = [...document.querySelectorAll('.seg__btn[data-view]')];
  function setView(v) {
    reader.setView(v);
    viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    try { localStorage.setItem('l103.view', v); } catch { /* ignore */ }
  }
  viewBtns.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  // Display toggles → settings
  const toggles = {
    english: { get: () => settings.showEnglish === 'interleaved', set: (on) => ({ showEnglish: on ? 'interleaved' : 'hidden' }) },
    highlights: { get: () => !!settings.showHighlights, set: (on) => ({ showHighlights: on }) },
    underlines: { get: () => !!settings.showUnderlines, set: (on) => ({ showUnderlines: on }) },
  };
  function applyDisplay() {
    readerEl.dataset.english = settings.showEnglish;
    readerEl.dataset.highlights = settings.showHighlights ? 'on' : 'off';
    readerEl.dataset.underlines = settings.showUnderlines ? 'on' : 'off';
    for (const [k, t] of Object.entries(toggles)) $(`[data-toggle="${k}"]`)?.setAttribute('aria-pressed', String(t.get()));
  }
  async function saveSettings(patch) {
    settings = { ...settings, ...(await store.setSettings(patch)) ?? patch };
    mirror(settings);
    applyToDocument(settings);
    applyDisplay();
    return settings;
  }
  for (const [k, t] of Object.entries(toggles)) {
    $(`[data-toggle="${k}"]`)?.addEventListener('click', () => saveSettings(t.set(!t.get())));
  }

  // Settings dialog (+ the Audio section for the current week)
  const settingsDialog = $('#settings');
  const settingsBtn = $('#settings-btn');
  settingsUI = initSettings(settingsDialog, {
    get: () => settings,
    set: saveSettings,
    onChange: (s, patch) => { if ('compact' in patch) { panel.refresh(); if (reader.getView() === 'sentence') reader.rerender(); } },
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
      play: () => audio.playAll(reader.currentUnit()?.id ?? null),
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
    if (kind === 'settings') { settings = await store.getSettings(); mirror(settings); applyToDocument(settings); applyDisplay(); settingsUI.render(settings); }
    if (kind === 'alignments') { audio?.invalidate?.(weekN); refreshAudioAvailability(); }
  };
  // Anything that arrived during boot (settings/lookups are re-read below via loadWeek + the synced read above).
  if (remote.lookups) onRemoteChange('lookups');

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === 'Escape') { if (panel.isOpen()) { e.preventDefault(); panel.close(); } return; }
    if ($('#popup').open || settingsDialog.open || weeksDialog.open) return;
    if (reader.getView() === 'sentence') {
      if (e.key === 'j' || e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); reader.next(); return; }
      if (e.key === 'k' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); reader.prev(); return; }
    }
    if (e.key === 'e') saveSettings(toggles.english.set(!toggles.english.get()));
    if (e.key === 'h') saveSettings(toggles.highlights.set(!toggles.highlights.get()));
  });

  applyDisplay();
  await loadWeek(weekN);
  setView(localStorage.getItem('l103.view') === 'sentence' ? 'sentence' : 'passage');
  document.documentElement.dataset.ready = '1';
  if (!fixture) registerServiceWorker?.()?.catch?.((e) => console.warn('[sw] registration failed', e));
}

boot().catch((err) => {
  console.error(err);
  const el = $('#boot-error');
  el.hidden = false;
  el.querySelector('code').textContent = err?.message ?? String(err);
});
