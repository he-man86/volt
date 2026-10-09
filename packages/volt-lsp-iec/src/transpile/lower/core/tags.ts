/**
 * THE ONE TAG ENCODING (transpile-restructure 1.7.19) — how lowering numbers what a value may name: 0 names nothing, and
 * the k-th thing recorded (from 0) is k + 1. Three schemes number through it, each kept for one reason (4.14, design.md
 * §3.3 step 4f): the INSTANCE HANDLE — every FB instance an interface or a pointer/reference to a whole instance may
 * name, one table per POU (`interfaces/tags.ts` `instanceHandle`, read back by `dispatch.ts`, `lend.ts`, `query.ts` and
 * `pointers/deref.ts`); the residual DATA TAG — a pointer's targets the byte image cannot hold, per pointer
 * (`pointers/state.ts` `recordTarget`/`targetTag`); and the binding an FB's in-out was last called with
 * (`__inout_binding`, `calls/last-binding.ts`), which the image cannot take without every in-out target escaping. (An
 * element pointer's value is its index + `ELEMENT_TAG_BIAS`, a scheme of its own — `pointers/state.ts`.)
 */

/** The tag that names nothing: a null pointer, an interface holding no instance, an in-out never bound. */
export const NO_TAG = 0

/** The tag of the `index`-th thing recorded (from 0). */
export const tagOfIndex = (index: number): number => index + 1

/** Which thing (from 0) a tag names — the inverse of `tagOfIndex`; never asked of `NO_TAG`. */
export const indexOfTag = (tag: number): number => tag - 1
