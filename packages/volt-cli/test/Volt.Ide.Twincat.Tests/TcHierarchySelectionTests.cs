using Xunit;
using static Volt.Ide.Twincat.TcHierarchy;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE HIERARCHY IS READ BY A WORKER OF THE XAE's OWN BITNESS (DIALECT C2t): the proxy it loads is the XAE's own
/// <c>Automation\msenvp.dll.manifest</c>, which is of the XAE's bitness. The connector starts the matching build
/// (<c>TwincatFleetTests</c>); a worker of the other bitness reads nothing and names why. Every cell, because no machine
/// here runs a 64-bit XAE.
/// </summary>
public class TcHierarchySelectionTests
{
    [Theory]
    [InlineData(true, false, true)]    // TcXaeShell 15 (x86) from the x86 worker
    [InlineData(false, true, true)]    // TcXaeShell64 (x64) from the x64 worker: its own amd64 manifest
    [InlineData(true, true, false)]    // a 32-bit XAE from the x64 worker: no x86 proxy in a 64-bit process
    [InlineData(false, false, false)]  // a 64-bit XAE from the x86 worker: its mirror
    public void Only_a_worker_of_the_xae_bitness_reads_the_hierarchy(bool xaeIs32Bit, bool workerIs64Bit, bool reads) =>
        Assert.Equal(reads, Reads(xaeIs32Bit, workerIs64Bit));
}
