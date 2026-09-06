// Printable charts (GRAMMAR-CONTRACT.md, wave 3): a paradigm printed one
// table per page with the cells the skill focuses on marked, and a skill sheet
// with the lesson's rule, paradigm and examples. Black on white, no app chrome,
// macrons preserved (the tables carry them; nothing here strips anything).
//
// The section builds the pages into one hidden root, sets
// `html[data-printing]` and calls print(); app/css/print.css hides everything
// else. Nothing is fetched at print time — whatever the view already has is
// what goes on the paper.
//
//   const pages = paradigmPages(par.paradigm(entry, hits));   // pure: the tables, with their marked cells counted
//   printDocument(buildChart({ skill, paradigm, entry }), { title: 'Dative — chart' });

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
};

export const PRINT_ROOT = 'g-print';

/** The text of a paradigm cell as it prints: the stem and ending joined, alternatives after a slash, an empty cell an em dash. Pure. */
export function cellText(c) {
  if (!c || c.empty) return '—';
  const main = c.stem != null && c.ending != null && (c.stem || c.ending) ? `${c.stem}${c.ending}` : (c.text ?? '—');
  return c.alt ? `${main} / ${c.alt}` : main;
}

/**
 * A paradigm as printable pages — one page per section of the table, each with
 * its rows flattened to text and its marked (`hit`) cells counted. Pure, so
 * the page break and the marking can be tested without a browser.
 */
export function paradigmPages(p) {
  if (!p) return [];
  return (p.sections ?? []).map((s) => {
    const rows = (s.rows ?? []).map((r) => ({
      label: r.label ?? '',
      cells: (r.cells ?? []).map((c) => ({ text: cellText(c), hit: !!c.hit, empty: !!c.empty })),
    }));
    return {
      title: s.title ?? '',
      headers: [...(s.headers ?? [])],
      rows,
      hits: rows.reduce((n, r) => n + r.cells.filter((c) => c.hit).length, 0),
    };
  });
}

/** "Cap. VII · 101 week 7 · Noun case" — the line under a printed sheet's title. Pure. */
export function sheetSubtitle(skill, { roman }) {
  const bits = [];
  if (skill?.chapter) bits.push(`Cap. ${roman(skill.chapter)}`);
  if (skill?.course) bits.push(`${skill.course} week ${skill.week ?? '—'}`);
  if (skill?.latin_label) bits.push(skill.latin_label);
  return bits.join(' · ');
}

/**
 * What the marks on a chart mean, said in the skill's own plain words. Returns
 * null when nothing is marked, so the key never claims a mark that is not
 * there. Pure.
 */
export function focusNote(skill, hits) {
  if (!hits) return null;
  const plain = String(skill?.plain ?? '').trim();
  return `Boxed cells are the forms this skill is about${plain ? ` — ${plain}` : ''}.`;
}

const dateText = (now = new Date()) => now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

function pageFoot(now) {
  return h('footer', { class: 'pr-foot' }, h('span', { text: 'Latin 103 Reader' }), h('span', { text: dateText(now) }));
}

function tableNode(page) {
  const table = h('table', { class: 'pr-t' });
  if (page.title) table.append(h('caption', { class: 'pr-t__cap', text: page.title }));
  if (page.headers.length) {
    const labelCol = (page.rows[0]?.cells.length ?? 0) === page.headers.length ? [h('th', { scope: 'col', class: 'pr-t__corner', 'aria-label': 'form' })] : [];
    table.append(h('thead', {}, h('tr', {}, ...labelCol, page.headers.map((hd) => h('th', { scope: 'col', text: hd })))));
  }
  table.append(h('tbody', {}, page.rows.map((r) => h('tr', {},
    h('th', { scope: 'row', text: r.label }),
    r.cells.map((c) => h('td', { class: `pr-t__c${c.hit ? ' is-hit' : ''}${c.empty ? ' is-empty' : ''}`, lang: 'la', text: c.text }))))));
  return table;
}

/**
 * The chart: one page per section of the paradigm, the skill's focus cells
 * boxed, a key under the last one. `paradigm` is paradigms.js's table (already
 * built with the skill's focus as its highlight), `roman` sync.js's numeral.
 */
export function buildChart({ skill, paradigm, roman, now = new Date() }) {
  const pages = paradigmPages(paradigm);
  if (!pages.length) return null;
  const hits = pages.reduce((n, p) => n + p.hits, 0);
  const note = focusNote(skill, hits);
  const frag = document.createDocumentFragment();
  pages.forEach((page, i) => {
    frag.append(h('section', { class: 'pr-page' },
      h('header', { class: 'pr-head' },
        h('h1', { class: 'pr-title', text: skill.title }),
        h('p', { class: 'pr-sub', text: [sheetSubtitle(skill, { roman }), paradigm.title].filter(Boolean).join(' · ') })),
      tableNode(page),
      paradigm.note ? h('p', { class: 'pr-note', text: paradigm.note }) : null,
      note && page.hits ? h('p', { class: 'pr-key', text: note }) : null,
      i === pages.length - 1 && skill.summary ? h('p', { class: 'pr-summary', text: skill.summary }) : null,
      pageFoot(now)));
  });
  return frag;
}

/**
 * The skill sheet: the lesson's rule, the paradigm and the examples on one
 * sheet (it flows onto a second page rather than being cut). `rule` is the
 * lesson's rule text, `examples` `[{ la, en, ref }]`, `confusion`
 * `{ title, text }`.
 */
export function buildSheet({ skill, paradigm, rule = '', examples = [], confusion = null, roman, now = new Date() }) {
  const pages = paradigmPages(paradigm);
  const hits = pages.reduce((n, p) => n + p.hits, 0);
  const note = focusNote(skill, hits);
  return h('section', { class: 'pr-page pr-page--sheet' },
    h('header', { class: 'pr-head' },
      h('h1', { class: 'pr-title', text: skill.title }),
      h('p', { class: 'pr-sub', text: sheetSubtitle(skill, { roman }) }),
      skill.plain ? h('p', { class: 'pr-plain', text: skill.plain }) : null),
    rule ? h('div', { class: 'pr-rule' }, h('h2', { class: 'pr-h2', text: 'The rule' }), h('p', { text: rule })) : null,
    pages.length ? h('div', { class: 'pr-tables' }, h('h2', { class: 'pr-h2', text: 'The forms' }), pages.map(tableNode), note && hits ? h('p', { class: 'pr-key', text: note }) : null) : null,
    examples.length ? h('div', { class: 'pr-ex' }, h('h2', { class: 'pr-h2', text: 'Examples' }),
      h('ol', { class: 'pr-ex__list' }, examples.map((e) => h('li', {},
        h('p', { class: 'pr-la', lang: 'la', text: e.la }),
        e.en ? h('p', { class: 'pr-en', text: e.en }) : null,
        e.ref ? h('p', { class: 'pr-ref', text: e.ref }) : null)))) : null,
    confusion ? h('div', { class: 'pr-conf' }, h('h2', { class: 'pr-h2', text: `Not to be confused with ${confusion.title}` }), h('p', { text: confusion.text })) : null,
    pageFoot(now));
}

/**
 * Print what has been built. The pages go into one root outside the app's own
 * tree, `html[data-printing]` turns print.css on, and everything is taken down
 * again after the dialog closes — however it closes, since Safari fires no
 * `afterprint` when the sheet is dismissed (a timeout catches that).
 */
export function printDocument(content, { title = 'Latin 103', doc = document } = {}) {
  if (!content) return false;
  const prev = doc.title;
  let root = doc.getElementById(PRINT_ROOT);
  if (!root) { root = doc.createElement('div'); root.id = PRINT_ROOT; doc.body.append(root); }
  root.className = 'pr';
  root.replaceChildren(content);
  doc.title = title;
  doc.documentElement.dataset.printing = 'on';
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    delete doc.documentElement.dataset.printing;
    root.replaceChildren();
    doc.title = prev;
    window.removeEventListener('afterprint', cleanup);
    clearTimeout(timer);
  };
  window.addEventListener('afterprint', cleanup);
  const timer = setTimeout(cleanup, 60000);
  try { window.print(); } catch (e) { console.warn('[grammar] printing is not available here', e?.message || e); cleanup(); return false; }
  // Chrome fires afterprint synchronously enough; the listener above covers the rest.
  return true;
}
