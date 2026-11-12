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

// What the tips cost (2026-11-08: "a how much money is left indicator as well as price on each card"). Claude Haiku 5.5
// is $0.10 per million input tokens and $0.50 per million output tokens (thinking counts as output). The API does not
// tell a key its balance, so "left" is the credit the learner types in Settings less what this device has spent since.
const BUDGET_KEY = 'l103.tutor.budget';
const SPENT_KEY = 'l103.tutor.spent';
const PRICE_IN = 0.10 / 1e6;
const PRICE_OUT = 0.50 / 1e6;
const costOf = (u = {}) => ((u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) * 0.1 + (u.cache_creation_input_tokens ?? 0) * 1.25) * PRICE_IN + (u.output_tokens ?? 0) * PRICE_OUT;
const costs = new Map();   // reply text -> its price
function charge(text, usage) {
  const c = costOf(usage);
  if (text) costs.set(text, c);
  write(SPENT_KEY, String((Number(read(SPENT_KEY)) || 0) + c));
  return c;
}
const money = (d) => d < 0.01 ? `${(d * 100).toFixed(d < 0.001 ? 3 : 2)}¢` : `$${d.toFixed(2)}`;
/** "This answer cost 0.04¢ · about $4.98 left", for under a tip or a More; null when the price is not known. */
export function tutorCostNode(text, doc = document) {
  const c = costs.get(text);
  if (c == null) return null;
  const p = doc.createElement('p');
  p.className = 'tutor__cost';
  const budget = Number(read(BUDGET_KEY));
  const left = budget > 0 ? budget - (Number(read(SPENT_KEY)) || 0) : null;
  p.textContent = `This answer cost ${money(c)}` + (left != null ? ` · about ${money(Math.max(0, left))} left` : ' · set your credit in Settings to see what is left');
  if (left != null && left < 0.5) p.dataset.low = '1';
  return p;
}

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

// Short and visual (2026-11-08: "use the word I put to show how it's wrong, use highlights for the stems and the tense
// markers … make it as visual as possible, less words the better"): the reply marks word parts as {role|letters}, and
// the card colours them.
const SYSTEM = `You are a Latin tutor beside a learner practising forms (Latin 103: the subjunctive, participles, \
gerunds and gerundives, the future perfect, irregular verbs). The learner just typed a wrong form. Show them, mostly \
with colour, where it went wrong. Keep the explaining words short: under 40 words in all, not counting Latin forms \
or the chart (2026-11-08: "a phrase or sentence at most … under 40 words").

Colour every Latin form you write by its principal part (2026-11-12: "whatever principal part a verb is using and \
however much of that word is used should be one whole colour and the rest another colour"). Split each form into:
{ppN|letters}: all the letters taken from a principal part, as one piece; N is which part (1, 2, 3 or 4). For example \
the present stem portā- comes from the 2nd part portāre, the perfect stem portāv- from the 3rd part portāvī, the \
participle stem portāt- from the 4th part portātum.
{add|letters}: everything added after it (signs, vowels and endings together), as one piece.
{wrong|letters}: letters the learner got wrong, in place of the piece they spoil.

Reply with exactly these five lines, then the chart, and nothing else:
You: the learner's own form, split this way, with the wrong letters marked wrong. Example: You: {pp2|māl}{wrong|it}
Why: one short sentence saying what went wrong and what the form needs. Example: Why: You used the **present** sign \
-i-; the **imperfect** puts -ēba- between the stem and the ending.
From: which principal part, and how much of it is used, as a short phrase. Example: From: the 2nd part, mālle: keep {pp2|māl}
Like: the same form of a different model word, split the same way. Example: Like: {pp2|reg}{add|ēbat} = regēbat
Remember: a memory trick for this pattern, a phrase or one short sentence: a rhyme, a picture, or a link to English. \
Example: Remember: "-bā-, -bā-, black sheep": -bā- means 'was doing'.

Then a Markdown table: a header row and at most three rows, the model word in two or three persons or tenses, every \
form split the same way.

Put the one or two key words of Why and Remember in **bold**. Never write the learner's full correct form. Latin with \
macrons. No other words.`;

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
    if (res.stop_reason === 'refusal') { charge('', res.usage); return null; }   // Haiku has no server-side fallback: no tip this time
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    charge(text, res.usage);
    return text || null;
  });
  memo.set(k, p);
  return p.catch((e) => { memo.delete(k); throw e; });
}

const MORE = `You are the same Latin tutor. The learner read your short tip and asked for more. Explain the rule \
behind this form a little more fully, in at most four short sentences, for a middle- or high-school student; talk to \
them as "you". Then one small Markdown table of the pattern (a header row, then one row per form) on a different model \
word than the one asked. Split every Latin form into {ppN|letters} (the letters taken from principal part N, 1 to 4, as one \
piece) and {add|letters} (everything added to them, as one piece). Put key words in **bold**. No headings, no lists, no other Markdown. Write Latin \
with macrons.`;

/**
 * Text with {role|letters} marks as nodes: the letters from a principal part one colour ({ppN|…}, N the part), what is
 * added to them another ({add|…}), the wrong letters red ({wrong|…}). Older marks (stem, vowel, sign, end) are read as
 * the same two colours: a stem is the principal part's piece, the rest is added.
 */
const ROLE_OF = { pp: 'pp', stem: 'pp', add: 'add', vowel: 'add', sign: 'add', end: 'add', wrong: 'wrong' };
const ORD = ['', '1st', '2nd', '3rd', '4th'];
export function tutorMarked(text, doc = document) {
  const str0 = String(text ?? '');
  if (str0.includes('**')) {   // key words in bold (2026-11-08: "use bold as well for key parts or words")
    const out = [];
    str0.split(/\*\*/).forEach((bit, i) => {
      if (!bit) return;
      if (i % 2) { const b = doc.createElement('strong'); b.className = 'tutor__bold'; b.append(...tutorMarked(bit, doc)); out.push(b); }
      else out.push(...tutorMarked(bit, doc));
    });
    return out;
  }
  const out = [];
  const re = /\{\s*([a-z]+)\s*([1-4]?)\s*\|([^{}]*)\}/gi;
  let at = 0;
  let m;
  const str = str0;
  while ((m = re.exec(str))) {
    if (m.index > at) out.push(doc.createTextNode(str.slice(at, m.index)));
    const role = ROLE_OF[m[1].toLowerCase()] ?? 'add';
    const sp = doc.createElement('span');
    sp.lang = 'la';
    sp.className = 'tutor__part';
    sp.dataset.role = role;
    if (role === 'pp' && m[2]) sp.dataset.part = m[2];
    sp.textContent = m[3];
    sp.title = role === 'pp' ? `from the ${ORD[Number(m[2])] || ''} principal part`.replace('the  ', 'the ') : role === 'add' ? 'added to it' : 'this is the wrong bit';
    out.push(sp);
    at = re.lastIndex;
  }
  if (at < str.length) out.push(doc.createTextNode(str.slice(at)));
  return out;
}

/** The tip: You wrote / Why / From / Like this as rows of coloured parts, then the small chart. */
const TIP_LABELS = { you: 'You wrote', why: 'Why', from: 'From', like: 'Like this', remember: 'Remember', mistake: 'Mistake', rule: 'Rule', part: 'Built on', try: 'Try it' };
export function tutorTipNodes(text, _ask = {}, doc = document) {
  const priced = tutorCostNode(text, doc);
  const rows = [];
  const chart = [];
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim().startsWith('|')) { chart.push(line.trim()); continue; }
    const m = /^\s*[*_]*\s*(you|why|from|like|remember|mistake|rule|part|try)\s*[*_]*\s*:\s*(.+)$/i.exec(line);
    if (m) { let v = m[2].trim(); if ((v.match(/\*\*/g) ?? []).length % 2) v = v.replace(/^\*\*\s*/, ''); rows.push([m[1].toLowerCase(), v]); }   // a bold label's closing ** is not the value's
  }
  const box = doc.createElement('div');
  box.className = 'tutor__tip';
  if (rows.length < 2) { box.append(...tutorNodes(text, doc)); if (priced) box.append(priced); return box; }
  for (const [k, v] of rows) {
    const r = doc.createElement('p');
    r.className = 'tutor__row';
    r.dataset.k = k;
    const b = doc.createElement('b'); b.textContent = TIP_LABELS[k];
    const t = doc.createElement('span'); t.append(...tutorMarked(v, doc));
    r.append(b, t);
    box.append(r);
  }
  if (chart.length >= 2) {
    const c = doc.createElement('div');
    c.className = 'tutor__chart';
    c.append(...tutorNodes(chart.join('\n'), doc));
    box.append(c);
  }
  // The colour key, so the chips read at a glance.
  const key = doc.createElement('p');
  key.className = 'tutor__key';
  for (const [role, label] of [['pp', 'from a principal part'], ['add', 'added'], ['wrong', 'wrong']]) {
    const sp = doc.createElement('span'); sp.className = 'tutor__part'; sp.dataset.role = role; sp.textContent = label;
    key.append(sp);
  }
  box.append(key);
  if (priced) box.append(priced);
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
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  charge(text, res.usage);
  if (res.stop_reason === 'refusal') return null;
  return text || null;
}

/** A reply as nodes: its paragraphs, and a Markdown table as a small table (the only Markdown it is asked for). */
export function tutorNodes(text, doc = document) {
  const out = [];
  const lines = String(text ?? '').split('\n');
  let para = [];
  const flush = () => { if (para.length) { const p = doc.createElement('p'); p.className = 'tutor__p'; p.append(...tutorMarked(para.join(' '), doc)); out.push(p); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i].trim()); i++; }
      i--;
      const cells = (r) => r.replace(/^\||\|$/g, '').split(/\|(?![^{]*\})/).map((x) => x.trim());   // not the | inside a {role|letters} mark
      const body = rows.filter((r) => !/^[\s|:-]+$/.test(r));   // the |---|---| line under the header
      const table = doc.createElement('table');
      table.className = 'tutor__table';
      body.forEach((r, k) => {
        const tr = doc.createElement('tr');
        for (const v of cells(r)) { const td = doc.createElement(k === 0 ? 'th' : 'td'); td.append(...tutorMarked(v, doc)); td.lang = k === 0 ? '' : 'la'; tr.append(td); }
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
      const cost = tutorCostNode(t, doc);
      if (cost) box.append(cost);
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
  const budget = box.querySelector('[data-tutor-budget]');
  const spent = box.querySelector('[data-tutor-spent]');
  const paint = () => {
    on.checked = read(ON_KEY) === '1';
    key.value = read(API_KEY) ? '••••••••••••' : '';
    if (budget && document.activeElement !== budget) budget.value = read(BUDGET_KEY) ?? '';
    if (spent) {
      const sp = Number(read(SPENT_KEY)) || 0;
      const b = Number(read(BUDGET_KEY));
      spent.textContent = `Spent on tips on this device: ${money(sp)}` + (b > 0 ? ` · about ${money(Math.max(0, b - sp))} left` : '') + '. (Anthropic does not let the app read your balance, so "left" counts down from the credit you type here. Type it again after you top up.)';
    }
    msg.textContent = read(ON_KEY) === '1' && !read(API_KEY) ? 'Add an API key to turn the tips on.' : read(API_KEY) ? 'Key saved on this device only.' : '';
  };
  on.addEventListener('change', () => { write(ON_KEY, on.checked ? '1' : null); paint(); });
  key.addEventListener('focus', () => { if (key.value.startsWith('•')) key.value = ''; });
  key.addEventListener('change', () => { const v = key.value.trim(); if (v && !v.startsWith('•')) { write(API_KEY, v); clientP = null; } else if (!v) write(API_KEY, null); paint(); });
  // A new credit figure starts the count again from now.
  budget?.addEventListener('change', () => { const v = Number(budget.value); write(BUDGET_KEY, v > 0 ? String(v) : null); write(SPENT_KEY, null); paint(); });
  box.querySelector('[data-tutor-forget]')?.addEventListener('click', () => { write(API_KEY, null); clientP = null; paint(); });
  paint();
}
