using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Workspace;
using Volt.Engine.Workspace.SourceText;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// An INTERFACE carries its method/property signatures INSIDE the INTERFACE…END_INTERFACE block (not as
/// siblings after END_INTERFACE like an FB's methods). PouToStText and StSplitter must agree on that, or
/// an interface's members are lost on round-trip.
/// </summary>
public class InterfaceRoundTripTests
{
    [Fact]
    public void Interface_members_survive_assemble_then_split()
    {
        var pou = new PouData(
            Kind: "interface",
            Declaration: "INTERFACE ITest",
            BodyText: "",
            Children: new List<ChildData>
            {
                new ChildData(
                    Kind: "method", Name: "DoIt", Declaration: "METHOD DoIt : INT", BodyText: "", Folder: null,
                    GetterCode: null, SetterCode: null, GetterDeclaration: null, SetterDeclaration: null),
            });

        var st = PouToStText.Convert(pou);

        // Golden: the WHOLE emitted text. The member must sit INSIDE the block — a sibling after
        // END_INTERFACE still splits back to a child named DoIt, so the round-trip assertions below
        // cannot see the very placement this test exists for.
        Assert.Equal(string.Join("\n",
            "INTERFACE ITest",
            "",
            "METHOD DoIt : INT",
            "END_METHOD",
            "",
            "END_INTERFACE",
            ""), st);

        var split = StSplitter.SplitSt(st);

        Assert.Equal("interface", split.PouKind);
        Assert.Contains(split.Children, c => c.Name == "DoIt");   // member survived the round-trip
    }

    /// <summary>
    /// One canonical form: every interface method is closed by END_METHOD — exactly what `volt pull`
    /// (PouToStText) emits. The compact form (no END_METHOD) is NOT a second allowed shape; the bridge
    /// rejects it, and the LSP redlines it, so there is one way in both.
    /// </summary>
    [Fact]
    public void Interface_methods_require_END_METHOD_one_canonical_form()
    {
        // Canonical — column-0 members each closed by END_METHOD, as PouToStText emits them.
        var canonical = string.Join("\n",
            "INTERFACE I_EquipmentModule EXTENDS I_PackMLStateMachine",
            "",
            "METHOD GetEMName : STRING",
            "END_METHOD",
            "",
            "METHOD GetUnitState : INT",
            "END_METHOD",
            "",
            "END_INTERFACE");
        var split = StSplitter.SplitSt(canonical);
        Assert.Equal(new[] { "GetEMName", "GetUnitState" }, split.Children.Select(c => c.Name).ToArray());

        // The compact form (no END_METHOD) is rejected — not a second allowed shape.
        var compact = "INTERFACE I_X\nMETHOD Foo : INT\nEND_INTERFACE";
        Assert.Throws<Volt.Engine.BridgeException>(() => StSplitter.SplitSt(compact));
    }
}
