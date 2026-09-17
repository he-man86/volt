using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A BODY THAT DID NOT CHANGE IS NOT WRITTEN — the rule every neighbouring writer already followed.
///
/// <para><c>WriteContent</c> wrote the POU's own declaration and body unconditionally on BOTH drivers, at the
/// end of both paths, so editing one method rewrote the enclosing POU's body as well. Meanwhile
/// <c>TcNetworkWriter.Apply</c> returns null when the archive already says exactly this,
/// <c>CodesysNetworkWriter</c> compares before <c>Set</c>, and <c>OnlyChanged</c> has always dropped unchanged
/// MEMBERS. The textual top-level body was the one thing left out.</para>
///
/// <para><b>It is not free.</b> TwinCAT regenerates a POU's <c>&lt;LineIds&gt;</c> — its per-line identity for
/// breakpoints and ONLINE CHANGE — on any whole-body write, because <c>ImplementationText</c> has no
/// line-level form. Observed directly in the `TwinCAT Project14` fixture: <c>Id="215865" Count="40"</c> became
/// <c>Id="241834" Count="40"</c> over identical ST. A needless rewrite renumbers every line of a body nobody
/// touched, and an online change to a RUNNING PLC then sees a bigger delta than the edit really was.</para>
///
/// <para><b>The hazard this must not reintroduce.</b> Skipping writes here has caused data loss before: a
/// <c>!IsNullOrEmpty</c> guard on TwinCAT meant an EMPTIED body was never cleared, so the POU kept running its
/// old code. That is why the skip requires BOTH sides non-null and equal — <c>null</c> on the live side means
/// "not read" (a marker, an unreadable graphical body), never "empty", and the two are never conflated.</para>
/// </summary>
public class UnchangedBodyIsNotWrittenTests
{
    private const string Decl = "FUNCTION_BLOCK FB_X\nVAR\n\tn : INT;\nEND_VAR";
    private const string Body = "n := n + 1;";

    private static string Source(string body) => $"{Decl}\n(* @volt-implementation *)\n{body}\n\nEND_FUNCTION_BLOCK\n";

    private static FakeIde WithBody(string? body) =>
        new(new FakeIde.Item("FB_X", ItemKind.PlcPouFb, "", true, Decl, body, null, null));

    /// <summary>Push <paramref name="source"/> at the existing item and hand back what the driver was asked to
    /// write — or null if nothing reached it.</summary>
    private static ItemContent? Written(FakeIde ide, string source)
    {
        var refs = RefsService.Handle(ide);
        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new() { new SetItemOp { Name = "FB_X.fb", SourceText = source, IfVersion = refs.Items["FB_X.fb"] } },
        });
        Assert.True(res.Accepted, "push refused: " + (res.Conflicts is null
            ? "(none)"
            : string.Join(" | ", res.Conflicts.Select(c => c.Reason))));

        return ide.WrittenContent.TryGetValue("FB_X", out var c) ? c : null;
    }

    /// <summary>THE REGRESSION. An identical body must not reach the driver at all.</summary>
    [Fact]
    public void An_identical_body_is_not_written()
    {
        var written = Written(WithBody(Body), Source(Body));

        Assert.NotNull(written);
        Assert.Null(written!.Body);
    }

    /// <summary>A CHANGED body is written, obviously — the test that stops the skip from becoming a swallow.</summary>
    [Fact]
    public void A_changed_body_is_written()
    {
        var written = Written(WithBody(Body), Source("n := n + 2;"));

        Assert.NotNull(written);
        Assert.Equal("n := n + 2;", written!.Body);
    }

    /// <summary>AN EMPTIED BODY IS STILL CLEARED. This is the data-loss case: `""` against live text is a real
    /// change, and conflating it with "unchanged" is exactly the bug TwinCAT shipped once.</summary>
    [Fact]
    public void An_emptied_body_is_still_written_so_it_clears()
    {
        var written = Written(WithBody(Body), $"{Decl}\n{ImplementationMarker.Text}\nEND_FUNCTION_BLOCK\n");

        Assert.NotNull(written);
        Assert.NotNull(written!.Body);
        Assert.Equal("", written.Body);
    }

    /// <summary>A body the driver could NOT READ (live null) is never treated as equal to a pushed one. Null is
    /// "not read", not "empty" — skipping there would drop a real write on the strength of a missing value.</summary>
    [Fact]
    public void A_live_body_that_was_not_read_does_not_suppress_the_write()
    {
        var written = Written(WithBody(null), Source(Body));

        Assert.NotNull(written);
        Assert.Equal(Body, written!.Body);
    }

    /// <summary>And the DECLARATION is untouched by this rule — it is written either way. Stated so the
    /// asymmetry is a decision rather than an oversight: a declaration write is a cheap aspect set with no
    /// line bookkeeping behind it, and `ItemContent.Declaration` is non-nullable precisely because an item read
    /// from an IDE always has one. Widening it to carry "unchanged" would make every reader handle a null that
    /// only the write path can produce.</summary>
    [Fact]
    public void The_declaration_is_still_written_when_only_the_body_changed()
    {
        var written = Written(WithBody(Body), Source("n := n + 3;"));

        Assert.NotNull(written);
        Assert.Equal(Decl, written!.Declaration);
    }
}
