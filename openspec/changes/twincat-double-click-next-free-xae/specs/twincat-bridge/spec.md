## ADDED Requirements

### Requirement: a double-click start serves the first XAE window it can claim
A TwinCAT bridge SHALL take the pipe name of an XAE pid before it attaches to that XAE. Started without `--xae-pid`, it
SHALL list XAE pids from the ROT display names, SHALL bind no DTE whose display name states a pid, and SHALL serve the
first pid whose pipe name it can take; a pid whose name another bridge holds SHALL NOT be bound or attached to. Started
with `--xae-pid`, a taken name SHALL end the process with a non-zero exit and the reason in the log, before any attach.

#### Scenario: the first window is already served
- **WHEN** XAE pids 1234 (its pipe name held by another bridge) and 5678 are open and the user double-clicks the bridge
- **THEN** it serves `volt.bridge.twincat.5678`, and no DTE of pid 1234 is bound

#### Scenario: two free windows
- **WHEN** XAE pids 1234 (caption `Lift - TcXaeShell`) and 5678 (caption `Line1 - TcXaeShell`) are open, neither served
- **THEN** the bridge serves pid 1234, the console names pid 1234 with its caption as served, and names pid 5678 with its
  caption as another open window

#### Scenario: the supervisor's start collides
- **WHEN** the connector starts the worker with `--xae-pid 1234` and that pipe name is held
- **THEN** it exits 3 with the reason in the log, and it never attached to pid 1234

### Requirement: a double-click start waits without a deadline and never exits unread
A TwinCAT bridge started without `--xae-pid` SHALL keep scanning, with no deadline, while no XAE window is open or every
open window's pipe name is held. While every window is served, the console SHALL name each one's pid and window caption
as already served by another Volt bridge. Every exit of that start the user did not ask for SHALL print its reason and
wait for Enter.

#### Scenario: every window is served
- **WHEN** the only XAE, pid 1234 (caption `Lift - TcXaeShell`), is served and the user double-clicks a second copy
- **THEN** the console names pid 1234 and its caption as already served by another Volt bridge, and the copy keeps running
- **AND WHEN** the first bridge stops
- **THEN** the waiting copy serves pid 1234

#### Scenario: XAE not open yet
- **WHEN** no XAE window is open for more than 10 minutes
- **THEN** the bridge is still scanning, and serves the first window that opens

#### Scenario: the start fails after the claim
- **WHEN** the pipe server cannot start (an access denial) after the claim
- **THEN** the console shows the reason and the process waits for Enter before it ends
