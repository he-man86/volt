/**
 * Pragma diagnostics — unknown-pragma / wrong-vendor / message /
 * companion / conflict / init-slot-collision / orphan-conditional.
 *
 * Re-lexes the full source because pragmas are stripped from parsed
 * body tokens (treated as trivia by the parser). Pragmas are
 * associated with a containing FB by source offset for companion /
 * conflict checks.
 */
import type { Span } from "../../lexer/span.js";
import type { ParseResult } from "../../parser/ast.js";
import { lex } from "../../lexer/lexer.js";
import type { Token } from "../../lexer/tokens.js";
import { PRAGMAS, getPragma, ALL_PRAGMAS } from "../../reference/pragmas.js";
import type { Vendor } from "../../reference/index.js";
import { getReservationsAtSlot } from "../../reference/init-slots.js";
import type { DiagnosticConfig } from "../../lsp/config/index.js";
import type { DiagnosticItem } from "./_shared.js";

/** Pragma directive names (the word right after `{`). */
const KNOWN_DIRECTIVES = new Set([
	"attribute",
	"text",
	"info",
	"warning",
	"error",
	"if",
	"elsif",
	"else",
	"end_if",
	"define",
	"undefine",
	"region",
	"end_region",
]);

/**
 * TwinCAT namespace prefixes — the ONLY documented vendor prefix
 * convention we acknowledge for the unknown-pragma bypass.
 *
 * The shared catalog is the source of truth for CODESYS pragmas; every
 * CODESYS-based IDE (Lenze, Wago, Schneider, ABB, Festo, …) uses the
 * SAME pragma set, so a Lenze project that hits `unknown-pragma` is
 * either using an unrecognized standard CODESYS attribute (add to
 * catalog) or genuinely user-defined (the warning is correct).
 *
 * TwinCAT is the structural outlier: Beckhoff publishes its own pragma
 * set (TcContextId, TcLinkTo, TcRpcEnable, ...) and many more exist than
 * we've catalogued. The `Tc...` / `Tc2_...` / `Tc3_...` namespace IS a
 * documented Beckhoff convention, so a name in that namespace is
 * legitimately vendor-extended regardless of catalog state.
 *
 * Anything outside this small allowlist falls through to the warning —
 * which is the correct signal for "either name it Tc..., or add to the
 * catalog as a documented CODESYS attribute, or fix your typo."
 */
const TWINCAT_NAMESPACE_PREFIXES = ["Tc", "Tc2_", "Tc3_"] as const;

/** True when the attribute name lives in the TwinCAT namespace — see
 *  TWINCAT_NAMESPACE_PREFIXES for the matching rules. */
function hasTwincatNamespacePrefix(name: string): boolean {
	for (const prefix of TWINCAT_NAMESPACE_PREFIXES) {
		if (!name.startsWith(prefix)) continue;
		const rest = name.slice(prefix.length);
		if (rest.length === 0) continue;
		// Underscore-style ends prefix at the underscore (Tc2_LibName).
		if (prefix.endsWith("_")) return true;
		// Concatenated style requires the next char to be a digit or
		// uppercase letter so e.g. "Tcontext" doesn't get classified as
		// `Tc` + "ontext" — must be a clean CamelCase / version boundary
		// (TcContextId, TcLinkTo).
		const next = rest.charCodeAt(0);
		if ((next >= 0x41 && next <= 0x5a) || (next >= 0x30 && next <= 0x39)) return true;
	}
	return false;
}

export function analyzePragmas(
	source: string,
	parseResult: ParseResult,
	cfg: DiagnosticConfig,
	activeVendor: Vendor | undefined,
	out: DiagnosticItem[],
): void {
	const tokens = lex(source);
	const fbUnits = parseResult.units.filter((u) => u.kind === "function_block");

	const pragmas: Array<{
		token: Token;
		directive: string;
		attributeName?: string;
		slotValue?: string;
		messageText?: string;
	}> = [];

	for (const tok of tokens) {
		if (tok.kind !== "pragma") continue;
		const { directive, attributeName, value, messageText } = parsePragmaText(tok.text);
		if (directive === undefined) continue;
		pragmas.push({ token: tok, directive, attributeName, slotValue: value, messageText });
	}

	// −1. Orphan conditional-compile pragmas. Track {IF} depth as we
	// walk pragmas in source order; emit when {ELSE}/{ELSIF}/{END_IF}
	// appears at depth 0. Matches TC's "Unexpected Pragma: 'ELSE'
	// found without matching 'if'". Structural only — no compile-time
	// predicate evaluation, no branch stripping — but enough for the
	// common authoring mistake (typo, missed close brace).
	if (cfg.orphanConditionalPragma) {
		let ifDepth = 0;
		for (const pr of pragmas) {
			const dir = pr.directive.toLowerCase();
			if (dir === "if") {
				ifDepth++;
			} else if (dir === "end_if") {
				if (ifDepth === 0) {
					out.push({
						severity: "error",
						span: pr.token.span,
						source: "volt-lsp-codesys",
						code: "orphan-conditional-pragma",
						message: `Unexpected pragma '${pr.directive}' without a matching '{IF}'.`,
					});
				} else {
					ifDepth--;
				}
			} else if (dir === "else" || dir === "elsif") {
				if (ifDepth === 0) {
					out.push({
						severity: "error",
						span: pr.token.span,
						source: "volt-lsp-codesys",
						code: "orphan-conditional-pragma",
						message: `Unexpected pragma '${pr.directive}' without a matching '{IF}'.`,
					});
				}
			}
		}
	}

	for (const pr of pragmas) {
		// 0. Message pragmas — mirror the author's compile-time
		//    message channel as an LSP diagnostic of matching
		//    severity. Source-emitted on purpose; surface them by
		//    default.
		if (cfg.messagePragmas && pr.messageText !== undefined) {
			const dir = pr.directive.toLowerCase();
			const severityMap: Record<string, DiagnosticItem["severity"] | undefined> = {
				error: "error",
				warning: "warning",
				info: "information",
				text: "hint",
			};
			const severity = severityMap[dir];
			if (severity !== undefined) {
				out.push({
					severity,
					span: pr.token.span,
					source: "volt-lsp-codesys",
					code: `message-pragma-${dir}`,
					message: pr.messageText,
				});
			}
		}

		// 1. Unknown pragma vs. wrong-vendor pragma.
		// If the name resolves in the active vendor's catalog → silent.
		// If it resolves in the OTHER vendor's catalog → wrong-vendor warning.
		// If it doesn't resolve at all → unknown-pragma warning.
		if (cfg.unknownPragma || cfg.wrongVendorPragma) {
			if (pr.directive.toLowerCase() === "attribute") {
				if (pr.attributeName !== undefined) {
					const entry = PRAGMAS.get(pr.attributeName.toLowerCase());
					if (entry === undefined) {
						// TwinCAT-namespaced names (`Tc...`/`Tc2_...`/
						// `Tc3_...`) silently pass — that namespace is a
						// documented Beckhoff convention and the catalog
						// only covers the most common entries. CODESYS-
						// based vendors share the SAME catalog as
						// CODESYS itself, so unknown attrs in CODESYS
						// projects are either uncatalogued standards
						// (file an issue) or genuinely user-defined
						// (warning is correct).
						if (cfg.unknownPragma && !hasTwincatNamespacePrefix(pr.attributeName)) {
							out.push({
								severity: "warning",
								span: pr.token.span,
								source: "volt-lsp-codesys",
								code: "unknown-pragma",
								message: `Unknown attribute pragma '${pr.attributeName}'. User-defined attributes should use a vendor prefix to avoid collisions.`,
							});
						}
					} else if (
						cfg.wrongVendorPragma &&
						activeVendor !== undefined &&
						entry.vendor !== "shared" &&
						entry.vendor !== activeVendor
					) {
						const eq =
							activeVendor === "codesys"
								? entry.equivalentIn?.codesys
								: entry.equivalentIn?.twincat;
						const suggestion =
							eq !== undefined ? ` Equivalent in ${activeVendor}: '${eq.name}'${eq.note !== undefined ? ` (${eq.note})` : ""}.` : "";
						out.push({
							severity: "warning",
							span: pr.token.span,
							source: "volt-lsp-codesys",
							code: "wrong-vendor-pragma",
							message: `Pragma '${pr.attributeName}' is ${entry.vendor}-specific. Active project is ${activeVendor}.${suggestion}`,
						});
					}
				}
			} else if (cfg.unknownPragma &&
				!KNOWN_DIRECTIVES.has(pr.directive.toLowerCase()) &&
				!PRAGMAS.has(pr.directive.toLowerCase())
			) {
				out.push({
					severity: "warning",
					span: pr.token.span,
					source: "volt-lsp-codesys",
					code: "unknown-pragma",
					message: `Unknown pragma directive '${pr.directive}'`,
				});
			}
		}

		// 2. Missing companion (instance-path → reflection, is_connected → reflection)
		if (cfg.pragmaMissingCompanion && pr.attributeName !== undefined) {
			const entry = getPragma(pr.attributeName);
			if (entry?.requires !== undefined && entry.requires.length > 0) {
				const containingFb = fbUnits.find(
					(fb) => pr.token.span.start >= fb.span.start && pr.token.span.start <= fb.span.end,
				);
				for (const required of entry.requires) {
					const hasCompanion = hasReflectionLikePragma(pragmas, required, containingFb?.span);
					if (!hasCompanion) {
						out.push({
							severity: "error",
							span: pr.token.span,
							source: "volt-lsp-codesys",
							code: "pragma-missing-companion",
							message: `Pragma '${pr.attributeName}' requires companion '${required}' on the enclosing FB or variable.`,
						});
					}
				}
			}
		}

		// 4. Init slot collision
		if (
			cfg.initSlotCollision &&
			pr.attributeName?.toLowerCase() === "global_init_slot" &&
			pr.slotValue !== undefined
		) {
			const slot = Number(pr.slotValue);
			if (!Number.isNaN(slot)) {
				const collisions = getReservationsAtSlot(slot);
				if (collisions.length > 0) {
					out.push({
						severity: "warning",
						span: pr.token.span,
						source: "volt-lsp-codesys",
						code: "init-slot-collision",
						message: `Slot ${slot} is reserved by CODESYS (${collisions[0]?.owner}: ${collisions[0]?.purpose}). Pick a unique slot.`,
					});
				}
			}
		}
	}

	// 3. Pragma conflict — pairs of mutually-exclusive pragmas attached
	// to the same FB. "Same target" approximated by containing FB span.
	if (cfg.pragmaConflict) {
		for (const fb of fbUnits) {
			const pragmasInFb = pragmas.filter(
				(p) => p.token.span.start >= fb.span.start && p.token.span.start <= fb.span.end,
			);
			const attributeNames = new Set(
				pragmasInFb
					.filter((p) => p.directive.toLowerCase() === "attribute")
					.map((p) => p.attributeName?.toLowerCase())
					.filter((n): n is string => n !== undefined),
			);
			for (const pragmaEntry of ALL_PRAGMAS) {
				if (pragmaEntry.forbids === undefined) continue;
				if (!attributeNames.has(pragmaEntry.name.toLowerCase())) continue;
				for (const forbidden of pragmaEntry.forbids) {
					if (attributeNames.has(forbidden.toLowerCase())) {
						const conflicting = pragmasInFb.find(
							(p) => p.attributeName?.toLowerCase() === forbidden.toLowerCase(),
						);
						if (conflicting !== undefined) {
							out.push({
								severity: "warning",
								span: conflicting.token.span,
								source: "volt-lsp-codesys",
								code: "pragma-conflict",
								message: `Pragma '${forbidden}' conflicts with '${pragmaEntry.name}' on the same FB.`,
							});
						}
					}
				}
			}
		}
	}
}

function hasReflectionLikePragma(
	pragmas: Array<{ token: Token; directive: string; attributeName?: string }>,
	requiredName: string,
	fbSpan: Span | undefined,
): boolean {
	const needle = requiredName.toLowerCase();
	for (const p of pragmas) {
		if (p.directive.toLowerCase() !== "attribute") continue;
		if (p.attributeName?.toLowerCase() !== needle) continue;
		// If we know the FB span, accept the companion only if it's
		// near or inside the FB. "Near" = anywhere before the FB end
		// (the FB's leading pragmas land just outside but right
		// before the FB's span).
		if (fbSpan === undefined) return true;
		if (p.token.span.start <= fbSpan.end) return true;
	}
	return false;
}

/**
 * Extract `{directive ...}` and (for `{attribute 'X'}` form) the
 * attribute name X. Returns `undefined` directive if the pragma text
 * is malformed.
 */
function parsePragmaText(text: string): {
	directive?: string;
	attributeName?: string;
	value?: string;
	/** For message pragmas (`text`/`info`/`warning`/`error`), the quoted message text. */
	messageText?: string;
} {
	// Directive = first word after `{`, terminated by whitespace OR `}`
	// (handles bodyless pragmas like `{ELSE}` and `{END_IF}` where
	// `\S+` would otherwise greedily consume the closing brace).
	const m = /^\{\s*([^\s}]+)/.exec(text);
	if (m === null) return {};
	const directive = m[1];
	let attributeName: string | undefined;
	let value: string | undefined;
	let messageText: string | undefined;
	const dirLower = directive?.toLowerCase();
	if (dirLower === "attribute") {
		// {attribute 'name'}            → name only
		// {attribute 'name' := 'value'} → name + value
		const mAttr = /^\{\s*attribute\s+'([^']+)'(?:\s*:=\s*'([^']*)')?/i.exec(text);
		if (mAttr !== null) {
			attributeName = mAttr[1];
			value = mAttr[2];
		}
	} else if (dirLower === "text" || dirLower === "info" || dirLower === "warning" || dirLower === "error") {
		// {warning 'message body'} — extract the quoted body.
		const mMsg = /^\{\s*\S+\s+'([^']*)'/i.exec(text);
		if (mMsg !== null) messageText = mMsg[1];
	}
	return { directive, attributeName, value, messageText };
}
