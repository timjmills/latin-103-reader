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

/** "Cap. VII · 101 week 7 · cāsus datīvus" — the line under a printed sheet's title (the skill's Latin label, where it has one). Pure. */
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

/**
 * A section title worth printing. A noun or adjective table has exactly one
 * section and paradigms.js names it `'cases'`, so every printed noun chart
 * carried a caption reading "cases" — a label for a tab, not for a sheet with
 * the case names already down its left edge (G3-10). Pure.
 */
export function captionFor(title, sectionCount = 1) {
  const t = String(title ?? '').trim();
  if (!t) return '';
  if (sectionCount <= 1 && /^(cases|forms|table)$/i.test(t)) return '';
  return t;
}

function tableNode(page, sectionCount = 1) {
  const table = h('table', { class: 'pr-t' });
  const caption = captionFor(page.title, sectionCount);
  if (caption) table.append(h('caption', { class: 'pr-t__cap', text: caption }));
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
      tableNode(page, pages.length),
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
 *
 * Because it flows, its footer has to run: appended once at the end it landed
 * on page 2 only, so page 1 of a two-page sheet carried no "Latin 103 Reader ·
 * 6 September 2026" line at all (QA-B9). The sheet is wrapped in `.pr-doc--sheet`
 * and the footer fixed to the bottom of every page it spans; the wrapper is
 * what scopes it, so a bulk chart print (many `.pr-page` sections, each with
 * its own footer) is untouched.
 */
export function buildSheet({ skill, paradigm, rule = '', examples = [], confusion = null, roman, now = new Date() }) {
  const pages = paradigmPages(paradigm);
  const hits = pages.reduce((n, p) => n + p.hits, 0);
  const note = focusNote(skill, hits);
  const sheet = h('section', { class: 'pr-page pr-page--sheet' },
    h('header', { class: 'pr-head' },
      h('h1', { class: 'pr-title', text: skill.title }),
      h('p', { class: 'pr-sub', text: sheetSubtitle(skill, { roman }) }),
      skill.plain ? h('p', { class: 'pr-plain', text: skill.plain }) : null),
    rule ? h('div', { class: 'pr-rule' }, h('h2', { class: 'pr-h2', text: 'The rule' }), h('p', { text: rule })) : null,
    pages.length ? h('div', { class: 'pr-tables' }, h('h2', { class: 'pr-h2', text: 'The forms' }), pages.map((pg) => tableNode(pg, pages.length)), note && hits ? h('p', { class: 'pr-key', text: note }) : null) : null,
    examples.length ? h('div', { class: 'pr-ex' }, h('h2', { class: 'pr-h2', text: 'Examples' }),
      h('ol', { class: 'pr-ex__list' }, examples.map((e) => h('li', {},
        h('p', { class: 'pr-la', lang: 'la', text: e.la }),
        e.en ? h('p', { class: 'pr-en', text: e.en }) : null,
        e.ref ? h('p', { class: 'pr-ref', text: e.ref }) : null)))) : null,
    confusion ? h('div', { class: 'pr-conf' }, h('h2', { class: 'pr-h2', text: `Not to be confused with ${confusion.title}` }), h('p', { text: confusion.text })) : null);
  const foot = pageFoot(now);
  foot.classList.add('pr-foot--run');
  return h('div', { class: 'pr-doc pr-doc--sheet' }, sheet, foot);
}

/**
 * Print what has been built. The pages go into one root outside the app's own
 * tree, `html[data-printing]` turns print.css on, and everything is taken down
 * again when the dialog closes — however it closes.
 *
 * The root is **`hidden`**. `print.css` is linked `media="print"`, so none of
 * its rules reach the screen: without the attribute the built pages joined the
 * document flow under the app, black on white and full width, for as long as
 * the dialog was up — and for the whole fallback timeout on a browser that
 * fires no `afterprint` when the sheet is dismissed (G3-03 / QA-B3).
 * `html[data-printing] #g-print` outranks `[hidden]`, so the sheet still
 * prints.
 *
 * Cancellation is caught three ways rather than waited out: `afterprint`,
 * and the print media query going false — the documented Safari fallback,
 * which fires on a dismissal too — with a long timer only as a last resort.
 * The title is restored only if it is still the one this call set, so a view
 * drawn while the dialog was open keeps its own (G3-10).
 */
export function printDocument(content, { title = 'Latin 103', doc = document } = {}) {
  if (!content) return false;
  const prev = doc.title;
  let root = doc.getElementById(PRINT_ROOT);
  if (!root) { root = doc.createElement('div'); root.id = PRINT_ROOT; doc.body.append(root); }
  root.className = 'pr';
  root.hidden = true;
  root.replaceChildren(content);
  doc.title = title;
  doc.documentElement.dataset.printing = 'on';
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
  let done = false;
  const onMedia = (e) => { if (!e.matches) cleanup(); };
  function cleanup() {
    if (done) return;
    done = true;
    delete doc.documentElement.dataset.printing;
    root.replaceChildren();
    if (doc.title === title) doc.title = prev;
    window.removeEventListener('afterprint', cleanup);
    mq?.removeEventListener?.('change', onMedia);
    clearTimeout(timer);
  }
  window.addEventListener('afterprint', cleanup);
  mq?.addEventListener?.('change', onMedia);
  const timer = setTimeout(cleanup, 5 * 60 * 1000);
  try { window.print(); } catch (e) { console.warn('[grammar] printing is not available here', e?.message || e); cleanup(); return false; }
  // Chrome fires afterprint synchronously enough; the listeners above cover the rest.
  return true;
}
