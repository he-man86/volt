using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// WHICH ROT ENTRIES ARE AN XAE's DTE (environment audit, 2026-10-13). The connector learns which XAE windows to serve
/// from <c>--list-xae-pids</c>, i.e. from this match, so a shell it does not match is a TwinCAT the bridge never
/// attaches to. TwinCAT 3.1.4026 can run the 64-bit <c>TcXaeShell64</c>, whose DTE registers under its own name; the
/// match was the literal <c>TcXaeShell.DTE</c>, which <c>TcXaeShell64.DTE</c> does not contain. (The 64-bit moniker is
/// inferred from the 32-bit one, <c>!TcXaeShell.DTE.15.0:&lt;pid&gt;</c>, and Visual Studio's; no 64-bit XAE runs here.)
/// </summary>
public class TcRotMonikerTests
{
    [Theory]
    [InlineData("!TcXaeShell.DTE.15.0:4242", true)]
    [InlineData("!TcXaeShell64.DTE.17.0:4242", true)]
    [InlineData("!VisualStudio.DTE.17.0:4242", true)]
    [InlineData("!TcXaeShell.Solution.15.0", false)]
    [InlineData("{some-file-moniker}", false)]
    public void An_xae_dte_is_recognised_whatever_the_shell_bitness(string moniker, bool isDte) =>
        Assert.Equal(isDte, RotInstances.IsDteMoniker(moniker));
}
