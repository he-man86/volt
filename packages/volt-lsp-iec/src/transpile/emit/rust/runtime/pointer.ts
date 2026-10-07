/** The pointer helpers the emitted code calls (model 3 may add more). */
import { rustFaultLiteral } from "../../../ir/faults.js"

/** The one check every dereference makes: a null pointer stops the program, as it stops the CODESYS application. */
export const IEC_DEREF = `fn iec_deref(at: usize) { if at == 0 { panic!(${rustFaultLiteral("null-dereference")}); } }
`
