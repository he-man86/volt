## ADDED Requirements

### Requirement: `volt mcp` serves the CLI over stdio MCP

The `volt` CLI SHALL gain an `mcp` verb that runs a Model Context Protocol server over stdio, exposing Volt's existing verbs as MCP tools. It SHALL ship inside `volt.exe` as one more verb — not as a separate package, executable, or runtime — so that every host configures it with the identical entry `{"command": "volt", "args": ["mcp"]}`.

This is the only mechanism by which Claude Desktop can reach Volt, since Claude Desktop has no terminal.

#### Scenario: A host starts the server

- **WHEN** a host spawns `volt mcp` and sends an MCP `initialize` request on stdin
- **THEN** the server responds with its capabilities and advertised tools on stdout
- **AND** the process stays alive until stdin closes

#### Scenario: stdout carries protocol only

- **WHEN** the server emits diagnostics, warnings, or progress while handling a request
- **THEN** that output goes to stderr
- **AND** stdout contains nothing but well-formed JSON-RPC messages

#### Scenario: The host disconnects

- **WHEN** stdin reaches end-of-file
- **THEN** the server shuts down and exits zero without orphaning a bridge connection

### Requirement: Mutating tools are annotated as such

Tools wrapping read-only verbs (`status`, `show`, `build`) SHALL carry MCP's `readOnlyHint`. Tools wrapping verbs that write to the repository or the live IDE (`init`, `pull`, `push`, `merge`) SHALL NOT carry it and SHALL be annotated as destructive, so hosts surface the distinction in their approval prompts.

Volt SHALL NOT implement its own approval or permission layer inside the MCP server. Consent is the host's responsibility, and every supported host already prompts per tool call.

#### Scenario: A host renders an approval prompt

- **WHEN** the agent calls the `push` tool
- **THEN** the tool's advertised annotations mark it as mutating and non-read-only
- **AND** the host prompts the user before the call proceeds

#### Scenario: A read-only tool runs

- **WHEN** the agent calls the `status` tool
- **THEN** no repository or IDE state is modified regardless of the outcome

### Requirement: The workspace root is explicit, never guessed

The server SHALL resolve its workspace from an explicit `--workspace <path>` argument when given, and otherwise from the process working directory. When the resolved directory is not a bound Volt workspace, tool calls SHALL fail with an error naming the resolved path and the reason. The server SHALL NOT search parent directories, fall back to a default project, or silently operate on a different workspace than the one resolved.

Claude Desktop spawns the server with no project context, so an unbound workspace is an expected condition that must report itself clearly rather than appear to succeed.

#### Scenario: Claude Desktop calls a tool with no workspace configured

- **WHEN** the agent calls `status` and the resolved directory has no Volt binding
- **THEN** the tool returns an error stating the resolved path and that it is not a bound Volt workspace
- **AND** the error names `--workspace` as the way to point the server at a project

#### Scenario: An explicit workspace is supplied

- **WHEN** the host config passes `["mcp", "--workspace", "C:\\plc\\my-project"]`
- **THEN** every tool call operates on that project regardless of the process working directory

### Requirement: MCP tools and CLI verbs share one implementation

Each MCP tool SHALL invoke the same engine path as its corresponding CLI verb. The MCP surface SHALL NOT reimplement, reorder, or reinterpret verb behavior, and a change to a verb's behavior SHALL be observable through both surfaces without a second edit.

#### Scenario: A verb's behavior changes

- **WHEN** a `push` bug is fixed in the shared engine
- **THEN** both `volt push` and the `push` MCP tool exhibit the fixed behavior with no MCP-layer change

#### Scenario: Output is machine-readable

- **WHEN** a tool returns a result to the host
- **THEN** the payload is structured content rather than scraped terminal formatting
