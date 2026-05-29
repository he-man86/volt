/**
 * Semantic diagnostics — checks driven by the symbol table + CODESYS
 * reference catalog. Returns LSP-compatible `Diagnostic[]` (without
 * the LSP types import; the wire layer converts).
 *
 * **Pure data in → pure data out.** This module knows nothing about
 * LSP transport. The server calls `computeSemanticDiagnostics()` and
 * merges results with parse errors before push/pull delivery.
 *
 * Each check has a `DiagnosticConfig` flag — disabled checks are
 * skipped entirely (no compute cost).
 */

import type { Span } from "../lexer/span.js";
import type { ParseResult, TopLevel, BodySpan } from "../parser/ast.js";
import type { Scope, Symbol } from "./symbol-table.js";
import { lookup as resolverLookup, scanAllIdentifiersInBody } from "./resolver.js";
import { ALL_KEYWORDS } from "../lexer/tokens.js";
import { lex } from "../lexer/lexer.js";
import type { Token } from "../lexer/tokens.js";
import { PRAGMAS, getPragma, ALL_PRAGMAS } from "../reference/pragmas.js";
import {
	conversionsForSource,
	getConversion,
	isAcceptableSource,
} from "../reference/type-conversion.js";
import type { Vendor } from "../reference/index.js";
import { getLifecycle } from "../reference/lifecycle.js";
import { getReservationsAtSlot } from "../reference/init-slots.js";
import type { DiagnosticConfig } from "../lsp/config.js";

export interface DiagnosticItem {
	severity: "error" | "warning" | "information" | "hint";
	span: Span;
	source: string;
	code: string;
	message: string;
}

export interface DiagnosticsArgs {
	/** Parse result for this document. */
	parseResult: ParseResult;
	/** Source text — used for pragma diagnostics (pragmas are stripped from parsed body tokens). */
	source: string;
	/** The project scope (for cross-file lookup). */
	project: Scope;
	/** Enable flags. Defaults to all-on. */
	config: DiagnosticConfig;
	/** Active vendor — drives wrong-vendor-pragma vs unknown-pragma distinction. */
	activeVendor?: Vendor;
}

const KEYWORD_SET = new Set(ALL_KEYWORDS.map((k) => k.toLowerCase()));

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

export function computeSemanticDiagnostics(args: DiagnosticsArgs): DiagnosticItem[] {
	const out: DiagnosticItem[] = [];
	const cfg = args.config;

	if (
		cfg.reservedKeyword ||
		cfg.doubleUnderscore ||
		cfg.consecutiveUnderscores ||
		cfg.duplicateDeclaration
	) {
		walkDeclarations(args.parseResult, args.project, cfg, out);
	}

	if (cfg.unresolvedIdentifier) {
		checkUnresolvedIdentifiers(args.parseResult, args.project, args.source, out);
	}

	if (cfg.unknownPragma || cfg.wrongVendorPragma || cfg.pragmaMissingCompanion || cfg.pragmaConflict || cfg.initSlotCollision) {
		analyzePragmas(args.source, args.parseResult, cfg, args.activeVendor, out);
	}

	if (cfg.fbLifecycleSignature) {
		checkLifecycleSignatures(args.parseResult, out);
	}

	if (cfg.shadowingDeclaration) {
		checkShadowing(args.project, out);
	}

	if (cfg.conversionSourceMismatch) {
		checkConversionCalls(args.parseResult, args.project, out);
	}

	if (cfg.assignmentTypeMismatch) {
		checkAssignmentTypes(args.parseResult, args.project, out);
	}

	return out;
}

// ─── Identifier-shape checks ─────────────────────────────────────────

function walkDeclarations(
	parseResult: ParseResult,
	project: Scope,
	cfg: DiagnosticConfig,
	out: DiagnosticItem[],
): void {
	// Walk every TopLevel and inspect its declared identifiers.
	for (const unit of parseResult.units) {
		checkUnitIdentifiers(unit, cfg, out);
	}
	// Duplicate-declaration: walk the project scope tree.
	if (cfg.duplicateDeclaration) {
		walkScopeForDuplicates(project, out);
	}
}

function checkUnitIdentifiers(unit: TopLevel, cfg: DiagnosticConfig, out: DiagnosticItem[]): void {
	// Top-level name (FB/program/function/method/action/property/interface/type/GVL).
	const topName = getUnitName(unit);
	if (topName !== undefined) {
		emitIdentifierShapeDiagnostics(topName.text, topName.span, cfg, out);
	}
	// VAR-section declarations (FBs, programs, functions, methods).
	if ("varSections" in unit) {
		for (const section of unit.varSections) {
			for (const decl of section.decls) {
				for (const id of decl.names) {
					emitIdentifierShapeDiagnostics(id.text, id.span, cfg, out);
				}
			}
		}
	}
}

function getUnitName(unit: TopLevel): { text: string; span: Span } | undefined {
	if (
		unit.kind === "function_block" ||
		unit.kind === "program" ||
		unit.kind === "function" ||
		unit.kind === "method" ||
		unit.kind === "action" ||
		unit.kind === "property" ||
		unit.kind === "interface" ||
		unit.kind === "type_decl"
	) {
		return { text: unit.name.text, span: unit.name.span };
	}
	return undefined;
}

function emitIdentifierShapeDiagnostics(
	name: string,
	span: Span,
	cfg: DiagnosticConfig,
	out: DiagnosticItem[],
): void {
	if (cfg.reservedKeyword && KEYWORD_SET.has(name.toLowerCase())) {
		out.push({
			severity: "error",
			span,
			source: "volt-lsp-st",
			code: "reserved-keyword",
			message: `'${name}' is a CODESYS keyword and cannot be used as an identifier`,
		});
	}
	if (cfg.doubleUnderscore && name.startsWith("__")) {
		out.push({
			severity: "error",
			span,
			source: "volt-lsp-st",
			code: "double-underscore-prefix",
			message: `Identifiers starting with '__' are reserved for system-generated names`,
		});
	}
	if (cfg.consecutiveUnderscores && /_{2,}/.test(name) && !name.startsWith("__")) {
		// The startsWith('__') guard avoids double-firing with double-underscore check.
		out.push({
			severity: "error",
			span,
			source: "volt-lsp-st",
			code: "consecutive-underscores",
			message: `Multiple consecutive underscores are not permitted in identifiers`,
		});
	}
}

function walkScopeForDuplicates(scope: Scope, out: DiagnosticItem[]): void {
	for (const [, symbols] of scope.symbols) {
		if (symbols.length > 1) {
			// Skip the first declaration; flag the duplicates.
			for (let i = 1; i < symbols.length; i++) {
				const sym = symbols[i] as Symbol;
				out.push({
					severity: "error",
					span: sym.span,
					source: "volt-lsp-st",
					code: "duplicate-declaration",
					message: `'${sym.name}' is already declared in this scope`,
				});
			}
		}
	}
	for (const child of scope.children) {
		walkScopeForDuplicates(child, out);
	}
}

// ─── Unresolved-identifier check ─────────────────────────────────────

function checkUnresolvedIdentifiers(
	parseResult: ParseResult,
	project: Scope,
	source: string,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		const body = getBody(unit);
		if (body === undefined) continue;
		const scope = findScopeForUnit(project, unit);
		if (scope === undefined) continue;
		// Skip the check entirely when the body's source contains
		// conditional-compile pragmas ({IF}/{ELSIF}/{ELSE}/{END_IF}).
		// Conservative: without modeling the preprocessor we can't
		// tell whether an identifier inside a conditional block lives
		// in the stripped or kept branch, so checking it produces
		// false positives. TC's preprocessor strips dead branches
		// before semantic analysis; mirroring that requires a real
		// preprocessor — out of scope. Until then, the presence of
		// ANY conditional pragma anywhere in the body disables this
		// check for that body.
		//
		// Pragma tokens are stripped from body.tokens by the parser
		// (treated as trivia), so we scan the body's source slice
		// directly.
		const bodySource = source.slice(body.span.start, body.span.end);
		if (bodyContainsConditionalPragma(bodySource)) continue;
		for (const occ of scanAllIdentifiersInBody(body)) {
			if (occ.isMemberAccess) {
				// `x.member` — we don't resolve members yet (requires type
				// inference). Skip to avoid false positives.
				continue;
			}
			const name = occ.token.text;
			if (KEYWORD_SET.has(name.toLowerCase())) continue;
			// Built-in conversion operators (`INT_TO_REAL`, etc.) are
			// implicit lexical tokens, not symbols in any scope. Skip
			// them here — `checkConversionCalls` handles their own
			// validity (source-type mismatch). Without this skip,
			// every conversion call would surface a false-positive
			// unresolved-identifier warning.
			if (getConversion(name) !== undefined) continue;
			if (resolverLookup(scope, name) !== undefined) continue;
			out.push({
				severity: "warning",
				span: occ.span,
				source: "volt-lsp-st",
				code: "unresolved-identifier",
				message: `'${name}' is not defined in any reachable scope`,
			});
		}
	}
}

/**
 * Substring-detect conditional-compile pragmas in a raw source slice.
 * Used to disable unresolved-identifier checks in bodies that have
 * preprocessor branches (we can't safely tell which branch is live).
 *
 * Regex is permissive on whitespace inside the braces so it catches
 * `{ IF defined(X) }`, `{IF\tdefined ...}`, etc.
 */
const CONDITIONAL_PRAGMA_RE = /\{\s*(?:IF|ELSIF|ELSE|END_IF)\b/i;

function bodyContainsConditionalPragma(bodySource: string): boolean {
	return CONDITIONAL_PRAGMA_RE.test(bodySource);
}

function getBody(unit: TopLevel): BodySpan | undefined {
	switch (unit.kind) {
		case "function_block":
		case "program":
		case "function":
		case "method":
		case "action":
			return unit.body;
		default:
			return undefined;
	}
}

function findScopeForUnit(project: Scope, unit: TopLevel): Scope | undefined {
	const targetName = getUnitName(unit)?.text.toLowerCase();
	if (targetName === undefined) return undefined;
	// Walk the WHOLE scope tree — standalone METHOD / ACTION /
	// PROPERTY units live as children of their containing FB / PROGRAM
	// scope, not directly under project (workspace-layout convention,
	// see ingestStandaloneMethod). A flat scan of project.children
	// would miss them and the body-walking checks (conversion source
	// mismatch, unresolved identifier) would silently skip every
	// method body.
	function walk(scope: Scope): Scope | undefined {
		for (const child of scope.children) {
			if (child.name.toLowerCase() === targetName) return child;
			const inner = walk(child);
			if (inner !== undefined) return inner;
		}
		return undefined;
	}
	return walk(project);
}

// ─── Unknown-pragma check ────────────────────────────────────────────

/**
 * Pragma analyzer — unknown-pragma + companion/conflict + init-slot
 * collision checks. Re-lexes the source because pragmas are stripped
 * from parsed body tokens (treated as trivia by the parser).
 *
 * For companion/conflict checks, pragmas are associated with the
 * **next non-trivia token** OR the containing FB by source offset.
 */
function analyzePragmas(
	source: string,
	parseResult: ParseResult,
	cfg: DiagnosticConfig,
	activeVendor: Vendor | undefined,
	out: DiagnosticItem[],
): void {
	const tokens = lex(source);
	// Index FB units by source offset for companion lookups.
	const fbUnits = parseResult.units.filter((u) => u.kind === "function_block");

	// Pragmas, in source order, with their parsed metadata.
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
	// walk pragmas in source order; emit a diagnostic when an
	// {ELSE} / {ELSIF} / {END_IF} appears with depth 0. Matches TC's
	// "Unexpected Pragma: 'ELSE' found without matching 'if'" error.
	// Stays structural — no compile-time predicate evaluation, no
	// branch stripping — but the balance check is enough for the
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
						source: "volt-lsp-st",
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
						source: "volt-lsp-st",
						code: "orphan-conditional-pragma",
						message: `Unexpected pragma '${pr.directive}' without a matching '{IF}'.`,
					});
				}
			}
		}
	}

	for (const pr of pragmas) {
		// 0. Message pragmas — mirror the author's compile-time message
		//    channel as an LSP diagnostic of matching severity. Matches
		//    what the IDE compiler shows (TC emits these into the Build
		//    output pane with the same severity). Source-emitted on
		//    purpose; surface them by default.
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
					source: "volt-lsp-st",
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
						if (cfg.unknownPragma) {
							out.push({
								severity: "warning",
								span: pr.token.span,
								source: "volt-lsp-st",
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
							source: "volt-lsp-st",
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
					source: "volt-lsp-st",
					code: "unknown-pragma",
					message: `Unknown pragma directive '${pr.directive}'`,
				});
			}
		}

		// 2. Missing companion (instance-path → reflection, is_connected → reflection)
		if (cfg.pragmaMissingCompanion && pr.attributeName !== undefined) {
			const entry = getPragma(pr.attributeName);
			if (entry?.requires !== undefined && entry.requires.length > 0) {
				// Containing FB — by source offset.
				const containingFb = fbUnits.find(
					(fb) => pr.token.span.start >= fb.span.start && pr.token.span.start <= fb.span.end,
				);
				for (const required of entry.requires) {
					const hasCompanion = hasReflectionLikePragma(pragmas, required, containingFb?.span);
					if (!hasCompanion) {
						out.push({
							severity: "error",
							span: pr.token.span,
							source: "volt-lsp-st",
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
						source: "volt-lsp-st",
						code: "init-slot-collision",
						message: `Slot ${slot} is reserved by CODESYS (${collisions[0]?.owner}: ${collisions[0]?.purpose}). Pick a unique slot.`,
					});
				}
			}
		}
	}

	// 3. Pragma conflict — pairs of mutually-exclusive pragmas attached
	// to the same FB. We approximate "same target" by containing FB span.
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
								source: "volt-lsp-st",
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
		// If we know the FB span, accept the companion only if it's near
		// or inside the FB. "Near" = anywhere before the FB end (the FB
		// declaration's leading pragmas land in the file outside but
		// just-before the FB's span).
		if (fbSpan === undefined) return true;
		if (p.token.span.start <= fbSpan.end) return true;
	}
	return false;
}

// ─── FB lifecycle signature validation ───────────────────────────────

function checkLifecycleSignatures(parseResult: ParseResult, out: DiagnosticItem[]): void {
	for (const unit of parseResult.units) {
		if (unit.kind !== "method") continue;
		const spec = getLifecycle(unit.name.text);
		if (spec === undefined) continue;

		// Return type must be BOOL.
		if (unit.returnType === undefined || returnTypeName(unit) !== "BOOL") {
			out.push({
				severity: "error",
				span: unit.name.span,
				source: "volt-lsp-st",
				code: "fb-lifecycle-signature",
				message: `${unit.name.text} must return BOOL.`,
			});
		}

		// Required parameters in VAR_INPUT.
		const inputs = collectVarInputParams(unit);
		for (let i = 0; i < spec.requiredParams.length; i++) {
			const required = spec.requiredParams[i]!;
			const got = inputs[i];
			if (got === undefined || got.name.toLowerCase() !== required.name.toLowerCase()) {
				out.push({
					severity: "error",
					span: unit.name.span,
					source: "volt-lsp-st",
					code: "fb-lifecycle-signature",
					message: `${unit.name.text} requires VAR_INPUT parameter '${required.name} : ${required.type}' at position ${i + 1}.`,
				});
			}
		}

		if (!spec.allowsExtraParams && inputs.length > spec.requiredParams.length) {
			out.push({
				severity: "error",
				span: unit.name.span,
				source: "volt-lsp-st",
				code: "fb-lifecycle-signature",
				message: `${unit.name.text} does not accept extra VAR_INPUT parameters.`,
			});
		}
	}
}

function returnTypeName(unit: { returnType?: { kind: string; name?: { text: string } } }): string | undefined {
	if (unit.returnType === undefined) return undefined;
	if (unit.returnType.kind !== "named_type") return undefined;
	return unit.returnType.name?.text.toUpperCase();
}

function collectVarInputParams(unit: { varSections: Array<{ sectionKind: string; decls: Array<{ names: Array<{ text: string }> }> }> }): Array<{ name: string }> {
	const out: Array<{ name: string }> = [];
	for (const section of unit.varSections) {
		if (section.sectionKind !== "VAR_INPUT") continue;
		for (const decl of section.decls) {
			for (const id of decl.names) {
				out.push({ name: id.text });
			}
		}
	}
	return out;
}

// ─── Shadowing diagnostic ────────────────────────────────────────────

function checkShadowing(project: Scope, out: DiagnosticItem[]): void {
	walkShadowing(project, out);
}

// ─── Conversion-source-mismatch ──────────────────────────────────────

/**
 * Scan each POU body for `<NAME>(<simple_ident>)` patterns where
 * `<NAME>` looks like a type-conversion (`<SRC>_TO_<DST>` or `TRUNC`
 * /`TRUNC_INT`). Resolve the inner identifier via the symbol table;
 * if its declared type doesn't match `<SRC>`, emit a warning with a
 * suggested replacement.
 *
 * Limitations (deliberate — we don't type-check expressions):
 *   - Only simple-identifier args. `INT_TO_DINT(a + b)` is skipped.
 *   - Only resolves names visible in the project / containing POU scope.
 *   - `TO_<DST>` overloaded form is skipped (source type is "ANY").
 *   - When the inner identifier can't be resolved, we skip (so the
 *     unresolved-identifier diagnostic handles it, not us).
 *
 * False-positive guard:
 *   - Integer-family widening is allowed (CODESYS implicitly widens
 *     SINT → INT, INT → DINT, etc.).
 *   - Date-family conversions among DATE/DT/TOD/LDATE/LDT/LTOD all OK.
 *
 * What this catches that pretraining gets wrong:
 *   - `INT_TO_DINT(myStr)` when myStr is STRING → suggest `STRING_TO_DINT`
 *   - `DT_TO_STRING(myDate)` when myDate is DATE → suggest `DATE_TO_STRING`
 *   - `REAL_TO_INT(myInt)` (probably meant TRUNC or no conversion)
 */
function checkConversionCalls(
	parseResult: ParseResult,
	project: Scope,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		const body = getBody(unit);
		if (body === undefined) continue;
		const scope = findScopeForUnit(project, unit);
		if (scope === undefined) continue;

		const meaningful = body.tokens.filter((t) => !isLexerTrivia(t.kind));
		for (let i = 0; i < meaningful.length; i++) {
			const callTok = meaningful[i];
			if (callTok === undefined || callTok.kind !== "identifier") continue;

			const conv = getConversion(callTok.text);
			if (conv === undefined) continue;
			if (conv.sourceType === "ANY") continue; // TO_<DST> form — can't validate

			// Need `(` next.
			const lparen = meaningful[i + 1];
			if (lparen?.kind !== "punct" || lparen.text !== "(") continue;
			// Need simple identifier as the single arg.
			const argTok = meaningful[i + 2];
			if (argTok?.kind !== "identifier") continue;
			const rparen = meaningful[i + 3];
			if (rparen?.kind !== "punct" || rparen.text !== ")") continue;

			// Resolve the inner identifier.
			const r = resolverLookup(scope, argTok.text);
			if (r === undefined) continue; // unresolved → other diagnostic handles
			const typeExpr = r.symbol.typeExpr;
			if (typeExpr === undefined) continue;
			// Extract a comparable type name. We only check the
			// straightforward cases — array / pointer / reference /
			// implicit-enum get skipped (composite types can't easily
			// match a conversion's source).
			let argType: string;
			if (typeExpr.kind === "named_type") {
				argType = typeExpr.name.text;
			} else if (typeExpr.kind === "string_type") {
				argType = typeExpr.wide ? "WSTRING" : "STRING";
			} else {
				continue;
			}

			if (isAcceptableSource(conv, argType)) continue;

			// Suggest a replacement: same destination, source matching the
			// argument's actual type. Prefer the strictly-named form.
			const replacements = conversionsForSource(argType, conv.destType);
			const suggestion =
				replacements.length > 0
					? ` Use \`${replacements[0]?.name}(${argTok.text})\` instead.`
					: "";

			out.push({
				// Error — TC refuses to compile these (`Cannot convert
				// type X to type Y`). Matching the TC severity keeps the
				// IDE squiggle red where the IDE squiggle is red.
				severity: "error",
				span: callTok.span,
				source: "volt-lsp-st",
				code: "conversion-source-mismatch",
				message:
					`Conversion '${conv.name}' expects ${conv.sourceType}, ` +
					`but '${argTok.text}' is declared ${argType}.${suggestion}`,
			});
		}
	}
}

/**
 * Simple assignment-type-mismatch check. Walks each method body,
 * finds `<id> := <rhs> ;` patterns where RHS is a single identifier
 * or typed literal, looks up both sides' types, and warns when TC
 * would refuse the assignment (BOOL ↔ numeric, narrowing,
 * STRING ↔ numeric).
 *
 * Skipped — silently — when RHS is more complex (binary expression,
 * conversion call, member access, parenthesized). Without full
 * expression type-inference we'd guess wrong and false-positive.
 * Conservative by design.
 */
function checkAssignmentTypes(
	parseResult: ParseResult,
	project: Scope,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		const body = getBody(unit);
		if (body === undefined) continue;
		const scope = findScopeForUnit(project, unit);
		if (scope === undefined) continue;

		const meaningful = body.tokens.filter((t) => !isLexerTrivia(t.kind));
		for (let i = 0; i < meaningful.length; i++) {
			// Pattern: <ident> := <single-rhs> ;
			const lhsTok = meaningful[i];
			if (lhsTok === undefined || lhsTok.kind !== "identifier") continue;
			const assign = meaningful[i + 1];
			if (assign?.kind !== "punct" || assign.text !== ":=") continue;
			// Find the terminating `;`. Capture everything between as RHS.
			let semicolonAt = -1;
			for (let j = i + 2; j < meaningful.length && j < i + 8; j++) {
				const t = meaningful[j];
				if (t?.kind === "punct" && t.text === ";") {
					semicolonAt = j;
					break;
				}
			}
			if (semicolonAt < 0) continue;
			const rhsTokens = meaningful.slice(i + 2, semicolonAt);

			// LHS type lookup. Skip if LHS is itself a member access
			// (`x.field`) — we don't track member types.
			const lhsType = simpleIdentifierType(scope, lhsTok.text);
			if (lhsType === undefined) continue;

			// RHS type — only the simple shapes we trust.
			const rhsType = classifyRhs(rhsTokens, scope);
			if (rhsType === undefined) continue;

			if (isAssignable(lhsType, rhsType)) continue;

			out.push({
				// Error — TC refuses to compile a mismatched assignment
				// ("Cannot convert type X to type Y"). Matching the TC
				// severity gives the IDE a consistent red squiggle.
				severity: "error",
				span: lhsTok.span,
				source: "volt-lsp-st",
				code: "assignment-type-mismatch",
				message: `Cannot assign ${rhsType} value to '${lhsTok.text}' (declared ${lhsType}).`,
			});
		}
	}
}

/** Look up an identifier and return its declared elementary type name (uppercased), or undefined when not resolvable to a simple named type. */
function simpleIdentifierType(scope: Scope, name: string): string | undefined {
	const r = resolverLookup(scope, name);
	if (r === undefined) return undefined;
	const t = r.symbol.typeExpr;
	if (t === undefined) return undefined;
	if (t.kind === "named_type") return t.name.text.toUpperCase();
	if (t.kind === "string_type") return t.wide ? "WSTRING" : "STRING";
	return undefined;
}

/**
 * Classify RHS tokens into an elementary type when the shape is
 * trustworthy — single identifier, single numeric/string literal,
 * typed-literal `TYPE#value`. Anything else returns undefined.
 */
function classifyRhs(rhs: readonly Token[], scope: Scope): string | undefined {
	if (rhs.length === 0) return undefined;
	if (rhs.length === 1) {
		const t = rhs[0]!;
		if (t.kind === "identifier") return simpleIdentifierType(scope, t.text);
		if (t.kind === "string_lit") return "STRING";
		if (t.kind === "wstring_lit") return "WSTRING";
		if (t.kind === "time_lit") return "TIME";
		if (t.kind === "date_lit") return "DATE";
		if (t.kind === "datetime_lit") return "DT";
		if (t.kind === "keyword" && (t.text.toUpperCase() === "TRUE" || t.text.toUpperCase() === "FALSE")) return "BOOL";
		// Numeric literals (`int_lit`, `real_lit`) are intentionally
		// SKIPPED. TC types them polymorphically: `bValue : BYTE :=
		// 2#10101010` is valid because 170 fits in BYTE; same literal
		// assigned to INT or DINT is also valid. Without parsing the
		// literal's numeric value we'd false-positive on every
		// hex/binary-to-narrow-numeric assignment. The typed-literal
		// form `BYTE#170` (handled below) is the explicit alternative
		// when the assignment-type rigor matters.
		return undefined;
	}
	// `TYPE#literal` pattern → length 3: identifier or keyword for type,
	// `#`, then literal.
	if (rhs.length === 3) {
		const head = rhs[0]!;
		const hash = rhs[1]!;
		if (
			(head.kind === "identifier" || head.kind === "keyword") &&
			hash.kind === "punct" &&
			hash.text === "#"
		) {
			return head.text.toUpperCase();
		}
	}
	return undefined;
}

/**
 * IEC 61131-3 assignment compatibility (simplified — only the rules
 * the simple-assignment check exercises).
 *
 *   - Same type → always OK.
 *   - BOOL is isolated: only BOOL accepts BOOL, BOOL rejects every
 *     other type, every other type rejects BOOL.
 *   - STRING / WSTRING / TIME / DATE / TOD / DT-family are
 *     isolated from numerics.
 *   - Numeric types form a widening hierarchy by byte-width: a
 *     narrower type can flow into a wider one (INT → DINT → LINT →
 *     REAL → LREAL). The reverse (DINT → INT) is narrowing — not
 *     accepted implicitly.
 *
 * Returns true when unsure (unknown type names) — we'd rather miss a
 * bug than flag valid code as broken.
 */
function isAssignable(lhs: string, rhs: string): boolean {
	if (lhs === rhs) return true;
	const ISOLATED = new Set([
		"BOOL",
		"STRING",
		"WSTRING",
		"TIME",
		"LTIME",
		"DATE",
		"TIME_OF_DAY",
		"TOD",
		"DATE_AND_TIME",
		"DT",
		"LDATE",
		"LDATE_AND_TIME",
		"LDT",
		"LTOD",
	]);
	if (ISOLATED.has(lhs) || ISOLATED.has(rhs)) return false;
	const NUMERIC_RANK: Record<string, number> = {
		SINT: 1,
		USINT: 1,
		BYTE: 1,
		INT: 2,
		UINT: 2,
		WORD: 2,
		DINT: 3,
		UDINT: 3,
		DWORD: 3,
		LINT: 4,
		ULINT: 4,
		LWORD: 4,
		REAL: 5,
		LREAL: 6,
	};
	const lr = NUMERIC_RANK[lhs];
	const rr = NUMERIC_RANK[rhs];
	if (lr === undefined || rr === undefined) return true; // unknown — don't flag
	return rr <= lr;
}

function isLexerTrivia(kind: string): boolean {
	return (
		kind === "whitespace" ||
		kind === "line_comment" ||
		kind === "block_comment" ||
		kind === "pragma"
	);
}

// ─── (existing) walkShadowing ────────────────────────────────────────

function walkShadowing(scope: Scope, out: DiagnosticItem[]): void {
	for (const [, symbols] of scope.symbols) {
		for (const sym of symbols) {
			// Walk parent chain for a same-name symbol. Skip the
			// declaration's own scope.
			let parent = scope.parent;
			while (parent !== undefined) {
				const outerHits = parent.symbols.get(sym.name.toLowerCase());
				if (outerHits !== undefined && outerHits.length > 0) {
					out.push({
						severity: "information",
						span: sym.span,
						source: "volt-lsp-st",
						code: "shadowing-declaration",
						message: `'${sym.name}' shadows a same-name declaration in outer scope '${parent.name}'.`,
					});
					break;
				}
				parent = parent.parent;
			}
		}
	}
	for (const child of scope.children) {
		walkShadowing(child, out);
	}
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
