> Owner, 2026-10-27: replace `IMPLEMENTATION <LANG>` with `%LANGUAGE <LANG>` for the next release (chose option A of
> seven: `%LANGUAGE`, `%IMPLEMENTATION`, `%BODY`, a pragma, a comment, two files, the language in the extension). Not
> started; it follows relay-chunked-results and lsp-field-false-positives.

## Why

Every line Volt adds to IEC text is a `%KEY value` property line (`%CLASS`, `%FOLDER`, `%EXCLUDE_FROM_BUILD`, …), read
in one place (`PropertyLines`, mirrored by the LSP's `object-properties.ts`) — except the body boundary,
`IMPLEMENTATION <LANG>`, which is a bare keyword with a grammar of its own (`ImplementationMarker`). It is also the line the
LSP misreads in the field (PLC Assist's lsp-field-false-positives, family 4: "IMPLEMENTATION line inside a body").

## What Changes

The boundary line becomes a property line with a closed key:

```
FUNCTION_BLOCK FB_Motor
VAR
    speed : INT;
END_VAR
%LANGUAGE ST
speed := speed + 1;
END_FUNCTION_BLOCK
```

- Same meaning and place as today: it ends the declaration, starts the body, and its value picks the reader.
- `%LANGUAGE ST|LD|FBD` for a shown body; `%LANGUAGE CFC UNSUPPORTED` (SFC, IL, …) for a hidden one;
  `%LANGUAGE NONE` for an abstract member with no code.
- `IMPLEMENTATION <LANG>` is no longer read. The readers do not keep a second spelling (no users, no backward compat);
  a push of the old line is refused by name, saying to pull again.
- `PropertyLines` owns the key, so there is one `%`-line grammar in the C# reader/writer and in the LSP.

## Open points (decide in design.md before code)

1. Order against the other `%` lines under it: is `%LANGUAGE` always first, as the boundary, with the object's
   properties after it, as they come after `IMPLEMENTATION` today?
2. An interface member has no body and no boundary today. Does it stay without `%LANGUAGE`?
3. Is `NONE` the right value for "abstract, no code", or is that better as the absence of a body under `%LANGUAGE`?
4. Do `%`-lines stay out of the network-text grammar (`docs/network-text.html`), or does the boundary appear there too?

## Impact

- C#: `ImplementationMarker` folds into `PropertyLines`; `StReader`/`StWriter`; the drivers' strip-on-push.
- About 41 C# and doc files mention the keyword.
- LSP: about 83 TS files (lexer, format reader, diagnostics, network text).
- Every committed fixture, recording, transcript and test corpus is rewritten. The fixture map is regenerated.
- `docs/items.html`, `docs/network-text.html`.
- PLC Assist: their prompts and parsers that read or write `IMPLEMENTATION`, and the joint gate. Coordinate the
  release with them.
