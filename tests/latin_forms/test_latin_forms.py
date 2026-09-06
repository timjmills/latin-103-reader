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
            ["esse", "fuisse", "es", "este", "estō", "futūrus", "sim", "sit", "essent", "fuissem"]),
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
           ["īre", "īsse", "ī", "īte", "iēns", "euntis", "eundum", "itum", "itūrus", "eat", "īret"]),
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
    "fio": (E("fīō, fierī, factus sum", ["f", "f", "-", "fact"], "V", [7, 3]),
            {"fit": ("pres", "ind", 3, "sg"), "fīunt": ("pres", "ind", 3, "pl"),
             "fīēbat": ("impf", "ind", 3, "sg"), "fīet": ("fut", "ind", 3, "sg")},
            ["fierī", "fīat", "fieret", "factus", "fī", "fīte"]),
}


@pytest.mark.parametrize("name", sorted(IRREGULARS))
def test_irregular_verbs(name):
    entry, finite, others = IRREGULARS[name]
    idx = lf.form_index(entry)
    for form, (tense, mood, per, num) in finite.items():
        assert has(entry, form, tense=tense, mood=mood, person=per, number=num), f"{name}: {form}"
    for f in others:
        assert f in idx, f"{name}: {f}"


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


#: how many attested (lemma, form, parse) facts the generator still does not
#: reproduce and that `attestation.divergence` cannot name.  Every one of them
#: inspected on 2026-09-06 was a Whitaker artefact in the glossary — a homograph
#: lemma (dīcō -āre "dedicate" holding dīcere's forms), a bare stem offered as a
#: word (acu, add, al), or a gender doublet — not a form the generator gets wrong.
UNEXPLAINED_BASELINE = 321


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
