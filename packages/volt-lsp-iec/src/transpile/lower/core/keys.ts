/**
 * THE IDENTITY KEYS (transpile-restructure 8.3 R7): every key one lowering writes and another must write alike — a frame,
 * a routine's run, a variable in either, a GVL variable, an FB type the image holds, a byte view — is built here, so one
 * key has one spelling. A key two files spell apart silently stops matching: the escape pass, the pointer tables, the
 * interface tables, the BOOL bytes and the address claims all compare them.
 *
 *   POU:<POU>            the POU's own frame (`Lowering.frameContext`, `entry/lower-unit.ts`)
 *   FB:<TYPE>            an FB type's frame — its body's, its METHODs' and ACTIONs' (`storage/layout.ts`, `calls/routines.ts`)
 *   FUNCTION:<KEY>       a FUNCTION's frame (`calls/routines.ts`)
 *   GLOBAL               the application's globals, as a context (an address claim, an interface's instance)
 *   ROUTINE:<OF>         a body's per-run storage (`Lowering.routineContext`): a routine's by its key, a POU's or an FB's
 *                        body's by its frame (`ROUTINE:POU:<POU>`, `ROUTINE:FB:<TYPE>`)
 *   <CONTEXT>.<NAME>     a variable of a frame or a run (`variableIn`): `FB:<TYPE>.<FIELD>` a field as its FB's bodies
 *                        name it, `ROUTINE:<KEY>.<PARAM>` a routine's parameter, `GLOBAL.<NAME>` a GVL variable
 *   TYPE:<FB>            an FB type whose instances' data the image holds (`pointers/escape.ts`)
 *   VIEW:<POINTER KEY>   a POINTER TO BOOL that reads a byte (`pointers/bool-views.ts`)
 *
 * Names are upper-cased (ST names are case-insensitive); a routine's key already is.
 */

/** The POU's own frame. */
export const pouContext = (pou: string): string => `POU:${pou.toUpperCase()}`

/** An FB type's frame — its body's, its METHODs' and ACTIONs'. */
export const fbContext = (fb: string): string => `FB:${fb.toUpperCase()}`

/** A FUNCTION's frame, by its routine key. */
export const functionContext = (routineKey: string): string => `FUNCTION:${routineKey}`

/** The application's globals, as a context. */
export const GLOBAL_CONTEXT = "GLOBAL"

const ROUTINE = "ROUTINE:"

/** A body's per-run storage: a routine's by its key, a POU's or an FB's body's by its frame context. */
export const routineContext = (of: string): string => `${ROUTINE}${of}`

/** What a run context is the run of — the routine key or frame context `routineContext` was given. */
export function runOf(context: string): string {
  if (!context.startsWith(ROUTINE)) throw new Error(`lowering bug: ${context} is no run context`)
  return context.slice(ROUTINE.length)
}

/** Whether a key names a variable of a body's run — a routine's local or parameter, a VAR_TEMP. */
export const isRunVariable = (key: string): boolean => key.startsWith(ROUTINE)

/** A variable of a frame or a run, by its name. */
export const variableIn = (context: string, name: string): string => `${context}.${name.toUpperCase()}`

/** Whether `key` names a variable of `context`. */
export const isVariableOf = (key: string, context: string): boolean => key.startsWith(`${context}.`)

/** A GVL variable. */
export const globalKey = (name: string): string => variableIn(GLOBAL_CONTEXT, name)

/** A routine's parameter (an input, a lent string, an ANY's hidden address), as its body and every call site name it. */
export const parameterKey = (routineKey: string, name: string): string => variableIn(routineContext(routineKey), name)

/** A field of an FB type, as that FB's own bodies name it. */
export const fbFieldKey = (fb: string, field: string): string => variableIn(fbContext(fb), field)

/** The FB type a frame context names — undefined for any other frame. */
export const fbOfContext = (context: string): string | undefined => (context.startsWith("FB:") ? context.slice("FB:".length) : undefined)

const TYPE = "TYPE:"

/** An FB type whose instances' data the image holds (the escape pass's answer). */
export const imagedTypeKey = (fb: string): string => `${TYPE}${fb.toUpperCase()}`

/** The FB type an escape key names — undefined for a variable's key. */
export const imagedTypeOf = (key: string): string | undefined => (key.startsWith(TYPE) ? key.slice(TYPE.length) : undefined)

/** The key under which a BOOL flow names what the POINTER TO BOOL `pointerKey` reads (`raw-bool.ts` `carried`): raw
 *  exactly when that pointer is a byte view (`bool-views.ts`). */
export const viewKey = (pointerKey: string): string => `VIEW:${pointerKey}`
