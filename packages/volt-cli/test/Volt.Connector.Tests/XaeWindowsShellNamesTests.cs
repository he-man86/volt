using Volt.Connector;
using Xunit;

namespace Volt.Connector.Tests;

/// <summary>
/// THE 64-BIT SHELL IS A TWINCAT WINDOW TOO (environment audit, 2026-10-13). TwinCAT 3.1.4026 can run its XAE in
/// <c>TcXaeShell64</c>; a probe diagnosis that looks only for <c>TcXaeShell</c> reports "No TcXaeShell window is running"
/// while one sits on screen with a modal open.
/// </summary>
public class XaeWindowsShellNamesTests
{
    [Fact]
    public void Both_the_32_bit_and_the_64_bit_shell_are_looked_for() =>
        Assert.Equal(new[] { "TcXaeShell", "TcXaeShell64" }, XaeWindows.ProcessNames);
}
