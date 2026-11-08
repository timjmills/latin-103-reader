// The AI tutor's tip (2026-11-08: "when I get something wrong it will intuit what error I am making / what
// misconception I have / what hint I need to get it right, and give me a very short explanation … in a paragraph or
// less … we can turn this feature off or on in the settings").
//
// A wrong answer — in a game round or in a lesson — is sent to Claude with what was asked (the word, its dictionary
// line, the form wanted) and what was written; Claude names the likely mistake and the step that gets it right, in a
// few sentences, without spelling out the answer. Off unless switched on in Settings.
//
// The API key is the learner's own, typed into Settings on this device and kept in this browser only (localStorage):
// never synced, never in the repository. The request goes from the browser straight to the API
// (`dangerouslyAllowBrowser` — the key is in this device's storage, so use a key made for this, with a spend limit).
// The SDK (vendor/anthropic.js, a browser build of @anthropic-ai/sdk) is loaded only when a tip is first asked for.

const ON_KEY = 'l103.tutor.on';
const API_KEY = 'l103.tutor.key';
// Claude Haiku 5.5 only (2026-11-08: "make sure it uses Haiku 5.5 only"): quick and cheap for a three-sentence tip.
const MODEL = 'claude-haiku-5-5';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* this visit only */ } };

export const tutorOn = () => read(ON_KEY) === '1' && !!read(API_KEY);

let clientP = null;
let clientKey = null;
function client() {
  const key = read(API_KEY);
  if (!key) return Promise.resolve(null);
  if (!clientP || clientKey !== key) {
    clientKey = key;
    clientP = import(new URL('../vendor/anthropic.js', import.meta.url).href)
      .then((m) => new m.default({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60_000 }))
      .catch((e) => { clientP = null; throw e; });
  }
  return clientP;
}

const SYSTEM = `You are a Latin tutor beside a learner practising forms (Lingua Latina per se illustrata, Latin 103: \
the subjunctive, participles, gerunds and gerundives, the future perfect, irregular verbs). The learner has just typed \
a wrong answer. Give them just enough to get it right themselves.

Reply in exactly three lines, in this order and with these labels, and nothing else:
Mistake: what is wrong in what they wrote, said to them as "you" (e.g. "You wrote the present, not the imperfect.").
Rule: the rule or pattern they missed or have mixed up, in one plain sentence (e.g. "The imperfect puts -bā- between the stem and the ending.").
Try: one short step or an example on a different word that shows the pattern (e.g. "portā- + -bā- + -t → portābat; do the same with your verb's stem.").

Each line at most 20 words. Write for a middle- or high-school student: everyday words, any grammar term explained in \
a few words. Plain text, no markdown, no bold. Never write the correct form, or the ending or stem it needs; the \
example must use a different word. Write Latin with macrons.`;

/** The tip for a wrong answer, or null when the tutor is off or the call fails. `what` describes the question. */
const memo = new Map();
export async function tutorTip({ cue = '', english = '', lemma = '', answer = '', given = '', context = '' } = {}) {
  if (!tutorOn()) return null;
  const k = `${cue}|${lemma}|${given}`;
  if (memo.has(k)) return memo.get(k);
  const c = await client();
  if (!c) return null;
  const ask = [
    lemma ? `Word: ${lemma}` : null,
    cue ? `Form asked for: ${cue}` : null,
    english ? `Meaning of the form: ${english}` : null,
    context ? `Where it was asked: ${context}` : null,
    `The learner wrote: ${given}`,
    answer ? `The right form (for you only — do not write it out): ${answer}` : null,
  ].filter(Boolean).join('\n');
  const p = c.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: ask }],
  }).then((res) => {
    if (res.stop_reason === 'refusal') return null;   // Haiku has no server-side fallback: no tip this time
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    return text || null;
  });
  memo.set(k, p);
  return p.catch((e) => { memo.delete(k); throw e; });
}

const MORE = `You are the same Latin tutor. The learner read your short tip and asked for more. Explain the rule \
behind this form a little more fully, for a middle- or high-school student: everyday words, short sentences, any \
grammar term explained the first time; talk to them as "you". Then, if a chart helps, add one small chart of the pattern as a Markdown table \
(a header row, then one row per form) — for example the endings across persons and numbers, or the same tense in each \
conjugation — built on a different model word than the one asked, so the answer stays theirs to find. No headings, no \
lists, no other Markdown; at most two short paragraphs and one table. Write Latin with macrons.`;

/** The tip's three labelled lines (Mistake, Rule, Try) as rows; any other reply as a plain paragraph. */
const TIP_LABELS = { mistake: 'Mistake', rule: 'Rule', try: 'Try it' };
export function tutorTipNodes(text, { given = '', lemma = '' } = {}, doc = document) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*[*_]*\s*(mistake|rule|try)\s*[*_]*\s*:\s*[*_]*\s*(.+)$/i.exec(line);
    if (m) rows.push([m[1].toLowerCase(), m[2].replace(/\*\*/g, '').trim()]);
  }
  const box = doc.createElement('div');
  box.className = 'tutor__tip';
  if (rows.length < 2) { box.append(...tutorNodes(text, doc)); return box; }
  if (given) {
    const w = doc.createElement('p');
    w.className = 'tutor__word';
    const lw = doc.createElement('span'); lw.lang = 'la'; lw.textContent = lemma.split(',')[0];
    const g = doc.createElement('s'); g.lang = 'la'; g.textContent = given;
    w.append(...(lemma ? [lw, ' · you wrote '] : ['You wrote ']), g);
    box.append(w);
  }
  for (const [k, v] of rows) {
    const r = doc.createElement('p');
    r.className = 'tutor__row';
    r.dataset.k = k;
    const b = doc.createElement('b'); b.textContent = TIP_LABELS[k];
    const t = doc.createElement('span'); t.textContent = v;
    r.append(b, t);
    box.append(r);
  }
  return box;
}

/** More than the tip: a fuller explanation, perhaps with a small chart (a Markdown table). */
export async function tutorMore(ask = {}, tip = '') {
  if (!tutorOn()) return null;
  const c = await client();
  if (!c) return null;
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low' },
    system: MORE,
    messages: [{ role: 'user', content: [
      ask.lemma ? `Word: ${ask.lemma}` : null,
      ask.cue ? `Form asked for: ${ask.cue}` : null,
      ask.english ? `Meaning of the form: ${ask.english}` : null,
      `The learner wrote: ${ask.given ?? ''}`,
      ask.answer ? `The right form (for you only — do not write it out): ${ask.answer}` : null,
      tip ? `Your tip was: ${tip}` : null,
    ].filter(Boolean).join('\n') }],
  });
  if (res.stop_reason === 'refusal') return null;
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || null;
}

/** A reply as nodes: its paragraphs, and a Markdown table as a small table (the only Markdown it is asked for). */
export function tutorNodes(text, doc = document) {
  const out = [];
  const lines = String(text ?? '').split('\n');
  let para = [];
  const flush = () => { if (para.length) { const p = doc.createElement('p'); p.className = 'tutor__p'; p.textContent = para.join(' ').replace(/\*\*/g, ''); out.push(p); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i].trim()); i++; }
      i--;
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((x) => x.trim().replace(/\*\*/g, ''));
      const body = rows.filter((r) => !/^[\s|:-]+$/.test(r));   // the |---|---| line under the header
      const table = doc.createElement('table');
      table.className = 'tutor__table';
      body.forEach((r, k) => {
        const tr = doc.createElement('tr');
        for (const v of cells(r)) { const td = doc.createElement(k === 0 ? 'th' : 'td'); td.textContent = v; td.lang = k === 0 ? '' : 'la'; tr.append(td); }
        table.append(tr);
      });
      out.push(table);
    } else if (!l) flush();
    else para.push(l);
  }
  flush();
  return out;
}

/** The More button under a tip: asks once, then shows the fuller explanation (and its chart) in `into`. */
export function tutorMoreButton(ask, tip, into, doc = document) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'tutor__more';
  b.textContent = 'More ▾  (explain more, with a chart)';
  b.addEventListener('click', () => {
    b.disabled = true;
    b.textContent = 'Thinking…';
    tutorMore(ask, tip).then((t) => {
      if (!t) { b.textContent = 'No more to add this time.'; return; }
      const box = doc.createElement('div');
      box.className = 'tutor__moretext';
      box.append(...tutorNodes(t, doc));
      into.append(box);
      b.remove();
    }).catch((e) => { b.disabled = false; b.textContent = `${tutorError(e)} Try again ▾`; });
  });
  return b;
}

/** A short line for a failed call, said in the tip's place. */
export function tutorError(e) {
  const status = e?.status;
  if (status === 401) return 'The tutor could not sign in: check the API key in Settings.';
  if (status === 429) return 'The tutor is busy (rate limit): try again in a moment.';
  if (status >= 500) return 'The tutor is unavailable just now.';
  if (e?.name === 'APIConnectionError' || /fetch|network/i.test(String(e?.message))) return 'The tutor could not be reached (offline?).';
  return 'The tutor could not answer this time.';
}

/** Settings: the switch and the key, on this device only. */
export function mountTutorSettings(root) {
  const box = root?.querySelector?.('[data-tutor]');
  if (!box) return;
  const on = box.querySelector('[data-tutor-on]');
  const key = box.querySelector('[data-tutor-key]');
  const msg = box.querySelector('[data-tutor-msg]');
  const paint = () => {
    on.checked = read(ON_KEY) === '1';
    key.value = read(API_KEY) ? '••••••••••••' : '';
    msg.textContent = read(ON_KEY) === '1' && !read(API_KEY) ? 'Add an API key to turn the tips on.' : read(API_KEY) ? 'Key saved on this device only.' : '';
  };
  on.addEventListener('change', () => { write(ON_KEY, on.checked ? '1' : null); paint(); });
  key.addEventListener('focus', () => { if (key.value.startsWith('•')) key.value = ''; });
  key.addEventListener('change', () => { const v = key.value.trim(); if (v && !v.startsWith('•')) { write(API_KEY, v); clientP = null; } else if (!v) write(API_KEY, null); paint(); });
  box.querySelector('[data-tutor-forget]')?.addEventListener('click', () => { write(API_KEY, null); clientP = null; paint(); });
  paint();
}
