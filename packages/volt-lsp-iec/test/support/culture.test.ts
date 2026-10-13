// A LOCALE RUN THAT DID NOT SWITCH THE LOCALE PROVES NOTHING (openspec environment-dependency-audit 1.1): a
// `VOLT_TEST_CULTURE=tr-TR` run whose operations silently answered in the machine's locale would be green over every
// Turkish bug. So the suite states, under the locale it was asked for, that the default every locale-sensitive operation
// uses is that one. Unset, the run keeps the machine's default and so does this test.
import { expect, test } from "bun:test"
import { requestedCulture } from "./culture.js"

test("a locale run answers every locale-sensitive operation in the requested locale", () => {
  if (requestedCulture === undefined) return
  // Each against the same constructor given the locale explicitly: a collator resolves tr-TR to its data's "tr".
  expect(new Intl.Collator().resolvedOptions().locale).toBe(new Intl.Collator(requestedCulture).resolvedOptions().locale)
  expect(new Intl.NumberFormat().resolvedOptions().locale).toBe(new Intl.NumberFormat(requestedCulture).resolvedOptions().locale)
  expect(new Intl.DateTimeFormat().resolvedOptions().locale).toBe(new Intl.DateTimeFormat(requestedCulture).resolvedOptions().locale)
  expect((1234.5).toLocaleString()).toBe(new Intl.NumberFormat(requestedCulture).format(1234.5))
})

test("a turkish run is armed: the locale's upper case of i is the dotted capital", () => {
  if (requestedCulture === undefined || new Intl.Locale(requestedCulture).language !== "tr") return
  expect("i".toLocaleUpperCase()).toBe("İ")
  expect("I".toLocaleLowerCase()).toBe("ı")
})
