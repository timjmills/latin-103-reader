# Writing the plain-words layer

The learner said: "I don't always understand the notes." Every note gets a
second explanation for a struggling reader. Always set `PYTHONIOENCODING=utf-8`.

## Inputs (per week NN)

- `data/build/week-NN.json` — units with `la`, `en` (the learner's own literal
  translation), `note` (the grammar note), `margin` (Ørberg's Latin glosses).
- `data/build/highlights-week-NN.json` — focus highlights with `label`, `note`.
- `data/build/margin-week-NN.json` — the gloss source file (edit this one, not
  the week JSON; the build copies it back in).

## Output 1 — `data/grammar-notes-simple-week-NN.json`

`{ "<unit_id>": "…" }` for **every unit that has a note** (verify coverage).
Each entry, 1–3 short sentences, 20–60 words:

- Start from what the sentence *means* in ordinary English, then explain the
  one thing the note was about, in everyday words. Example, for a note saying
  "Accusative + infinitive after volō: tē manēre = 'you to stay'":
  > Latin says "I want you to stay" as "I want *you-to-stay*" — the person you
  > want something from goes in the form used for objects (tē, not tū), and
  > the action is the plain "to" form (manēre). English does the same thing:
  > "I want *him* to go".
- Any grammar word you use gets an instant everyday gloss in the same
  sentence: "the ablative (the 'by/with/from' form)", "the subjunctive (the
  form Latin uses for wishes, purposes and what someone tells someone to do)".
- Prefer analogies to English and to sentences the learner has already met in
  the course. Point at the actual Latin words.
- Never contradict the main note; simplify it. If the main note flags a slip
  in the learner's translation, say the right meaning kindly and briefly.
- No abbreviations. No new terminology.

## Output 2 — `simple` on every highlight

Add `"simple": "…"` (15–45 words) to each entry of
`data/build/highlights-week-NN.json`, same rules. Keep every other field
exactly as it is; keep the file valid JSON.

## Output 3 — `en` on every margin gloss

Add `"en": "…"` (3–12 words) to each entry of `data/build/margin-week-NN.json`:
what the gloss tells the reader, in English. Ørberg's conventions:
`X = Y` means "X means Y"; `X : Y` pairs a form with its meaning or opposite;
`↔` marks an opposite; `-ōrum n pl`, `-a -um` give the dictionary form.
Examples: `frequēns -entis = crēber` → "frequēns: numerous, crowded (= crēber)";
`immortālēs -ium m pl = diī` → "the immortals = the gods";
`sequī ↔ dūcere` → "to follow, the opposite of to lead".
Keep `line` and `la` untouched.

## Checks

    python -c "import json;d=json.load(open('data/build/week-NN.json',encoding='utf-8'));s=json.load(open('data/grammar-notes-simple-week-NN.json',encoding='utf-8'));need=[u['id'] for u in d['units'] if u.get('note')];print('missing',[i for i in need if i not in s][:5],'orphans',[k for k in s if k not in {u['id'] for u in d['units']}][:5])"
    python -c "import json;h=json.load(open('data/build/highlights-week-NN.json',encoding='utf-8'));print('highlights without simple',sum(1 for x in h if not x.get('simple')))"
    python -c "import json;m=json.load(open('data/build/margin-week-NN.json',encoding='utf-8'));print('glosses without en',sum(1 for x in m if not x.get('en')))"

All three must report zero. Do not edit `data/build/week-NN.json`, `pipeline/`, or `app/`.
