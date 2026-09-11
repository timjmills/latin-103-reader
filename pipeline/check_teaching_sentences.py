# -*- coding: utf-8 -*-
"""Build check for the teaching sentences and the lessons' teach blocks.

GRAMMAR-CONTRACT.md "Teaching rebuild (2026-09-09)" §1 and §2.

    set PYTHONIOENCODING=utf-8
    python pipeline/check_teaching_sentences.py                 # every file present
    python pipeline/check_teaching_sentences.py comparative ... # only these skills

What it checks, per skill:

  1  app/data/grammar/sentences/<skill>.json is valid JSON in the §1 shape,
     and the lesson file is valid JSON with a "teach" block in the §2 shape.
  2  Every printed word is inside the cumulative chapter vocabulary — that is,
     it is a form the glossary entry of a lemma in app/data/grammar/vocab/NN.json
     for some NN <= the skill's chapter can actually take — or is a proper name
     of the book's cast, or a listed function word.  Macrons are part of the
     test: a form is accepted only in the spelling latin_forms.py produces.
  3  Word count 5-8, or a "note" on the sentence saying why not.
  4  "focus" occurs verbatim in "la".
  5  Sentence ids unique, and unique across the whole set.
  6  Every sentence id a teach step references exists; every step number has at
     least one sentence; step numbers are 1..n with no gaps; 4-6 steps.
  7  Every paradigm key named by a teach block is in skills.json's
     paradigm_keys map, and every revealed / checked cell key exists in that
     table.  Cell keys are dotted feature values, in the order the paradigm's
     own cell key carries them: "<case>.<number>" for a noun, adding
     ".<gender>" for an adjective, "ptc.<tense>.<voice>" for a participle cell.

Extras it also enforces: "kinds" is a subset of the skill's kinds in
skills.json; "chapter" matches the skill's chapter; "stage" is 1-3; every
printed word carries a gloss, in order.
"""
from __future__ import annotations

import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from macrons import strip_macrons                     # noqa: E402
import latin_forms as LF                              # noqa: E402

PUNCT = ".,;:!?’“”\"'—-"

#: Proper names of the book's cast and its places.  The decks hold no proper
#: names at all (§7.2 of the contract), so these are allowed by rule, not by
#: deck, and their spellings are pinned here.
NAMES = {
    "iulius", "iulii", "iulio", "iulium", "iulie",
    "aemilia", "aemiliae", "aemiliam", "aemilia",
    "marcus", "marci", "marco", "marcum", "marce",
    "quintus", "quinti", "quinto", "quintum", "quinte",
    "iulia", "iuliae", "iuliam", "iulia",
    "syra", "syrae", "syram",
    "davus", "davi", "davo", "davum", "dave",
    "medus", "medi", "medo", "medum", "mede",
    "lydia", "lydiae", "lydiam",
    "roma", "romae", "romam", "roma",
    "tusculum", "tusculi", "tusculo",
    "italia", "italiae", "italiam",
    "ianuarius", "ianuario", "ianuarii",
}

#: Function words a construction may bring in even if no deck lists them.
FUNCTION_WORDS = {"ut", "ne", "cum", "si", "quam"}

#: Second spellings of a deck lemma that the form generator does not produce.
#: The decks list `ab` and `ex`, but before a consonant Latin prints ā and ē
#: (ā Mārcō, ā Syrā, ē vīllā) — glossary.json holds the pair under the separate
#: headword `a` / `e` (lemma "ā / ab", "ē / ex"), so the generator, which walks
#: the deck's own headword, never reaches them.  They are the same chapter-5
#: word, not an exception.
LEMMA_SPELLINGS = {"ab": ["ā"], "ex": ["ē"]}

CASES = ("nom", "gen", "dat", "acc", "abl", "voc", "loc")


# --------------------------------------------------------------- vocabulary

def load_glossary():
    with io.open(os.path.join(ROOT, "app/data/glossary.json"), encoding="utf-8") as f:
        return json.load(f)


def gkey(word: str) -> str:
    """The glossary's own lookup key: macron-stripped, lower-case."""
    return strip_macrons(word).lower()


_FORMS_CACHE: dict[int, dict[str, list[str]]] = {}


def allowed_forms(chapter: int, glossary) -> dict[str, list[str]]:
    """Every macronised form the decks up to `chapter` can produce -> lemmas."""
    if chapter in _FORMS_CACHE:
        return _FORMS_CACHE[chapter]
    heads: dict[str, tuple[int, str, str]] = {}
    for n in range(1, chapter + 1):
        p = os.path.join(ROOT, f"app/data/grammar/vocab/{n:02d}.json")
        if not os.path.exists(p):
            continue
        with io.open(p, encoding="utf-8") as f:
            deck = json.load(f)
        for w in deck["words"]:
            key = gkey(w["lemma"])
            heads.setdefault(key, (n, w["lemma"], w.get("pos") or ""))
            # a deck lemma may be printed in a form that is not the headword
            # (castra -> castrum, manūs -> manus, pedēs -> pes): take the
            # headword of every glossary entry that spelling looks up.
            for e in glossary.get(key, []):
                h = gkey(e.get("h") or e.get("lemma", "").split()[0])
                heads.setdefault(h, (n, w["lemma"], w.get("pos") or ""))
    out: dict[str, list[str]] = {}
    for entries in glossary.values():
        for e in entries:
            h = gkey(e.get("h") or e.get("lemma", "").split()[0])
            if h not in heads:
                continue
            label = f"{heads[h][1]} (ch. {heads[h][0]})"
            try:
                forms = LF.single_forms(e)
            except Exception:
                forms = []
            if not forms:
                # an indeclinable (et, in, sed, iam): its one spelling is the
                # deck's own lemma, which carries the macrons.
                forms = [heads[h][1]]
            for form in forms:
                out.setdefault(form.lower(), []).append(label)
            for extra in LEMMA_SPELLINGS.get(gkey(heads[h][1]), ()):
                out.setdefault(extra.lower(), []).append(label)
    _FORMS_CACHE[chapter] = out
    return out


def words_of(la: str) -> list[str]:
    return [w.strip(PUNCT) for w in la.split() if w.strip(PUNCT)]


# ----------------------------------------------------------------- paradigms

_CATALOGUE_CELLS: dict[str, set[str]] | None = None


def _catalogue_cells() -> dict[str, set[str]]:
    """table id -> the cell ids app/data/grammar/paradigms.json names for it.

    The catalogue is the contract's authority on cell ids (§4a: the slots are
    written `degree · tense · mood · voice · person · case · number · gender`,
    a noun table leaves the gender out, an adjective table prefixes the degree),
    and `pipeline/test_build_paradigm_catalogue.py` proves those ids are the
    ones app/js/paradigms.js computes.  Rebuilding the ids here from a model
    lemma got two tables wrong in both directions — it invented `nom.sg.m` for
    the adjective tables, which really carry `pos.nom.sg.m`, and it denied
    `nom.sg.c` on `quis`, which is real — so read the catalogue instead.
    """
    global _CATALOGUE_CELLS
    if _CATALOGUE_CELLS is None:
        with io.open(os.path.join(ROOT, "app/data/grammar/paradigms.json"),
                     encoding="utf-8") as f:
            doc = json.load(f)
        tables: dict[str, set[str]] = {}
        for part in doc["parts"]:
            for table in part["tables"]:
                tables[table["id"]] = {c for g in table["groups"] for c in g["cells"]}
        _CATALOGUE_CELLS = tables
    return _CATALOGUE_CELLS


def cell_keys(key: str, glossary) -> set[str] | None:
    """Every dotted cell key the named paradigm table offers, or None."""
    return _catalogue_cells().get(key)


#: One real lemma per paradigm key, so the table can actually be built.
MODEL = {
    "decl1": ("puella", "N"), "decl2m": ("servus", "N"), "decl2n": ("verbum", "N"),
    "decl2r": ("puer", "N"), "decl3": ("pastor", "N"), "decl3n": ("corpus", "N"),
    "decl3i": ("ovis", "N"), "decl3in": ("mare", "N"), "decl4": ("exercitus", "N"),
    "decl4n": ("genu", "N"), "decl5": ("dies", "N"),
    "adj12": ("bonus", "ADJ"), "adj3": ("fortis", "ADJ"),
    "adj3cons": ("vetus", "ADJ"), "adjcomp": ("longior", "ADJ"),
    "conj1": ("canto", "V"), "conj2": ("video", "V"), "conj3": ("duco", "V"),
    "conj3io": ("capio", "V"), "conj4": ("audio", "V"),
    "sum": ("sum", "V"), "possum": ("possum", "V"), "eo": ("eo", "V"),
    "fero": ("fero", "V"), "volo": ("volo", "V"), "nolo": ("nolo", "V"),
    "malo": ("malo", "V"), "fio": ("fio", "V"),
    "is": ("is", "PRON"), "hic": ("hic", "PRON"), "ille": ("ille", "PRON"),
    "iste": ("iste", "PRON"), "ipse": ("ipse", "PRON"), "idem": ("idem", "PRON"),
    "qui": ("qui", "PRON"), "quis": ("quis", "PRON"), "ego": ("ego", "PRON"),
    "tu": ("tu", "PRON"), "se": ("se", "PRON"),
    "unus": ("unus", "NUM"), "duo": ("duo", "NUM"), "tres": ("tres", "NUM"),
    "vis": ("vis", "N"), "deus": ("deus", "N"), "domus": ("domus", "N"),
    "iuppiter": ("iuppiter", "N"),
}


def _model_entry(key: str, glossary):
    want = MODEL.get(key)
    if not want:
        return None
    lemma, pos = want
    best = None
    for e in glossary.get(lemma, []):
        if e.get("pos") == pos or (pos == "V" and e.get("pos") in ("V", "VPAR")):
            if key == "adjcomp" and e.get("kind") != "comp":
                best = best or e
                continue
            return e
    return best


# --------------------------------------------------------------------- main

def check(skill_ids=None):
    glossary = load_glossary()
    with io.open(os.path.join(ROOT, "app/data/grammar/skills.json"), encoding="utf-8") as f:
        smap = json.load(f)
    pkeys = set(smap["paradigm_keys"])
    skills = {s["id"]: s for s in smap["skills"]}

    sdir = os.path.join(ROOT, "app/data/grammar/sentences")
    ids = skill_ids or sorted(
        os.path.splitext(n)[0] for n in os.listdir(sdir) if n.endswith(".json"))

    problems: list[str] = []
    exceptions: list[str] = []
    notes: list[str] = []
    seen_ids: dict[str, str] = {}
    rows = []

    for sid in ids:
        skill = skills.get(sid)
        if not skill:
            problems.append(f"{sid}: not in skills.json")
            continue
        chapter = skill["chapter"]
        try:
            with io.open(os.path.join(sdir, sid + ".json"), encoding="utf-8") as f:
                doc = json.load(f)
        except Exception as exc:                                  # noqa: BLE001
            problems.append(f"{sid}: sentences file unreadable — {exc}")
            continue
        try:
            lp = os.path.join(ROOT, "app/data/grammar/lessons", sid + ".json")
            with io.open(lp, encoding="utf-8") as f:
                lesson = json.load(f)
        except Exception as exc:                                  # noqa: BLE001
            problems.append(f"{sid}: lesson file unreadable — {exc}")
            continue

        if doc.get("skill") != sid:
            problems.append(f"{sid}: file's \"skill\" is {doc.get('skill')!r}")
        if doc.get("chapter") != chapter:
            problems.append(f"{sid}: chapter {doc.get('chapter')} != skills.json {chapter}")

        forms = allowed_forms(chapter, glossary)
        sents = doc.get("sentences") or []
        by_id = {}
        longest = 0
        for s in sents:
            sid_ = s.get("id")
            where = f"{sid}/{sid_}"
            if not sid_:
                problems.append(f"{sid}: a sentence has no id")
                continue
            if sid_ in by_id:
                problems.append(f"{where}: duplicate id inside the file")
            by_id[sid_] = s
            if sid_ in seen_ids:
                problems.append(f"{where}: id also used by {seen_ids[sid_]}")
            seen_ids[sid_] = sid

            la = s.get("la") or ""
            ws = words_of(la)
            longest = max(longest, len(ws))
            if s.get("words") != len(ws):
                problems.append(f"{where}: \"words\" {s.get('words')} but {len(ws)} printed")
            if not 5 <= len(ws) <= 8 and not s.get("note"):
                problems.append(f"{where}: {len(ws)} words and no note saying why")
            if not s.get("focus") or s["focus"] not in la:
                problems.append(f"{where}: focus {s.get('focus')!r} not verbatim in la")
            if s.get("stage") not in (1, 2, 3):
                problems.append(f"{where}: stage {s.get('stage')!r}")
            bad = [k for k in (s.get("kinds") or []) if k not in skill["kinds"]]
            if bad:
                problems.append(f"{where}: kinds {bad} not in the skill's kinds")
            gl = [g.get("w") for g in (s.get("gloss") or [])]
            if gl != ws:
                problems.append(f"{where}: gloss does not list every word in order")
            if any(not g.get("m") for g in (s.get("gloss") or [])):
                problems.append(f"{where}: a gloss entry has no meaning")

            for w in ws:
                lo = w.lower()
                if lo in forms:
                    continue
                if strip_macrons(lo) in NAMES:
                    exceptions.append(f"{where}: {w} — proper name of the book's cast")
                    continue
                if strip_macrons(lo) in FUNCTION_WORDS:
                    exceptions.append(f"{where}: {w} — the construction's own function word")
                    continue
                problems.append(
                    f"{where}: {w!r} is outside the cumulative vocabulary "
                    f"(chapters 1-{chapter}) and is not a name or function word")

        if len(sents) < 12:
            problems.append(f"{sid}: {len(sents)} sentences, fewer than twelve")

        teach = lesson.get("teach")
        if not teach:
            problems.append(f"{sid}: the lesson has no teach block")
            continue
        if not 4 <= len(teach) <= 6:
            problems.append(f"{sid}: {len(teach)} teach steps, not four to six")
        for k in ("core", "more", "sources"):
            if k not in lesson:
                problems.append(f"{sid}: the lesson lost its {k!r}")
        ns = [st.get("n") for st in teach]
        if ns != list(range(1, len(teach) + 1)):
            problems.append(f"{sid}: teach step numbers {ns}")
        steps_used = {s.get("step") for s in sents}
        for n in ns:
            if n not in steps_used:
                problems.append(f"{sid}: teach step {n} has no sentence of its own")
        for st in teach:
            n = st.get("n")
            where = f"{sid}/step {n}"
            for k in ("title", "say", "show", "check"):
                if not st.get(k):
                    problems.append(f"{where}: no {k!r}")
            show, chk = st.get("show") or {}, st.get("check") or {}
            refs = []
            if show.get("kind") == "sentence":
                refs.append(show.get("id"))
            if chk.get("kind") != "chart":
                refs.append(chk.get("sentence"))
            for r in refs:
                if r not in by_id:
                    problems.append(f"{where}: references sentence {r!r}, which does not exist")
            if show.get("kind") == "paradigm":
                key = show.get("key")
                if key not in pkeys:
                    problems.append(f"{where}: paradigm key {key!r} not in paradigm_keys")
                else:
                    have = cell_keys(key, glossary)
                    if have is None:
                        problems.append(f"{where}: paradigm {key!r} could not be built")
                    else:
                        cells = list(show.get("reveal") or [])
                        if chk.get("kind") == "chart":
                            cells += list(chk.get("cells") or [])
                        for c in cells:
                            if c not in have:
                                problems.append(
                                    f"{where}: cell {c!r} is not a cell of {key!r}")
            elif chk.get("kind") == "chart":
                problems.append(f"{where}: a chart check with no paradigm shown")
            if chk.get("kind") == "chart" and "chart" not in skill["kinds"]:
                notes.append(
                    f"{where}: a single-cell chart check on a skill whose generated "
                    f"drill kinds are {skill['kinds']} — the construction has no table "
                    f"of its own, but the noun's cell does, and §2 asks for the "
                    f"paradigm to be built one cell at a time")
        rows.append((sid, chapter, len(sents), len(teach), longest))

    # ------------------------------------------------------------- report
    print("skill                      ch  sentences  steps  longest")
    print("-" * 58)
    for sid, ch, n, st, lg in rows:
        print(f"{sid:26s} {ch:2d} {n:10d} {st:6d} {lg:8d}")
    print()
    if exceptions:
        print(f"{len(exceptions)} words allowed by rule rather than by deck:")
        agg = {}
        for e in exceptions:
            w = e.split(": ", 1)[1]
            agg[w] = agg.get(w, 0) + 1
        for w, c in sorted(agg.items()):
            print(f"  {c:3d}x  {w}")
        print()
    if notes:
        print(f"{len(notes)} notes:")
        for n in notes:
            print("  " + n)
        print()
    if problems:
        print(f"FAIL — {len(problems)} problems")
        for p in problems:
            print("  " + p)
        return 1
    print("PASS — JSON valid; every word inside the cumulative vocabulary or an")
    print("allowed name or function word; every sentence five to eight words;")
    print("every focus verbatim in its la; every sentence id unique; every step")
    print("reference resolved; every paradigm key and cell valid.")
    return 0


if __name__ == "__main__":
    sys.exit(check(sys.argv[1:] or None))
