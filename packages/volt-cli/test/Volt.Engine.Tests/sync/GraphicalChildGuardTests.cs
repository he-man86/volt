using System.Collections.Generic;
using Volt.Engine;
using Volt.Engine.Sync;
using Volt.Engine.Wire;
using Volt.Engine.Workspace;
using Xunit;

using Volt.Cli.Transport;

namespace Volt.Cli.Tests;

/// <summary>
/// DATA LOSS regression: a read-only graphical (CFC/SFC) POU **child** — a method or action — must never be
/// overwritten by a push.
///
/// <para>The root POU is protected by asking the IDE for its live <c>BodyLanguage</c>. The child path used to
/// decide from the incoming TEXT instead: <c>VgBody.Is(cimpl) &amp;&amp; !VgBody.IsEditable(...)</c>. But a CFC/SFC body
/// has no text form — it materializes as <c>Materializer.GraphicalBodyMarker</c>, i.e.
/// <c>(* @volt-graphical: CFC *)</c> — and <c>VgBody.Is</c> matches ONLY a <c>NETWORK n LANG</c> header, so it
/// REJECTED the marker. The guard therefore never fired for the exact case it existed to stop: the marker fell
/// through to the textual path and <c>ide.WriteText</c> replaced the engineer's graphical body with a comment.</para>
///
/// <para><c>VgBody</c>'s own contract states the rule this pins: CFC/SFC "are not editable, but that is enforced by
/// live IDE state on push, not by any content marker".</para>
/// </summary>
public class GraphicalChildGuardTests
{
    /// <summary>No call that CHANGES the project was made. Reads are fine and expected — a guard has to look
    /// before it refuses; what must not happen is a write, a create (including a folder), a delete or a move.</summary>
    private static void AssertNothingMutated(FakeIde ide) =>
        Assert.DoesNotContain(ide.Recorded, r =>
            r.StartsWith("write") || r.StartsWith("create:") || r.StartsWith("delete:") || r.StartsWith("move:") || r.StartsWith("rename:"));

    private const string PouDecl = "FUNCTION_BLOCK FB_WithGraphicalChild\nVAR\nEND_VAR";

    /// <summary>A POU with one child whose body language is <paramref name="childLang"/> in the IDE.</summary>
    private static FakeIde IdeWithChild(string childName, string? childLang, string childImpl = "x := 1;") => new(
        new FakeIde.Item(Bare, ItemKind.PlcPouFb, "", true, PouDecl, "", null, null,
            new[] { childName }),
        new FakeIde.Item(childName, ItemKind.PlcMethod, "", false, $"METHOD {childName} : INT\nVAR\nEND_VAR",
            childImpl, childLang, null));

    /// <summary>What the CLI actually round-trips for a CFC child: the informational marker.</summary>
    private static string Marker(string lang) => $"(* @volt-graphical: {lang} *)";

    /// <summary>An UPDATE op carrying the item's real current version, so it applies rather than conflicting as a
    /// create (IfVersion == null means "create" — the item exists, so that would be a conflict, not an apply).</summary>
    private static PushResponse Push(FakeIde ide, string body)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = Name,
                    IfVersion = refs.Items[Name],
                    SourceText = $"{PouDecl}\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nVAR\nEND_VAR\n{body}\nEND_METHOD\n",
                },
            },
        });
    }

    /// <summary>IDE items carry BARE names; the extension is added by materialization from the kind, and push
    /// ops are bare-keyed internally. The wire name is the full one.</summary>
    private const string Bare = "FB_WithGraphicalChild";
    private const string Name = Bare + ".fb";

    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    public void Pushing_the_marker_back_over_a_read_only_child_is_refused_not_written(string lang)
    {
        var ide = IdeWithChild("M", lang);

        var resp = Push(ide, Marker(lang));

        // PushService isolates a per-item failure as a CONFLICT rather than faulting the whole batch.
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Contains("read-only", conflict.Reason);
        Assert.Contains("M", conflict.Reason);
        // The point of the test: NOTHING was MUTATED — not the child, and not the root either (the guard is a
        // pre-pass, so a refusal leaves the IDE untouched instead of half-applied). Asserted as "no mutating
        // call" rather than "no call at all": the fake also records READS (`bodylang:`), which the guard makes by
        // design and which change nothing.
        AssertNothingMutated(ide);
    }

    /// <summary>The nastier variant: the client edited the marker away and pushes real ST for a child that is CFC in
    /// the IDE. No content marker can catch this — only the live body language can.</summary>
    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    public void Pushing_real_text_over_a_read_only_child_is_refused_not_written(string lang)
    {
        var ide = IdeWithChild("M", lang);

        var resp = Push(ide, "y := 2;");

        Assert.Contains("read-only", Assert.Single(resp.Conflicts!).Reason);
        AssertNothingMutated(ide);
    }

    /// <summary>A textual push over an EDITABLE graphical child (FBD/LD) would also flatten it — same refusal as the
    /// root POU's "a textual push would overwrite it" case.</summary>
    [Theory]
    [InlineData("FBD")]
    [InlineData("LD")]
    public void Pushing_text_over_an_editable_graphical_child_is_refused(string lang)
    {
        var ide = IdeWithChild("M", lang);

        var resp = Push(ide, "y := 2;");

        Assert.Contains("would overwrite it", Assert.Single(resp.Conflicts!).Reason);
        AssertNothingMutated(ide);
    }

    /// <summary>The guard must not become a blanket refusal: an ordinary TEXTUAL child still pushes.</summary>
    [Fact]
    public void A_textual_child_still_pushes()
    {
        var ide = IdeWithChild("M", childLang: null);

        var resp = Push(ide, "y := 2;");

        Assert.Empty(resp.Conflicts ?? new List<PushConflict>());
        Assert.Contains("write:M", ide.Recorded);   // the child really was written
    }
}
