# CODESYS "Compiler warnings" — coverage in Volt

Every code in the CODESYS project-settings **Compiler warnings** dialog, and whether Volt implements a 3-state
control (off/warning/error) for it. Implemented codes get a `volt.iec.diagnostics.<code>` setting; the rest are
documented here as gaps, each with the concrete reason it isn't a setting yet.

| CODESYS | Volt status | our code / setting | description |
|---|---|---|---|
| C0033 | ✅ **3-state setting** | `pointer-not-convertible` | unsafe pointer conversion warning |
| C0100 | ⬜ absent | — | — |
| C0118 | ✅ **3-state setting** | `jump-label-unreferenced` | unused jump label |
| C0125 | ⬜ wont-fix | — | duplicate enum value |
| C0139 | ✅ **3-state setting** | `no-op-statement` | no-op statement warning |
| C0187 | ⬜ needs-live-verify | — | external reference on program |
| C0195 | ✅ **3-state setting** | `sign-change-conversion` | signed-to-unsigned conversion |
| C0196 | ✅ **3-state setting** | `sign-change-conversion` | unsigned-to-signed conversion |
| C0197 | ✅ **3-state setting** | `narrowing-conversion` | lossy implicit conversion |
| C0198 | ✅ **3-state setting** | `string-constant-too-long` | string constant too long |
| C0200 | ⬜ absent | — | — |
| C0209 | ⬜ ide-only | — | Too many applications for device |
| C0210 | ⬜ absent | — | — |
| C0220 | ⬜ absent | — | — |
| C0223 | ⬜ absent | — | — |
| C0228 | ✅ **3-state setting** | `constant-no-initial-value` | missing constant initializer |
| C0245 | ⬜ absent | — | — |
| C0266 | ✅ **3-state setting** | `loop-exit-constant` | constant-false loop condition |
| C0269 | ⬜ ide-only | — | pointer reinit virtual dispatch risk |
| C0298 | ⬜ ide-only | — | stack usage undecidable |
| C0308 | ⬜ absent | — | — |
| C0312 | ⬜ absent | — | — |
| C0315 | ⬜ absent | — | — |
| C0316 | ⬜ wont-fix | — | redundant implicit lifecycle call |
| C0325 | ⬜ absent | — | — |
| C0327 | ⬜ absent | — | — |
| C0335 | ⬜ absent | — | — |
| C0339 | ⬜ absent | — | — |
| C0344 | ⬜ ide-only | — | unsupported monitoring attribute value |
| C0349 | ⬜ absent | — | — |
| C0350 | ⬜ absent | — | — |
| C0351 | ✅ **3-state setting** | `unknown-attribute` | unknown attribute pragma |
| C0354 | ✅ **3-state setting** | `enum-comparison` | enum comparison |
| C0355 | ✅ **3-state setting** | `adr-on-bit` | bit addressing |
| C0357 | ⬜ needs-live-verify | — | obsolete POU usage |
| C0370 | ⬜ absent | — | — |
| C0371 | ✅ **3-state setting** | `inout-own-access` | VAR_IN_OUT scoping |
| C0373 | ✅ **3-state setting** | `message-pragma-warning` | user-defined pragma warning |
| C0388 | ⬜ absent | — | — |
| C0389 | ⬜ absent | — | — |
| C0394 | ⬜ absent | — | — |
| C0404 | ⬜ absent | — | — |
| C0406 | ⬜ ide-only | — | check-function name collision |
| C0410 | ⬜ absent | — | — |
| C0421 | ✅ **3-state setting** | `interface-implements` | interface inheritance keyword |
| C0422 | ⬜ absent | — | — |
| C0426 | ⬜ wont-fix | — | empty CASE label |
| C0441 | ✅ **3-state setting** | `inout-in-initializer` | VAR_IN_OUT default-value misuse |
| C0447 | ⬜ absent | — | — |
| C0508 | ⬜ blocked | — | variable/action name collision |
| C0513 | ⬜ ide-only | — | private property access |
| C0514 | ⬜ ide-only | — | internal property access |
| C0515 | ⬜ ide-only | — | protected property access |
| C0516 | ⬜ ide-only | — | internal variable access |
| C0517 | ⬜ ide-only | — | internal object access via SIZEOF |
| C0522 | ⬜ absent | — | — |
| C0525 | ✅ **3-state setting** | `input-default-composite` | invalid default on input parameter |
| C0526 | ✅ **3-state setting** | `default-not-constant` | non-constant default value |
| C0527 | ⬜ absent | — | — |
| C0533 | ✅ **3-state setting** | `abstract-output-default` | unused output default in abstract method |
| C0540 | ⬜ needs-live-verify | — | missing no_assign attribute propagation |
| C0542 | ✅ **3-state setting** | `union-inheritance` | invalid UNION inheritance |
| C0543 | ⬜ needs-live-verify | — | reserved keyword used as identifier |
| C0555 | ⬜ ide-only | — | string literal encoding |
| C0561 | ⬜ needs-live-verify | — | recursive call warning |
| C0564 | ⬜ needs-live-verify | — | initialization order |

**20 of 66** dialog codes have a control. The other **46** are gaps — grouped by why below.

## Closing the gaps

None of the open dialog codes can be shipped as a clean offline check today: each is blocked on IDE build data,
a proven false-positive surface, an architectural limit, or unverified triggers. The corpus (real IDE-clean
projects) is the arbiter — a check that fires on it is a false positive, not a finding.

### Needs live-CODESYS verification before it can ship (6)

Offline-feasible in principle, but the exact trigger/wording is unverified (`verified:false`) and/or needs
infrastructure the pipeline lacks. Writing them blind would ship unverified wording or false positives. Path to
close: record each against the headless CODESYS bridge (`scripts/verify-catalog.ts`), then implement + corpus-gate.

| CODESYS | what it flags | blocker |
|---|---|---|
| C0187 | external reference on program | Needs live-CODESYS verification of the exact trigger (external attribute on a PROGRAM) and wording; attributes are parser trivia, so token-level correlation is required. Near-zero real surface. |
| C0357 | obsolete POU usage | Offline-feasible but needs {attribute 'obsolete'} + project-wide reference resolution + attribute plumbing the pipeline lacks; obsolete markers live in library metadata and the corpus has zero surface. Verify triggers against live CODESYS first. |
| C0540 | missing no_assign attribute propagation | Resolution-dependent (no_assign attribute propagation across the type graph); needs live-CODESYS verification and has real FP surface. |
| C0543 | reserved keyword used as identifier | Needs CODESYS's exact soft-reserved-keyword list (unpublished); guessing it would false-positive on valid identifiers. The parser already recovers on hard keywords. |
| C0561 | recursive call warning | The hard function self-recursion error (C0224) already ships; C0561 is the configurable-warning variant whose trigger boundary vs C0224 (indirect cycles / method / FB recursion) is unverified. Needs a project-wide call graph + live-CODESYS verification. Zero corpus surface. |
| C0564 | initialization order | Intra-declaration init-order dataflow; low real-world surface. Revisit with the overload work. |

### Needs IDE build/runtime data — cannot be done offline (11)

These need device/library metadata, codegen, memory layout, or a project option that a headless bridge does not
have. The IDE build stays authoritative. Not gaps to close — gaps to acknowledge.

| CODESYS | what it flags | why Volt cannot |
|---|---|---|
| C0209 | Too many applications for device | Needs the device repository / compiler-version metadata (installed devices, withdrawn versions, AddOns). |
| C0269 | pointer reinit virtual dispatch risk | Virtual-dispatch FB reinitialization is a codegen/memory-layout concern — not decidable from offline source. |
| C0298 | stack usage undecidable | Stack-usage calculation is a build-time computation over the full resolved call tree. |
| C0344 | unsupported monitoring attribute value | Whether a property supports a monitoring-attribute value is a build/runtime fact, not present in source. |
| C0406 | check-function name collision | Needs resolved referenced-library metadata (access modifiers, implicit check functions, cross-library namespaces) — the library floor. |
| C0513 | private property access | Needs resolved referenced-library metadata (access modifiers, implicit check functions, cross-library namespaces) — the library floor. |
| C0514 | internal property access | Needs resolved referenced-library metadata (access modifiers, implicit check functions, cross-library namespaces) — the library floor. |
| C0515 | protected property access | Needs resolved referenced-library metadata (access modifiers, implicit check functions, cross-library namespaces) — the library floor. |
| C0516 | internal variable access | Needs resolved referenced-library metadata (access modifiers, implicit check functions, cross-library namespaces) — the library floor. |
| C0517 | internal object access via SIZEOF | Needs resolved referenced-library metadata (access modifiers, implicit check functions, cross-library namespaces) — the library floor. |
| C0555 | string literal encoding | Gated on the project option 'UTF-8 encoding for STRING' (not in source) and advisory; not decidable offline. |

### Won't-fix — would false-positive on legal code (3)

Offline-decidable, but the trigger fires on code CODESYS accepts. Proven against the corpus / live IDE.

| CODESYS | what it flags | why not |
|---|---|---|
| C0125 | duplicate enum value | CODESYS accepts duplicate enum values by default — proven 5+ corpus FPs (TYPECLASS/BUS_TYPE/DEVICE_TYPE sentinel aliases). Only fires under an unseen strict-enums option. |
| C0316 | redundant implicit lifecycle call | Base-chaining SUPER^.FB_Init(...) builds clean in the live IDE (2026-07-11); an offline 'already called implicitly' check false-positives on legitimate overrides. |
| C0426 | empty CASE label | Locked won't-fix with a test in case-labels: consecutive empty CASE labels are legal fall-through; flagging an empty arm false-positives on real code. |

### Blocked by architecture (1)

| CODESYS | what it flags | blocker |
|---|---|---|
| C0508 | variable/action name collision | The one-item-per-file binder can't associate a standalone action with its host FB, so the local-var/action name collision is invisible offline. Zero corpus surface. |

### Not yet catalogued (25)

Dialog codes with no catalog entry — the CODESYS message/trigger is not yet recorded, so checkable-vs-ide-only
can't even be decided. Step one is to record each from live CODESYS (`scripts/verify-catalog.ts`), then it moves
to one of the groups above.

`C0100`, `C0200`, `C0210`, `C0220`, `C0223`, `C0245`, `C0308`, `C0312`, `C0315`, `C0325`, `C0327`, `C0335`, `C0339`, `C0349`, `C0350`, `C0370`, `C0388`, `C0389`, `C0394`, `C0404`, `C0410`, `C0422`, `C0447`, `C0522`, `C0527`
