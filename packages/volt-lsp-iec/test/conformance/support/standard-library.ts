/**
 * The fixture project's referenced Standard library, as the bridge materialized it — the same project the execution
 * recorder runs (CodesysTestProject, Standard 3.5.18.0), so a Standard function binds to the declaration CODESYS compiled.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const STANDARD = join(import.meta.dir, "..", "..", "..", "test-corpus", "CodesysTestProject", "Device", "Plc Logic", "Application", "Library Manager", "Standard")

export const STANDARD_LIBRARY: readonly { uri: string; source: string }[] = readdirSync(STANDARD)
  .filter((f) => f.endsWith(".fun"))
  .map((f) => ({ uri: join(STANDARD, f), source: readFileSync(join(STANDARD, f), "utf8") }))
