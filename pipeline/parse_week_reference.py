"""
Reference parser for the week documents in source/. This is the logic that
successfully aligned Week 1 (93 sentences, zero mismatches after two manual
merges). Generalise it; do not treat it as production code.

Document format (all 14 weeks follow this, with variations noted):

  CAPITVLVM ... (XXV)            <- chapter heading
  TITLE
  Pars I (Lines 1–41)            <- section header with line range
  Textus Latīnus
  [1] Latin block ...            <- [n] = Familia Romana line number where the block starts
  [4] Latin block ...
  Literal English Translation
  [1] English block ...          <- same [n] keys, 1:1 with Latin blocks
  [4] English block ...
  Pars II (...)                  <- repeat
  Grammatica ...                 <- user's grammar section: EXCLUDE from the app
  Pēnsa ...                      <- exercises: EXCLUDE from the app

Variations:
  * Weeks 3, 7, 8, 9, 10, 11, 12, 13: Latin/English blocks are plain paragraphs
    with NO [n] markers. Pair paragraph-by-paragraph in order. Line numbers for
    these must be recovered from the textbook scan (see PROMPT.md, workstream A).
  * Week 5 Fabellae Latinae 66 is speaker-labelled dialogue ("Dāvus: ...").
    Each speaker turn is one unit.
  * Weeks 13–14 contain verse. Keep verse lines as lines; do not sentence-split
    inside a poem. Each verse line is a unit; the poem is the block.
  * The English translations contain bracketed grammar tags, e.g.
    "[imperfect subjunctive: mitterent]" or "[Ablative Absolute]". These are
    the seed for the grammar-highlight feature. Extract them; do not display
    them raw inside the translation text (strip to a clean reading text, keep
    the tags as structured annotations).
"""
import re, json

def blocks(txt):
    return [(int(n), b.strip()) for n, b in
            re.findall(r'\[(\d+)\]\s*(.*?)(?=\n\[\d+\]|\Z)', txt, re.S)]

def sents(t, latin=False):
    t = re.sub(r'\s+', ' ', t).strip()
    # Split after . ! ? (optionally followed by a closing quote or ...) when the
    # next token starts with a capital, quote, or bracket. For Latin also split
    # before a lowercase "an " (second half of a double question after "?").
    if latin:
        pat = r'(?<=[.!?])(?:["\']|\.\.\.)?\s+(?=["\'(\[A-ZĀĒĪŌŪ]|an )'
    else:
        pat = r'(?<=[.!?])(?:["\']|\.\.\.)?\s+(?=["\'(\[A-ZĀĒĪŌŪ])'
    return [s.strip() for s in re.split(pat, t) if s.strip()]

# Week 1 needed two English merges to line up with the Latin, because the
# translator split a quotation where the Latin ran on with "inquit".
MERGE = {91: [(0, 1)], 101: [(4, 5)]}

def parse(md):
    parts = re.findall(
        r'## (Pars [IVX]+) \(Lines ([^)]*)\)\n\n### Textus Latīnus\n(.*?)'
        r'### Literal English Translation\n(.*?)(?=\n---|\Z)', md, re.S)
    out = []
    for part, lines, lat, eng in parts:
        L, E = dict(blocks(lat)), dict(blocks(eng))
        for n in L:
            ls, es = sents(L[n], True), sents(E[n])
            for a, b in MERGE.get(n, []):
                es = es[:a] + [es[a] + ' ' + es[b]] + es[b+1:]
            if len(ls) != len(es):
                # Surface for human review rather than guessing.
                print(f'MISMATCH block {n}: {len(ls)} la / {len(es)} en')
            out.append({'part': part, 'lines': lines, 'line': n,
                        'sents': [{'id': f'{n}.{i+1}', 'la': l, 'en': e}
                                  for i, (l, e) in enumerate(zip(ls, es))]})
    return out

if __name__ == '__main__':
    import sys
    print(json.dumps(parse(open(sys.argv[1]).read()), ensure_ascii=False, indent=1))
