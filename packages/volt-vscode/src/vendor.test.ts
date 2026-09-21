/**
 * WHICH VENDOR'S DIALECT THE SERVER IS LAUNCHED WITH — the one decision in this file that is not VS Code API.
 *
 * `volt.iec.vendor` defaults to `auto`, and `auto` used to mean codesys: the launch read
 * `vendor === "twincat" ? --twincat : --codesys`, so a TwinCAT workspace on the default got the CODESYS dialect
 * while the setting's description promised a workspace scan. It shipped untested — the only vendor-detection
 * test in the repo was `volt-lsp-iec/src/detect-vendor.test.ts`, which was deleted with the module it covered
 * and had no replacement (`consolidate-lsp-structure` C8, and the review that followed it).
 *
 * The resolution is a pure function of (setting, folder paths) so it can be tested without an editor; everything
 * around it is `vscode.*` and is not.
 */
import { expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { boundWorkspace } from "@volt/control/test-support"
import { resolveVendor } from "./vendor.js"

/**
 * A workspace folder, bound to `vendor` when one is given — `.git/volt/config.json` IS the binding.
 *
 * <p>`boundWorkspace` is @volt/control's own fixture, and using it rather than writing the JSON here is the
 * point: the first draft of this test hand-rolled `{ vendor }` and every `auto` case failed, because the
 * binding's real shape is `{ bridge: { vendor } }`. A fixture that writes a shape the reader invents can only
 * test the reader.</p>
 */
const folder = (vendor?: "codesys" | "twincat"): string => boundWorkspace({ vendor, prefix: "volt-lsp-vendor" })

test("an explicit setting is never second-guessed", () => {
	expect(resolveVendor("twincat", [folder("codesys")])).toBe("twincat")
	expect(resolveVendor("codesys", [folder("twincat")])).toBe("codesys")
	// …and with no folder at all
	expect(resolveVendor("twincat", [])).toBe("twincat")
})

test("auto takes the vendor from the binding", () => {
	expect(resolveVendor("auto", [folder("twincat")])).toBe("twincat")
	expect(resolveVendor("auto", [folder("codesys")])).toBe("codesys")
})

// THE BUG THIS REPLACED: `auto` resolved to codesys for everyone, so a TwinCAT workspace on the default setting
// was analysed with the wrong dialect — wrong answers, not wrong labels, since `project.dialect` decides which
// names resolve and how each message is worded.
test("auto on a bound TwinCAT workspace is NOT codesys", () => {
	expect(resolveVendor("auto", [folder("twincat")])).not.toBe("codesys")
})

// MULTI-ROOT: the first BOUND folder wins, not `workspaceFolders[0]`. One server serves the window, so two
// differently-bound folders cannot both be served — but an unbound folder sitting first must not decide it.
test("auto scans past unbound folders to the first bound one", () => {
	expect(resolveVendor("auto", [folder(), folder("twincat")])).toBe("twincat")
	expect(resolveVendor("auto", [folder(), folder(), folder("codesys")])).toBe("codesys")
	// order among BOUND folders is the folder order, stated rather than left implicit
	expect(resolveVendor("auto", [folder("codesys"), folder("twincat")])).toBe("codesys")
})

test("an unbound window falls back to codesys", () => {
	expect(resolveVendor("auto", [])).toBe("codesys")
	expect(resolveVendor("auto", [folder()])).toBe("codesys")
	// a folder that does not exist is not a crash
	expect(resolveVendor("auto", [join(tmpdir(), "volt-no-such-folder-xyz")])).toBe("codesys")
})
