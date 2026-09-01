using Xunit;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Ide;

namespace Volt.Engine.Tests;

/// <summary>
/// THE INTERFACE-ACCESSOR REFUSAL (DIALECT D21), asserted once for both vendors.
///
/// <para>An interface property's GET/SET carries only the fact that it EXISTS. Writing one can hard-crash
/// TcXaeShell, so both drivers refuse — and the refusal had no test on either side, which is the worst place for
/// a gap: it guards against a crash, and the thing it replaced was a SILENT return.</para>
///
/// <para>That silent return is the failure these pin the shape of. The pull materializes an editable
/// <c>GET … END_GET</c> in the <c>.itf</c> file, an engineer edits it, every gate downstream passes it, and the
/// receipt bakes the pushed text into the baseline — so the edit is discarded and <c>volt status</c> reports in
/// sync. Accepted, and landed nothing.</para>
///
/// <para>Both directions matter equally. Refusing too much is just as bad: an unchanged restatement is what a
/// push of the ENCLOSING interface looks like every single time, so a guard that fired on those would make any
/// interface holding a property unpushable.</para>
/// </summary>
public class InterfaceAccessorGuardTests
{
    /// <summary>A RESTATEMENT PASSES. This is the ordinary case — pushing an interface re-sends its accessors
    /// verbatim — and it must stay a no-op or the whole item becomes unpushable.</summary>
    [Fact]
    public void An_unchanged_restatement_is_allowed()
        => InterfaceAccessorGuard.RefuseIfChanged("VAR\nEND_VAR", "x := 1;", "VAR\nEND_VAR", "x := 1;");

    /// <summary>AND SO DOES A REFORMAT. Whitespace is not an edit, and the materializer itself introduces
    /// trailing newlines — refusing over one would block a push nobody made a change in.</summary>
    [Fact]
    public void Whitespace_only_differences_are_not_a_change()
        => InterfaceAccessorGuard.RefuseIfChanged("VAR\nEND_VAR", "x := 1;",
                                                  "  VAR\nEND_VAR  ", "\nx := 1;\n");

    /// <summary>A CHANGED BODY IS REFUSED, LOUDLY.</summary>
    [Fact]
    public void A_changed_body_is_refused()
    {
        var ex = Assert.Throws<BridgeException>(() =>
            InterfaceAccessorGuard.RefuseIfChanged("VAR\nEND_VAR", "x := 1;", "VAR\nEND_VAR", "x := 2;"));

        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
    }

    /// <summary>AND SO IS A CHANGED DECLARATION — the half that is easy to forget, because an accessor's
    /// declaration looks like scaffolding rather than code.</summary>
    [Fact]
    public void A_changed_declaration_is_refused()
        => Assert.Throws<BridgeException>(() =>
            InterfaceAccessorGuard.RefuseIfChanged("VAR\nEND_VAR", "x := 1;",
                                                   "VAR\n\tn : INT;\nEND_VAR", "x := 1;"));

    /// <summary>THE TWINCAT SHAPE: live state blank by construction, so anything non-blank pushed is a change.
    /// `ReadMember` builds an interface accessor as <c>new Accessor(null, null)</c> there, which is why that
    /// driver needs no COM read to decide — it passes the blanks straight in.</summary>
    [Theory]
    [InlineData("VAR\nEND_VAR", null)]
    [InlineData(null, "x := 1;")]
    [InlineData("VAR\nEND_VAR", "x := 1;")]
    public void Anything_pushed_at_a_blank_accessor_is_refused(string? declaration, string? body)
        => Assert.Throws<BridgeException>(() =>
            InterfaceAccessorGuard.RefuseIfChanged(null, null, declaration, body));

    /// <summary>BUT BLANK AGAINST BLANK IS STILL A NO-OP. Every push of an interface reaches here with exactly
    /// this — a bodiless accessor restated — so if it threw, no interface with a property could ever be
    /// pushed at all.</summary>
    [Theory]
    [InlineData(null, null)]
    [InlineData("", "")]
    [InlineData("   ", "\n\n")]
    public void Blank_against_blank_is_a_no_op(string? declaration, string? body)
        => InterfaceAccessorGuard.RefuseIfChanged(null, null, declaration, body);

    /// <summary>THE MESSAGE TELLS THE ENGINEER WHAT TO DO. A refusal that only says "unsupported" sends someone
    /// looking for a mistake in what they wrote; this one names the limit and the way around it, and it is the
    /// reason the guard is shared rather than written out per driver.</summary>
    [Fact]
    public void The_refusal_names_the_limit_and_the_way_around_it()
    {
        var ex = Assert.Throws<BridgeException>(() =>
            InterfaceAccessorGuard.RefuseIfChanged(null, null, null, "x := 1;"));

        Assert.Contains("not writable", ex.Message);
        Assert.Contains("make the change in the IDE and pull", ex.Message);
    }
}
