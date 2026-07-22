import { expect, mock, test } from "bun:test"
import * as control from "@volt/control"

// The diff-compare content provider: it resolves each side of a `vscode.diff` by shelling out to `volt show <ref>
// <path>`. Stub the tiny vscode surface (Uri.from, used by buildUri) keeping the components so parseUri round-trips.
// bun's mock.module is process-global, so make these SUPERSETS: include the fields panel.test.ts's vscode mock uses
// (ThemeIcon / TreeItemCollapsibleState) so leakage across files is harmless.
mock.module("vscode", () => ({
	Uri: { from: (p: { scheme: string; authority?: string; path: string }) => ({ scheme: p.scheme, authority: p.authority ?? "", path: p.path }) },
	EventEmitter: class {
		event = (): void => {}
	},
	ThemeIcon: class {
		constructor(public readonly id: string) {}
	},
	TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
}))

let lastArgs: { root: string; args: string[]; opts: unknown } | undefined
let nextResult: { code: number; stdout: Buffer; stderr: string }
// Spread the REAL module (so isPouFile/projectWorkspace/etc. survive for other test files that share this process)
// and override only runVolt.
mock.module("@volt/control", () => ({
	...control,
	runVolt: async (root: string, args: string[], opts: unknown) => {
		lastArgs = { root, args, opts }
		return nextResult
	},
}))

const { buildUri, parseUri, VoltContentProvider } = await import("./content.js")

test("buildUri/parseUri round-trips ref, path and workspaceRoot", () => {
	const p = parseUri(buildUri("C:/ws", "HEAD", "POUs/Foo.fb"))
	expect(p).toEqual({ workspaceRoot: "C:/ws", ref: "HEAD", path: "POUs/Foo.fb" })
})

test("provideTextDocumentContent runs `volt show <ref> <path> --workspace <root>` for the parsed uri", async () => {
	nextResult = { code: 0, stdout: Buffer.from("BODY"), stderr: "" }
	const out = await new VoltContentProvider().provideTextDocumentContent(buildUri("C:/ws", "BRIDGE", "POUs/Foo.fb"))
	expect(out).toBe("BODY")
	expect(lastArgs?.args).toEqual(["show", "BRIDGE", "POUs/Foo.fb", "--workspace", "C:/ws"])
	expect(lastArgs?.opts).toEqual({ binary: true })
})

// The fix: an ABSENT item (added/removed → exit 2) must render as an empty pane, NOT "volt show failed: …".
test("exit code 2 (absent item) renders an empty pane", async () => {
	nextResult = { code: 2, stdout: Buffer.from(""), stderr: "Added.fb not found at HEAD" }
	const out = await new VoltContentProvider().provideTextDocumentContent(buildUri("C:/ws", "HEAD", "POUs/Added.fb"))
	expect(out).toBe("")
})

test("a genuine non-zero exit renders the error", async () => {
	nextResult = { code: 1, stdout: Buffer.from(""), stderr: "boom" }
	const out = await new VoltContentProvider().provideTextDocumentContent(buildUri("C:/ws", "BRIDGE", "POUs/Foo.fb"))
	expect(out).toBe("volt show failed: boom")
})

test("a non-volt uri is rejected", async () => {
	const out = await new VoltContentProvider().provideTextDocumentContent({ scheme: "file", authority: "", path: "/x" } as never)
	expect(out).toBe("invalid volt:// URI")
})
