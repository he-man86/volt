/**
 * VG document symbols — each network in a graphical body becomes a child
 * symbol of its POU, so the outline pane shows the network structure
 * (vg-language.md §11). The network index + optional label is the name.
 */
import { rangeFromSpan } from "../../position.js";
import { LspSymbolKind, type DocumentSymbol } from "../../types.js";
import type { VgBody, VgNetwork } from "../../../vg/index.js";

export function vgNetworkSymbols(vg: VgBody): DocumentSymbol[] {
	return vg.networks.map(networkSymbol);
}

function networkSymbol(network: VgNetwork): DocumentSymbol {
	const idx = network.index ?? "?";
	const name = network.label !== undefined ? `NETWORK ${idx} "${network.label}"` : `NETWORK ${idx}`;
	return {
		name,
		detail: network.language + (network.disabled ? " (disabled)" : ""),
		kind: LspSymbolKind.Object,
		range: rangeFromSpan(network.span),
		selectionRange: rangeFromSpan(network.headerSpan),
	};
}
