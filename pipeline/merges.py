"""
Per-week alignment fixes for build_week.py.

Why this exists
---------------
The builder splits each Latin block and its English block into sentences and
pairs them 1:1. Sometimes the translator split a sentence where the Latin runs
on (typically a quotation with `inquit` tucked inside it), or joined two Latin
sentences into one English one. The builder never guesses: it writes every
mismatched block to data/build/week-NN.report.md with both sentence lists side
by side, numbered from 0. You then record the fix here and rebuild.

Shape
-----
    MERGES = {
        <week n>: {
            "en": { <block key>: [(a, b), ...] },   # join English sentences a and b
            "la": { <block key>: [(a, b), ...] },   # join Latin sentences a and b
        },
    }

* <block key> is the block's line number (int) for [n]-marked blocks, e.g. 91,
  or the block id string for unmarked blocks, e.g. "b3". For multi-text weeks
  (3, 5, 10 — see weeks.py `multi_text`) prefix the part slug: "minos:12" or
  "fl-66:b2". The report prints the exact key to use next to each mismatch.
* (a, b) joins sentence a with the sentence(s) at index b, i.e. sentences
  a..b inclusive become one sentence, glued with a single space. Indices refer
  to the list *as it stands when that merge is applied*; merges for one block
  are applied in the order listed, so give later merges the already-shifted
  indices (or list them from the end of the block backwards).
* Merging is the only operation. If two Latin sentences were rendered by one
  English sentence, merge the Latin ("la"); if one Latin sentence was rendered
  by two English sentences, merge the English ("en").

Week 1 (Familia Romana XXV) needed two English merges because the translator
split a quotation that the Latin carries on with `inquit`:
    block 91:  "…said: 'The Minotaur has been killed!" + "Rejoice, my citizens!"
    block 101: "Return to me!" + "Nor was any answer returned to her…"
"""

MERGES = {
    1: {
        "en": {
            91: [(0, 1)],
            101: [(4, 5)],
        },
    },
}


# Force how a block is cut when the automatic detection gets it wrong.
#   OVERRIDES = { <week n>: { "verse": [keys], "prose": [keys], "dialogue": [keys] } }
# Keys are the same block keys as above. "verse" = one unit per physical line;
# "prose" = sentence-split even though every line starts with a capital;
# "dialogue" = one unit per "Name:" turn even in a [n]-marked block.
OVERRIDES: dict = {}


def merges_for(n: int) -> dict:
    """Return {"en": {...}, "la": {...}} for week n (empty dicts when none)."""
    m = MERGES.get(n, {})
    return {"en": dict(m.get("en", {})), "la": dict(m.get("la", {}))}
