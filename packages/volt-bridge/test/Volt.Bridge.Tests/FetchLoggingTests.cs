using System;
using System.IO;
using System.Linq;
using Volt.Bridge.Core.Diagnostics;
using Volt.Bridge.Core.Library;
using Volt.Bridge.Core.Sync;
using Volt.Bridge.Core.Wire;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>Observability (bridge-diagnostics-observability): a silently-skipped item now leaves a durable log
/// trace — the field signal for "my POU / library type isn't in the workspace". The drop BEHAVIOUR is covered by
/// <see cref="FetchExclusionTests"/>; here we assert the log ENTRY (name + reason) each drop produces.</summary>
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

    private static FakeIde.Item Pou(string name, bool excluded = false) =>
        FakeIde.Item.TextualPou(name, $"FUNCTION_BLOCK {name}\nEND_FUNCTION_BLOCK\n", "") with { ExcludeFromBuild = excluded };

    [Fact]
    public void An_excluded_from_build_item_is_logged_with_its_name_and_reason()
    {
        var log = ToLog(new FakeIde(Pou("Good"), Pou("Bad", excluded: true)), new FetchRequest { KnownItems = new() });

        Assert.Contains("exclude-from-build 'Bad'", log);           // the per-item entry names what was skipped + why
        Assert.Contains("(skipped: 1 exclude-from-build)", log);    // and the completion line tallies it
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

        var log = ToLog(ide, new FetchRequest { Verbose = true, KnownItems = new() });

        Assert.Contains("SOMEFB", log);
        Assert.Contains("matched no .library ref", log);            // the motivating "my library type is missing" signal
        Assert.Contains("1 lib-unmatched", log);
    }
}
