// Auth for the Latin 103 Reader — one user, email + password, Supabase.
//
//   import { auth, getClient } from './auth.js';
//   const user = await auth.ensureSignedIn();   // shows the sign-in form if needed
//   auth.onChange((user) => { … });             // user | null
//   await auth.signOut();                       // clears caches (store hooks in), shows the form again
//
// The vendored supabase-js UMD build is injected as a classic <script> the
// first time a client is needed, so index.html only has to import main.js.
// Passwords are never stored: the form field is cleared as soon as it is read.

import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import * as db from './db.js';

const VENDOR_URL = new URL('../vendor/supabase.js', import.meta.url).href;

let clientPromise = null;
let currentUser = null;
let signingOut = false;
let overlayPromise = null;
const changeListeners = new Set();
const signOutHooks = new Set();

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-vendor="supabase"]`);
    if (existing) {
      if (globalThis.supabase?.createClient) return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load Supabase client')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.vendor = 'supabase';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Supabase client'));
    document.head.appendChild(s);
  });
}

/** The shared supabase-js client (loads the vendored script on first call). */
export function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      if (!globalThis.supabase?.createClient) await loadScript(VENDOR_URL);
      const client = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          handleRemoteSignOut();
          return;
        }
        if (session?.user) setUser(session.user);
      });
      return client;
    })().catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

function setUser(u) {
  const next = u ? { id: u.id, email: u.email || '', offline: Boolean(u.offline) } : null;
  const changed = (next?.id || null) !== (currentUser?.id || null) || Boolean(next?.offline) !== Boolean(currentUser?.offline);
  currentUser = next;
  if (changed) for (const cb of changeListeners) { try { cb(currentUser); } catch (e) { console.error(e); } }
}

async function runSignOutHooks() {
  for (const fn of signOutHooks) {
    try { await fn(); } catch (e) { console.error('[auth] sign-out hook failed', e); }
  }
}

// Session revoked / expired on the server (not user-initiated).
async function handleRemoteSignOut() {
  if (signingOut) return;
  if (!currentUser) return;
  await runSignOutHooks();
  setUser(null);
  reloadShell();
}

// After any sign-out the rendered texts must leave the DOM too: the cheapest
// airtight way is a fresh load, which boots straight into the sign-in form.
function reloadShell() {
  try { location.replace(location.pathname); } catch { location.reload(); }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function friendlyError(err) {
  const msg = String(err?.message || err || '');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You are offline. Connect to the internet to sign in.';
  if (/invalid login credentials|invalid_credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'This account has not been confirmed yet. Confirm it in the Supabase dashboard.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
  if (/fetch|network|load supabase/i.test(msg)) return 'Could not reach the server. Check your connection and try again.';
  return msg || 'Sign-in failed.';
}

async function signIn(email, password) {
  const client = await getClient();
  const { data, error } = await client.auth.signInWithPassword({ email: String(email).trim(), password });
  password = null; // eslint-disable-line no-param-reassign
  if (error) throw new Error(friendlyError(error));
  setUser(data.user);
  return currentUser;
}

async function signOut() {
  signingOut = true;
  try {
    await runSignOutHooks();
    try {
      const client = await getClient();
      await client.auth.signOut();
    } catch (e) {
      console.warn('[auth] server sign-out failed (offline?) — local session cleared anyway', e);
    }
    setUser(null);
  } finally {
    signingOut = false;
  }
  reloadShell();
}

function user() {
  return currentUser;
}

function onChange(cb) {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

/** Register work to run before the session is dropped (store clears caches). */
function onSignOut(fn) {
  signOutHooks.add(fn);
  return () => signOutHooks.delete(fn);
}

/**
 * Resolve with the signed-in user. If there is no session, show the sign-in
 * form and resolve once it succeeds. Offline with a remembered user →
 * resolves with { …, offline: true } so the cached texts can be read.
 */
async function ensureSignedIn() {
  if (currentUser) return currentUser;
  let session = null;
  try {
    const client = await getClient();
    const res = await client.auth.getSession();
    session = res?.data?.session || null;
  } catch (e) {
    console.warn('[auth] could not load client/session', e);
  }
  if (session?.user) {
    setUser(session.user);
    return currentUser;
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline) {
    try {
      const id = await db.getMeta('user_id');
      if (id) {
        setUser({ id, email: (await db.getMeta('user_email')) || '', offline: true });
        return currentUser;
      }
    } catch { /* no cache */ }
  }
  return showSignInForm();
}

export const auth = { signIn, signOut, user, onChange, onSignOut, ensureSignedIn };

// ---------------------------------------------------------------------------
// Sign-in overlay (semantic markup; tokens from app/css/tokens.css)
// ---------------------------------------------------------------------------

const STYLE = `
.auth-overlay{position:fixed;inset:0;z-index:var(--z-modal,30);display:grid;place-items:center;padding:var(--s-4,1rem);background:var(--bg,#fdfcfa);color:var(--ink,#222);font-family:var(--face-ui,system-ui,sans-serif)}
.auth-card{width:100%;max-width:22rem;display:grid;gap:var(--s-3,.75rem);padding:var(--s-5,1.5rem);background:var(--bg-raised,#fff);border:1px solid var(--line,#ddd);border-radius:var(--radius-lg,12px);box-shadow:var(--shadow-pop,0 6px 18px rgba(0,0,0,.14))}
.auth-title{margin:0;font-family:var(--face-reading,Georgia,serif);font-weight:600;font-size:1.5rem;line-height:1.2;color:var(--rubric-ink,#7a2a1f)}
.auth-lede{margin:0 0 var(--s-2,.5rem);color:var(--ink-2,#555);font-size:var(--ui-md,.9375rem)}
.auth-field{display:grid;gap:var(--s-1,.25rem)}
.auth-label{font-size:var(--ui-sm,.8125rem);font-weight:600;color:var(--ink-2,#555)}
.auth-input{font:inherit;font-size:1rem;min-height:var(--tap,44px);padding:0 var(--s-3,.75rem);color:var(--ink,#222);background:var(--bg,#fdfcfa);border:1px solid var(--line-strong,#aaa);border-radius:var(--radius,8px)}
.auth-input:focus-visible{outline:2px solid var(--focus,#2a6db5);outline-offset:2px}
.auth-input[aria-invalid="true"]{border-color:var(--danger,#b3261e)}
.auth-error{margin:0;min-height:1.25em;font-size:var(--ui-sm,.8125rem);color:var(--danger,#b3261e)}
.auth-error:empty{display:none}
.auth-submit{font:inherit;font-weight:600;min-height:var(--tap,44px);padding:0 var(--s-4,1rem);color:#fff;background:var(--rubric,#7a2a1f);border:0;border-radius:var(--radius,8px);cursor:pointer;transition:opacity var(--t-fast,120ms)}
.auth-submit:hover{opacity:.92}
.auth-submit:focus-visible{outline:2px solid var(--focus,#2a6db5);outline-offset:2px}
.auth-submit[disabled]{opacity:.6;cursor:progress}
.auth-note{margin:0;font-size:var(--ui-xs,.75rem);color:var(--ink-3,#777)}
`;

function ensureStyles() {
  if (document.getElementById('auth-styles')) return;
  const el = document.createElement('style');
  el.id = 'auth-styles';
  el.textContent = STYLE;
  document.head.appendChild(el);
}

function showSignInForm() {
  if (overlayPromise) return overlayPromise;
  overlayPromise = new Promise((resolve) => {
    ensureStyles();
    const overlay = document.createElement('div');
    overlay.className = 'auth-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'auth-title');
    overlay.innerHTML = `
      <form class="auth-card" novalidate>
        <h1 class="auth-title" id="auth-title">Latin 103 Reader</h1>
        <p class="auth-lede">Sign in to open your texts.</p>
        <div class="auth-field">
          <label class="auth-label" for="auth-email">Email</label>
          <input class="auth-input" id="auth-email" name="email" type="email" autocomplete="username"
                 inputmode="email" autocapitalize="none" spellcheck="false" required>
        </div>
        <div class="auth-field">
          <label class="auth-label" for="auth-password">Password</label>
          <input class="auth-input" id="auth-password" name="password" type="password"
                 autocomplete="current-password" required>
        </div>
        <p class="auth-error" id="auth-error" role="alert" aria-live="assertive"></p>
        <button class="auth-submit" type="submit">Sign in</button>
        <p class="auth-note">Private reader. Your texts and progress are only visible to you.</p>
      </form>`;

    const form = overlay.querySelector('form');
    const email = overlay.querySelector('#auth-email');
    const password = overlay.querySelector('#auth-password');
    const errorEl = overlay.querySelector('#auth-error');
    const submit = overlay.querySelector('.auth-submit');

    const previouslyFocused = document.activeElement;
    // Everything behind the overlay is inert while it is open (the shell has
    // already rendered its header when a session expires mid-use).
    const behind = [...document.body.children].filter((el) => el !== overlay && !el.inert);
    for (const el of behind) el.inert = true;
    const setError = (msg) => {
      errorEl.textContent = msg || '';
      for (const input of [email, password]) {
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        if (msg) input.setAttribute('aria-describedby', 'auth-error');
        else input.removeAttribute('aria-describedby');
      }
    };

    // Keep Tab inside the dialog.
    overlay.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Tab') return;
      const focusables = [email, password, submit];
      const i = focusables.indexOf(document.activeElement);
      if (ev.shiftKey && (i === 0 || i === -1)) { ev.preventDefault(); submit.focus(); }
      else if (!ev.shiftKey && i === focusables.length - 1) { ev.preventDefault(); email.focus(); }
    });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const e = email.value.trim();
      const p = password.value;
      password.value = '';
      if (!e || !p) { setError('Enter your email and password.'); (e ? password : email).focus(); return; }
      setError('');
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      try {
        const u = await signIn(e, p);
        overlay.remove();
        for (const el of behind) el.inert = false;
        overlayPromise = null;
        if (previouslyFocused?.focus) previouslyFocused.focus();
        resolve(u);
      } catch (err) {
        setError(friendlyError(err));
        submit.disabled = false;
        submit.textContent = 'Sign in';
        password.focus();
      }
    });

    document.body.appendChild(overlay);
    email.focus();
  });
  return overlayPromise;
}
