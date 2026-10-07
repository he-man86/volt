/**
 * THE VALUE MODEL — what an IR node means on values: store (`fit`), convert, arithmetic, builtins, text, the string
 * buffer, the IR constant fold, a fresh value of a type. Lowering's fold and the interpreter run it; the Rust runtime
 * mirrors it (design.md P3). The emitter may not import it (layering rule 4): a printer that can evaluate starts
 * deciding things.
 */
export * from "./value.js"
export * from "./store.js"
export * from "./convert.js"
export * from "./parse.js"
export * from "./text.js"
export * from "./string.js"
export * from "./arith.js"
export * from "./math.js"
export * from "./builtins.js"
export * from "./operators.js"
export * from "./fold.js"
export * from "./instantiate.js"
export * from "./faults.js"
