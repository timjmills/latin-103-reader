"""Validator for the two teach-step additions of GRAMMAR-CONTRACT.md section 8,
over the tense and comparison skills of cap. XIX-XX.

Contract: docs/GRAMMAR-CONTRACT.md, "## 8. Teach-step schema, completed (2026-09-10)".

Same rules as pipeline/check_teach_words_worked.py and _perfect.py, with the
three things this batch needs:

  * **A paradigm key that is a group, not a table.**  irregular-comparison's
    step 2 drills `adjcomp`, which paradigms.json's `keys` maps to the `comp`
    group inside six adjective tables (section 4a: no glossary entry renders
    ADJ_COMP as a table of its own).  The key is resolved through `keys`, the
    cells are the union of those tables' cells, and the stock list is the
    union of their stock words.

  * **Every chart word must render every cell it is asked on.**  Driven
    through pipeline/latin_forms.paradigm() and the section 4a id scheme, so
    a word the table lists as stock but that has no such form (*multus* has
    no `comp.nom.sg.m`) is refused.

  * **The intended reading only.**  A form's parses come from the glossary's
    own `parses` unioned with pipeline/latin_forms.forms over every headword
    (the forms the library never prints: *vocābantur*, *ībat*, *erō* ...), and
    are then filtered by the skill's own `parse_filter`, so *pēius* the adverb
    cannot borrow `case` from *pēius* the adjective, and one single reading
    must carry every feature a worked example names.

Checks, per skill, over app/data/grammar/lessons/<skill>.json:

  A. chart `words`
     * the lesson file is valid JSON with a `teach` list
     * every chart check names a key (its own `key`, else the step's
       `show.key`) that paradigms.json resolves
     * every cell id in a chart check is in the resolved cell list
     * every lemma in `words` is in the resolved stock list, renders every
       cell of the check, and is not repeated
     * a chart check with no `words` is reported with the stock list it
       therefore falls back to

  B. `worked`
     * the sentence id exists in app/data/grammar/sentences/<skill>.json
     * that sentence's `focus` occurs verbatim in its `la`
     * every feature in `given` / `ask` is a parse feature the focus word
       really has under the skill's parse_filter, in one single reading, or
       the literal "why" (allowed in `ask` only)
     * no feature is named in both `given` and `ask`, and none is repeated
     * the first worked example of the skill asks nothing
     * `ask` grows: every later one asks strictly more than the one before
     * "why" is asked at least once per skill

Usage:  PYTHONIOENCODING=utf-8 python pipeline/check_teach_words_worked_ch19_20.py [skill ...]
"""

from __future__ import annotations

import json
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import latin_forms as LF  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
GRAM = ROOT / "app" / "data" / "grammar"

DEFAULT_SKILLS = [
    "imperfect-active",
    "imperfect-passive",
    "imperfect-irregular",
    "irregular-comparison",
    "future-active",
    "future-passive",
    "noli-infinitive",
    "future-irregular",
]

FEATURES = ("degree", "tense", "mood", "voice", "person", "case", "number", "gender")
FEATURE_SET = set(FEATURES)


def fold(s: str) -> str:
    """The glossary's key form: macrons off, lower case, no edge punctuation."""
    bare = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return bare.lower().strip(".,;:!?()[]—–-")


def load(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


# ------------------------------------------------------------------ authorities
CAT = load(GRAM / "paradigms.json")
GLOSSARY = load(ROOT / "app" / "data" / "glossary.json")
HEADWORDS = load(ROOT / "app" / "data" / "glossary-headwords.json")
SKILLS_DOC = load(GRAM / "skills.json")
SKILL_ROWS = SKILLS_DOC["skills"] if isinstance(SKILLS_DOC, dict) else SKILLS_DOC
FILTERS = {s["id"]: s.get("parse_filter") for s in SKILL_ROWS}

TABLE = {t["id"]: t for part in CAT["parts"] for t in part["tables"]}
SLOT_ORDER = CAT["id_scheme"]["slot_order"]

BY_HEADWORD: dict[str, list] = {}
for _h, _pos, _key, _i in HEADWORDS["headwords"]:
    _ents = GLOSSARY.get(_key or _h, [])
    if _i < len(_ents):
        BY_HEADWORD.setdefault(_h, []).append(_ents[_i])


def resolve_key(key: str):
    """(tables, cells, stock) a teach step's paradigm key names — a table id,
    or one of skills.json's keys that paradigms.json maps to a group."""
    spec = CAT["keys"].get(key)
    ids = (spec or {}).get("tables") or ([key] if key in TABLE else [])
    group = (spec or {}).get("group")
    tables = [TABLE[i] for i in ids if i in TABLE]
    cells: set[str] = set()
    for t in tables:
        for g in t["groups"]:
            if group and g["id"] != group:
                continue
            for c in g["cells"]:
                cells.add(c if isinstance(c, str) else c["id"])
    stock: list[str] = []
    for t in tables:
        for s in t["stock"]:
            if s["h"] not in stock:
                stock.append(s["h"])
    return tables, cells, stock


def cell_id(key: dict, table_kind: str) -> str:
    """The catalogue id of one paradigm cell, from its own key (section 4a)."""
    if key.get("kind") == "gerundive":
        return "gerundive"
    slots = {s: key.get(s) for s in SLOT_ORDER}
    if key.get("kind") == "nominal" and table_kind == "noun":
        slots["gender"] = None
    if key.get("kind") == "imper" and not slots["tense"]:
        slots["tense"] = "pres"
    body = [str(slots[s]) for s in SLOT_ORDER if slots[s]]
    if key.get("kind") in ("nominal", "finite"):
        return ".".join(body)
    return ".".join([key["kind"]] + body)


def cell_form(headword: str, cid: str) -> list[str]:
    """What `headword` prints in cell `cid` — [] when it renders no such cell."""
    out = []
    for e in BY_HEADWORD.get(headword, []):
        try:
            p = LF.paradigm(e)
        except Exception:  # noqa: BLE001
            continue
        if not p:
            continue
        for section in p["sections"]:
            for row in section["rows"]:
                for c in row["cells"]:
                    if c.get("empty") or not c.get("key"):
                        continue
                    if cell_id(c["key"], p["kind"]) == cid:
                        out.append(c.get("text"))
    return out


_FORMS: dict[str, list] | None = None


def readings(form: str) -> list[tuple[dict, dict]]:
    """Every (entry, parse) either authority gives `form`."""
    global _FORMS
    if _FORMS is None:
        idx: dict[str, list] = {}
        for entries in BY_HEADWORD.values():
            for e in entries:
                try:
                    generated = LF.forms(e, include_multiword=True)
                except Exception:  # noqa: BLE001
                    continue
                for f, p in generated:
                    idx.setdefault(fold(f), []).append((e, p))
        for key, entries in GLOSSARY.items():
            for e in entries:
                for p in e.get("parses") or []:
                    idx.setdefault(fold(key), []).append((e, p))
        _FORMS = idx
    return _FORMS.get(fold(form), [])


def matches_filter(entry: dict, parse: dict, filt) -> bool:
    """The skill's own parse_filter (a dict, or a list of dicts any of which
    may match), so the *intended* reading is the one checked."""
    if filt is None:
        return True
    if isinstance(filt, list):
        return any(matches_filter(entry, parse, f) for f in filt)
    for key, want in filt.items():
        want = want if isinstance(want, list) else [want]
        if key == "pos":
            got = entry.get("pos")
            if got == "VPAR":
                got = "V"
        elif key == "h":
            got = entry.get("h")
        elif key == "decl":
            cat = entry.get("cat") or []
            got = cat[0] if cat else None
        elif key == "conj":
            cat = entry.get("cat") or []
            got = cat[1] if len(cat) > 1 else None
        elif key == "gender":
            got = parse.get("gender") or entry.get("gender")
        else:
            got = parse.get(key)
        if got is None or str(got) not in [str(w) for w in want]:
            return False
    return True


def main(argv):
    skills = [a for a in argv if not a.startswith("-")] or DEFAULT_SKILLS
    errors: list[str] = []
    lines: list[str] = []
    n_chart = n_worked = n_words = 0

    for skill in skills:
        lesson_path = GRAM / "lessons" / (skill + ".json")
        sent_path = GRAM / "sentences" / (skill + ".json")
        try:
            lesson = load(lesson_path)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{skill}: lesson JSON invalid: {exc}")
            continue
        try:
            sentences = {s["id"]: s for s in load(sent_path)["sentences"]}
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{skill}: sentences JSON invalid: {exc}")
            continue
        if not isinstance(lesson.get("teach"), list):
            errors.append(f"{skill}: lesson has no `teach` list")
            continue

        lines.append(skill)
        filt = FILTERS.get(skill)
        worked_seen = []

        for step in lesson["teach"]:
            n = step.get("n")
            where = f"{skill} step {n}"
            check = step.get("check") or {}
            show = step.get("show") or {}

            # ---- A. chart words
            if check.get("kind") == "chart":
                n_chart += 1
                key = check.get("key") or show.get("key")
                tables, cells, stock = resolve_key(key or "")
                if not tables:
                    errors.append(f"{where}: chart check names no known table or key (got {key!r})")
                    continue
                for cell in check.get("cells") or []:
                    if cell not in cells:
                        errors.append(f"{where}: cell {cell!r} is not in {key!r}")
                words = check.get("words")
                cells_txt = ", ".join(check.get("cells") or [])
                if words is None:
                    lines.append(
                        f"  step {n} chart {key}[{cells_txt}]"
                        f"  words omitted -> stock {', '.join(stock)}"
                    )
                else:
                    n_words += 1
                    if not isinstance(words, list) or not words:
                        errors.append(f"{where}: words must be a non-empty list; omit it to mean the stock list")
                        words = []
                    if len(set(words)) != len(words):
                        errors.append(f"{where}: words repeats a lemma: {words}")
                    for w in words:
                        if w not in stock:
                            errors.append(
                                f"{where}: {w!r} is not stock for {key!r} (stock: {', '.join(stock)})"
                            )
                            continue
                        for cell in check.get("cells") or []:
                            if cell in cells and not cell_form(w, cell):
                                errors.append(f"{where}: {w!r} renders no {cell}")
                    rendered = []
                    for w in words:
                        forms = [(cell_form(w, c) or ["?"])[0] for c in check.get("cells") or []]
                        rendered.append(f"{w} ({', '.join(forms)})")
                    lines.append(
                        f"  step {n} chart {key}[{cells_txt}]  words {'; '.join(rendered)}"
                    )

            # ---- B. worked
            worked = step.get("worked")
            if worked is None:
                continue
            n_worked += 1
            sid = worked.get("sentence")
            sent = sentences.get(sid)
            if sent is None:
                errors.append(f"{where}: worked sentence {sid!r} is not in {sent_path.name}")
                continue
            focus = sent.get("focus") or ""
            if not focus or focus not in sent.get("la", ""):
                errors.append(f"{where}: focus {focus!r} does not occur in {sid} la")
            given = list(worked.get("given") or [])
            ask = list(worked.get("ask") or [])
            if "why" in given:
                errors.append(f"{where}: 'why' may only be asked, never given")
            named_list = [f for f in given + ask if f != "why"]
            if len(set(named_list)) != len(named_list):
                errors.append(f"{where}: a feature is named twice: given={given} ask={ask}")
            bad = [f for f in named_list if f not in FEATURE_SET]
            if bad:
                errors.append(f"{where}: not parse features: {bad}")
            named = set(named_list) & FEATURE_SET
            all_readings = readings(focus)
            intended = [(e, p) for e, p in all_readings if matches_filter(e, p, filt)]
            have = {k for _, p in intended for k, v in p.items() if k in FEATURE_SET and v is not None}
            if not all_readings:
                errors.append(f"{where}: no authority parses focus {focus!r} ({sid})")
            elif not intended:
                errors.append(f"{where}: no reading of {focus!r} matches the skill's parse_filter {filt}")
            elif not any(named <= {k for k, v in p.items() if v is not None} for _, p in intended):
                errors.append(
                    f"{where}: no single intended reading of {focus!r} carries {sorted(named)} "
                    f"(features it really has here: {', '.join(f for f in FEATURES if f in have) or 'none'})"
                )
            else:
                heads = sorted({e.get("h") for e, _ in intended})
                slots = "+".join(f for f in FEATURES if f in have)
                lines.append(
                    f"  step {n} worked {sid} focus {focus} [{'/'.join(heads)}, carries {slots}, "
                    f"{len(intended)} of {len(all_readings)} readings in this skill]"
                    f"  given {given or '-'} ask {ask or '-'}"
                )
            worked_seen.append((n, sid, given, ask))

        # ---- per-skill worked rules
        if worked_seen:
            first_n, first_sid, _, first_ask = worked_seen[0]
            if first_ask:
                errors.append(
                    f"{skill}: the first worked example (step {first_n}, {first_sid}) "
                    f"asks {first_ask}; it must be shown fully"
                )
            sizes = [len(a) for _, _, _, a in worked_seen]
            for i in range(1, len(sizes)):
                if sizes[i] <= sizes[i - 1]:
                    errors.append(
                        f"{skill}: worked example {i + 1} (step {worked_seen[i][0]}) asks "
                        f"{sizes[i]}, not more than the {sizes[i - 1]} before it"
                    )
            if not any("why" in a for _, _, _, a in worked_seen):
                errors.append(f"{skill}: 'why' is never asked")
        else:
            lines.append("  (no worked examples)")

    print("\n".join(lines))
    print()
    print(
        f"{len(skills)} skills - {n_chart} chart checks ({n_words} with words, "
        f"{n_chart - n_words} on the table's stock order) - {n_worked} worked examples"
    )
    if errors:
        print()
        print(f"{len(errors)} PROBLEMS")
        for e in errors:
            print("  " + e)
        return 1
    print("OK - no problems")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
