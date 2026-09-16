import { useEffect, useState } from 'preact/hooks'
import en from './locales/en.json'

// English ships in the main bundle; every other language is a small lazy chunk.
// Add a file here (and to LANGS below) to switch a language on — mr/te/ta/gu are translated already.
const loaders = import.meta.glob(['./locales/hi.json', './locales/bn.json'])

// mr / te / ta / gu translations are ready in ./locales — add them here to switch them on.
export const LANGS = [
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['bn', 'বাংলা'],
]
const CODES = LANGS.map((l) => l[0])

let dict = en
let current = 'en'
const subscribers = new Set()

export function t(key, vars) {
  let s = dict[key] ?? en[key] ?? key
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k])
  return s
}

export const getLang = () => current

export function tErr(e) {
  const key = e?.key
  return key && (dict[key] || en[key]) ? t(key) : t('err.generic')
}

export async function setLang(code, remember = false) {
  if (!CODES.includes(code)) code = 'en'
  try {
    dict = code === 'en' ? en : (await loaders[`./locales/${code}.json`]()).default
  } catch {
    dict = en
    code = 'en'
  }
  current = code
  document.documentElement.lang = code
  if (remember) {
    try {
      localStorage.setItem('gmp_lang', code)
    } catch {}
  }
  subscribers.forEach((fn) => fn(code))
}

export function savedLang() {
  try {
    return localStorage.getItem('gmp_lang')
  } catch {
    return null
  }
}

/** ?lang → saved choice → event default → phone language → English */
export function initialLang(eventLang) {
  const q = new URLSearchParams(location.search).get('lang')
  const nav = (navigator.language || '').slice(0, 2)
  return [q, savedLang(), eventLang, nav].find((c) => c && CODES.includes(c)) || 'en'
}

export function useLang() {
  const [lang, set] = useState(current)
  useEffect(() => {
    subscribers.add(set)
    return () => subscribers.delete(set)
  }, [])
  return lang
}
