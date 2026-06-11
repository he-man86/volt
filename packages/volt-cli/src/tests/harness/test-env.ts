import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TestBridge, type TestBridgeItem } from "../../bridge/test-bridge.js"

export interface TestEnv {
	workspace: string
	bridge: TestBridge
	cleanup(): void
}

export function makeTestEnv(items: TestBridgeItem[]): TestEnv {
	const root = mkdtempSync(join(tmpdir(), "volt-test-"))
	const workspace = join(root, "ws")
	mkdirSync(workspace, { recursive: true })
	const bridge = new TestBridge({ initialItems: items })
	return { workspace, bridge, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
