/**
 * THE SERVER'S ENVIRONMENT — the one place the LSP reads its process environment.
 *
 * Is LD and FBD network text read at all in this process? ON only when its environment holds `VOLT_GRAPHICAL=1` — the
 * LSP's one switch (openspec `implementation-keyword` 3c), the twin of the bridge's `NetworkTextSwitch`, and the only
 * place in the LSP that reads the variable (a repo gate holds that). The front-end reads no environment (openspec
 * frontend-conformance P5): every parse the server makes passes this as `ParseOptions.networkText`.
 *
 * WHY: network text is not ready to ship. A production bridge pulls every LD and FBD body as its UNSUPPORTED line; a
 * production editor reads nothing under an `IMPLEMENTATION LD|FBD` line either (one pulled from a development bridge,
 * or written by hand) — no network finding and no refusal, because whether a push accepts it is the BRIDGE's answer,
 * from its own environment, which this process cannot see. Read ONCE: one answer for the server's life. Development
 * turns it on in the editor's environment, and the test suite in `bunfig.toml`.
 */
export const NETWORK_TEXT_ENABLED: boolean = process.env.VOLT_GRAPHICAL === "1"
