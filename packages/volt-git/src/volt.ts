#!/usr/bin/env bun
/**
 * `volt` binary entry — ONE self-contained binary = our opencode + the PLC CLI.
 *
 * PLC verbs run the volt-git CLI (`./bin.ts`); everything else (bare `volt`, run, auth, debug, …) IS the
 * opencode agent, imported IN-PROCESS — opencode's CLI reads process.argv at module top, runs, and exits.
 * `bun --compile --conditions=browser` bundles both in, so there's no spawn and no external opencode.
 *
 * Excluded from typecheck (tsconfig `exclude`): it imports opencode's raw .ts source, which uses a looser
 * moduleResolution than this package. ponytail: thin router, not worth a second tsconfig — compile-checked.
 * The verb set must stay in sync with bin.ts's switch (a verb here but not there → falls through to USAGE;
 * a verb there but not here → wrongly routed to opencode).
 */
const VOLT_VERBS = new Set(["init", "pull", "push", "build", "status", "log", "diff", "show", "merge", "help"])
const first = process.argv[2]
if (first !== undefined && VOLT_VERBS.has(first)) {
  await import("./bin.js") // the PLC CLI (auto-runs main with process.argv)
} else {
  // Standalone `volt` (the agent/TUI): point opencode at the bundled config dir beside the binary (LSP +
  // `volt` tool + agent + theme + permissions) and put the bin dir on PATH so the config's bare-name commands
  // resolve. Only the compiled binary has the sibling dir; dev-from-source falls back to the repo .opencode.
  if (!process.env.OPENCODE_CONFIG_DIR) {
    const { dirname, join } = await import("node:path")
    const { existsSync } = await import("node:fs")
    const binDir = dirname(process.execPath)
    const cfg = join(binDir, "..", "volt-config")
    if (existsSync(cfg)) {
      process.env.OPENCODE_CONFIG_DIR = cfg
      process.env.PATH = binDir + (process.platform === "win32" ? ";" : ":") + (process.env.PATH ?? "")
      // Point opencode's self-updater at Volt's own release feed (not opencode's npm/curl). The redirect lives
      // behind this env var (installation/index.ts); the "upgrade" downloads + runs the Volt installer. The
      // desktop instead uses electron-updater and sets OPENCODE_DISABLE_AUTOUPDATE, so only the terminal CLI
      // self-updates. autoupdate mode ("notify") is set in volt-config so it prompts rather than auto-runs.
      process.env.VOLT_UPDATE_REPO ??= "he-man86/volt"
    }
  }
  // Register the TUI <spinner> before opencode renders. Upstream (opencode/tui) registers it via a bare
  // `import "opentui-spinner/solid"` side-effect, but our dynamic-import entry + bundle splitting tree-shakes
  // that out → "[Reconciler] Unknown component type: spinner" when chatting. Value-referencing it here
  // (volt-owned, additive — no edit to opencode) into the SAME @opentui/solid catalogue keeps it in the bundle.
  const { registerSpinner } = await import("opentui-spinner/solid")
  registerSpinner()
  await import("opencode/index") // our opencode, in-process — never returns (it process.exit()s)
}
