import type { Locale } from "~/lib/language"
import { dict as en } from "~/i18n/en"
import { dict as zh } from "~/i18n/zh"
import { dict as zht } from "~/i18n/zht"
import { dict as ko } from "~/i18n/ko"
import { dict as de } from "~/i18n/de"
import { dict as es } from "~/i18n/es"
import { dict as fr } from "~/i18n/fr"
import { dict as it } from "~/i18n/it"
import { dict as da } from "~/i18n/da"
import { dict as ja } from "~/i18n/ja"
import { dict as pl } from "~/i18n/pl"
import { dict as ru } from "~/i18n/ru"
import { dict as uk } from "~/i18n/uk"
import { dict as ar } from "~/i18n/ar"
import { dict as no } from "~/i18n/no"
import { dict as br } from "~/i18n/br"
import { dict as th } from "~/i18n/th"
import { dict as tr } from "~/i18n/tr"
import { volt } from "~/i18n/volt"

export type Key = keyof typeof en
export type Dict = Record<Key, string>

const base = en satisfies Dict

// VOLT: merge the rebrand overlay HERE, at the dict factory, because it is the ONE thing every consumer shares.
// Merging it in context/i18n.tsx only covered the client/SSR render: six SERVER call sites build the dict straight
// from i18n() and never touch that context — routes/zen/util/{handler,ipRateLimiter,keyRateLimiter}.ts,
// routes/api/enterprise.ts, routes/auth/[...callback].ts, routes/bench/submission.ts. The gateway handler is one of
// them, so the overlay's "Volt Gateway" trial-ended string never reached the CLI it was written for.
// The overlay is spread LAST so it wins over the locale dict (opencode's translations carry its product names).
export function i18n(locale: Locale): Dict {
  return { ...localeDict(locale), ...volt }
}

function localeDict(locale: Locale): Dict {
  if (locale === "en") return base
  if (locale === "zh") return { ...base, ...zh }
  if (locale === "zht") return { ...base, ...zht }
  if (locale === "ko") return { ...base, ...ko }
  if (locale === "de") return { ...base, ...de }
  if (locale === "es") return { ...base, ...es }
  if (locale === "fr") return { ...base, ...fr }
  if (locale === "it") return { ...base, ...it }
  if (locale === "da") return { ...base, ...da }
  if (locale === "ja") return { ...base, ...ja }
  if (locale === "pl") return { ...base, ...pl }
  if (locale === "ru") return { ...base, ...ru }
  if (locale === "uk") return { ...base, ...uk }
  if (locale === "ar") return { ...base, ...ar }
  if (locale === "no") return { ...base, ...no }
  if (locale === "br") return { ...base, ...br }
  if (locale === "th") return { ...base, ...th }
  return { ...base, ...tr }
}
