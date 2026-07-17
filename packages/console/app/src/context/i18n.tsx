import { createMemo } from "solid-js"
import { createSimpleContext } from "../ui"
import { i18n, type Key } from "~/i18n"
import { volt } from "~/i18n/volt"
import { useLanguage } from "~/context/language"

function resolve(text: string, params?: Record<string, string | number>) {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (raw, key) => {
    const value = params[key]
    if (value === undefined || value === null) return raw
    return String(value)
  })
}

export const { use: useI18n, provider: I18nProvider } = createSimpleContext({
  name: "I18n",
  init: () => {
    const language = useLanguage()
    // VOLT: the rebrand overlay wins over every locale (see ~/i18n/volt) — keeps opencode's dicts pristine.
    const dict = createMemo(() => ({ ...i18n(language.locale()), ...volt }))

    return {
      t(key: Key, params?: Record<string, string | number>) {
        return resolve(dict()[key], params)
      },
    }
  },
})
