#!/usr/bin/env node
// Remove an agent worktree, but never through a link that leaves it.
//
//   node scripts/rm-worktree.mjs .claude/worktrees/agent-abc123
//   node scripts/rm-worktree.mjs --all          every worktree git lists under .claude/worktrees
//   node scripts/rm-worktree.mjs <path> --dry-run
//
// **Why this exists.** On 2026-09-12 an agent left a junction at
// `<worktree>/data/build` pointing at the main checkout's `data/build` — the
// private book text, gitignored, so not in git. `git worktree remove --force
// --force` followed that junction and deleted the *target's* contents. Nothing
// was permanently lost (Supabase had every row) but it cost an hour and a new
// script to prove it, and the Recycle Bin held nothing.
//
// `--force --force` is what makes `git worktree remove` willing to delete a
// locked or dirty tree, and it is exactly the flag you reach for when the plain
// command refuses. The lesson is not "be careful with --force"; the discipline
// was already written down and I used it anyway. The lesson is that a directory
// you are about to delete must be *looked inside* first, by something that does
// not get bored. That is this.
//
// A junction or symlink pointing **inside** the worktree is fine — deleting it
// destroys nothing outside. One pointing **outside** stops the removal dead.

import { existsSync, lstatSync, readlinkSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const all = args.includes('--all');
const targets = args.filter((a) => !a.startsWith('--'));

// `fileURLToPath`, not `url.pathname`: this repo's path contains a space, and a raw pathname keeps it
// as %20, so every path built from it missed and the guard cheerfully reported "not on disk".
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' });

/** Every link under `dir`, with where it really points. Junctions count: Node reports them as symlinks. */
function links(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) {
      let to = null;
      try { to = realpathSync(p); } catch { try { to = readlinkSync(p); } catch { to = '(unreadable)'; } }
      out.push({ path: p, to });
      continue;   // never walk through a link — that is the whole point
    }
    if (e.isDirectory()) links(p, out);
  }
  return out;
}

/** Does this link leave the worktree? A link into itself harms nothing when the tree goes. */
const escapes = (to, tree) => {
  if (!to || to === '(unreadable)') return true;   // cannot prove it is safe, so it is not
  const rel = relative(tree, to);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel);
};

function listWorktrees() {
  return git('worktree', 'list', '--porcelain').split(/\r?\n/)
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length))
    .filter((p) => resolve(p) !== resolve(ROOT));
}

let refused = 0;
for (const t of (all ? listWorktrees() : targets)) {
  const tree = resolve(ROOT, t);
  if (!existsSync(tree)) { console.log(`skip   ${t} — not on disk`); continue; }
  const real = realpathSync(tree);
  const bad = links(real).filter((l) => escapes(l.to, real));
  if (bad.length) {
    refused += 1;
    console.error(`REFUSED ${t}`);
    for (const l of bad) console.error(`   ${relative(real, l.path) || '.'}  ->  ${l.to}`);
    console.error('   A link here points outside the worktree. Deleting the tree would follow it and');
    console.error('   destroy the target. Remove the link first, then run this again.\n');
    continue;
  }
  if (dryRun) { console.log(`would remove  ${t}  (${links(real).length} link(s), all internal)`); continue; }
  try {
    git('worktree', 'remove', '--force', tree);
    console.log(`removed ${t}`);
  } catch (e) {
    console.error(`failed  ${t} — ${String(e.stderr || e.message).trim().split('\n').pop()}`);
    refused += 1;
  }
}
if (refused) process.exitCode = 1;
