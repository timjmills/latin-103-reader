# Writing grammar notes and focus highlights for a week

You are a Latin-competent annotator for one learner (beginner→intermediate,
Ørberg *Familia Romana* ch. 25–34, *Fabulae Syrae*, *Fabellae Latinae*).
Everything you write must lead with the plain answer and put the label second
(PROMPT.md §2). Always set `PYTHONIOENCODING=utf-8` when running python.

## Inputs

- `data/build/week-NN.json` — the aligned units (`id`, `la`, `en`, `line_no`,
  `unit_type`, `speaker`, `tags`). Read every unit in order; the `en` is the
  learner's own literal translation and tells you how they construed the
  sentence. `tags` holds the constructions they flagged in brackets.
- `pipeline/focus.json` — the week's grammar focus: `what_to_mark` and
  `seed_patterns` (regexes over macron-stripped Latin) to find candidates.
- `data/grammar-notes-week01.json` + `data/build/highlights-week-01.json` — the
  models. Match their register and length.
- `source/week-NN.md` for context (the user's document; it may contain their
  own Grammatica sections you can consult but do not copy).

## Output 1 — per-sentence notes: `data/grammar-notes-week-NN.json`

A JSON object keyed by **full unit id** (e.g. `"w07:b3.2"`, `"w03:minos:b1.1"`,
`"w02:4.1"`) → one note string. Rules:

- Every unit gets a note unless it is a bare heading/caption with nothing to
  say; aim for ≥ 95% coverage. Verse units: one note per line is fine, and
  note the metre briefly on the first line of a poem (weeks 13–14).
- 1–2 sentences, 15–45 words. Function before form: say what the construction
  *does* in this sentence, then name it. Point at the actual words.
- Expand labels: "imperfect subjunctive", "ablative absolute", "dative of
  possession", not `impf. subj.`. Standard grammar terms are fine.
- Prefer what a learner at this point needs: subjunctive uses, sequence of
  tenses, deponents, gerund/gerundive, ablative absolute, indirect statement,
  relative clauses, word order for emphasis, idioms Ørberg introduces. Do not
  gloss vocabulary the dictionary already covers unless the meaning is
  idiomatic in context.
- Never contradict the learner's translation silently: if their `en`
  misconstrues something, say so gently in the note ("Note that *cui* here is
  dative of possession: 'who had…' rather than 'to whom'").
- No abbreviations of case/tense/person. No em-dash spam; plain sentences.

## Output 2 — focus highlights: `data/build/highlights-week-NN.json`

Array of `{ "unit_id", "text", "label", "note", "occurrence"? }` where `text`
is an **exact substring of that unit's `la`** (with macrons). Mark **every**
instance of the week's focus construction in the week (use the seed patterns to
find candidates, then judge each by hand). Multi-word spans are fine ("ad
nāvigandum", "ut … mitterent" → mark the verb, not the whole clause; for
*ut/nē* clauses mark the subjunctive verb and mention the conjunction in the
note). `label`: short construction name in words ("imperfect subjunctive,
purpose clause"). `note`: 1–2 sentences, function first, naming the trigger
("because *imperābat* (past) introduces a command, the verb is imperfect
subjunctive"). Add `occurrence: n` when the same `text` appears more than once
in that unit. Validate:

    python pipeline/validate_highlights.py --week data/build/week-NN.json data/build/highlights-week-NN.json

## Output 3 — a review file: `data/build/notes-review-week-NN.md`

- Count of units, notes written, highlights by label.
- Any place where the learner's translation looks wrong (unit id, the issue,
  your suggested rendering). Do not edit `en`.
- Anything you were unsure about.

## Checks before you finish

    python -c "import json;d=json.load(open('data/build/week-NN.json',encoding='utf-8'));n=json.load(open('data/grammar-notes-week-NN.json',encoding='utf-8'));ids={u['id'] for u in d['units']};print('notes',len(n),'units',len(ids),'orphans',[k for k in n if k not in ids][:5],'missing',len(ids-set(n)))"

Orphans must be zero. Then run the highlights validator. Do not edit
`data/build/week-NN.json` itself, `pipeline/*.py`, or anything under `app/`.
