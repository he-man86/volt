/**
 * volt-git status — fetch the live bridge snapshot (health + refs) and render it through the shared status
 * model (`domain/status-model.ts`), which pull/push also use to build their post-action status.
 */
import type { Remote } from "../bridge/types.js";
import { configExists, loadConfig, projectMismatch } from "../config.js";
import { buildStatusData, type BridgeSnapshot } from "../domain/status-model.js";
import type { StatusData } from "../types.js";

export async function status(root: string, bridge: Remote): Promise<StatusData> {
	const cfg = configExists(root) ? loadConfig(root) : undefined;
	let snap: BridgeSnapshot = { online: false, detail: "offline", projectMismatch: null, items: {}, folders: {}, projectVersion: "" };
	try {
		const health = await bridge.getHealth();
		const online = health.connected === true;
		const mismatch = cfg !== undefined ? projectMismatch(cfg, health) : null;
		const detail = online ? `${health.platform}/${health.projectName ?? "?"}` : (health.status ?? "offline");
		if (online && mismatch === null) {
			const refs = await bridge.getRefs();
			snap = { online, detail, projectMismatch: mismatch, items: refs.items, folders: refs.folders, projectVersion: refs.projectVersion };
		} else {
			snap = { online, detail, projectMismatch: mismatch, items: {}, folders: {}, projectVersion: "" };
		}
	} catch (err) {
		snap = { ...snap, online: false, detail: err instanceof Error ? err.message : "bridge offline" };
	}
	return buildStatusData(root, snap);
}
