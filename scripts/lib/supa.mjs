// Shared helpers for the local scripts (seed, upload-audio). Node 24, no deps.
// Talks to Supabase over plain REST with global fetch — no client library needed.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Load KEY=VALUE pairs from <repo>/.env into process.env (existing vars win). */
export function loadEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

/** SUPABASE_URL / SUPABASE_KEY from app/config.js (the same values the app uses). */
export async function loadConfig() {
  const mod = await import(new URL('../../app/config.js', import.meta.url).href);
  if (!mod.SUPABASE_URL || !mod.SUPABASE_KEY) throw new Error('app/config.js must export SUPABASE_URL and SUPABASE_KEY');
  return { url: mod.SUPABASE_URL.replace(/\/$/, ''), key: mod.SUPABASE_KEY };
}

const CTRL_C = String.fromCharCode(3);
const DEL = String.fromCharCode(127);
const BS = String.fromCharCode(8);

async function askHidden(prompt) {
  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    const v = await rl.question(prompt);
    rl.close();
    return v;
  }
  stdout.write(prompt);
  return new Promise((resolve) => {
    let buf = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunkStr) => {
      for (const c of chunkStr) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(buf);
          return;
        }
        if (c === CTRL_C) { stdout.write('\n'); process.exit(130); }
        if (c === DEL || c === BS) { buf = buf.slice(0, -1); continue; }
        buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

/** Email + password from SEED_EMAIL / SEED_PASSWORD (.env or env) or an interactive prompt. */
export async function credentials() {
  loadEnv();
  let email = process.env.SEED_EMAIL;
  let password = process.env.SEED_PASSWORD;
  if (!email) {
    const rl = createInterface({ input: stdin, output: stdout });
    email = (await rl.question('Supabase user email: ')).trim();
    rl.close();
  }
  if (!password) password = await askHidden('Password (hidden): ');
  if (!email || !password) throw new Error('Email and password are required');
  return { email, password };
}

/** Password sign-in → { access_token, user: { id, email } }. */
export async function signIn({ url, key }, { email, password }) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error_description || body.msg || body.message || body.error || res.statusText;
    throw new Error(`Sign-in failed (${res.status}): ${msg}`);
  }
  return { access_token: body.access_token, user: body.user };
}

/** Minimal authed HTTP client for PostgREST + Storage. */
export function client({ url, key }, session) {
  const base = { apikey: key, Authorization: `Bearer ${session.access_token}` };
  async function call(method, path, { body, headers = {}, raw = false } = {}) {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { ...base, ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body == null ? undefined : raw ? body : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${path} → ${res.status} ${res.statusText}\n${text.slice(0, 600)}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }
  return {
    uid: session.user.id,
    get: (path, opts) => call('GET', path, opts),
    post: (path, body, opts = {}) => call('POST', path, { ...opts, body }),
    patch: (path, body, opts = {}) => call('PATCH', path, { ...opts, body }),
    delete: (path, opts) => call('DELETE', path, opts),
  };
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const pad2 = (n) => String(n).padStart(2, '0');
