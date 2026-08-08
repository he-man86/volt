using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Workspace;
using Volt.Engine.Text;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// An INTERFACE carries its method/property signatures INSIDE the INTERFACE…END_INTERFACE block (not as
/// siblings after END_INTERFACE like an FB's methods). StWriter and StReader must agree on that, or
/// an interface's members are lost on round-trip.
/// </summary>
public class InterfaceRoundTripTests
{
    [Fact]
    public void Interface_members_survive_assemble_then_split()
    {
        var pou = new ItemContent(
            Kind: "interface",
            Declaration: "INTERFACE ITest",
            Body: "",
            Members: new List<Member>
            {
                new Member(
                    Kind: "method", Name: "DoIt", Declaration: "METHOD DoIt : INT", Body: "", Folder: null),
            });

        var st = StWriter.Write(pou);

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

        var split = StReader.Read(st);

        Assert.Equal("interface", split.Kind);
        Assert.Contains(split.Members, c => c.Name == "DoIt");   // member survived the round-trip
    }

    /// <summary>
    /// One canonical form: every interface method is closed by END_METHOD — exactly what `volt pull`
    /// (StWriter) emits. The compact form (no END_METHOD) is NOT a second allowed shape; the bridge
    /// rejects it, and the LSP redlines it, so there is one way in both.
    /// </summary>
    [Fact]
    public void Interface_methods_require_END_METHOD_one_canonical_form()
    {
        // Canonical — column-0 members each closed by END_METHOD, as StWriter emits them.
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
        var split = StReader.Read(canonical);
        Assert.Equal(new[] { "GetEMName", "GetUnitState" }, split.Members.Select(c => c.Name).ToArray());

        // The compact form (no END_METHOD) is rejected — not a second allowed shape.
        var compact = "INTERFACE I_X\nMETHOD Foo : INT\nEND_INTERFACE";
        Assert.Throws<Volt.Engine.BridgeException>(() => StReader.Read(compact));
    }
}
