using System;
using System.IO;
using System.Linq;
using Volt.Cli.Transport;
using Volt.Engine.Library;
using Volt.Engine.Sync;
using Volt.Engine.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>Observability (bridge-diagnostics-observability): a silently-skipped item leaves a durable log
/// trace — the field signal for "my POU / library type isn't in the workspace". Here we assert the log ENTRY
/// (name + reason) each drop produces.</summary>
public class FetchLoggingTests
{
    private static string ToLog(FakeIde ide, FetchRequest req)
    {
        var dir = Path.Combine(Path.GetTempPath(), "volt-log-test-" + Guid.NewGuid().ToString("N"));
        VoltLog.Init("codesys", dir);
        VoltLog.Level = VoltLogLevel.Debug;   // per-item drop lines are Debug; the summary is Info
        try
        {
            FetchService.Handle(ide, req);
            return string.Concat(Directory.GetFiles(dir, "codesys-*.log").Select(File.ReadAllText));
        }
        finally { VoltLog.Level = VoltLogLevel.Info; try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void An_unmatched_library_element_is_logged_as_the_field_signal()
    {
        var orphan = new LibSignature("SOMEFB", "cmpeventmgr implementation, 3.5 (system)", "FunctionBlock",
            new LibVar[0], new LibVar[0], new LibVar[0], new LibVar[0], null, null);
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("User", "FUNCTION_BLOCK User\nEND_FUNCTION_BLOCK", ""),
            FakeIde.Item.Library("CAA Types", "LIBRARY CAA Types\nNAMESPACE CAA\nRESOLUTION caatypes\n", "Library Manager"))
        { LibSignatures = new[] { orphan } };

        var log = ToLog(ide, new FetchRequest { KnownItems = new() });

        Assert.Contains("SOMEFB", log);
        Assert.Contains("matched no .library ref", log);            // the motivating "my library type is missing" signal
        Assert.Contains("1 lib-unmatched", log);
    }
}
