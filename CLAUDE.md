# Latin 103 Reader

- Before changing the Daily Study Plan, read `docs/DAILY-PLAN.md`. It holds the learner's standing rules: the day's
  three phases and their time limits, class-week preparation (first class Sat 5 Sep 2026), tables only, and when to
  publish.
- After app changes: bump `CACHE_VERSION` in `app/sw.js`, run `node scripts/sw-hashes.mjs`, then `node --test tests/*.test.mjs`.
- Publish to the live site only when the learner says "push" or "publish". Push `main`, then put `main:app` on `gh-pages`.
