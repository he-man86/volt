> Superseded 2026-10-30: the current network-text spelling is packages/volt-cli/docs/network-text.html.

# Tasks

Run `bun run scripts/e2e-graphical-coverage.ts` before and after: the gap list is the task list, and it is the
thing that says when this is done.

## 1. The two shapes that already cost something

- [x] An EMPTY network (a marker straight to `END_NETWORK`) round-trips, or is refused by name. Both vendors.
      This is half of `ladderLabel.prg`, and PLCopen has no network element to state it with (D25) — so a named
      refusal is a legitimate outcome and silence is not.
- [x] An UNDRIVEN coil (`x := ;`) round-trips. It reads back as the TERMINATOR the archive holds rather than a
      null, which `NetworkTextReader` already models — what is untested is creating one.

## 2. The three nothing has ever pushed

- [x] A RESET coil (`out R= a;`). `S=` is covered three times over; `R=` never, and this is the construct whose
      misread inverted 128 coils in one project. Assert the round trip AND the build.
- [x] A RISING-edge modifier on a consumed operand.
- [x] A FALLING-edge modifier on a consumed operand.

## 3. Keep the report honest

- [x] Re-run the coverage report: **25 of 25**, 0 gaps.
- [x] Any construct added to `docs/network-text.md` later appears as a gap until it is pushed — which is how
      the five above were found in the first place, so the mechanism is demonstrated rather than rehearsed.

## 4. What the run measured

- **CODESYS: all five round-trip**, empty network included.
- **TwinCAT: the empty network is REFUSED BY NAME** ("the number of networks changes (1 -> 2), which Volt cannot
  do through the archive"), which is the correct outcome — PLCopen has no network element to state one with.
- One assertion of mine was wrong and is corrected rather than worked around: a created fan-out's wire came back
  as `g1` where the push said `g0`. A minted wire is named `g<VarId>` from the id the VENDOR assigns, so a
  CREATE cannot pre-determine it; `fanout.test.ts` already encodes that with `/LET g\d+/`. The test now asserts
  what the format actually promises — each coil keeps its own storage, both read the same wire, and the second
  push is a fixed point.
