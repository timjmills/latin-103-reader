#!/usr/bin/env python
"""
tests for pipeline/latin_forms.py.

  1. the tables of Ørberg's *Grammatica Latina* (Familia Romana, appendix),
     one lemma per class, written out by hand here;
  2. parity with app/js/paradigms.js, cell for cell, over the whole glossary;
  3. every form app/data/glossary.json already attests, with the same parse.

    python -m pytest tests/latin_forms -q
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import latin_forms as lf          # noqa: E402
from macrons import strip_macrons  # noqa: E402
import parity                     # noqa: E402
import attestation                # noqa: E402

CASES = ["nom", "gen", "dat", "acc", "abl", "voc"]


def E(lemma, roots, pos, cat, gender=None, kind=None, h=None):
    return {"lemma": lemma, "roots": roots, "pos": pos, "cat": cat, "gender": gender,
            "kind": kind, "h": h or strip_macrons(lemma.split()[0].split(",")[0]).lower()}


def cases(entry, num, want_voc=True):
    """{case: form} for one number, from the generated forms."""
    out = {}
    for f, p in lf.forms(entry):
        if p.get("number") != num or p.get("mood") or "case" not in p:
            continue
        out.setdefault(p["case"], set()).add(f)
    return out


def has(entry, form, **parse):
    for f, p in lf.forms(entry):
        if f != form:
            continue
        if all(str(p.get(k)) == str(v) for k, v in parse.items()):
            return True
    return False


def decl(entry, num):
    """The six cases in Ørberg's order, as a list of the generated spellings."""
    c = cases(entry, num)
    return [sorted(c.get(k, set())) for k in CASES]


# --------------------------------------------------------------------- nouns

NOUNS = {
    # Grammatica Latina I–V.  [sg nom gen dat acc abl voc], [pl …]
    "1st declension (īnsula)": (
        E("īnsula -ae f", ["īnsul", "īnsul"], "N", [1, 1], "f"),
        ["īnsula", "īnsulae", "īnsulae", "īnsulam", "īnsulā", "īnsula"],
        ["īnsulae", "īnsulārum", "īnsulīs", "īnsulās", "īnsulīs", "īnsulae"]),
    "2nd declension m (servus)": (
        E("servus -ī m", ["serv", "serv"], "N", [2, 1], "m"),
        ["servus", "servī", "servō", "servum", "servō", "serve"],
        ["servī", "servōrum", "servīs", "servōs", "servīs", "servī"]),
    "2nd declension n (verbum)": (
        E("verbum -ī n", ["verb", "verb"], "N", [2, 2], "n"),
        ["verbum", "verbī", "verbō", "verbum", "verbō", "verbum"],
        ["verba", "verbōrum", "verbīs", "verba", "verbīs", "verba"]),
    "2nd declension -er (puer)": (
        E("puer -ī m", ["puer", "puer"], "N", [2, 3], "m"),
        ["puer", "puerī", "puerō", "puerum", "puerō", "puer"],
        ["puerī", "puerōrum", "puerīs", "puerōs", "puerīs", "puerī"]),
    "2nd declension -er (liber, librī)": (
        E("liber librī m", ["liber", "libr"], "N", [2, 3], "m"),
        ["liber", "librī", "librō", "librum", "librō", "liber"],
        ["librī", "librōrum", "librīs", "librōs", "librīs", "librī"]),
    "3rd declension consonant stem (pāstor)": (
        E("pāstor pāstōris m", ["pāstor", "pāstōr"], "N", [3, 1], "m"),
        ["pāstor", "pāstōris", "pāstōrī", "pāstōrem", "pāstōre", "pāstor"],
        ["pāstōrēs", "pāstōrum", "pāstōribus", "pāstōrēs", "pāstōribus", "pāstōrēs"]),
    "3rd declension i-stem (nāvis)": (
        E("nāvis -is f", ["nāvis", "nāv"], "N", [3, 3], "f"),
        ["nāvis", "nāvis", "nāvī", "nāvem", "nāve", "nāvis"],
        ["nāvēs", "nāvium", "nāvibus", "nāvēs", "nāvibus", "nāvēs"]),
    "3rd declension neuter i-stem (mare)": (
        E("mare -is n", ["mare", "mar"], "N", [3, 4], "n"),
        ["mare", "maris", "marī", "mare", "marī", "mare"],
        ["maria", "marium", "maribus", "maria", "maribus", "maria"]),
    "3rd declension neuter (nōmen)": (
        E("nōmen nōminis n", ["nōmen", "nōmin"], "N", [3, 2], "n"),
        ["nōmen", "nōminis", "nōminī", "nōmen", "nōmine", "nōmen"],
        ["nōmina", "nōminum", "nōminibus", "nōmina", "nōminibus", "nōmina"]),
    "4th declension (exercitus)": (
        E("exercitus -ūs m", ["exercit", "exercit"], "N", [4, 1], "m"),
        ["exercitus", "exercitūs", "exercituī", "exercitum", "exercitū", "exercitus"],
        ["exercitūs", "exercituum", "exercitibus", "exercitūs", "exercitibus", "exercitūs"]),
    "4th declension neuter (cornū)": (
        E("cornū -ūs n", ["corn", "corn"], "N", [4, 2], "n"),
        ["cornū", "cornūs", "cornū", "cornū", "cornū", "cornū"],
        ["cornua", "cornuum", "cornibus", "cornua", "cornibus", "cornua"]),
    "5th declension (rēs)": (
        E("rēs reī f", ["rēs", "r"], "N", [5, 1], "f"),
        ["rēs", "reī", "reī", "rem", "rē", "rēs"],
        ["rēs", "rērum", "rēbus", "rēs", "rēbus", "rēs"]),
    "5th declension after a vowel (diēs)": (
        E("diēs diēī m", ["diēs", "di"], "N", [5, 1], "m"),
        ["diēs", "diēī", "diēī", "diem", "diē", "diēs"],
        ["diēs", "diērum", "diēbus", "diēs", "diēbus", "diēs"]),
}


@pytest.mark.parametrize("name", sorted(NOUNS))
def test_noun_tables(name):
    entry, sg, pl = NOUNS[name]
    for num, want in (("sg", sg), ("pl", pl)):
        got = decl(entry, num)
        for i, c in enumerate(CASES):
            assert want[i] in got[i], f"{name} {c} {num}: want {want[i]}, got {got[i]}"


def test_ius_ium_genitive():
    """fīlius → gen. fīliī / fīlī, voc. fīlī; the -ium noun keeps its plural."""
    filius = E("fīlius -ī m", ["fīli", "fīli"], "N", [2, 5], "m", h="filius")
    idx = lf.form_index(filius)
    assert "fīlius" in idx and "fīlium" in idx and "fīliōs" in idx
    assert "fīliī" in idx and "fīlī" in idx
    assert has(filius, "fīlī", case="voc", number="sg")
    assert has(filius, "fīlī", case="gen", number="sg")
    gaudium = E("gaudium -ī n", ["gaudi", "gaudi"], "N", [2, 4], "n", h="gaudium")
    idx = lf.form_index(gaudium)
    for f in ("gaudium", "gaudiī", "gaudī", "gaudiō", "gaudia", "gaudiōrum", "gaudiīs"):
        assert f in idx, f


# ---------------------------------------------------------------- adjectives

def test_adjective_1_2():
    e = E("magnus -a -um", ["magn", "magn", "mai", "maxi"], "ADJ", [1, 1])
    idx = lf.form_index(e)
    for f in ("magnus", "magna", "magnum", "magnī", "magnae", "magnō", "magnam", "magnā",
              "magne", "magnōrum", "magnārum", "magnīs", "magnōs", "magnās"):
        assert f in idx, f
    assert has(e, "maior", degree="comp", case="nom", number="sg", gender="m")
    assert has(e, "maius", degree="comp", case="nom", number="sg", gender="n")
    assert has(e, "maximus", degree="super", case="nom", number="sg", gender="m")


def test_adjective_1_2_er():
    e = E("pulcher pulchra pulchrum", ["pulcher", "pulchr", "pulchri", "pulcherri"], "ADJ", [1, 2])
    idx = lf.form_index(e)
    for f in ("pulcher", "pulchra", "pulchrum", "pulchrī", "pulchrae", "pulchrō",
              "pulchrior", "pulchrius", "pulcherrimus", "pulcherrimē"):
        assert f in idx, f


def test_adjective_3_two_terminations():
    e = E("brevis -e", ["brevis", "brev", "brevi", "brevissi"], "ADJ", [3, 2])
    idx = lf.form_index(e)
    want = ["brevis", "breve", "brevem", "brevī", "brevēs", "brevia", "brevium", "brevibus",
            "brevior", "brevius", "breviōrem", "breviōris", "brevissimus", "brevissima",
            "breviter", "brevissimē"]
    for f in want:
        assert f in idx, f


def test_adjective_3_one_termination():
    e = E("fēlīx (gen. fēlīcis)", ["fēlīx", "fēlīc", "fēlīci", "fēlīcissi"], "ADJ", [3, 1], h="felix")
    idx = lf.form_index(e)
    for f in ("fēlīx", "fēlīcis", "fēlīcī", "fēlīcem", "fēlīcēs", "fēlīcia", "fēlīcium",
              "fēlīcior", "fēlīcissimus", "fēlīciter"):
        assert f in idx, f
    assert has(e, "fēlīx", case="nom", number="sg", gender="n")


def test_adjective_3_three_terminations():
    e = E("ācer ācris ācre", ["ācer", "ācr", "ācri", "ācerri"], "ADJ", [3, 3], h="acer")
    idx = lf.form_index(e)
    for f in ("ācer", "ācris", "ācre", "ācrem", "ācrī", "ācrēs", "ācria", "ācrium",
              "ācrior", "ācerrimus"):
        assert f in idx, f
    assert has(e, "ācer", case="nom", number="sg", gender="m")
    assert has(e, "ācris", case="nom", number="sg", gender="f")
    assert has(e, "ācre", case="nom", number="sg", gender="n")


def test_adjective_ius_genitive():
    e = E("sōlus -a -um (gen. -īus)", ["sōl", "sōl"], "ADJ", [1, 3], h="solus")
    assert has(e, "sōlīus", case="gen", number="sg", gender="m")
    assert has(e, "sōlī", case="dat", number="sg", gender="f")


def test_adjective_with_a_fixed_que():
    """uterque and plērīque are one word with -que welded on; the glossary keeps
    only the bare stem (uter- / utr-, plēr-), so the table hangs -que back on
    every cell.  Allen & Greenough §151.a (uterque, utrīusque, utrīque) and
    §151.b (plērīque, plēraeque, plēraque, plērōrumque); Ørberg lists uterque
    among the prōnōmina indēfīnīta in cap. XXXV but prints no table."""
    uterque = E("uterque, utraque, utrumque", ["uter", "utr"], "ADJ", [1, 4], h="uterque")
    for f, parse in (
            ("uterque", dict(case="nom", number="sg", gender="m")),
            ("utraque", dict(case="nom", number="sg", gender="f")),
            ("utrumque", dict(case="nom", number="sg", gender="n")),
            ("utrīusque", dict(case="gen", number="sg", gender="m")),
            ("utrīque", dict(case="dat", number="sg", gender="f")),
            ("utramque", dict(case="acc", number="sg", gender="f")),
            ("utrōque", dict(case="abl", number="sg", gender="m")),
            ("utrōrumque", dict(case="gen", number="pl", gender="m")),
            ("utrīsque", dict(case="abl", number="pl", gender="n"))):
        assert has(uterque, f, **parse), f
    assert "uter" not in lf.form_index(uterque)

    plerique = E("plērīque, plēraeque, plēraque", ["plēr", "plēr"], "ADJ", [1, 1], h="plerique")
    for f, parse in (
            ("plērīque", dict(case="nom", number="pl", gender="m")),
            ("plēraeque", dict(case="nom", number="pl", gender="f")),
            ("plēraque", dict(case="nom", number="pl", gender="n")),
            ("plērōrumque", dict(case="gen", number="pl", gender="m")),
            ("plērīsque", dict(case="dat", number="pl", gender="f")),
            ("plērōsque", dict(case="acc", number="pl", gender="m")),
            ("plērumque", dict(case="acc", number="sg", gender="n"))):
        assert has(plerique, f, **parse), f
    assert "plērī" not in lf.form_index(plerique)


# --------------------------------------------------------------------- verbs

AMO = E("amō, amāre, amāvī, amātum", ["am", "am", "amāv", "amāt"], "V", [1, 1], h="amo")
MONEO = E("moneō, monēre, monuī, monitum", ["mon", "mon", "monu", "monit"], "V", [2, 1], h="moneo")
DUCO = E("dūcō, dūcere, dūxī, ductum", ["dūc", "dūc", "dūx", "duct"], "V", [3, 1], h="duco")
CAPIO = E("capiō, capere, cēpī, captum", ["capi", "cap", "cēp", "capt"], "V", [3, 1], h="capio")
AUDIO = E("audiō, audīre, audīvī, audītum", ["aud", "aud", "audīv", "audīt"], "V", [3, 4], h="audio")


# Grammatica Latina: the six persons of every tense, active then passive.
AMO_TABLE = {
    ("pres", "ind", "act"): ["amō", "amās", "amat", "amāmus", "amātis", "amant"],
    ("pres", "ind", "pass"): ["amor", "amāris", "amātur", "amāmur", "amāminī", "amantur"],
    ("impf", "ind", "act"): ["amābam", "amābās", "amābat", "amābāmus", "amābātis", "amābant"],
    ("impf", "ind", "pass"): ["amābar", "amābāris", "amābātur", "amābāmur", "amābāminī", "amābantur"],
    ("fut", "ind", "act"): ["amābō", "amābis", "amābit", "amābimus", "amābitis", "amābunt"],
    ("fut", "ind", "pass"): ["amābor", "amāberis", "amābitur", "amābimur", "amābiminī", "amābuntur"],
    ("perf", "ind", "act"): ["amāvī", "amāvistī", "amāvit", "amāvimus", "amāvistis", "amāvērunt"],
    ("plupf", "ind", "act"): ["amāveram", "amāverās", "amāverat", "amāverāmus", "amāverātis", "amāverant"],
    ("futperf", "ind", "act"): ["amāverō", "amāveris", "amāverit", "amāverimus", "amāveritis", "amāverint"],
    ("pres", "subj", "act"): ["amem", "amēs", "amet", "amēmus", "amētis", "ament"],
    ("pres", "subj", "pass"): ["amer", "amēris", "amētur", "amēmur", "amēminī", "amentur"],
    ("impf", "subj", "act"): ["amārem", "amārēs", "amāret", "amārēmus", "amārētis", "amārent"],
    ("impf", "subj", "pass"): ["amārer", "amārēris", "amārētur", "amārēmur", "amārēminī", "amārentur"],
    ("perf", "subj", "act"): ["amāverim", "amāverīs", "amāverit", "amāverīmus", "amāverītis", "amāverint"],
    ("plupf", "subj", "act"): ["amāvissem", "amāvissēs", "amāvisset", "amāvissēmus", "amāvissētis", "amāvissent"],
}
PERSONS = [(1, "sg"), (2, "sg"), (3, "sg"), (1, "pl"), (2, "pl"), (3, "pl")]


@pytest.mark.parametrize("cell", sorted(AMO_TABLE))
def test_amo_finite(cell):
    tense, mood, voice = cell
    for i, (per, num) in enumerate(PERSONS):
        want = AMO_TABLE[cell][i]
        assert has(AMO, want, tense=tense, mood=mood, voice=voice, person=per, number=num), \
            f"{want} ({tense} {mood} {voice} {per}{num})"


def test_amo_non_finite():
    assert has(AMO, "amā", mood="imper", tense="pres", voice="act", number="sg")
    assert has(AMO, "amāte", mood="imper", tense="pres", voice="act", number="pl")
    assert has(AMO, "amāre", mood="imper", tense="pres", voice="pass", number="sg")
    assert has(AMO, "amātō", mood="imper", tense="fut", voice="act", number="sg", person=2)
    assert has(AMO, "amātō", mood="imper", tense="fut", voice="act", number="sg", person=3)
    assert has(AMO, "amātōte", mood="imper", tense="fut", voice="act", number="pl")
    assert has(AMO, "amantō", mood="imper", tense="fut", voice="act", number="pl", person=3)
    assert has(AMO, "amāre", mood="inf", tense="pres", voice="act")
    assert has(AMO, "amārī", mood="inf", tense="pres", voice="pass")
    assert has(AMO, "amāvisse", mood="inf", tense="perf", voice="act")
    assert has(AMO, "amāns", mood="ptc", tense="pres", voice="act", case="nom", number="sg")
    assert has(AMO, "amantis", mood="ptc", tense="pres", voice="act", case="gen", number="sg")
    assert has(AMO, "amante", mood="ptc", tense="pres", voice="act", case="abl", number="sg")
    assert has(AMO, "amātus", mood="ptc", tense="perf", voice="pass", case="nom", number="sg", gender="m")
    assert has(AMO, "amātūrus", mood="ptc", tense="fut", voice="act", case="nom", number="sg", gender="m")
    assert has(AMO, "amandus", mood="gerundive", case="nom", number="sg", gender="m")
    assert has(AMO, "amandum", mood="gerund", case="acc")
    assert has(AMO, "amandī", mood="gerund", case="gen")
    assert has(AMO, "amātum", mood="supine", case="acc")
    assert has(AMO, "amātū", mood="supine", case="abl")


def test_conjugations_2_3_3io_4():
    assert has(MONEO, "monēbimus", tense="fut", mood="ind", voice="act", person=1, number="pl")
    assert has(MONEO, "monet", tense="pres", mood="ind", voice="act", person=3, number="sg")
    assert has(MONEO, "monē", mood="imper", tense="pres", voice="act", number="sg")
    assert has(MONEO, "monendus", mood="gerundive", case="nom", number="sg", gender="m")
    assert has(MONEO, "monērem", tense="impf", mood="subj", voice="act", person=1, number="sg")

    assert has(DUCO, "dūcet", tense="fut", mood="ind", voice="act", person=3, number="sg")
    assert has(DUCO, "dūcit", tense="pres", mood="ind", voice="act", person=3, number="sg")
    assert has(DUCO, "dūcunt", tense="pres", mood="ind", voice="act", person=3, number="pl")
    assert has(DUCO, "dūcam", tense="fut", mood="ind", voice="act", person=1, number="sg")
    assert has(DUCO, "dūc", mood="imper", tense="pres", voice="act", number="sg")   # dīc, dūc, fac
    assert has(DUCO, "ductus", mood="ptc", tense="perf", voice="pass", case="nom", number="sg", gender="m")

    assert has(CAPIO, "capiet", tense="fut", mood="ind", voice="act", person=3, number="sg")
    assert has(CAPIO, "capiunt", tense="pres", mood="ind", voice="act", person=3, number="pl")
    assert has(CAPIO, "cape", mood="imper", tense="pres", voice="act", number="sg")
    assert has(CAPIO, "capiēbat", tense="impf", mood="ind", voice="act", person=3, number="sg")
    assert has(CAPIO, "capiendus", mood="gerundive", case="nom", number="sg", gender="m")

    assert has(AUDIO, "audiet", tense="fut", mood="ind", voice="act", person=3, number="sg")
    assert has(AUDIO, "audit", tense="pres", mood="ind", voice="act", person=3, number="sg")
    assert has(AUDIO, "audiunt", tense="pres", mood="ind", voice="act", person=3, number="pl")
    assert has(AUDIO, "audī", mood="imper", tense="pres", voice="act", number="sg")
    assert has(AUDIO, "audiēmus", tense="fut", mood="ind", voice="act", person=1, number="pl")
    assert has(AUDIO, "audīvissem", tense="plupf", mood="subj", voice="act", person=1, number="sg")
    assert has(AUDIO, "audīveris", tense="futperf", mood="ind", voice="act", person=2, number="sg")
    assert has(AUDIO, "audiendus", mood="gerundive", case="nom", number="sg", gender="m")
    assert has(AUDIO, "audiēns", mood="ptc", tense="pres", voice="act", case="nom", number="sg")


def test_deponent_and_semideponent():
    sequor = E("sequor, sequī, secūtus sum", ["sequ", "sequ", "-", "secūt"], "V", [3, 1], kind="dep", h="sequor")
    assert has(sequor, "sequitur", tense="pres", mood="ind", voice="pass", person=3, number="sg")
    assert has(sequor, "sequēbātur", tense="impf", mood="ind", voice="pass", person=3, number="sg")
    assert has(sequor, "sequētur", tense="fut", mood="ind", voice="pass", person=3, number="sg")
    assert has(sequor, "sequī", mood="inf", tense="pres", voice="pass")
    assert has(sequor, "secūtus", mood="ptc", tense="perf", voice="pass", case="nom", number="sg", gender="m")
    assert has(sequor, "sequēns", mood="ptc", tense="pres", voice="act", case="nom", number="sg")
    assert has(sequor, "secūtūrus", mood="ptc", tense="fut", voice="act", case="nom", number="sg", gender="m")
    assert has(sequor, "sequendus", mood="gerundive", case="nom", number="sg", gender="m")
    assert not any(f == "sequit" for f, _ in lf.forms(sequor))

    gaudeo = E("gaudeō, gaudēre, gāvīsus sum", ["gaud", "gaud", "-", "gāvīs"], "V", [2, 1],
               kind="semidep", h="gaudeo")
    assert has(gaudeo, "gaudet", tense="pres", mood="ind", voice="act", person=3, number="sg")
    assert has(gaudeo, "gaudēbit", tense="fut", mood="ind", voice="act", person=3, number="sg")
    assert has(gaudeo, "gāvīsus", mood="ptc", tense="perf", voice="pass", case="nom", number="sg", gender="m")


IRREGULARS = {
    "sum": (E("sum, esse, fuī, futūrum", ["s", "es", "fu", "fut"], "V", [5, 1]),
            {"est": ("pres", "ind", 3, "sg"), "sunt": ("pres", "ind", 3, "pl"),
             "erat": ("impf", "ind", 3, "sg"), "erit": ("fut", "ind", 3, "sg"),
             "erunt": ("fut", "ind", 3, "pl"), "fuit": ("perf", "ind", 3, "sg"),
             "fuērunt": ("perf", "ind", 3, "pl"), "fuerat": ("plupf", "ind", 3, "sg"),
             "fuerit": ("futperf", "ind", 3, "sg")},
            ["esse", "fuisse", "es", "este", "estō", "futūrus", "sim", "sit", "essent",
             "fuissem", "fore"]),
    "possum": (E("possum, posse, potuī", ["pot", "pot", "potu", "-"], "V", [5, 2]),
               {"potest": ("pres", "ind", 3, "sg"), "possunt": ("pres", "ind", 3, "pl"),
                "poterat": ("impf", "ind", 3, "sg"), "poterit": ("fut", "ind", 3, "sg"),
                "potuit": ("perf", "ind", 3, "sg"), "potuerit": ("futperf", "ind", 3, "sg")},
               ["posse", "potuisse", "possim", "possent", "potēns"]),
    "eo": (E("eō, īre, iī, itum", ["e", "i", "i", "it"], "V", [6, 1]),
           {"it": ("pres", "ind", 3, "sg"), "eunt": ("pres", "ind", 3, "pl"),
            "ībat": ("impf", "ind", 3, "sg"), "ībit": ("fut", "ind", 3, "sg"),
            "ībunt": ("fut", "ind", 3, "pl"), "iit": ("perf", "ind", 3, "sg"),
            "iērunt": ("perf", "ind", 3, "pl")},
           ["īre", "īrī", "īsse", "ī", "īte", "iēns", "euntis", "eundum", "itum", "itūrus",
            "eat", "īret"]),
    "fero": (E("ferō, ferre, tulī, lātum", ["fer", "fer", "tul", "lāt"], "V", [3, 2]),
             {"fert": ("pres", "ind", 3, "sg"), "ferunt": ("pres", "ind", 3, "pl"),
              "ferēbat": ("impf", "ind", 3, "sg"), "feret": ("fut", "ind", 3, "sg"),
              "ferēs": ("fut", "ind", 2, "sg"), "tulit": ("perf", "ind", 3, "sg")},
             ["ferre", "ferrī", "fer", "ferte", "ferēns", "lātus", "ferendus", "tulisse",
              "ferrem", "ferat", "fertur"]),
    "volo": (E("volō, velle, voluī", ["vol", "vol", "volu", "-"], "V", [6, 2]),
             {"vult": ("pres", "ind", 3, "sg"), "volunt": ("pres", "ind", 3, "pl"),
              "volēbat": ("impf", "ind", 3, "sg"), "volet": ("fut", "ind", 3, "sg"),
              "voluit": ("perf", "ind", 3, "sg")},
             ["velle", "vīs", "vultis", "velim", "vellem", "voluisse", "volēns"]),
    "nolo": (E("nōlō, nōlle, nōluī", ["nōl", "nōl", "nōlu", "-"], "V", [6, 2]),
             {"nōlunt": ("pres", "ind", 3, "pl"), "nōlēbat": ("impf", "ind", 3, "sg"),
              "nōlet": ("fut", "ind", 3, "sg"), "nōluit": ("perf", "ind", 3, "sg")},
             ["nōlle", "nōlī", "nōlīte", "nōlim", "nōllem", "nōluisse"]),
    "malo": (E("mālō, mālle, māluī", ["māl", "māl", "mālu", "-"], "V", [6, 2]),
             {"mālunt": ("pres", "ind", 3, "pl"), "mālet": ("fut", "ind", 3, "sg"),
              "māluit": ("perf", "ind", 3, "sg")},
             ["mālle", "mālim", "māllem", "māluisse"]),
    # the glossary files fīō as Whitaker's V 3 3, and the table is now claimed by
    # that category and no other (IRREGULAR_CAT)
    "fio": (E("fīō, fierī, factus sum", ["fī", "f", "-", "fact"], "V", [3, 3], kind="semidep"),
            {"fit": ("pres", "ind", 3, "sg"), "fīunt": ("pres", "ind", 3, "pl"),
             "fīēbat": ("impf", "ind", 3, "sg"), "fīet": ("fut", "ind", 3, "sg")},
            ["fierī", "fīat", "fieret", "factus", "fī", "fīte", "factūrus", "factum", "factū"]),
}


@pytest.mark.parametrize("name", sorted(IRREGULARS))
def test_irregular_verbs(name):
    entry, finite, others = IRREGULARS[name]
    idx = lf.form_index(entry)
    for form, (tense, mood, per, num) in finite.items():
        assert has(entry, form, tense=tense, mood=mood, person=per, number=num), f"{name}: {form}"
    for f in others:
        assert f in idx, f"{name}: {f}"


def test_irregular_tables_are_claimed_by_one_category():
    """A hand table belongs to its Whitaker category, not to its headword alone.

    Ørberg teaches volāre in cap. X (avēs in āere volant, volāre nōn possum) and
    velle from cap. X on; the glossary keeps them apart as V 1 1 and V 6 2, and
    the generator must too — a learner tapping volābat wants the 1st conjugation.
    Whitaker's ghost 1st-conjugation eō (eāre, ēvī, etum) collides the same way."""
    fly = E("volō, volāre, volāvī, volātum", ["vol", "vol", "volāv", "volāt"], "V", [1, 1])
    idx = lf.form_index(fly)
    for f in ("volat", "volant", "volābat", "volābis", "volābimus", "volāvit",
              "volāvērunt", "volā", "volāre", "volandō", "volantēs", "volātūrus"):
        assert f in idx, f
    assert has(fly, "volat", tense="pres", mood="ind", voice="act", person=3, number="sg")
    assert has(fly, "volābat", tense="impf", mood="ind", voice="act", person=3, number="sg")
    assert "vult" not in idx and "velle" not in idx and "vīs" not in idx
    assert lf.paradigm(fly)["title"].endswith("1st conjugation")

    want = E("volō, velle, voluī", ["vol", "vel", "volu", "-"], "V", [6, 2])
    assert has(want, "vult", tense="pres", mood="ind", voice="act", person=3, number="sg")
    assert "volat" not in lf.form_index(want)

    ghost = E("eō, īre, iī, itum", ["e", "e", "ēv", "et"], "V", [1, 1], h="eo")
    assert lf.paradigm(ghost)["title"].endswith("1st conjugation")
    assert "ībat" not in lf.form_index(ghost)

    # a hand supplement carries no category at all: the headword is all we have
    bare = {"lemma": "fīō, fierī, factus sum", "h": "fio", "pos": "V", "roots": []}
    assert "fieret" in lf.form_index(bare)


def test_prosum_keeps_its_d_before_a_vowel():
    """Ørberg, cap. XXVII, margin: 'prōd-esse prō-fuisse', 'prōd-est prō-sunt'.
    The whole table is Allen & Greenough §204."""
    e = E("prōsum, prōdesse, prōfuī, prōfutūrum", ["prōs", "prōd", "prōfu", "prōfut"],
          "V", [5, 1], h="prosum")
    table = {
        ("pres", "ind"): ["prōsum", "prōdes", "prōdest", "prōsumus", "prōdestis", "prōsunt"],
        ("impf", "ind"): ["prōderam", "prōderās", "prōderat", "prōderāmus", "prōderātis", "prōderant"],
        ("fut", "ind"): ["prōderō", "prōderis", "prōderit", "prōderimus", "prōderitis", "prōderunt"],
        ("perf", "ind"): ["prōfuī", "prōfuistī", "prōfuit", "prōfuimus", "prōfuistis", "prōfuērunt"],
        ("pres", "subj"): ["prōsim", "prōsīs", "prōsit", "prōsīmus", "prōsītis", "prōsint"],
        ("impf", "subj"): ["prōdessem", "prōdessēs", "prōdesset", "prōdessēmus", "prōdessētis",
                           "prōdessent"],
    }
    for (tense, mood), row in table.items():
        for i, (per, num) in enumerate(PERSONS):
            assert has(e, row[i], tense=tense, mood=mood, voice="act", person=per, number=num), \
                f"{row[i]} ({tense} {mood} {per}{num})"
    idx = lf.form_index(e)
    for f in ("prōdesse", "prōfuisse", "prōdes", "prōdeste", "prōdestō", "prōfutūrus", "prōfore"):
        assert f in idx, f
    # the d is prō-'s alone: absum, dēsum, praesum keep the bare s / es
    for lemma, roots, forms3 in (
            ("absum, abesse, āfuī, āfutūrum", ["abs", "abes", "āfu", "āfut"], ("abest", "absunt", "abesse")),
            ("dēsum, dēesse, dēfuī", ["dēs", "dēes", "dēfu", "-"], ("dēest", "dēsunt", "dēesse"))):
        i2 = lf.form_index(E(lemma, roots, "V", [5, 1]))
        for f in forms3:
            assert f in i2, f


def test_sum_future_infinitive_fore():
    """Ørberg, cap. XXXIII, margin: 'fore (īnf fut) = futūrum/-am … esse'
    (pācem fore spērēmus).  Allen & Greenough §170.b."""
    sum_ = E("sum, esse, fuī, futūrum", ["s", "es", "fu", "fut"], "V", [5, 1])
    assert has(sum_, "fore", mood="inf", tense="fut", voice="act")
    assert has(sum_, "esse", mood="inf", tense="pres", voice="act")
    # a compound carries the prefix onto it too
    assert has(E("absum, abesse, āfuī, āfutūrum", ["abs", "abes", "āfu", "āfut"], "V", [5, 1]),
               "abfore", mood="inf", tense="fut", voice="act")


def test_eo_present_passive_infinitive_iri():
    """Ørberg, cap. XXIII, Grammatica Latina: "'laudātum īrī' est īnfīnītīvus
    futūrī passīvī, quī ex supīnō et 'īrī' cōnstat"."""
    eo = E("eō, īre, iī, itum", ["e", "i", "i", "it"], "V", [6, 1])
    assert has(eo, "īrī", mood="inf", tense="pres", voice="pass")
    assert has(eo, "īre", mood="inf", tense="pres", voice="act")
    # the compounds have the passive the note promises: trānsīrī, abīrī
    assert has(E("trānseō, trānsīre, trānsiī, trānsitum", ["trānse", "trānsi", "trānsi", "trānsit"],
                 "V", [6, 1], h="transeo"), "trānsīrī", mood="inf", tense="pres", voice="pass")


def test_fio_borrows_facio_future_participle_and_supine():
    """fīō is faciō's passive and has no fourth principal part of its own: the
    future participle is factūrus and the supine factum (Allen & Greenough
    §204.b; Ørberg prints factūrus / factūrum esse in cap. XXIII)."""
    fio = E("fīō, fierī, factus sum", ["fī", "f", "-", "fact"], "V", [3, 3], kind="semidep")
    assert has(fio, "factūrus", mood="ptc", tense="fut", voice="act", case="nom", number="sg",
               gender="m")
    assert has(fio, "factūrum", mood="ptc", tense="fut", voice="act", case="acc", number="sg",
               gender="m")
    assert has(fio, "factum", mood="supine", case="acc")
    assert has(fio, "factū", mood="supine", case="abl")
    assert has(fio, "factus", mood="ptc", tense="perf", voice="pass", case="nom", number="sg",
               gender="m")


def test_compounds_of_sum_eo_fero():
    absum = E("absum, abesse, āfuī, āfutūrum", ["abs", "abes", "āfu", "āfut"], "V", [5, 1], h="absum")
    idx = lf.form_index(absum)
    for f in ("abest", "absunt", "aberat", "aberit", "āfuit", "abesse", "absit", "absēns"):
        assert f in idx, f
    exeo = E("exeō, exīre, exiī, exitum", ["exe", "exi", "exi", "exit"], "V", [6, 1], h="exeo")
    idx = lf.form_index(exeo)
    for f in ("exit", "exeunt", "exībat", "exībit", "exiit", "exīre", "exiēns", "exitūrus"):
        assert f in idx, f
    affero = E("afferō, afferre, attulī, allātum", ["affer", "affer", "attul", "allāt"], "V", [3, 2], h="affero")
    idx = lf.form_index(affero)
    for f in ("affert", "afferunt", "afferēbat", "afferet", "attulit", "afferre", "allātus"):
        assert f in idx, f


# ------------------------------------------------------------------ pronouns

def test_pronouns():
    def P(h, lemma):
        return E(lemma, [], "PRON", [1, 0], h=h)
    is_ = P("is", "is, ea, id")
    for f in ("is", "ea", "id", "eius", "eī", "eum", "eam", "eō", "eā", "eōrum", "eīs", "iī", "iīs"):
        assert f in lf.form_index(is_), f
    qui = P("qui", "quī, quae, quod")
    for f in ("quī", "quae", "quod", "cuius", "cui", "quem", "quam", "quō", "quibus", "quōrum"):
        assert f in lf.form_index(qui), f
    hic = P("hic", "hic, haec, hoc")
    for f in ("hic", "haec", "hoc", "huius", "huic", "hunc", "hanc", "hōc", "hī", "hae", "hōrum", "hīs"):
        assert f in lf.form_index(hic), f
    ego = P("ego", "ego, meī")
    for f in ("ego", "meī", "mihi", "mē", "nōs", "nōbīs", "mēcum", "nōbīscum"):
        assert f in lf.form_index(ego), f
    se = P("se", "sē, suī")
    for f in ("suī", "sibi", "sē", "sēcum"):
        assert f in lf.form_index(se), f


def test_numerals():
    unus = E("ūnus, ūna, ūnum", ["ūn", "prīm", "singul", "semel"], "NUM", [1, 1], h="unus")
    for f in ("ūnus", "ūna", "ūnum", "ūnīus", "ūnī", "ūnō", "ūnā"):
        assert f in lf.form_index(unus), f
    duo = E("duo, duae, duo", ["du", "secund", "bīn", "bis"], "NUM", [1, 2], h="duo")
    for f in ("duo", "duae", "duōrum", "duābus", "duōs", "duōbus"):
        assert f in lf.form_index(duo), f
    tres = E("trēs, tria", ["tr", "terti", "tern", "ter"], "NUM", [1, 3], h="tres")
    for f in ("trēs", "tria", "trium", "tribus"):
        assert f in lf.form_index(tres), f


# ------------------------------------------------------- the two large checks

def test_parity_with_paradigms_js():
    """Every cell app/js/paradigms.js draws, latin_forms draws the same."""
    glossary = json.loads(parity.GLOSSARY.read_text(encoding="utf-8"))
    entries = parity.entries_of(glossary)
    bad = []
    for i in range(0, len(entries), 400):
        bad += parity.compare(entries[i:i + 400])
    assert not bad, "\n".join(bad[:20])


#: How many attested (lemma, form, parse) facts the generator still does not
#: reproduce and that `attestation.divergence` cannot name.  All 38 were read
#: one by one on 2026-09-06 — `python tests/latin_forms/attestation.py` prints
#: them — and they fall into three groups:
#:
#:   5  what is left of the `volo` headword collision.  The tables are now
#:      claimed by category as well as headword (IRREGULAR_CAT, on both sides),
#:      so volō volāre "fly" [1,1] is a 1st-conjugation verb again and velle
#:      [6,2] keeps velle's table.  Whitaker still files Ørberg's volāre forms
#:      volandī / volandō / volandum / volantēs under his velle lexeme, and mālī
#:      under mālō; velle and mālle have no gerund and no participle to hold
#:      them, and inventing one to satisfy his analysis would be a worse table.
#:   8  Whitaker lexemes filed under a table that is not theirs: ciō "set in
#:      motion" and vēneō sit in his V 6 1, the eō class, so the generator
#:      builds them as compounds of eō and ciam / cit / cīs / venientem fall
#:      outside it.  The category is his, not ours, and rewriting it by hand
#:      would be guesswork on two words the course never sets.
#:  25  lexemes that are not words, and tokens that are not one word.  Whitaker
#:      ghosts (bus -ūs from bōs, mammon mammis, captus -ūs holding captōs,
#:      virus holding virīs, mēlos, Pān), run-together tokens he splits for us
#:      (hicest, sēipsa, ecce under hic), and stray archaisms with no row
#:      (mīs, ollis, trīnās, nostrōrum, arcubus, diī).  Nothing to generate.
#:
#: The four table gaps that used to stand here as a fourth group (9 facts) are
#: closed, in latin_forms.py and app/js/paradigms.js together: prōsum keeps its
#: d before a vowel (prōdest, prōdesse, prōderam, prōderunt), sum has the future
#: infinitive fore, eō has the present passive infinitive īrī, and fīō takes
#: faciō's future participle and supine (factūrus, factum).  So is the -que
#: adjective gap: uterque and plērīque no longer decline as uter / plērus.
#:
#: A rise is a regression unless the new rows belong to one of these three.
UNEXPLAINED_BASELINE = 38


def test_glossary_attestation():
    glossary = json.loads(attestation.GLOSSARY.read_text(encoding="utf-8"))
    lemmas = attestation.load_lemmas(glossary)
    assert len(lemmas) >= 300
    unexplained = 0
    facts = 0
    for rec in lemmas.values():
        facts += len(rec["forms"])
        for m in attestation.check(rec):
            if not m[4]:
                unexplained += 1
    assert facts > 8000
    assert unexplained <= UNEXPLAINED_BASELINE, (
        f"{unexplained} unexplained mismatches (baseline {UNEXPLAINED_BASELINE}); "
        "run python tests/latin_forms/attestation.py to see them")
