/**
 * THE TWO KINDS OF THROW A NODE'S MEANING MAKES: a FAULT the program stops on (its text from `ir/faults.ts`), and a
 * LOWERING BUG — the IR asked something lowering should have answered.
 */
import { FAULT_TEXT, type FaultKind } from "../ir/faults.js"

/**
 * A throw that means LOWERING IS WRONG, not that the program faulted — kept apart from an ordinary fault because
 * `constantValue` catches those. Caught there too, it would turn "lowering should have typed this" back into
 * "not a compile-time constant", which is the silence the throw exists to break.
 */
export class LoweringBug extends TypeError {}

/** A fault with one fixed text that stops the task — a `RangeError`, as every fault the interpreter throws is. */
export class IecFault extends RangeError {
  constructor(readonly kind: FaultKind) {
    super(FAULT_TEXT[kind])
  }
}
