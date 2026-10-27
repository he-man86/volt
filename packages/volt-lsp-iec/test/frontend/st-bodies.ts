/**
 * THE BODIES THE FRONT-END MEASUREMENTS READ: ST bodies, held to the vendor's ST recordings. A plain-ST network body
 * (openspec network-text-st) is read by the ST front-end too, but it is network text — its boxes are calls ST has no
 * call form for, its wires are its network's — and its own oracles hold it: the case set (`_plain-st.test.ts`), the
 * corpus gate and the corpora's exec twins (`test/corpus/corpus-twins.test.ts`).
 */
import { type BodySpan, isPlainStNetworkBody, isStBody } from "../../src/frontend/syntax/index.js"

export const measuredStBody = (body: BodySpan): boolean => isStBody(body) && !isPlainStNetworkBody(body)
