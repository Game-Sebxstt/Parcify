import { getLocale } from '../paraglide/runtime.js';

type Locale = ReturnType<typeof getLocale>;

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();
const relativeFormats = new Map<Locale, Intl.RelativeTimeFormat>();

function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}:${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) dateFormats.set(key, (format = new Intl.DateTimeFormat(locale, options)));
  return format;
}

export function formatDate(value: Date | string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  return dateFormat(getLocale(), options).format(new Date(value));
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}) {
  const locale = getLocale();
  const key = `${locale}:${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) numberFormats.set(key, (format = new Intl.NumberFormat(locale, options)));
  return format.format(value);
}

const BROWSERS: Array<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/Windows/, 'Windows'],
  [/iPhone|iPad|iOS/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

// «Firefox · Windows» a partir del User-Agent; null si no se reconoce.
export function describeUserAgent(userAgent: string | null | undefined): { browser: string | null; system: string | null } {
  if (!userAgent) return { browser: null, system: null };
  return {
    browser: BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null,
    system: SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null,
  };
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

// «hace 12 min», «dentro de 2 días»; por debajo de 45 s, «ahora».
export function formatRelative(value: Date | string, now: Date = new Date()) {
  const locale = getLocale();
  let format = relativeFormats.get(locale);
  if (!format) relativeFormats.set(locale, (format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })));
  const seconds = Math.round((new Date(value).getTime() - now.getTime()) / 1000);
  if (Math.abs(seconds) < 45) return format.format(0, 'second');
  const [unit, size] = UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? ['second', 1];
  return format.format(Math.round(seconds / size), unit);
}
