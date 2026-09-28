// Every `bun test` in this package — the unit tests and the live e2e suites — runs with LD and FBD network text ON
// (openspec implementation-keyword 3c): the switch is VOLT_GRAPHICAL=1 in the process environment, which the shipped
// build does not set. Preloaded (bunfig.toml) so the `volt` processes the suites spawn inherit it. The bridge they drive
// reads its OWN environment: `ide.ps1` starts CODESYS and the TwinCAT worker with it.
process.env.VOLT_GRAPHICAL = "1"
