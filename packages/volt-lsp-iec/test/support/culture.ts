// THE LOCALE A TEST RUN RUNS UNDER (openspec environment-dependency-audit 1.1). `VOLT_TEST_CULTURE=tr-TR` (or ru-RU,
// de-DE, …) makes every locale-sensitive JavaScript operation that names no locale — `localeCompare`,
// `toLocaleUpperCase`/`toLocaleLowerCase`, `toLocaleString` and friends, every `Intl` constructor — answer as it would on a
// machine whose default locale is that one, as on a customer's Turkish or Russian Windows. Unset, nothing changes.
//
// The switch is in the process because the runtime takes its default locale from the OS user locale (measured, bun
// 1.4.2 on Windows: `LANG`/`LC_ALL` are ignored, the default stays the machine's nl-NL) and a CI runner's cannot be set per
// job. JavaScript has no setter for the default locale, so the preload supplies the requested one wherever a caller
// passed none — the only way the default reaches an answer. `toUpperCase`/`toLowerCase` are locale-independent by the
// language spec and need nothing. A name that is not a locale `Intl` supports is refused (the preload throws, and the run
// fails) instead of running the suite under a locale nobody asked for. Preloaded (bunfig.toml), so it is in place
// before any test imports the server; `culture.test.ts` beside it fails a locale run that did not switch.

const CULTURE_VARIABLE = "VOLT_TEST_CULTURE"

/** The locale the run was asked for, or undefined when the variable is unset. */
export const requestedCulture: string | undefined = process.env[CULTURE_VARIABLE] || undefined

function apply(locale: string): void {
  if (Intl.getCanonicalLocales(locale).length !== 1 || Intl.Collator.supportedLocalesOf([locale]).length !== 1)
    throw new Error(`${CULTURE_VARIABLE}=${locale} is not a locale this runtime supports`)

  const orDefault = (locales: unknown) => (locales === undefined ? locale : locales)

  for (const name of ["Collator", "NumberFormat", "DateTimeFormat", "PluralRules", "RelativeTimeFormat", "ListFormat", "Segmenter", "DisplayNames"] as const) {
    const Original = (Intl as Record<string, any>)[name]
    if (typeof Original !== "function") continue
    const Wrapped = function (this: unknown, locales?: unknown, options?: unknown) {
      return new.target ? new Original(orDefault(locales), options) : Original(orDefault(locales), options)
    } as unknown as { prototype: unknown; supportedLocalesOf: unknown }
    Wrapped.prototype = Original.prototype
    Wrapped.supportedLocalesOf = Original.supportedLocalesOf.bind(Original)
    ;(Intl as Record<string, any>)[name] = Wrapped
  }

  const patch = (proto: object, method: string, localesAt: number) => {
    const original = (proto as Record<string, any>)[method] as (...args: unknown[]) => unknown
    Object.defineProperty(proto, method, {
      configurable: true,
      writable: true,
      value: function (this: unknown, ...args: unknown[]) {
        if (args[localesAt] === undefined) {
          while (args.length < localesAt) args.push(undefined)
          args[localesAt] = locale
        }
        return original.apply(this, args)
      },
    })
  }
  patch(String.prototype, "localeCompare", 1)
  patch(String.prototype, "toLocaleUpperCase", 0)
  patch(String.prototype, "toLocaleLowerCase", 0)
  patch(Number.prototype, "toLocaleString", 0)
  patch(BigInt.prototype, "toLocaleString", 0)
  patch(Array.prototype, "toLocaleString", 0)
  for (const m of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]) patch(Date.prototype, m, 0)
}

if (requestedCulture !== undefined) apply(requestedCulture)
