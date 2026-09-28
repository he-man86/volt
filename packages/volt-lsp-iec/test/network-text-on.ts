// Every `bun test` in this package runs with LD and FBD network text ON (openspec implementation-keyword 3c): the LSP's
// switch is VOLT_GRAPHICAL=1 in its process environment (`NETWORK_TEXT_ENABLED`, read once when the module loads), which
// a shipped editor does not set. Preloaded (bunfig.toml) so it is set before any test imports the server; the test that
// proves "off" starts its server in a child process without it.
process.env.VOLT_GRAPHICAL = "1"
