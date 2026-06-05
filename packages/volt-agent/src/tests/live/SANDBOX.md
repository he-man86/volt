# Live-test sandbox project

Live tests (L5 — `full-cycle.test.ts`) need a known IDE project shape
so they can mutate it deterministically. Production projects don't
work because we can't predict what items exist. The sandbox spec
below defines the items every IDE the live tests run against MUST
contain. Both CODESYS and TwinCAT use the **same** shape — the wire
is identical so the IDE-side project shape is identical too.

You set this up **once per IDE** by creating a fresh project with
the items listed. The live tests probe `/refs` at startup and skip
individual test cases for any sandbox item that's missing, so a
partial sandbox still gives you partial coverage.

## Naming convention

Every sandbox item is prefixed `VoltTest_` so tests can identify
"these are mine, safe to mutate" vs "this is production, leave it
alone". The prefix is reserved — don't use it for production items.

## Required items

### Top-level POUs

| Name | Kind | Folder | Body language | Purpose |
|---|---|---|---|---|
| `VoltTest_PLC_PRG` | program | `(root)` | ST | Edit target for textual round-trip tests (content edits, push→pull idempotence) |
| `VoltTest_FB_ST` | function_block | `POUs/VoltTest/` | ST | Edit target with child elements (one ST ACTION + one ST METHOD inside) |
| `VoltTest_FB_FBD` | function_block | `POUs/VoltTest/` | FBD | Top-level graphical POU. Body: one inVariable → one outVariable wire — minimal but transpilable |
| `VoltTest_FB_Mixed` | function_block | `POUs/VoltTest/` | ST | ST parent containing one FBD action `Cyclic` (tests graphicalChildren wire shape) |
| `VoltTest_FB_MovableA` | function_block | `POUs/VoltTest/MoveSource/` | ST | Move target — moves IDE-side to `MoveDest/` and back, verifies workspace catches up |
| `VoltTest_FB_MovableB` | function_block | `POUs/VoltTest/MoveSource/` | ST | Second move target — used for workspace-side moves (drag in editor → push emits moveItem) |

### Declaration-only kinds

| Name | Kind | Folder | Purpose |
|---|---|---|---|
| `VoltTest_DUT_Struct` | structure | `POUs/VoltTest/Types/` | Asserts declaration-only kinds carry NO `language` field on the wire |
| `VoltTest_DUT_Enum` | enumeration | `POUs/VoltTest/Types/` | Same — enum branch of plcopen_xml.classify |
| `VoltTest_GVL_Config` | gvl | `POUs/VoltTest/` | Same — `VAR_GLOBAL` classification path |
| `VoltTest_ITF_Probe` | interface | `POUs/VoltTest/` | Same — interface classification path |

### Folder marker

| Name | Kind | Folder | Purpose |
|---|---|---|---|
| `VoltTest_EmptyFolder` | folder (empty CODESYS folder marker) | `POUs/VoltTest/` | Asserts empty-folder items round-trip + that folder-only moves bump the version |

### Item content templates

#### `VoltTest_PLC_PRG`

```
PROGRAM VoltTest_PLC_PRG
VAR
    counter : INT := 0;
END_VAR
counter := counter + 1;
END_PROGRAM
```

#### `VoltTest_FB_ST`

```
FUNCTION_BLOCK VoltTest_FB_ST
VAR
    value : INT;
END_VAR
value := value + 1;
END_FUNCTION_BLOCK

ACTION Reset
value := 0;
END_ACTION

METHOD GetValue : INT
VAR_INPUT
END_VAR
GetValue := value;
END_METHOD
```

#### `VoltTest_FB_FBD`

Declaration:
```
FUNCTION_BLOCK VoltTest_FB_FBD
VAR_INPUT
    in : BOOL;
END_VAR
VAR_OUTPUT
    out : BOOL;
END_VAR
```

Body (FBD): one `inVariable` reading `in` → one `outVariable` writing
`out`. (Author this in the IDE, not via push — graphical create is
out of scope.)

#### `VoltTest_FB_Mixed`

ST top-level body:
```
FUNCTION_BLOCK VoltTest_FB_Mixed
VAR
    step : INT;
END_VAR
step := step + 1;
END_FUNCTION_BLOCK
```

Plus one FBD action named `Cyclic` (any non-empty FBD body — content
doesn't matter for the test, only that the body language is FBD).

#### `VoltTest_FB_MovableA` and `VoltTest_FB_MovableB`

Same shape, different name:

```
FUNCTION_BLOCK VoltTest_FB_MovableA (* or _MovableB *)
VAR
    placeholder : INT;
END_VAR
END_FUNCTION_BLOCK
```

#### `VoltTest_DUT_Struct`

```
TYPE VoltTest_DUT_Struct :
STRUCT
    a : INT;
    b : REAL;
END_STRUCT
END_TYPE
```

#### `VoltTest_DUT_Enum`

```
TYPE VoltTest_DUT_Enum :
(
    ONE,
    TWO,
    THREE
);
END_TYPE
```

#### `VoltTest_GVL_Config`

```
VAR_GLOBAL
    g_max_speed : REAL := 1500.0;
    g_enabled : BOOL := TRUE;
END_VAR
```

#### `VoltTest_ITF_Probe`

```
INTERFACE VoltTest_ITF_Probe
METHOD GetStatus : INT
END_METHOD
END_INTERFACE
```

## Why this exact shape

| Test concern | Covered by |
|---|---|
| Round-trip ST content edit | `VoltTest_PLC_PRG` (small, isolated, no children to confuse) |
| Per-item version stability | every item — the test calls `/refs` twice + diffs |
| Child element drift (add/remove/edit) | `VoltTest_FB_ST` has both action and method |
| Top-level graphical → workspace shape | `VoltTest_FB_FBD` |
| Graphical children → sibling files | `VoltTest_FB_Mixed` |
| IDE→workspace move | `VoltTest_FB_MovableA` moved between folders via bridge directly |
| Workspace→IDE move | `VoltTest_FB_MovableB` moved by writing the workspace file at a new path + `volt push` |
| Declaration-only kinds: no `language` on wire | the four `VoltTest_DUT_*` / `_GVL_*` / `_ITF_*` items |
| Empty-folder marker version stability + moves | `VoltTest_EmptyFolder` |
| Spurious-version churn under unrelated push | edits to `VoltTest_PLC_PRG` should NOT bump other items' versions |

## How `full-cycle.test.ts` uses it

```ts
beforeAll: probe /refs, find which VoltTest_* items exist
each test: skip itself if its target VoltTest_* item is missing
afterAll:  restore mutated items to their original content
```

That means: even if you only create `VoltTest_PLC_PRG`, the round-trip
edit test still runs. The graphical, mixed, and move tests skip.
Adding more sandbox items expands coverage without breaking what
already works.

## When to update this spec

When you add a live test that needs an IDE-side fixture that doesn't
already exist here — extend the spec, add the item to your sandbox,
and document the new item under "Required items" above. The test
should skip cleanly if the item is missing so older sandboxes keep
working.

## Sandbox setup checklist (manual, one-time per IDE)

1. Create a new project in CODESYS / TwinCAT.
2. Add each item from "Required items" with the content above.
3. Save the project. Open it.
4. Start the bridge bundle (Volt's bundled CODESYS script /
   `BeckhoffBridge.exe`).
5. Verify with: `curl http://127.0.0.1:8556/refs | jq '.items | keys |
   .[] | select(startswith("VoltTest_"))'` — should print all the
   sandbox item names.
6. Run the live tests: `VOLT_TEST_BRIDGE_PORT=8556 bun test
   src/tests/live/`.
