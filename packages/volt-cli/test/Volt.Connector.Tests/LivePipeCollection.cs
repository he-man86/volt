using Xunit;

// Run this assembly's tests SERIALLY (no cross-class parallelism), because three classes hold real WALL-CLOCK
// waits that a loaded runner starves:
//
//   * BridgeSupervisorTests   - a 3s sleep asserting a command has NOT yet been marked long (line 120), plus
//                               100ms poll loops around a real process supervisor.
//   * ConnectionManagerTests  - a 2s CancellationTokenSource bounding a churn loop, and RefreshIfStaleAsync
//                               staleness windows of 1s and 30s.
//   * ControlServerTests      - a real HTTP listener on a 10s client timeout, with a 5s handler-ran assertion.
//
// xUnit runs test classes in parallel by default, and on a loaded runner those windows get CPU-starved and
// miss - a pure-contention flake, not a logic bug (each passes every time when run alone). The suite is nine
// files, so serial costs a few seconds and buys determinism. The product's OWN concurrency is proven by
// latch-based tests (entry-ordering, not the test runner's parallelism), so disabling runner parallelism does
// not weaken any concurrency guarantee.
//
// THE RATIONALE THIS REPLACED NAMED TWO CLASSES THAT DO NOT EXIST. It justified the whole assembly attribute
// by "live-named-pipe integration tests (DisconnectLifecycleTests, CodesysSourceLiveTests) that stand up real
// BridgePipeHosts" - neither class is anywhere in the repo, and nothing in this suite stands up a pipe host.
// It also carried a `using Volt.Engine.Host;` that was the suite's only reference to that project, and the
// matching ProjectReference in the csproj. A justification that cites work nobody can find is worse than none:
// it cannot be checked, and it survives every attempt to re-derive it.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
