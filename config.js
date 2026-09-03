// Supabase connection for the public shell.
// These values are safe to commit: the publishable key only grants what the
// row-level-security policies allow, and every table requires a signed-in user.
export const SUPABASE_URL = 'https://fpsejqtafqjduebvqdkz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_J6-I-fo2M0fE1WoSWFN57g_nnFoqbTU';

// Shown in the UI / logs. The service worker keeps its own CACHE_VERSION
// constant (app/sw.js) because a classic worker cannot import an ES module.
export const APP_VERSION = '2026.09.03-1';
