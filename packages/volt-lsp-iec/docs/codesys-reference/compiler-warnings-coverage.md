# CODESYS "Compiler warnings" — coverage in Volt

Every code in the CODESYS project-settings **Compiler warnings** dialog, and whether Volt implements a 3-state
control (off/warning/error) for it. Implemented codes get a `volt.iec.diagnostics.<code>` setting; the rest are
documented here as gaps (no control yet — Volt emits no diagnostic to configure).

| CODESYS | Volt status | our code / setting | description |
|---|---|---|---|
| C0033 | ✅ **3-state setting** | `pointer-not-convertible` | unsafe pointer conversion warning |
| C0100 | ⬜ absent | — | (not in catalog) |
| C0118 | ✅ **3-state setting** | `jump-label-unreferenced` | unused jump label |
| C0125 | ⬜ checkable | — | duplicate enum value |
| C0139 | ✅ **3-state setting** | `no-op-statement` | no-op statement warning |
| C0187 | ⬜ checkable | — | external reference on program |
| C0195 | ✅ **3-state setting** | `sign-change-conversion` | signed-to-unsigned conversion |
| C0196 | ✅ **3-state setting** | `sign-change-conversion` | unsigned-to-signed conversion |
| C0197 | ✅ **3-state setting** | `narrowing-conversion` | lossy implicit conversion |
| C0198 | ✅ **3-state setting** | `string-constant-too-long` | string constant too long |
| C0200 | ⬜ absent | — | (not in catalog) |
| C0209 | ⬜ ide-only | — | Too many applications for device |
| C0210 | ⬜ absent | — | (not in catalog) |
| C0220 | ⬜ absent | — | (not in catalog) |
| C0223 | ⬜ absent | — | (not in catalog) |
| C0228 | ✅ **3-state setting** | `constant-no-initial-value` | missing constant initializer |
| C0245 | ⬜ absent | — | (not in catalog) |
| C0266 | ✅ **3-state setting** | `loop-exit-constant` | constant-false loop condition |
| C0269 | ⬜ checkable | — | pointer reinit virtual dispatch risk |
| C0298 | ⬜ checkable | — | stack usage undecidable |
| C0308 | ⬜ absent | — | (not in catalog) |
| C0312 | ⬜ absent | — | (not in catalog) |
| C0315 | ⬜ absent | — | (not in catalog) |
| C0316 | ⬜ checkable | — | redundant implicit lifecycle call |
| C0325 | ⬜ absent | — | (not in catalog) |
| C0327 | ⬜ absent | — | (not in catalog) |
| C0335 | ⬜ absent | — | (not in catalog) |
| C0339 | ⬜ absent | — | (not in catalog) |
| C0344 | ⬜ checkable | — | unsupported monitoring attribute value |
| C0349 | ⬜ absent | — | (not in catalog) |
| C0350 | ⬜ absent | — | (not in catalog) |
| C0351 | ✅ **3-state setting** | `unknown-attribute` | unknown attribute pragma |
| C0354 | ✅ **3-state setting** | `enum-comparison` | enum comparison |
| C0355 | ✅ **3-state setting** | `adr-on-bit` | bit addressing |
| C0357 | ⬜ checkable | — | obsolete POU usage |
| C0370 | ⬜ absent | — | (not in catalog) |
| C0371 | ✅ **3-state setting** | `inout-own-access` | VAR_IN_OUT scoping |
| C0373 | ✅ **3-state setting** | `message-pragma-warning` | user-defined pragma warning |
| C0388 | ⬜ absent | — | (not in catalog) |
| C0389 | ⬜ absent | — | (not in catalog) |
| C0394 | ⬜ absent | — | (not in catalog) |
| C0404 | ⬜ absent | — | (not in catalog) |
| C0406 | ⬜ ide-only | — | check-function name collision |
| C0410 | ⬜ absent | — | (not in catalog) |
| C0421 | ✅ **3-state setting** | `interface-implements` | interface inheritance keyword |
| C0422 | ⬜ absent | — | (not in catalog) |
| C0426 | ⬜ checkable | — | empty CASE label |
| C0441 | ✅ **3-state setting** | `inout-in-initializer` | VAR_IN_OUT default-value misuse |
| C0447 | ⬜ absent | — | (not in catalog) |
| C0508 | ⬜ checkable | — | variable/action name collision |
| C0513 | ⬜ ide-only | — | private property access |
| C0514 | ⬜ ide-only | — | internal property access |
| C0515 | ⬜ ide-only | — | protected property access |
| C0516 | ⬜ ide-only | — | internal variable access |
| C0517 | ⬜ ide-only | — | internal object access via SIZEOF |
| C0522 | ⬜ absent | — | (not in catalog) |
| C0525 | ✅ **3-state setting** | `input-default-composite` | invalid default on input parameter |
| C0526 | ✅ **3-state setting** | `default-not-constant` | non-constant default value |
| C0527 | ⬜ absent | — | (not in catalog) |
| C0533 | ✅ **3-state setting** | `abstract-output-default` | unused output default in abstract method |
| C0540 | ⬜ checkable | — | missing no_assign attribute propagation |
| C0542 | ✅ **3-state setting** | `union-inheritance` | invalid UNION inheritance |
| C0543 | ⬜ checkable | — | reserved keyword used as identifier |
| C0555 | ⬜ checkable | — | string literal encoding |
| C0561 | ⬜ checkable | — | recursive call warning |
| C0564 | ⬜ checkable | — | initialization order |

**20 of 66** dialog codes have a control. The other **46** are gaps — see the plan below.

## Closing the gaps

### Closeable — a check Volt can write headless (14)

Understood codes with no check yet. Each becomes a `CONFIGURABLE_CHECKS` entry + a `volt.iec.diagnostics.<code>`
setting once written. Discovery cadence is the corpus ratchet (`scripts/lsp-vs-compiler.ts`).

| CODESYS | what it flags |
|---|---|
| C0125 | duplicate enum value |
| C0187 | external reference on program |
| C0269 | pointer reinit virtual dispatch risk |
| C0298 | stack usage undecidable |
| C0316 | redundant implicit lifecycle call |
| C0344 | unsupported monitoring attribute value |
| C0357 | obsolete POU usage |
| C0426 | empty CASE label |
| C0508 | variable/action name collision |
| C0540 | missing no_assign attribute propagation |
| C0543 | reserved keyword used as identifier |
| C0555 | string literal encoding |
| C0561 | recursive call warning |
| C0564 | initialization order |

### Cannot close headless — documented reasons (7)

These need IDE/device/library metadata that a headless bridge does not have, so Volt cannot reproduce them
offline. Not gaps to close — gaps to acknowledge.

| CODESYS | what it flags | why Volt cannot |
|---|---|---|
| C0209 | Too many applications for device | Needs the device repository / compiler-version metadata (installed devices, withdrawn versions, AddOns). |
| C0406 | check-function name collision | Needs resolved referenced-library metadata (access modifiers, implicit check functions, cross-library namespaces) — the library floor. |
| C0513 | private property access | Needs resolved referenced-library metadata (access modifiers, implicit check functions, cross-library namespaces) — the library floor. |
| C0514 | internal property access | Needs resolved referenced-library metadata (access modifiers, implicit check functions, cross-library namespaces) — the library floor. |
| C0515 | protected property access | Needs resolved referenced-library metadata (access modifiers, implicit check functions, cross-library namespaces) — the library floor. |
| C0516 | internal variable access | Needs resolved referenced-library metadata (access modifiers, implicit check functions, cross-library namespaces) — the library floor. |
| C0517 | internal object access via SIZEOF | Needs resolved referenced-library metadata (access modifiers, implicit check functions, cross-library namespaces) — the library floor. |

### Not yet catalogued (25)

Dialog codes with no catalog entry — the CODESYS message/trigger is not yet recorded, so we cannot even decide
checkable-vs-ide-only. Step one is to record each from live CODESYS (`scripts/verify-catalog.ts` against the
headless bridge), then it moves to one of the two lists above.

`C0100`, `C0200`, `C0210`, `C0220`, `C0223`, `C0245`, `C0308`, `C0312`, `C0315`, `C0325`, `C0327`, `C0335`, `C0339`, `C0349`, `C0350`, `C0370`, `C0388`, `C0389`, `C0394`, `C0404`, `C0410`, `C0422`, `C0447`, `C0522`, `C0527`
