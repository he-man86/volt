## Why

**The bridge does not check the CODE** (owner, 2026-09-29). A top-level item's kind is its wire name's extension. Its
text is written as sent. Anything wrong in it is the IDE's compile error, and the LSP reports the same thing the IDE
build does. The bridge reads text only where it must to PERFORM the write:

- split a declaration from its body at the `IMPLEMENTATION` line;
- find and delimit child elements (METHOD, ACTION, PROPERTY with GET/SET, interface members);
- read network text for an LD/FBD body, because the NWL model has to be built from it.

`push-without-header-check` removed the example of what must not exist: `INVALID_CODE_HEADER` / "No header line
found", which refused a DUT whose comment was never closed and took a 12-op batch with it. **This change runs after
it** and does not repeat it. It asks the same question of EVERY other refusal the bridges and the engine raise:
push, pull, and the vendor drivers. Each one is either a condition of the write (keep), a check on the code (remove,
and let the build and the LSP answer), mis-coded or misplaced (change), or a vendor fact nobody has measured
(measure).

The review also found design issues of the same family: text parsed where the extension or the IDE already answers,
one rule implemented in two or three places, guesses and fallbacks that hide a missing fact, and vendor facts above
the seam. They are listed below with the refusals they produce.

## The rule

1. A refusal is allowed only if the write **cannot be performed as sent**: there is no split, no child identity, no
   NWL model, no vendor slot to hold the value, or writing it would silently drop or change what the text says.
2. A refusal whose only reason is "the IDE would report this as a compile error" is a **code check** and goes. The
   IDE's recorded build error replaces it, and the LSP reports the same message on the same line.
3. **Canonical form is not a refusal.** A complete, writable model is written; the canonical text comes back on the
   next pull (or in the push response). Layout-only differences are already compared layout-free.
4. The **code matches the category**: a malformed request is `BAD_REQUEST`, a stale version `STALE_ITEM_VERSION`,
   a vendor limit `UNSUPPORTED`, a Volt bug `INTERNAL_ERROR`. A client branches on the code.
5. **No fallback kind.** Where the IDE or the extension cannot answer, the item is refused or listed unreadable by
   name; it is never defaulted to FUNCTION_BLOCK or METHOD.

## The census

193 refusal sites (some rows group one refusal family at the lines listed), paths relative to
`packages/volt-cli/src/`. `E/` = `Volt.Engine/`, `C/` = `Volt.Ide.Codesys/`, `T/` = `Volt.Ide.Twincat/`.

| Category | Keep | Change | Remove | Measure | Total |
|---|---:|---:|---:|---:|---:|
| needed-to-write | 45 | 6 | 0 | 1 | 52 |
| code-check | 0 | 11 | 5 | 2 | 18 |
| version-or-conflict-gate | 14 | 3 | 0 | 0 | 17 |
| internal-invariant | 33 | 9 | 0 | 0 | 42 |
| vendor-limit | 36 | 6 | 0 | 5 | 47 |
| request-shape | 9 | 0 | 0 | 0 | 9 |
| connection-state | 7 | 0 | 0 | 0 | 7 |
| unclear | 0 | 0 | 0 | 1 | 1 |
| **Total** | **144** | **35** | **5** | **9** | **193** |

### REMOVE — code checks (5)

| Site | Code | Category | Why it goes |
|---|---|---|---|
| `E/Format/St/StReader.cs:460` | INVALID_ST | code-check | `IMPLEMENTATION ST` whose body sniffs as network text. The line states ST; the body is written as sent; the build reports the unexpected `NETWORK`/`END_NETWORK` token. |
| `E/Format/St/StReader.cs:489` | INVALID_ST | code-check | `RefuseReservedNames`: any code use of the identifier `IMPLEMENTATION` (a variable, an enum value, `x := implementation;`). None can be misread as a boundary; the split's own refusals (386, 525) own those lines. The IDE compiles it clean. |
| `E/Format/Network/NetworkTextReader.cs:1003` | NETWORK_BAD_EXPRESSION | code-check | A bare `gN` no VAR_TEMP declares is a variable operand (a Leaf). "Undeclared" is the build's error. Also false-refuses real variables the regex scope misses (`g5 AT %IX0.0 : BOOL;`). |
| `E/Sync/Materializer.cs:37` | UNSUPPORTED (item unreadable) | code-check | Pull refuses an IDE text holding a `(* @volt-… *)` comment, for every source kind. A comment is a comment; a DUT/GVL holding one is pushable but never pullable. |
| `C/Ide/CodesysNetworkWriter.cs:163` | UNSUPPORTED | code-check | `.ENO` on a box with no EN. Volt can build it; CODESYS's build reports "Missing EN pin" itself. |

### CHANGE (35)

| Site | Code | Category | Change |
|---|---|---|---|
| `E/Format/St/StReader.cs:123` | INVALID_ST | version-or-conflict-gate | Retired `(* @volt-…` scan over the whole text refuses a current file with such a comment in an ST body. Fold the hint into Unmarked (734), only when no boundary line exists. |
| `E/Format/St/StReader.cs:333` | INVALID_ST | internal-invariant | Unexpected composite kind is a caller bug: `INTERNAL_ERROR` / `ArgumentException`, not the engineer's text. |
| `E/Format/St/StReader.cs:464` | INVALID_ST | needed-to-write | `IMPLEMENTATION LD/FBD` whose body is not network text: a sniffed copy of `NetworkTextReader:189`. Delete; the network reader answers with line and `NETWORK_PARSE`. |
| `E/Format/St/StReader.cs:795` | INVALID_ST | code-check | Nothing after `:` in a METHOD/PROPERTY signature. A declaration error for the build, except the TwinCAT interface-member create seed: move that to the TwinCAT driver. |
| `E/Format/St/StReader.cs:805` | INVALID_ST | code-check | Hard-coded access-modifier vocabulary. Take the name as the last word before `:` and pass the line through (after measure of `METHOD FOO Bar`). |
| `E/Format/St/StReader.cs:852` | INVALID_ST | code-check | "A property must declare a type": the build's error for a POU property; the TwinCAT interface seed goes to the driver (as 795). |
| `E/Format/Network/NetworkTextReader.cs:285` | NETWORK_BAD_EXPRESSION | code-check | Second / late VAR_TEMP block is layout; the model builds the same. Canonicalize, do not refuse. |
| `E/Format/Network/NetworkTextReader.cs:292` | NETWORK_BAD_EXPRESSION | code-check | Wire declared and never defined: a lint; no Demux, the model is complete. Drop it on write. |
| `E/Format/Network/NetworkTextReader.cs:330` | NETWORK_BAD_EXPRESSION | code-check | Empty VAR_TEMP block: layout only. |
| `E/Format/Network/NetworkTextReader.cs:362` | NETWORK_DUPLICATE_NAME | code-check | Wire `gN` beside a variable `GN`: no conflict in the IDE (wires are VarIds), wires resolve first in the text. Writer naming choice, and it rests on the regex scope. |
| `E/Format/Network/NetworkTextReader.cs:1015` | NETWORK_DUPLICATE_NAME | code-check | Same canonical-naming rule as 362. |
| `E/Format/Network/NetworkTextGate.cs:88` | NETWORK_NOT_CANONICAL | code-check | A complete, writable model refused for token order/spelling. Write it; return the canonical text. |
| `E/Format/Task/TaskDescriptorFormat.cs:117` | TaskDescriptorException → INTERNAL_ERROR | code-check | Same as 88 for `.task`; and it wears INTERNAL_ERROR. |
| `E/Sync/PushService.cs:435` | BAD_REQUEST | version-or-conflict-gate | Last-moment ifVersion re-check: `STALE_ITEM_VERSION`; and it hashes against folder `""` for an uncached item (D16). |
| `E/Sync/PushService.cs:459` | BAD_REQUEST | version-or-conflict-gate | Same meaning on delete: `STALE_ITEM_VERSION`. |
| `E/Sync/PushService.cs:903` | BAD_REQUEST | internal-invariant | Unreachable re-derivation of the wire kind (575 already refused). Take the kind from the caller. |
| `E/Sync/PushService.cs:1369` | BAD_REQUEST | internal-invariant | Unmapped top-level kind is a Volt table gap: INTERNAL_ERROR. |
| `E/Item/ItemKind.cs:275` | BAD_REQUEST | internal-invariant | Unknown member kind is a Volt bug: INTERNAL_ERROR. |
| `E/Sync/Materializer.cs:92` | FormatException → UNREADABLE | code-check | A DUT's identity hangs on its TYPE header syntax; an accepted push of `TYPE X : END_TYPE` or an unclosed `(*` locks X out (UNREADABLE on create/update, `--force` on delete). See D1. |
| `C/Ide/CodesysNetworkWriter.cs:284` | UNSUPPORTED | internal-invariant | Unreachable from a push; v1 wording. INTERNAL_ERROR with a model-invariant message. |
| `C/Ide/CodesysNetworkWriter.cs:37` | INTERNAL_ERROR | needed-to-write | Graphical text at an item with no Implementation aspect: a named UNSUPPORTED (or never produced, D26). |
| `C/Ide/CodesysNetworkWriter.cs:51` | UNSUPPORTED | needed-to-write | FBD↔LD view change: Volt's writer gap, not a vendor limit (see measure `NetworkText.cs:148`). |
| `C/Driver/CodesysDriver.Content.cs:190` | UNSUPPORTED | vendor-limit | Unknown view mode thrown outside `NetworkText.Pulled` drops the whole POU from fetch. Materialize an UNSUPPORTED body marker. |
| `C/Driver/CodesysDriver.Content.cs:208` | UNSUPPORTED | vendor-limit | Same for an unknown body aspect. |
| `C/Ide/CodesysObjectModel.Descriptors.cs:296` | INTERNAL_ERROR | needed-to-write | Unknown `Type:` in a `.task` is a request fault: BAD_REQUEST/UNSUPPORTED like TcTaskSchedule. |
| `C/Ide/CodesysObjectModel.Libraries.cs:427` | INTERNAL_ERROR | vendor-limit | No scripting call to add an accessor later: NotSupportedException → UNSUPPORTED. |
| `T/Driver/BeckhoffDriver.Content.cs:60` | INTERNAL_ERROR / INVALID_ST | needed-to-write | `ValidateSource` re-parses with `StReader.Read` and re-derives the kind: take the engine's models (D12). |
| `T/Driver/BeckhoffDriver.Content.cs:66` | UNSUPPORTED | vendor-limit | PLCopen create refusals pre-flighted per ITEM; a new graphical member/accessor in an existing POU is not pre-flighted and fails mid-batch (D21). |
| `T/Driver/BeckhoffDriver.Content.cs:343` | UNSUPPORTED | vendor-limit | No/unknown DefaultViewMode thrown outside `Pulled` (also :359): marker, not a lost POU. |
| `T/Ide/TcNetworkWriter.cs:152` | UNSUPPORTED | internal-invariant | Unreachable (ResolveBody routes to create first): INTERNAL_ERROR. |
| `T/Ide/TcNetworkWriter.cs:165` | UNSUPPORTED | needed-to-write | FBD↔LD view change: `TcArchive.WithViewMode` already writes DefaultViewMode on create. |
| `T/Ide/TcNetworkWriter.cs:934` | UNSUPPORTED | internal-invariant | Stale "RESET has no representation" (WriteCoilBits encodes it). InvalidOperationException with CODESYS's message. |
| `T/Ide/TcPlcOpenWriter.cs:339` | UNSUPPORTED | internal-invariant | Model well-formedness breaks (also :187, :295, :328, :341, :394, :427, :477, :483, :177) blame the vendor ("cannot express as PLCopen"): INTERNAL_ERROR, Volt's bug. |
| `T/Ide/TcArchive.cs:73` | UNSUPPORTED | vendor-limit | Unknown `<root>` language thrown outside `Pulled`: marker. |
| `T/Driver/BeckhoffDriver.Tree.cs:322` | UNSUPPORTED | internal-invariant | Move post-condition failure: INTERNAL_ERROR. |

### MEASURE (9)

| Site | Code | Category | Question |
|---|---|---|---|
| `E/Format/St/StReader.cs:809` | INVALID_ST | code-check | Non-IEC / non-ASCII child name. What does `CreateChild` do on each vendor? Clean refusal → delete and map it; if the pre-flight must stay for batch atomicity, it is the vendor's measured rule. |
| `E/Format/Network/NetworkTextReader.cs:1036` | NETWORK_BAD_EXPRESSION | code-check | Declared wire type vs producer type. Does the build report a contradicting OutputTypes? Yes → remove; IDE silently keeps it → vendor-limit, keep. |
| `E/Format/Body/BodyFormatGuard.cs:164` | UNSUPPORTED | vendor-limit | Can FBD/LD → ST be written in place on either vendor? |
| `E/Format/Body/BodyFormatGuard.cs:168` | UNSUPPORTED | vendor-limit | ST → LD/FBD on an existing body; the message wrongly says graphical bodies are never created by push. |
| `E/Format/Network/NetworkText.cs:148` | UNSUPPORTED | vendor-limit | Can DefaultViewMode be set on an update on live CODESYS? (TwinCAT writes it on create.) |
| `C/Driver/CodesysDriver.Content.cs:441` | UNSUPPORTED | vendor-limit | D21 (interface accessor write crashes TcXaeShell) applied on CODESYS unmeasured. |
| `T/Driver/BeckhoffDriver.Content.cs:516` | swallowed NotSupportedException | unclear | Which refusals reach the Stamp catch on real creates? It accepts any, not only D25 regrouping. |
| `T/Ide/TcNetworkWriter.cs:166` | UNSUPPORTED | vendor-limit | TwinCAT's negation/edge order (N17 is CODESYS-only); also `TcPlcOpenWriter.cs:50`. |
| `T/Ide/TcTaskSchedule.cs:82` | BAD_REQUEST | needed-to-write | `Priority:` parsed only to keep the XML patch well-formed; XML-escape and let TwinCAT decide via the read-back? |

### KEEP (144)

Conditions of the write, format versions, conflict gates, vendor limits, invariants and connection state. None
judges the code.

| Site | Code | Category | Why |
|---|---|---|---|
| `E/Format/St/StReader.cs:111` | INVALID_ST | needed-to-write | Empty POU: no split, no language (Unmarked with its own message; may merge, D9). |
| `E/Format/St/StReader.cs:357` | INVALID_ST | needed-to-write | Missing END line: where the body ends and children begin. |
| `E/Format/St/StReader.cs:386` | INVALID_ST | needed-to-write | Two IMPLEMENTATION lines: no single split. |
| `E/Format/St/StReader.cs:734` | INVALID_ST | needed-to-write | No IMPLEMENTATION line (Unmarked, raised at 391 and for members). |
| `E/Format/St/StReader.cs:429` | INVALID_ST | needed-to-write | Code under `… UNSUPPORTED`: would be dropped. |
| `E/Format/St/StReader.cs:438` | INVALID_ST | needed-to-write | IMPLEMENTATION with no language: no write path. |
| `E/Format/St/StReader.cs:447` | INVALID_ST | version-or-conflict-gate | Retired `IMPLEMENTATION CFC` spelling (may fold into 452). |
| `E/Format/St/StReader.cs:452` | INVALID_ST | needed-to-write | Unknown language word: no reader. |
| `E/Format/St/StReader.cs:525` | INVALID_ST | needed-to-write | IMPLEMENTATION line in a boundary-less declaration: next pull could not be pushed back. |
| `E/Format/St/StReader.cs:530` | INVALID_ST | needed-to-write | Misplaced `%FOLDER` (Volt's directive) would be written as code. |
| `E/Format/St/StReader.cs:571` | INVALID_ST | needed-to-write | Text after END must open a child. |
| `E/Format/St/StReader.cs:608` | INVALID_ST | needed-to-write | Missing END_METHOD/END_ACTION: no delimiting. |
| `E/Format/St/StReader.cs:686` | INVALID_ST | needed-to-write | Missing END_PROPERTY. |
| `E/Format/St/StReader.cs:802` | INVALID_ST | needed-to-write | Child line with no name: no identity. |
| `E/Format/St/StReader.cs:843` | INVALID_ST | needed-to-write | ACTION with a return type: no aspect holds it, silently dropped. |
| `E/Format/St/ImplementationMarker.cs:233` | UNSUPPORTED | needed-to-write | Pull: IDE ST line shaped like the boundary (cost of the reserved line; note Shape also matches a bare `Implementation`, D9). |
| `E/Format/St/StWriter.cs:85` | UNSUPPORTED | internal-invariant | No END keyword for kind. |
| `E/Format/St/StWriter.cs:110` | UNSUPPORTED | internal-invariant | No END keyword for child kind. |
| `E/Format/St/CodeHelper.cs:186` | FormatException (pull) | needed-to-write | DUT subtype not stated; refuse rather than guess alias. Consequence stated in D1. |
| `E/Format/Body/BodyFormatGuard.cs:69` | UNSUPPORTED | needed-to-write | Create with a hidden body: nothing to write. |
| `E/Format/Body/BodyFormatGuard.cs:126` | UNSUPPORTED | version-or-conflict-gate | Hidden line vs other live hidden language. |
| `E/Format/Body/BodyFormatGuard.cs:142` | UNSUPPORTED | version-or-conflict-gate | Hidden line vs live network body. |
| `E/Format/Body/BodyFormatGuard.cs:154` | UNSUPPORTED | version-or-conflict-gate | Hidden line vs live ST body. |
| `E/Format/Body/BodyFormatGuard.cs:159` | UNSUPPORTED | vendor-limit | Would overwrite a live CFC/SFC/IL diagram. |
| `E/Format/Network/NetworkText.cs:294` | UNSUPPORTED | version-or-conflict-gate | Network text switched off in this build. |
| `E/Format/Network/NetworkTextReader.cs:153` | NETWORK_PARSE | version-or-conflict-gate | Network text v1 (also 173). |
| `E/Format/Network/NetworkTextReader.cs:157` | NETWORK_PARSE | needed-to-write | Language line; unreachable on push, an invariant. |
| `E/Format/Network/NetworkTextReader.cs:189` | NETWORK_PARSE | needed-to-write | Token outside a network. |
| `E/Format/Network/NetworkTextReader.cs:238` | NETWORK_PARSE | needed-to-write | Header field grammar (238-262). |
| `E/Format/Network/NetworkTextReader.cs:279` | NETWORK_NOT_CLOSED | needed-to-write | No END_NETWORK. |
| `E/Format/Network/NetworkTextReader.cs:281` | NETWORK_PARSE | vendor-limit | Trailing `//` comment: NWL has no place, would be dropped. |
| `E/Format/Network/NetworkTextReader.cs:311` | NETWORK_PARSE / BAD_EXPRESSION | needed-to-write | VAR_TEMP grammar (311, 315, 321). |
| `E/Format/Network/NetworkTextReader.cs:346` | NETWORK_BAD_EXPRESSION | needed-to-write | Wire name carries the VarId (also 355, 357, 359). |
| `E/Format/Network/NetworkTextReader.cs:384` | NETWORK_* | needed-to-write | Statement grammar (384, 410, 491, 501, 1083-1099). |
| `E/Format/Network/NetworkTextReader.cs:453` | NETWORK_* | needed-to-write | Demux shapes (453, 456, 459). |
| `E/Format/Network/NetworkTextReader.cs:961` | NETWORK_BAD_EXPRESSION | needed-to-write | Wire used before defined: item order is text order. |
| `E/Format/Network/NetworkTextReader.cs:519` | NETWORK_* | vendor-limit | Flag shapes the IDE cannot hold (519-566, 1046, 1048; N17, N20). |
| `E/Format/Network/NetworkTextReader.cs:546` | NETWORK_UNSUPPORTED | needed-to-write | Names the format cannot spell (546, 752, 772, 860); rests on the scope (D3). |
| `E/Format/Network/NetworkTextReader.cs:596` | NETWORK_* | needed-to-write | Call/operand grammar (596-633, 979, 991). |
| `E/Format/Network/NetworkTextReader.cs:651` | NETWORK_* | needed-to-write | Operator groups (651-728). |
| `E/Format/Network/NetworkTextReader.cs:764` | NETWORK_UNSUPPORTED | needed-to-write | FB instance of unknown type: BoxType must be written; rests on the scope (D3, D4). |
| `E/Format/Network/NetworkTextReader.cs:737` | NETWORK_* | needed-to-write | EN/ENO/pin rules (737-943). |
| `E/Format/Network/NetworkTextReader.cs:867` | NETWORK_* | vendor-limit | PARALLEL shape and unmeasured modes (867-906). |
| `E/Format/Network/NetworkLexer.cs:109` | NETWORK_* | needed-to-write | Lexer (109, 120, 331, 359, 372, 384, 407). |
| `E/Format/Network/NetworkTextGate.cs:64` | NETWORK_UNSUPPORTED | needed-to-write | Model the writer cannot spell: next pull would hide it. |
| `E/Format/Network/NetworkTextWriter.cs:100` | UnrepresentableBody | vendor-limit | ~45 spelling limits (100-643). |
| `E/Format/Network/NetworkModel.cs:272` | UnrepresentableBody | vendor-limit | Pull-side vendor facts the model cannot hold (272-361). |
| `E/Format/Task/TaskDescriptorFormat.cs:83` | TaskDescriptorException | needed-to-write | Descriptor grammar (83-157); code fixed by D14. |
| `E/Sync/OpGuard.cs:28` | PLC_DISCONNECTED | connection-state | No project attached. |
| `E/Sync/OpGuard.cs:45` | WRONG_PROJECT | connection-state | Binding vs live identity. |
| `E/Sync/PushService.cs:575` | BAD_REQUEST | request-shape | Extension names no kind. |
| `E/Sync/DutSubtypeChanges.cs:62` | BAD_REQUEST | request-shape | Several ops on one bare DUT. |
| `E/Sync/DutSubtypeChanges.cs:73` | BAD_REQUEST | version-or-conflict-gate | Coalesced subtype change without the delete's ifVersion. |
| `E/Sync/DutSubtypeChanges.cs:126` | BAD_REQUEST | request-shape | Body-less subtype rename; message restated by D18. |
| `E/Sync/PushConflicts.cs:28` | STALE_PROJECT_VERSION | version-or-conflict-gate | Lease. |
| `E/Sync/PushConflicts.cs:69` | ITEM_EXISTS | version-or-conflict-gate | Create over a DUT published under a sibling subtype. |
| `E/Sync/PushConflicts.cs:93` | UNREADABLE | version-or-conflict-gate | No version to guard an overwrite (D1 decides the DUT case). |
| `E/Sync/PushConflicts.cs:103` | ITEM_EXISTS | version-or-conflict-gate | Create over an existing item. |
| `E/Sync/PushConflicts.cs:161` | ITEM_UNVERIFIED | version-or-conflict-gate | Partial walk. |
| `E/Sync/PushConflicts.cs:169` | ITEM_MISSING / STALE_ITEM_VERSION | version-or-conflict-gate | Per-item ifVersion. |
| `E/Sync/PushService.cs:209` | UNREADABLE | version-or-conflict-gate | Delete of an unreadable DUT (D1). |
| `E/Sync/PushService.cs:431` | INTERNAL_ERROR | internal-invariant | ifVersion without a folder (twin inconsistency: D15). |
| `E/Sync/PushService.cs:521` | BAD_REQUEST | request-shape | No op discriminator. |
| `E/Sync/PushService.cs:600` | BAD_REQUEST | request-shape | Task op without sourceText. |
| `E/Sync/PushService.cs:618` | NOT_FOUND | internal-invariant | Task rename post-condition. |
| `E/Sync/PushService.cs:667` | BAD_REQUEST | request-shape | Create with no content. |
| `E/Sync/PushService.cs:705` | NOT_FOUND | internal-invariant | Rename post-condition. |
| `E/Sync/PushService.cs:726` | UNSUPPORTED | vendor-limit | IDE ignored the rename (case-only). |
| `E/Sync/PushService.cs:773` | UNSUPPORTED | request-shape | Only source items move. |
| `E/Sync/PushService.cs:794` | NOT_FOUND | internal-invariant | Re-find after TwinCAT import. |
| `E/Sync/PushService.cs:816` | NOT_FOUND | internal-invariant | Move post-condition. |
| `E/Sync/PushService.cs:917` | DUPLICATE_CHILD | needed-to-write | Two children one name: the write cannot place both. |
| `E/Sync/PushService.cs:966` | NOT_FOUND | internal-invariant | Created interface not found. |
| `E/Sync/PushService.cs:992` | UNSUPPORTED | request-shape | Live tree kind vs name's kind: a write cannot re-type. |
| `E/Sync/PushService.cs:1032` | NOT_FOUND | internal-invariant | Handle invalidated by member create. |
| `E/Sync/PushService.cs:1260` | NOT_FOUND | internal-invariant | Member not where the read said. |
| `E/Sync/PushService.cs:1283` | NOT_FOUND | internal-invariant | Property missing for accessor reconcile. |
| `E/Sync/PushService.cs:1298` | NOT_FOUND | internal-invariant | Property vanished. |
| `E/Sync/Materializer.cs:68` | InvalidOperationException | internal-invariant | UNSUPPORTED line without its reason. |
| `E/Sync/PushedText.cs:28` | ArgumentException | internal-invariant | CLI compare given a non-wire name. |
| `E/Sync/FetchService.cs:51` | NO_SIDECAR | request-shape | Ambiguous fetch. |
| `E/Sync/FetchService.cs:113` | INTERNAL_ERROR | internal-invariant | Walk item with no folder. |
| `E/Ide/InterfaceAccessorGuard.cs:41` | UNSUPPORTED | vendor-limit | D21 crash (TwinCAT; CODESYS side is a MEASURE). |
| `E/Ide/ItemLookup.cs:86` | INTERNAL_ERROR | connection-state | COM fault is not absence. |
| `E/Ide/ItemLookup.cs:102` | INTERNAL_ERROR | connection-state | COM fault. |
| `E/Ide/ItemLookup.cs:117` | INTERNAL_ERROR | connection-state | COM fault. |
| `C/Ide/CodesysNetworkWriter.cs:155` | UNSUPPORTED | vendor-limit | Consumed enabled comparison: MainOutputIndex not settable (N21). |
| `C/Ide/CodesysNetworkWriter.cs:159` | UNSUPPORTED | vendor-limit | Would feed the consumer the enable, silently. |
| `C/Ide/CodesysNetworkWriter.cs:507` | UNSUPPORTED | internal-invariant | Node type with no writer arm. |
| `C/Ide/CodesysNetworkWriter.cs:527` | UNSUPPORTED | needed-to-write | Two pins in one vendor slot. |
| `C/Ide/CodesysNetworkWriter.cs:344` | INTERNAL_ERROR | internal-invariant | Execute box read-back mismatch. |
| `C/Ide/CodesysNetworkWriter.cs:610` | INTERNAL_ERROR | internal-invariant | RESET at the generic flag write. |
| `C/Ide/CodesysNetworkWriter.cs:616` | INTERNAL_ERROR | needed-to-write | No Flags member. |
| `C/Driver/CodesysDriver.Content.cs:122` | UNSUPPORTED | needed-to-write | Pull: boundary-shaped ST line. |
| `C/Driver/CodesysDriver.Content.cs:258` | UNSUPPORTED | internal-invariant | Unknown member code, no fallback. |
| `C/Driver/CodesysDriver.Content.cs:291` | INTERNAL_ERROR | internal-invariant | Member with no declaration. |
| `C/Driver/CodesysDriver.Content.cs:338` | INTERNAL_ERROR | internal-invariant | Tree kind maps to nothing. |
| `C/Driver/CodesysDriver.Content.cs:366` | NOT_FOUND | internal-invariant | Member not created first. |
| `C/Driver/CodesysDriver.Content.cs:55` | NETWORK_* | needed-to-write | Network model built (also :374, :471); second validation is D12. |
| `C/Ide/CodesysNetworkReader.cs:58` | UnrepresentableBody | vendor-limit | Vendor split point. |
| `C/Ide/CodesysNetworkReader.cs:117` | UnrepresentableBody | vendor-limit | Assignment with no value. |
| `C/Ide/CodesysNetworkReader.cs:135` | UnrepresentableBody | vendor-limit | Unheld flags (135, 145, 161). |
| `C/Ide/CodesysNetworkReader.cs:157` | UnrepresentableBody | vendor-limit | Parallel fed by terminator. |
| `C/Ide/CodesysNetworkReader.cs:172` | UnrepresentableBody | vendor-limit | Terminator with input. |
| `C/Ide/CodesysNetworkReader.cs:182` | UnrepresentableBody | vendor-limit | Item with no text form. |
| `C/Ide/CodesysNetworkReader.cs:239` | UnrepresentableBody | internal-invariant | Pin lists missing/misaligned (196, 265, 266, 436). |
| `C/Ide/CodesysNetworkReader.cs:242` | UnrepresentableBody | vendor-limit | Pin flags misaligned / on EN (248). |
| `C/Ide/CodesysNetworkReader.cs:394` | UnrepresentableBody | internal-invariant | Execute box unreadable (399). |
| `C/Ide/CodesysNetworkReader.cs:439` | UnrepresentableBody | vendor-limit | Wired ENO echo. |
| `C/Ide/CodesysObjectModel.Descriptors.cs:345` | INTERNAL_ERROR | vendor-limit | IDE refused call-list rebuild. |
| `C/Ide/CodesysObjectModel.Libraries.cs:471` | UNSUPPORTED | vendor-limit | Move to the POU pool. |
| `C/Ide/CodesysObjectModel.Libraries.cs:434` | INTERNAL_ERROR | internal-invariant | No create for kind (448, 362). |
| `C/Ide/CodesysObjectModel.cs:94` | INTERNAL_ERROR | internal-invariant | Object-model contract (and the plumbing sites listed in the census). |
| `C/Driver/CodesysDriver.cs:118` | INTERNAL_ERROR | connection-state | No Application (Tree.cs:105). |
| `T/Driver/BeckhoffDriver.Content.cs:121` | NOT_FOUND | internal-invariant | Member round trip (153, 236, 252). |
| `T/Driver/BeckhoffDriver.Content.cs:313` | UnrepresentableBody | internal-invariant | Execute box unreadable. |
| `T/Driver/BeckhoffDriver.Content.cs:329` | UNSUPPORTED | needed-to-write | Pull: boundary-shaped ST line. |
| `T/Driver/BeckhoffDriver.Content.cs:369` | NETWORK_* | needed-to-write | Network model built (64, 193); repeats are D12. |
| `T/Driver/BeckhoffDriver.Content.cs:464` | INTERNAL_ERROR | vendor-limit | Importer regrouping (455). |
| `T/Driver/BeckhoffDriver.Content.cs:661` | INTERNAL_ERROR | internal-invariant | Read contract (725, 760). |
| `T/Driver/BeckhoffDriver.Content.cs:697` | UNSUPPORTED | vendor-limit | D21. |
| `T/Ide/TcNetworkWriter.cs:156` | UNSUPPORTED | needed-to-write | Textual → graphical in place (159); CODESYS twin is D7. |
| `T/Ide/TcNetworkWriter.cs:180` | UNSUPPORTED | vendor-limit | Network count change (N11). |
| `T/Ide/TcNetworkWriter.cs:205` | NETWORK_UNSUPPORTED | vendor-limit | Unmeasured import shapes (N22, C20). |
| `T/Ide/TcNetworkWriter.cs:210` | UNSUPPORTED | vendor-limit | D25 regrouping. |
| `T/Ide/TcNetworkWriter.cs:292` | UNSUPPORTED | needed-to-write | In-place shape changes routed to rebuild (292-1017); :488's wording is wrong (D25). |
| `T/Ide/TcNetworkWriter.cs:411` | UNSUPPORTED | needed-to-write | No slot for the output the text reads (N21; D22). |
| `T/Ide/TcNetworkWriter.cs:457` | UNSUPPORTED | vendor-limit | Execute ST line count (N11). |
| `T/Ide/TcPlcOpenWriter.cs:234` | UNSUPPORTED | vendor-limit | Execute box has no PLCopen element. |
| `T/Ide/TcPlcOpenWriter.cs:261` | UNSUPPORTED | vendor-limit | Output pin straight to a variable (C20). |
| `T/Ide/TcPlcOpenWriter.cs:473` | UNSUPPORTED | vendor-limit | Single-consumer branch point. |
| `T/Ide/TcPlcOpenWriter.cs:415` | UNSUPPORTED | vendor-limit | Jump with N destinations. |
| `T/Ide/TcNetworkReader.cs:90` | UnrepresentableBody | vendor-limit | Pull representability twins. |
| `T/Ide/TcNetworkReader.cs:30` | UNSUPPORTED | internal-invariant | Archive member contract. |
| `T/Ide/TcTaskSchedule.cs:74` | UNSUPPORTED | vendor-limit | Task settings TwinCAT cannot hold. |
| `T/Ide/TcTaskSchedule.cs:173` | BAD_REQUEST | needed-to-write | Tick conversion needs number + unit. |
| `T/Ide/TcTaskSchedule.cs:56` | INTERNAL_ERROR | internal-invariant | Vendor XML contract. |
| `T/Ide/TcObjectModel.Task.cs:100` | UNSUPPORTED | vendor-limit | Schedule read-back. |
| `T/Ide/TcObjectModel.Task.cs:137` | UNSUPPORTED | vendor-limit | Call list read-back. |
| `T/Ide/TcObjectModel.Task.cs:147` | UNSUPPORTED | vendor-limit | No linked system task. |
| `T/Driver/BeckhoffDriver.cs:123` | PLC_DISCONNECTED | connection-state | XAE did not answer. |
| `T/Ide/TcObjectModel.Build.cs:54` | INTERNAL_ERROR | internal-invariant | Save failed. |
| `T/Ide/TcItemArchive.cs:119` | INTERNAL_ERROR | internal-invariant | Archive post-conditions. |
| `T/Ide/TcObjectModel.cs:386` | INTERNAL_ERROR | vendor-limit | Importer's silent failure made loud. |

## Design issues

Grouped from the review; `Dn` is the task in `tasks.md` §4. The first eight are the ones that matter most.

- **D1 — A DUT's subtype has two sources.** Push: the extension is the subtype, the text is written as sent. Pull,
  refs, receipt, delete and create gates: parsed from the declaration (`Materializer.cs:92` → `CodeHelper.DutSubtype`).
  `set X.struct` with an enum body comes back `X.enum`; with no stated subtype (`TYPE X : END_TYPE`, the `c802b74d`
  unclosed comment) it becomes UNREADABLE, and then the create/update that would fix it is refused UNREADABLE
  (`PushConflicts:93`) and the delete needs `--force`. `push-without-header-check` task 1.2 says "fixing the header
  and pushing again restores it"; for a DUT that is false today.
- **D2 — CODESYS reads a POU's kind from its header and defaults to FB** (`CodesysTypeMap.cs:165-173`). A `.prg`
  with an unclosed opening `(*` is published as `.fb`; the next refs reports a rename nobody made. Push takes the
  extension as the kind; pull guesses one from the text.
- **D3 — The network scope classifies items by regex-reading headers** (`StDeclaration.IsCallableHeader`,
  `IsGlobalListHeader`, `IsFunctionBlockType` via `CodeHelper.HeaderLine`; `NetworkScope.FromDeclarations:98,115`;
  `ProjectDeclarations.cs:78`; `PushService.DeclarationsIn` drops the op's kind). An FB instance becomes a
  FUNCTION call when the FB's declaration opens with an unclosed comment.
- **D4 — Unknown types are assumed to be library FBs**; `NonBlockTypeWords` is a hand copy of IEC types plus CODESYS
  `__X*` types above the seam, and misses `WCHAR`.
- **D5 — Scope names come from a one-line regex** (`StDeclaration.VarLine`); refusals 362, 1003, 1015 rest on it and
  misfire on `AT`, wrapped lists, attribute lines.
- **D6 — The live body's language is re-sniffed from text** (`BodyFormatGuard` ShapeOf/LanguageOf) although each
  driver reads it as a fact.
- **D7 — "The stated language must be one the IDE's body can take" lives in 3+ places with 3 mechanisms**: StReader
  content sniff (INVALID_ST, `NetworkText.OpensNetwork`), BodyFormatGuard (UNSUPPORTED, pre-flight),
  `RefuseViewModeChange` (NotSupportedException from inside each driver, after pre-flight). Per vendor it differs
  again: TwinCAT refuses textual→graphical by name, CODESYS fails with a raw member error; ST over NWL on TwinCAT is
  unmeasured.
- **D8 — Network text is validated two or three times per push** (engine pre-flight, create arm, TwinCAT
  `ValidateSource`, each driver's write), rebuilding the scope each time.
- D9 — `StReader` scans the whole text for content (`FindRetiredComment`, `RefuseReservedNames`); the retired
  comment rule is duplicated push/pull with different scopes (DUT/GVL writable, never readable); empty text and
  Unmarked are one condition with two messages; `ImplementationMarker.Shape` matches a bare `Implementation` line.
- D10 — The child-signature reader encodes grammar it does not need (modifier vocabulary, ASCII identifier, type
  required); the TwinCAT interface-member create seed is enforced for every vendor in the Format layer.
- D11 — "Which kinds are declaration-only / signatures / body / accessors" is spelled in five places;
  `BodyFormatGuard` repeats its member branch twice and puts `InterfaceMethod` among Getter/Setter.
- D12 — TwinCAT's `ValidateSource` re-parses the whole source and re-derives the kind; the driver should take the
  engine's validated models (merged into D8's fix).
- D13 — Canonical-form gates on network text and `.task`, and the reader's layout rules that exist to make them pass.
- D14 — Refusal codes do not match their category: `TaskDescriptorException` → INTERNAL_ERROR; invariants as
  BAD_REQUEST/INVALID_ST; vendor limits as INTERNAL_ERROR; Volt model bugs as "cannot express as PLCopen".
- D15 — The last-moment version check has two implementations (`RequireUnchanged` vs `RequireUnchangedBeforeDelete`):
  one throws on a null folder, the other returns silently; both answer BAD_REQUEST.
- D16 — `currentFolder = inCache ? cached.Folder : ""` (`PushService.cs:474`): an uncached item is hashed against
  the root and reported "changed in the IDE"; a `ToFolder=""` reads as "no move".
- D17 — Member reconciliation falls back silently (`Owner(): ItemLookup.Find(...) ?? pou`, `FindFolder(...) ?? Owner()`).
- D18 — Stale docs still state the retired rule: `ItemKind.cs:293` ("Kind is recovered from file content on push"),
  `DutSubtypeChanges.cs:33-39` and the :126 message ("the subtype is what the declaration says").
- D19 — Pre-flight reads the kind of `ToName ?? Name` but hands the driver's `ValidateSource` `Name`.
- D20 — TwinCAT keeps the member-kind fallbacks CODESYS removed (`BeckhoffDriver.Content.cs:597` `?? Method`, :706
  `?? ""`).
- D21 — TwinCAT's create pre-flight is per ITEM while create-vs-edit is decided per BODY; a new graphical member in an
  existing POU fails mid-batch.
- D22 — N21 (EN is a pin, ENO is spelled) is implemented twice in different shapes (CODESYS predicts from the model,
  TwinCAT compares with the built box).
- D23 — `TcNetworkWriter.Bits` refuses RESET with the belief its own `WriteCoilBits` doc calls wrong.
- D24 — The TwinCAT Stamp catch swallows any NotSupportedException after a create, not only D25 regrouping.
- D25 — When the in-place write and the rebuild both refuse, the user sees the rebuild's reason, not the one about
  their edit; :488's message is wrong.
- D26 — A body pushed at an item with no body slot is dropped silently on both vendors (`SetAspectText` returns;
  `HasBodySlot` kind table) and the push reports success.
- D27 — Unknown view mode / body language thrown outside `NetworkText.Pulled` drops the whole POU (declaration and
  members) from refs and fetch.
- D28 — `InterfaceAccessorGuard` applies TwinCAT's D21 crash to CODESYS unmeasured.
- D29 — TwinCAT build diagnostics are scraped from Output panes by regex; `ErrorList.ErrorItems` is structural.
- D30 — TwinCAT `LibraryManifestFromXml` manufactures `?? name` namespaces/resolutions that feed the version hash
  and the LSP.

## What the LSP must pick up

Where a code check is removed or narrowed, the IDE build reports the error and the LSP must report the same message
on the same line (parity, not better; an LSP-only message is a false positive). Each is a conformance fixture recorded
live on CODESYS SP21 (and TwinCAT where the construct exists).

| Removed/narrowed check | What the build does (to record) | LSP |
|---|---|---|
| `StReader:460` ST body shaped like network text | Syntax error at `NETWORK`/`END_NETWORK` | Same diagnostic in the ST parser. |
| `StReader:489` identifier `IMPLEMENTATION` | Expected: compiles clean | Must NOT flag it; check the keyword table does not reserve it (it is Volt's line, not IEC). |
| `StReader:795/852` member/property with no type | Declaration error | Same message and line. |
| `StReader:805` unknown word in a METHOD header | Syntax error | Same. |
| `StReader:809` (if removed after measure) bad child name | Vendor's create/compile error | Same. |
| `NetworkTextReader:1003` undeclared `gN` | Undeclared identifier | Network-text sublanguage reports it. |
| `NetworkTextReader:1036` (if removed) wire type vs producer | Type mismatch, if the build reports one | Same. |
| `CodesysNetworkWriter:163` `.ENO` without EN | "Missing EN pin" | Network-text sublanguage reports it. |
| `Materializer:37` retired `(* @volt-` comment | Nothing (a comment) | Nothing. |
| `Materializer:92` DUT stating no subtype | Syntax error on `TYPE X : END_TYPE` / unclosed comment | Same (extends push-without-header-check 4.1). |
| Layout rules (285, 292, 330, 362, 1015), both canonical gates | Nothing | Nothing. |

## Impact

- `packages/volt-cli/src/Volt.Engine/Format/**`, `Sync/**`, `Ide/**`, `Item/ItemKind.cs`;
  `Volt.Ide.Codesys` and `Volt.Ide.Twincat` drivers and writers; `Volt.Contracts/Vocabulary/ConflictCodes.cs`
  (`NETWORK_NOT_CANONICAL` goes).
- Tests that assert a removed refusal: their premise was the retired rule (independent of behaviour), so they are
  rewritten to assert the write happens and the IDE's recorded error is what reports it.
- `packages/volt-lsp-iec`: the fixtures and diagnostics in the table above.
- Wire: refusal codes change for the CHANGE rows that re-code (clients branch on them); no new op or field, except an
  optional canonical text in the push response if D13 returns it there.
- Order: after `push-without-header-check`; this change does not touch the header check it removed.
