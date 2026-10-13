using Volt.Ide.Twincat;
using Xunit;
using static Volt.Ide.Twincat.TcHierarchy;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE HIERARCHY IS READ BY A PROCESS OF THE XAE's OWN BITNESS (DIALECT C2t): the proxy it loads is the XAE's own
/// <c>Automation\msenvp.dll.manifest</c>, which is of the XAE's bitness. Reading a 32-bit TcXaeShell from the x64 worker
/// needed Visual Studio's 64-bit registration — the field bug; reading a 64-bit TcXaeShell64 (TwinCAT 4026) through the
/// x86 helper would be its mirror. Every cell, because no machine here runs a 64-bit XAE.
/// </summary>
public class TcHierarchySelectionTests
{
    [Theory]
    [InlineData(true, true, "X86Helper")]    // TcXaeShell 15 (x86) from the shipped x64 worker — the field case
    [InlineData(false, true, "InProcess")]   // TcXaeShell64 (x64) from the x64 worker: its own amd64 manifest, in-proc
    [InlineData(true, false, "InProcess")]   // an x86 worker reads an x86 XAE itself
    [InlineData(false, false, "None")]       // an x86 worker has no 64-bit reader: named, never the wrong bitness
    public void The_reader_has_the_xae_bitness(bool xaeIs32Bit, bool workerIs64Bit, string expected) =>
        Assert.Equal(expected, ReaderFor(xaeIs32Bit, workerIs64Bit).ToString());
}
