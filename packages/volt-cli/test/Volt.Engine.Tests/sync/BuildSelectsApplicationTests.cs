using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A BUILD MAY NAME THE APPLICATIONS IT COMPILES (openspec <c>build-selects-application</c>): the roots exactly as
/// <c>refs</c> publishes them in <c>applications</c>. Named, only those are built; absent, every one is, as before; a root
/// the project does not hold is refused by name before anything is built. Each driver's own selection (CODESYS's
/// application build command, TwinCAT's <c>BuildProject</c>) is tested beside it.
/// </summary>
public class BuildSelectsApplicationTests
{
    private const string Line1 = "Line1/Plc Logic/App";
    private const string Line2 = "Line2/Plc Logic/App";

    private static FakeIde TwoApplications()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "a := 1;", Line1),
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "b := 2;", Line2))
        { HealthPlatform = "codesys", HealthProjectName = "Demo" };
        foreach (var device in new[] { "Line1", "Line2" })
        {
            ide.ContainerKinds[device] = ItemKind.Device;
            ide.ContainerKinds[device + "/Plc Logic"] = ItemKind.PlcLogic;
        }
        ide.ContainerKinds[Line1] = ItemKind.Application;
        ide.ContainerKinds[Line2] = ItemKind.Application;
        return ide;
    }

    private static BuildRequest Build(params string[]? applications) => new()
    {
        ExpectedPlatform = "codesys", ExpectedProjectName = "Demo",
        Applications = applications is null ? null : new List<string>(applications),
    };

    /// <summary>2.1 — one application of two: the driver is asked for that one alone.</summary>
    [Fact]
    public void A_build_naming_one_application_builds_that_one_alone()
    {
        var ide = TwoApplications();

        BuildService.Handle(ide, Build(Line1));

        Assert.Equal(new[] { Line1 }, Assert.Single(ide.BuiltApplications));
    }

    /// <summary>A root in another case names the same application (every path on this wire matches ignoring case), and the
    /// driver is handed the IDE's own spelling.</summary>
    [Fact]
    public void A_root_in_another_case_names_the_application_in_the_ides_spelling()
    {
        var ide = TwoApplications();

        BuildService.Handle(ide, Build(Line2.ToUpperInvariant()));

        Assert.Equal(new[] { Line2 }, Assert.Single(ide.BuiltApplications));
    }

    /// <summary>2.2 — a root the project does not hold is BAD_REQUEST naming it, and nothing is built.</summary>
    [Fact]
    public void An_unknown_root_is_refused_by_name_and_nothing_is_built()
    {
        var ide = TwoApplications();

        var ex = Assert.Throws<BridgeException>(() => BuildService.Handle(ide, Build(Line1, "Line3/Plc Logic/App")));

        Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
        Assert.Contains("no application 'Line3/Plc Logic/App' —", ex.Message);
        Assert.Empty(ide.BuildSequence);
    }

    /// <summary>An empty list would build nothing and answer success; it is refused like an unknown root.</summary>
    [Fact]
    public void An_empty_list_is_refused_and_nothing_is_built()
    {
        var ide = TwoApplications();

        var ex = Assert.Throws<BridgeException>(() => BuildService.Handle(ide, Build()));

        Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
        Assert.Contains("applications", ex.Message);
        Assert.Empty(ide.BuildSequence);
    }

    /// <summary>2.3 — absent, every application is built, as today.</summary>
    [Fact]
    public void A_build_naming_no_application_builds_every_one()
    {
        var ide = TwoApplications();

        BuildService.Handle(ide, Build(null));

        Assert.Null(Assert.Single(ide.BuiltApplications));
    }
}
