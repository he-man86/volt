/**
 * The lowering frame's shared type aliases: an FB type, and the symbol a routine is lowered from. (The `Lowering` frame
 * itself joins them in 1.6.21.)
 */

import type { Type } from "../../../frontend/types/index.js"
import type { lookup } from "../../../frontend/symbols/index.js"

export type FbType = Extract<Type, { kind: "function_block" }>

export type RoutineSymbol = NonNullable<ReturnType<typeof lookup>>["symbol"]
