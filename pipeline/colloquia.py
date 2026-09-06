#!/usr/bin/env python
"""
colloquia.py — Colloquia Personarum I–XXIV from the 2005 scan
→ data/build/collo-NN.json (+ seed SQL), the "Colloquia shelf" of
docs/GRAMMAR-CONTRACT.md § Wave 3.

    python pipeline/colloquia.py                    # all 24 colloquia
    python pipeline/colloquia.py 1 7 14 24          # selected
    python pipeline/colloquia.py --sql              # also write data/build/sql/cNN-*.sql
    python pipeline/colloquia.py --check            # rebuild in memory, validate, exit 1 on any error
    python pipeline/colloquia.py 1 --dump           # print every classified row (debug)
    python pipeline/colloquia.py 1 --render DIR     # render the colloquium's pages to PNG

Nothing here touches app/ or supabase/, and nothing is uploaded.

Why this file is not review_shelf.py
------------------------------------
The Colloquia scan's text layer is far worse than the Familia Romana one.  It
carries **no macrons at all** — every ā ē ī ō ū comes out as a letter pair or a
bare vowel — and it confuses letters heavily.  There are no printed line
numbers and no numbered rows to hang ids on, and the page layout is a hanging
indent (a speaker's turn starts flush left, its continuation lines are indented)
— the opposite of Ørberg's paragraph indent in Familia Romana.  So the page
geometry, the block rule, the token cleaning and the id scheme are all this
book's own.

Method, in order
----------------
1. **Pages.**  The k-th page carrying a ``COLLOQVIVM`` heading starts
   colloquium k; the colloquium runs to the page before the next heading, and
   the book's reading ends at the ``DECLINATIONES`` grammar appendix.  The page
   spans are cross-checked against the printed *Index colloquiōrum* on page 5;
   a mismatch is a reported error, never a silent fix.  Front matter (pp. 1–6)
   and the appendix (pp. 75–79) are dropped.  This book has no exercises.
2. **Columns.**  Ørberg's marginal glosses are set in a larger face (9.0 pt)
   in the outer margin — left on a verso, right on a recto — while the reading
   is 8.1/8.2 pt.  The main column's x-range is measured from the 8.x words on
   the page, then *every* word inside that range is kept whatever its size:
   the macron capitals (Ō Ā Ē Ī) are set at 9.9/10.0 pt and would otherwise be
   dropped, silently truncating a sentence.  Glosses fall outside the range and
   are dropped (the contract gives this shelf ``margin: []``).
3. **OCR repair.**  An explicit rule table, built by reading the rendered pages
   at 200 dpi (``--render``), not by a blind regex sweep:
     * ``ACCENTS`` — the scan's Latin-1 accents *are* the book's macrons
       (é→ē, ì→ī, ò→ō, ù→ū); applied directly, they are unambiguous.
     * ``CHAR_RULES`` — character confusions, applied as *candidate
       generation* (``extract_margins._variants``) and accepted only when the
       result is a form the macron index actually attests: ii→ā/ē/ī/ō/ū (the
       overbar vowels), fi/fu/ful→ū…, f→ī, l/1/I/!/|→i, i→l, rn↔m, 6/0/O→o,
       r→f, b→h, ti→d, c↔e.
     * ``WORD_FIXES`` — a word-level table for the recurring proper names and
       for the handful of tokens no character rule reaches, each one read off
       the printed page.
     * ``KEEP_AS_PRINTED`` — the book's *own* nonce words.  Colloquium I is a
       spelling lesson: *Barabia*, *Suria*, *Siria*, *Aegiptus* are Iūlia's
       mistakes and must survive; so must the animal noises (*Baubau*, *Pīpīpī*).
4. **Macrons.**  Every attested form is stripped of its macrons to build a
   macron-less → macronised index, in three tiers:
     0. ``NAMES`` — the cast of the *Persōnae* page (p. 6) and the places, each
        declined by ``latin_forms``; hand-checked against the printed page.
     1. ``app/data/glossary.json`` run through ``pipeline/latin_forms.py`` —
        every regular inflected form, macronised, *with its parse*.
     2. the clean macronised corpora — ``data/build/review-*.json`` (Familia
        Romana I–XXIV) and ``source/week-*.md`` — used only for keys tier 1
        does not know, and only when the corpus agrees with itself.
   A token with exactly one candidate spelling takes its macrons.  A token with
   several is disambiguated by agreement with its sentence (see
   ``disambiguate``): a preposition's case government, agreement with an
   unambiguous ablative neighbour, adjective ↔ noun concord, a vocative after
   *Ō*, the one-letter prepositions before a name or an ablative, and the
   ``-a``/``-ā`` default.  A token still ambiguous is left unmacronised and
   listed in the report.  (The speaker's own person is *not* used: a turn is
   not spoken about its speaker, so it settles nothing.)
5. **Sentences.**  ``build_week.split_sentences`` — the same rules as every
   other week — inside each block, so a speaker's quoted words stay whole and
   keep the block's speaker.
6. **Dropping.**  A sentence containing a token the repair step could not
   resolve — junk characters, an un-Latin letter cluster, a word no tier
   attests and no rule reaches — is dropped whole and listed with its page.
   Nothing is guessed.

Outputs (data/build/)
  collo-NN.json       CONTRACT week shape; week.n = 200 + N, id cNN, source CP
  collo-REPORT.md     per colloquium: pages, speakers, blocks, units, sentences
                      dropped, tokens left unmacronised, OCR repairs made
  sql/cNN-*.sql       with --sql (seed_sql.week_sql on the colloquium file)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import extract_margins as em  # noqa: E402  (skeleton / _variants / SOFT_HYPHEN)
import latin_forms as lf  # noqa: E402
import seed_sql  # noqa: E402
from build_week import norm_ws, split_sentences  # noqa: E402
from review_shelf import FOCUS  # noqa: E402  (colloquium N accompanies FR chapter N)

BUILD = ROOT / "data" / "build"
SCAN = ROOT / "scans" / "colloquia-personarum.pdf"
SCAN_ALT = ROOT.parent / "Course 6. Latin 101" / "Latin Course- Colloquia_Personarum_-_2005.pdf"

ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII",
         "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV"]

SOFT_HYPHEN = em.SOFT_HYPHEN
LETTERS = em.LETTERS
MACRON_VOWELS = "āēīōūȳĀĒĪŌŪȲ"


def strip_macrons(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))


def key_of(tok: str) -> str:
    """The macron-less lower-case key a form is indexed under."""
    return re.sub(r"[^a-z]", "", strip_macrons(tok).lower())


# ===========================================================================
# 1.  The cast and the places — tier 0 of the macron index
# ===========================================================================
# Read off the printed *Persōnae* page (p. 6) and the *Index colloquiōrum*
# (p. 5) of the 2005 printing, rendered at 200 dpi.  Every macron here was seen
# on the page.  `latin_forms` declines them, so Iūliī / Iūliō / Mārce / Dāve
# and the rest are macronised too.
#   name → (lemma, roots, pos, cat, gender)
NAMES: dict[str, tuple] = {
    # the cast, in the order the book prints them
    "Aemilia": ("Aemilia -ae f", ["Aemili", "Aemili"], "N", [1, 1], "f"),
    "Albīnus": ("Albīnus -ī m", ["Albīn", "Albīn"], "N", [2, 1], "m"),
    "Cornēlius": ("Cornēlius -ī m", ["Cornēli", "Cornēli"], "N", [2, 1], "m"),
    "Dāvus": ("Dāvus -ī m", ["Dāv", "Dāv"], "N", [2, 1], "m"),
    "Diodōrus": ("Diodōrus -ī m", ["Diodōr", "Diodōr"], "N", [2, 1], "m"),
    "Dōrippa": ("Dōrippa -ae f", ["Dōripp", "Dōripp"], "N", [1, 1], "f"),
    "Fabia": ("Fabia -ae f", ["Fabi", "Fabi"], "N", [1, 1], "f"),
    "Faustīnus": ("Faustīnus -ī m", ["Faustīn", "Faustīn"], "N", [2, 1], "m"),
    "Flōra": ("Flōra -ae f", ["Flōr", "Flōr"], "N", [1, 1], "f"),
    "Iūlia": ("Iūlia -ae f", ["Iūli", "Iūli"], "N", [1, 1], "f"),
    "Iūlius": ("Iūlius -ī m", ["Iūli", "Iūli"], "N", [2, 1], "m"),
    "Lēander": ("Lēander -drī m", ["Lēander", "Lēandr"], "N", [2, 3], "m"),
    "Lȳdia": ("Lȳdia -ae f", ["Lȳdi", "Lȳdi"], "N", [1, 1], "f"),
    "Mārcus": ("Mārcus -ī m", ["Mārc", "Mārc"], "N", [2, 1], "m"),
    "Mēdus": ("Mēdus -ī m", ["Mēd", "Mēd"], "N", [2, 1], "m"),
    "Quīntus": ("Quīntus -ī m", ["Quīnt", "Quīnt"], "N", [2, 1], "m"),
    "Rūfus": ("Rūfus -ī m", ["Rūf", "Rūf"], "N", [2, 1], "m"),
    "Sanniō": ("Sanniō -ōnis m", ["Sanniō", "Sanniōn"], "N", [3, 1], "m"),
    "Sextus": ("Sextus -ī m", ["Sext", "Sext"], "N", [2, 1], "m"),
    "Symmachus": ("Symmachus -ī m", ["Symmach", "Symmach"], "N", [2, 1], "m"),
    "Syra": ("Syra -ae f", ["Syr", "Syr"], "N", [1, 1], "f"),
    "Syrus": ("Syrus -ī m", ["Syr", "Syr"], "N", [2, 1], "m"),
    "Titus": ("Titus -ī m", ["Tit", "Tit"], "N", [2, 1], "m"),
    "Tlēpolemus": ("Tlēpolemus -ī m", ["Tlēpolem", "Tlēpolem"], "N", [2, 1], "m"),
    "Ursus": ("Ursus -ī m", ["Urs", "Urs"], "N", [2, 1], "m"),
    # the cast members the book names by their trade, not by a proper name
    "Mīles": ("mīles -itis m", ["mīles", "mīlit"], "N", [3, 1], "m"),
    "Iānitor": ("iānitor -ōris m", ["iānitor", "iānitōr"], "N", [3, 1], "m"),
    "Medicus": ("medicus -ī m", ["medic", "medic"], "N", [2, 1], "m"),
    "servī": ("servus -ī m", ["serv", "serv"], "N", [2, 1], "m"),
    # speakers named only in the Index colloquiōrum
    "Dēlia": ("Dēlia -ae f", ["Dēli", "Dēli"], "N", [1, 1], "f"),
    "Libanus": ("Libanus -ī m", ["Liban", "Liban"], "N", [2, 1], "m"),
    "Lepidus": ("Lepidus -ī m", ["Lepid", "Lepid"], "N", [2, 1], "m"),
    # gods, people and places that occur in the dialogues
    "Iuppiter": ("Iuppiter, Iovis m", ["Iuppiter", "Iov"], "N", [3, 1], "m"),
    "Iānus": ("Iānus -ī m", ["Iān", "Iān"], "N", [2, 1], "m"),
    "Neptūnus": ("Neptūnus -ī m", ["Neptūn", "Neptūn"], "N", [2, 1], "m"),
    "Mercurius": ("Mercurius -ī m", ["Mercuri", "Mercuri"], "N", [2, 1], "m"),
    "Lucrētius": ("Lucrētius -ī m", ["Lucrēti", "Lucrēti"], "N", [2, 1], "m"),
    "Epicūrus": ("Epicūrus -ī m", ["Epicūr", "Epicūr"], "N", [2, 1], "m"),
    "Margarīta": ("Margarīta -ae f", ["Margarīt", "Margarīt"], "N", [1, 1], "f"),
    "Rōma": ("Rōma -ae f", ["Rōm", "Rōm"], "N", [1, 1], "f"),
    "Tūsculum": ("Tūsculum -ī n", ["Tūscul", "Tūscul"], "N", [2, 1], "n"),
    "Tūsculānus": ("Tūsculānus -a -um", ["Tūsculān", "Tūsculān"], "ADJ", [1, 1], None),
    "Italia": ("Italia -ae f", ["Itali", "Itali"], "N", [1, 1], "f"),
    "Graecia": ("Graecia -ae f", ["Graeci", "Graeci"], "N", [1, 1], "f"),
    "Āfrica": ("Āfrica -ae f", ["Āfric", "Āfric"], "N", [1, 1], "f"),
    "Asia": ("Asia -ae f", ["Asi", "Asi"], "N", [1, 1], "f"),
    "Eurōpa": ("Eurōpa -ae f", ["Eurōp", "Eurōp"], "N", [1, 1], "f"),
    "Syria": ("Syria -ae f", ["Syri", "Syri"], "N", [1, 1], "f"),
    "Arabia": ("Arabia -ae f", ["Arabi", "Arabi"], "N", [1, 1], "f"),
    "Aegyptus": ("Aegyptus -ī f", ["Aegypt", "Aegypt"], "N", [2, 1], "f"),
    "Sparta": ("Sparta -ae f", ["Spart", "Spart"], "N", [1, 1], "f"),
    "Crēta": ("Crēta -ae f", ["Crēt", "Crēt"], "N", [1, 1], "f"),
    "Naxus": ("Naxus -ī f", ["Nax", "Nax"], "N", [2, 1], "f"),
    "Rhodus": ("Rhodus -ī f", ["Rhod", "Rhod"], "N", [2, 1], "f"),
    "Nīlus": ("Nīlus -ī m", ["Nīl", "Nīl"], "N", [2, 1], "m"),
    "Ōstia": ("Ōstia -ae f", ["Ōsti", "Ōsti"], "N", [1, 1], "f"),
    "Latīnus": ("Latīnus -a -um", ["Latīn", "Latīn"], "ADJ", [1, 1], None),
    "Rōmānus": ("Rōmānus -a -um", ["Rōmān", "Rōmān"], "ADJ", [1, 1], None),
    "Graecus": ("Graecus -a -um", ["Graec", "Graec"], "ADJ", [1, 1], None),
    "Appius": ("Appius -a -um", ["Appi", "Appi"], "ADJ", [1, 1], None),
    "Iūnius": ("Iūnius -a -um", ["Iūni", "Iūni"], "ADJ", [1, 1], None),
    "Persa": ("Persa -ae m", ["Pers", "Pers"], "N", [1, 1], "m"),
    "Kalendae": ("Kalendae -ārum f pl", ["Kalend", "Kalend"], "N", [1, 1], "f"),
    "Hispānia": ("Hispānia -ae f", ["Hispāni", "Hispāni"], "N", [1, 1], "f"),
}

# Words the dialogues use that the *course* glossary never met, because they
# occur only here (the philosophers of Colloquium XX–XXI, the thunderstorm of
# XXIV, the Greek alphabet of XXIII).  Read off the rendered pages — several
# are printed with their own marginal gloss, which states the declension.
EXTRA_WORDS: dict[str, tuple] = {
    "philosophus": ("philosophus -ī m", ["philosoph", "philosoph"], "N", [2, 1], "m"),
    "philosophia": ("philosophia -ae f", ["philosophi", "philosophi"], "N", [1, 1], "f"),
    "atomus": ("atomus -ī f", ["atom", "atom"], "N", [2, 1], "f"),
    "Dēmocritus": ("Dēmocritus -ī m", ["Dēmocrit", "Dēmocrit"], "N", [2, 1], "m"),
    "incendium": ("incendium -ī n", ["incendi", "incendi"], "N", [2, 1], "n"),
    "fulgur": ("fulgur -uris n", ["fulgur", "fulgur"], "N", [3, 1], "n"),
    "fulmen": ("fulmen -inis n", ["fulmen", "fulmin"], "N", [3, 1], "n"),
    "pōns": ("pōns pontis m", ["pōns", "pont"], "N", [3, 1], "m"),
    "particula": ("particula -ae f", ["particul", "particul"], "N", [1, 1], "f"),
    "pugnus": ("pugnus -ī m", ["pugn", "pugn"], "N", [2, 1], "m"),
    "mamma": ("mamma -ae f", ["mamm", "mamm"], "N", [1, 1], "f"),
    "peristȳlum": ("peristȳlum -ī n", ["peristȳl", "peristȳl"], "N", [2, 1], "n"),
    "tabernārius": ("tabernārius -ī m", ["tabernāri", "tabernāri"], "N", [2, 1], "m"),
    "fūmus": ("fūmus -ī m", ["fūm", "fūm"], "N", [2, 1], "m"),
    "ignis": ("ignis -is m", ["ignis", "ign"], "N", [3, 3], "m"),
    "strepitus": ("strepitus -ūs m", ["strepit", "strepit"], "N", [4, 1], "m"),
    "līmen": ("līmen -inis n", ["līmen", "līmin"], "N", [3, 1], "n"),
    "clāvis": ("clāvis -is f", ["clāvis", "clāv"], "N", [3, 3], "f"),
    "erus": ("erus -ī m", ["er", "er"], "N", [2, 1], "m"),
    "umerus": ("umerus -ī m", ["umer", "umer"], "N", [2, 1], "m"),
}

# Names and forms the generator cannot decline (Greek third declension,
# indeclinables, the Greek letters), and the handful of verb forms the
# dialogues use that the glossary lacks: printed spellings, read off the pages.
NAME_FORMS_EXTRA = [
    "Hippocratēs", "Hippocratis", "Hippocratem", "Hippocrate",
    "Aristotelēs", "Aristotelis", "Aristotelem", "Aristotele",
    "Platō", "Platōnis", "Platōnem", "Platōne",
    "Sōcratēs", "Sōcratis", "Sōcratem", "Sōcrate",
    "Iuppiter", "Iovis", "Iovem", "Iove", "Iovī",
    "Īdūs", "Nōnae",
    "alpha", "bēta", "gamma", "delta", "ēpsīlon", "zēta",
    "tonitrus", "tonitrūs", "tonitrum", "tonitrū",
    "remittō", "remittis", "remittit", "remittere", "remitte",
    "fremō", "fremis", "fremit", "fremere", "fremunt",
    "hinnīre", "hinnit", "hinniunt", "hinnīvit",
    "tinnīre", "tinnit", "tinniunt", "tinnīvit",
    "ululāre", "ululat", "ululant",
    "stertere", "stertit", "stertunt",
    "concurrere", "concurrit", "concurrunt",
    "computāre", "computā", "computat", "computō", "computābam", "computābant",
    "computāmus", "computātis", "computant", "computās", "computābit",
    "proficīscī", "proficīscitur", "profectus", "profecta",
    "revenīre", "revenit", "reveniet", "revēnit",
    "pūnīre", "pūnit", "pūnīvit", "pūnītum", "pūnītus",
    "absēns", "absentis", "absente", "absentem",
    "trīstior", "trīstiōrem", "trīstiōra",
    "sordēs", "sordium", "sordibus",
    "bālāre", "bālat", "bālant",
    "lātrāre", "lātrat", "lātrant",
    "aspiciēns", "aspicientem",
    "reditūrum", "reditūrus", "reditūram", "reditūrōs",
    # the print's own macrons where the course glossary lacks them
    "ārdēre", "ārdet", "ārdent", "ārdēns", "ārdentem", "ārdentī", "ārdentia", "ārdēbat",
    "habitātum", "opperītur", "exhaurit", "tabellārius", "pauperrimō", "pauperrimus",
    "fōrmōsissimum", "fōrmōsissima", "fōrmōsissimus", "fōrmōsissimam", "fōrmōsissimō",
    "Āh", "āh", "tūne", "vocābulum", "vocābula", "vocābulī", "vocābulō",
    "vōx", "vōcem", "vōce", "vōcēs", "vōcis", "vōcibus", "vōcum",
]

# ===========================================================================
# 2.  The OCR rule table
# ===========================================================================
# 2a.  Accents the scan prints for macrons.  Unambiguous: Latin uses no acute,
# grave or circumflex, so every one of these is a macron the OCR mangled.
ACCENTS = {
    "á": "ā", "à": "ā", "â": "ā", "ã": "ā", "ä": "ā",
    "é": "ē", "è": "ē", "ê": "ē", "ë": "ē",
    "í": "ī", "ì": "ī", "î": "ī", "ï": "ī",
    "ó": "ō", "ò": "ō", "ô": "ō", "õ": "ō", "ö": "ō",
    "ú": "ū", "ù": "ū", "û": "ū", "ü": "ū",
    "ý": "ȳ", "ÿ": "ȳ",
    "Á": "Ā", "À": "Ā", "Â": "Ā", "Ã": "Ā", "Ä": "Ā",
    "É": "Ē", "È": "Ē", "Ê": "Ē", "Ë": "Ē",
    "Í": "Ī", "Ì": "Ī", "Î": "Ī", "Ï": "Ī",
    "Ó": "Ō", "Ò": "Ō", "Ô": "Ō", "Õ": "Ō", "Ö": "Ō",
    "Ú": "Ū", "Ù": "Ū", "Û": "Ū", "Ü": "Ū",
}
_ACCENT_RE = re.compile("|".join(map(re.escape, ACCENTS)))

# 2a′.  A macron vowel inside a word comes out of the OCR as a capital: the
# overbar makes the glyph taller, and the recogniser reads the tall letter as a
# majuscule.  Seen on every rendered page (margarItae → margarītae, ocuIi …
# tuI → oculī … tuī, fOrmosa → fōrmōsa, AudI → Audī, IiilI → Iūlī).  No Latin
# word has a capital after a lower-case letter, so this is a normalisation, not
# a guess — and it only ever *decides* a word the macron index cannot supply.
_INNER_CAP = re.compile(r"(?<![qQgG])(?<=[a-zāēīōūȳ])([AEIOUY])|(?<![qQgG])(?<=[A-ZĀĒĪŌŪȲ])([AEIOUY])(?=[a-zāēīōūȳ])")
_INNER_CAP_MAP = {"A": "ā", "E": "ē", "I": "ī", "O": "ō", "U": "ū", "Y": "ȳ"}


def inner_caps(word: str) -> str:
    return _INNER_CAP.sub(lambda m: _INNER_CAP_MAP[m.group(1) or m.group(2)], word)


def normalise(text: str) -> str:
    """The two rewrites that are not guesses: the scan's accents are macrons,
    and a capital vowel inside a word is a macron vowel."""
    text = _ACCENT_RE.sub(lambda m: ACCENTS[m.group()], text)
    return re.sub(r"\S+", lambda m: inner_caps(m.group()), text)

# 2b.  Character confusions, printed → true, applied to the macron-less
# skeleton as candidate generation.  Each was read off a rendered page:
#   ii → ā ē ī ō ū   the overbar vowel split into two i-strokes
#                    (Miircus→Mārcus, liilia→Iūlia, Diivus→Dāvus, suprii→suprā)
#   fi/fu/ful → ū…   the same overbar read as an f-ligature
#                    (Rfifus→Rūfus, pecfiniam→pecūniam, Cfu→Cūr, fulus→ūnus)
#   f  → ī           (Mfles→Mīles, Qufntus→Quīntus, Faustfnus→Faustīnus)
#   l 1 I ! | → i    (Qulntus, 1am→iam, prIma→prīma, suntI→sunt!, il|īc)
#   i  → l           the mirror slip (ocuIi→oculī, anull→ānulī)
#   rn ↔ m           (tabemam→tabernam, Comelius→Cornēlius; prirnum→prīmum)
#   6 0 O 5 → o      (cae10→caelō, p16rare→plōrāre, philosophOs→philosophōs)
#   r  → f           (reminam→fēminam, rormosus→fōrmōsus)
#   b  → h           (barum→hārum, bOra→hōra)
#   ti → d           (seti→sed)
#   c ↔ e            the front-matter slip, rare in the dialogues
# The rules are *macron-aware*: they rewrite the printed word, not a stripped
# skeleton, and the result must be a spelling the index actually attests.  That
# is what makes them safe — "ii" and "fi" stand for an overbar vowel, so
# *iinus* can only be **ūnus** (never *anus*, whose a is short), *liicet* only
# **lūcet** (never *licet*), *Saliita* only **Salūtā** (never *salita*).
# The one-letter prepositions: the course glossary spells them without their
# macron, so the printed "a Rōmā" / "e tabernā" could never be macronised.
PREP_FORMS = {"ā": "PREP", "ē": "PREP", "ō": "INTERJ", "Ō": "INTERJ"}


# Tier 1 — the slips this scan makes constantly, every one of them read off a
# rendered page.  Tier 2 — slips it makes now and then; they are tried only
# when tier 1 reaches nothing, so *Tiine* becomes **Tūne** and is not also
# offered as *dine*.
CHAR_RULES_1 = [
    ("ii", "ū"), ("ii", "ā"), ("ii", "ē"), ("ii", "ō"), ("ii", "ī"),
    ("fi", "ū"), ("fi", "ī"), ("fu", "ūr"), ("ful", "ūn"), ("fl", "īl"),
    ("f", "ī"), ("l", "i"), ("1", "i"), ("1", "l"), ("!", "i"), ("|", "i"), ("i", "l"),
    ("rn", "m"), ("m", "rn"), ("6", "ō"), ("0", "ō"), ("5", "ō"), ("0", "u"),
]
CHAR_RULES_2 = CHAR_RULES_1 + [
    ("r", "f"), ("b", "h"), ("ti", "d"), ("c", "e"), ("e", "c"),
    ("u", "n"), ("n", "u"), ("q", "g"), ("a", "o"), ("o", "a"), ("!", "f"), ("ro", "m"),
]
CHAR_RULES = CHAR_RULES_2

# 2c.  Word-level fixes: the recurring proper names as the scan mangles them,
# and the handful of tokens no character rule reaches.  Read off the page.
# key (macron-less, lower-case, letters only) → the printed truth.
WORD_FIXES = {
    # the names, by far the commonest damage
    "liilia": "Iūlia", "liilius": "Iūlius", "liiliam": "Iūliam", "liiliae": "Iūliae",
    "liilii": "Iūliī", "liilio": "Iūliō", "liilium": "Iūlium", "liili": "Iūlī",
    "iiilia": "Iūlia", "iiilius": "Iūlius", "iiiliam": "Iūliam", "iiiliae": "Iūliae",
    "iiilii": "Iūliī", "iiilio": "Iūliō", "iiilium": "Iūlium", "iiili": "Iūlī",
    "iiin": "Iūlī", "ialius": "Iūlius", "iulius": "Iūlius", "iulia": "Iūlia",
    "miircus": "Mārcus", "miircum": "Mārcum", "miircI": "Mārcī", "miirce": "Mārce",
    "diivus": "Dāvus", "diive": "Dāve", "diivum": "Dāvum", "dtivus": "Dāvus",
    "riifus": "Rūfus", "rfifus": "Rūfus", "riifum": "Rūfum",
    "comelius": "Cornēlius", "comelii": "Cornēliī", "comelium": "Cornēlium",
    "comeli": "Cornēliī", "comelio": "Cornēliō",
    "faustinus": "Faustīnus", "faustfnus": "Faustīnus", "faustlnus": "Faustīnus",
    "mfles": "Mīles", "mlles": "Mīles", "mi1es": "mīles", "servf": "servī", "servi": "servī",
    "alblnus": "Albīnus", "hinitor": "Iānitor", "iinitor": "Iānitor",
    "tiisculum": "Tūsculum", "tiisculo": "Tūsculō", "tlisculo": "Tūsculō",
    "tuscuiano": "Tūsculānō", "tuscuio": "Tūsculō",
    "tiepolemus": "Tlēpolemus", "tlepolemus": "Tlēpolemus",
    "lanus": "Iānus", "lano": "Iānō", "lani": "Iānī",
    "medus": "Mēdus", "medi": "Mēdī", "medum": "Mēdum", "medo": "Mēdō", "mede": "Mēde",
    "lydia": "Lȳdia", "lydiae": "Lȳdiae", "lydiam": "Lȳdiam",
    "dorippa": "Dōrippa", "dorippam": "Dōrippam", "dorippae": "Dōrippae",
    "diodorus": "Diodōrus", "diodore": "Diodōre", "diodorum": "Diodōrum",
    "diodori": "Diodōrī", "diodoro": "Diodōrō",
    "delia": "Dēlia", "deliam": "Dēliam", "deliae": "Dēliae",
    "leander": "Lēander", "leandri": "Lēandrī", "leandrum": "Lēandrum",
    "flora": "Flōra", "floram": "Flōram", "florae": "Flōrae",
    "sannio": "Sanniō", "sannionem": "Sanniōnem",
    # tokens no character rule reaches (each checked on the rendered page)
    "mc": "hāc", "rlc": "Hīc", "procui": "procul", "hitrat": "lātrat", "rulius": "Iūlius",
    "iuic": "illūc", "seti": "sed", "ecesse": "necesse",
    "ram": "iam", "phu": "Phy", "euro": "eum", "duro": "dum",
    "fimius": "fūmus", "fimium": "fūmum", "fimi": "fūmus", "tol": "tot", "salurn": "sōlum", "sunto": "sunt.",
    "rulii": "Iūliī", "rulio": "Iūliō", "ruliam": "Iūliam",
    "rirlsus": "rūrsus", "rirsus": "rūrsus", "rirlsus2": "rūrsus",
    "rora": "hōra", "liniias": "Iūniās", "epicfumu": "Epicūrum",
    "pliira": "plūra", "priidens": "prūdēns", "siime": "Sūme", "diic": "dūc",
    "ciira": "cūrā", "ciiras": "cūrās", "diixit": "dūxit", "iinum": "ūnum",
    "iino": "ūnō", "iina": "ūnā", "rosiirum": "rosārum",
    "liliia": "Iūlia", "lilia": "Iūlia", "lliia": "Iūlia", "iiliia": "Iūlia",
    "sunti": "sunt!", "caditi": "cadit!", "audii": "Audī!",
}
WORD_FIXES = {key_of(k): v for k, v in WORD_FIXES.items()}

# 2d.  The book's own words: Iūlia's spelling mistakes in Colloquium I (the
# whole point of that dialogue), the animal noises and the childrens' cries.
# These are kept exactly as printed and never "repaired".
KEEP_AS_PRINTED = {
    # Colloquium I — Iūlia's mistakes, printed in italic
    "barabia", "suria", "siria", "aegiptus",
    # noises
    "baubau", "baubaubau", "baba", "babaa", "bau", "uhuhu", "uhu", "hahaha",
    "hihihi", "pipipi", "ssst", "phy", "oh", "eho", "st",
    "mamma", "papa", "cave", "pipiat", "pipiant",
    "ssstrrrch", "rrrch", "ssst", "tintintin", "rrrr", "uuuu", "mede", "hihihi",
}

# Tokens that are ordinary Latin but which the character rules could otherwise
# "repair" into something else: never touched when printed exactly like this.
NEVER_REPAIR = {
    "hic", "haec", "hoc", "his", "is", "id", "ea", "eo", "eum", "eam", "quis", "qui",
    "sed", "in", "et", "est", "sunt", "non", "cum", "iam", "nam", "vir", "via", "vim",
    "liber", "libera", "malum", "mala", "populus", "sole", "solum", "os", "ora", "leve",
    "vacuum", "vacuo", "unus", "una", "unum", "acer", "levis", "par", "pares",
}


# ===========================================================================
# 3.  The macron index
# ===========================================================================
_PREP_ABL = {"a", "ab", "abs", "cum", "de", "e", "ex", "prae", "pro", "sine", "coram", "tenus", "palam"}
_PREP_ACC = {"ad", "ante", "apud", "circum", "circa", "contra", "erga", "extra", "infra", "inter",
             "intra", "iuxta", "ob", "per", "post", "praeter", "prope", "propter", "secundum",
             "supra", "trans", "ultra", "versus"}
_PREP_BOTH = {"in", "sub", "super", "subter"}
PREPOSITIONS = _PREP_ABL | _PREP_ACC | _PREP_BOTH

# forms whose only reading is an ablative singular feminine: they anchor
# agreement for a neighbouring -a / -ā word ("hāc nocte", "quā viā")
# (mea, tua, sua, illa, sōla … are *not* here: their nominative is spelt the
# same way, so they settle nothing.)
ABL_ANCHORS = {"hac", "qua"}


class Macrons:
    """macron-less key → the macronised spellings that attest it, in tiers."""

    def __init__(self, root: Path, quiet: bool = True):
        self.names: dict[str, dict[str, list[dict]]] = defaultdict(dict)   # tier 0: key → spelling → parses
        self.name_lemma: dict[str, str] = {}     # key → the nominative of that name
        self.forms: dict[str, dict[str, list[dict]]] = defaultdict(dict)   # tier 1: key → spelling → parses
        self.corpus: dict[str, Counter] = defaultdict(Counter)             # tier 2
        self._load_names()
        self._load_glossary(root)
        self._load_corpora(root)
        if not quiet:
            print(f"macron index: {len(self.names)} name forms, {len(self.forms)} generated keys, "
                  f"{len(self.corpus)} corpus keys")

    # ---- tier 0
    def _load_names(self) -> None:
        for name, (lemma, roots, pos, cat, gender) in {**NAMES, **EXTRA_WORDS}.items():
            entry = lf.build(lemma, roots, pos, cat, gender)
            pairs: list[tuple[str, dict]] = []
            try:
                pairs = lf.forms(entry)
            except Exception:  # noqa: BLE001
                pairs = []
            if not pairs:   # a name the generator cannot decline still gives its nominative
                pairs = [(name, {"case": "nom", "number": "sg"})]
            for sp, parse in pairs:
                if " " in sp or not sp:
                    continue
                if name[0].isupper():
                    sp = sp[0].upper() + sp[1:]
                k = key_of(sp)
                if not k:
                    continue
                p = dict(parse)
                p["pos"] = pos
                p["lemma"] = lemma
                p["tier"] = 0
                self.names[k].setdefault(sp, []).append(p)
                self.name_lemma.setdefault(k, name)
        for sp in NAME_FORMS_EXTRA:
            self.names[key_of(sp)].setdefault(sp, [{"tier": 0}])
        for sp, pos in PREP_FORMS.items():
            self.names[key_of(sp)].setdefault(sp, [{"pos": pos, "tier": 0}])

    # ---- tier 1
    def _load_glossary(self, root: Path) -> None:
        data = json.loads((root / "app" / "data" / "glossary.json").read_text(encoding="utf-8"))
        seen: set = set()
        for entries in data.values():
            for e in entries:
                sig = (e.get("lemma"), e.get("pos"), tuple(e.get("roots") or ()), e.get("kind"))
                if sig in seen:
                    continue
                seen.add(sig)
                pairs: list[tuple[str, dict]] = []
                try:
                    pairs = lf.forms(e)
                except Exception:  # noqa: BLE001
                    pairs = []
                if not pairs:
                    # indeclinables (CONJ, PREP, most ADV, INTERJ): the lemma is the form
                    root0 = (e.get("roots") or [None])[0]
                    if root0 and " " not in root0:
                        pairs = [(root0, {"pos": e.get("pos")})]
                for form, parse in pairs:
                    if " " in form or not form:
                        continue
                    k = key_of(form)
                    if not k:
                        continue
                    p = dict(parse)
                    p["pos"] = e.get("pos")
                    p["lemma"] = e.get("lemma")
                    self.forms[k].setdefault(form, []).append(p)

    # ---- tier 2
    def _load_corpora(self, root: Path) -> None:
        texts: list[str] = []
        for p in sorted((root / "data" / "build").glob("review-??.json")):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                continue
            texts += [u["la"] for u in data.get("units", [])]
        for p in sorted((root / "source").glob("week-??.md")):
            texts.append(p.read_text(encoding="utf-8"))
        for t in texts:
            for tok in re.findall(f"[A-Za-z{MACRON_VOWELS}]+", t):
                self.corpus[key_of(tok)][tok] += 1

    # ---- lookup
    def candidates(self, key: str) -> list[tuple[str, list[dict]]]:
        """Every macronised spelling attested for `key`, best tier first."""
        if key in self.names or key in self.forms:
            out: dict[str, list[dict]] = {}
            for table in (self.names, self.forms):
                for sp, ps in table.get(key, {}).items():
                    out.setdefault(sp, []).extend(ps)
            order = list(self.names.get(key, {}))
            ranked = sorted(out.items(), key=lambda kv: (kv[0] not in order, -len(kv[1])))
            seen: dict[str, tuple[str, list[dict]]] = {}
            for sp, ps in ranked:
                got = seen.get(sp.lower())
                if got:
                    got[1].extend(ps)
                else:
                    seen[sp.lower()] = (sp, list(ps))
            return list(seen.values())
        c = self.corpus.get(key)
        if c:
            # a corpus key is used only when it agrees with itself: one spelling,
            # or one spelling that carries macrons and clearly dominates
            best, n = c.most_common(1)[0]
            others = sum(c.values()) - n
            if len(c) == 1 or (best != strip_macrons(best) and n >= max(2, 2 * others)):
                return [(best, [{}])]
            # several spellings and no winner: offer them all and let the
            # sentence (or the frequency test) choose
            return [(sp, [{}]) for sp, _ in c.most_common()]
        return []

    def _enclitic_candidates(self, spelling: str) -> list[tuple[str, list[dict]]]:
        for enc in ("ne", "que", "ve"):
            low = spelling.lower()
            if low.endswith(enc) and len(low) >= len(enc) + 2:
                got = self.candidates(key_of(spelling[:-len(enc)]))
                if got:
                    return [(sp + enc, ps) for sp, ps in got]
        return []

    def support(self, spelling: str) -> int:
        """How well the *word* is attested: its corpus sightings, plus a large
        bonus for the hand-checked cast table."""
        k = key_of(spelling)
        return sum(self.corpus.get(k, {}).values()) + (100 if k in self.names else 0) \
            + (20 if k in self.forms else 0)

    def knows(self, key: str) -> bool:
        return bool(key) and (key in WORD_FIXES or key in self.names
                              or key in self.forms or key in self.corpus)


# ===========================================================================
# 4.  Token repair
# ===========================================================================
# a word: letters, with 0 1 5 6 ! | allowed only *inside* it (there they stand for
# letters: "cae10", "m!lle", "1am"); a trailing "!" is the print's exclamation mark.
_TOKEN_RE = re.compile(
    f"^([^{LETTERS}0-9!|]*)"
    f"([{LETTERS}0-9!|](?:[{LETTERS}0-9\\-]|[!|](?=[{LETTERS}]))*)"
    f"([^{LETTERS}0-9]*)$")
_JUNK = re.compile(r"[0-9!|�^~*]")
_UNLATIN = re.compile(r"[jkwz]|q(?!u)|[^aeiouy]{5}")
# the shape of the scan's ī → l slip: an l between consonants, or a final l
# after one (Qulntus, paucl, servl) — no Latin word looks like that
_GARBLE_SHAPE = re.compile(r"[^aeiouyl]l[^aeiouyl]|[^aeiouyl]l$")
_ROMAN_NUM = re.compile(r"^[IVXLCDM]+$")


def compatible_macrons(derived: str, spelling: str) -> bool:
    """Every macron the rules derived must be a macron in the candidate too.
    (The reverse is free: the rules never *remove* a macron, so a repair with
    no macrons at all — "reminam" → "feminam" — happily takes **fēminam**.)"""
    a, b = derived.lower(), spelling.lower()
    if strip_macrons(a) != strip_macrons(b) or len(a) != len(b):
        return strip_macrons(a) == strip_macrons(b)
    return all(x == y for x, y in zip(a, b) if x in MACRON_VOWELS.lower())


class Repair:
    """Printed token → macronised token, with an honest 'could not read' flag."""

    def __init__(self, mac: Macrons):
        self.mac = mac
        self.repaired: Counter = Counter()
        self.unmacronised: Counter = Counter()
        self.unreadable: Counter = Counter()

    def token(self, tok: str, initial: bool) -> dict:
        """Printed token → {pre, core, post, cands, ok}.  `cands` is None when
        the token needs no macron decision (punctuation, a numeral, a word kept
        as printed); `core` is then already final."""
        tok = normalise(tok.replace(SOFT_HYPHEN, ""))
        m = _TOKEN_RE.match(tok)
        if not m:
            ok = not re.search(r"[^\w\s\-—–'\"“”‘’(),.;:!?…]", tok)
            if not ok:
                self.unreadable[tok] += 1
            return {"pre": "", "core": tok, "post": "", "cands": None, "ok": ok, "raw": tok}
        pre, core, post = m.groups()
        core = inner_caps(core)

        def done(new_core: str, cands=None, ok: bool = True) -> dict:
            return {"pre": pre, "core": new_core, "post": post, "cands": cands, "ok": ok, "raw": tok}

        if _ROMAN_NUM.match(core) or (len(core) == 1 and core.isalpha()
                                      and core.lower() not in "aeo"):
            return done(core)   # numerals and letters named in the text ("littera y");
            # a, e and o are left to the sentence — they are also ā / ē and Ō
        if "-" in core and all(0 < len(x) <= 3 for x in core.split("-")):
            return done(core)               # a word spelled out letter by letter: "i-y", "Mam-ma"
        low = core.lower()
        junk = bool(_JUNK.search(core))
        # the key a *clean* token is looked up under, and the key the character
        # rules work on — the latter keeps the digits / ! / | that stand for
        # letters ("cae10" → caelō), the former refuses to guess without them
        key = "" if junk else key_of(core)
        vkey = re.sub(r"[^a-z0-9!|\-]", "", strip_macrons(low)).strip("-")
        if not vkey:
            return done(core)
        if key and key in KEEP_AS_PRINTED:
            return done(core)
        for k in (key, vkey):
            if k and k in WORD_FIXES:
                new = self._case(core, WORD_FIXES[k], initial)
                if new != core:
                    self.repaired[f"{core} → {new}"] += 1
                return done(new)

        def cased(cs):
            """Candidates take the printed token's capitalisation, so a lower-case
            printed word never comes back capitalised by a corpus sighting."""
            out = []
            for sp, ps in cs:
                if core[:1].islower():
                    sp = sp[:1].lower() + sp[1:]
                out.append((self._case(core, sp, initial), ps))
            return out

        cands = self.mac.candidates(key) if key else []
        if not cands and key:
            cands = self.mac._enclitic_candidates(key)
        if cands:
            # the macrons the print itself shows (its accents, its inner
            # capitals) are evidence too: a candidate that spells one of those
            # vowels short is a different word
            keep = [c for c in cands if compatible_macrons(core, c[0])]
            if not keep and core != strip_macrons(core):
                self.unmacronised[core] += 1
                return done(core)
            cands = keep or cands
        printed_clean = not junk and not _UNLATIN.search(strip_macrons(low))
        if cands and (printed_clean or key in NEVER_REPAIR):
            return done(core, cased(cands))
        if key in NEVER_REPAIR:
            return done(core)

        # not attested as printed: try the character rules
        fixed = self._by_rules(core)
        if fixed:
            if key_of(fixed[0][0]) in WORD_FIXES:
                new = self._case(core, WORD_FIXES[key_of(fixed[0][0])], initial)
                self.repaired[f"{core} → {new}"] += 1
                return done(new)
            out = cased(fixed[:4])
            self.repaired[f"{core} → {'/'.join(dict.fromkeys(sp for sp, _ in out))}"] += 1
            return done(core, out)
        if cands:      # attested, but the printed shape carries junk we could not place
            return done(core, cased(cands))
        if printed_clean and len(key) >= 4 and not _GARBLE_SHAPE.search(key)                 and "ii" not in key:
            # clean-looking Latin the index simply does not know (a rare word the
            # course glossary never met): keep it as printed and list it.  A short
            # fragment, or one shaped like the scan's ī → l slip, is damage, not a
            # word, and takes its sentence with it.
            self.unmacronised[core] += 1
            return done(core)
        self.unreadable[core] += 1
        return done(core, None, ok=False)

    def _by_rules(self, printed: str) -> list[tuple[str, list[dict]]]:
        """Every repair the rule table reaches that the index attests *as a
        spelling*, at the shallowest depth that reaches any.  More than one is
        not a failure — *Hiic* is both *hoc* and *hāc*, and only the sentence
        can say which — so they all become candidates and `disambiguate`
        decides."""
        seeds = {printed.lower(), strip_macrons(printed).lower()}
        for rules in (CHAR_RULES_1, CHAR_RULES_2):
          for depth in (1, 2, 3):
            out: dict[str, list[dict]] = {}
            for seed in seeds:
                for v in em._variants(seed, depth, rules):
                    if v in seeds or not key_of(v):
                        continue
                    got = self.mac.candidates(key_of(v)) or self.mac._enclitic_candidates(v)
                    for sp, ps in got:
                        # the macrons the rules *derived* are evidence: "ii" and
                        # "fi" are an overbar vowel, so a candidate that spells
                        # that vowel short is not this word (iinus is ūnus, and
                        # never anus).  Everything else the index supplies.
                        if compatible_macrons(v, sp):
                            out.setdefault(sp, []).extend(ps)
            if out:
                return sorted(out.items(), key=lambda kv: (-self.mac.support(kv[0]), len(kv[0])))
        return []

    @staticmethod
    def _case(core: str, new: str, initial: bool) -> str:
        """Keep the print's capital — unless it was a misread ī (Insula → īnsula)."""
        if not core[:1].isupper():
            return new
        if core[:1] in "AEIOU" and new[:1] in MACRON_VOWELS.lower() and not initial                 and strip_macrons(new[:1]) == core[:1].lower():
            return new      # the print's capital was a macron vowel (Insula → īnsula)
        return new[:1].upper() + new[1:]


# ===========================================================================
# 5.  Macron disambiguation — agreement with the sentence
# ===========================================================================
def _has(parses: list[dict], **kw) -> bool:
    return any(all(p.get(k) == v for k, v in kw.items()) for p in parses)


def disambiguate(words: list[dict], mac: "Macrons", rep: dict) -> None:
    """Fill `w['text']` for every word that carries more than one candidate.

    Rules, in order, each defensible from the sentence itself:
      1. one candidate                       → take it
      2. all candidates spell the same       → take it
      3. a preposition immediately before    → its case wins
      4. an unambiguous ablative neighbour   → agree with it (hāc nocte, viā Latīnā)
      5. a one-letter a / e before a name or an ablative → the preposition
      6. the -a / -ā class with no anchor    → the short (nominative) reading
      7. attested three times better in the clean corpora → that reading
      8. anything left → the macron-less spelling (listed), or, when the
         readings are different *words*, an unrepaired token that drops
         its sentence
    """
    # pass 1: everything with a single spelling is settled and can anchor the rest
    for w in words:
        c = w.get("cands")
        if not c:
            w["settled"] = True
            continue
        spellings = {sp for sp, _ in c}
        if len(spellings) == 1:
            w["core"] = c[0][0]
            w["settled"] = True

    def prev_word(i: int) -> dict | None:
        for j in range(i - 1, -1, -1):
            if words[j].get("breaks"):
                return None
            if words[j].get("is_word"):
                return words[j]
        return None

    def next_word(i: int) -> dict | None:
        if words[i].get("breaks"):
            return None
        for j in range(i + 1, len(words)):
            if words[j].get("is_word"):
                return words[j]
            if words[j].get("breaks"):
                return None
        return None

    for i, w in enumerate(words):
        c = w.get("cands")
        if not c or w.get("settled"):
            continue
        by_spelling: dict[str, list[dict]] = {}
        for sp, ps in c:
            by_spelling.setdefault(sp, []).extend(ps)

        # 2b — the hand-checked table (the cast, the places, the words the
        #      course glossary never met) outranks a generated or corpus form:
        #      *ārdēre* was read off the page, *ardēre* only generated.
        tier0 = [sp for sp, ps in by_spelling.items() if any(q.get("tier") == 0 for q in ps)]
        if len(set(tier0)) == 1 and len(by_spelling) > 1 and len(key_of(w["core"])) > 1 and \
                len({strip_macrons(sp).lower() for sp in by_spelling}) == 1:
            w["core"] = tier0[0]
            w["why"] = "the hand-checked spelling table"
            w["settled"] = True
            continue

        # 3 — preposition government
        p = prev_word(i)
        pk = key_of(p["core"]) if p else ""
        if pk in PREPOSITIONS:
            want = None
            if pk in _PREP_ACC:
                want = "acc"
            elif pk in _PREP_ABL:
                want = "abl"
            elif pk in _PREP_BOTH:
                # the -a/-ā and -o/-ō pairs have no accusative *singular* reading
                # (that would be -am / -um), so in / sub / super take the
                # ablative here; an accusative plural of some other word is not
                # a reason to hesitate
                want = "abl" if not any(_has(ps, case="acc", number="sg")
                                        for ps in by_spelling.values()) else None
            if want:
                hit = [sp for sp, ps in by_spelling.items() if _has(ps, case=want, number="sg")] or \
                      [sp for sp, ps in by_spelling.items() if _has(ps, case=want)]
                if len(set(hit)) == 1:
                    w["core"] = hit[0]
                    w["why"] = f"after the preposition {p['core']} ({want}.)"
                    w["settled"] = True
                    continue

        # 4 — agreement with an unambiguous ablative neighbour.  Only an
        #     adjective agrees with a noun this way: two nouns side by side
        #     ("in Arabiā littera prīma est") are not a phrase, and treating
        #     them as one turned every noun after a prepositional phrase into
        #     an ablative.
        def parses_of(x: dict) -> list[dict]:
            return [q for _, qs in (x.get("cands") or []) for q in qs]

        def is_adj(x: dict) -> bool:
            return any(p.get("pos") in ("ADJ", "PRON", "NUM") for p in parses_of(x))

        def only_ablative(x: dict) -> bool:
            """The neighbour's settled spelling has no reading but an ablative."""
            if key_of(x["core"]) in ABL_ANCHORS:
                return True
            ps = [q for sp, qs in (x.get("cands") or []) if sp == x["core"] for q in qs]
            cases = {q["case"] for q in ps if q.get("case")}
            return bool(cases) and cases == {"abl"} and x.get("settled")

        me_adj = any(p.get("pos") in ("ADJ", "PRON", "NUM") for ps in by_spelling.values() for p in ps)
        neigh = [x for x in (prev_word(i), next_word(i)) if x]
        if any((me_adj or is_adj(n)) and only_ablative(n) for n in neigh):
            hit = [sp for sp, ps in by_spelling.items() if _has(ps, case="abl", number="sg")]
            if len(set(hit)) == 1:
                w["core"] = hit[0]
                w["why"] = "agrees with an ablative neighbour"
                w["settled"] = True
                continue

        # 4b — an adjective agrees with the settled noun beside it in case,
        #      number and gender ("ante Kalendās Iūniās")
        if me_adj:
            done_it = False
            for n in neigh:
                ps = [q for sp, qs in (n.get("cands") or []) if sp == n["core"] for q in qs]
                keys = {(q.get("case"), q.get("number"), q.get("gender")) for q in ps
                        if q.get("case") and q.get("gender")}
                if not n.get("settled") or len(keys) != 1:
                    continue
                c_, num, gen = keys.pop()
                hit = [sp for sp, qs in by_spelling.items()
                       if _has(qs, case=c_, number=num, gender=gen)]
                if len(set(hit)) == 1:
                    w["core"] = hit[0]
                    w["why"] = f"agrees with {n['core']} ({c_}. {num}. {gen}.)"
                    w["settled"] = True
                    done_it = True
                    break
            if done_it:
                continue

        # 4c — the vocative particle Ō is followed by a vocative ("Ō amīce")
        if p and strip_macrons(p["core"]).lower() in ("o", "oh"):
            hit = [sp for sp, ps in by_spelling.items() if _has(ps, case="voc", number="sg")]
            if len(set(hit)) == 1:
                w["core"] = hit[0]
                w["why"] = "a vocative after Ō"
                w["settled"] = True
                continue

        # 5a — a one-letter a / e beside a name or an ablative is the preposition
        if len(key_of(w["core"])) == 1 and any(p.get("pos") == "PREP" for ps in by_spelling.values() for p in ps):
            nxt = next_word(i)
            if nxt and (nxt["core"][:1].isupper() or _has(parses_of(nxt), case="abl")):
                hit = [sp for sp, ps in by_spelling.items() if _has(ps, pos="PREP")]
                if len(set(hit)) == 1:
                    w["core"] = hit[0]
                    w["why"] = "a preposition before an ablative"
                    w["settled"] = True
                    continue

        # 6 — same word, the readings differ only in the last vowel's length
        #     (vīlla / vīllā, quoque / quōque): with nothing to anchor an
        #     ablative, take the short reading.  Measured on the macronised
        #     Familia Romana text (data/build/review-*.json), an -a/-ā word with
        #     no preposition and no ablative neighbour is the short
        #     (nominative / vocative) form in 89 % of cases.
        #     Only for *nominal* readings: a verb, an adverb or an interjection
        #     that differs in its last vowel (salvē / salve, venī / vēnī) is a
        #     different word, not a case, and goes to the frequency test below.
        all_nominal = all(any(q.get("case") for q in ps) for ps in by_spelling.values())
        if all_nominal and len({strip_macrons(sp) for sp in by_spelling}) == 1 and \
                len({sp[:-1] for sp in by_spelling}) == 1:
            short = min(by_spelling, key=lambda sp: (sp[-1] in MACRON_VOWELS, sp))
            w["core"] = short
            w["why"] = "no ablative anchor — the short reading"
            w["settled"] = True
            rep["short_default"][short] += 1
            continue

        # 6b — a lexical ambiguity the sentence cannot settle (salvē / salve,
        #      venī / vēnī, hic / hīc): the clean corpora decide it when one
        #      reading is at least three times as well attested as the rest.
        #      Readings of *different* words (a repair the rules reached more
        #      than one way, Hiic → hoc / hāc) are weighed by how well the whole
        #      word is attested, not by that one spelling.
        skeletons = {strip_macrons(sp).lower() for sp in by_spelling}
        if len(skeletons) == 1:
            counts = {sp: sum(n for f, n in mac.corpus.get(key_of(sp), {}).items()
                              if f.lower() == sp.lower()) for sp in by_spelling}
        else:
            counts = {sp: mac.support(sp) for sp in by_spelling}
        best = max(counts, key=lambda sp: (counts[sp], -list(by_spelling).index(sp)))
        rest = sum(v for k, v in counts.items() if k != best)
        bar = max(3, 3 * rest) if len(skeletons) == 1 else max(5, 2 * rest)
        if counts[best] >= bar:
            w["core"] = best
            w["why"] = f"attested {counts[best]}× in the clean corpora against {rest}×"
            w["settled"] = True
            rep["by_frequency"][best] += 1
            continue

        # 7 — nothing settles it.
        #     Same word, different macrons  → print it macron-less and list it.
        #     Different words (an OCR repair the rules reached two ways and
        #     neither the sentence nor the corpora prefer) → the token is *not*
        #     repaired: the word is left as the print has it and its sentence
        #     is dropped, never guessed.
        if len(skeletons) == 1:
            w["core"] = strip_macrons(next(iter(by_spelling)))
            rep["ambiguous"][w["core"] + " (" + "/".join(sorted(by_spelling)) + ")"] += 1
        else:
            w["unresolved"] = "/".join(sorted(by_spelling))
            w["ok"] = False
        w["settled"] = True


# ===========================================================================
# 6.  Page geometry
# ===========================================================================
HEAD_Y, FOOT_Y = 45.0, 555.0
MAIN_SIZE = (7.9, 8.4)
ROW_TOL = 4.5


def main_words(page) -> list[dict]:
    """The reading's words on one page: the main column only, whatever their size.

    The column's x-range is measured from the 8.x pt body words; the marginal
    glosses (9.0 pt, outer margin) fall outside it and are dropped, while the
    macron capitals (Ō Ā Ē Ī, set at 9.9/10.0 pt) fall inside it and are kept.
    """
    ws = [w for w in page.extract_words(x_tolerance=1.0, extra_attrs=["size"])
          if HEAD_Y < w["top"] < FOOT_Y]
    body = [w for w in ws if MAIN_SIZE[0] <= w["size"] <= MAIN_SIZE[1]]
    if not body:
        return []
    lo = min(w["x0"] for w in body) - 2.0
    hi = max(w["x1"] for w in body) + 2.0
    return [big_capital(w) for w in ws if w["x0"] >= lo and w["x1"] <= hi]


# A capital with an overbar (Ō Ā Ē Ī) does not fit the 8.x pt line, so the book
# sets it in a larger face; the OCR reads it as a bare capital (and Ō sometimes
# as a zero, Ī as an l).  Inside the main column, a lone capital vowel at 9.5 pt
# or more is always one of those four — checked against the rendered pages.
_BIG_CAP = {"A": "Ā", "E": "Ē", "I": "Ī", "O": "Ō", "U": "Ū", "0": "Ō", "l": "Ī", "1": "Ī"}
_LONE_CAP = re.compile(r"^([\"“'‘]*)([A-Z0l1])([,.!?;:\"”’]*)$")


def big_capital(w: dict) -> dict:
    if w["size"] < 9.5:
        return w
    m = _LONE_CAP.match(w["text"])
    if not m or m.group(2) not in _BIG_CAP:
        return w
    return {**w, "text": m.group(1) + _BIG_CAP[m.group(2)] + m.group(3)}


class Row:
    __slots__ = ("top", "x0", "words", "page")

    def __init__(self, page, words):
        self.page = page
        self.words = sorted(words, key=lambda w: w["x0"])
        self.top = min(w["top"] for w in words)
        self.x0 = min(w["x0"] for w in words)

    @property
    def text(self) -> str:
        return " ".join(w["text"] for w in self.words)


def page_rows(page, page_no: int) -> list[Row]:
    rows: list[Row] = []
    cur: list[dict] = []
    for w in sorted(main_words(page), key=lambda w: (w["top"], w["x0"])):
        if cur and w["top"] - min(x["top"] for x in cur) > ROW_TOL:
            rows.append(Row(page_no, cur))
            cur = []
        cur.append(w)
    if cur:
        rows.append(Row(page_no, cur))
    return rows


_HEADING = re.compile(r"^COLLOQV", re.I)
_PERSONAE = re.compile(r"^Pers[^\s:]{0,4}nae\s*[:.]", re.I)


def is_heading(text: str) -> bool:
    t = text.replace(" ", "")
    return bool(_HEADING.match(t)) or t.isupper() and len(t) > 6


# ===========================================================================
# 7.  Locating the colloquia
# ===========================================================================
def colloquium_pages(pdf, notes: list[str]) -> dict[int, list[int]]:
    """colloquium → 1-based pages, from the COLLOQVIVM headings; the reading
    stops at the DECLINATIONES appendix."""
    starts: list[int] = []
    end = len(pdf.pages) + 1
    for i, page in enumerate(pdf.pages):
        if i < 6:                                  # pp. 1–6 are front matter
            continue
        rows = page_rows(page, i + 1)
        text = " ".join(r.text for r in rows).replace(" ", "")
        if re.search(r"COLLOQV[I1l]VM", text, re.I):
            starts.append(i + 1)
        head = (page.extract_text(x_tolerance=1.0) or "").replace(" ", "")
        if "DECLINATIONES" in head.upper() or "DECLlNATIONES" in head:
            end = i + 1
            break
    if len(starts) != 24:
        notes.append(f"found {len(starts)} COLLOQVIVM headings, expected 24: {starts}")
    out: dict[int, list[int]] = {}
    for k, p in enumerate(starts[:24], start=1):
        stop = starts[k] - 1 if k < len(starts) else end - 1
        out[k] = list(range(p, stop + 1))
    return out


_INDEX_NUM = {"l": "1", "I": "1", "O": "0", "o": "0", "S": "5", "|": "1"}


def parse_index(pdf) -> dict[int, tuple[list[str], int]]:
    """The printed *Index colloquiōrum* (p. 5): colloquium → (speakers, page).
    Used only to cross-check `colloquium_pages`; never to override it."""
    text = pdf.pages[4].extract_text(x_tolerance=1.0) or ""
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    out: dict[int, tuple[list[str], int]] = {}
    cur: int | None = None
    speakers: list[str] = []
    for ln in lines:
        m = re.match(r"Colloquium\s+([IVXL]+)\s*$", ln)
        if m:
            if cur is not None and speakers:
                out[cur] = (speakers, out.get(cur, ([], 0))[1])
            cur = ROMAN.index(m.group(1)) + 1 if m.group(1) in ROMAN else None
            speakers = []
            continue
        if cur is None:
            continue
        digits = "".join(_INDEX_NUM.get(c, c) for c in ln)
        if re.fullmatch(r"\d{1,3}", digits):
            out[cur] = (speakers, int(digits))
            cur = None
            speakers = []
        else:
            speakers += [s.strip() for s in ln.split(",") if s.strip()]
    return out


# ===========================================================================
# 8.  Blocks, tokens and units
# ===========================================================================
def mark_blocks(rows: list[Row], stats: dict) -> list[tuple[Row, bool]]:
    """→ [(row, starts a block?)].  The Colloquia are set with a *hanging*
    indent: a speaker's turn begins flush at the column edge, its runover lines
    are indented about 8–9 pt.  So a row within 4 pt of the page's left edge
    starts a block; so does a row after a vertical gap of more than 1.6 line
    pitches (the set-off narration paragraphs)."""
    out: list[tuple[Row, bool]] = []
    for page_no in sorted({r.page for r in rows}):
        prs = [r for r in rows if r.page == page_no]
        if not prs:
            continue
        edge = min(r.x0 for r in prs)
        pitches = sorted(b.top - a.top for a, b in zip(prs, prs[1:]) if b.top > a.top)
        pitch = pitches[len(pitches) // 2] if pitches else 16.0
        for k, r in enumerate(prs):
            flush = r.x0 - edge < 4.5
            gap = k > 0 and (r.top - prs[k - 1].top) > 1.6 * pitch
            start = flush or gap or not out
            if start:
                stats["block_flush" if flush else ("block_gap" if gap else "block_first")] += 1
            out.append((r, start))
    return out


_QUOTE_FIX = [
    (re.compile(rf"(?<=[.!?,;:{LETTERS}])w(?=\s|$)"), '"'),
    (re.compile(rf"(?<!\S)w(?=[{LETTERS}])"), '"'),
]


def clean_row(text: str) -> str:
    text = normalise(text.replace("^", " "))
    text = text.replace("''", '"').replace("``", '"')       # the scan's quotation marks
    text = re.sub(r"(?<=\s)-(?=\s)", "—", text)              # Ørberg's em dash
    text = re.sub(r"\s+([,;:.!?])", r"\1", text)                    # "est ."  → "est."
    text = re.sub(rf"([{LETTERS}][,;:])(?=[{LETTERS}\"])", r"\1 ", text)   # "Fīliī,quī"
    text = re.sub(rf"(?<=[{LETTERS}])'(?=[{LETTERS}])", "", text)           # "f'imi"
    # a closing quote the scan set off from its stop ("est ! " -> "est!"),
    # never an opening one ('. "Ubi est ...' keeps its space)
    text = re.sub(rf"(?<=[.!?…])\s+([\"'])(?![{LETTERS}])", r"\1", text)
    text = re.sub(rf"(?<=[{LETTERS}])/(?=[{LETTERS}])", " ", text)          # "Hoc/dīcēns"
    text = re.sub(r"(?<=[a-zāēīōūȳ])(?=[!1|][A-ZĀĒĪŌŪȲ])", " ", text)   # "Quia!Ulius"
    return norm_ws(text)


def join_rows(rows: list[Row], rep: dict) -> str:
    """Join a block's rows, gluing words the printing broke across lines.
    The scan keeps the soft hyphen most of the time and loses it sometimes;
    a lost one is glued only when the two halves make a word the index knows."""
    out = ""
    for r in rows:
        t = clean_row(r.text)
        if not out:
            out = t
            continue
        if out.endswith(SOFT_HYPHEN) or (out.endswith("-") and t[:1].islower()):
            out = out.rstrip(SOFT_HYPHEN + "-") + t
        else:
            out = out + " " + t
    return out.replace(SOFT_HYPHEN, "")


def glue_broken(text: str, mac: Macrons, rep: dict) -> str:
    """"marga rItas" → "margarItas": two halves of one printed word the text
    layer split.  Only when neither half is a word and the join is one."""
    toks = text.split(" ")
    out: list[str] = []
    i = 0
    while i < len(toks):
        a = toks[i]
        b = toks[i + 1] if i + 1 < len(toks) else None
        if b:
            ka, kb, kj = key_of(a), key_of(b), key_of(a + b)
            c = toks[i + 2] if i + 2 < len(toks) else None
            if (ka and kb and kj and mac.knows(kj) and a[-1:].isalpha() and b[:1].islower()
                    and (kj in WORD_FIXES or not mac.knows(ka) or not mac.knows(kb)
                         or (len(ka) == 1 and len(kb) == 1))):
                out.append(a + b)
                rep["glued"].append(f"{a} {b} → {a + b}")
                i += 2
                continue
            # three fragments of one word ("n umm um" → "nummum")
            if (c and ka and kb and c[:1].islower() and b[-1:].isalpha()
                    and not mac.knows(ka) and not mac.knows(kb)
                    and mac.knows(key_of(a + b + c))):
                out.append(a + b + c)
                rep["glued"].append(f"{a} {b} {c} → {a + b + c}")
                i += 3
                continue
        out.append(a)
        i += 1
    return " ".join(out)


_SPEAKER_RE = re.compile(r"^([^:\"“”]{1,60}?):\s")


def canonical_name(tok: str, mac: Macrons) -> str | None:
    """A printed (possibly mangled, possibly inflected) name → its nominative."""
    tok = normalise(tok)
    k = key_of(tok)
    vkey = re.sub(r"[^a-z0-9!|]", "", strip_macrons(tok).lower())
    for cand in (k, vkey):
        if cand in WORD_FIXES:
            cand = key_of(WORD_FIXES[cand])
        if cand in mac.name_lemma:
            return mac.name_lemma[cand]
    for sp, _ in (Repair(mac)._by_rules(tok) if vkey else []):
        cand = key_of(sp)
        if cand in WORD_FIXES:
            cand = key_of(WORD_FIXES[cand])
        if cand in mac.name_lemma:
            return mac.name_lemma[cand]
    return None


def speaker_of(text: str, mac: Macrons) -> tuple[str | None, str, bool]:
    """The printed name before the colon that opens a turn → the canonical
    nominative.  A *bare* label ("Mārcus:") is dropped from the text — the
    speaker is carried in `unit.speaker`; a narrative lead-in that happens to
    end in a colon ("Iūlia Syram interrogat:") is kept as it is printed."""
    m = _SPEAKER_RE.match(text)
    if not m:
        return None, text, False
    label = m.group(1).strip()
    if len(label.split()) > 10:
        return None, text, False
    for tok in re.findall(f"[{LETTERS}0-9!|]+", label):
        name = canonical_name(tok, mac)
        if name:
            bare = len(re.findall(f"[{LETTERS}0-9!|]+", label)) == 1
            return name, (text[m.end():] if bare else text), bare
    return None, text, False


def build_units(blocks: list[dict], n: int, part: str, mac: Macrons, rep: dict) -> list[dict]:
    """One block per speaker turn → sentences → units."""
    rp = Repair(mac)
    units: list[dict] = []
    for bi, blk in enumerate(blocks, start=1):
        speaker, body, bare = speaker_of(blk["text"], mac)
        # --- token pass over the whole block, so context crosses sentence bounds
        words: list[dict] = []
        for j, tok in enumerate(body.split(" ")):
            prev = words[-1] if words else None
            initial = j == 0 or (prev is not None
                                 and bool(re.search(r"[.!?…][\"'”’»)]*$", prev["core"] + prev["post"])))
            w = rp.token(tok, initial=initial)
            w["is_word"] = bool(key_of(w["core"]))
            w["breaks"] = bool(re.search(r"[.!?…;:,]", w["post"]))
            words.append(w)
        disambiguate(words, mac, rep)
        for w in words:
            if w.get("cands") and not w.get("settled"):
                w["core"] = w["cands"][0][0]
        text = norm_ws(" ".join(w["pre"] + w["core"] + w["post"] for w in words))
        bad = [w["raw"] for w in words if not w["ok"]]
        for w in words:
            if w.get("unresolved"):
                rp.unreadable[f"{w['raw']} (→ {w['unresolved']}?)"] += 1
        # --- sentences
        sents = split_sentences(text, latin=True)
        kept = 0
        for s in sents:
            broken = [b for b in bad if b in s]
            if broken:
                rep["dropped"].append((blk["page"], s[:110], "unreadable: " + ", ".join(dict.fromkeys(broken))[:80]))
                continue
            # last line of defence: a digit or a replacement character in the
            # finished Latin means a letter we never placed
            left = re.findall(r"[0-9|�]+", s)
            if left:
                rep["dropped"].append((blk["page"], s[:110], "unplaced characters: " + " ".join(left)))
                continue
            kept += 1
            units.append({
                "id": f"c{n:02d}:b{bi}.{kept}",
                "order": len(units),
                "part": part,
                "source": "CP",
                "line_no": None,
                "block_start": kept == 1,
                "unit_type": "speech",
                "speaker": speaker,
                "la": s,
                "en": "",
                "en_raw": None,
                "note": None,
                "tags": [],
                "margin": [],
                "lines": [],
            })
        if kept == 0 and sents:
            rep["blocks_lost"] += 1
    rep["repaired"] = dict(rp.repaired.most_common())
    rep["unmacronised"].update(rp.unmacronised)
    rep["unreadable"].update(rp.unreadable)
    # a block whose first sentence was dropped still needs a block start
    seen: set[str] = set()
    for u in units:
        b = u["id"].split(".")[0]
        u["block_start"] = b not in seen
        seen.add(b)
    for i, u in enumerate(units):
        u["order"] = i
    return units


# ===========================================================================
# 9.  One colloquium
# ===========================================================================
def build_colloquium(n: int, pdf, pages: list[int], mac: Macrons, index: dict, dump: bool = False):
    notes: list[str] = []
    rep = {"n": n, "pages": pages, "rows": 0, "blocks": 0, "units": 0, "dropped": [],
           "unmacronised": Counter(), "unreadable": Counter(), "ambiguous": Counter(),
           "short_default": Counter(), "by_frequency": Counter(),
           "repaired": {}, "glued": [], "notes": notes, "speakers": [], "blocks_lost": 0,
           "block_flush": 0, "block_gap": 0, "block_first": 0}
    rows: list[Row] = []
    printed_speakers: list[str] = []
    for p in pages:
        for r in page_rows(pdf.pages[p - 1], p):
            t = clean_row(r.text)
            if _PERSONAE.match(t):
                printed_speakers = [s.strip(" .,") for s in t.split(":", 1)[1].split(",") if s.strip(" .,")]
                continue
            if is_heading(t):
                continue
            rows.append(r)
    rep["rows"] = len(rows)
    if dump:
        for r in rows:
            print(f"  p{r.page} y{r.top:6.1f} x{r.x0:6.1f} {r.text}")

    marked = mark_blocks(rows, rep)
    blocks: list[dict] = []
    for r, start in marked:
        if start or not blocks:
            blocks.append({"page": r.page, "rows": []})
        blocks[-1]["rows"].append(r)
    for b in blocks:
        b["text"] = glue_broken(join_rows(b["rows"], rep), mac, rep)
    rep["blocks"] = len(blocks)

    part = f"Colloquium {ROMAN[n - 1]}"
    units = build_units(blocks, n, part, mac, rep)
    rep["units"] = len(units)

    # speakers: the printed Persōnae line, canonicalised, checked against the labels
    canon: list[str] = []
    for s in printed_speakers:
        name = canonical_name(s, mac)
        if name is None:
            notes.append(f"speaker {s!r} in the printed Persōnae line is not in the cast table — kept as printed")
        canon.append(name or s)
    used = list(dict.fromkeys(u["speaker"] for u in units if u["speaker"]))
    if not canon:
        canon = used
        notes.append("no Persōnae line in the text layer — the speakers are the ones the turns name")
    missing = [s for s in used if s not in canon]
    if missing:
        notes.append(f"speakers named in the turns but not in the printed Persōnae line: {', '.join(missing)}")
    rep["speakers"] = canon
    if n in index:
        want_pages = index[n][1]
        if want_pages != pages[0]:
            notes.append(f"the printed index puts this colloquium on p. {want_pages}, the headings on p. {pages[0]}")

    key, label, pp = FOCUS[n]
    week = {
        "n": 200 + n,
        "id": f"c{n:02d}",
        "title": f"Colloquium {ROMAN[n - 1]} · {', '.join(canon)}",
        "source": "CP",
        "chapter": ROMAN[n - 1],
        "has_line_numbers": False,
        "focus": {"key": key, "label": label,
                  "blurb": f"Read after Familia Romana chapter {ROMAN[n - 1]}; "
                           f"the same grammar as week {n} of the course."},
        "parts": [{"part": part, "lines": None, "source": "CP"}],
    }
    return {"week": week, "units": units}, rep


# ===========================================================================
# 10.  Validation, SQL, report
# ===========================================================================
def validate(data: dict, path: Path) -> list[str]:
    errs: list[str] = []
    wk, units = data["week"], data["units"]
    n = wk["n"] - 200
    if not (201 <= wk["n"] <= 224) or wk["id"] != f"c{n:02d}":
        errs.append(f"week n/id mismatch: {wk['n']} {wk['id']}")
    if wk["source"] != "CP":
        errs.append(f"week.source is {wk['source']!r}, must be 'CP'")
    if wk["chapter"] != ROMAN[n - 1]:
        errs.append(f"week.chapter {wk['chapter']!r} is not the Familia Romana chapter {ROMAN[n - 1]}")
    if wk["has_line_numbers"] is not False:
        errs.append("has_line_numbers must be false — the 2005 printing has none")
    for k in ("title", "focus", "parts"):
        if not wk.get(k):
            errs.append(f"week.{k} missing")
    seen: set[str] = set()
    for i, u in enumerate(units):
        if u["order"] != i:
            errs.append(f"{u['id']}: order {u['order']} != {i}")
        if u["id"] in seen:
            errs.append(f"{u['id']}: duplicate id")
        seen.add(u["id"])
        if not re.fullmatch(rf"c{n:02d}:b\d+\.\d+", u["id"]):
            errs.append(f"{u['id']}: id shape")
        if not u["la"].strip():
            errs.append(f"{u['id']}: empty la")
        if u["unit_type"] != "speech":
            errs.append(f"{u['id']}: unit_type {u['unit_type']!r}, must be 'speech'")
        if u["en"] != "" or u["note"] is not None or u["tags"] != [] or u["margin"] != []:
            errs.append(f"{u['id']}: en/note/tags/margin must be empty for the colloquia shelf")
        if u["line_no"] is not None or u["lines"] != []:
            errs.append(f"{u['id']}: this book has no line numbers")
        if re.search(r"[0-9|�]", u["la"]):
            errs.append(f"{u['id']}: junk characters survived: {u['la'][:60]!r}")
    if units and not units[0]["block_start"]:
        errs.append("first unit is not a block start")
    try:
        stmts = seed_sql.week_sql(wk["n"], path)
        rows = sum(s.count(f"\n({seed_sql.USER}, '{wk['id']}:") for s in stmts)
        if rows != len(units):
            errs.append(f"seed SQL would insert {rows} unit rows for {len(units)} units")
        if not all(s.rstrip().endswith(";") for s in stmts):
            errs.append("a seed SQL chunk does not end in ';'")
    except Exception as e:  # noqa: BLE001
        errs.append(f"seed_sql.week_sql failed: {e}")
    return errs


def write_sql(n: int, path: Path) -> int:
    out = seed_sql.OUT
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob(f"c{n:02d}-*.sql"):
        old.unlink()
    parts = seed_sql.week_sql(200 + n, path)
    for i, sql in enumerate(parts):
        (out / f"c{n:02d}-{i:02d}.sql").write_text(sql, encoding="utf-8")
    return len(parts)


def report_section(rep: dict, errs: list[str]) -> str:
    n = rep["n"]
    L = [f"## Colloquium {ROMAN[n - 1]} (c{n:02d}, week {200 + n})\n"]
    L.append(f"- pages {rep['pages'][0]}–{rep['pages'][-1]}; speakers: {', '.join(rep['speakers']) or '—'}")
    L.append(f"- rows {rep['rows']}; blocks {rep['blocks']} "
             f"(flush left: {rep['block_flush']}, after a gap: {rep['block_gap']}); units {rep['units']}")
    L.append(f"- sentences dropped: {len(rep['dropped'])}; tokens repaired: {sum(rep['repaired'].values())}; "
             f"tokens kept unmacronised: {sum(rep['unmacronised'].values())}; "
             f"macrons left undecided: {sum(rep['ambiguous'].values())}")
    if errs:
        L.append(f"- VALIDATION: {len(errs)} problem(s)")
        L += [f"  - {e}" for e in errs]
    if rep["dropped"]:
        L.append("\nSentences left out:\n")
        L += [f"- p{p}: {s} — {why}" for p, s, why in rep["dropped"]]
    if rep["unreadable"]:
        L.append("\nTokens the rule table could not read:\n")
        L.append("- " + ", ".join(f"{t}×{c}" if c > 1 else t for t, c in rep["unreadable"].most_common()))
    if rep["unmacronised"]:
        L.append("\nTokens kept as printed, no macrons the index attests:\n")
        L.append("- " + ", ".join(f"{t}×{c}" if c > 1 else t for t, c in rep["unmacronised"].most_common(80)))
    if rep["ambiguous"]:
        L.append("\nMacrons left undecided (several readings, no agreement to choose one):\n")
        L.append("- " + ", ".join(f"{t}×{c}" if c > 1 else t for t, c in rep["ambiguous"].most_common(60)))
    if rep["glued"]:
        L.append("\nWords the text layer split, glued back:\n")
        L.append("- " + "; ".join(dict.fromkeys(rep["glued"]))[:1500])
    if rep["repaired"]:
        L.append("\nOCR repairs made (printed → cleaned):\n")
        L.append("- " + "; ".join(f"{t}" + (f" ×{c}" if c > 1 else "")
                                  for t, c in list(rep["repaired"].items())[:150]))
    if rep["notes"]:
        L.append("\nNotes:\n")
        L += [f"- {x}" for x in dict.fromkeys(rep["notes"])]
    L.append("")
    return "\n".join(L) + "\n"


def update_report(key: str, section: str) -> None:
    path = BUILD / "collo-REPORT.md"
    start, end = f"<!-- {key} -->", f"<!-- /{key} -->"
    body = path.read_text(encoding="utf-8") if path.exists() else \
        "# Colloquia Personarum I–XXIV — build report\n\n"
    block = f"{start}\n{section}{end}\n"
    if start in body and end in body:
        body = body[:body.index(start)] + block + body[body.index(end) + len(end):].lstrip("\n")
    else:
        body = body.rstrip("\n") + "\n\n" + block
    path.write_text(body, encoding="utf-8")


def render_pages(pdf_path: Path, pages: list[int], out_dir: Path, dpi: int = 200) -> list[Path]:
    import fitz  # PyMuPDF
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(str(pdf_path))
    files = []
    for p in pages:
        f = out_dir / f"p{p:03d}.png"
        doc[p - 1].get_pixmap(dpi=dpi).save(str(f))
        files.append(f)
    return files


# ===========================================================================
# 11.  main
# ===========================================================================
def scan_path() -> Path:
    if SCAN.exists():
        return SCAN
    if SCAN_ALT.exists():
        return SCAN_ALT
    raise SystemExit(f"colloquia scan not found: put it at {SCAN}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("colloquia", nargs="*", type=int, help="colloquium numbers 1–24 (default all)")
    ap.add_argument("--sql", action="store_true", help="also write data/build/sql/cNN-*.sql")
    ap.add_argument("--check", action="store_true",
                    help="build, validate and report without writing the JSON or the SQL")
    ap.add_argument("--dump", action="store_true", help="print every classified row")
    ap.add_argument("--render", type=Path, help="render the colloquia's pages to PNG in this directory")
    a = ap.parse_args(argv)
    import pdfplumber

    nums = a.colloquia or list(range(1, 25))
    bad = [c for c in nums if not 1 <= c <= 24]
    if bad:
        ap.error(f"colloquia must be 1–24: {bad}")
    pdf = pdfplumber.open(str(scan_path()))
    mac = Macrons(ROOT, quiet=False)
    notes: list[str] = []
    pages = colloquium_pages(pdf, notes)
    index = parse_index(pdf)
    for note in notes:
        print(f"! {note}")
    BUILD.mkdir(parents=True, exist_ok=True)

    rc = 0
    for n in nums:
        data, rep = build_colloquium(n, pdf, pages[n], mac, index, dump=a.dump)
        path = BUILD / f"collo-{n:02d}.json"
        if not a.check:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
            errs = validate(data, path)
        else:
            tmp = BUILD / f".collo-{n:02d}.check.json"
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
            errs = validate(data, tmp)
            tmp.unlink(missing_ok=True)
        n_sql = write_sql(n, path) if (a.sql and not a.check) else 0
        if not a.check:
            update_report(f"collo:c{n:02d}", report_section(rep, errs))
        if errs:
            rc = 1
        print(f"coll. {ROMAN[n - 1]:>6} (c{n:02d}): pp. {rep['pages'][0]}–{rep['pages'][-1]}, "
              f"{len(rep['speakers'])} speakers, {rep['blocks']} blocks, {rep['units']} units, "
              f"dropped {len(rep['dropped'])}, unmacronised {sum(rep['unmacronised'].values())}, "
              f"undecided {sum(rep['ambiguous'].values())}"
              + (f", {n_sql} sql files" if n_sql else "")
              + (f", {len(errs)} VALIDATION ERRORS" if errs else ""))
        for e in errs[:6]:
            print(f"    ! {e}")
        if a.render:
            files = render_pages(scan_path(), rep["pages"], a.render / f"collo-{n:02d}")
            print(f"   rendered {len(files)} pages → {a.render / f'collo-{n:02d}'}")
    return rc


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
