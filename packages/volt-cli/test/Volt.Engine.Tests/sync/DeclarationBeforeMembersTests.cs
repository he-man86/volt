using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A POU'S DECLARATION LANDS BEFORE ITS MEMBERS ARE CREATED (openspec <c>push-without-header-check</c> 5.Q.4, design O2).
///
/// <para>Which members a POU accepts follows its TEXT on CODESYS, measured live (DIALECT C2k, `kind-audit2.log`):
/// FUNCTION text refuses a method, a property, an action and a transition ("Object 'Method' is not accepted by parent
/// object"), text that declares nothing refuses a method and a property, and a member created BEFORE such text lands is
/// kept by the IDE afterwards. A push used to create the item with its extension's seed, create the members, and only
/// then write the declaration — so a POU whose text says FUNCTION got methods the IDE would have refused, and kept them.
/// Every POU is now <c>X.pou</c> and created with ONE seed (a function block), so the text is the only thing that can
/// tell the IDE what it is; it is shown that text before any member is created.</para>
///
/// <para>The double models C2k (<c>FakeIde.RefusesMembersByText</c>). A member the IDE refuses is refused by name with
/// the IDE's own reason: a create leaves NO item behind, an update says the declaration landed.</para>
/// </summary>
public class DeclarationBeforeMembersTests
{
    private const string Method = "\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nM := TRUE;\nEND_METHOD\n";

    private static FakeIde Codesys(params FakeIde.Item[] items) => new(items) { RefusesMembersByText = true };

    private static PushResponse Push(FakeIde ide, string wireName, string source)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = wireName, SourceText = source, IfVersion = refs.Items.GetValueOrDefault(wireName) },
            },
        });
    }

    private static int IndexOf(FakeIde ide, string entry) => ide.Recorded.IndexOf(entry);

    [Fact]
    public void A_create_writes_the_declaration_before_it_creates_a_member()
    {
        var ide = Codesys();
        var resp = Push(ide, "F.pou",
            "FUNCTION_BLOCK F\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" + Method);

        Assert.True(resp.Accepted, resp.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Equal(new[] { "create:F", "writecontent:F", "create:M", "writecontent:F" }, ide.Recorded.ToArray());
    }

    /// <summary>FUNCTION text with a METHOD: the IDE refuses the method because it has already been shown the text, and
    /// the create is rolled back whole — no shell named <c>F</c> is left in the project. Under the old order the method
    /// was created against the function-block seed and accepted.</summary>
    [Fact]
    public void A_create_whose_text_refuses_its_member_is_refused_by_name_and_leaves_nothing()
    {
        var ide = Codesys();
        var resp = Push(ide, "F.pou", "FUNCTION F : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nF := TRUE;\nEND_FUNCTION" + Method);

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Contains("refused to create its method 'M'", conflict.Reason);
        Assert.Contains("is not accepted by parent object", conflict.Reason);
        Assert.Contains("'F' is not created", conflict.Reason);
        Assert.True(IndexOf(ide, "writecontent:F") < IndexOf(ide, "refused:M"),
                    "the declaration must reach the IDE before the member is created: " + string.Join(", ", ide.Recorded));
        Assert.False(ide.Exists("F"), "a refused create left its shell in the project");
        Assert.False(ide.Exists("M"));
    }

    /// <summary>AN UPDATE IS HELD TO THE SAME ORDER: a function block whose text becomes FUNCTION text and gains a
    /// method is the same silent state otherwise. The declaration has landed when the member is refused, and the
    /// refusal says so; restoring it is <c>push-keeps-what-landed</c>'s, not this change's.</summary>
    [Fact]
    public void An_update_whose_new_text_refuses_its_new_member_says_the_declaration_landed()
    {
        var ide = Codesys(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";"));
        var resp = Push(ide, "K.pou", "FUNCTION K : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nK := TRUE;\nEND_FUNCTION" + Method);

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Contains("refused to create its method 'M'", conflict.Reason);
        Assert.Contains("the declaration of 'K' was written before it and stays", conflict.Reason);
        Assert.StartsWith("FUNCTION K", ide.WrittenContent["K"].Declaration);
        Assert.False(ide.Exists("M"));
    }

    /// <summary>MEMBER DELETES RUN BEFORE MEMBER CREATES (<c>ReconcileMembers</c>), so when the IDE refuses a create on
    /// an UPDATE that also drops a member, that member is already gone from the IDE. The refusal used to say "its members
    /// and body were not" written — or "nothing of 'K' was written" under an unchanged declaration — while method
    /// <c>A</c> had been deleted (5Qa review). It names what was deleted.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK K\nVAR\nEND_VAR", "the declaration of 'K' was written before it and stays")]
    [InlineData("FUNCTION K : BOOL\nVAR\nEND_VAR", "nothing else of 'K' was written")]
    public void An_update_that_drops_a_member_and_is_refused_a_new_one_says_the_drop_landed(string liveDecl, string declSays)
    {
        var pou = FakeIde.Item.TextualPou("K", liveDecl, ";") with { Children = new[] { "A" } };
        var a = new FakeIde.Item("A", ItemKind.PlcMethod, "", false, "METHOD A : BOOL\nVAR\nEND_VAR", "A := TRUE;", null, null);
        var ide = Codesys(pou, a);
        var resp = Push(ide, "K.pou", "FUNCTION K : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nK := TRUE;\nEND_FUNCTION\n\n" +
                                      "METHOD B : BOOL\nIMPLEMENTATION ST\nB := TRUE;\nEND_METHOD\n");

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Contains("refused to create its method 'B'", conflict.Reason);
        Assert.False(ide.Exists("A"));
        Assert.Contains("its method 'A' was deleted before it and stays deleted", conflict.Reason);
        Assert.Contains(declSays, conflict.Reason);
        Assert.DoesNotContain("nothing of 'K' was written", conflict.Reason);
        Assert.DoesNotContain("its members and body were not", conflict.Reason);
    }

    /// <summary>Text that declares nothing takes an action but no method (C2k) — the IDE's answer per member kind, not
    /// a rule of Volt's.</summary>
    [Fact]
    public void A_text_declaring_nothing_takes_an_action_and_refuses_a_method()
    {
        const string broken = "(* Motor\n *\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK";

        var withAction = Codesys();
        var ok = Push(withAction, "B.pou", broken + "\n\nACTION Act\nIMPLEMENTATION ST\n;\nEND_ACTION\n");
        Assert.True(ok.Accepted, ok.Conflicts?.FirstOrDefault()?.Reason);
        Assert.True(withAction.Exists("Act"));

        var withMethod = Codesys();
        var refused = Push(withMethod, "B.pou", broken + Method);
        Assert.False(refused.Accepted);
        Assert.Contains("refused to create its method 'M'", refused.Conflicts![0].Reason);
        Assert.False(withMethod.Exists("B"));
    }

    /// <summary>The early write is only for a push that CREATES a member and CHANGES the declaration: an ordinary edit
    /// is still one content write, and an edit that adds a member under an unchanged declaration needs no early one.</summary>
    [Fact]
    public void An_edit_that_creates_no_member_is_still_one_write()
    {
        var ide = Codesys(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";"));
        var resp = Push(ide, "K.pou", "PROGRAM K\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_PROGRAM\n");

        Assert.True(resp.Accepted, resp.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Equal(new[] { "writecontent:K" }, ide.Recorded.ToArray());

        var unchangedDeclaration = Codesys(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";"));
        var added = Push(unchangedDeclaration, "K.pou",
            "FUNCTION_BLOCK K\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" + Method);
        Assert.True(added.Accepted, added.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Equal(new[] { "create:M", "writecontent:K" }, unchangedDeclaration.Recorded.ToArray());
    }

    /// <summary>ONLY THE IDE'S OWN "NOT ACCEPTED" IS WORDED AS A DECLARATION PROBLEM (5Qa review). A member create that
    /// fails for any other reason — a stale handle ("Unbound tree item"), a transport fault — used to be reported
    /// UNSUPPORTED "the IDE refused to create its method … which members a POU accepts follows its declaration", sending
    /// the engineer to fix text that is fine. The driver recognises the vendor's refusal (<see cref="ChildRefusedException"/>);
    /// anything else is an unclassified fault and reaches the client as one, the create still rolled back.</summary>
    [Fact]
    public void A_member_create_that_fails_for_another_reason_is_not_blamed_on_the_declaration()
    {
        var ide = new FakeIde
        {
            FailCreate = (name, kind) => kind == ItemKind.PlcMethod ? new System.InvalidOperationException("Unbound tree item") : null,
        };
        var resp = Push(ide, "F.pou",
            "FUNCTION_BLOCK F\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" + Method);

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.InternalError, conflict.Code);
        Assert.Contains("Unbound tree item", conflict.Reason);
        Assert.DoesNotContain("refused to create", conflict.Reason);
        Assert.DoesNotContain("follows its declaration", conflict.Reason);
        Assert.False(ide.Exists("F"), "a failed create left its shell in the project");
    }
}
