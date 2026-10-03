using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A MEMBER'S KIND IS ITS CLASS, AND THE FILE MUST SAY THE SAME (openspec <c>push-without-header-check</c> 5.Q.5, M-a).
///
/// <para>Both drivers report a member's kind from the IDE object — a method, a property, an action — never from its
/// text. But the push reads a member's kind from the keyword that opens its block, and CODESYS keeps a member's class
/// whatever text it is given (DIALECT C2l, `kind-audit.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/kind-audit.log`): a <c>POUMethodObject</c> given <c>PROPERTY</c> text stays
/// a method; given <c>FUNCTION_BLOCK</c> text it stays one too). Pulled verbatim, such a member reads back on the next
/// push as another kind — the method deleted and a property created (<c>ReconcileMembers</c>' re-type) — under a push
/// that changed nothing, or the file cannot be split at all.</para>
///
/// <para>So the pull refuses the ITEM, naming the member, its class and the keyword its text opens with — as it refuses
/// a text no file can carry (<c>RefuseRetiredComment</c>): listed unreadable, the workspace file left alone. 0 of
/// 57,275 member blocks in the six corpora disagree (design 5.Qa).</para>
/// </summary>
public class MemberKindIsItsClassTests
{
    private static FakeIde WithMethod(string memberDeclaration) => new(
        new FakeIde.Item("K", ItemKind.PlcPou, "", true, "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";", null, null,
                         Children: new[] { "M" }),
        new FakeIde.Item("M", ItemKind.PlcMethod, "", false, memberDeclaration, "M := 1;", null, null));

    [Theory]
    [InlineData("PROPERTY M : INT", "PROPERTY")]
    [InlineData("FUNCTION_BLOCK M\nVAR\nEND_VAR", "FUNCTION_BLOCK")]
    [InlineData("// a note\nACTION M", "ACTION")]
    public void A_method_whose_text_opens_with_another_keyword_is_refused_on_pull(string declaration, string opens)
    {
        var ide = WithMethod(declaration);

        var ex = Assert.Throws<BridgeException>(() =>
            Materializer.Materialize(ide, "K", ItemKind.Kinds.Pou, new ItemRef("K")));

        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("'K'", ex.Message);
        Assert.Contains("method 'M'", ex.Message);
        Assert.Contains($"opens with '{opens}', not METHOD", ex.Message);
    }

    /// <summary>The item is listed unreadable, never published under a name or a text a push would turn into
    /// another member.</summary>
    [Fact]
    public void The_refused_item_is_listed_unreadable_and_not_published()
    {
        var refs = RefsService.Handle(WithMethod("PROPERTY M : INT"));

        Assert.DoesNotContain("K.pou", refs.Items.Keys);
        Assert.Contains("K", refs.Unreadable);
    }

    /// <summary>The check reads the member's text the way the child splitter does: comments, pragmas and attributes
    /// before the keyword are trivia, the keyword's case is layout, and a modifier after it changes nothing.</summary>
    [Theory]
    [InlineData("METHOD M : INT")]
    [InlineData("{attribute 'hide'}\n// doc\n(* more *)\nMETHOD PUBLIC M : INT")]
    [InlineData("method M : INT")]
    [InlineData("METHOD ABSTRACT M : INT")]
    public void A_method_whose_text_opens_with_METHOD_pulls(string declaration)
    {
        var item = Materializer.Materialize(WithMethod(declaration), "K", ItemKind.Kinds.Pou, new ItemRef("K"));

        Assert.Equal("K.pou", item.FullName);
        Assert.Contains(declaration, item.Text.Replace("\r\n", "\n"));
        // What the pull writes, a push reads back — the whole point of the check.
        var back = Volt.Engine.Format.St.StReader.Read(item.Text, ItemKind.Kinds.Pou, "K");
        Assert.Equal("method", Assert.Single(back.Members).Kind);
    }

    /// <summary>A NESTED COMMENT BEFORE <c>METHOD</c> (5Qa review, 5.E.1). Comments nest, so the member's class and its
    /// text agree, and the push's child splitter reads through the same skipper (<c>StTrivia</c>): the member pulls and
    /// its file is read back with the method in it. Until 5.E.1 the splitter did not nest, read the word after the inner
    /// <c>*)</c> as code, and the pull had to refuse the item, since no push could read its file back.</summary>
    [Fact]
    public void A_method_after_a_nested_comment_pulls_and_reads_back()
    {
        var item = Materializer.Materialize(WithMethod("(* outer (* inner *) still comment *)\nMETHOD M : INT"), "K",
            ItemKind.Kinds.Pou, new ItemRef("K"));

        var back = Volt.Engine.Format.St.StReader.Read(item.Text, ItemKind.Kinds.Pou, "K");
        var m = Assert.Single(back.Members);
        Assert.Equal(("method", "M"), (m.Kind, m.Name));
        Assert.StartsWith("(* outer (* inner *) still comment *)", m.Declaration);
    }

    /// <summary>A property is held to PROPERTY the same way.</summary>
    [Fact]
    public void A_property_whose_text_opens_with_METHOD_is_refused_on_pull()
    {
        var ide = new FakeIde(
            new FakeIde.Item("K", ItemKind.PlcPou, "", true, "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";", null, null,
                             Children: new[] { "P" }),
            new FakeIde.Item("P", ItemKind.PlcProp, "", false, "METHOD P : INT", null, null, null));

        var ex = Assert.Throws<BridgeException>(() =>
            Materializer.Materialize(ide, "K", ItemKind.Kinds.Pou, new ItemRef("K")));

        Assert.Contains("property 'P'", ex.Message);
        Assert.Contains("opens with 'METHOD', not PROPERTY", ex.Message);
    }

    /// <summary>And the round trip it protects: a pulled file pushed back unchanged never deletes and re-creates a
    /// member.</summary>
    [Fact]
    public void An_unchanged_file_pushed_back_neither_deletes_nor_creates_a_member()
    {
        var ide = WithMethod("METHOD M : INT");
        var refs = RefsService.Handle(ide);
        var text = Materializer.Materialize(ide, "K", ItemKind.Kinds.Pou, new ItemRef("K")).Text;

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "K.pou", SourceText = text, IfVersion = refs.Items["K.pou"] } },
        });

        Assert.True(resp.Accepted, resp.Conflicts?.FirstOrDefault()?.Reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete:") || r.StartsWith("create:"));
    }
}
