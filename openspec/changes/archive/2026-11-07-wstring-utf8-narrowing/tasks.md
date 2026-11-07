## 1. Measure

- [x] 1.1 Exec fixtures for the class (widen, cut at capacity inside a character, lone surrogate), recorded with `record:exec` (`conversions/wstring-utf8.ts`, 10 cases). Not measured: the UTF-8 project option; the recording project holds one setting. Undecodable bytes on the widen make CODESYS read past the terminator, so that case is refused, not matched.

## 2. Fix

- [x] 2.1 Interpreter and Rust emitter narrow/widen as recorded, red then green; `uoff_wstring_control` leaves `deferred.transpile`
