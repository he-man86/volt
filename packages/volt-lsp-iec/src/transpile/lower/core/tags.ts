/**
 * THE ONE TAG ENCODING (transpile-restructure 1.7.19) — how lowering numbers what a value may name: 0 names nothing, and
 * the k-th thing recorded (from 0) is k + 1. Three schemes number through it: a POINTER's targets (`pointers/state.ts`
 * `recordTarget`, read back by `pointers/deref.ts`), the FB instances an INTERFACE may hold (`interfaces/tags.ts`, read
 * back by `dispatch.ts`, `lend.ts`, `query.ts`), and the binding an FB's in-out was last called with (`__inout_binding`,
 * `calls/last-binding.ts`). Whether the three schemes become one is model 3's decision (tasks 4.2, 4.14); the ENCODING
 * is this file's. (An element pointer's value is its index + `ELEMENT_TAG_BIAS`, a scheme of its own — `pointers/state.ts`.)
 */

/** The tag that names nothing: a null pointer, an interface holding no instance, an in-out never bound. */
export const NO_TAG = 0

/** The tag of the `index`-th thing recorded (from 0). */
export const tagOfIndex = (index: number): number => index + 1

/** Which thing (from 0) a tag names — the inverse of `tagOfIndex`; never asked of `NO_TAG`. */
export const indexOfTag = (tag: number): number => tag - 1
