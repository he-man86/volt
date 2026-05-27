/**
 * Vendor auto-detection from a workspace directory.
 *
 * Returns "twincat" / "codesys" based on filesystem signals, or
 * `undefined` if nothing decisive is found (caller falls back to its
 * own default — typically "codesys" since it's the larger install
 * base globally).
 *
 * Called from:
 *   - `volt init` (volt-agent) — to write the detected vendor into
 *     `.volt/config.json`
 *   - VS Code extension — to resolve `volt.structuredText.vendor: "auto"`
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export type DetectedVendor = "codesys" | "twincat";

export interface DetectVendorOptions {
	/** Maximum directory depth to scan. Default 3 — enough for typical project layouts. */
	maxDepth?: number;
	/** Maximum files to read inspecting content. Default 50 — bounds CPU on huge repos. */
	maxFilesToScan?: number;
}

interface Score {
	codesys: number;
	twincat: number;
}

/**
 * Scan the workspace for vendor signals. Strongest signals first;
 * weighted accumulation so a mixed workspace still picks a winner.
 *
 * Signal weights (rough order of certainty):
 *
 *   File presence:
 *     .TcPOU / .tspproj / .tmc files  → TwinCAT (high)
 *     .project (with <CodeSysProject>) → CODESYS (high)
 *     tsconfig.tcobject.xml           → TwinCAT (high)
 *
 *   Code content (sampled — up to N files):
 *     `{attribute 'Tc...'}` pragma     → TwinCAT (medium)
 *     `Tc2_` / `Tc3_` library import   → TwinCAT (medium)
 *     `__POOL` usage                    → CODESYS (medium)
 *     `{attribute 'init_namespace'}`    → CODESYS (medium — TwinCAT rarely uses)
 *
 *   Filename heuristics:
 *     `*.iecst`, `*.exp`               → CODESYS (low)
 */
export async function detectVendor(
	workspaceRoot: string,
	opts: DetectVendorOptions = {},
): Promise<DetectedVendor | undefined> {
	const maxDepth = opts.maxDepth ?? 3;
	const maxFiles = opts.maxFilesToScan ?? 50;
	const root = resolve(workspaceRoot);
	const score: Score = { codesys: 0, twincat: 0 };
	const filesToScan: string[] = [];

	await walk(root, 0, maxDepth, filesToScan, score);

	// Sample-scan up to maxFiles of the collected .st files.
	const sampled = filesToScan.slice(0, maxFiles);
	for (const file of sampled) {
		try {
			const content = await readFile(file, "utf-8");
			scoreContent(content, score);
		} catch {
			// best-effort; skip
		}
	}

	if (score.twincat === 0 && score.codesys === 0) return undefined;
	if (score.twincat > score.codesys) return "twincat";
	if (score.codesys > score.twincat) return "codesys";
	// Tie — slight lean to codesys as the historical larger install base
	// and our default. Caller can still override.
	return "codesys";
}

async function walk(
	dir: string,
	depth: number,
	maxDepth: number,
	stFiles: string[],
	score: Score,
): Promise<void> {
	if (depth > maxDepth) return;
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		// Skip noisy directories.
		if (entry === "node_modules" || entry === ".git" || entry === ".volt" || entry === "dist") continue;
		const full = join(dir, entry);
		let s;
		try {
			s = await stat(full);
		} catch {
			continue;
		}
		if (s.isDirectory()) {
			await walk(full, depth + 1, maxDepth, stFiles, score);
			continue;
		}
		// Filename signals.
		const lower = entry.toLowerCase();
		if (lower.endsWith(".tcpou") || lower.endsWith(".tcdut") || lower.endsWith(".tcgvl")) {
			score.twincat += 10;
		} else if (lower.endsWith(".tsproj") || lower.endsWith(".tmc")) {
			score.twincat += 10;
		} else if (lower === "tsconfig.tcobject.xml") {
			score.twincat += 10;
		} else if (lower.endsWith(".project")) {
			// Could be a CODESYS .project file — disambiguate by reading.
			try {
				const head = (await readFile(full, "utf-8")).slice(0, 4096);
				if (/<CodeSysProject|<Project xmlns/.test(head)) {
					score.codesys += 8;
				}
			} catch {
				// ignore
			}
		} else if (lower.endsWith(".iecst") || lower.endsWith(".exp")) {
			score.codesys += 2;
		} else if (lower.endsWith(".st")) {
			stFiles.push(full);
		}
	}
}

function scoreContent(text: string, score: Score): void {
	// TwinCAT signals
	const tcPragmaMatches = text.match(/\{attribute\s+'Tc[A-Z]\w*'/g);
	if (tcPragmaMatches !== null) score.twincat += tcPragmaMatches.length * 2;
	const tcLibMatches = text.match(/\bTc[23]_\w+/g);
	if (tcLibMatches !== null) score.twincat += tcLibMatches.length;

	// CODESYS signals
	const poolMatches = text.match(/\b__POOL\b/g);
	if (poolMatches !== null) score.codesys += poolMatches.length * 3;
	const initNsMatches = text.match(/\{attribute\s+'init_namespace'/g);
	if (initNsMatches !== null) score.codesys += initNsMatches.length * 2;
}
