## 1. Reproduce

- [ ] 1.1 Pro2193 copy via `ide.ps1 up -Vendor codesys`: `refs` with NO probe read, 5 fresh sessions — record pass/fail each.
- [ ] 1.2 Same copy: `probe-dut-subtype-push.py` read of `SER_OperationModeType` (write
      `x|SER_OperationModeType` to `%LOCALAPPDATA%\volt-bridge\dut-probe.req`), then `refs` — record the full error
      and stack from the bridge log.
- [ ] 1.3 For the three objects (`SER_OperationModeType`, `enumRecipeCommandResult`, `PlcDataType`): what kind of
      object each is, and what `HandleOf` / `GuidOf` return for it.

## 2. Test red

- [ ] 2.1 A test that fails the way 1.1 or 1.2 does, on a C# double of the object shape the IDE really has.
- [ ] 2.2 A test that one unreadable object is reported unreadable by name and the rest of `refs` succeeds.

## 3. Fix

- [ ] 3.1 Fix at the line that confuses the Guid and the Int32 handle (or retire the probe if it alone is the cause).
- [ ] 3.2 Record the vendor fact in DIALECT.md.
- [ ] 3.3 TwinCAT: check the equivalent read path; test if it can fail the same way.

## 4. Verify

- [ ] 4.1 Repeat 1.1 and 1.2 with the fix: `refs` succeeds, or names exactly the unreadable item(s).
- [ ] 4.2 Full C# suites green.
