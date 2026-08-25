using Xunit;

// Run this assembly's tests SERIALLY (no cross-class parallelism). The connector suite includes live-named-pipe
// integration tests (DisconnectLifecycleTests, CodesysSourceLiveTests) that stand up real BridgePipeHosts and poll
// for pipes to appear/vanish on fixed timing waits. xUnit runs test classes in parallel by default, and on a loaded
// runner those waits get CPU-starved by the other classes and miss their windows — a pure-contention flake, not a
// logic bug (the same tests pass every time when run alone). The suite is small, so serial costs a few seconds and
// buys determinism. The product's OWN concurrency is proven by latch-based tests (entry-ordering, not the test
// runner's parallelism), so disabling runner parallelism does not weaken any concurrency guarantee.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
