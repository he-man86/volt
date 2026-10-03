## Why

**Push should not parse the declaration header at all.** The item's kind is its wire name's extension. Whatever the
client sends is pushed as sent. If something is missing or wrong in the text, that is a compile error, and the
IDE's build reports it.

It came up in a PLCAssist chat on 2026-09-29 (`c802b74d`). A DUT whose opening comment was never closed (`*` where
`*)` belonged) was refused with `INVALID_CODE_HEADER` / `No header line found`, taking its whole 12-op batch with
it. The client was told to fix a header that was fine. The real error was one the build would have reported with
its own message.

This may be partly a leftover from when every DUT was one `.dut` kind, and the header was the only way to know
what a DUT was.

## The rule (owner, 2026-09-29)

**The header is parsed ONLY for child elements.** A top-level item's kind is its wire name's extension (`.pou`, `.itf`,
`.gvl`, `.dut` — every DUT is `.dut` since 5.P, every PROGRAM / FUNCTION_BLOCK / FUNCTION `.pou` since 5.Q), so its header is never read, never checked against the
extension, and never a reason to refuse. A CHILD element inside an item's file — METHOD, ACTION, PROPERTY with its
GET/SET, an interface's METHOD/PROPERTY — has no extension of its own: its header line is what names it, says what it
is, and delimits it. That is the one place a header is parsed on push. The only other thing push reads from the text is
the `IMPLEMENTATION` line, to split a declaration from its body. The DUT subtype check on push
(`Sync/DutSubtypeChanges.cs:140`, "a DUT's name must agree with its body") goes too — and with 5.P (owner,
2026-10-02) the whole subtype naming goes: a DUT's extension names its kind only.

## What Changes

1. **Check the current situation first.** Which push paths still parse or check the header, for which kinds?
   Starting points found by reading, not verified:
   - `Sync/PushService.cs:835` and `:903` call `StReader.Read(src, wireKind, name)`;
   - `Format/St/StReader.cs:117` calls `CodeHelper.ParseCodeHeader` and `RequireKind` before branching on kind, so
     it may apply to POUs as well as DUTs;
   - `Sync/DutSubtypeChanges.cs:165` calls `ParseCodeHeader`;
   - `Sync/PushedText.cs:29-30` and `Sync/PushService.cs:400` call `StReader.Read`.
   Record which of these still act on push today.
2. **Remove header parsing from push.** No header parse, no header/extension check, no header-based refusal. The
   kind comes from the extension; the text is pushed as sent.
3. **Keep only what the engine needs to perform the push**, such as finding a POU's `IMPLEMENTATION` boundary to
   split declaration from body. If that is impossible, the refusal says so (`INVALID_ST`). It is not a check on
   the code.

## Notes

- The header check was added after a live measurement (2026-09-17): a `.fb` whose text said `PROGRAM` made CODESYS
  create a PROGRAM. Measure what that case does without the check. If it can leave the project inconsistent (two
  items, a half-written one), say so before removing it. A renamed item that `refs` then reports is acceptable.
- Separately measured: the LSP (`volt-lsp-iec`) gives no diagnostics for a text whose opening `(*` is never closed,
  for a DUT or an FB, because the whole text is one comment. That is its own LSP change.

## Impact

- The call sites above, and the tests that assert `INVALID_CODE_HEADER` on push.
- Clients — **PLCAssist** (design 5.Qb N1): the wire names change in ONE release. Every POU is `X.pou` (was
  `X.prg` / `X.fb` / `X.fun`, 5.Qa) and every DUT is `X.dut` (was `X.struct` / `X.enum` / `X.union` / `X.alias`,
  5.P). An old name is refused `BAD_REQUEST` by name and never mapped to the new one — two spellings of one item is
  the collapse the item-name invariant forbids. The client keys by wire name, so after upgrading it re-reads `refs`
  and renames its keys. And a push names each item in at most one op (5.Q.6): a delete and a create of one name are
  two pushes.
