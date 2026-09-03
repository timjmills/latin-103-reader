"""
The 14-week table for Latin 103 (fall 2026), derived from PROMPT.md §4 and
data/syllabus.md. This is the single source of truth for the `week` object
written to data/build/week-NN.json and for the index data/build/weeks.json.

Fields per week
  n                  1..14
  id                 "w01".."w14"
  title              Latin title as the reader sees it (with macrons)
  source             "FR" | "FS" | "FL" | "FS+FL"  (weeks 3, 5, 10 mix FS and FL;
                     every unit also carries its own `source`)
  chapter            FR/FS chapter in Roman numerals, or FL story numbers
  has_line_numbers   False only when the whole week is Fabellae Latinae; for the
                     mixed weeks the FS parts have numbers and the FL parts don't
  multi_text         True when the week's document holds more than one text with
                     its own line numbering (FS stories + FL fabellae). For these
                     weeks unit ids carry a part slug: "w03:minos:1.1". See
                     build_week.py, part_slug().
  focus              {key, label, blurb} — blurb is one learner-friendly sentence.
                     Workstream C keeps the canonical focus text in
                     pipeline/focus.json (same keys plus what_to_mark and
                     seed_patterns); when that file exists its key/label/blurb
                     override the values here, so the two never drift.
  texts              the readings, in order, with their source (informational and
                     used to classify parts of the document by heading)
  trim               week 13/14 overlap rule (PROMPT §4): Ōdī et amō stays in
                     week 13; week 14 starts at "Hīs versibus recitātīs".
                     end_before / start_at are matched macron- and
                     case-insensitively against block text.
"""
import json
from pathlib import Path

WEEKS = [
    {
        "n": 1, "id": "w01",
        "title": "Thēseus et Mīnōtaurus",
        "source": "FR", "chapter": "XXV", "has_line_numbers": True, "multi_text": False,
        "texts": [{"source": "FR", "title": "Thēseus et Mīnōtaurus", "ref": "Familia Romana cap. XXV"}],
        "focus": {
            "key": "deponent",
            "label": "Deponent verbs",
            "blurb": "Verbs that look passive but mean something active — watch especially the commands ending in -re and -minī.",
        },
    },
    {
        "n": 2, "id": "w02",
        "title": "Daedalus et Īcarus",
        "source": "FR", "chapter": "XXVI", "has_line_numbers": True, "multi_text": False,
        "texts": [{"source": "FR", "title": "Daedalus et Īcarus", "ref": "Familia Romana cap. XXVI"}],
        "focus": {
            "key": "gerund",
            "label": "Gerund",
            "blurb": "The verb turned into a noun for 'doing' something: -ndum after ad for purpose, -ndī with a noun, -ndō for 'by doing'.",
        },
    },
    {
        "n": 3, "id": "w03",
        "title": "Mīnōs · Corōnis · Fabellae LXIII–LXV",
        "source": "FS+FL", "chapter": "XXVII (FS 1, 5); FL 63–65", "has_line_numbers": True, "multi_text": True,
        "texts": [
            {"source": "FS", "title": "Mīnōs", "ref": "Fabulae Syrae cap. XXVII, 1"},
            {"source": "FS", "title": "Corōnis", "ref": "Fabulae Syrae cap. XXVII, 5"},
            {"source": "FL", "title": "Fabellae Latīnae 63–65", "ref": "Fabellae Latinae 63–65"},
        ],
        "focus": {
            "key": "pres-subj-supine",
            "label": "Present subjunctive · supine",
            "blurb": "After ut or nē a verb in the present subjunctive tells what someone wants done; the supine (-um, -ū) names the purpose of going or the respect in which something is so.",
        },
    },
    {
        "n": 4, "id": "w04",
        "title": "Rēs Rūsticae",
        "source": "FR", "chapter": "XXVII", "has_line_numbers": True, "multi_text": False,
        "texts": [{"source": "FR", "title": "Rēs Rūsticae", "ref": "Familia Romana cap. XXVII"}],
        "focus": {
            "key": "pres-subj",
            "label": "Present subjunctive",
            "blurb": "The present subjunctive's forms (-e- for the 1st conjugation, -a- for the rest) and the ut/nē clauses that use them for wishes, commands and purposes.",
        },
    },
    {
        "n": 5, "id": "w05",
        "title": "Coriolānus · Nausicaa · Fabellae LXVI–LXVIII",
        "source": "FS+FL", "chapter": "XXVIII (FS 3); FL 66–68", "has_line_numbers": True, "multi_text": True,
        "texts": [
            {"source": "FS", "title": "Coriolānus (end)", "ref": "Fabulae Syrae, Coriolanus (end)"},
            {"source": "FS", "title": "Nausicaa", "ref": "Fabulae Syrae cap. XXVIII, 3"},
            {"source": "FL", "title": "Fabellae Latīnae 66–68", "ref": "Fabellae Latinae 66–68"},
        ],
        "focus": {
            "key": "impf-subj",
            "label": "Imperfect subjunctive",
            "blurb": "When the main verb is past, the subjunctive after ut/nē goes into the imperfect: for results, purposes, commands and questions reported inside the story.",
        },
    },
    {
        "n": 6, "id": "w06",
        "title": "Perīcula Maris",
        "source": "FR", "chapter": "XXVIII", "has_line_numbers": True, "multi_text": False,
        "texts": [{"source": "FR", "title": "Perīcula Maris", "ref": "Familia Romana cap. XXVIII"}],
        "focus": {
            "key": "impf-subj-sequence",
            "label": "Imperfect subjunctive · sequence of tenses",
            "blurb": "A past main verb pulls the subjunctive in its clause into the imperfect — the tense of the subjunctive follows the tense of the verb that introduces it.",
        },
    },
    {
        "n": 7, "id": "w07",
        "title": "Nāvigāre Necesse Est",
        "source": "FR", "chapter": "XXIX", "has_line_numbers": True, "multi_text": False,
        "texts": [{"source": "FR", "title": "Nāvigāre Necesse Est", "ref": "Familia Romana cap. XXIX"}],
        "focus": {
            "key": "ut-ne-cum",
            "label": "ut/nē clauses · deliberative · cum",
            "blurb": "The same ut can report a command, state a purpose or describe a result; the subjunctive alone can ask 'what am I to do?'; and cum with the subjunctive sets the scene ('when/since').",
        },
    },
    {
        "n": 8, "id": "w08",
        "title": "Convīvium",
        "source": "FR", "chapter": "XXX", "has_line_numbers": True, "multi_text": False,
        "texts": [{"source": "FR", "title": "Convīvium", "ref": "Familia Romana cap. XXX"}],
        "focus": {
            "key": "fut-perf",
            "label": "Future perfect",
            "blurb": "'Will have done': the tense Latin uses after sī, cum and antequam for something that must be finished before the main future event.",
        },
    },
    {
        "n": 9, "id": "w09",
        "title": "Inter Pōcula",
        "source": "FR", "chapter": "XXXI", "has_line_numbers": True, "multi_text": False,
        "texts": [{"source": "FR", "title": "Inter Pōcula", "ref": "Familia Romana cap. XXXI"}],
        "focus": {
            "key": "gerundive",
            "label": "Gerundive · passive periphrastic · dative of agent",
            "blurb": "The -ndus adjective says something 'must be done', and the person who must do it goes into the dative instead of ā/ab with the ablative.",
        },
    },
    {
        "n": 10, "id": "w10",
        "title": "Arachnē · Fabellae LXIX–LXXIV",
        "source": "FS+FL", "chapter": "XXXII (FS 2); FL 69–74", "has_line_numbers": True, "multi_text": True,
        "texts": [
            {"source": "FS", "title": "Arachnē", "ref": "Fabulae Syrae cap. XXXII, 2"},
            {"source": "FL", "title": "Fabellae Latīnae 69–74", "ref": "Fabellae Latinae 69–74"},
        ],
        "focus": {
            "key": "perf-subj",
            "label": "Perfect subjunctive",
            "blurb": "Used for 'don't' commands (nē + perfect subjunctive) and for questions reported after a present main verb about something already done.",
        },
    },
    {
        "n": 11, "id": "w11",
        "title": "Classis Rōmāna",
        "source": "FR", "chapter": "XXXII", "has_line_numbers": True, "multi_text": False,
        "texts": [{"source": "FR", "title": "Classis Rōmāna", "ref": "Familia Romana cap. XXXII"}],
        "focus": {
            "key": "perf-subj-optative",
            "label": "Perfect subjunctive · utinam",
            "blurb": "More perfect subjunctives, plus utinam ('if only!') for wishes — present subjunctive for a wish that can still come true, imperfect for one that cannot.",
        },
    },
    {
        "n": 12, "id": "w12",
        "title": "Exercitus Rōmānus",
        "source": "FR", "chapter": "XXXIII", "has_line_numbers": True, "multi_text": False,
        "texts": [{"source": "FR", "title": "Exercitus Rōmānus", "ref": "Familia Romana cap. XXXIII"}],
        "focus": {
            "key": "plup-subj-fut-imper",
            "label": "Pluperfect subjunctive · future imperative",
            "blurb": "'If X had happened, Y would have happened' and 'if only it had…' use the pluperfect subjunctive; the future imperative (-tō, -tōte) gives orders for later.",
        },
    },
    {
        "n": 13, "id": "w13",
        "title": "Dē Arte Poēticā (I)",
        "source": "FR", "chapter": "XXXIV", "has_line_numbers": True, "multi_text": False,
        "lines": "1–138",
        "texts": [{"source": "FR", "title": "Dē Arte Poēticā, lines 1–138", "ref": "Familia Romana cap. XXXIV, 1–138"}],
        "focus": {
            "key": "poetry-dative",
            "label": "Poetry: elegiac couplet, hendecasyllable · dummodo · dative verbs",
            "blurb": "First verse: a long line paired with a shorter one (the elegiac couplet) and Catullus' eleven-syllable line; dummodo ('provided that') takes the subjunctive, and some verbs take a dative object.",
        },
        "trim": {"end_before": "Hīs versibus recitātīs"},
    },
    {
        "n": 14, "id": "w14",
        "title": "Dē Arte Poēticā (II)",
        "source": "FR", "chapter": "XXXIV", "has_line_numbers": True, "multi_text": False,
        "lines": "139–217",
        "texts": [{"source": "FR", "title": "Dē Arte Poēticā, lines 139–217", "ref": "Familia Romana cap. XXXIV, 139–217"}],
        "focus": {
            "key": "poetry-prosody",
            "label": "Poetry: prosody, elision, scansion · Martial",
            "blurb": "How to hear a line: long and short syllables, a final vowel swallowed before the next word (elision), and marking the feet — practised on Martial's short, pointed epigrams.",
        },
        "trim": {"start_at": "Hīs versibus recitātīs"},
    },
]

BY_N = {w["n"]: w for w in WEEKS}

_FOCUS_FILE = Path(__file__).resolve().parent / "focus.json"


def focus_for(n: int) -> dict:
    """{key, label, blurb} for week n: pipeline/focus.json when present, else the table."""
    base = dict(BY_N[n]["focus"])
    if _FOCUS_FILE.exists():
        try:
            rows = json.loads(_FOCUS_FILE.read_text(encoding="utf-8"))
            row = next((r for r in rows if r.get("n") == n), None)
        except (OSError, ValueError, TypeError):
            row = None
        if row:
            for k in ("key", "label", "blurb"):
                if row.get(k):
                    base[k] = row[k]
    return base


def week_meta(n: int) -> dict:
    """Return the table row for week n (1..14). Raises KeyError otherwise."""
    return BY_N[n]


def week_object(n: int) -> dict:
    """The `week` object in the CONTRACT shape (parts are filled by build_week)."""
    w = BY_N[n]
    obj = {
        "n": w["n"],
        "id": w["id"],
        "title": w["title"],
        "source": w["source"],
        "chapter": w["chapter"],
        "has_line_numbers": w["has_line_numbers"],
        "focus": focus_for(n),
        "parts": [],
    }
    if "lines" in w:
        obj["lines"] = w["lines"]
    return obj
