# Latin 103 Reader

A private reading app for one learner working through Ancient Language
Institute Latin 103 — *Familia Romana* chapters 25–34, *Fabulae Syrae* and
*Fabellae Latinae* — over fourteen weeks.

- Read each week's Latin with your own English translation a tap away
  (hidden, or interleaved sentence by sentence).
- Tap any word for a plain-English meaning first, the grammar second, and the
  full paradigm table with your form lit up.
- Every word you look up gets a yellow underline everywhere until you mark it
  learned. Progress syncs between your phone, tablet and computer.
- The week's grammar focus glows in the text; tap a glow for a note.
- With a chapter recording uploaded and aligned once, tap a sentence to hear
  just that sentence, or play the chapter with follow-along highlighting.
- Works offline after the first sign-in. Dark mode, five type sizes, three
  typefaces.

The app shell is public (GitHub Pages); the texts, translations, notes and
audio are private, behind your login, in Supabase. See **Privacy** below.

---

## One-time setup

You need: a free [Supabase](https://supabase.com) project (already created:
`fpsejqtafqjduebvqdkz`), a GitHub account, [Node 24](https://nodejs.org) and
Python 3.13 on your computer.

### 1. Create your login

Only you will ever sign in, so the account is created by hand rather than
through a sign-up form.

1. Open the Supabase dashboard → your project → **Authentication → Users**.
2. Click **Add user → Create new user**.
3. Enter your email and a strong password, tick **Auto Confirm User**, click
   **Create user**.

### 2. Turn off public sign-ups

1. **Authentication → Sign In / Providers → Email**.
2. Switch **Allow new users to sign up** off and save.
3. (Optional, recommended) **Authentication → Sign In / Providers**: switch
   off every provider except Email.

With sign-ups off nobody else can create an account, and row-level security
means even a second account could never see your rows.

### 3. Database and storage

The schema is already applied to the project (tables `weeks`, `units`,
`highlights`, `lookups`, `audio_alignments`, `settings`, plus the private
`audio` bucket). The SQL lives in `supabase/migrations/` if you ever need to
recreate it: paste each file, in order, into **SQL Editor → New query → Run**.

### 4. Put your credentials where the scripts can find them

Create a file called `.env` in the project folder (it is gitignored):

```
SEED_EMAIL=you@example.com
SEED_PASSWORD=your-password
```

Or skip this and the scripts will ask you each time (the password is not
echoed).

### 5. Build and seed Week 1

```
python -m pip install -r pipeline/requirements.txt   # once
python pipeline/build_week.py 1            # source/week-01.md → data/build/week-01.json (+ report)
node scripts/seed.mjs --dry-run            # shows what would be uploaded
node scripts/seed.mjs                      # signs in as you, uploads weeks/units/highlights
```

Re-running the seed is safe: it updates what changed, removes sentences that
disappeared, and replaces the highlight notes.

### 6. Upload recordings (optional, any time)

Put Luke Ranieri's chapter MP3s in `audio/` named `week-01.mp3` …
`week-14.mp3` (under 50 MB each; re-encode at 96 kbps if one is bigger), then:

```
node scripts/upload-audio.mjs
```

They go to the private bucket under your user id. Alternatively use the
**Upload audio** control in the app.

### 7. Align the audio (once per week, in the app)

Open the week → **Align audio**. Press **Start playback**, then hit the big
button (or the space bar) the moment each sentence begins. **Undo last** if
you were early; **Pause** if you need a breath; **Finish and save** when done.
From then on, tapping a sentence plays that sentence, and **Play chapter**
highlights along.

### 8. Deploy the app shell

The shell is already live at **https://timjmills.github.io/latin-103-reader/**
(GitHub Pages, served from the `gh-pages` branch, which holds only the
contents of `app/`). After changing anything under `app/`, publish it with:

```bash
git subtree push --prefix app origin gh-pages
```

Optional: `deploy/pages-workflow.yml` is a GitHub Actions workflow that does
the same on every push to `main`. To use it, refresh the CLI token with the
`workflow` scope (`gh auth refresh -h github.com -s workflow`), move the file
to `.github/workflows/deploy.yml`, push, and switch **Settings → Pages →
Source** to *GitHub Actions*.

Open that address on each device, sign in, and add it to the home screen
(Share → *Add to Home Screen* on iPhone; the install prompt on Android and
desktop Chrome).

---

## Daily use

- Sign in once per device; you stay signed in.
- Pick the week. Latin shows by default; **E** (or the toggle) shows the
  English; **H** toggles the grammar-focus glow; **J/K** or the arrows move
  between sentences in sentence view.
- Tap a word for its entry. It gets a yellow underline everywhere. Mark it
  learned from the entry when you know it.
- Everything you do is saved on the device immediately and sent to Supabase
  when you are online, so it appears on your other devices within a second or
  two. If two devices disagree, the most recent change wins.
- **Sign out** wipes the texts and audio cache from that device.

## Adding weeks 2–14

1. Copy each week document into `source/` as `week-02.md` … `week-14.md`,
   in the same format as `week-01.md`. Put the `Week-NN-*.pdf` scans in
   `scans/` for the weeks that need line numbers recovered.
2. Run the pipeline (see `pipeline/README.md`) — it produces
   `data/build/week-NN.json`, the highlight files, and a mismatch report per
   week for you to check.
3. `node scripts/seed.mjs` (or `--weeks 2,3` for just some).
4. Reload the app; the new weeks download automatically.

## Working on the app locally

```
python -m http.server 8000        # from the project folder
```

then open <http://localhost:8000/app/>. `node --test "tests/*.test.mjs"` runs
the JavaScript tests; `python -m pytest pipeline/` the Python ones. When you
change anything under `app/`, bump `CACHE_VERSION` in `app/sw.js` so
installed copies pick up the new files.

## Privacy model

- The Latin (Ørberg, Miraglia) and the recordings are copyrighted; your
  translations and notes are yours. **None of it is ever in the git
  repository or on GitHub Pages.** `source/`, `data/build/`, `audio/` and
  the per-week data files are gitignored, and only `app/` is ever published.
- Texts, notes, highlights, progress and settings live in Supabase tables
  that every row of is stamped with your user id. Row-level security
  policies mean the database returns nothing to anyone who is not you — even
  with the public key in `app/config.js`, which only lets the app talk to
  the API.
- Audio sits in a **private** bucket; the app fetches a signed link that
  expires after an hour.
- On each device the texts are cached in the browser's IndexedDB so the app
  works offline. Signing out clears that cache. The dictionary (derived from
  Whitaker's Words, free licence) ships with the public shell.
- No paid services, no runtime API calls to anything except your own
  Supabase project.

## Folder map

```
app/            the public shell (deployed)     scripts/     seed + audio upload (run locally)
pipeline/       Python: week-NN.md → JSON        supabase/    SQL migrations (already applied)
source/         your week documents (private)    data/build/  pipeline output (private)
audio/          your MP3s (private)              tests/       node --test
```
