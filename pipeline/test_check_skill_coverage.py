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
NOT_YET_BUILT = {}

#: The pilot's eight (§11a): the table-class ones pass row 3 on their tables
#: and on their generator; the sentence-class ones on the generator alone.
#: ablative-absolute and purpose-clause are not listed: their review records
#: land with the templates agent's work, and until then they fail row 3.
PILOT_TABLE = ["accusative-object", "ablative-means", "ablative-agent",
               "dative-indirect-object", "perfect-active"]
PILOT_SENTENCE = ["accusative-infinitive"]

SKILL = {"id": "x", "chapter": 3, "category": "syntax", "paradigms": []}
REVIEW = {"passes": [{"pass": 1, "generated": 40, "rejected": 2, "rate": 0.05, "causes": ["x"]}],
          "final_rate": 0.02}


def _templates(la="{s:nom} {ab} {ag:abl} {v:pres.ind.pass} venit.", review=REVIEW, n=5):
    t = {"id": "x-t1", "la": la, "en": "{s} is {v} by {ag}.",
         "slots": {"s": {"sem": ["person"]}, "ag": {"sem": ["person"]},
                   "v": {"pos": "V", "form": "pres.ind.pass", "subj": "s", "agent": "ag"}},
         "focus": "ag", "words": 5}
    ts = [dict(t, id=f"x-t{i + 1}") for i in range(n)]
    out = {"skill": "x", "chapter": 3, "templates": ts, "exclude": []}
    if review is not None:
        out["review"] = review
    return out


def _bank(n=csc.MIN_BANK):
    s = {"id": "x-t1-0", "la": "Iūlius ā servō vocātur.", "en": "Julius is called by the slave.",
         "words": 4, "focus": "servō", "gloss": [{"w": "Iūlius", "m": "Julius"}],
         "generated": True, "template": "x-t1", "seed": 1, "fill": {}}
    return {"skill": "x", "chapter": 3, "seeds": [1], "count": n,
            "sentences": [dict(s, id=f"x-t1-{i}") for i in range(n)]}


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


def test_row_3_accepts_the_generators_own_ab_slot():
    """`{ab}` prints ā / ab by the next sound (§11a): the generator's own slot,
    never declared — aci-t4 and aci-t10 use it."""
    status, why = csc.row_3(None, SKILL, "sentence", None, None, _templates(), _bank())
    assert status == csc.PASS, why
    status, why = csc.row_3(None, SKILL, "sentence", None, None,
                            _templates(la="{s:nom} {ab} {ag:abl} {zz:acc} {v:pres.ind.pass}."), _bank())
    assert status == csc.FAIL and "['zz']" in why and "'ab'" not in why


def test_row_3_wants_the_review_record_in_its_exact_shape():
    ok = lambda tpl: csc.row_3(None, SKILL, "sentence", None, None, tpl, _bank())  # noqa: E731
    assert ok(_templates())[0] == csc.PASS
    status, why = ok(_templates(review=None))
    assert status == csc.FAIL and '"review"' in why
    # The old loose keys are not a record.
    tpl = _templates(review=None)
    tpl["reviewed"] = True
    assert ok(tpl)[0] == csc.FAIL
    assert ok(_templates(review={"passes": [], "final_rate": 0.01}))[1].count("passes") == 1
    assert ok(_templates(review={"passes": [{"pass": 1}], "final_rate": 0.051}))[0] == csc.FAIL
    assert ok(_templates(review={"passes": [{"pass": 1}], "final_rate": 0.05}))[0] == csc.PASS
    assert ok(_templates(review={"passes": [{"pass": 1}]}))[0] == csc.FAIL
    assert ok(_templates(review={"passes": [{"pass": 1}], "final_rate": "0.01"}))[0] == csc.FAIL


def test_rows_3_and_5_want_a_generated_bank_of_at_least_100():
    sents = {"skill": "x", "chapter": 3, "sentences": [{"id": f"x-{i}"} for i in range(csc.MIN_SENTENCES)]}
    for row in (csc.row_3, csc.row_5):
        status, why = row(None, SKILL, "sentence", None, sents, _templates(), _bank())
        assert status == csc.PASS, why
        assert "bank of 100" in why
        status, why = row(None, SKILL, "sentence", None, sents, _templates(), None)
        assert status == csc.FAIL and "build_generated.py" in why
        status, why = row(None, SKILL, "sentence", None, sents, _templates(), _bank(99))
        assert status == csc.FAIL and "99" in why
        status, why = row(None, SKILL, "sentence", None, sents, _templates(), {"__error__": "boom"} if row is csc.row_3 else _bank(0))
        assert status == csc.FAIL
    # A bank of the right size but with a broken sentence fails row 3 (row 5 counts only).
    bank = _bank()
    bank["sentences"][3] = {"id": "x-t1-3", "la": "Iūlius vocātur."}
    status, why = csc.row_3(None, SKILL, "sentence", None, sents, _templates(), bank)
    assert status == csc.FAIL and "x-t1-3" in why
    bank = _bank()
    bank["skill"] = "y"
    assert csc.row_3(None, SKILL, "sentence", None, sents, _templates(), bank)[0] == csc.FAIL


def test_the_pilot_skills_pass_rows_3_and_5_on_the_committed_data(results):
    """The eight pilot skills' templates and banks (§11a, §11b) are on disk and
    whole — the banks regenerated by pipeline/build_generated.py after any
    change to a templates file."""
    for sid in PILOT_TABLE + PILOT_SENTENCE:
        rows = results[sid]["rows"]
        assert rows["3"][0] == csc.PASS, (sid, rows["3"][1])
        assert "bank of" in rows["3"][1], (sid, rows["3"][1])
        assert rows["5"][0] == csc.PASS, (sid, rows["5"][1])
    for sid in PILOT_SENTENCE:
        assert results[sid]["class"] == "sentence"
    for sid in PILOT_TABLE:
        assert results[sid]["class"] == "table"


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
