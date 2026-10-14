/**
 * WHAT A BUILD ERROR IS, independent of the IDE's UI language (openspec environment-dependency-audit 2.6).
 *
 * <p>CODESYS writes its build messages in its UI language — measured: a German CODESYS answers "Bezeichner 'x' nicht
 * definiert" where an English one says "Identifier 'x' not defined", both under C0046. So a CODESYS error is told by the
 * item it lands on, its code and the identifiers it quotes (identifiers are never translated). TwinCAT reports no code
 * and its compiler stays English under a localized shell (DIALECT D42): its error is its whole message.</p>
 */

export type BuildError = { name?: string; code?: string; message: string }

/** The identifiers a message quotes, sorted (word order is the language's). `'Unknown type: 'X''` yields `X`. */
function quotedIdentifiers(message: string): string[] {
	return [...message.matchAll(/'([A-Za-z_][A-Za-z0-9_.]*)'/g)].map((m) => m[1]).sort()
}

export function buildErrorKey(d: BuildError): string {
	if (d.code === undefined) return `${d.name}: ${d.message}`
	const ids = quotedIdentifiers(d.message)
	if (ids.length === 0) throw new Error(`${d.code} "${d.message}" quotes no identifier — its code alone does not say which error it is`)
	return `${d.name}: ${d.code} [${ids.join(",")}]`
}

/** The key a recorded row (its code and its English message) must match: coded where the vendor reports codes. */
export function expectedBuildErrorKey(name: string, row: { code: string; message: string }, coded: boolean): string {
	return buildErrorKey(coded ? { name, ...row } : { name, message: row.message })
}
