## Why

Seen in PLC Assist on 2026-10-16, chat `be8c6faa` (CODESYS, a Chinese-language project, bridge 0.1.17689). The user asked
for a fix in three POUs. Every write failed, twice, before anything landed:

```
the IDE refuses to create method '从Modbus读取命令' in '命令队列管理': CODESYS does not take '从Modbus读取命令' as a name
("The name '从Modbus读取命令' is not valid for this object.")
the IDE refuses to create method '区域可占用' in '前置系统路径控制': …
the IDE refuses to create method '区域可占用' in '仓库路径控制': …
```

These methods already exist in the user's project. Nothing was being created: the patch changed the POU bodies. The user's
IDE holds the Chinese names, builds them, and runs them.

Cause, in `PushService` (the push pre-flight, openspec `push-keeps-what-landed` 3.1):

- **Every member is asked, on an update too.** The comment's reason: "an existing member can not hold a word its IDE
  refuses to create, so only a NEW one can be refused". This project disproves that premise.
- **`CodesysDriver.NameRefusal` refuses every name that is not an ASCII identifier.** That rule was measured on one SP21
  install (`bridge-refusal-review` 3.1). This user's CODESYS holds and builds CJK method names, so the rule is not universal.
  The cause could be the version, the language pack, or a project setting.

Result: any project whose existing POUs have a non-ASCII method, action or property name cannot be written at all, in any
of those POUs. Chinese, Japanese, Cyrillic and accented identifiers are all affected.

## What Changes

- **The name pre-flight asks only members the push will CREATE.** A member that already exists under the POU (same kind,
  same name) is never refused by name, because the IDE already holds it. `RefuseMemberCreates` already knows what exists
  (`existing`); the name check uses the same set.
- **The non-ASCII rule stops being a pre-flight verdict.** A NEW non-ASCII name goes to the IDE. If the IDE refuses it, that
  refusal is the existing `ChildRefusedException` path from the apply loop, with the IDE's own sentence. Measured reserved
  words (`Log`, `INT_TO_REAL`, …) stay in the pre-flight, because they were measured to fail mid-batch.
- **Same rule for POU names on create:** a non-ASCII POU name is no longer refused before the IDE has been asked.
- **The language server lexes non-ASCII identifiers.** PLC Assist runs `volt-lsp-iec` on every read (shadow mode today). It
  reported `Identifier expected instead of '点'` on this user's DUTs and FBs, which CODESYS builds clean. Harmless in shadow
  mode, but it blocks ever moving the check to `read` or `block` for these users.

## Impact

- `Volt.Engine/Sync/PushService.cs` (the member loop above `RefuseMemberCreates`).
- `Volt.Ide.Codesys/Driver/CodesysDriver.Tree.cs` `NameRefusal` (drop the ASCII-shape clause, or narrow it to what is
  measured to fail on EVERY supported install).
- TwinCAT: check whether `TcCodeStore` has the same ASCII-shape clause, and apply the same rule.
- Fixture: a POU with a CJK-named method, created through the IDE.
