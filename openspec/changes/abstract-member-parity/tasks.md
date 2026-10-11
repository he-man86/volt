## 1. Measure (vendor-facts rows, never a probe script)

- [ ] 1.1 Both compilers on an ABSTRACT METHOD / abstract PROPERTY accessor that HOLDS code (CODESYS SP21 via a
      `POUMethodObject` with ABSTRACT text; TwinCAT via its slot): does the build refuse it? Record the message.
- [ ] 1.2 TwinCAT: the fetched wire text of an abstract member today (the inferred `IMPLEMENTATION ST`, now recorded),
      and persistence of an empty body written at its slot across save/reopen.
- [ ] 1.3 CODESYS: a script-made ABSTRACT method (`create_method` + ABSTRACT text) — its class and slot, and what the
      pull writes today.

## 2. Design

- [ ] 2.1 design.md: the declaration rule (ABSTRACT + no code ⇒ NONE), the push per slot, the creates/renames/retypes it
      now accepts, the code-under-ABSTRACT outcome from 1.1, and the refusals that stay; reviewed against the wire-parity
      rule (identical text for the same declaration on both vendors).

## 3. Fix

- [ ] 3.1 Red tests first: the vendor-parity suite (an abstract method and an abstract property on both bridges pull
      byte-identical text), a CODESYS and a TwinCAT driver test each, the migration case (pro2193-shaped NONE owner
      created into a blank TwinCAT and CODESYS project).
- [ ] 3.2 The fix: the read rule in both drivers, NONE's push per slot, `BodyFormatGuard` (creates/renames/retypes
      accepted; a body under ABSTRACT handled per 1.1), DIALECT C2n rewritten (no divergence left), vendor-facts rows.
- [ ] 3.3 Live: e2e on CODESYS SP21 and TwinCAT (both up, so the vendor-parity suite runs), re-pull pro2193 and check
      exactly its abstract members change; full e2e on both vendors green.
