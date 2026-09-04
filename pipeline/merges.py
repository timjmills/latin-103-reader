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

Nearly every entry below is the same pattern: the Latin carries a quotation on
across `inquit` — `"Ergō bibāmus!" inquit, "Hoc vīnum …"` is one sentence — and
the translator wrote it as two English sentences ("… says: 'Let us drink!'" +
"This wine …"). The one Latin merge (week 12, b6) is the date abbreviation
`a. d. VII kal. Māi.`, which the splitter cuts at the full stops.
"""

MERGES = {
    1: {
        "en": {
            91: [(0, 1)],       # 'Mīnōtaurus necātus est' inquit, 'Laetāminī, cīvēs meī!
            101: [(4, 5)],      # 'Revertere ad mē!' neque ūllum respōnsum …
        },
    },
    2: {
        "en": {
            48: [(0, 1)],       # 'Quid ego facere nōn possum?' inquit, 'Profectō …
            57: [(0, 1)],       # 'Certē cōnsilium meum perficiam' inquit pater, 'Ecce …
        },
    },
    3: {
        "en": {
            "fl-65:b18": [(0, 1)],   # "Heus tū, serve!" inquit, "Cēde mihi!
        },
    },
    5: {
        "en": {
            "nausicaa:147": [(2, 3)],   # "Celeriter currite" clāmābat, "hūc, hūc pilam iacite!"
        },
    },
    6: {
        "en": {
            11: [(0, 1)],       # "Quid pallēs?" inquit, "Utrum aegrōtās an territus es?"
        },
    },
    7: {
        "en": {
            "b16": [(0, 1)],    # "Quisnam est Arīōn?" inquit, "Nē nōmen quidem …
            "b32": [(0, 1)],    # "Nōlī stultē agere!" inquit, "Nēmō tibi ānulum …
            "b38": [(1, 2)],    # "Dēsine loquī!" inquit, "Cūrā negōtium tuum!
            "b42": [(0, 1)],    # "Bonō animō es!" inquit, "Nōlī dēspērāre!
        },
    },
    8: {
        "en": {
            "b30": [(0, 1)],    # "Ergō bibāmus!" inquit, "Hoc vīnum factum est …
        },
    },
    9: {
        "en": {
            "b13": [(0, 1)],    # "Stultē id quaeris" inquit, "Midās enim …
            "b19": [(0, 1)],    # "St, Iūlī!" inquit, "Nōlī servum praesentem laudāre!"
            "b20": [(0, 1)],    # "Sed is servus adest" inquit, "Nōlō eum laudāre praesentem.
        },
    },
    10: {
        "en": {
            "fl-71:b17": [(2, 3)],   # "Quid est, Philippa?" inquit, "Cūr flēs?"
            "fl-71:b22": [(2, 3)],   # "Ō domina!" inquit, "tibi aliquid dīcam …
            "fl-72:b28": [(1, 2)],   # Ō, Philippa! nōn sōlum … (Latin runs on in lower case)
        },
    },
    11: {
        "en": {
            "b39": [(0, 1)],    # "Ō Mēde!" inquit, "Nunc dēmum intellegō …
            "b42": [(0, 1)],    # "Quid hoc?" inquit, "Aliae nāvēs illam sequuntur.
        },
    },
    12: {
        "en": {
            "b3": [(2, 3)],     # 'quid tum discere vellet?' [tag], fīlius statim respondit …
        },
        "la": {
            "b6": [(0, 2)],     # epistula tua quae a. d. VII kal. Māi. scrīpta est — abbreviations
        },
    },
    14: {
        "en": {
            "b14": [(0, 1)],    # "Quid rīdētis?" inquit Paula, "Num haec in mē …
        },
    },
}


# Force how a block is cut, or whether it is built at all, when the automatic
# detection gets it wrong.
#   OVERRIDES = { <week n>: { "verse": [keys], "prose": [keys], "dialogue": [keys],
#                             "latin_only": [keys], "skip": [keys] } }
# Keys are the same block keys as above.
#   "verse"      = one unit per physical line;
#   "prose"      = sentence-split even though every line starts with a capital;
#   "dialogue"   = one unit per "Name:" turn (the default only for Fabellae Latīnae);
#   "latin_only" = the block has no English by design (en: null, no mismatch reported);
#   "skip"       = leave the block out of the build (listed in the report).
OVERRIDES: dict = {
    9: {
        # Orontēs' drinking couplet, two paragraphs in the document, one line each
        "verse": ["b53", "b54"],
        # the Pompeian graffito printed after the chapter: caption + capital-letter line, no translation
        "latin_only": ["b58", "b59"],
    },
}


def merges_for(n: int) -> dict:
    """Return {"en": {...}, "la": {...}} for week n (empty dicts when none)."""
    m = MERGES.get(n, {})
    return {"en": dict(m.get("en", {})), "la": dict(m.get("la", {}))}
