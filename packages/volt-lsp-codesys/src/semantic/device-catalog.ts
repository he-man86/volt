/**
 * The device-tree instance names — so references to device globals resolve.
 *
 * A CODESYS project's device tree (EtherCAT master, drives, axes, I/O modules, …) is exposed to IEC code as
 * implicit global variables: source reads `EtherCAT_Master.xRestart`, `YDrive.lrActPosition`,
 * `MAxesGroup := MagazineAxes`. Those globals live in the device tree, not the mirrored `src/` symbol table,
 * so a bare device reference (`MagazineAxes`) resolves nowhere and would false-positive as unresolved.
 *
 * `volt pull` mirrors the device tree: each instance is a read-only `.device` descriptor file at its tree
 * location (`…/EtherCAT_Master/L_i750_ZR.device`). We scan for those files and take each filename stem as a
 * known global NAME. That's all the LSP needs — the bare reference resolves; member access (`.xRestart`,
 * `.lrActPosition`) reaches into the device's internal type, which is not public and not something the LSP
 * checks, so it correctly falls through. (This is distinct from library NAMESPACES — different source, and a
 * device is a global instance, not a namespace.)
 */
import { readdirSync, statSync } from "node:fs"
import { extname, basename, join } from "node:path"

/** Scan `<root>` for `.device` files and collect their (lowercased) instance names. Empty when there are
 *  none / the tree is unreadable (⇒ nothing known, every reference checked as before). */
export function loadDeviceInstances(root: string): Set<string> {
	const out = new Set<string>()
	scan(root, out)
	return out
}

function scan(dir: string, out: Set<string>): void {
	let entries: string[]
	try {
		entries = readdirSync(dir)
	} catch {
		return
	}
	for (const entry of entries) {
		if (entry.startsWith(".") || entry === "node_modules") continue
		const full = join(dir, entry)
		let isDir: boolean
		try {
			isDir = statSync(full).isDirectory()
		} catch {
			continue
		}
		if (isDir) {
			scan(full, out)
		} else if (extname(entry).toLowerCase() === ".device") {
			out.add(basename(entry, extname(entry)).toLowerCase())
		}
	}
}
