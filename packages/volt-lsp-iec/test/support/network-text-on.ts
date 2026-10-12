// Every `bun test` in this package runs with LD and FBD network text ON (openspec implementation-keyword 3c): the LSP's
// switch is VOLT_GRAPHICAL=1 in its process environment (`server/config.ts` `NETWORK_TEXT_ENABLED`, read once when the
// module loads, and passed to every parse the server makes), which a shipped editor does not set. A direct parse
// (`parseSource`/`parseDocument`) reads no environment: every test and test support states `{ networkText: true }` to
// it (the option is required). Preloaded (bunfig.toml) so it is set before any test imports the server; the test that
// proves "off" starts its server in a child process without it.
process.env.VOLT_GRAPHICAL = "1"
