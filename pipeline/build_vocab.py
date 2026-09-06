#!/usr/bin/env python
"""
build_vocab.py — chapter vocabulary decks for the grammar section (wave 2, P).

    python pipeline/build_vocab.py              # chapters 1–34 → app/data/grammar/vocab/NN.json
    python pipeline/build_vocab.py 1 7 30       # selected chapters (the library is still read whole)
    python pipeline/build_vocab.py --check      # validate the committed files only
    python pipeline/build_vocab.py --report     # print every deck (lemma, dict, count) after building

Shape: docs/GRAMMAR-CONTRACT.md, "Vocabulary deck vocab/NN.json".

Where a word belongs
  The library is read in chapter order — chapters 1–24 from the review shelf
  (data/build/review-NN.json), 25–34 from the course weeks
  (data/build/week-NN.json, chapter = the Roman numeral that opens
  week.chapter; a Fabulae Syrae / Fabellae week belongs to its FR chapter,
  and inside a chapter the Familia Romana units come first).  Every token is
  lemmatised and a lemma belongs to the first chapter it occurs in; its
  `unit_id` is the first sentence of that chapter that contains it and
  `count` is its number of occurrences in the whole library (1–34).

Lemmatising
  A token's readings are the glossary's entries for its form
  (app/data/glossary.json, already ranked with build_glossary's PREFERRED /
  SENSE_OVERRIDES); a form the glossary lacks (the shelf's chapters were not
  in the glossary's token set) is analysed with Whitaker through
  build_glossary's own analyse / build_entry / rank_and_filter, so the entry
  has the same shape and spelling rules; those analyses are cached in
  data/build/vocab-whitaker.json.  When a form has several readings
  (servī: serviō imper. / servus gen.) the glossary's first reading is kept
  unless another reading's lemma is far better attested by unambiguous forms
  elsewhere in the library (servus, servum, servōs …: at least three times
  the first reading's anchors, and at least three); pronoun readings are
  always the glossary's first (its PREFERRED order separates quī from quis);
  a form whose first reading is a numeral is a numeral (ūna, secundus stay
  out unless the glossary lists the adjective first); FORM_OVERRIDES pins
  the few forms the glossary ranks oddly (ecce → hic).
  Left out: proper names (a form that is capitalised in every occurrence and
  occurs somewhere other than sentence-initially, or whose reading is a
  capitalised noun — except the adjectives of nationality, NATIONAL_ADJ),
  numerals (pos NUM, Roman numerals), enclitics (the -que / -ne / -ve the
  glossary splits off; the host word is counted), gloss abbreviations
  (ABBR / ENDING / PREFIX / STEM), and single letters.

Where a word belongs, exactly
  A word's identity is `lemma_key` = (headword, pos), macrons off and v/u
  levelled — never the dictionary string — so a lemma belongs to one chapter
  only: the first it occurs in.  A comparative or superlative is learnt with
  its positive (maior under magnus, saepissimē under saepe); DEGREE_POSITIVE
  folds the few a week supplement lists as headwords of their own, and the
  build prints the handful whose positive never occurs in the library at all.
  `check()` re-derives the same key from a shipped deck's own `lemma` field,
  so a duplicate is an error there too (pipeline/test_build_vocab.py plants
  one).

Dictionary forms — one shape per part of speech, the way a textbook writes it
  nouns "puella, -ae f." / "frāter, frātris m." / "nihil n. (indeclinable)";
  adjectives "magnus, -a, -um" / "omnis, -e" / "fēlīx, gen. fēlīcis";
  verbs their principal parts "amō, amāre, amāvī, amātum" (deponents
  "sequor, sequī, secūtus sum"), also carried in `parts`; prepositions
  "in (+ acc./abl.)"; adverbs, conjunctions and particles the plain word.
  `dict_form` builds them from the glossary entry, never by re-joining its
  lemma string, and `check_dict_line` verifies every one: no stray comma, no
  `·`, no "comparative".  `decl` is the declension of nouns and adjectives.

Meanings
  `meaning` is a teaching gloss: at most three senses, comma-separated, lower
  case, no abbreviations and no parenthetical grammar notes — short enough to
  be a drill prompt.  GLOSS_OVERRIDES carries the ones judged by hand against
  the word's own library sentence (accidit "happens", lūdus "school", taberna
  "shop"); the rest are cut from the glossary's preferred sense by
  `short_gloss`.  `sense_full` keeps that whole Whitaker sense line.

Nothing here touches app/js or supabase/.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from macrons import canonical, strip_macrons  # noqa: E402

BUILD = ROOT / "data" / "build"
GLOSSARY = ROOT / "app" / "data" / "glossary.json"
OUT_DIR = ROOT / "app" / "data" / "grammar" / "vocab"
WHITAKER_CACHE = BUILD / "vocab-whitaker.json"

CHAPTERS = range(1, 35)
WORD_RE = re.compile(r"[A-Za-zĀĒĪŌŪȲāēīōūȳ]+")
ROMAN_VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
SKIP_POS = {"NUM", "ABBR", "ENDING", "PREFIX", "STEM"}
SENTENCE_END = re.compile(r"[.!?…:][\"'”’»)\]]*$")
# capitalised adjectives the book lists as vocabulary (never proper names)
FORM_OVERRIDES = {"ecce": "ecce", "merces": "merx"}  # form → headword (h) to use
# Words Ørberg teaches as a noun where Whitaker ranks the adjective of the same
# headword first (amīcus "friend", not "friendly"): (headword, pos) to prefer.
POS_PREFERRED = {("amicus", "N"), ("inimicus", "N"), ("medicus", "N"), ("maritus", "N"),
                 ("asinus", "N"), ("adulescens", "N"), ("iuuenis", "N"), ("senex", "N"),
                 ("faber", "N"), ("mare", "N")}
NATIONAL_ADJ = {"romanus", "graecus", "latinus", "germanus", "gallicus", "aegyptius", "italicus",
                "christianus", "punicus", "troianus", "siculus", "britannicus", "hispanus", "iudaeus"}
# Whitaker keeps these spelling doublets apart as separate lexemes; for the deck
# they are one word, and the learner meets whichever spelling the book prints.
HEAD_ALIAS = {
    ("assum", "V"): "adsum", ("apsum", "V"): "absum", ("lacte", "N"): "lac",
    ("nil", "N"): "nihil", ("kal", "N"): "kalenda", ("menda", "N"): "mendum",
    ("eiicio", "V"): "eicio", ("abiicio", "V"): "abicio", ("uasus", "N"): "uasum",
    ("contempno", "V"): "contemno", ("reuertor", "V"): "reuerto",
}
# A comparative or superlative is not a new word: it is learnt with its positive.
# Whitaker's own degree forms already carry the positive in the lemma; these are
# the ones a week supplement lists as a headword of their own (and the suppletive
# pessimus / malus).  The fold only happens when the positive really occurs in
# the library — build() prints the ones where it never does.
DEGREE_POSITIVE = {
    ("falsior", "ADJ"): "falsus", ("stultior", "ADJ"): "stultus",
    ("pigrior", "ADJ"): "piger", ("pigerrimus", "ADJ"): "piger",
    ("uenustior", "ADJ"): "uenustus", ("ferocissimus", "ADJ"): "ferox",
    ("improbissimus", "ADJ"): "improbus", ("infidissimus", "ADJ"): "infidus",
    ("nequissimus", "ADJ"): "nequam", ("probissimus", "ADJ"): "probus",
    ("tristissimus", "ADJ"): "tristis", ("pessimus", "ADJ"): "malus",
}

# Teaching glosses judged by hand against the word's own library sentence
# (`unit_id`).  Whitaker's preferred sense line names the right *lexeme* but not
# always the sense Familia Romana uses (accidit "happens", not "falls upon";
# lūdus "school"; taberna "shop"; mercēs → merx "goods"), and its first three
# glosses are sometimes one gloss chopped in half ("loud, excessive, boisterous
# … laugh").  Keyed by the deck's own lemma and pos, normalised like lemma_key;
# everything not listed here is derived mechanically by short_gloss().
_GLOSS_SOURCE: dict[tuple[str, str], str] = {
    # I
    ("num", "ADV"): "surely not?",
    ("vocābulum", "N"): "word",
    ("paucus", "ADJ"): "few, little",
    ("prīmus", "ADJ"): "first",
    ("secundus", "ADJ"): "second, following",
    ("imperium", "N"): "command, empire",
    ("quoque", "ADV"): "also, too",
    ("ubi", "CONJ"): "where, when",
    ("parvus", "ADJ"): "small, little",
    ("capitulum", "N"): "chapter",
    # II
    ("puella", "N"): "girl",
    ("ecce", "INTERJ"): "look!, see here!",
    ("lingva", "N"): "tongue, language",
    ("domina", "N"): "mistress, lady of the house",
    ("cēterus", "ADJ"): "the other, the rest",
    ("pāgina", "N"): "page",
    ("vir", "N"): "man, husband",
    ("līber", "N"): "children",
    # III
    ("ego", "PRON"): "I",
    ("neque", "CONJ"): "and not, nor",
    ("iam", "ADV"): "now, already",
    ("audiō", "V"): "hear, listen to",
    ("plōrō", "V"): "cry, wail",
    ("irascor", "V"): "grow angry, be angry",
    ("improbus", "ADJ"): "bad, wicked",
    ("pulsō", "V"): "beat, strike, knock",
    ("verberō", "V"): "beat, flog",
    ("rīdeō", "V"): "laugh, laugh at",
    ("mamma", "N"): "mummy, mother",
    # IV
    ("dē", "PREP"): "from, down from, about",
    ("tantus", "ADJ"): "so great, so much",
    ("rūrsus", "ADV"): "again, back",
    ("salvus", "ADJ"): "safe, unharmed, well",
    ("numerō", "V"): "count",
    ("accūsō", "V"): "accuse, blame",
    ("absum", "V"): "be away, be absent",
    ("adsum", "V"): "be present, be here",
    ("sūmō", "V"): "take, take up",
    ("discēdō", "V"): "go away, depart",
    ("bonus", "ADJ"): "good",
    ("sacculus", "N"): "little bag, purse",
    ("baculum", "N"): "stick, staff",
    ("vacuus", "ADJ"): "empty",
    ("nūllus", "ADJ"): "no, none",
    ("habeō", "V"): "have, hold",
    # V
    ("pulcher", "ADJ"): "beautiful, pretty",
    ("foedus", "ADJ"): "ugly, foul",
    ("agō", "V"): "drive, do, lead",
    ("peristylum", "N"): "peristyle, colonnaded courtyard",
    ("impluvium", "N"): "water basin in the atrium",
    ("ātrium", "N"): "atrium, main room",
    ("fenestra", "N"): "window",
    ("etiam", "CONJ"): "also, even",
    ("cum", "PREP"): "with",
    ("carpō", "V"): "pick, pluck",
    ("sōlus", "ADJ"): "only, alone",
    ("vīlla", "N"): "country house, farm",
    ("imperō", "V"): "order, command",
    ("habitō", "V"): "live, dwell",
    ("hortus", "N"): "garden",
    ("dēlectō", "V"): "delight, please",
    ("ōstium", "N"): "doorway, door",
    # VI
    ("ante", "PREP"): "before, in front of",
    ("nam", "CONJ"): "for",
    ("autem", "CONJ"): "but, however",
    ("itaque", "ADV"): "and so, therefore",
    ("apud", "PREP"): "at, with, near",
    ("unde", "ADV"): "from where, whence",
    ("procul", "ADV"): "far off, far away",
    ("umerus", "N"): "shoulder",
    ("amīcus", "ADJ"): "friendly, dear",
    ("inimīcus", "N"): "enemy",
    ("lectīca", "N"): "litter, sedan chair",
    ("mūrus", "N"): "wall",
    ("vehō", "V"): "carry, convey",
    ("fessus", "ADJ"): "tired",
    ("porta", "N"): "gate",
    ("circum", "PREP"): "around, about",
    ("placeō", "V"): "please",
    ("malus", "ADJ"): "bad, evil",
    ("intrō", "V"): "enter, go in",
    ("ambulō", "V"): "walk",
    # VII
    ("exeō", "V"): "go out, leave",
    ("currō", "V"): "run, hurry",
    ("nōnne", "ADV"): "surely?",
    ("immō", "ADV"): "no indeed, on the contrary",
    ("aperiō", "V"): "open, uncover",
    ("tergeō", "V"): "wipe, wipe off",
    ("salveō", "V"): "be well",
    ("īnsum", "V"): "be in, be inside",
    ("plēnus", "ADJ"): "full",
    ("fōrmōsus", "ADJ"): "beautiful, handsome",
    ("adeō", "V"): "go to, approach",
    ("speculum", "N"): "mirror",
    ("exspectō", "V"): "wait for, await",
    ("adveniō", "V"): "arrive, come",
    ("lacrimō", "V"): "weep, cry",
    ("claudō", "V"): "close, shut",
    ("teneō", "V"): "hold, keep",
    ("vertō", "V"): "turn",
    ("parō", "V"): "prepare, get ready",
    ("illīc", "ADV"): "there, over there",
    # VIII
    ("aspiciō", "V"): "look at, catch sight of",
    ("accipiō", "V"): "receive, accept",
    ("ōrnāmentum", "N"): "ornament, jewel",
    ("gemma", "N"): "jewel, gem",
    ("medium", "N"): "middle",
    ("cōnstō", "V"): "cost, stand firm",
    ("cōnsistō", "V"): "stop, halt",
    ("nimis", "ADV"): "too much, too",
    ("aut", "CONJ"): "or",
    ("clāmō", "V"): "shout, cry out",
    ("ōrnō", "V"): "adorn, decorate",
    ("mōnstrō", "V"): "show, point out",
    ("taberna", "N"): "shop, stall",
    ("tabernārius", "N"): "shopkeeper",
    ("quantus", "ADJ"): "how great, how much",
    ("ānulus", "N"): "ring",
    ("conueniō", "V"): "fit, suit, be right",
    ("collis", "N"): "hill",
    ("abeō", "V"): "go away, depart",
    ("medius", "ADJ"): "middle, in the middle of",
    ("margarīta", "N"): "pearl",
    # IX
    ("ut", "CONJ"): "so that, in order that, as",
    ("petō", "V"): "seek, make for, attack",
    ("edō", "V"): "eat",
    ("reperiō", "V"): "find, discover",
    ("quaerō", "V"): "look for, seek, ask",
    ("vallēs", "N"): "valley",
    ("nūbēs", "N"): "cloud",
    ("clāmor", "N"): "shout, shouting",
    ("ululō", "V"): "howl",
    ("lātrō", "V"): "bark",
    ("impōnō", "V"): "put on, place upon",
    ("accurrō", "V"): "run up, run to",
    ("vestīgium", "N"): "footprint, track",
    ("dūcō", "V"): "lead, take",
    ("lūceō", "V"): "shine",
    ("sub", "PREP"): "under, beneath",
    ("caelum", "N"): "sky, heaven",
    ("campus", "N"): "field, plain",
    ("herba", "N"): "grass, plant",
    ("errō", "V"): "wander, go astray",
    ("niger", "ADJ"): "black, dark",
    ("albus", "ADJ"): "white",
    ("relinquō", "V"): "leave, leave behind",
    ("silva", "N"): "wood, forest",
    ("pāstor", "N"): "shepherd",
    ("terra", "N"): "earth, land, ground",
    ("iaceō", "V"): "lie",
    ("umbra", "N"): "shade, shadow",
    ("bālō", "V"): "bleat",
    # X
    ("enim", "CONJ"): "for, indeed",
    ("lūdō", "V"): "play",
    ("capiō", "V"): "take, seize, catch",
    ("moveō", "V"): "move, stir",
    ("canō", "V"): "sing",
    ("audeō", "V"): "dare",
    ("cadō", "V"): "fall",
    ("ascendō", "V"): "climb, go up",
    ("sustineō", "V"): "hold up, support",
    ("pariō", "V"): "give birth to, lay",
    ("aquila", "N"): "eagle",
    ("crassus", "ADJ"): "thick, fat",
    ("anima", "N"): "breath, soul, life",
    ("petasō", "N"): "ham, shoulder of pork",
    ("avius", "ADJ"): "remote, out of the way",
    ("animal", "N"): "animal, living creature",
    ("nūntius", "N"): "messenger, message",
    ("vōx", "N"): "voice, word",
    ("mercātor", "N"): "merchant, trader",
    ("faciō", "V"): "make, do",
    ("homō", "N"): "human being, person, man",
    ("mortuus", "ADJ"): "dead",
    ("flūmen", "N"): "river",
    ("pila", "N"): "ball",
    ("āla", "N"): "wing",
    ("bēstia", "N"): "animal, beast",
    ("perterreō", "V"): "terrify",
    ("ferus", "ADJ"): "wild, savage",
    ("vīvus", "ADJ"): "alive, living",
    ("rāmus", "N"): "branch",
    ("pulmō", "N"): "lung",
    ("legō", "V"): "read, gather",
    ("vīvō", "V"): "live, be alive",
    ("pullus", "ADJ"): "chick, young animal",
    # XI
    ("doleō", "V"): "hurt, feel pain, grieve",
    ("sānus", "ADJ"): "healthy, sound",
    ("colō", "V"): "cultivate, till, inhabit",
    ("arcessō", "V"): "send for, summon",
    ("horreō", "V"): "shudder at, dread",
    ("appōnō", "V"): "put beside, serve",
    ("viscus", "N"): "internal organs",
    ("gena", "N"): "cheek",
    ("vēna", "N"): "vein",
    ("labrum", "N"): "lip",
    ("venter", "N"): "belly, stomach",
    ("frōns", "N"): "forehead",
    ("membrum", "N"): "limb",
    ("palpitō", "V"): "throb, beat",
    ("dētergeō", "V"): "wipe off, wipe clean",
    ("pōculum", "N"): "cup",
    ("quiēscō", "V"): "rest, be quiet",
    ("aegrōtō", "V"): "be ill",
    ("aeger", "ADJ"): "sick, ill",
    ("sentiō", "V"): "feel, perceive",
    ("stō", "V"): "stand",
    ("bene", "ADV"): "well",
    ("modus", "N"): "way, manner",
    ("atque", "CONJ"): "and, and also",
    ("nec", "CONJ"): "and not, nor",
    ("spectō", "V"): "look at, watch",
    ("putō", "V"): "think, believe",
    ("iubeō", "V"): "order, command",
    ("ōs", "N"): "mouth, face",
    ("tuor", "V"): "look at",
    ("ruber", "ADJ"): "red",
    ("tangō", "V"): "touch",
    ("fluō", "V"): "flow",
    ("sedeō", "V"): "sit",
    ("manūs", "N"): "hand",
    ("bracchium", "N"): "arm",
    ("pectus", "N"): "chest, breast",
    ("reveniō", "V"): "come back, return",
    # XII
    ("germānus", "ADJ"): "German",
    ("armum", "N"): "arms, weapons",
    ("impetūs", "N"): "attack, charge",
    ("patior", "V"): "suffer, endure, allow",
    ("barbarus", "ADJ"): "foreign, barbarian",
    ("vester", "ADJ"): "your",
    ("avunculus", "N"): "uncle",
    ("cognōmen", "N"): "surname, family name",
    ("praenōmen", "N"): "first name",
    ("mīlitō", "V"): "serve as a soldier",
    ("incolō", "V"): "live in, inhabit",
    ("fodiō", "V"): "dig",
    ("equitō", "V"): "ride a horse",
    ("expugnō", "V"): "storm, capture",
    ("oppugnō", "V"): "attack, assault",
    ("armō", "V"): "arm, equip",
    ("iaciō", "V"): "throw, hurl",
    ("fīnis", "N"): "end, boundary",
    ("pars", "N"): "part",
    ("nōmen", "N"): "name",
    ("ac", "CONJ"): "and",
    ("fortis", "ADJ"): "strong, brave",
    ("brevis", "ADJ"): "short",
    ("altus", "ADJ"): "high, deep",
    ("trīstis", "ADJ"): "sad",
    ("levis", "ADJ"): "light",
    ("hasta", "N"): "spear",
    ("eques", "N"): "horseman",
    ("dux", "N"): "leader, general",
    ("fugiō", "V"): "flee, run away",
    ("gravis", "ADJ"): "heavy, serious",
    ("hispānus", "ADJ"): "Spanish",
    ("castrum", "N"): "camp",
    ("pedēs", "N"): "foot soldier",
    ("mīlle", "N"): "thousand",
    ("passus", "N"): "pace, step",
    ("patria", "N"): "native land, country",
    # XIII
    ("nox", "N"): "night",
    ("kalenda", "N"): "the Kalends, the first of the month",
    ("īdus", "N"): "the Ides",
    ("posterus", "ADJ"): "next, following",
    ("tempus", "N"): "time",
    ("faciēs", "N"): "face, appearance",
    ("lacūs", "N"): "lake",
    ("saeculum", "N"): "century, age",
    ("aequus", "ADJ"): "equal, level",
    ("clārus", "ADJ"): "clear, bright, famous",
    ("obscūrus", "ADJ"): "dark, dim",
    ("illūstrō", "V"): "light up, illuminate",
    ("hiems", "N"): "winter",
    ("lūx", "N"): "light, daylight",
    ("imber", "N"): "rain, shower",
    ("initium", "N"): "beginning",
    ("fōrma", "N"): "shape, form",
    ("igitur", "CONJ"): "therefore, so",
    ("maneō", "V"): "remain, stay",
    ("tōtus", "ADJ"): "whole, entire",
    ("frīgidus", "ADJ"): "cold",
    ("calidus", "ADJ"): "hot, warm",
    ("vērus", "ADJ"): "true, real",
    ("exiguus", "ADJ"): "small",
    ("meridiēs", "N"): "midday, noon",
    ("vesper", "N"): "evening",
    ("saxum", "N"): "stone, rock",
    # XIV
    ("alter", "ADJ"): "the other, the second",
    ("uter", "ADJ"): "which of the two",
    ("uterque", "ADJ"): "each of the two, both",
    ("an", "CONJ"): "or, whether",
    ("parens", "N"): "parent",
    ("afferō", "V"): "bring, bring to",
    ("valeō", "V"): "be strong, be well",
    ("gerō", "V"): "carry, wear, wage",
    ("adhūc", "ADV"): "so far, still",
    ("excitō", "V"): "wake up, rouse",
    ("apertus", "ADJ"): "open",
    ("cubō", "V"): "lie down, be in bed",
    ("nūdus", "ADJ"): "naked, bare",
    ("stilus", "N"): "stylus, pen",
    ("dexter", "ADJ"): "right, on the right",
    ("sinister", "ADJ"): "left, on the left",
    ("vigilō", "V"): "be awake, stay awake",
    ("induō", "V"): "put on, dress in",
    ("poscō", "V"): "demand, ask for",
    ("rēgula", "N"): "ruler",
    ("tunica", "N"): "tunic",
    ("frigō", "V"): "be cold",
    ("pūrus", "ADJ"): "clean, pure",
    ("soleō", "V"): "be accustomed, usually do",
    ("surgō", "V"): "get up, rise",
    ("lavō", "V"): "wash",
    ("praeter", "PREP"): "except, besides",
    ("quōmodo", "ADV"): "how",
    ("deinde", "ADV"): "then, next",
    ("omnis", "ADJ"): "every, all",
    ("tabula", "N"): "writing tablet, board",
    ("sordidus", "ADJ"): "dirty",
    ("vestīmentum", "N"): "clothes, garment",
    ("gallus", "ADJ"): "Gallic, of Gaul",
    ("mergō", "V"): "dip, plunge",
    ("vestiō", "V"): "clothe, dress",
    # XV
    ("prior", "N"): "the first of two, the former",
    ("lūdus", "N"): "school, game",
    ("reddō", "V"): "give back, return",
    ("redeō", "V"): "go back, return",
    ("nisi", "CONJ"): "if not, unless",
    ("sī", "CONJ"): "if",
    ("at", "CONJ"): "but",
    ("cōnsīdō", "V"): "sit down",
    ("dēsinō", "V"): "stop, cease",
    ("virga", "N"): "rod, stick",
    ("īnferus", "ADJ"): "lower, below",
    ("lectulus", "N"): "bed, couch",
    ("tacitus", "ADJ"): "silent",
    ("domūs", "N"): "house, home",
    ("magister", "N"): "teacher, master",
    ("discipulus", "N"): "pupil, student",
    ("sevērus", "ADJ"): "strict, severe",
    ("pūniō", "V"): "punish",
    ("sella", "N"): "chair, stool",
    ("iānua", "N"): "door",
    ("tergum", "N"): "back",
    ("antequam", "CONJ"): "before",
    ("licet", "V"): "it is allowed, one may",
    # XVI
    ("gubernō", "V"): "steer",
    ("occidō", "V"): "kill",
    ("servō", "V"): "save, keep, watch over",
    ("appellō", "V"): "call, name",
    ("tempestās", "N"): "storm, weather",
    ("turbō", "V"): "disturb, stir up",
    ("propter", "PREP"): "because of, on account of",
    ("locus", "N"): "place, spot",
    ("cernō", "V"): "discern, make out, see",
    ("flō", "V"): "blow",
    ("intueor", "V"): "gaze at, look at",
    ("portūs", "N"): "harbor, port",
    ("vēlum", "N"): "sail",
    ("vereor", "V"): "fear, be afraid of",
    ("complector", "V"): "embrace",
    ("cōnscendō", "V"): "climb, go on board",
    ("locō", "V"): "place, put",
    ("opperior", "V"): "wait for, await",
    ("praetereā", "ADV"): "besides, moreover",
    ("lābor", "V"): "slip, fall, glide",
    ("ēgredior", "V"): "go out, disembark",
    ("puppis", "N"): "stern",
    ("septentriō", "N"): "the north",
    ("serēnus", "ADJ"): "clear, bright",
    ("gubernātor", "N"): "helmsman",
    ("iactō", "V"): "throw, toss",
    ("impleō", "V"): "fill",
    ("contrārius", "ADJ"): "opposite, contrary",
    ("hauriō", "V"): "draw, drain",
    ("intersum", "V"): "be between",
    ("turbidus", "ADJ"): "stormy, wild",
    ("fulgur", "N"): "lightning",
    ("fulgurō", "V"): "flash with lightning",
    ("cōnor", "V"): "try, attempt",
    ("laetor", "V"): "be glad, rejoice",
    ("loquor", "V"): "speak, talk",
    ("ōrō", "V"): "beg, pray",
    ("simul", "ADV"): "at the same time",
    ("cōnsōlor", "V"): "comfort, console",
    ("merx", "N"): "goods, wares",
    ("proficīscor", "V"): "set out, depart",
    ("invocō", "V"): "call upon",
    ("āter", "ADJ"): "black, dark",
    # XVII
    ("quisque", "PRON"): "each, each one, every",
    ("laudō", "V"): "praise",
    ("certus", "ADJ"): "certain, sure, fixed",
    ("rēctus", "ADJ"): "straight, right, correct",
    ("facilis", "ADJ"): "easy",
    ("saepe", "ADV"): "often",
    ("prāvus", "ADJ"): "wrong, crooked",
    ("reprehendō", "V"): "blame, criticize",
    ("tollō", "V"): "lift, raise, take away",
    ("quārē", "ADV"): "why, for what reason",
    ("ūsque", "ADV"): "all the way, right up to",
    ("exemplum", "N"): "example",
    ("dēmōnstrō", "V"): "point out, show",
    ("prōmō", "V"): "bring out, produce",
    ("prūdēns", "ADJ"): "sensible, wise",
    ("interpellō", "V"): "interrupt",
    ("computō", "V"): "count, calculate",
    ("partior", "V"): "divide, share",
    ("largior", "V"): "give generously",
    ("largus", "ADJ"): "generous, abundant",
    ("situs", "N"): "position, site",
    ("indoctus", "ADJ"): "unlearned, ignorant",
    ("oportet", "V"): "it is right, one ought",
    ("doceō", "V"): "teach",
    ("piger", "ADJ"): "lazy, slow",
    ("assis", "N"): "as, a copper coin",
    ("nesciō", "V"): "not know",
    # XVIII
    ("frequens", "ADJ"): "frequent, common",
    ("mendum", "N"): "mistake, error",
    ("menda", "N"): "mistake, error",
    ("charta", "N"): "paper",
    ("consonō", "V"): "sound together",
    ("vōcālis", "ADJ"): "vowel, sounding",
    ("erus", "N"): "master",
    ("rārus", "ADJ"): "rare, thin",
    ("comparō", "V"): "prepare, get ready",
    ("efficiō", "V"): "bring about, make",
    ("molliō", "V"): "soften",
    ("significō", "V"): "mean, indicate",
    ("animadvertō", "V"): "notice, pay attention to",
    ("dēsum", "V"): "be lacking, be missing",
    ("supersum", "V"): "be left over, remain",
    ("dēleō", "V"): "erase, wipe out",
    ("corrigō", "V"): "correct",
    ("imprimō", "V"): "press into, imprint",
    ("signō", "V"): "mark, seal",
    ("premō", "V"): "press",
    ("coniungō", "V"): "join together",
    ("addō", "V"): "add",
    ("turpis", "ADJ"): "ugly, shameful",
    ("pulchrē", "ADV"): "beautifully, finely",
    ("fortiter", "ADV"): "bravely, strongly",
    ("graviter", "ADV"): "heavily, seriously",
    ("leviter", "ADV"): "lightly, gently",
    ("breviter", "ADV"): "briefly, shortly",
    ("māteria", "N"): "material, wood",
    ("calamus", "N"): "reed pen, reed",
    ("papyrus", "N"): "papyrus",
    ("bēstiola", "N"): "little creature, insect",
    ("dūrus", "ADJ"): "hard, tough",
    ("cēra", "N"): "wax",
    ("varius", "ADJ"): "varied, different",
    ("quālis", "ADJ"): "what kind of",
    ("sententia", "N"): "opinion, sentence",
    ("uadō", "V"): "go, advance",
    ("epistula", "N"): "letter",
    # XIX
    ("opus", "N"): "work, need",
    ("foris", "N"): "door",
    ("pauper", "ADJ"): "poor",
    ("cupidus", "ADJ"): "eager, desirous",
    ("dīves", "ADJ"): "rich",
    ("beātus", "ADJ"): "happy, blessed",
    ("signum", "N"): "sign, statue, signal",
    ("virgō", "N"): "maiden, young woman",
    ("magnificus", "ADJ"): "splendid, magnificent",
    ("coniūnx", "N"): "husband, wife, spouse",
    ("possideō", "V"): "possess, own",
    ("dignus", "ADJ"): "worthy, deserving",
    ("forum", "N"): "forum, market place",
    ("tegō", "V"): "cover",
    ("gracilis", "ADJ"): "slender, thin",
    ("pulchritūdo", "N"): "beauty",
    ("templum", "N"): "temple",
    ("augeō", "V"): "increase",
    ("columna", "N"): "column, pillar",
    ("ergā", "PREP"): "towards",
    ("mātrōna", "N"): "married woman, lady",
    ("minuō", "V"): "lessen, diminish",
    ("remittō", "V"): "send back",
    ("adulēscentia", "N"): "youth",
    ("pessimō", "V"): "ruin, spoil",
    ("mittō", "V"): "send",
    ("miser", "ADJ"): "unhappy, wretched, poor",
    ("flōs", "N"): "flower",
    # XX
    ("īnfāns", "N"): "baby, infant",
    ("cūrō", "V"): "look after, care for",
    ("dēbeō", "V"): "owe, ought",
    ("parvulus", "ADJ"): "very small, tiny",
    ("revertō", "V"): "turn back, return",
    ("postulō", "V"): "demand, ask",
    ("aliēnus", "ADJ"): "another's, foreign",
    ("alō", "V"): "feed, nourish",
    ("careō", "V"): "lack, be without",
    ("vagiō", "V"): "wail, cry",
    ("adversus", "ADJ"): "facing, opposite",
    ("colloquor", "V"): "talk with, converse",
    ("decet", "V"): "it is fitting, it is proper",
    ("ūmidus", "ADJ"): "damp, wet",
    ("dīligō", "V"): "love, be fond of",
    ("gradūs", "N"): "step",
    ("sileō", "V"): "be silent",
    ("sermō", "N"): "conversation, talk",
    ("occurrō", "V"): "run to meet",
    ("for", "V"): "speak, say",
    ("māternus", "ADJ"): "motherly, of a mother",
    ("praetereō", "V"): "pass by, go past",
    ("officium", "N"): "duty",
    ("colloquium", "N"): "conversation",
    ("necessārius", "ADJ"): "necessary",
    ("pergō", "V"): "go on, proceed",
    ("cūna", "N"): "cradle",
    ("plūs", "N"): "more, too much",
    # XXI
    ("mūtō", "V"): "change, exchange",
    ("aiō", "V"): "say",
    ("cognōscō", "V"): "get to know, learn, recognize",
    ("humus", "N"): "ground, soil",
    ("falsus", "ADJ"): "false, wrong",
    ("mentior", "V"): "lie, tell a lie",
    ("vincō", "V"): "conquer, defeat",
    ("conspiciō", "V"): "catch sight of, see",
    ("tabella", "N"): "small tablet",
    ("excūsō", "V"): "excuse",
    ("porcus", "N"): "pig",
    ("angustus", "ADJ"): "narrow",
    ("indīgnus", "ADJ"): "unworthy",
    ("mundus", "ADJ"): "clean, neat",
    ("validus", "ADJ"): "strong",
    ("candidus", "ADJ"): "white, shining, bright",
    ("sordeō", "V"): "be dirty",
    ("vestis", "N"): "clothing, garment",
    ("crēdō", "V"): "believe, trust",
    ("causa", "N"): "cause, reason",
    ("causā", "PREP"): "for the sake of, because of",
    ("aliquis", "PRON"): "someone, something",
    ("nārrō", "V"): "tell, relate",
    ("dubitō", "V"): "doubt, hesitate",
    ("fallō", "V"): "deceive",
    # XXII
    ("prō", "PREP"): "for, on behalf of, in front of",
    ("arbitror", "V"): "think, consider",
    ("pellō", "V"): "drive, push, drive out",
    ("quīn", "ADV"): "why not, indeed",
    ("cēdō", "V"): "go, yield, withdraw",
    ("imāgo", "N"): "image, likeness",
    ("scindō", "V"): "tear, split",
    ("dērīdeō", "V"): "mock, laugh at",
    ("extrā", "PREP"): "outside, beyond",
    ("ferreus", "ADJ"): "of iron, iron",
    ("prius", "ADV"): "earlier, before",
    ("vinciō", "V"): "bind, tie up",
    ("admittō", "V"): "let in, admit",
    ("anteā", "ADV"): "before, earlier",
    ("custodiō", "V"): "guard, watch over",
    ("pallium", "N"): "cloak",
    ("retineō", "V"): "hold back, keep",
    ("ligneus", "ADJ"): "wooden",
    ("resistō", "V"): "stop, halt, resist",
    ("forās", "ADV"): "out, outside",
    ("līmen", "N"): "threshold",
    ("prōcēdō", "V"): "go forward, advance",
    ("recēdō", "V"): "go back, withdraw",
    ("rogitō", "V"): "keep asking",
    ("scīlicet", "ADV"): "of course, naturally",
    ("aurum", "N"): "gold",
    ("dictus", "N"): "saying, word",
    ("faber", "N"): "craftsman, smith",
    ("fremō", "V"): "growl, roar",
    ("solvō", "V"): "loosen, untie, release",
    ("tabellārius", "N"): "letter carrier",
    ("moneō", "V"): "warn, advise",
    ("accēdō", "V"): "come near, approach",
    ("factum", "N"): "deed, act",
    ("prehendō", "V"): "seize, catch",
    ("ferōx", "ADJ"): "fierce, wild",
    ("aureus", "ADJ"): "golden, of gold",
    ("iānitor", "N"): "doorkeeper",
    ("terreō", "V"): "frighten",
    ("tremō", "V"): "tremble, shake",
    ("audītus", "N"): "hearing",
    # XXIII
    ("ob", "PREP"): "because of, on account of",
    ("plānus", "ADJ"): "flat, level",
    ("inclūdō", "V"): "shut in, enclose",
    ("mereō", "V"): "earn, deserve",
    ("pudet", "V"): "it shames, one is ashamed",
    ("negō", "V"): "deny, say no",
    ("palleō", "V"): "be pale",
    ("quisnam", "PRON"): "who then?, what then?",
    ("rubeō", "V"): "be red, blush",
    ("trādō", "V"): "hand over",
    ("fateor", "V"): "confess, admit",
    ("hinc", "ADV"): "from here, hence",
    ("perdō", "V"): "destroy, lose",
    ("vultus", "N"): "face, expression",
    ("clāvis", "N"): "key",
    ("comes", "N"): "companion",
    ("dīmittō", "V"): "send away, dismiss",
    ("integer", "ADJ"): "whole, untouched",
    ("pallidus", "ADJ"): "pale",
    ("āvertō", "V"): "turn away, avert",
    ("comitor", "V"): "accompany",
    ("laus", "N"): "praise",
    ("pareō", "V"): "obey",
    ("contineō", "V"): "hold together, contain, keep",
    ("inscribō", "V"): "write on, inscribe",
    ("pudor", "N"): "shame, modesty",
    ("superus", "ADJ"): "upper, above",
    ("amputō", "V"): "cut off",
    ("antehāc", "ADV"): "before this, previously",
    ("verber", "N"): "lash, blow",
    # XXIV
    ("mīror", "V"): "wonder at, be amazed",
    ("cupiō", "V"): "want, desire",
    ("dolor", "N"): "pain, grief",
    ("nōscō", "V"): "get to know, learn",
    ("frangō", "V"): "break, shatter",
    ("ignōrō", "V"): "not know, be unaware of",
    ("continuus", "ADJ"): "continuous, unbroken",
    ("cruentus", "ADJ"): "bloody, bleeding",
    ("percutiō", "V"): "strike, hit",
    ("strepitus", "N"): "noise, din",
    ("convertō", "V"): "turn, turn round",
    ("recumbō", "V"): "lie down, recline",
    ("iūxtā", "PREP"): "next to, close to",
    ("laevus", "ADJ"): "left, on the left",
    ("lautus", "ADJ"): "elegant, smart",
    ("aegrōtus", "ADJ"): "sick, ill",
    ("dēnuō", "ADV"): "again, anew",
    ("intus", "ADV"): "inside, within",
    ("subeō", "V"): "come up, approach, go under",
    ("aliter", "ADV"): "otherwise, differently",
    ("comitātus", "N"): "escort, retinue",
    ("ferōciō", "V"): "be fierce",
    ("fleō", "V"): "weep, cry",
    ("morsus", "N"): "bite",
    ("tumultus", "N"): "uproar, commotion",
    ("valdē", "ADV"): "very, greatly",
    ("sonus", "N"): "sound, noise",
    ("latus", "N"): "side",
    # XXV
    ("coepiō", "V"): "begin",
    ("necō", "V"): "kill",
    ("dēserō", "V"): "desert, abandon",
    ("cīvis", "N"): "citizen",
    ("saevus", "ADJ"): "savage, fierce, cruel",
    ("cōnstituō", "V"): "set up, decide",
    ("dēscendō", "V"): "go down, descend",
    ("maereō", "V"): "grieve, mourn",
    ("regō", "V"): "rule, guide",
    ("terribilis", "ADJ"): "terrible, frightful",
    ("trahō", "V"): "drag, draw",
    ("fīlum", "N"): "thread",
    ("linō", "V"): "smear",
    ("mīrābilis", "ADJ"): "wonderful, marvelous",
    ("mora", "N"): "delay",
    ("prōspiciō", "V"): "look out, look ahead",
    ("timidus", "ADJ"): "timid, fearful",
    ("complūrēs", "ADJ"): "several, a good many",
    ("lītus", "N"): "shore, beach",
    ("cōnspectus", "N"): "sight, view",
    ("currus", "N"): "chariot",
    ("moenia", "N"): "city walls, walls",
    ("pateō", "V"): "be open, stand open",
    ("Trōiānus", "ADJ"): "Trojan",
    ("vorō", "V"): "devour, swallow",
    ("humilis", "ADJ"): "low, humble",
    ("nārrātiō", "N"): "story, narrative",
    ("cupiditās", "N"): "desire, eagerness",
    ("nex", "N"): "death, murder",
    ("oblīvīscor", "V"): "forget",
    ("interficiō", "V"): "kill",
    ("polliceor", "V"): "promise",
    ("aedificium", "N"): "building",
    # XXVI
    ("quisquam", "PRON"): "anyone, anything",
    ("inveniō", "V"): "find, come upon",
    ("iuvō", "V"): "help, aid",
    ("cōnsilium", "N"): "plan, advice, counsel",
    ("persequor", "V"): "pursue, follow",
    ("artus", "ADJ"): "close, tight",
    ("conficiō", "V"): "finish, complete, make",
    ("studiōsus", "ADJ"): "eager, keen",
    ("accidō", "V"): "happen, occur",
    ("carcer", "N"): "prison",
    ("effugiō", "V"): "escape, flee",
    ("penna", "N"): "feather, wing",
    ("reliquus", "ADJ"): "remaining, the rest of",
    ("cōnsequor", "V"): "catch up with, follow",
    ("aberrō", "V"): "wander off, stray",
    ("caveō", "V"): "beware, be careful",
    ("ingēns", "ADJ"): "huge, enormous",
    ("dēspiciō", "V"): "look down on",
    ("fuga", "N"): "flight, escape",
    ("ignis", "N"): "fire",
    ("imitor", "V"): "imitate, copy",
    ("lacertus", "N"): "arm, upper arm",
    ("temerārius", "ADJ"): "rash, reckless",
    ("celer", "ADJ"): "swift, quick",
    ("cōnsūmō", "V"): "use up, consume",
    ("levō", "V"): "lift, raise",
    ("suspiciō", "V"): "look up at",
    ("cāsus", "N"): "fall, chance, misfortune",
    ("ēvolō", "V"): "fly away, fly up",
    ("excogitō", "V"): "think out, devise",
    ("propinquus", "ADJ"): "near, neighboring",
    ("iūnctus", "ADJ"): "joined, connected",
    ("celeriter", "ADV"): "quickly",
    ("multitūdō", "N"): "crowd, great number",
    ("orbis", "N"): "circle, ring",
    ("ars", "N"): "skill, craft, art",
    ("ōra", "N"): "shore, coast",
    ("aliquī", "PRON"): "some",
    # XXVII
    ("negōtium", "N"): "business, task",
    ("cēnseō", "V"): "think, be of the opinion",
    ("prae", "PREP"): "before, in front of",
    ("spērō", "V"): "hope, hope for",
    ("rūsticus", "ADJ"): "of the country, rural",
    ("vīnea", "N"): "vineyard",
    ("labōrō", "V"): "work, toil",
    ("par", "ADJ"): "equal",
    ("ūtor", "V"): "use",
    ("exōrnō", "V"): "adorn, equip",
    ("līberō", "V"): "free, set free",
    ("neglegō", "V"): "neglect, disregard",
    ("nēquam", "ADJ"): "worthless, good-for-nothing",
    ("ōdī", "V"): "hate",
    ("stabulum", "N"): "stable, stall",
    ("vītō", "V"): "avoid, shun",
    ("arō", "V"): "plow, till",
    ("fundō", "V"): "pour",
    ("metō", "V"): "reap, harvest",
    ("ōtium", "N"): "leisure",
    ("prohibeō", "V"): "prevent, keep off",
    ("urbānus", "ADJ"): "of the city",
    ("fūrtum", "N"): "theft",
    ("mortālis", "ADJ"): "mortal",
    ("pecus", "N"): "cattle, flock, herd",
    ("prex", "N"): "prayer, request",
    ("rapiō", "V"): "seize, snatch, carry off",
    ("cōpia", "N"): "plenty, supply",
    ("corvus", "N"): "raven",
    ("īnstrūmentum", "N"): "tool, equipment",
    ("spargō", "V"): "scatter, sprinkle",
    ("superbus", "ADJ"): "proud, arrogant",
    ("ūva", "N"): "grape",
    ("arātrum", "N"): "plow",
    ("crēscō", "V"): "grow, increase",
    ("dēnique", "ADV"): "finally, in the end",
    ("exīstimō", "V"): "think, judge",
    ("faveō", "V"): "favor, support",
    ("fertilis", "ADJ"): "fertile, fruitful",
    ("frūx", "N"): "crops, fruits",
    ("grex", "N"): "flock, herd",
    ("inhūmānus", "ADJ"): "rude, unkind",
    ("noceō", "V"): "harm, hurt",
    ("pāscō", "V"): "feed, pasture",
    ("patientia", "N"): "patience, endurance",
    ("prōiciō", "V"): "throw down, throw out",
    ("prōsum", "V"): "be useful, benefit",
    ("regiō", "N"): "region, district",
    ("amoenus", "ADJ"): "pleasant, lovely",
    ("falx", "N"): "sickle, scythe",
    ("mātūrus", "ADJ"): "ripe, early",
    ("praedium", "N"): "estate, farm",
    ("recognōscō", "V"): "recognize",
    ("rigō", "V"): "water, moisten",
    ("rūs", "N"): "country, countryside",
    ("similis", "ADJ"): "like, similar",
    ("affirmō", "V"): "affirm, assert",
    ("cingō", "V"): "surround, encircle",
    ("circā", "PREP"): "around, about",
    ("ēmittō", "V"): "send out, let go",
    ("gravidus", "ADJ"): "pregnant, heavy",
    ("īnfēlīx", "ADJ"): "unlucky, unhappy",
    ("infēstus", "ADJ"): "unsafe, dangerous",
    ("pābulum", "N"): "fodder, food",
    ("regius", "ADJ"): "royal, of a king",
    ("rudis", "ADJ"): "rough, undeveloped",
    ("suburbānus", "ADJ"): "near the city",
    ("addūcō", "V"): "lead to, bring",
    ("immātūrus", "ADJ"): "unripe, untimely",
    ("intellēctus", "N"): "understanding",
    ("invehō", "V"): "carry in, import",
    ("paeniteō", "V"): "make sorry, cause regret",
    ("rūdus", "N"): "rubble, lump",
    ("sacer", "ADJ"): "sacred, holy",
    ("sedō", "V"): "settle, calm",
    ("agricola", "N"): "farmer",
    ("frūmentum", "N"): "grain, corn",
    ("colōnus", "N"): "farmer, tenant farmer",
    ("nē", "ADV"): "not, that not",
    ("quīdam", "PRON"): "a certain, some",
    # XXVIII
    ("praedō", "N"): "robber, pirate",
    ("cēna", "N"): "dinner",
    ("pereō", "V"): "perish, die",
    ("perveniō", "V"): "arrive, reach",
    ("animus", "N"): "mind, spirit",
    ("diū", "ADV"): "for a long time",
    ("optō", "V"): "choose, wish for",
    ("potestās", "N"): "power, authority",
    ("prīnceps", "N"): "leader, chief man",
    ("adōrō", "V"): "worship, adore",
    ("libellus", "N"): "little book",
    ("persuādeō", "V"): "persuade, convince",
    ("nāvicula", "N"): "small boat",
    ("nōtus", "ADJ"): "known, well known, famous",
    ("rogō", "V"): "ask, ask for",
    ("serviō", "V"): "serve, be a slave",
    ("mālō", "V"): "prefer",
    ("precor", "V"): "pray, beg",
    ("tūtus", "ADJ"): "safe",
    ("extendō", "V"): "stretch out",
    ("impendeō", "V"): "hang over, overhang",
    ("morior", "V"): "die",
    ("nātus", "ADJ"): "born",
    ("potius", "ADV"): "rather",
    ("ūniversus", "ADJ"): "whole, entire",
    ("versō", "V"): "turn, spin",
    ("adiuvō", "V"): "help, aid",
    ("admīror", "V"): "admire, wonder at",
    ("mūtus", "ADJ"): "dumb, silent",
    ("oboediō", "V"): "obey",
    ("pecūlium", "N"): "savings",
    ("surdus", "ADJ"): "deaf",
    ("suscitō", "V"): "raise up, rouse",
    ("velut", "ADV"): "just as, as if",
    ("apprehendō", "V"): "seize, take hold of",
    ("attendō", "V"): "pay attention to",
    ("caecus", "ADJ"): "blind",
    ("eiiciō", "V"): "throw out, cast out",
    ("eiciō", "V"): "throw out, cast out",
    ("ēvolvō", "V"): "unroll, roll out",
    ("fretum", "N"): "strait, sea",
    ("gaudium", "N"): "joy, delight",
    ("memorō", "V"): "mention, recount",
    ("rēgnō", "V"): "reign, rule",
    ("siculus", "ADJ"): "Sicilian",
    ("cessō", "V"): "stop, be idle",
    ("disiungō", "V"): "unyoke, separate",
    ("fāma", "N"): "rumor, report, fame",
    ("tībīcen", "N"): "piper, flute player",
    ("vorāgō", "N"): "chasm, whirlpool",
    ("coorior", "V"): "arise, break out",
    ("deponō", "V"): "put down, lay aside",
    ("egeō", "V"): "need, lack",
    ("experior", "V"): "try, test",
    ("nāscor", "V"): "be born",
    ("tranquillitās", "N"): "calm, stillness",
    ("tumultuō", "V"): "make an uproar",
    ("turba", "N"): "crowd, throng",
    ("vigilia", "N"): "watch, vigil",
    ("vīsus", "N"): "sight, look",
    # XXIX
    ("fēlīx", "ADJ"): "lucky, happy, fortunate",
    ("fidēs", "N"): "lyre string, lyre",
    ("fortūna", "N"): "fortune, luck, chance",
    ("suādeō", "V"): "advise, urge",
    ("aestimō", "V"): "value, assess",
    ("beneficium", "N"): "kindness, favor, service",
    ("pretiōsus", "ADJ"): "precious, costly",
    ("spēs", "N"): "hope",
    ("abiiciō", "V"): "throw away, throw down",
    ("abiciō", "V"): "throw away, throw down",
    ("appāreō", "V"): "appear",
    ("cōnfiteor", "V"): "confess, admit",
    ("dēspērō", "V"): "despair",
    ("dīvitia", "N"): "riches, wealth",
    ("expōnō", "V"): "set out, put ashore",
    ("afficiō", "V"): "affect, influence",
    ("appropinquō", "V"): "approach, draw near",
    ("ēripiō", "V"): "snatch away, rescue",
    ("invideō", "V"): "envy, be jealous of",
    ("nōbilis", "ADJ"): "noble, well born",
    ("remus", "N"): "oar",
    ("maleficium", "N"): "crime, misdeed",
    ("mīrus", "ADJ"): "wonderful, strange, surprising",
    ("perturbātus", "ADJ"): "troubled, upset",
    ("prōtinus", "ADV"): "at once, straight on",
    ("quasi", "ADV"): "as if, as though",
    ("repente", "ADV"): "suddenly",
    ("saliō", "V"): "leap, jump",
    ("abstineō", "V"): "keep away, abstain",
    ("alliciō", "V"): "attract, entice",
    ("cantus", "N"): "song, singing",
    ("dēterreō", "V"): "deter, frighten off",
    ("fūr", "N"): "thief",
    ("inde", "ADV"): "from there, then",
    ("laetitia", "N"): "joy, gladness",
    ("permittō", "V"): "allow, let through",
    ("queror", "V"): "complain",
    ("surripiō", "V"): "steal, take secretly",
    ("delphīnus", "N"): "dolphin",
    ("fidicen", "N"): "lyre player",
    ("lāpsus", "N"): "gliding, fall",
    ("maestus", "ADJ"): "sad, gloomy",
    ("nōnnūllus", "ADJ"): "some, several",
    ("parcō", "V"): "spare",
    ("permoveō", "V"): "move deeply, stir up",
    ("rapidus", "ADJ"): "swift, rapid",
    ("remaneō", "V"): "stay behind, remain",
    ("salūs", "N"): "health, safety, greeting",
    ("secō", "V"): "cut",
    ("vēlōx", "ADJ"): "swift, fast",
    ("affectus", "N"): "feeling, affection",
    ("celsus", "ADJ"): "high, lofty",
    ("desiliō", "V"): "jump down",
    ("dorsum", "N"): "back, ridge",
    ("fallāx", "ADJ"): "deceitful, treacherous",
    ("fēlīcitās", "N"): "good luck, happiness",
    ("ignārus", "ADJ"): "ignorant, unaware",
    ("lucrum", "N"): "gain, profit",
    ("magus", "ADJ"): "magic",
    ("piscātor", "N"): "fisherman",
    ("redūcō", "V"): "lead back, bring back",
    ("stupeō", "V"): "be amazed",
    ("adiciō", "V"): "add, throw to",
    ("dētrahō", "V"): "drag off, strip",
    ("dōnō", "V"): "give, present",
    ("fīniō", "V"): "finish, end",
    ("ignōtus", "ADJ"): "unknown, strange",
    ("invidia", "N"): "envy, ill will",
    ("nāvigātiō", "N"): "voyage, sailing",
    ("trīstitia", "N"): "sadness",
    ("vēlōciter", "ADV"): "swiftly, quickly",
    ("carmen", "N"): "song, poem",
    ("āmittō", "V"): "lose",
    # XXX
    ("convīva", "N"): "guest, dinner guest",
    ("triclīnium", "N"): "dining room, dining couch",
    ("cārus", "ADJ"): "dear, beloved",
    ("gustō", "V"): "taste",
    ("cēnō", "V"): "dine, have dinner",
    ("dēmum", "ADV"): "finally, at last",
    ("famēs", "N"): "hunger",
    ("iter", "N"): "journey, road",
    ("minister", "N"): "servant, attendant",
    ("nūntiō", "V"): "announce, report",
    ("cocus", "N"): "cook",
    ("convīvium", "N"): "banquet, dinner party",
    ("hospes", "N"): "host, guest",
    ("singulus", "ADJ"): "one each, single",
    ("sternō", "V"): "spread, strew",
    ("tardus", "ADJ"): "slow",
    ("vāsum", "N"): "vessel, dish",
    ("argenteus", "ADJ"): "of silver, silver",
    ("contrahō", "V"): "draw together, contract",
    ("dulcis", "ADJ"): "sweet, pleasant",
    ("equidem", "ADV"): "indeed, truly",
    ("exhauriō", "V"): "drain, empty",
    ("fruor", "V"): "enjoy",
    ("glōriōsus", "ADJ"): "boastful, glorious",
    ("iūcundus", "ADJ"): "pleasant, agreeable, delightful",
    ("potō", "V"): "drink",
    ("sitis", "N"): "thirst",
    ("accubō", "V"): "recline at table",
    ("acūtus", "ADJ"): "sharp, pointed",
    ("aspergō", "V"): "sprinkle, splash",
    ("balneum", "N"): "bath",
    ("culīna", "N"): "kitchen",
    ("ēligō", "V"): "choose, pick out",
    ("merus", "ADJ"): "pure, unmixed",
    ("misceō", "V"): "mix, mingle",
    ("molestus", "ADJ"): "annoying, troublesome",
    ("paulīsper", "ADV"): "for a short time",
    ("prōferō", "V"): "bring out, bring forward",
    ("prūdenter", "ADV"): "wisely, sensibly",
    ("recipiō", "V"): "take back, receive",
    ("vīsō", "V"): "go to see, visit",
    ("accumbō", "V"): "recline at table",
    ("acerbus", "ADJ"): "bitter, harsh",
    ("carō", "N"): "meat, flesh",
    ("circiter", "ADV"): "about, approximately",
    ("coquō", "V"): "cook",
    ("dīligēns", "ADJ"): "careful, diligent",
    ("generō", "V"): "beget, produce",
    ("īmō", "ADV"): "no indeed, on the contrary",
    ("prīdem", "ADV"): "long ago, previously",
    ("apportō", "V"): "bring, carry",
    ("compleō", "V"): "fill up",
    ("holus", "N"): "vegetable",
    ("inexspectātus", "ADJ"): "unexpected",
    ("perferō", "V"): "carry through, endure",
    ("praesum", "V"): "be in charge of",
    ("praesumō", "V"): "take beforehand",
    ("requiēscō", "V"): "rest",
    ("revertor", "V"): "turn back, return",
    ("summus", "ADJ"): "highest, topmost",
    ("ūsus", "N"): "use, practice",
    # XXXI
    ("fugitīvus", "ADJ"): "runaway, fugitive",
    ("īnfīdus", "ADJ"): "faithless, untrustworthy",
    ("poena", "N"): "punishment, penalty",
    ("quidquid", "PRON"): "whatever",
    ("abdūcō", "V"): "lead away, take away",
    ("auferō", "V"): "carry off, take away",
    ("clēmēns", "ADJ"): "merciful, mild",
    ("crūdēlis", "ADJ"): "cruel, harsh",
    ("crux", "N"): "cross",
    ("ēducō", "V"): "bring up, rear",
    ("iniūria", "N"): "injustice, wrong",
    ("iūstus", "ADJ"): "just, fair",
    ("iuvenis", "N"): "young man",
    ("memor", "ADJ"): "remembering, mindful",
    ("mōs", "N"): "custom, habit",
    ("namque", "CONJ"): "for indeed",
    ("nimius", "ADJ"): "excessive, too great",
    ("praemium", "N"): "reward, prize",
    ("rūmor", "N"): "rumor, gossip",
    ("scelus", "N"): "crime",
    ("senex", "N"): "old man",
    ("statuō", "V"): "set up, fix, decide",
    ("supplicium", "N"): "punishment",
    ("vetō", "V"): "forbid",
    ("avārus", "ADJ"): "greedy",
    ("cōram", "ADV"): "in person, face to face",
    ("cruciō", "V"): "torture, torment",
    ("dēbilis", "ADJ"): "weak, feeble",
    ("ēbrius", "ADJ"): "drunk",
    ("invalidus", "ADJ"): "weak, feeble",
    ("iūs", "N"): "law, right",
    ("lēx", "N"): "law",
    ("mūnus", "N"): "duty, gift, service",
    ("praesēns", "ADJ"): "present",
    ("scelestus", "ADJ"): "wicked, criminal",
    ("vetus", "ADJ"): "old, ancient",
    ("fīdō", "V"): "trust, rely on",
    ("fīdus", "ADJ"): "faithful, loyal",
    ("funditus", "ADV"): "utterly, completely",
    ("gener", "N"): "son-in-law",
    ("ignōscō", "V"): "forgive, pardon",
    ("lateō", "V"): "lie hidden",
    ("parricīda", "N"): "murderer of a parent",
    ("pōtiō", "N"): "drink",
    ("sapiēns", "ADJ"): "wise, sensible",
    ("aliquantus", "ADJ"): "a fair amount of",
    ("asinīnus", "ADJ"): "of a donkey",
    ("aufugiō", "V"): "run away, flee",
    ("cōnfīdō", "V"): "trust, rely on",
    ("fabulor", "V"): "talk, chat",
    ("graffītum", "N"): "graffito",
    ("ideō", "ADV"): "for that reason, therefore",
    ("impatiēns", "ADJ"): "impatient",
    ("iniūstus", "ADJ"): "unjust",
    ("līqueō", "V"): "be liquid, be clear",
    ("memoria", "N"): "memory",
    ("nūga", "N"): "trifles, nonsense",
    ("retrahō", "V"): "drag back, withdraw",
    ("quamobrem", "CONJ"): "why, for what reason",
    ("quisquis", "PRON"): "whoever",
    # XXXII
    ("grātia", "N"): "favor, thanks, goodwill",
    ("pingō", "V"): "paint",
    ("redimō", "V"): "buy back, ransom",
    ("classis", "N"): "fleet, class",
    ("servitūs", "N"): "slavery",
    ("utinam", "ADV"): "if only",
    ("certō", "V"): "contend, struggle",
    ("seu", "CONJ"): "or if",
    ("anus", "ADJ"): "old",
    ("contemnō", "V"): "despise, think little of",
    ("contempnō", "V"): "despise, think little of",
    ("grātus", "ADJ"): "pleasing, grateful",
    ("cūnctus", "ADJ"): "all, the whole",
    ("ēgregius", "ADJ"): "outstanding, excellent",
    ("referō", "V"): "bring back, report",
    ("vīs", "N"): "force, strength, violence",
    ("aliquot", "N"): "some, several",
    ("commūnis", "ADJ"): "common, shared",
    ("meminī", "V"): "remember",
    ("populus", "N"): "people, nation",
    ("tueor", "V"): "look at, protect",
    ("acūō", "V"): "sharpen",
    ("amphitheatrum", "N"): "amphitheater",
    ("cursūs", "N"): "running, course",
    ("dēsistō", "V"): "stop, cease",
    ("inermis", "ADJ"): "unarmed",
    ("inopia", "N"): "lack, want",
    ("intereā", "ADV"): "meanwhile",
    ("offerō", "V"): "offer",
    ("praeferō", "V"): "carry in front, prefer",
    ("trānseō", "V"): "go across, cross",
    ("victor", "N"): "victor, conqueror",
    ("voluntās", "N"): "will, wish",
    ("aliquandō", "ADV"): "sometime, at some time",
    ("arānea", "N"): "spider's web, spider",
    ("christiānus", "ADJ"): "Christian",
    ("exter", "ADJ"): "outer, foreign",
    ("flectō", "V"): "bend, curve",
    ("gēns", "N"): "tribe, people, family",
    ("ingredior", "V"): "step in, enter, advance",
    ("mercātōrius", "ADJ"): "of a merchant, trading",
    ("minor", "V"): "threaten",
    ("mūtuus", "ADJ"): "borrowed, mutual",
    ("neu", "CONJ"): "and not, nor",
    ("nūbilus", "ADJ"): "cloudy",
    ("percurrō", "V"): "run through, run along",
    ("proximō", "V"): "draw near, approach",
    ("proximus", "N"): "neighbor",
    ("rēmigō", "V"): "row",
    ("reminīscor", "V"): "recall, remember",
    ("sēstertium", "N"): "a thousand sesterces",
    ("superbia", "N"): "pride, arrogance",
    ("advehō", "V"): "carry to, bring",
    ("aegyptius", "ADJ"): "Egyptian",
    ("anus", "N"): "old woman",
    ("canus", "ADJ"): "white, gray",
    ("clipeus", "N"): "round shield",
    ("condiciō", "N"): "agreement, terms, condition",
    ("cōnscīscō", "V"): "decree, decide on",
    ("dēmittō", "V"): "let down, drop",
    ("dissuādeō", "V"): "advise against, dissuade",
    ("effringō", "V"): "break open",
    ("etiamnunc", "ADV"): "even now, still",
    ("gestō", "V"): "carry, wear",
    ("imprūdenter", "ADV"): "rashly, unwisely",
    ("īra", "N"): "anger",
    ("laqueus", "N"): "noose",
    ("magistra", "N"): "mistress, teacher",
    ("metus", "N"): "fear",
    ("olea", "N"): "olive",
    ("perītus", "ADJ"): "skilled, experienced",
    ("praeponō", "V"): "put in charge, place before",
    ("remōveō", "V"): "move back, remove",
    ("repugnō", "V"): "fight back, resist",
    ("stāmen", "N"): "warp, thread",
    ("submergō", "V"): "sink, submerge",
    ("sūcus", "N"): "juice, sap",
    ("tēla", "N"): "web, loom",
    ("tridēns", "ADJ"): "three-pronged",
    ("ubīque", "ADV"): "everywhere",
    ("unda", "N"): "wave, water",
    ("vīlis", "ADJ"): "cheap, common",
    # XXXIII
    ("proelium", "N"): "battle",
    ("caedō", "V"): "cut down, strike, kill",
    ("effundō", "V"): "pour out",
    ("plērīque", "ADJ"): "most, the greater part",
    ("versūs", "N"): "line, verse",
    ("vulnerō", "V"): "wound",
    ("praecipuus", "ADJ"): "special, particular",
    ("prōgredior", "V"): "advance, go forward",
    ("aetās", "N"): "age, lifetime",
    ("agmen", "N"): "column, marching army",
    ("dēsīderō", "V"): "long for, miss, want",
    ("fatīgō", "V"): "tire, wear out",
    ("ōrdō", "N"): "rank, row, order",
    ("prōcurrō", "V"): "run forward, charge",
    ("properō", "V"): "hurry",
    ("rīpa", "N"): "bank",
    ("studeō", "V"): "be eager for, study",
    ("studium", "N"): "eagerness, study",
    ("valētūdō", "N"): "health",
    ("virtūs", "N"): "courage, virtue, strength",
    ("aciēs", "N"): "battle line, sharp edge",
    ("amnis", "N"): "river",
    ("citrā", "PREP"): "on this side of",
    ("dīrus", "ADJ"): "dreadful, dire",
    ("ēnsis", "N"): "sword",
    ("ērumpō", "V"): "burst out",
    ("excurrō", "V"): "run out",
    ("hortor", "V"): "encourage, urge",
    ("idōneus", "ADJ"): "suitable, fit",
    ("imperātor", "N"): "commander, general",
    ("incolumis", "ADJ"): "unharmed, safe",
    ("īnstruō", "V"): "draw up, equip, build",
    ("lēgātus", "N"): "legate, envoy",
    ("legiōnārius", "ADJ"): "legionary",
    ("ōtiōsus", "ADJ"): "idle, at leisure",
    ("prīdiē", "ADV"): "the day before",
    ("ratis", "N"): "raft",
    ("rīdiculus", "ADJ"): "laughable, funny",
    ("stīpendium", "N"): "pay, tribute",
    ("ultrā", "ADV"): "beyond, further",
    ("adiungō", "V"): "join to, add",
    ("arduus", "ADJ"): "steep, high",
    ("caedēs", "N"): "slaughter, murder",
    ("circumdō", "V"): "surround",
    ("citer", "ADJ"): "on this side",
    ("cōgō", "V"): "gather, force",
    ("commemorō", "V"): "recall, mention",
    ("cōnstanter", "ADV"): "steadily, firmly",
    ("conuocō", "V"): "call together",
    ("cōpulō", "V"): "join, couple",
    ("etenim", "CONJ"): "for indeed, and indeed",
    ("Māius", "ADJ"): "of May",
    ("mūniō", "V"): "fortify",
    ("pīlum", "N"): "javelin",
    ("praestō", "V"): "excel, surpass, perform",
    ("quamdiū", "ADV"): "how long",
    ("quicum", "PRON"): "with whom",
    ("tamdiū", "ADV"): "so long",
    ("trānsferō", "V"): "carry across, transfer",
    ("trīnus", "ADJ"): "triple, threefold",
    ("ūnus", "ADJ"): "one, single, alone",
    ("vāllum", "N"): "rampart, wall",
    # XXXIV
    ("epigramma", "N"): "epigram",
    ("certāmen", "N"): "contest, struggle",
    ("nūbō", "V"): "marry",
    ("passer", "N"): "sparrow",
    ("iocōsus", "ADJ"): "funny, playful",
    ("plaudō", "V"): "clap, applaud",
    ("rēte", "N"): "net",
    ("accendō", "V"): "light, set on fire",
    ("dein", "ADV"): "then, next",
    ("dummodo", "CONJ"): "provided that",
    ("fātum", "N"): "fate, destiny",
    ("implicō", "V"): "entangle, involve",
    ("libet", "V"): "it pleases",
    ("lūgeō", "V"): "mourn, grieve",
    ("ratiō", "N"): "reason, account, method",
    ("turgidus", "ADJ"): "swollen",
    ("bāsium", "N"): "kiss",
    ("circēnsis", "ADJ"): "of the circus",
    ("circus", "N"): "circus, race course",
    ("dēlicia", "N"): "delight, pleasure, pet",
    ("gremium", "N"): "lap, bosom",
    ("ingenium", "N"): "nature, talent",
    ("laedō", "V"): "hurt, injure",
    ("lucerna", "N"): "oil lamp",
    ("misellus", "ADJ"): "poor little, wretched",
    ("perpetuus", "ADJ"): "continuous, unbroken",
    ("prīncipium", "N"): "beginning",
    ("sapiō", "V"): "be wise, have sense",
    ("sinūs", "N"): "fold, lap, bay",
    ("tenebra", "N"): "darkness",
    ("venustus", "ADJ"): "charming, lovely, graceful",
    ("ācer", "ADJ"): "sharp, keen, fierce",
    ("aurīga", "N"): "charioteer",
    ("bellus", "ADJ"): "pretty, charming",
    ("cachinnus", "N"): "loud laugh, guffaw",
    ("circumsiliō", "V"): "hop around",
    ("comoedia", "N"): "comedy",
    ("conturbō", "V"): "throw into confusion, upset",
    ("dēvorō", "V"): "devour, swallow",
    ("dubius", "ADJ"): "doubtful, uncertain",
    ("ērubēscō", "V"): "blush, redden",
    ("excruciō", "V"): "torment, torture",
    ("geminus", "ADJ"): "twin, double",
    ("libenter", "ADV"): "gladly, willingly",
    ("mellītus", "ADJ"): "honey-sweet",
    ("niveus", "ADJ"): "snowy, snow-white",
    ("ocellus", "N"): "little eye",
    ("odium", "N"): "hatred, hate",
    ("ops", "N"): "wealth, resources, help",
    ("ōscitō", "V"): "gape, yawn",
    ("palma", "N"): "palm, hand",
    ("pīpiō", "V"): "chirp",
    ("prōsiliō", "V"): "leap forward, jump up",
    ("requīrō", "V"): "look for, ask for, need",
    ("scaenicus", "ADJ"): "of the stage, theatrical",
    ("scalpellus", "N"): "scalpel",
    ("sērius", "ADJ"): "serious, grave",
    ("tenebricōsus", "ADJ"): "dark, gloomy",
    ("turgidulus", "ADJ"): "a little swollen",
    ("versiculus", "N"): "little verse",
    ("theātrum", "N"): "theater",
    ("mēns", "N"): "mind",
    ("collum", "N"): "neck",
    ("testis", "N"): "witness",
    ("spectātor", "N"): "spectator",
}
GLOSS_OVERRIDES = {(canonical(lemma), pos): gloss for (lemma, pos), gloss in _GLOSS_SOURCE.items()}


def roman_to_int(s: str) -> int:
    total = 0
    for i, ch in enumerate(s):
        v = ROMAN_VALUES[ch]
        total += -v if i + 1 < len(s) and ROMAN_VALUES[s[i + 1]] > v else v
    return total


def skeleton(tok: str) -> str:
    return strip_macrons(tok).lower()


# ------------------------------------------------------------------ library

def library_units() -> dict[int, list[dict]]:
    """chapter → units in reading order (FR units before FS/FL within a chapter)."""
    out: dict[int, list[dict]] = defaultdict(list)
    for c in range(1, 25):
        p = BUILD / f"review-{c:02d}.json"
        if p.exists():
            out[c] += json.loads(p.read_text(encoding="utf-8"))["units"]
    by_chapter: dict[int, list[tuple[int, int, list[dict]]]] = defaultdict(list)
    for p in sorted(BUILD.glob("week-??.json")):
        data = json.loads(p.read_text(encoding="utf-8"))
        wk = data["week"]
        m = re.match(r"([IVXLC]+)", wk["chapter"])
        if not m:
            continue
        c = roman_to_int(m.group(1))
        fr = 0 if wk["source"] == "FR" else 1
        by_chapter[c].append((fr, wk["n"], data["units"]))
    for c, weeks in by_chapter.items():
        for _, _, units in sorted(weeks, key=lambda t: (t[0], t[1])):
            out[c] += units
    return dict(sorted(out.items()))


def tokens_of(la: str) -> list[tuple[str, bool]]:
    """(token, sentence-initial?) for every word of a unit's Latin."""
    out = []
    prev_end = 0
    initial = True
    for m in WORD_RE.finditer(la):
        between = la[prev_end:m.start()]
        if out and (SENTENCE_END.search(between.strip()) or re.search(r"[.!?…]", between)):
            initial = True
        out.append((m.group(), initial))
        initial = False
        prev_end = m.end()
    return out


# ------------------------------------------------------------------ lemmatiser

class Lemmatiser:
    def __init__(self, glossary: dict[str, list[dict]]):
        self.glossary = glossary
        self.cache: dict[str, list[dict]] = {}
        if WHITAKER_CACHE.exists():
            try:
                self.cache = json.loads(WHITAKER_CACHE.read_text(encoding="utf-8"))
            except ValueError:
                self.cache = {}
        self._parser = None
        self._speller = None
        self.dirty = False

    def _whitaker(self, form: str, spellings: Counter) -> list[dict]:
        import build_glossary as bg
        if self._parser is None:
            from whitakers_words.parser import Parser
            self._parser = Parser(frequency="F")
            bg.INFL_FREQ.update(bg.inflection_freq_map(self._parser))
            self._speller = bg.Speller()
        key = canonical(form)
        recs = bg.analyse(self._parser, key)
        for sp, n in spellings.items():
            self._speller.learn_form(sp, n)
            for rec in recs:
                self._speller.learn(sp, rec)
        entries = [bg.build_entry(r, self._speller) for r in recs]
        ranked = bg.rank_and_filter(recs, entries, key)
        ranked += bg.supine_entries(ranked, key)
        for e in ranked:
            e.pop("raw", None)
        return ranked

    def entries(self, form: str, spellings: Counter | None = None) -> list[dict]:
        """Readings of a form: the glossary's, else Whitaker's (cached)."""
        key = skeleton(form)
        if key in self.glossary:
            return self.glossary[key]
        ckey = canonical(form)
        if ckey in self.glossary:
            return self.glossary[ckey]
        if ckey not in self.cache:
            self.cache[ckey] = self._whitaker(form, spellings or Counter({form: 1}))
            self.dirty = True
        return self.cache[ckey]

    def save(self) -> None:
        if self.dirty:
            WHITAKER_CACHE.parent.mkdir(parents=True, exist_ok=True)
            WHITAKER_CACHE.write_text(json.dumps(self.cache, ensure_ascii=False), encoding="utf-8")
            self.dirty = False


def lemma_key(e: dict) -> tuple[str, str]:
    """The identity of a word across chapters: (headword, pos), macrons off and
    v/u levelled — the same key `check()` re-derives from a shipped deck's own
    `lemma` field, so a duplicate cannot hide behind a different dictionary
    string.  The headword is taken from the *positive* lemma, so a degree form
    and its positive (maior / magnus), a tackon form and its base (mēcum / ego)
    and a v/u doublet (lingva / lingua) are one word; VPAR counts as its verb;
    HEAD_ALIAS folds the spelling doublets Whitaker keeps apart as lexemes."""
    pos = "V" if e["pos"] == "VPAR" else e["pos"]
    h = canonical(headword(e))
    return (HEAD_ALIAS.get((h, pos), h), pos)


def is_proper_entry(e: dict) -> bool:
    return e["pos"] == "N" and e["lemma"][:1].isupper()


def usable(e: dict) -> bool:
    return (e["pos"] not in SKIP_POS and not is_proper_entry(e) and bool(e.get("senses"))
            and e["lemma"][:1].isalpha())   # roots Whitaker leaves as "-" are not words


# ------------------------------------------------------------------ dictionary forms

GENDER_DOT = {"m": "m.", "f": "f.", "n": "n.", "c": "m./f.", "m/f": "m./f."}
GENDER_TOKENS = set(GENDER_DOT)
CASE_WORD = {"acc": "acc.", "abl": "abl.", "dat": "dat.", "gen": "gen.", "loc": "loc."}
# a degree tail the glossary appends to a positive lemma, and the notes it appends
# to a folded tackon / degree adverb — none of them belong in a dictionary line
DEGREE_TAIL = re.compile(r"\s*·\s*(?:comparative|superlative)\b.*$")
DEGREE_OF = re.compile(r"^\S+\s*\((?:comparative|superlative) of ([^)]*)\)$")
TACKON_NOTE = re.compile(r"\s*\(\+ -\w+:[^)]*\)")
DEFECTIVE_NOTE = re.compile(r"\s*\([^)]*:[^)]*\)")


def positive_lemma(lemma: str) -> str:
    """The glossary lemma with the degree tail and the fold notes taken off."""
    lemma = DEGREE_TAIL.sub("", lemma)
    m = DEGREE_OF.match(lemma.strip())
    if m:
        lemma = m.group(1)          # saepissimē (superlative of saepe) → saepe
    lemma = TACKON_NOTE.sub("", lemma)
    lemma = re.sub(r"\s*\+ -\w+$", "", lemma)
    return re.sub(r"\s+", " ", lemma).strip()


def take_notes(lemma: str) -> tuple[str, list[str]]:
    """Body with its parentheticals lifted out, in order."""
    notes = re.findall(r"\(([^()]*)\)", lemma)
    body = re.sub(r"\s*\([^()]*\)", " ", lemma)
    return re.sub(r"\s+", " ", body).strip(), [n.strip() for n in notes if n.strip()]


def _paren(notes: list[str]) -> str:
    return f" ({'; '.join(notes)})" if notes else ""


def noun_dict(lemma: str, gender: str | None) -> str:
    """puella, -ae f. / frāter, frātris m. / nihil n. (indeclinable)"""
    head, *extra = [s.strip() for s in lemma.split("·")]
    body, notes = take_notes(head)
    notes += [re.sub(r"^pl\.\s*", "plural ", take_notes(x)[0]) for x in extra]
    toks = body.split()
    g = ""
    if toks and toks[-1] == "pl":
        toks.pop()
        notes.append("plural only")
    if toks and toks[-1] in GENDER_TOKENS:
        g = GENDER_DOT[toks.pop()]
    elif gender in GENDER_DOT:
        g = GENDER_DOT[gender]
    stem = ", ".join(toks[:2]) if len(toks) > 1 else (toks[0] if toks else lemma)
    return (f"{stem} {g}".strip() + _paren(notes)).strip()


def adj_dict(lemma: str) -> str:
    """magnus, -a, -um / omnis, -e / fēlīx, gen. fēlīcis / quot (indeclinable)"""
    body, notes = take_notes(positive_lemma(lemma))
    toks = body.split()
    if "," in body:
        out = re.sub(r"\s*,\s*", ", ", body)
    elif len(toks) == 2 and toks[1].startswith("-") and toks[0].endswith("or"):
        out = f"{toks[0]}, {toks[0][:-2]}us"   # maior -us → maior, maius
    else:
        out = ", ".join(toks)
    gen = [n for n in notes if n.startswith("gen.")]
    rest = [n for n in notes if not n.startswith("gen.")]
    if gen and len(toks) == 1:
        out = f"{out}, {gen[0]}"               # fēlīx, gen. fēlīcis
        gen = []
    return out + _paren(gen + rest)


def verb_dict(lemma: str) -> str:
    """amō, amāre, amāvī, amātum — Whitaker's lemma already joins the principal
    parts with commas, a supplement's Ørberg-style one (`vorō -āre -āvī -ātum`)
    with spaces; a perfect in `-us sum` and a bracketed alternative belong to the
    part before them."""
    out = DEFECTIVE_NOTE.sub("", lemma)
    parts: list[str] = []
    for tok in re.split(r"[,\s]+", out.strip()):
        if not tok:
            continue
        if parts and (tok in ("sum", "est") or tok.startswith("(")):
            parts[-1] += " " + tok
        else:
            parts.append(tok)
    return ", ".join(parts)


def prep_dict(e: dict) -> str:
    """in (+ acc./abl.)"""
    lemma = positive_lemma(e["lemma"]).split(",")[0].strip()
    order = ["acc", "dat", "abl", "gen"]
    govs = {p.get("governs") for p in e.get("parses") or []} | {e.get("kind")}
    govs = [c for c in order if c in govs]
    return f"{lemma} (+ {'/'.join(CASE_WORD[c] for c in govs)})" if govs else lemma


def dict_form(e: dict) -> tuple[str, str | None]:
    """→ (dict line, principal parts).  One shape per part of speech, the way a
    textbook writes it; nothing here ever emits a stray comma, a `·` or the word
    "comparative" (see check_dict_line)."""
    pos = e["pos"]
    lemma = positive_lemma(e["lemma"])
    if pos in ("V", "VPAR"):
        d = verb_dict(lemma)
        return d, d
    if pos == "N":
        return noun_dict(e["lemma"], e.get("gender")), None
    if pos == "ADJ":
        return adj_dict(e["lemma"]), None
    if pos == "PREP":
        return prep_dict(e), None
    if pos == "PRON":
        return re.sub(r"\s*,\s*", ", ", lemma), None
    return lemma, None   # ADV, CONJ, INTERJ: the plain word


DICT_SHAPE = {
    # nom(, gen) + optional gender + optional note
    "N": re.compile(r"^\S+(?:, [^,()]+)?(?: (?:m\.|f\.|n\.|m\./f\.))?(?: \([^()]+\))?$"),
    # one to three terminations, or a one-termination adjective with its genitive
    "ADJ": re.compile(r"^\S+(?:, [^,()]+){0,2}(?: \([^()]+\))?$"),
    "V": re.compile(r"^\S+(?: \([^()]+\))?(?:, [^,()]+(?: \([^()]+\))?)*$"),
    "PRON": re.compile(r"^\S+(?:, [^,()]+){0,2}$"),
    "PREP": re.compile(r"^\S+(?: \(\+ (?:acc\.|dat\.|abl\.|gen\.)(?:/(?:acc\.|dat\.|abl\.|gen\.))*\))?$"),
    "ADV": re.compile(r"^[^,()·]+$"),
    "CONJ": re.compile(r"^[^,()·]+$"),
    "INTERJ": re.compile(r"^[^,()·]+$"),
}
DICT_JUNK = re.compile(r",,|,\s*,| ,|·|\bcomparative\b|\bsuperlative\b|\s{2,}|^[,\s]|[,\s]$")


def check_dict_line(d: str, pos: str) -> str | None:
    """None when the line is a textbook dictionary entry, else what is wrong."""
    if not d:
        return "empty"
    if DICT_JUNK.search(d):
        return f"malformed: {d!r}"
    shape = DICT_SHAPE.get(pos)
    if shape and not shape.match(d):
        return f"not a {pos} dictionary line: {d!r}"
    return None


def headword(e: dict) -> str:
    return positive_lemma(e["lemma"]).split(",")[0].split()[0]


# ------------------------------------------------------------------ teaching gloss

GLOSS_MAX = 3
# "no abbreviations": senses.py has already expanded Whitaker's own (w/ACC, esp.,
# pl. …); this catches anything that slipped through.
ABBREV_RE = re.compile(r"\b(?:w/|abbr|cf|e\.g|i\.e|etc|esp|usu|fig|lit|sc|pl|sg|acc|abl|dat|gen|voc|nom|subj|inf|impf|perf)\.")
# capitals a gloss is allowed to keep
KEEP_CAPS = {"god", "roman", "romans", "rome", "greek", "greeks", "latin", "italy",
             "i", "german", "spanish", "gallic", "gaul", "trojan", "christian",
             "sicilian", "sicily", "egyptian", "egypt", "spain", "kalends", "ides",
             "january", "february", "march", "april", "may", "june", "july",
             "august", "september", "october", "november", "december"}


def short_gloss(sense: str) -> str:
    """At most three senses from one Whitaker sense line: parenthetical grammar
    notes off, lower case, comma-separated."""
    s = re.sub(r"\s*\([^()]*\)", " ", sense)          # (with the dative), (in the plural)
    s = re.sub(r"\[[^\]]*\]", " ", s)
    s = re.split(r"[()\[\]]", s)[0]                   # an unbalanced bracket ends the gloss
    s = re.sub(r"\s*;\s*", ", ", s)
    parts = [p.strip(" .;:") for p in s.split(",")]
    # an unbalanced bracket the sense rewrite left behind ends the gloss
    parts = [p for p in parts if p and "(" not in p and ")" not in p and not ABBREV_RE.search(p)]
    out = ", ".join(parts[:GLOSS_MAX])
    out = re.sub(r"\s+", " ", out).strip(" ,")
    return " ".join(w if w.lower().strip(".,") in KEEP_CAPS and w[:1].isupper() else w.lower()
                    for w in out.split())


def gloss_for(key: tuple[str, str], senses: list[str]) -> str:
    """The teaching gloss shown as the drill prompt.  GLOSS_OVERRIDES first (the
    sense Familia Romana uses, judged against the word's own library sentence),
    then the preferred Whitaker sense cut to three."""
    if key in GLOSS_OVERRIDES:
        return GLOSS_OVERRIDES[key]
    return short_gloss(senses[0]) or short_gloss(" ".join(senses)) or senses[0].lower()


def check_gloss(g: str) -> str | None:
    if not g:
        return "empty"
    if len([p for p in g.split(",") if p.strip()]) > GLOSS_MAX:
        return f"more than {GLOSS_MAX} senses: {g!r}"
    if "(" in g or ")" in g or "[" in g:
        return f"parenthetical note: {g!r}"
    if ABBREV_RE.search(g):
        return f"abbreviation: {g!r}"
    for w in g.split():
        if w[:1].isupper() and w.lower().strip(".,") not in KEEP_CAPS:
            return f"not lower case: {g!r}"
    return None


# ------------------------------------------------------------------ build

def build(chapters_wanted: list[int] | None = None, report: bool = False) -> dict[int, dict]:
    glossary = json.loads(GLOSSARY.read_text(encoding="utf-8"))
    lem = Lemmatiser(glossary)
    library = library_units()
    unit_ids = {u["id"] for units in library.values() for u in units}

    # pass 0: every token with its spellings, lower-case attestation, sentence position
    occurrences: list[tuple[int, str, str, bool]] = []  # (chapter, unit id, token, initial)
    spellings: dict[str, Counter] = defaultdict(Counter)
    lower_seen: set[str] = set()
    non_initial_cap: set[str] = set()
    for c, units in library.items():
        for u in units:
            for tok, initial in tokens_of(u["la"]):
                occurrences.append((c, u["id"], tok, initial))
                spellings[skeleton(tok)][tok] += 1
                if tok[:1].islower():
                    lower_seen.add(skeleton(tok))
                elif not initial:
                    non_initial_cap.add(skeleton(tok))

    # pass 1: candidate readings per form; anchor counts from unambiguous forms
    candidates: dict[str, list[dict]] = {}
    anchors: Counter = Counter()
    for form, sp in spellings.items():
        if len(form) == 1 and form == strip_macrons(form):
            candidates[form] = []
            continue
        all_ents = lem.entries(sp.most_common(1)[0][0], sp)
        if len(form) <= 2 and (skeleton(form) not in glossary and canonical(form) not in glossary
                               or sum(sp.values()) <= 3):
            candidates[form] = []  # a fragment the OCR left ("su", "nā", "Ōr") is not a word
            continue
        if all_ents and all_ents[0]["pos"] == "NUM":
            candidates[form] = []  # a numeral form (ūna, duo, tertius) is a numeral
            continue
        if form in FORM_OVERRIDES:
            all_ents = [e for e in all_ents if e["h"] == FORM_OVERRIDES[form]]
        ents = [e for e in all_ents if usable(e)]
        if any(not e.get("enc") for e in ents):
            ents = [e for e in ents if not e.get("enc")]  # quoque is one word, not quō + que
        # one reading per lemma, the glossary's first
        seen: set[tuple[str, str]] = set()
        uniq = []
        for e in ents:
            k = lemma_key(e)
            if k not in seen:
                seen.add(k)
                uniq.append(e)
        uniq.sort(key=lambda e: 0 if (canonical(e["h"]), e["pos"]) in POS_PREFERRED else 1)
        candidates[form] = uniq
        if len(uniq) == 1:
            anchors[lemma_key(uniq[0])] += sum(sp.values())
    lem.save()

    # pass 2: choose a reading per form
    chosen: dict[str, dict | None] = {}
    for form, ents in candidates.items():
        if not ents:
            chosen[form] = None
            continue
        first = ents[0]
        pick = first
        # an indeclinable word is never displaced by an inflected homograph:
        # satis is not satus, forte is not fortis, sīve is not sī + -ve
        if len(ents) > 1 and first["pos"] not in ("PRON", "ADV", "CONJ", "PREP", "INTERJ"):
            a0 = anchors[lemma_key(first)]
            # a participle reading never displaces a noun / adjective (Crēta, secundus, facta)
            alts = [e for e in ents[1:] if not (e["pos"] == "VPAR" and first["pos"] in ("N", "ADJ"))]
            if alts:
                alt = max(alts, key=lambda e: anchors[lemma_key(e)])
                if anchors[lemma_key(alt)] >= max(3, 3 * a0):
                    pick = alt
        chosen[form] = pick

    # a form that is never lower-case and occurs inside a sentence is a name,
    # unless it is one of the capitalised adjectives of nationality
    def is_name(form: str, e: dict) -> bool:
        sp = spellings[form]
        caps = sum(n for f, n in sp.items() if f[:1].isupper()) / max(1, sum(sp.values()))
        ents = lem.entries(form)
        if caps >= 0.8 and ents and is_proper_entry(ents[0]):
            return True  # Iūlius is a name even where Whitaker also offers the adjective "July"
        if e["pos"] not in ("N", "ADJ"):
            return False  # Ecce, Nōlī: capitalised by position, not names
        if caps >= 0.9 and form in non_initial_cap:
            return not (e["pos"] == "ADJ" and canonical(headword(e)) in NATIONAL_ADJ)
        if caps == 1.0 and e["pos"] == "N" and sum(sp.values()) >= 3 and skeleton(form) not in glossary:
            return True  # Albīnus: a Whitaker-only noun that is never lower-case
        return False

    # pass 3: first chapter, first unit, counts
    first: dict[tuple[str, str], tuple[int, str, dict]] = {}
    positive: dict[tuple[str, str], dict] = {}   # the entry whose lemma is the positive
    counts: Counter = Counter()
    forms_of: dict[tuple[str, str], Counter] = defaultdict(Counter)
    skipped_names: Counter = Counter()
    for c, uid, tok, initial in occurrences:
        form = skeleton(tok)
        e = chosen.get(form)
        if e is None:
            continue
        if is_name(form, e):
            skipped_names[tok] += 1
            continue
        k = lemma_key(e)
        counts[k] += 1
        forms_of[k][tok] += 1
        if k not in first:
            first[k] = (c, uid, e)
        if k not in positive and positive_lemma(e["lemma"]) == e["lemma"].strip():
            positive[k] = e

    # a supplement's comparative / superlative headword joins its positive when the
    # positive occurs somewhere in the library; its occurrences count towards it
    folded_degrees: list[tuple[str, str]] = []
    for k in sorted(first):
        base = (DEGREE_POSITIVE.get(k), k[1])
        if not base[0] or base not in first:
            continue
        c_b, u_b, e_b = first[base]
        c_k, u_k, _ = first[k]
        if (c_k, u_k) < (c_b, u_b):
            first[base] = (c_k, u_k, e_b)   # earlier occurrence, positive's dictionary entry
        counts[base] += counts[k]
        forms_of[base].update(forms_of[k])
        folded_degrees.append((k[0], base[0]))
        del first[k]
        positive.pop(k, None)
    if folded_degrees:
        print("degree forms folded into their positive: "
              + ", ".join(f"{a} → {b}" for a, b in folded_degrees))

    # a lemma the library only ever shows in the comparative or the superlative
    degree_only = sorted(k for k in first if k not in positive)
    if degree_only:
        print("positive degree never occurs: "
              + ", ".join(f"{headword(first[k][2])} ({k[1].lower()}, ch {first[k][0]})" for k in degree_only))

    decks: dict[int, dict] = {c: {"chapter": c, "words": []} for c in CHAPTERS}
    for k, (c, uid, e) in first.items():
        if c not in decks:
            continue
        e = positive.get(k, e)   # maior is learnt as magnus, celerrimē as celeriter
        d, parts = dict_form(e)
        head = headword(e)
        if head == strip_macrons(head) and e["pos"] != "PRON":
            # the glossary spelt this headword without macrons; when the library's usual
            # spelling of that form carries them (vocābulum ×15, vocabulum ×0), use it
            sp = Counter()
            for f, n in spellings.get(skeleton(head), {}).items():
                sp[f.lower()] += n
            if sp:
                usual = sp.most_common(1)[0][0]
                # never from the ablative of a 1st-declension word: the library's
                # commonest spelling of "vigilia" is "vigiliā", but the nominative
                # (and so the dictionary line) has a short -a
                if usual.endswith("ā") and e["pos"] in ("N", "ADJ"):
                    usual = usual[:-1] + "a"
                if usual != strip_macrons(usual):
                    d = d.replace(head, usual, 1)
                    if parts:
                        parts = parts.replace(head, usual, 1)
                    head = usual
        word = {
            "lemma": head,
            "dict": d,
            "pos": "V" if e["pos"] == "VPAR" else e["pos"],
            "gender": e.get("gender") if e["pos"] == "N" else None,
            "decl": (e.get("cat") or [None])[0] if e["pos"] in ("N", "ADJ") else None,
            "meaning": gloss_for(k, e["senses"]),
            "sense_full": e["senses"][0],
            "parts": parts,
            "unit_id": uid,
            "count": counts[k],
        }
        decks[c]["words"].append(word)
    for c in decks:
        decks[c]["words"].sort(key=lambda w: (-w["count"], strip_macrons(w["lemma"]).lower()))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for c in (chapters_wanted or list(CHAPTERS)):
        path = OUT_DIR / f"{c:02d}.json"
        path.write_text(json.dumps(decks[c], ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"chapter {c:2d}: {len(decks[c]['words']):3d} words → {path.relative_to(ROOT)}")
        if report:
            for w in decks[c]["words"]:
                fk = next((k for k in forms_of if k[1] == w["pos"] and k[0].split(",")[0].split()[0] in (w["lemma"], strip_macrons(w["lemma"]))), None)
                forms = ", ".join(f"{f}×{n}" if n > 1 else f for f, n in forms_of[fk].most_common(6)) if fk else ""
                print(f"    {w['lemma']:16} {w['dict']:40} {w['pos']:5} {w['count']:4}  {w['meaning'][:36]:36}  [{w['unit_id']}]  {forms}")
    if skipped_names:
        print(f"proper names skipped: {len(skipped_names)} distinct, e.g. "
              + ", ".join(t for t, _ in skipped_names.most_common(12)))
    errs = check(unit_ids)
    for e in errs:
        print("ERROR", e)
    return decks


def check(unit_ids: set[str] | None = None) -> list[str]:
    errs: list[str] = []
    if unit_ids is None:
        unit_ids = {u["id"] for units in library_units().values() for u in units}
    seen: dict[tuple[str, str], int] = {}
    for c in CHAPTERS:
        path = OUT_DIR / f"{c:02d}.json"
        if not path.exists():
            errs.append(f"{path.name}: missing")
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as e:
            errs.append(f"{path.name}: invalid JSON ({e})")
            continue
        if data.get("chapter") != c or not isinstance(data.get("words"), list):
            errs.append(f"{path.name}: shape (chapter / words)")
            continue
        for w in data["words"]:
            for key in ("lemma", "dict", "pos", "gender", "decl", "meaning", "sense_full",
                        "parts", "unit_id", "count"):
                if key not in w:
                    errs.append(f"{path.name}: {w.get('lemma')} lacks {key}")
            if w.get("unit_id") not in unit_ids:
                errs.append(f"{path.name}: {w.get('lemma')} unit_id {w.get('unit_id')} not in the library")
            # a word belongs to the chapter where its lemma first occurs, and to no
            # other: the key is the lemma's identity, not the dictionary string
            pos = w.get("pos") or ""
            k = (HEAD_ALIAS.get((canonical(w.get("lemma") or ""), pos), canonical(w.get("lemma") or "")), pos)
            if k in seen:
                errs.append(f"{path.name}: {w.get('lemma')} ({pos}) already in chapter {seen[k]}")
            else:
                seen[k] = c
            bad = check_dict_line(w.get("dict") or "", pos)
            if bad:
                errs.append(f"{path.name}: {w.get('lemma')} dict {bad}")
            bad = check_gloss(w.get("meaning") or "")
            if bad:
                errs.append(f"{path.name}: {w.get('lemma')} meaning {bad}")
            if pos == "V" and not w.get("parts"):
                errs.append(f"{path.name}: verb {w.get('lemma')} without parts")
    return errs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("chapters", nargs="*", type=int, help="chapters to write (default 1–34)")
    ap.add_argument("--check", action="store_true", help="validate app/data/grammar/vocab/*.json only")
    ap.add_argument("--report", action="store_true", help="print every deck")
    a = ap.parse_args(argv)
    if a.check:
        errs = check()
        for e in errs:
            print("ERROR", e)
        print("vocab: OK" if not errs else f"vocab: {len(errs)} problem(s)")
        return 1 if errs else 0
    bad = [c for c in a.chapters if c not in CHAPTERS]
    if bad:
        ap.error(f"chapters must be 1–34: {bad}")
    build(a.chapters or None, report=a.report)
    return 0


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
