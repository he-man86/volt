## Why

`build-cli.ps1` failed on the dev machine on 2026-10-15 (PLC Assist packaging 0.1.17689): 5 of 295 tests, all
`BridgePackagingTests`, threw `System.ComponentModel.Win32Exception : Toegang geweigerd` (access denied) before building
anything, so no bridge was produced.

The cause is the test helper, not the bridges. `SweepEarlierOutputs()` keeps a `%TEMP%\volt-packaging\<pid>-…` folder when
`Alive(pid)` says its process is still running. `Alive` catches only `ArgumentException` (no such process). When Windows has
REUSED the pid for a protected process — here pid 28108 had become `audiodg`, the audio service — `Process.HasExited` throws
`Win32Exception` (access denied), the sweep throws, and every test that builds a bundle fails.

It is deterministic once it happens: the folder stays, and every later run trips over it until someone deletes it by hand.

## What Changes

`Alive(pid)` treats "access denied" as "not this test run's process": a process a non-elevated test run cannot inspect is not
one it started. The sweep then deletes the folder (or leaves it for the next run if it is locked, as today).

## Impact

`packages/volt-cli/test/Volt.Cli.Tests/wire/BridgePackagingTests.cs` only. No product code, no wire change.
