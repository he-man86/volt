## 1. Measure

- [x] 1.1 Merge the CODESYS bridge with its dependencies internalized (ILRepack or equivalent, a build step, no runtime
      component). Record: which assemblies are loaded into CODESYS.exe today, what merges, anything that refuses to
      merge (STJ on net48, its own deps), and the merged DLL's references (only framework + CODESYS assemblies remain).

## 2. Test red

- [x] 2.1 A packaging test: the shipped CODESYS bridge folder holds exactly one Volt assembly and no System.Text.Json
      (or other merged dependency); the merged assembly references no merged name. Red today.
- [x] 2.2 The start-script test (StartScriptLoadTests) runs the merged bundle: once, twice, staging failing, script folder
      on sys.path — one Volt assembly loaded, no AssemblyResolve answer needed.

## 3. Build

- [x] 3.1 The merge as part of the bridge build/packaging; the payload and installer ship the single DLL.
- [x] 3.2 Delete what is now unreachable: BridgeAssemblyResolver, the sys.path surgery, the loadConflicts start refusal
      and its docs/vocabulary text, version-mismatch comments. Keep staging (single file). No fallback left behind.

## 4. Verify

- [x] 4.1 Live on CODESYS SP21 (own `ide.ps1 -Instance`): started from a download-style folder first on sys.path,
      health/refs/build/push work; the CODESYS e2e suite green.
- [x] 4.2 Full C# suites, `bun run check`, the install gate's packaging checks green. DIALECT V6 updated to the merge.
      (Done: all eight C# suites + Volt.Repo.Gates, `bun run check`, `build-cli.ps1` — `dist\Codesys` and the
      connector's `codesys-scriptcommands` hold `Volt.Ide.Codesys.dll` + the two scripts only; `build-payload.ts` copies
      that connector folder verbatim. The install gate's version check now reads the merged DLL
      (`scripts/test-install.ts`); `bun run test:install` itself installs onto this machine and was not run here.)
