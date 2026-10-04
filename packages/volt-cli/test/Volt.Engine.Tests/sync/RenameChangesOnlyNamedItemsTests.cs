using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A PUSH CHANGES EXACTLY THE ITEMS IT NAMES — a rename too (owner, 2026-10-04, openspec bridge-refusal-review 8.4).
///
/// <para>Each vendor's only item rename differs (DIALECT C2o, C2p): CODESYS rewrites the renamed item's header and
/// nothing else; TwinCAT's runs XAE's rename refactoring, which also rewrites the item's own code references and every
/// caller. The engine puts back what the push did not name, so both answer the CODESYS shape: the renamed item's header
/// changes, every other text stays as it was unless the push sent it. Every test runs on both fake shapes and asserts
/// the same result.</para>
/// </summary>
public class RenameChangesOnlyNamedItemsTests
{
    private const string FbDecl = "// FB_A helper\nFUNCTION_BLOCK FB_A\nVAR\n\tpSelf : POINTER TO FB_A;\nEND_VAR";
    private const string FDecl = "FUNCTION F_A : BOOL\nVAR_INPUT\n\ta : INT;\nEND_VAR";
    private const string CallDecl = "PROGRAM P_Call\nVAR\n\tinst : FB_A; (* an FB_A *)\n\tok : BOOL;\nEND_VAR";
    private const string CallBody = "inst();\nok := F_A(a := 1); // calls F_A";

    private static FakeIde Ide(bool twincat) => new(
        FakeIde.Item.TextualPou("FB_A", FbDecl, "pSelf := 0; // sets FB_A"),
        FakeIde.Item.TextualPou("F_A", FDecl, "F_A := a > 0; // sets F_A"),
        FakeIde.Item.TextualPou("P_Call", CallDecl, CallBody))
    { RewritesReferencesOnRename = twincat, RewritesOwnReferencesOnRename = twincat };

    private static PushResponse Push(FakeIde ide, bool force, params PushOp[] ops) =>
        PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = force ? null : RefsService.Handle(ide).ProjectVersion,
            Force = force,
            ReturnSources = true,
            Ops = ops.ToList(),
        });

    private static string Text(FakeIde ide, string wireName) =>
        FetchService.Handle(ide, new FetchRequest
        {
            KnownItems = new Dictionary<string, string>(),
            OnlyItems = new List<string> { wireName },
        }).Changed.Single().SourceText;

    private static SetItemOp Rename(FakeIde ide, string from, string to) =>
        new() { Name = from, ToName = to, IfVersion = RefsService.Handle(ide).Items[from] };

    /// <summary>A rename alone: the renamed item's header is the only change; the item's own references and the caller
    /// keep the old name, the caller keeps its version, and the answer names only the renamed item.</summary>
    [Theory, InlineData(false), InlineData(true)]
    public void A_rename_alone_changes_the_renamed_items_header_and_nothing_else(bool twincat)
    {
        var ide = Ide(twincat);
        var before = RefsService.Handle(ide).Items;
        var fBefore = Text(ide, "F_A.pou");
        var fbBefore = Text(ide, "FB_A.pou");
        var callBefore = Text(ide, "P_Call.pou");

        var push = Push(ide, false, Rename(ide, "FB_A.pou", "FB_B.pou"), Rename(ide, "F_A.pou", "F_G.pou"));

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Equal(fbBefore.Replace("FUNCTION_BLOCK FB_A", "FUNCTION_BLOCK FB_B"), Text(ide, "FB_B.pou"));
        Assert.Equal(fBefore.Replace("FUNCTION F_A", "FUNCTION F_G"), Text(ide, "F_G.pou"));
        Assert.Equal(callBefore, Text(ide, "P_Call.pou"));
        Assert.Equal(before["P_Call.pou"], push.NewItems!["P_Call.pou"]);
        Assert.Equal(new[] { "FB_B.pou", "F_G.pou" }, push.NewSources!.Keys.OrderBy(k => k, System.StringComparer.Ordinal));
    }

    /// <summary>The same under <c>--force</c>, which skips the pre-flight reads when nothing else asks for them — a
    /// rename asks: the texts it may have to put back are read before it.</summary>
    [Theory, InlineData(false), InlineData(true)]
    public void A_forced_rename_changes_nothing_it_does_not_name(bool twincat)
    {
        var ide = Ide(twincat);
        var callBefore = Text(ide, "P_Call.pou");

        var push = Push(ide, true, new SetItemOp { Name = "FB_A.pou", ToName = "FB_B.pou" });

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Equal(callBefore, Text(ide, "P_Call.pou"));
        Assert.Contains("pSelf : POINTER TO FB_A;", Text(ide, "FB_B.pou"));
    }

    /// <summary>A rename and its callers in one push: the callers hold the text sent, whatever order the ops apply in —
    /// one sent BEFORE the rename (still naming the old name, on purpose) keeps that text too.</summary>
    [Theory, InlineData(false), InlineData(true)]
    public void Callers_sent_with_the_rename_hold_the_text_sent(bool twincat)
    {
        var ide = Ide(twincat);
        var call = Text(ide, "P_Call.pou");
        var renamedCall = call.Replace("inst : FB_A;", "inst : FB_B;");

        var push = Push(ide, false,
            new SetItemOp { Name = "P_Call.pou", IfVersion = RefsService.Handle(ide).Items["P_Call.pou"], SourceText = renamedCall },
            Rename(ide, "FB_A.pou", "FB_B.pou"));
        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Equal(renamedCall, Text(ide, "P_Call.pou"));

        var keptOld = call.Replace("ok : BOOL;", "ok : BOOL; // still F_A");
        var second = Push(ide, false,
            new SetItemOp { Name = "P_Call.pou", IfVersion = RefsService.Handle(ide).Items["P_Call.pou"], SourceText = keptOld },
            Rename(ide, "F_A.pou", "F_G.pou"));
        Assert.True(second.Accepted, second.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Equal(keptOld, Text(ide, "P_Call.pou"));
    }

    /// <summary>Both shapes leave the same project: refs and every text identical.</summary>
    [Fact]
    public void Both_rename_shapes_leave_the_same_project()
    {
        var codesys = Ide(false);
        var twincat = Ide(true);
        foreach (var ide in new[] { codesys, twincat })
            Assert.True(Push(ide, false, Rename(ide, "FB_A.pou", "FB_B.pou"), Rename(ide, "F_A.pou", "F_G.pou")).Accepted);

        Assert.Equal(RefsService.Handle(codesys).Items, RefsService.Handle(twincat).Items);
        foreach (var name in RefsService.Handle(codesys).Items.Keys) Assert.Equal(Text(codesys, name), Text(twincat, name));
    }
}
