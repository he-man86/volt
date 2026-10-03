using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// A PUSHED GLOBAL VARIABLE LIST IS ONE BY ITS WIRE KIND (openspec <c>push-without-header-check</c> 5.Q.7, design G2).
///
/// <para><see cref="ProjectDeclarations.Globals"/> took the IDE's GVLs by class (<c>PlcGvl</c>) and the PUSHED ones by
/// their first code line (<c>StDeclaration.IsGlobalListHeader</c>, deleted). The two halves disagreed on exactly one
/// corpus file — bakon-nano's <c>Variable_Configuration.gvl</c>, which opens with <c>VAR_CONFIG</c> — and on every GVL
/// whose text is broken: pulled, it was in a graphical body's scope; pushed, it was not. Both halves take the kind now,
/// and a POU whose text happens to open with <c>VAR_GLOBAL</c> is no global list.</para>
/// </summary>
public class GlobalsByWireKindTests
{
    private const string VarConfig = "VAR_CONFIG\n\tPLC_PRG.x AT %IX0.0 : BOOL;\nEND_VAR";
    private const string Broken = "(* the variables of the line\nVAR_GLOBAL\n\tnBroken : INT;\nEND_VAR";
    private const string GlobalText = "VAR_GLOBAL\n\tnInPou : INT;\nEND_VAR";

    private static IEnumerable<string> Globals(PushedDeclarations pushed) =>
        new ProjectDeclarations(new FakeIde(), _ => null, Scopes.RefusedPouName).Globals(pushed);

    [Fact]
    public void A_pushed_gvl_opening_with_VAR_CONFIG_is_a_global_list()
    {
        var pushed = PushedDeclarations.FromWire(new[] { ("Variable_Configuration", (string?)ItemKind.Kinds.Gvl, VarConfig) });
        Assert.Contains(VarConfig, Globals(pushed));
    }

    [Fact]
    public void A_pushed_gvl_whose_text_opens_an_unclosed_comment_is_a_global_list()
    {
        var pushed = PushedDeclarations.FromWire(new[] { ("Line", (string?)ItemKind.Kinds.Gvl, Broken) });
        Assert.Contains(Broken, Globals(pushed));
    }

    [Fact]
    public void A_pushed_pou_whose_text_opens_with_VAR_GLOBAL_is_not_a_global_list()
    {
        var pushed = PushedDeclarations.FromWire(new[] { ("NotAList", (string?)ItemKind.Kinds.Pou, GlobalText) });
        Assert.DoesNotContain(GlobalText, Globals(pushed));
        Assert.Equal(GlobalText, pushed.ByName["NotAList"]);   // still a declaration a body can resolve against
    }

    /// <summary>The IDE half is unchanged: its GVLs are taken by class, and a pushed one REPLACES the IDE's of that name.</summary>
    [Fact]
    public void The_ides_gvls_are_taken_by_class_and_a_pushed_one_replaces_its_namesake()
    {
        var ide = new FakeIde(
            new FakeIde.Item("Live", ItemKind.PlcGvl, "", true, "VAR_GLOBAL\n\tnLive : INT;\nEND_VAR", null, null, null),
            new FakeIde.Item("Variable_Configuration", ItemKind.PlcGvl, "", true, "VAR_CONFIG\nEND_VAR", null, null, null));
        var declarations = new ProjectDeclarations(ide, r => ide.ReadDeclaration(r), Scopes.RefusedPouName);
        var pushed = PushedDeclarations.FromWire(new[] { ("Variable_Configuration", (string?)ItemKind.Kinds.Gvl, VarConfig) });

        var globals = declarations.Globals(pushed).ToList();

        Assert.Contains(VarConfig, globals);
        Assert.Contains(globals, g => g.Contains("nLive"));
        Assert.DoesNotContain("VAR_CONFIG\nEND_VAR", globals);
    }

    /// <summary>Through the push itself: the declarations a body's scope is built from (the pre-flight, openspec
    /// <c>bridge-refusal-review</c> D8) carry the wire kind of each pushed item.</summary>
    [Fact]
    public void A_body_in_a_push_sees_each_pushed_gvl_as_a_global_list()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("Caller", "FUNCTION_BLOCK Caller\nVAR\n\tn : INT;\nEND_VAR",
            "IMPLEMENTATION FBD\nNETWORK\n  n := 1;\nEND_NETWORK"));
        var refs = RefsService.Handle(ide);
        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "Caller.pou", IfVersion = refs.Items["Caller.pou"],
                    SourceText = "FUNCTION_BLOCK Caller\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION FBD\nNETWORK\n  n := 2;\nEND_NETWORK\nEND_FUNCTION_BLOCK\n",
                },
                new SetItemOp { Name = "Variable_Configuration.gvl", ToFolder = "", SourceText = VarConfig + "\n" },
                new SetItemOp { Name = "Line.gvl", ToFolder = "", SourceText = Broken + "\n" },
                new SetItemOp { Name = "NotAList.pou", ToFolder = "", SourceText = "FUNCTION_BLOCK NotAList\n" + GlobalText + "\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n" },
            },
        });
        Assert.True(resp.Accepted, resp.Conflicts?.FirstOrDefault()?.Reason);

        var globals = Assert.Single(ide.ScopesPushed).Globals.ToList();
        Assert.Contains(globals, g => g.Contains("VAR_CONFIG"));
        Assert.Contains(globals, g => g.Contains("nBroken"));
        Assert.DoesNotContain(globals, g => g.Contains("nInPou"));
    }
}
