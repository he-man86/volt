using Xunit;
using Volt.Contracts;

// VoltLog is a process-global singleton (one _dir/_enabled/_level for the whole process — correct for a real
// bridge, which is one process with one log dir). Tests that Init it and read the file back can't run
// concurrently with other classes that also log, so serialize the assembly. The suite is ~100ms; serial is fine.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
