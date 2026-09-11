# -*- coding: utf-8 -*-
"""Every skill, enforced — pipeline/check_skill_coverage.py under pytest
(GRAMMAR-CONTRACT.md §13).

    python -m pytest pipeline/test_check_skill_coverage.py -q

The check must run, classify all 88 skills, and find exactly three lesson-only
skills.  Then every cell of §13's table (a row × a class) is a test of its own:
no skill of that class may fail that row.  The cells the build has not reached
yet are marked expected-fail here, each naming the row and what is still
missing, and the marks are strict — the day a cell passes, its mark has to
come off, so the map of what is built stays true.
"""
from __future__ import annotations

import io
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import check_skill_coverage as csc  # noqa: E402

SKILLS = 88
LESSON_ONLY = {"elegiac-couplet", "prosody-scansion", "principal-parts"}

#: (row, class) → why the build has not reached it yet.  Strict: an unexpected
#: pass fails the suite until the entry is removed.
NOT_YET_BUILT = {
    ("1d", "table"): "row 1d completed worked examples: adverbs carries two worked "
                     "examples, one short of the three §8 asks for",
    ("2", "table"): "row 2 written sentences: future-imperative's fim-09 prints Mementō, "
                    "which no deck to chapter 33 teaches (validate_teaching.py agrees)",
    ("2", "lesson-only"): "row 2 written sentences: elegiac-couplet's line ec-01 prints "
                          "rīdetque, and -que is not that skill's own function word "
                          "(validate_teaching.py agrees)",
    ("3", "table"): "row 3 unlimited practice: ablative-degree and adverbs name no "
                    "paradigm table in skills.json",
    ("3", "sentence"): "row 3 unlimited practice: no sentence skill has a templates file "
                       "yet (app/data/grammar/templates/<skill>.json, §11)",
    ("4", "table"): "row 4 scaffolded table: ablative-degree and adverbs name no "
                    "catalogue table to scaffold",
    ("5", "table"): "row 5 mixed practice / axes: ablative-degree and adverbs name no "
                    "catalogue table with axes",
    ("5", "sentence"): "row 5 mixed practice / axes: the generated set needs the "
                       "templates of row 3",
    ("7", "table"): "row 7 re-test / just drill / two-tap / tie-in: ablative-degree and "
                    "adverbs have no catalogue table with stock words to drill",
}


@pytest.fixture(scope="module")
def results():
    return csc.run()


def test_the_check_runs_over_all_88_skills(results):
    assert len(results) == SKILLS
    for r in results.values():
        assert r["class"] in csc.CLASSES
        assert list(r["rows"]) == csc.ROW_IDS
        for status, why in r["rows"].values():
            assert status in (csc.PASS, csc.FAIL, csc.APP, csc.NA)
            assert isinstance(why, str)
            if status == csc.FAIL:
                assert why, f"{r['id']} fails a row with no reason given"


def test_every_skill_is_classified_once(results):
    classes = csc.summarise(results)["classes"]
    assert sum(classes.values()) == SKILLS
    assert set(classes) <= set(csc.CLASSES)


def test_the_lesson_only_skills_are_exactly_three(results):
    assert {sid for sid, r in results.items() if r["class"] == "lesson-only"} == LESSON_ONLY
    assert set(csc.LESSON_ONLY) == LESSON_ONLY


def test_a_lesson_only_skill_states_why_it_is_excused(results):
    for sid in LESSON_ONLY:
        status, why = results[sid]["rows"]["3"]
        assert status == csc.PASS, why
        assert why.startswith("excused")
        assert any(n.startswith("lesson-only:") for n in results[sid]["notes"])


def test_a_lesson_only_skill_has_no_table_rows(results):
    for sid in LESSON_ONLY:
        rows = results[sid]["rows"]
        for rid in ("4", "5", "6"):
            assert rows[rid][0] == csc.NA
        assert rows["7"][0] in (csc.APP, csc.FAIL)


def test_app_side_rows_are_reported_not_asserted(results):
    """Rows 4, 6 and 7 concern the app: the data can only be checked as far as it
    goes, so no skill passes them outright — each is app (data in place) or a
    FAIL with a reason, or n/a for the class."""
    for r in results.values():
        for rid in ("4", "6", "7"):
            assert r["rows"][rid][0] != csc.PASS, (r["id"], rid)


@pytest.mark.parametrize("row", csc.ROW_IDS)
@pytest.mark.parametrize("cls", csc.CLASSES)
def test_no_skill_fails_the_row(request, results, row, cls):
    reason = NOT_YET_BUILT.get((row, cls))
    if reason:
        request.node.add_marker(pytest.mark.xfail(reason=reason, strict=True))
    failing = [(r["id"], r["rows"][row][1]) for r in results.values()
               if r["class"] == cls and r["rows"][row][0] == csc.FAIL]
    name = dict((a, b) for a, b, _ in csc.ROWS)[row]
    assert not failing, f"row {row} {name}, {cls} skills: " + "; ".join(
        f"{sid}: {why}" for sid, why in failing)


def test_the_first_stock_word_is_taught_by_the_tables_chapter():
    """§4a stock words per chapter: the check reads the committed catalogue and
    holds every table a skill names to it (row 3)."""
    ctx = csc.Ctx()
    for t in ctx.tables.values():
        first = (t.get("stock") or [None])[0]
        if first and t.get("chapter"):
            assert first.get("chapter") and first["chapter"] <= t["chapter"], \
                f"{t['id']}: {first['h']} chapter {first.get('chapter')} > {t['chapter']}"


def test_the_matrix_prints_every_skill():
    out = io.StringIO()
    with redirect_stdout(out):
        code = csc.main(["--matrix"])
    text = out.getvalue()
    assert code in (0, 1)
    rows = [ln for ln in text.splitlines() if ln.startswith("| ") and not ln.startswith("| skill")]
    assert len(rows) == SKILLS
    assert "| principal-parts | lesson-only |" in text


def test_one_skill_prints_every_row():
    out = io.StringIO()
    with redirect_stdout(out):
        code = csc.main(["--skill", "principal-parts"])
    text = out.getvalue()
    assert code == 0, text
    for rid, name, _ in csc.ROWS:
        assert f"row {rid} {name}" in text
    out = io.StringIO()
    with redirect_stdout(out):
        assert csc.main(["--skill", "no-such-skill"]) == 2


def test_exit_status_is_nonzero_while_any_row_fails(results):
    s = csc.summarise(results)
    out = io.StringIO()
    with redirect_stdout(out):
        code = csc.main([])
    assert code == (1 if s["failing"] else 0)
