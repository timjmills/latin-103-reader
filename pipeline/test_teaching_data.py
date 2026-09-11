"""What the hand-written teaching data promises the learner.

    python -m pytest pipeline/test_teaching_data.py -q

Two rules the QA audit of 2026-09-12 found broken in shipped JSON, neither of
which any existing gate could see:

* **N-14** a written sentence whose `focus` names one half of a coordinated
  pair.  The resolver settles only the words of the declared span, so the other
  half stays ambiguous and a learner who taps it is marked wrong —
  *Aemilia puellīs et puerīs līlia dat* asked for the indirect object and would
  not take *puerīs*.
* **N-15** a chart check that declares a word the item then drops.  `entryFor`
  in app/js/grammar/items.js takes the first glossary entry under the key that
  renders any paradigm at all, so a noun shadowed by an adjective homograph
  (*amīcus -a -um* before *amīcus -ī m*) answers none of the asked cells and is
  passed over in silence.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import build_paradigm_catalogue as bpc  # noqa: E402

GRAM = ROOT / "app" / "data" / "grammar"
SENTENCES = GRAM / "sentences"
LESSONS = GRAM / "lessons"
GLOSSARY = ROOT / "app" / "data" / "glossary.json"
COORDINATORS = ("et", "atque", "ac")


@pytest.fixture(scope="module")
def glossary() -> dict:
    if not GLOSSARY.exists():
        pytest.skip("glossary.json not built")
    return json.loads(GLOSSARY.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def skills() -> dict:
    return {s["id"]: s for s in json.loads((GRAM / "skills.json").read_text(encoding="utf-8"))["skills"]}


def key(s: str) -> str:
    s = "".join(c for c in unicodedata.normalize("NFD", s or "") if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", s.lower())


def bare(tok: str) -> str:
    return re.sub(r"[^\wĀ-ſ]", "", tok)


# --------------------------------------------------------------- N-14

def cases_of(glossary: dict, form: str) -> set[str]:
    """Every case the printed form can be read as, per the glossary."""
    return {p["case"] for e in glossary.get(key(form), []) if not e.get("enc")
            for p in (e.get("parses") or []) if p.get("case")}


def wanted_cases(skill: dict) -> set[str]:
    f = skill.get("parse_filter")
    fs = f if isinstance(f, list) else ([f] if f else [])
    out: set[str] = set()
    for x in fs:
        c = (x or {}).get("case")
        if isinstance(c, str):
            out.add(c)
        elif isinstance(c, list):
            out |= set(c)
    return out


def coordinated_but_half_focused(glossary, skills):
    """(file, id, Latin, focus, the word left unsettled) for every written
    sentence that names one half of a pair its own skill would accept."""
    out = []
    for path in sorted(SENTENCES.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        skill = skills.get(data.get("skill"))
        want = wanted_cases(skill) if skill else set()
        if not want:
            continue                      # only a case skill asks "which word"
        for s in data.get("sentences") or []:
            span = (s.get("focus") or "").split()
            if not span:
                continue
            toks = [bare(t) for t in s["la"].split()]
            for i, t in enumerate(toks):
                if t.lower() not in COORDINATORS or i == 0 or i + 1 >= len(toks):
                    continue
                a, b = toks[i - 1], toks[i + 1]
                if (a in span) == (b in span):
                    continue
                other = b if a in span else a
                if not (want & cases_of(glossary, a)) or not (want & cases_of(glossary, b)):
                    continue              # not both an answer to this skill
                if len(cases_of(glossary, other)) < 2:
                    continue              # its ending reads one way: the scanner settles it alone
                out.append((path.name, s["id"], s["la"], s.get("focus"), other))
    return out


def test_dio_14_names_both_receivers():
    data = json.loads((SENTENCES / "dative-indirect-object.json").read_text(encoding="utf-8"))
    s = next(x for x in data["sentences"] if x["id"] == "dio-14")
    assert s["la"] == "Aemilia puellīs et puerīs līlia dat."
    assert s["focus"] == "puellīs et puerīs"


def test_no_written_sentence_focuses_half_a_coordinated_pair(glossary, skills):
    bad = coordinated_but_half_focused(glossary, skills)
    assert bad == [], "\n".join(f"{b[0]} {b[1]}: {b[2]} focus={b[3]!r} leaves {b[4]!r}" for b in bad)


def test_a_multi_word_focus_is_a_contiguous_run_of_the_sentence():
    """The resolver splits the focus on whitespace and matches a run, so every
    word of a declared span has to be printed, in order."""
    bad = []
    for path in sorted(SENTENCES.glob("*.json")):
        for s in json.loads(path.read_text(encoding="utf-8")).get("sentences") or []:
            span = (s.get("focus") or "").split()
            if len(span) < 2:
                continue
            toks = [bare(t) for t in s["la"].split()]
            if not any(toks[i:i + len(span)] == span for i in range(len(toks))):
                bad.append((path.name, s["id"], s["focus"], s["la"]))
    assert bad == []


# --------------------------------------------------------------- N-15

def rendered_cells(entry):
    try:
        got = bpc.rendered(entry)
    except Exception:
        return None
    return {cid for _, cid in got[1]} if got else None


def entry_for(glossary: dict, word: str):
    """app/js/grammar/items.js `entryFor` for a bare string: the entries under
    the key whose `h` matches first, then all of them, and the first that
    renders any paradigm wins — whatever part of speech it is."""
    entries = glossary.get(word) or []
    for e in [x for x in entries if x.get("h") == word] + entries:
        cells = rendered_cells(e)
        if cells:
            return e, cells
    return None, None


def resolve_cell(cid: str, have: set[str]):
    """`resolveCellId`: exact, then 3sg → 3.sg, then a degree prefix."""
    if cid in have:
        return cid
    split = re.sub(r"([123])(sg|pl)(?![a-z0-9])", r"\1.\2", cid)
    if split != cid and split in have:
        return split
    for deg in ("pos", "comp", "super"):
        if f"{deg}.{split}" in have:
            return f"{deg}.{split}"
    return None


def dropped_chart_words(glossary):
    out = []
    for path in sorted(LESSONS.glob("*.json")):
        if path.name == "index.json":
            continue
        for step in json.loads(path.read_text(encoding="utf-8")).get("teach") or []:
            check = step.get("check") or {}
            if check.get("kind") != "chart" or not check.get("words"):
                continue
            asked = check.get("cells") or []
            for i, w in enumerate(check["words"][:5]):    # the item takes five at most
                e, cells = entry_for(glossary, w)
                if not e:
                    out.append((path.stem, step["n"], w, "renders no table"))
                elif not any(resolve_cell(a, cells) for a in asked):
                    out.append((path.stem, step["n"], w,
                                f"{e.get('lemma')!r} ({e.get('pos')}) has none of {asked}"))
    return out


def test_the_dative_step_asks_all_three_words_it_names(glossary):
    data = json.loads((LESSONS / "dative-indirect-object.json").read_text(encoding="utf-8"))
    step = next(s for s in data["teach"] if s["n"] == 4)
    assert step["check"]["words"] == ["servus", "dominus", "filius"]
    for w in step["check"]["words"]:
        _, cells = entry_for(glossary, w)
        assert cells and resolve_cell("dat.pl", cells), w


def test_no_chart_check_declares_a_word_the_item_would_drop(glossary):
    bad = dropped_chart_words(glossary)
    # third-declension-neuter step 4 names *mare* in its own question, and the
    # glossary lists Whitaker's adjective mare "male" before the noun mare
    # "sea".  A bare string cannot say which reading it means, so the fix is in
    # app/js (items.js entryFor / lessons.js normaliseCheck), not here.
    known = [b for b in bad if (b[0], b[2]) == ("third-declension-neuter", "mare")]
    assert len(known) <= 1
    assert [b for b in bad if b not in known] == []
