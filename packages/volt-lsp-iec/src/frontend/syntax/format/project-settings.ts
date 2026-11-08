/**
 * THE `.projectsettings` ROWS BOTH CONSUMERS READ — the project's Compile options as the bridge's descriptor writes them
 * (`packages/volt-cli/src/Volt.Engine/Format/Settings/ProjectSettingsFormat.cs`). The analysis reads it to judge a literal
 * (`string-not-representable`), lowering to know which bytes a STRING holds.
 */
import { splitLines } from "../span.js"

/**
 * The project's Compile option "UTF-8 Encoding for STRING", as its `.projectsettings` states it — the CODESYS descriptor's
 * `UTF-8 encoding:` row, `on` or `off`. Undefined where the file has no such row (a TwinCAT descriptor); any other value
 * is refused by name.
 */
export function projectUtf8EncodingFrom(body: string): boolean | undefined {
  const line = splitLines(body).find((l) => l.toLowerCase().startsWith("utf-8 encoding:"))
  if (line === undefined) return undefined
  const value = line.slice(line.indexOf(":") + 1).trim()
  if (value === "on") return true
  if (value === "off") return false
  throw new Error(`.projectsettings: "UTF-8 encoding" is '${value}', neither 'on' nor 'off'`)
}
