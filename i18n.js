// Tiny i18n: one flat dictionary per language in locales/. To add a language, add a file there
// and list it here; `node test.mjs` checks it has every key.
import en from './locales/en.js';
import fr from './locales/fr.js';
import es from './locales/es.js';
import de from './locales/de.js';

export const LANGS = { en, fr, es, de };
const KEY = 'cad-teacher-lang';
const known = l => (l && LANGS[l.slice(0, 2).toLowerCase()] ? l.slice(0, 2).toLowerCase() : null);
const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

// ?lang=fr wins, then the last choice, then the browser's languages.
export let lang = known(new URLSearchParams(globalThis.location?.search).get('lang')) || known(saved()) ||
  (globalThis.navigator?.languages ?? []).map(known).find(Boolean) || 'en';

export function setLang(l) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
}

// Strings get {name} placeholders filled; arrays (lesson steps, briefs) come back as-is.
export function t(key, vars = {}) {
  const v = LANGS[lang][key] ?? en[key] ?? key;
  return typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (_, k) => vars[k]) : v;
}

// Plurals: key.one / key.other (French counts 0 as "one", like it should).
export function tn(key, n) {
  const k = `${key}.${new Intl.PluralRules(lang).select(n)}`;
  return t(k in LANGS[lang] ? k : `${key}.other`, { n });
}
