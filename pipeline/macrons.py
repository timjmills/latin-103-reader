"""
Spelling helpers for the glossary build: macrons and v/u.

Whitaker's data is stored in canonical i/u orthography without vowel length,
so every stem the parser returns looks like ``uiu`` (vīv-) or ``seru`` (serv-).
The build restores a learner-facing spelling from three sources, in order:

1. The source texts (``source/week-*.md``): when a token was analysed as
   ``stem + affix``, the first ``len(stem)`` characters of the original token
   give that stem's real spelling, macrons and all. This is the main source.
2. ``HAND_ROOTS`` / ``HAND_LEMMAS`` below: a small hand table for words whose
   other principal parts never occur in the texts (perfect stems, citation
   forms of irregular verbs, pronouns, particles). Only lengths I am sure of.
3. Nothing. A stem that neither source covers is emitted without macrons —
   never guessed — after the mechanical u→v restoration in ``restore_v``.

``restore_v`` only decides consonant-vs-vowel u; it adds no macrons.
"""

from __future__ import annotations

import re
import unicodedata

VOWELS = "aeiouyāēīōūȳ"

# --- consonantal u --------------------------------------------------------

_PERFECT_STEM_INDEX = 2


def restore_v(stem: str, pos: str = "", index: int = 0, next_char: str = "") -> str:
    """Turn canonical u into v where it is consonantal.

    Rules (documented, deterministic, no dictionary):
    * word-initial ``u`` before a vowel → v   (uir → vir, uol → vol)
    * intervocalic ``u`` → v, except after q/g (nauis → navis, aqua stays)
    * ``u`` after a consonant, before a vowel, when preceded earlier by a vowel
      and the consonant is l or r → v   (seru+us → servus, siluā → silvā)
      — but NOT for a verb's perfect stem (uolu+ī → voluī, monu+ī).
    * ``uu`` followed by a vowel: the first ``u`` is the vowel and the second
      the consonant (iuuenis → iuvenis, adiuuo → adiuvō, uua → ūva); ``uu``
      before a consonant keeps the earlier rules (uult → vult, ouum → ovum).
    * a stem-final ``u`` is judged against ``next_char`` (the first letter of
      the ending) when given; with no ending in sight it stays ``u``.
    """
    s = list(stem)
    n = len(s)
    out = []
    for i, ch in enumerate(s):
        if ch != "u":
            out.append(ch)
            continue
        prev = s[i - 1] if i > 0 else ""
        nxt = s[i + 1] if i + 1 < n else next_char
        after = s[i + 2] if i + 2 < n else (next_char if i + 1 < n else "")
        is_v = False
        if nxt and nxt in VOWELS:
            if nxt == "u" and i + 1 < n and (not after or (after in VOWELS and after != "u")):
                # "iuuenis", "uua": this u is the vowel; the next u is the consonant
                # (with no ending in sight, "iuu" stays "iuu" rather than "ivu")
                is_v = False
            elif prev == "u" and (i == 1 or (s[i - 2] in VOWELS and s[i - 2] != "u")):
                # the second u of "iuuenis" / "adiuuo" / "uua" → v
                is_v = True
            elif i == 0:
                is_v = True
            elif prev in VOWELS and prev not in "u":
                is_v = True
            elif prev in "lr" and any(c in VOWELS for c in s[: i - 1]):
                if not (pos == "V" and index == _PERFECT_STEM_INDEX and i == n - 1):
                    is_v = True
        if prev in "qg" and i > 0:
            # aqua, lingua, sanguis; but "quu" (equus) — the first u is the glide
            is_v = False
        out.append("v" if is_v else "u")
    return "".join(out)


# --- macron utilities -----------------------------------------------------

_MACRON_TABLE = str.maketrans({
    "ā": "a", "ē": "e", "ī": "i", "ō": "o", "ū": "u", "ȳ": "y",
    "Ā": "A", "Ē": "E", "Ī": "I", "Ō": "O", "Ū": "U", "Ȳ": "Y",
})


def strip_macrons(s: str) -> str:
    s = unicodedata.normalize("NFC", s).translate(_MACRON_TABLE)
    # any leftover combining macrons
    return s.replace("̄", "")


def canonical(s: str) -> str:
    """The Whitaker lookup key of a display spelling: ascii, lowercase, j→i, v→u."""
    return strip_macrons(s).lower().replace("j", "i").replace("v", "u")


def has_macron(s: str) -> bool:
    return bool(re.search(r"[āēīōūȳĀĒĪŌŪȲ]", s))


# --- hand tables ------------------------------------------------------------
#
# Keys: "<POS>:<whitaker roots joined by />" in Whitaker's canonical spelling.
# Values: the display spelling of each root (v restored, macrons where the
# vowel is long). "-" stays "-".

HAND_ROOTS: dict[str, list[str]] = {
    # nouns
    "N:puell/puell": ["puell", "puell"],
    "N:seru/seru": ["serv", "serv"],
    "N:puer/puer": ["puer", "puer"],
    "N:ager/agr": ["ager", "agr"],
    "N:uerb/uerb": ["verb", "verb"],
    "N:rex/reg": ["rēx", "rēg"],
    "N:corpus/corpor": ["corpus", "corpor"],
    "N:mare/mar": ["mare", "mar"],
    "N:urbs/urb": ["urbs", "urb"],
    "N:man/man": ["man", "man"],
    "N:corn/corn": ["corn", "corn"],
    "N:di/di": ["di", "di"],
    "N:r/r": ["r", "r"],
    "N:labyrinth/labyrinth": ["labyrinth", "labyrinth"],
    "N:fabul/fabul": ["fābul", "fābul"],
    "N:uir/uir": ["vir", "vir"],
    "N:fili/fili": ["fīli", "fīli"],
    "N:de/de": ["de", "de"],
    "N:dom/dom": ["dom", "dom"],
    "N:nomen/nomin": ["nōmen", "nōmin"],
    "N:uis/u": ["vīs", "v"],
    "N:uis/uir": ["vīs", "vīr"],
    "N:ciuis/ciu": ["cīvis", "cīv"],
    "N:nau/nau": ["nāv", "nāv"],
    "N:mons/mont": ["mōns", "mont"],
    "N:pars/part": ["pars", "part"],
    "N:nox/noct": ["nox", "noct"],
    "N:turris/turr": ["turris", "turr"],
    "N:ignis/ign": ["ignis", "ign"],
    "N:animal/animal": ["animal", "animāl"],
    "N:iter/itiner": ["iter", "itiner"],
    "N:rom/rom": ["Rōm", "Rōm"],
    "N:hom/homin": ["hom", "homin"],
    "N:pater/patr": ["pater", "patr"],
    "N:mater/matr": ["māter", "mātr"],
    "N:frater/fratr": ["frāter", "frātr"],
    "N:dux/duc": ["dux", "duc"],
    "N:mors/mort": ["mors", "mort"],
    "N:tempus/tempor": ["tempus", "tempor"],
    "N:ann/ann": ["ann", "ann"],
    "N:oppid/oppid": ["oppid", "oppid"],
    "N:insul/insul": ["īnsul", "īnsul"],
    "N:nomin/nomin": ["nōmin", "nōmin"],
    # adjectives
    "ADJ:bon/bon/meli/opti": ["bon", "bon", "meli", "opti"],
    "ADJ:magn/magn/mai/maxi": ["magn", "magn", "mai", "maxi"],
    "ADJ:acer/acr/acri/acerri": ["ācer", "ācr", "ācri", "ācerri"],
    "ADJ:felix/felic/felici/felicissi": ["fēlīx", "fēlīc", "fēlīci", "fēlīcissi"],
    "ADJ:ingens/ingent/ingenti/ingentissi": ["ingēns", "ingent", "ingenti", "ingentissi"],
    "ADJ:fort/fort/forti/fortissi": ["fort", "fort", "forti", "fortissi"],
    "ADJ:pulcher/pulchr/pulchri/pulcherri": ["pulcher", "pulchr", "pulchri", "pulcherri"],
    "ADJ:liber/liber/liberi/liberri": ["līber", "līber", "līberi", "līberri"],
    "ADJ:miser/miser/miseri/miserri": ["miser", "miser", "miseri", "miserri"],
    "ADJ:paru/paru/min/mini": ["parv", "parv", "min", "mini"],
    "ADJ:su/su": ["su", "su"],
    "ADJ:mult/mult/plur/plurim": ["mult", "mult", "plūr", "plūrim"],
    "ADJ:omn/omn/-/-": ["omn", "omn", "-", "-"],
    "ADJ:nou/nou/noui/nouissi": ["nov", "nov", "novi", "novissi"],
    "ADJ:uiu/uiu/uiui/uiuissi": ["vīv", "vīv", "vīvi", "vīvissi"],
    "ADJ:un/un": ["ūn", "ūn"],
    "ADJ:sol/sol": ["sōl", "sōl"],
    "ADJ:tot/tot": ["tōt", "tōt"],
    # verbs (roots: present-1, present-2, perfect, participle)
    "V:am/am/amau/amat": ["am", "am", "amāv", "amāt"],
    "V:mon/mon/monu/monit": ["mon", "mon", "monu", "monit"],
    "V:reg/reg/rex/rect": ["reg", "reg", "rēx", "rēct"],
    "V:capi/cap/cep/capt": ["capi", "cap", "cēp", "capt"],
    "V:audi/aud/audiu/audit": ["audi", "aud", "audīv", "audīt"],
    "V:sequ/sequ/-/secut": ["sequ", "sequ", "-", "secūt"],
    "V:loqu/loqu/-/locut": ["loqu", "loqu", "-", "locūt"],
    "V:proficisc/proficisc/-/profect": ["proficīsc", "proficīsc", "-", "profect"],
    "V:mitt/mitt/mis/miss": ["mitt", "mitt", "mīs", "miss"],
    "V:poss/pot/potu/-": ["poss", "pot", "potu", "-"],
    "V:e/i/iu/it": ["e", "i", "i", "it"],
    "V:fer/fer/tul/lat": ["fer", "fer", "tul", "lāt"],
    "V:uol/uel/uolu/-": ["vol", "vel", "volu", "-"],
    "V:nol/nol/nolu/-": ["nōl", "nōl", "nōlu", "-"],
    "V:mal/mal/malu/-": ["māl", "māl", "mālu", "-"],
    "V:fi/f/-/fact": ["fī", "f", "-", "fact"],
    "V:uid/uid/uid/uis": ["vid", "vid", "vīd", "vīs"],
    "V:ueni/uen/uen/uent": ["veni", "ven", "vēn", "vent"],
    "V:dic/dic/dix/dict": ["dīc", "dīc", "dīx", "dict"],
    "V:duc/duc/dux/duct": ["dūc", "dūc", "dūx", "duct"],
    "V:faci/fac/fec/fact": ["faci", "fac", "fēc", "fact"],
    "V:ag/ag/eg/act": ["ag", "ag", "ēg", "āct"],
    "V:hab/hab/habu/habit": ["hab", "hab", "habu", "habit"],
    "V:uoc/uoc/uocau/uocat": ["voc", "voc", "vocāv", "vocāt"],
    "V:narr/narr/narrau/narrat": ["nārr", "nārr", "nārrāv", "nārrāt"],
    "V:scrib/scrib/scrips/script": ["scrīb", "scrīb", "scrīps", "scrīpt"],
    "V:leg/leg/leg/lect": ["leg", "leg", "lēg", "lēct"],
    "V:pon/pon/posu/posit": ["pōn", "pōn", "posu", "posit"],
    "V:uor/uor/uorau/uorat": ["vor", "vor", "vorāv", "vorāt"],
    "V:uiu/uiu/uix/uict": ["vīv", "vīv", "vīx", "vīct"],
    "V:cupi/cup/cupiu/cupit": ["cupi", "cup", "cupīv", "cupīt"],
    "V:terr/terr/terru/territ": ["terr", "terr", "terru", "territ"],
    "V:time/tim/timu/-": ["time", "tim", "timu", "-"],
    "V:put/put/putau/putat": ["put", "put", "putāv", "putāt"],
    "V:sci/sc/sciu/scit": ["sci", "sc", "scīv", "scīt"],
    "V:interfici/interfic/interfec/interfect": ["interfici", "interfic", "interfēc", "interfect"],
    "V:relinqu/relinqu/reliqu/relict": ["relinqu", "relinqu", "relīqu", "relict"],
    "V:d/d/ded/dat": ["d", "d", "ded", "dat"],
    "V:st/st/stet/stat": ["st", "st", "stet", "stat"],
    "V:uinc/uinc/uic/uict": ["vinc", "vinc", "vīc", "vict"],
    "V:iub/iub/iuss/iuss": ["iub", "iub", "iuss", "iuss"],
    "V:ten/ten/tenu/tent": ["ten", "ten", "tenu", "tent"],
    "V:man/man/mans/mans": ["man", "man", "māns", "māns"],
    "V:tim/tim/timu/-": ["tim", "tim", "timu", "-"],
    "V:pet/pet/petiu/petit": ["pet", "pet", "petīv", "petīt"],
    "V:quaer/quaer/quaesiu/quaesit": ["quaer", "quaer", "quaesīv", "quaesīt"],
    "V:respond/respond/respond/respons": ["respond", "respond", "respond", "respōns"],
    "V:incipi/incip/incep/incept": ["incipi", "incip", "incēp", "incept"],
    "V:sum/sum/sumps/sumpt": ["sūm", "sūm", "sūmps", "sūmpt"],
    "V:cred/cred/credid/credit": ["crēd", "crēd", "crēdid", "crēdit"],
    "V:cognosc/cognosc/cognou/cognit": ["cognōsc", "cognōsc", "cognōv", "cognit"],
    "V:constitu/constitu/constitu/constitut": ["cōnstitu", "cōnstitu", "cōnstitu", "cōnstitūt"],
    "V:ostend/ostend/ostend/ostent": ["ostend", "ostend", "ostend", "ostent"],
}

# Full citation forms for words whose lemma is not stem + regular ending.
# Keys: "<POS>:<ascii headword>".
HAND_LEMMAS: dict[str, str] = {
    "V:sum": "sum, esse, fuī, futūrum",
    "V:possum": "possum, posse, potuī",
    "V:eo": "eō, īre, iī, itum",
    "V:fero": "ferō, ferre, tulī, lātum",
    "V:volo": "volō, velle, voluī",
    "V:nolo": "nōlō, nōlle, nōluī",
    "V:malo": "mālō, mālle, māluī",
    "V:fio": "fīō, fierī, factus sum",
    "V:absum": "absum, abesse, āfuī, āfutūrum",
    "V:adsum": "adsum, adesse, adfuī, adfutūrum",
    "V:possum": "possum, posse, potuī",
    "V:abeo": "abeō, abīre, abiī, abitum",
    "V:adeo": "adeō, adīre, adiī, aditum",
    "V:exeo": "exeō, exīre, exiī, exitum",
    "V:redeo": "redeō, redīre, rediī, reditum",
    "V:ineo": "ineō, inīre, iniī, initum",
    "V:transeo": "trānseō, trānsīre, trānsiī, trānsitum",
    "V:pereo": "pereō, perīre, periī, peritum",
    "V:inquam": "inquam, inquit (defective: says, said)",
    "V:aio": "aiō, ait (defective: says)",
    "V:odi": "ōdī, ōdisse (perfect form, present meaning: hate)",
    "V:memini": "meminī, meminisse (perfect form, present meaning: remember)",
    "V:coepi": "coepī, coepisse, coeptum (begin)",
    "V:edo": "edō, ēsse (edere), ēdī, ēsum",
    "N:moene": "moenia -ium n pl",
    "N:vis": "vīs (acc. vim, abl. vī) f · pl. vīrēs -ium",
    "N:homo": "homō hominis m",
    "N:nemo": "nēmō (acc. nēminem, dat. nēminī) m/f",
    "N:adulescens": "adulēscēns -entis m/f",
    "ADJ:complus": "complūrēs, complūra (plural only)",
    "NUM:tot": "tot (indeclinable)",
    "NUM:quot": "quot (indeclinable)",
    "PRON:is": "is, ea, id",
    "PRON:hic": "hic, haec, hoc",
    "PRON:ille": "ille, illa, illud",
    "PRON:iste": "iste, ista, istud",
    "PRON:ipse": "ipse, ipsa, ipsum",
    "PRON:idem": "īdem, eadem, idem",
    "PRON:qui": "quī, quae, quod",
    "PRON:quis": "quis, quid",
    "PRON:quod": "quī, quae, quod",
    "PRON:quid": "quis, quid",
    "PRON:ego": "ego, meī",
    "PRON:tu": "tū, tuī",
    "PRON:nos": "nōs, nostrum / nostrī",
    "PRON:vos": "vōs, vestrum / vestrī",
    "PRON:se": "sē, suī",
    "PRON:aliquis": "aliquis, aliquid",
    "PRON:aliqui": "aliquī, aliqua, aliquod",
    "PRON:quisque": "quisque, quaeque, quidque",
    "PRON:quidam": "quīdam, quaedam, quoddam",
    "PRON:quisquam": "quisquam, quidquam",
    "PRON:quicumque": "quīcumque, quaecumque, quodcumque",
    "PRON:uterque": "uterque, utraque, utrumque",
    "NUM:unus": "ūnus, ūna, ūnum",
    "NUM:duo": "duo, duae, duo",
    "NUM:tres": "trēs, tria",
    "NUM:mille": "mīlle (pl. mīlia)",
}

# Uninflected words: display spelling by ascii form.
HAND_WORDS: dict[str, str] = {
    "a": "ā", "ab": "ab", "abs": "abs", "e": "ē", "ex": "ex", "de": "dē", "pro": "prō",
    "prae": "prae", "cum": "cum", "sine": "sine", "in": "in", "ad": "ad", "per": "per",
    "post": "post", "ante": "ante", "apud": "apud", "inter": "inter", "circum": "circum",
    "trans": "trāns", "sub": "sub", "super": "super", "ob": "ob", "propter": "propter",
    "contra": "contrā", "supra": "suprā", "infra": "īnfrā", "intra": "intrā",
    "extra": "extrā", "erga": "ergā", "ultra": "ultrā", "citra": "citrā", "usque": "ūsque",
    "prope": "prope", "iuxta": "iūxtā", "secundum": "secundum", "coram": "cōram",
    "et": "et", "sed": "sed", "nam": "nam", "enim": "enim", "autem": "autem",
    "igitur": "igitur", "itaque": "itaque", "ergo": "ergō", "neque": "neque", "nec": "nec",
    "atque": "atque", "ac": "ac", "aut": "aut", "vel": "vel", "quia": "quia",
    "quod": "quod", "si": "sī", "nisi": "nisi", "ut": "ut", "ne": "nē", "dum": "dum",
    "postquam": "postquam", "antequam": "antequam", "priusquam": "priusquam",
    "etsi": "etsī", "quamquam": "quamquam", "ubi": "ubi", "an": "an", "sive": "sīve",
    "seu": "seu", "quasi": "quasi", "tamquam": "tamquam", "velut": "velut",
    "quoniam": "quoniam", "quando": "quandō", "donec": "dōnec", "utrum": "utrum",
    "vero": "vērō", "non": "nōn", "iam": "iam", "saepe": "saepe", "bene": "bene",
    "hic": "hīc", "ibi": "ibi", "cur": "cūr", "tum": "tum", "tunc": "tunc", "nunc": "nunc",
    "semper": "semper", "numquam": "numquam", "umquam": "umquam", "quoque": "quoque",
    "etiam": "etiam", "tamen": "tamen", "sic": "sīc", "ita": "ita", "nimis": "nimis",
    "satis": "satis", "mox": "mox", "olim": "ōlim", "rursus": "rūrsus", "statim": "statim",
    "diu": "diū", "quam": "quam", "tam": "tam", "nonne": "nōnne", "num": "num",
    "illinc": "illinc", "illuc": "illūc", "huc": "hūc", "inde": "inde", "unde": "unde",
    "primum": "prīmum", "paulo": "paulō", "continuo": "continuō", "magis": "magis",
    "minus": "minus", "male": "male", "solum": "sōlum", "modo": "modo",
    "quotannis": "quotannīs", "forte": "forte", "antea": "anteā", "postea": "posteā",
    "interea": "intereā", "procul": "procul", "certe": "certē", "fere": "ferē",
    "quidem": "quidem", "vix": "vix", "paene": "paene", "iterum": "iterum",
    "tantum": "tantum", "valde": "valdē", "deinde": "deinde", "denique": "dēnique",
    "postremo": "postrēmō", "praeterea": "praetereā", "ideo": "ideō", "quare": "quārē",
    "ecce": "ecce", "utinam": "utinam", "heu": "heu", "o": "ō", "illic": "illīc",
    "hinc": "hinc", "quo": "quō", "semel": "semel", "bis": "bis", "ter": "ter",
    "tandem": "tandem", "subito": "subitō", "ideo": "ideō", "quippe": "quippe",
    "nihil": "nihil", "nil": "nīl", "mihi": "mihi", "tibi": "tibi", "sibi": "sibi",
    "que": "que", "ve": "ve",
}
