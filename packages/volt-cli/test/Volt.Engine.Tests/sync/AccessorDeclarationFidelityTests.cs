using System.Linq;
using Xunit;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;

namespace Volt.Engine.Tests;

/// <summary>
/// AN ACCESSOR MATERIALIZES WITH THE DECLARATION THE IDE HOLDS — including an empty <c>VAR</c>/<c>END_VAR</c>.
///
/// <para>The read used to DROP a bare empty VAR block, reasoning that it "carries nothing" and that keeping it
/// would write a block "the engineer did not author". MEASURED against live SP21
/// (<c>scripts/probe-accessor-decl.py</c>, pro2193's <c>CassetteFB.NegativeLimitReachedY</c>), CODESYS reports
/// that getter's declaration as exactly <c>VAR\nEND_VAR\n</c>. The engineer did not type it; the PROJECT
/// contains it. ~320 of pro2193's 361 getters disagreed with the IDE because of that drop.</para>
///
/// <para><b>Why nothing caught it, and why this test is shaped as it is.</b> The drop made the round trip look
/// clean by DELETING the difference. The e2e creates properties with NO accessor declaration, CODESYS gives the
/// new accessor its default empty VAR block, and stripping that on read made `pull(push(x)) == x` — so a
/// byte-comparison round trip is structurally blind here, and only an assertion about the MATERIALIZED TEXT
/// against a known IDE state can see it. That is what this is: the fake holds what the vendor was measured to
/// hold, and the file must show it.</para>
/// </summary>
public class AccessorDeclarationFidelityTests
{
    private const string ParentDecl = "FUNCTION_BLOCK FB_Prop\nVAR\n\t_v : INT;\nEND_VAR";

    /// <summary>A POU with one property whose GET holds the vendor's default empty VAR block and whose SET
    /// holds a modifier above it — the exact pair measured on `CassetteFB.NegativeLimitReachedY`.</summary>
    private static FakeIde WithMeasuredProperty() => new(
        new FakeIde.Item("FB_Prop", ItemKind.PlcPouFb, "", true, ParentDecl, "", null, null, Children: new[] { "Val" }),
        new FakeIde.Item("Val", ItemKind.PlcProp, "", false, "PROPERTY Val : INT", null, null, null,
                         Children: new[] { "Get", "Set" }),
        new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "VAR\nEND_VAR", "Val := _v;", null, null),
        new FakeIde.Item("Set", ItemKind.PlcPropSet, "", false, "PRIVATE\nVAR\nEND_VAR", "_v := Val;", null, null));

    private static string Materialized(FakeIde ide) =>
        Materializer.Materialize(ide, "FB_Prop", ItemKind.Kinds.FunctionBlock, new ItemRef("FB_Prop")).Text;

    [Fact]
    public void A_getters_empty_VAR_block_is_written_because_the_IDE_holds_it()
    {
        var text = Materialized(WithMeasuredProperty());

        // The getter's block, verbatim: the declaration the IDE reports, then the body.
        Assert.Contains("GET\nVAR\nEND_VAR\n(* @volt-implementation *)\nVal := _v;\nEND_GET", text);
    }

    [Fact]
    public void A_setters_modifier_and_its_VAR_block_both_survive()
    {
        // This half never broke — a three-line declaration was never dropped — and it is here so the PAIR is
        // pinned. The asymmetry it produced (getter bare, setter not) is what made the loss visible to a reader.
        Assert.Contains("SET\nPRIVATE\nVAR\nEND_VAR\n(* @volt-implementation *)\n_v := Val;\nEND_SET", Materialized(WithMeasuredProperty()));
    }

    /// <summary>A LEADING newline is content; a trailing one is not.
    ///
    /// <para>Six of pro2193's accessors hold <c>\nVAR\nEND_VAR\n</c> — the vendor keeps that distinct from
    /// <c>VAR\nEND_VAR\n</c> and from <c>""</c>, so it is the engineer's blank line and the file can show it.
    /// The TRAILING newline cannot survive: <c>StWriter</c> joins an accessor's keyword, declaration and body
    /// with one, so a declaration ending in a newline would gain a blank line every round trip. Same rule the
    /// whole ST format follows — drop what the format cannot express, keep everything else.</para></summary>
    [Fact]
    public void A_leading_newline_in_an_accessor_declaration_survives()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_Prop", ItemKind.PlcPouFb, "", true, ParentDecl, "", null, null, Children: new[] { "Val" }),
            new FakeIde.Item("Val", ItemKind.PlcProp, "", false, "PROPERTY Val : INT", null, null, null,
                             Children: new[] { "Get" }),
            new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "\nVAR\nEND_VAR\n", "Val := _v;", null, null));

        // The blank line the vendor holds is between GET and VAR, and the trailing newline is gone.
        Assert.Contains("GET\n\nVAR\nEND_VAR\n(* @volt-implementation *)\nVal := _v;\nEND_GET", Materialized(ide));
    }

    [Fact]
    public void An_accessor_the_IDE_reports_nothing_for_still_has_no_declaration()
    {
        // The rule that REMAINS: null or blank is genuinely no declaration, and must not become one. An
        // interface's accessors are bodiless stubs (DIALECT D21) and arrive exactly this way.
        var ide = new FakeIde(
            new FakeIde.Item("FB_Prop", ItemKind.PlcPouFb, "", true, ParentDecl, "", null, null, Children: new[] { "Val" }),
            new FakeIde.Item("Val", ItemKind.PlcProp, "", false, "PROPERTY Val : INT", null, null, null,
                             Children: new[] { "Get" }),
            new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "   ", "Val := _v;", null, null));

        Assert.Contains("GET\n(* @volt-implementation *)\nVal := _v;\nEND_GET", Materialized(ide));
    }
}
