## Why

A coil beside a jump or return is spelled by repeating the rung's value after the coils: `y := c; JMP(skip, c);`. When
that value reads a variable one of the rung's own coils writes (`a := NOT a; JMP(skip, NOT a);`, a seal-in
`x := a AND x;`, an `S=`/`R=` coil), the repeated statement reads the written variable, while CODESYS evaluates the rung
once: the text ran differently from the stored rung, silently. Found by Sim-Assist (change `network-editor`, 2026-10-31).

## What Changes

- `StNetworkWriter.AssignItem` refuses such a rung by name: `a jump sharing a value that reads a variable its own coil
  writes`. Variables compare by base name (`s.x[i]` is `s`), case-insensitively, culture-invariant.
- No new spelling: the wire form for this rung stays an open owner question (`network-coil-beside-jump`).

## Impact

- `packages/volt-cli/src/Volt.Engine/Format/Network/StNetworkWriter.cs`; test in `StNetworkTextTests`.
