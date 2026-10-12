/**
 * THE LIBRARY REPO'S BODIES, ASKED OF CODESYS — `libraries/<library>/<version>/`, run against the real libraries.
 *
 * The repo writes each library element in ST (plc-library-runtime design §6). Standard's string functions were already
 * held to the vendor by the `str_*` recordings; everything else was a reading of the element's contract, pinned only
 * by `test/libraries/*` — what the body was MEANT to do. These ask CODESYS what it DOES, above all where the contract
 * leaves a choice the body had to make: a counter at the end of its WORD, a compare's value beyond its sign, what a
 * buffer too small to concatenate into is left holding.
 *
 * The fixture project references Standard 3.5.18.0, Util 3.5.19.0 and StringUtils 3.5.18.0 — the versions the repo
 * writes — so the replay lowers each call against the body for the version CODESYS resolved.
 *
 * TIMERS RUN ON A RECORDED CLOCK (`LanguageTest.clock`): each clocked fixture stores `TIME()` into `now[n]` on every
 * scan, beside the timer's outputs, and the replay sets the transpiler's clock to those instants — so a TON's `Q` and
 * `ET` must match CODESYS exactly although the simulator's clock is real time.
 */
import type { LanguageTest } from "../../types.js"
import { LIBRARY_BODY_TESTS_A } from "./library-bodies-a.js"
import { LIBRARY_BODY_TESTS_B } from "./library-bodies-b.js"
import { LIBRARY_BODY_TESTS_C } from "./library-bodies-c.js"

export const LIBRARY_BODY_TESTS: readonly LanguageTest[] = [...LIBRARY_BODY_TESTS_A, ...LIBRARY_BODY_TESTS_B, ...LIBRARY_BODY_TESTS_C]
