using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine;
using Volt.Engine.Library;
using Volt.Engine.Format.St;
using Volt.Engine.Item;

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

    /// <summary>AN <c>EXTENDS</c> ON ITS OWN LINE IS PART OF THE DECLARATION, not a member.
    ///
    /// <para>Found by sweeping a real customer project: Volt PULLED this interface and then refused its own
    /// text with "Expected METHOD/ACTION/PROPERTY at line 1, got: EXTENDS IModuleStartable" — so the POU could
    /// be pulled and never pushed back. The declaration was bounded at the single <c>INTERFACE</c> header line,
    /// which is right when the whole header fits on one line and wrong the moment an engineer (or the IDE)
    /// wraps it, and CODESYS stores it wrapped.</para>
    ///
    /// <para>Only the header CONTINUATIONS are absorbed — <c>EXTENDS</c> and <c>IMPLEMENTS</c>. Consuming
    /// everything up to the first member keyword instead would swallow the comments and pragmas that sit above a
    /// method, which <c>SplitChildren</c> deliberately attaches to that member.</para></summary>
    [Fact]
    public void An_interface_header_may_wrap_onto_its_own_EXTENDS_line()
    {
        var src = string.Join("\n",
            "// Commands specific for a XY control module",
            "INTERFACE IXYControl_Commands",
            "EXTENDS IModuleStartable",
            "",
            "METHOD PUBLIC GetSampleShotRequest : BOOL",
            "END_METHOD",
            "",
            "END_INTERFACE");

        var split = StReader.Read(src);

        Assert.Contains("EXTENDS IModuleStartable", split.Declaration);
        Assert.Equal(new[] { "GetSampleShotRequest" }, split.Members.Select(m => m.Name).ToArray());
    }

    /// <summary>IMPLEMENTS wraps the same way, and several continuations may stack.</summary>
    [Fact]
    public void A_wrapped_header_may_carry_several_continuations()
    {
        var src = string.Join("\n",
            "INTERFACE IThing",
            "EXTENDS IBase",
            "IMPLEMENTS IOther",
            "",
            "METHOD Go : BOOL",
            "END_METHOD",
            "",
            "END_INTERFACE");

        var split = StReader.Read(src);

        Assert.Contains("EXTENDS IBase", split.Declaration);
        Assert.Contains("IMPLEMENTS IOther", split.Declaration);
        Assert.Equal(new[] { "Go" }, split.Members.Select(m => m.Name).ToArray());
    }

    /// <summary>THE BUG (2026-08-28, live CODESYS): an interface read from the IDE reported its members as
    /// <c>interface_method</c>/<c>interface_property</c> - the owner decides the kind - but the same interface
    /// read from TEXT reported plain <c>method</c>/<c>property</c>, because SplitChildren is shared with
    /// function blocks and only sees the keyword. StWriter knew only the IDE's spelling and threw
    /// "No END keyword for POU child kind 'interface_method'", so EVERY interface with a member materialized
    /// as UNREADABLE: created in the project, accepted by push, and absent from /refs.
    /// <para>The two sides must agree, so this asserts the reader's answer directly rather than only that a
    /// round trip survives - a round trip through two halves that share a wrong assumption still passes.</para>
    /// </summary>
    [Fact]
    public void An_interfaces_members_read_from_text_carry_the_interface_scoped_kind()
    {
        var read = StReader.Read(
            "INTERFACE ITest\n" +
            "METHOD Go : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nEND_METHOD\n" +
            "PROPERTY Ready : BOOL\nGET\nEND_GET\nEND_PROPERTY\n" +
            "END_INTERFACE\n");

        Assert.Equal(ItemKind.Kinds.Interface, read.Kind);
        Assert.Equal(
            new[] { ItemKind.Kinds.InterfaceMethod, ItemKind.Kinds.InterfaceProperty },
            read.Members.OrderBy(m => m.Name).Select(m => m.Kind).ToArray());
    }

    /// <summary>And the writer accepts what the reader produces. This is the exact call that threw.</summary>
    [Fact]
    public void An_interface_whose_members_carry_the_interface_scoped_kind_can_be_written()
    {
        var pou = new ItemContent(
            Kind: ItemKind.Kinds.Interface,
            Declaration: "INTERFACE ITest",
            Body: "",
            Members: new List<Member>
            {
                new Member(ItemKind.Kinds.InterfaceMethod, "Go", "METHOD Go : INT", "", null),
                new Member(ItemKind.Kinds.InterfaceProperty, "Ready", "PROPERTY Ready : BOOL", "", null,
                           Getter: new Accessor(null, null)),
            });

        var text = StWriter.Write(pou);

        Assert.Contains("END_METHOD", text);
        Assert.Contains("END_PROPERTY", text);
        Assert.EndsWith("END_INTERFACE\n", text);
        // and it comes back the way it went out
        Assert.Equal(
            new[] { ItemKind.Kinds.InterfaceMethod, ItemKind.Kinds.InterfaceProperty },
            StReader.Read(text).Members.OrderBy(m => m.Name).Select(m => m.Kind).ToArray());
    }

    /// <summary>A MEMBER SIGNATURE MAY CARRY A TRAILING COMMENT — engineers document methods on the signature
    /// line, and CODESYS stores it there.
    ///
    /// <para>Found by sweeping a real customer project: Volt pulled an FB and refused its own text with
    /// "Cannot parse METHOD signature: METHOD INTERNAL _mStrConcatA //Concats string to sContent". The regex
    /// anchors after the optional return type, so anything trailing — a comment — failed the match outright, and
    /// the POU could be pulled and never pushed back.</para></summary>
    [Theory]
    [InlineData("METHOD INTERNAL _mStrConcatA //Concats string to sContent", "_mStrConcatA", null)]
    [InlineData("METHOD PUBLIC Calc : INT // returns the total", "Calc", "INT")]
    [InlineData("METHOD Plain (* a block comment *)", "Plain", null)]
    public void A_method_signature_may_carry_a_trailing_comment(string signature, string name, string? returnType)
    {
        var src = string.Join("\n",
            "FUNCTION_BLOCK FB_Doc",
            "VAR",
            "END_VAR",
            "",
            "END_FUNCTION_BLOCK",
            "",
            signature,
            "VAR_INPUT",
            "END_VAR",
            "END_METHOD");

        var split = StReader.Read(src);

        var member = Assert.Single(split.Members);
        Assert.Equal(name, member.Name);
        Assert.Equal(returnType, member.ReturnType);
    }
}
