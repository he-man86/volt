## Design (step 2): one rule, read from the declaration

**Target.** The Volt text of a member depends only on its declaration and its code. The IDE object's class and slot
do not affect it. Today one `ABSTRACT` declaration pulls three ways (1.3); after this change it pulls one way on both
vendors, whoever made the object.

**The rule.** At a member body site (METHOD, and a property's GET/SET under `PROPERTY ABSTRACT`):
`IMPLEMENTATION NONE` ⇔ no slot, OR (ABSTRACT declaration AND empty body). A body with code stays `IMPLEMENTATION ST`
and keeps its code. No code is hidden. 1.1 measured that both compilers refuse it the same way (C0433), so neither
vendor reads it differently. A non-abstract empty body stays `IMPLEMENTATION ST`, as it is today.

**Choice: one function in `Volt.Engine`, applied once where the driver's `ItemContent` crosses `ICodeStore`.** It runs
before fetch, the text writer and `BodyFormatGuard` see the content: `ImplementationMarker` folds (ABSTRACT, empty ST)
into NONE. Both drivers keep their storage fact: CODESYS's declared-and-null `Implementation` stays NONE in
`ReadBody`. Neither driver reads the declaration.
- Rejected, rule in each driver: two copies of a text rule is how this divergence began.
- Rejected, TwinCAT-only NONE: a CODESYS `POUMethodObject` (pro2193's `Cyclic`) would still pull `ST`.
- Rejected, recreating CODESYS slotted members as `AbstractPOUMethodObject`: nothing creates that class (C2n), and the
  wire does not see the class anyway.

**Push of NONE, per slot (the driver's job, below the seam).** No slot (`AbstractPOUMethodObject`,
`InterfacePropertyAccessorObject`): nothing is written, as today. With a slot (CODESYS `POUMethodObject` /
`PropertyAccessorObject`, TwinCAT 609/613/614): `""` is written. 1.2/1.3 measured that it persists across
save/reopen and pulls back unchanged. So `ImplementationMarker.Written` stops answering "skip" for NONE. Instead it
says "empty" and the driver decides the slot (`RequireSlot` stays the backstop). A pushed `IMPLEMENTATION ST` with an
empty body under ABSTRACT (a file pulled before this change) is the same content, so the same fold makes it NONE. It
is not refused.

**Now accepted:** NONE over a live slot, when the pushed declaration is ABSTRACT. Also a create, rename or retype of an
ABSTRACT member stated NONE, on both vendors. The create makes a slotted member, the empty body is written, and the
next pull reads NONE by the rule. 1.1's controls showed that an empty slotted abstract member builds clean on both.
The `RequireAuthorable` NONE refusal is removed, and so is the pro2193 migration refusal (7 owner files).

**Code under ABSTRACT (1.1: both compilers refuse it at build, C0433, and neither refuses the write).** Volt refuses
it by name before any write. That covers a create, or an update whose body differs from the live one. The refusal
names the member and the IDE's message ("must not contain any statements"). A pulled body with code pushed back
unchanged writes nothing and passes, so a project that does not compile can still push its other items.

**Stays refused, by name:**
- NONE under a declaration without ABSTRACT. The line says abstract and the declaration says concrete. The fix is
  `IMPLEMENTATION ST`.
- Dropping ABSTRACT over a slotless member (C2l: the IDE keeps it abstract whatever the text). The existing
  delete-then-add route stays. This refusal is about the IDE object, not a text difference, and it names the IDE, not
  a vendor.
- A body over a slotless member (unchanged).

**Wire-parity review.** For the same declaration and code, both vendors now produce identical text for the method, the
GET and the SET, whatever made the object. What remains invisible on the wire is the CODESYS class (`Abstract…` vs
slotted). It builds the same and is already listed as kept-not-recreated in C2n. No divergence is left for owner
review. DIALECT C2n gets rewritten to say so.

**Migration.** Re-pull. TwinCAT abstract members change from `IMPLEMENTATION ST` to `NONE`. On CODESYS only pro2193's
`Cyclic` changes (3.3 checks exactly that). Stale files still push, because of the fold. The LSP already reads NONE.
