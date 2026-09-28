using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;

using Volt.Contracts;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// LD AND FBD ARE OFF UNLESS THE PROCESS SAYS <c>VOLT_GRAPHICAL=1</c> (openspec <c>implementation-keyword</c> 3c).
///
/// <para>Network text is not ready to ship, so a production bridge shows every LD and FBD body as
/// <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c> — the same hidden body a shape the text cannot spell gets, with the reason
/// "LD and FBD are not enabled in this build" — and refuses network text pushed at it by name. ST is untouched, and the
/// declaration of an LD or FBD item stays editable: hidden bodies block neither a pull nor a push (3b). With the switch
/// on, which every test suite and <c>ide.ps1</c> set, everything is as before.</para>
///
/// <para>The switch is read once per process, so these tests turn it off in place (<see cref="Off"/>) and put it back;
/// the engine suite runs its tests one at a time (<c>TestParallelism.cs</c>), so no other test sees it off.</para>
/// </summary>
public class NetworkTextSwitchTests
{
    private const string Decl = "FUNCTION_BLOCK FB_Mix\nVAR\n\tx : INT;\nEND_VAR";

    /// <summary>What the IDE holds for a ladder or a diagram — the fake renders it as network text when it is read.</summary>
    private static string Drawn(string lang) => $"x := {lang.Length};";

    private static FakeIde Ide(string? rungUnsupported = null) => new(
        new FakeIde.Item("FB_Mix", ItemKind.PlcPouFb, "", true, Decl, "x := 1;", null, null, new[] { "Rung", "Box" }),
        new FakeIde.Item("Rung", ItemKind.PlcMethod, "", false, "METHOD Rung : BOOL", Drawn("LD"), "LD", null, null, rungUnsupported),
        new FakeIde.Item("Box", ItemKind.PlcMethod, "", false, "METHOD Box : BOOL", Drawn("FBD"), "FBD", null));

    private static string Pulled(FakeIde ide) =>
        Materializer.Materialize(ide, "FB_Mix", ItemKind.Kinds.FunctionBlock, new ItemRef("FB_Mix")).Text;

    private static PushResponse Update(FakeIde ide, string source)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "FB_Mix.fb", SourceText = source, IfVersion = refs.Items["FB_Mix.fb"] } },
        });
    }

    private static string Why(PushResponse resp) => resp.Conflicts is null
        ? "(none)"
        : string.Join(" | ", resp.Conflicts.Select(c => c.Reason));

    /// <summary>Run <paramref name="body"/> with the switch OFF — a production bridge — and put it back after.</summary>
    private static T Off<T>(Func<T> body)
    {
        var was = NetworkTextSwitch.Enabled;
        NetworkTextSwitch.Enabled = false;
        try { return body(); }
        finally { NetworkTextSwitch.Enabled = was; }
    }

    [Fact]
    public void The_suite_runs_with_the_switch_on()
    {
        // The test suites set VOLT_GRAPHICAL=1 (test/test.runsettings) — without it every network-text test in them
        // would be testing a production build.
        Assert.Equal("1", Environment.GetEnvironmentVariable(NetworkTextSwitch.Variable));
        Assert.True(NetworkTextSwitch.Enabled);
    }

    // ── pull ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Off_every_LD_and_FBD_body_pulls_UNSUPPORTED_and_ST_is_shown()
    {
        var text = Off(() => Pulled(Ide()));

        Assert.Contains("IMPLEMENTATION ST\nx := 1;", text);
        Assert.Contains("METHOD Rung : BOOL\nIMPLEMENTATION LD UNSUPPORTED\nEND_METHOD", text);
        Assert.Contains("METHOD Box : BOOL\nIMPLEMENTATION FBD UNSUPPORTED\nEND_METHOD", text);
        Assert.DoesNotContain("NETWORK", text);
    }

    /// <summary>The reason reaches the pull message, as for any UNSUPPORTED LD or FBD body — and it is the switch's
    /// reason even for a body the text could not have spelled anyway: the switch decides before anything is read.</summary>
    [Fact]
    public void Off_the_fetch_names_each_hidden_body_with_the_switchs_reason()
    {
        var item = Off(() => Assert.Single(
            FetchService.Handle(Ide(rungUnsupported: "a vendor split point"), new FetchRequest { Init = true }).Changed));

        var bodies = item.Unsupported!.OrderBy(u => u.Member).ToList();
        Assert.Equal(new[] { "Box", "Rung" }, bodies.Select(b => b.Member));
        Assert.Equal(new[] { "FBD", "LD" }, bodies.Select(b => b.Language));
        Assert.All(bodies, b => Assert.Equal("LD and FBD are not enabled in this build", b.Reason));
    }

    [Fact]
    public void On_LD_and_FBD_bodies_pull_as_network_text()
    {
        var text = Pulled(Ide());

        Assert.Contains("METHOD Rung : BOOL\nIMPLEMENTATION LD\nNETWORK", text);
        Assert.Contains("METHOD Box : BOOL\nIMPLEMENTATION FBD\nNETWORK", text);
        Assert.DoesNotContain("UNSUPPORTED", text);
    }

    // ── push ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Spec, "network text pushed to a production build": a file pulled from a development build, pushed at a
    /// production bridge, is refused naming LD and FBD, and nothing is written — neither the ladder nor the ST edit
    /// beside it.</summary>
    [Fact]
    public void Off_network_text_pushed_is_refused_by_name_and_nothing_is_written()
    {
        var ide = Ide();
        var pulled = Pulled(ide);                                   // a development build's file
        var edited = pulled.Replace("x := 1;", "x := 2;");
        Assert.NotEqual(pulled, edited);
        var rung = ide.StoredImplementation("Rung");

        var resp = Off(() => Update(ide, edited));

        Assert.False(resp.Accepted, "a production bridge must refuse network text");
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("FB_Mix.fb", conflict.Name);
        Assert.Contains("LD and FBD are not enabled in this build", conflict.Reason);
        // The first network-text body the push meets is the one named — the ladder or the diagram, both refused.
        Assert.Matches("stated 'IMPLEMENTATION (LD|FBD)'", conflict.Reason);
        Assert.Equal("x := 1;", ide.StoredImplementation("FB_Mix"));
        Assert.Equal(rung, ide.StoredImplementation("Rung"));
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("write") || r.StartsWith("decl"));
    }

    /// <summary>Spec, "a production build": the ST body and the LD member's DECLARATION are edited and pushed; both land,
    /// and the ladder the IDE holds is never written.</summary>
    [Fact]
    public void Off_an_LD_members_declaration_and_the_ST_body_are_pushed_and_the_ladder_is_never_written()
    {
        var ide = Ide();
        var rung = ide.StoredImplementation("Rung");
        var text = Off(() => Pulled(ide));
        var edited = text
            .Replace("x := 1;", "x := 2;")
            .Replace("METHOD Rung : BOOL\n", "METHOD Rung : BOOL\nVAR_INPUT\n\tbStart : BOOL;\nEND_VAR\n");
        Assert.NotEqual(text, edited);

        var resp = Off(() => Update(ide, edited));

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Equal("x := 2;", ide.StoredImplementation("FB_Mix"));
        Assert.Contains("bStart : BOOL;",
            ide.ReadContent(new ItemRef("FB_Mix")).Members.Single(m => m.Name == "Rung").Declaration);
        Assert.Equal(rung, ide.StoredImplementation("Rung"));
        Assert.Equal(edited, Off(() => Pulled(ide)));
    }

    /// <summary>The file a production build wrote pushes back unchanged as the ordinary no-op: accepted, and every body
    /// the IDE holds is what it was.</summary>
    [Fact]
    public void Off_the_pulled_file_pushes_back_as_a_no_op()
    {
        var ide = Ide();
        var held = new[] { "FB_Mix", "Rung", "Box" }.Select(ide.StoredImplementation).ToList();
        var text = Off(() => Pulled(ide));

        var resp = Off(() => Update(ide, text));

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Equal(held, new[] { "FB_Mix", "Rung", "Box" }.Select(ide.StoredImplementation));
        Assert.Equal(text, Off(() => Pulled(ide)));
    }
}
