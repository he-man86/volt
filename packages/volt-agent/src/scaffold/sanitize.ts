/**
 * Turn an arbitrary PLC project name into a legal npm package name.
 *
 * Used by the scaffold to fill in `package.json#name`. Rules:
 *   - lower-case
 *   - non-alphanumeric runs collapse to a single `-`
 *   - leading and trailing `-` stripped
 *   - empty result → `"plc-workspace"` fallback
 *
 * Examples:
 *   "Untitled 2"   → "untitled-2"
 *   "MyProject!!!" → "myproject"
 *   "!!!"          → "plc-workspace"
 *   "123-PLC"      → "123-plc" (legal npm name; leading digit is fine)
 *
 * Pure function — unit-tested in isolation. No I/O, no globals.
 */
const FALLBACK = "plc-workspace";

export function toPackageName(plcProjectName: string): string {
	const sanitized = plcProjectName
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return sanitized.length > 0 ? sanitized : FALLBACK;
}
