import { runVolt } from "../bridge/cli.js"

// Shared diff LOGIC — fetch both sides of a change via `volt show` and compute a line diff. UI packages (desktop
// popup, and anywhere else) only RENDER the returned FileDiff; the ref selection + diffing live here so the two
// frontends can't disagree on what "incoming"/"outgoing" compares. (VS Code renders its own diff via the native
// editor + the volt:// content provider — same `volt show` refs, so it stays consistent without this path.)

export type DiffDirection = "incoming" | "outgoing"
/** One rendered diff line. tag: " " context, "-" removed (left only), "+" added (right only). */
export interface DiffLine {
	tag: " " | "-" | "+"
	text: string
}
export interface FileDiff {
	name: string
	relPath: string
	leftLabel: string
	rightLabel: string
	lines: DiffLine[]
	identical: boolean
}

// incoming = what a PULL brings in (your repo's last commit vs the live IDE). outgoing = what a PUSH sends (the
// last-synced IDE baseline vs your working file). These are the SAME refs VS Code's itemNode diffs against.
const REFS: Record<DiffDirection, { left: string; right: string; leftLabel: string; rightLabel: string }> = {
	incoming: { left: "HEAD", right: "BRIDGE", leftLabel: "Workspace (HEAD)", rightLabel: "IDE (live)" },
	outgoing: { left: "VOLTIDE", right: "WORKSPACE", leftLabel: "IDE (baseline)", rightLabel: "Workspace (working)" },
}

async function showText(workspaceRoot: string, ref: string, relPath: string): Promise<string> {
	const r = await runVolt(workspaceRoot, ["show", ref, relPath, "--workspace", workspaceRoot], { binary: true })
	if (r.code === 2) return "" // file absent on that side (a pure add or delete) — diff against empty
	if (r.code !== 0) throw new Error(`volt show ${ref} ${relPath} failed: ${r.stderr || `exit ${r.code}`}`)
	return r.stdout.toString("utf-8")
}

export async function loadDiff(workspaceRoot: string, relPath: string, name: string, direction: DiffDirection): Promise<FileDiff> {
	const refs = REFS[direction]
	const [left, right] = await Promise.all([showText(workspaceRoot, refs.left, relPath), showText(workspaceRoot, refs.right, relPath)])
	return { name, relPath, leftLabel: refs.leftLabel, rightLabel: refs.rightLabel, lines: lineDiff(left, right), identical: left === right }
}

/** A minimal LCS unified line-diff — no deps. ponytail: O(n·m) memory; PLC POUs are small, but a huge pair falls
 *  back to a whole-file replace so we never allocate a giant table. Upgrade to Myers if big files ever matter. */
export function lineDiff(a: string, b: string): DiffLine[] {
	const A = splitLines(a)
	const B = splitLines(b)
	const n = A.length
	const m = B.length
	if (n === 0 && m === 0) return []
	if (n * m > 4_000_000) return [...A.map((t) => ({ tag: "-" as const, text: t })), ...B.map((t) => ({ tag: "+" as const, text: t }))]

	// dp[i][j] = LCS length of A[i:] and B[j:]. Walk it forward to emit context/del/add in order.
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)

	const out: DiffLine[] = []
	let i = 0
	let j = 0
	while (i < n && j < m) {
		if (A[i] === B[j]) (out.push({ tag: " ", text: A[i]! }), i++, j++)
		else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) (out.push({ tag: "-", text: A[i]! }), i++)
		else (out.push({ tag: "+", text: B[j]! }), j++)
	}
	while (i < n) out.push({ tag: "-", text: A[i++]! })
	while (j < m) out.push({ tag: "+", text: B[j++]! })
	return out
}

// Split into lines, dropping the single trailing "" a final newline produces (so a file and itself diff clean).
function splitLines(s: string): string[] {
	if (s === "") return []
	const lines = s.split("\n")
	if (lines[lines.length - 1] === "") lines.pop()
	return lines
}
