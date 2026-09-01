using Xunit;

// Run this assembly SERIALLY. `VoltLog` is a process-global singleton (one _dir/_enabled/_level for the whole
// process - correct for a real bridge, which is one process with one log dir), so a class that Inits it and
// reads the file back cannot run concurrently with anything else that logs.
//
// THE REASON IS BROADER THAN THE COMMENT USED TO SAY, and the difference matters. It read as though the
// hazard were VoltLogTests alone - the implication being that moving that file out would free the assembly.
// It would not. Six SOURCE services log on ordinary paths (`FetchService`, `PushService`, `RefsService`,
// `Versioning`, `ProjectSnapshot`, `BuildService`), 23 files in this suite drive them, and
// `sync/FetchLoggingTests` reads the log back to assert what they wrote. So the writers are most of the suite
// and the reader is inside it: serialising the assembly is the guarantee, not a convenience.
//
// VoltLogTests and SeverityTests have since moved to Volt.Contracts.Tests, where they belong by package - that
// move is about ownership, and deliberately buys no parallelism here.
//
// The suite runs in about a second; serial is cheap. Revisit only by giving `VoltLog` a per-test scope, which
// is a change to the product, not to the test runner.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
