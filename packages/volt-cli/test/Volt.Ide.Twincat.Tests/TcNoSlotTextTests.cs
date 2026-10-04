using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A TEXT SENT AT A SLOT THE OBJECT LACKS IS REFUSED BY NAME, NEVER DROPPED (openspec <c>bridge-refusal-review</c>
/// D26, task 4.26) — the TwinCAT twin of <c>CodesysNoSlotTextTests</c>.
///
/// <para>The driver decided from a KIND table (<c>HasBodySlot</c>) whether to write a body: a kind it listed as
/// bodiless had its body DROPPED and the push said "updated", and an object of a body kind that lacked the member met
/// a raw <c>RuntimeBinderException</c> (INTERNAL_ERROR) after its declaration had landed. The write asks the OBJECT now
/// — the member missing, the classification <c>ReadImplementation</c> already uses — before either slot is written,
/// and refuses <c>UNSUPPORTED</c> naming the item and the slot. Which slots a kind has is the reader's: a GVL's, a
/// property's and an interface member's body is null (<c>StReader</c>), so nothing asks for it.</para>
///
/// <para>The nodes are PUBLIC classes: the driver binds through <c>dynamic</c> (see <see cref="TcWriteTextTests"/>).</para>
/// </summary>
public class TcNoSlotTextTests
{
    /// <summary>An object with a declaration and NO <c>ImplementationText</c> member, as TwinCAT's GVL / DUT / property is.</summary>
    public sealed class DeclarationOnly
    {
        public DeclarationOnly(string name, int itemType, string declaration)
        {
            Name = name;
            ItemType = itemType;
            DeclarationText = declaration;
        }
        public string Name { get; }
        public int ItemType { get; }
        public string DeclarationText { get; set; }
        public int ChildCount => 0;
    }

    /// <summary>An object with a body and NO <c>DeclarationText</c> member, as TwinCAT's action is.</summary>
    public sealed class BodyOnly
    {
        public BodyOnly(string name, string implementation)
        {
            Name = name;
            ImplementationText = implementation;
        }
        public string Name { get; }
        public string ImplementationText { get; set; }
    }

    [Fact]
    public void A_body_at_an_object_with_no_ImplementationText_is_refused_by_name_before_anything_is_written()
    {
        var node = new DeclarationOnly("FB_A", ItemKind.PlcPou, "FUNCTION_BLOCK FB_A");

        var ex = Assert.Throws<BridgeException>(() =>
            new TcObjectModel().WriteText(node, declaration: "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR", implementation: "x := 1;"));

        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("'FB_A'", ex.Message);
        Assert.Contains("Implementation", ex.Message);
        Assert.Equal("FUNCTION_BLOCK FB_A", node.DeclarationText);   // the declaration did not land half a write
    }

    [Fact]
    public void A_declaration_at_an_object_with_no_DeclarationText_is_refused_by_name_before_anything_is_written()
    {
        var node = new BodyOnly("Reset", "x := 0;");

        var ex = Assert.Throws<BridgeException>(() =>
            new TcObjectModel().WriteText(node, declaration: "ACTION Reset", implementation: "x := 1;"));

        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("'Reset'", ex.Message);
        Assert.Contains("Declaration", ex.Message);
        Assert.Equal("x := 0;", node.ImplementationText);
    }

    /// <summary>The driver path: a POU object that lacks the body member, with an ST body pushed at it, is refused
    /// UNSUPPORTED — it was a raw binder throw (INTERNAL_ERROR) after the declaration landed.</summary>
    [Fact]
    public void The_driver_refuses_a_POU_body_at_an_object_without_the_slot()
    {
        var node = new DeclarationOnly("FB_A", ItemKind.PlcPou, "FUNCTION_BLOCK FB_A");

        var ex = Assert.Throws<BridgeException>(() => TcUntouchablePouTests.BoundDriver().WriteContent(new ItemRef(node),
            new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR", "x := 1;", new List<Member>(),
                            Stated: StatedLanguage.St),
            System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>()));

        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Equal("FUNCTION_BLOCK FB_A", node.DeclarationText);
    }

    /// <summary>A body handed to the driver at a kind the deleted table called bodiless (a GVL) was DROPPED and the push
    /// said "updated". The object has no body member, so it is refused by name.</summary>
    [Fact]
    public void A_body_at_a_GVL_is_refused_not_dropped()
    {
        var node = new DeclarationOnly("GVL_Main", ItemKind.PlcGvl, "VAR_GLOBAL\nEND_VAR");

        var ex = Assert.Throws<BridgeException>(() => TcUntouchablePouTests.BoundDriver().WriteContent(new ItemRef(node),
            new ItemContent(ItemKind.Kinds.Gvl, "VAR_GLOBAL\nEND_VAR", "g := 1;", new List<Member>(), Stated: StatedLanguage.St),
            System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>()));

        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("'GVL_Main'", ex.Message);
    }

    /// <summary>A GVL as the reader sends it — no body — lands its declaration through the same write, with no kind
    /// table deciding (the node has no body member to be asked).</summary>
    [Fact]
    public void A_GVL_with_no_body_lands_its_declaration()
    {
        var node = new DeclarationOnly("GVL_Main", ItemKind.PlcGvl, "VAR_GLOBAL\nEND_VAR");
        var pushed = Volt.Engine.Format.St.StReader.Read("VAR_GLOBAL\n\tg : INT;\nEND_VAR", ItemKind.Kinds.Gvl);
        Assert.Null(pushed.Body);   // the producer sends no body for a kind without a slot

        TcUntouchablePouTests.BoundDriver().WriteContent(new ItemRef(node), pushed,
            System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

        Assert.Equal("VAR_GLOBAL\n\tg : INT;\nEND_VAR", node.DeclarationText);
    }
}
