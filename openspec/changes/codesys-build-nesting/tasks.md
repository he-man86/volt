## 0. Design gate — do this first

- [x] 0.1 (volt, 2026-10-03: confirmed, and pushes DID run inside build r3 (25 vendor-parity e2e pushes). FITS as one non-waiting gate in BridgePipeHost around push and build, refused IDE_BUSY, with no join. See the proposal's assessment.) Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"): reproduce the LIFO
      completion and a fetch answering mid-build on CODESYS, and establish whether `ExecuteCommand` for the build
      pumps the primary thread so that `InvokeInPrimaryThread` items run nested. If refuted or intended, record why and
      stop. Then check the request against volt's design (`health` answers during a write, no auto-retry of a write,
      OpGuard atomicity, vendor parity, the CLI). Record FITS, or CONFLICTS + why + the volt-native alternative.
      Build only what fits.
- [x] 0.2 (decided: refuse rather than join; reads are not gated; the code is `IDE_BUSY`.) Decide: a second build joins or is refused; whether reads may run inside a build; the code's name.

## 1. Reproduce

- [ ] 1.1 Live on CODESYS, against a project whose build takes > 20 s: request three builds 5 s apart through the pipe
      and record the completion order; request a fetch during the first and record when it answers.
- [ ] 1.2 Same with a push during a build: does it apply mid-compile, and do the build's diagnostics change?

## 2. Test red

- [ ] 2.1 Host test with a fake driver whose build re-enters queued work: a second build and a push during a build
      are answered as decided in 0.2, and the fake records one compile and no write.

## 3. Build

- [ ] 3.1 The gate in the pipe host, the code, regenerated wire docs, `relay-protocol.md` Concurrency section.

## 4. Verify

- [ ] 4.1 Repeat 1.1 and 1.2 live: one compile per overlapping request set, the push refused, `health` answering.
- [ ] 4.2 Full C# suites and `bun run check` green.
