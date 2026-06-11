import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { detectVendor, installCorpus, type DetectedVendor } from "@opencode-ai/volt-lsp"
import type { Remote } from "../bridge/types.js"
import { verifyProjectBinding } from "../config/binding.js"
import { configExists, loadConfig, saveConfig, workspacePaths } from "../config/workspace.js"
import type { CliError } from "../output/errors.js"
import { defaultExtensionAccess } from "../registry/extensions.js"
import { writeWorkspaceScaffold } from "../scaffold/index.js"
import { ensureGitignore } from "../snapshot/workspace.js"
import { ensureSnapshotRepo, reportSnapshotHeal } from "../snapshot/repo.js"

type InitInput = { force?: boolean; noScaffold?: boolean }
type InitResult = { kind: "ok"; projectVersion: string } | { kind: "error"; error: CliError }

export type { InitInput, InitResult }

export async function init(workspace: string, bridge: Remote, input: InitInput): Promise<InitResult> {
	const force = input.force ?? false
	const noScaffold = input.noScaffold ?? false
	const root = resolve(workspace)
	const paths = workspacePaths(root)

	const health = await bridge.getHealth()
	if (
		health.projectName === undefined || health.projectName === null || health.projectName === "" ||
		health.plcProjectName === undefined || health.plcProjectName === null || health.plcProjectName === ""
	) {
		return {
			kind: "error",
			error: {
				kind: "internal",
				message: `bridge has no project loaded — open a PLC project in the IDE before running \`volt init\` (bridge reports projectName=${JSON.stringify(health.projectName)}, plcProjectName=${JSON.stringify(health.plcProjectName)})`,
			},
		}
	}

	let alreadyInitialized = false
	if (configExists(root)) {
		const existing = loadConfig(root)
		const check = verifyProjectBinding(existing, health)
		if (!check.ok) {
			if (!force) {
				const m = (check as { ok: false; mismatch: import("../config/binding.js").BindingMismatch }).mismatch
				return {
					kind: "error",
					error: {
						kind: "binding_mismatch",
						expected: `${m.configuredAs.platform}/${m.configuredAs.projectName}/${m.configuredAs.plcProjectName}`,
						actual: `${m.bridgeReports.platform}/${m.bridgeReports.projectName}/${m.bridgeReports.plcProjectName}`,
					},
				}
			}
		} else {
			alreadyInitialized = true
		}
		reportSnapshotHeal(ensureSnapshotRepo(paths.snapshotPath))
		ensureGitignore(root)
	}

	if (!alreadyInitialized) {
		saveConfig(root, {
			bridge: { port: bridge.port },
			project: {
				platform: health.platform,
				projectName: health.projectName!,
				plcProjectName: health.plcProjectName!,
			},
			linkedAt: new Date().toISOString(),
			extensionAccess: defaultExtensionAccess(),
		})
		reportSnapshotHeal(ensureSnapshotRepo(paths.snapshotPath))
		ensureGitignore(root)
	}

	const detectedVendor = alreadyInitialized
		? undefined
		: await tryDetectVendor(root, health.platform)
	const corpus = await tryInstallCorpus(root, force, detectedVendor)

	const scaffold = noScaffold
		? undefined
		: writeWorkspaceScaffold({
				root,
				plcProjectName: health.plcProjectName!,
				agentVersion: readAgentVersion(),
				force,
			})

	const project = `${health.platform}/${health.projectName}/${health.plcProjectName}`
	if (alreadyInitialized) {
		console.log(`workspace already initialized for ${project}`)
	} else {
		console.log(`initialized workspace for ${project}`)
		console.log("next: run `volt pull` to populate.")
	}
	if (corpus !== undefined && corpus.filesCopied > 0) {
		console.log(
			`Language reference: installed ${corpus.filesCopied} files; SKILL.md ${corpus.skillAction}.`,
		)
	}
	if (scaffold !== undefined && scaffold.created.length > 0) {
		console.log(
			`Scaffold: wrote ${scaffold.created.length} file(s) (${scaffold.skipped.length} already present).`,
		)
		console.log("next: run `bun install` in this folder to install dev dependencies.")
	}
	if (detectedVendor !== undefined) {
		console.log(`Detected vendor: ${detectedVendor}.`)
	}

	return {
		kind: "ok",
		projectVersion: `${health.platform}/${health.projectName}/${health.plcProjectName}`,
	}
}

function readAgentVersion(): string {
	try {
		const here = dirname(fileURLToPath(import.meta.url))
		const pkgPath = join(here, "..", "..", "package.json")
		const raw = readFileSync(pkgPath, "utf-8")
		const m = /"version"\s*:\s*"([^"]+)"/.exec(raw)
		return m?.[1] ?? "latest"
	} catch {
		return "latest"
	}
}

async function tryDetectVendor(
	root: string,
	platform: string,
): Promise<DetectedVendor | undefined> {
	const plat = platform.toLowerCase()
	if (plat.includes("twincat") || plat.includes("beckhoff")) return "twincat"
	if (plat.includes("codesys")) return "codesys"
	try {
		return await detectVendor(root)
	} catch {
		return undefined
	}
}

async function tryInstallCorpus(
	root: string,
	update: boolean,
	vendor: DetectedVendor | undefined,
): Promise<{ filesCopied: number; skillAction: "created" | "updated" | "unchanged" } | undefined> {
	try {
		const r = await installCorpus({
			targetDir: root,
			update,
			vendor: vendor ?? "codesys",
			log: () => {},
		})
		return {
			filesCopied: r.filesCopied,
			skillAction: r.skillAction,
		}
	} catch (err) {
		console.warn(
			`warning: could not install reference corpus: ${err instanceof Error ? err.message : String(err)}`,
		)
		return undefined
	}
}
