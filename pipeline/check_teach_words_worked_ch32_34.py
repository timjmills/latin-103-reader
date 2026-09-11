"""Validator for the two teach-step additions of GRAMMAR-CONTRACT.md section 8,
over the cap. XXXII-XXXIV batch: wishes-utinam, pluperfect-subjunctive,
conditions-contrary-to-fact, future-imperative, dative-verbs, dummodo,
elegiac-couplet, prosody-scansion.

Contract: docs/GRAMMAR-CONTRACT.md, "## 8. Teach-step schema, completed (2026-09-10)".

It runs exactly the rules of pipeline/check_teach_words_worked.py (imported, not
copied) and changes one thing that batch never met:

  * **Forms the library never prints.**  The glossary is keyed by inflected
    form, so `veniat`, `legitō`, `audītōte`, `taceās`, `dormīret` and six more
    focus words of these skills have no glossary key at all, and the base
    check reports "no dictionary parse" for a form that is perfectly regular.
    The parses here come from `pipeline/latin_forms.forms` - the pipeline's
    cell-for-cell port of app/js/paradigms.js, so it is the parse the app
    itself puts on the form - unioned with the glossary's own `parses` for
    the readings a generator does not reach.  The skill's parse_filter is then
    applied to those readings exactly as in the base check.

  * **A two-word focus.**  The passive pluperfect subjunctive is two words
    (`laudātus esset`, pfs-09) and the sentence file says so in its note.  A
    perfect passive participle followed by a form of `sum` is read as the one
    periphrastic form: tense from the auxiliary (est -> perf, erat / esset ->
    plupf, erit -> futperf), mood, person and number from the auxiliary,
    voice passive.  Any other two-word focus gets no parse, as in the base.

Usage:  PYTHONIOENCODING=utf-8 python pipeline/check_teach_words_worked_ch32_34.py [skill ...]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_teach_words_worked as base  # noqa: E402
from latin_forms import forms  # noqa: E402

DEFAULT_SKILLS = [
    "wishes-utinam",
    "pluperfect-subjunctive",
    "conditions-contrary-to-fact",
    "future-imperative",
    "dative-verbs",
    "dummodo",
    "elegiac-couplet",
    "prosody-scansion",
]

# auxiliary tense -> tense of the periphrastic perfect-system passive
PERIPHRASTIC_TENSE = {"pres": "perf", "impf": "plupf", "fut": "futperf",
                      "perf": "perf", "plupf": "plupf", "futperf": "futperf"}

_index: dict[str, list[tuple[dict, dict]]] | None = None


def _build_index(glossary) -> dict[str, list[tuple[dict, dict]]]:
    """folded form -> [(entry, parse)], every reading the app can generate,
    plus the glossary's own parses for the form."""
    idx: dict[str, list[tuple[dict, dict]]] = {}
    seen: set[tuple[str, str, frozenset]] = set()

    def add(form, entry, parse):
        clean = {k: v for k, v in parse.items() if v is not None and k in base.FEATURES}
        if not clean:
            return
        sig = (base.fold(form), entry.get("lemma", ""), frozenset((k, str(v)) for k, v in clean.items()))
        if sig in seen:
            return
        seen.add(sig)
        idx.setdefault(base.fold(form), []).append((entry, clean))

    headwords = base.load(base.ROOT / "app" / "data" / "glossary-headwords.json")
    for h, _pos, key, i in headwords["headwords"]:
        entries = glossary.get(key or h)
        if not entries or i >= len(entries):
            continue
        for form, parse in forms(entries[i]):
            add(form, entries[i], parse)
    for key, entries in glossary.items():
        for entry in entries:
            for parse in entry.get("parses") or []:
                add(key, entry, parse)
    return idx


def parses_of(glossary, form: str):
    """Every parse of an inflected form, as (entry, parse, feature keys) -
    the base check's shape - from latin_forms and the glossary together."""
    global _index
    if _index is None:
        _index = _build_index(glossary)
    tokens = [t for t in (base.fold(w) for w in form.split()) if t]
    out = []
    if len(tokens) == 1:
        for entry, parse in _index.get(tokens[0], []):
            out.append((entry, parse, set(parse)))
    elif len(tokens) == 2:
        # participle + sum -> one periphrastic form
        for p_entry, p_parse in _index.get(tokens[0], []):
            if not (p_parse.get("mood") == "ptc" and p_parse.get("tense") == "perf"
                    and p_parse.get("voice") == "pass"):
                continue
            for s_entry, s_parse in _index.get(tokens[1], []):
                if s_entry.get("h") != "sum" or s_parse.get("tense") not in PERIPHRASTIC_TENSE:
                    continue
                parse = {"tense": PERIPHRASTIC_TENSE[s_parse["tense"]], "mood": s_parse.get("mood"),
                         "voice": "pass", "person": s_parse.get("person"), "number": s_parse.get("number")}
                parse = {k: v for k, v in parse.items() if v is not None}
                if (p_entry, parse) not in [(e, p) for e, p, _ in out]:
                    out.append((p_entry, parse, set(parse)))
    return out


if __name__ == "__main__":
    base.parses_of = parses_of
    base.DEFAULT_SKILLS = DEFAULT_SKILLS
    sys.exit(base.main(sys.argv[1:]))
