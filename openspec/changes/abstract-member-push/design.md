## Design: no body slot vs empty body (2.1)

**Target.** A member's text says which of three things the IDE holds, on both vendors: a body (`IMPLEMENTATION ST` +
code), an EMPTY body (`IMPLEMENTATION ST`, nothing under it), or NO body slot. The push sends `""` for the second and
null ("leave the IDE alone", as for an UNSUPPORTED body) for the third, so `RequireSlot` (D26) never sees a body at a
slot the object lacks.

**Choice: a stated line, `IMPLEMENTATION NONE`** — "this member has no implementation", alone on the line, nothing
under it. It is written only where the driver read NO slot (CODESYS: `Implementation` aspect missing —
`AbstractPOUMethodObject`, and the abstract property's `InterfacePropertyAccessorObject` GET). Absence of the slot is a
vendor-OBJECT fact, so the driver states it and the text carries it; no keyword in the declaration decides it.

Rejected, one line each:
- **ABSTRACT decides** — measured wrong on TwinCAT: an abstract method and GET HAVE a slot (`""`) and accept a pushed
  body (1.1, `abstract-member-slot`); on CODESYS a `POUMethodObject` with ABSTRACT text is abstract too (C2n) and has one.
- **No line under a slotless member** — absence would carry meaning: a member that LOST its line (a stale or hand-edited
  file) would read as "no slot" instead of being refused (`StReader.Unmarked`, the LSP's same report); "the line decides".
- **Bare `IMPLEMENTATION`** — today that is the named lookalike "states no language"; giving it a meaning drops that hint.
- **Driver drops `""` at a missing slot** — D26 refused exactly this ("the producer is fixed, not a driver table"); it
  would also swallow code an engineer writes under an abstract member.

**Producer.** `CodesysDriver.ReadBody` stops folding two facts into null: no `Implementation` aspect → no-slot; an empty
or whitespace ST body → `""` (today `BodyText` maps it to null). `StWriter` writes `IMPLEMENTATION NONE` for a no-slot
member/accessor and `IMPLEMENTATION ST` for `""` — the written text of every empty body is unchanged, and versions hash
the written text (`Versioning` → `Materializer`), so no other item drifts. TwinCAT reads `ImplementationText ?? ""`
(`TcObjectModel.cs:512`) and keeps writing `IMPLEMENTATION ST`; 3.2 records the fetched TwinCAT text (a `vendor-facts`
key) before that is relied on. `ImplementationMarker` owns the spelling (`Parse`, `Written` → null, `Canonical`).

**LSP: yes, the parser changes** — `frontend/syntax/format/implementation-line.ts` mirrors the grammar: `NONE` is a
boundary line whose body neither parser reads (as UNSUPPORTED), and code under it is reported as the push refuses it.

**Stays refused by name:** code under `IMPLEMENTATION NONE` (no slot to write it to — the reader, like code under an
UNSUPPORTED line); `IMPLEMENTATION ST` + code at a slotless member (`RequireSlot`, D26 — removing ABSTRACT is a re-type,
C2q); `NONE` as a vendor language (`VendorLanguage`, 0 in the corpora). Not refused, stated: `NONE` typed over a member
that HAS a body travels as null like UNSUPPORTED (the wire has no third value), so the IDE body is kept and the next pull
shows it.

**Migration.** A re-pull rewrites only the abstract members of pro2193 (12 texts, 7 owner files) from `IMPLEMENTATION ST`
to `IMPLEMENTATION NONE`; a corpus or workspace pull that changes any other file is a finding. A workspace not re-pulled
keeps today's refusal, whose message gains "run `volt pull`". Docs: `ImplementationMarker` summary, DIALECT C2n,
`docs/network-text.html` (the line list), the LSP's format notes.
