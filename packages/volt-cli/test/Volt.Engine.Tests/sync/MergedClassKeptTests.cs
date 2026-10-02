using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// A SPECIAL CLASS IS KEPT BECAUSE NOTHING RE-CREATES IT (openspec <c>push-without-header-check</c> 5.Q.6, DIALECT C2n).
///
/// <para>Where the IDE stores MORE per object than the wire's extension says — a check function
/// (<c>POUObjectCheckFunction</c>), a text-list enum (<c>TextListEnumerationObject</c>), a persistent list
/// (<c>VarPersistentObject</c>), an NVL (<c>NVLObject</c>), a GVL with network properties, an abstract method
/// (<c>AbstractPOUMethodObject</c>) — a push must never turn the richer object into the plain one. Measured live on
/// CODESYS (<c>scripts/merged-classes.log</c>, Pro2193 and Bakon Nano copies): an update, a rename and a move through the
/// bridge keep the object's GUID and its class, every one of them. A create makes the plain class (three of these have
/// no scripting create at all), so the guarantee is that no update, rename or move ever becomes a delete + a create.</para>
///
/// <para>The double carries the class as a label (<see cref="FakeIde.Item.Class"/>), kept on an in-place write, a rename
/// and a move and lost on a re-create — exactly the vendor's behaviour — so each assertion below fails if the push
/// replaced the object.</para>
/// </summary>
public class MergedClassKeptTests
{
    public static IEnumerable<object[]> Classes() => new[]
    {
        new object[] { "CheckBounds", "pou", "POUObjectCheckFunction",
            new FakeIde.Item("CheckBounds", ItemKind.PlcPou, "Checks", true,
                "FUNCTION CheckBounds : DINT\nVAR_INPUT\n\tindex, lower, upper : DINT;\nEND_VAR",
                "CheckBounds := index;", null, null, Class: "POUObjectCheckFunction") },
        new object[] { "IQSlices", "dut", "TextListEnumerationObject",
            new FakeIde.Item("IQSlices", ItemKind.PlcDut, "DUTs", true,
                "TYPE IQSlices :\n(\n\tSliceA,\n\tSliceB\n);\nEND_TYPE", null, null, null, Class: "TextListEnumerationObject") },
        new object[] { "PersistentVars", "gvl", "VarPersistentObject",
            new FakeIde.Item("PersistentVars", ItemKind.PlcGvl, "GVLs", true,
                "VAR_GLOBAL PERSISTENT RETAIN\n\tn : INT;\nEND_VAR", null, null, null, Class: "VarPersistentObject") },
        new object[] { "CAN_TO_PLC", "gvl", "NVLObject",
            new FakeIde.Item("CAN_TO_PLC", ItemKind.PlcGvl, "GVLs", true,
                "VAR_GLOBAL\n\tbReceived : BOOL;\nEND_VAR", null, null, null, Class: "NVLObject") },
        new object[] { "NetVars", "gvl", "GVLObject+NetVarProperties",
            new FakeIde.Item("NetVars", ItemKind.PlcGvl, "GVLs", true,
                "VAR_GLOBAL\n\tnShared : INT;\nEND_VAR", null, null, null, Class: "GVLObject+NetVarProperties") },
    };

    private static string Text(FakeIde ide, string wire) =>
        FetchService.Handle(ide, new FetchRequest { OnlyItems = new() { wire } }).Changed.Single(i => i.Name == wire).SourceText!;

    private static PushResponse Push(FakeIde ide, SetItemOp op)
    {
        var refs = RefsService.Handle(ide);
        op.IfVersion = refs.Items[op.Name];
        ide.Recorded.Clear();
        return PushService.Handle(ide, new PushRequest { ExpectedProjectVersion = refs.ProjectVersion, Ops = new() { op } });
    }

    private static void AssertKeptInPlace(FakeIde ide, PushResponse resp, string name, string label)
    {
        Assert.True(resp.Accepted, resp.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Equal(label, ide.ClassOf(name));
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete:", System.StringComparison.Ordinal));
        Assert.DoesNotContain(ide.Recorded, r => r == $"create:{name}");
    }

    [Theory]
    [MemberData(nameof(Classes))]
    public void An_update_writes_the_object_in_place_and_keeps_its_class(string name, string ext, string label, FakeIde.Item item)
    {
        var ide = new FakeIde(item);
        var wire = $"{name}.{ext}";

        var resp = Push(ide, new SetItemOp { Name = wire, SourceText = "// edited in the workspace\n" + Text(ide, wire) });

        AssertKeptInPlace(ide, resp, name, label);
        Assert.Contains("edited in the workspace", ide.ReadDeclaration(new Volt.Engine.Item.ItemRef(name)));
    }

    [Theory]
    [MemberData(nameof(Classes))]
    public void A_rename_keeps_the_object_and_its_class(string name, string ext, string label, FakeIde.Item item)
    {
        var ide = new FakeIde(item);

        var resp = Push(ide, new SetItemOp { Name = $"{name}.{ext}", ToName = $"Renamed_{name}.{ext}" });

        AssertKeptInPlace(ide, resp, $"Renamed_{name}", label);
        Assert.Contains(ide.Recorded, r => r == $"rename:{name}->Renamed_{name}");
    }

    [Theory]
    [MemberData(nameof(Classes))]
    public void A_move_with_an_edit_keeps_the_object_and_its_class(string name, string ext, string label, FakeIde.Item item)
    {
        var ide = new FakeIde(item);
        var wire = $"{name}.{ext}";

        var resp = Push(ide, new SetItemOp { Name = wire, ToFolder = "Elsewhere", SourceText = "// moved\n" + Text(ide, wire) });

        AssertKeptInPlace(ide, resp, name, label);
        Assert.Contains(ide.Recorded, r => r.StartsWith($"move:{name}->", System.StringComparison.Ordinal));
    }

    /// <summary>The one special MEMBER class: an abstract method is written in place through its owner, renamed and moved
    /// with it. (A member rename or re-type is a delete + a create of ANOTHER member, never the same identity; and a
    /// method created with ABSTRACT text compiles as abstract on both vendors — recorded, C2n.)</summary>
    [Fact]
    public void An_abstract_method_keeps_its_class_through_its_owners_update_rename_and_move()
    {
        var ide = new FakeIde(
            new FakeIde.Item("Base", ItemKind.PlcPou, "FBs", true, "FUNCTION_BLOCK ABSTRACT Base\nVAR\nEND_VAR", ";", null, null,
                             Children: new[] { "TakePicture" }),
            new FakeIde.Item("TakePicture", ItemKind.PlcMethod, "", false, "METHOD ABSTRACT TakePicture : BOOL\nVAR_INPUT\nEND_VAR",
                             "", null, null, Class: "AbstractPOUMethodObject"));
        const string label = "AbstractPOUMethodObject";

        var text = Text(ide, "Base.pou");
        Assert.Contains("METHOD ABSTRACT TakePicture", text);
        var update = Push(ide, new SetItemOp
        {
            Name = "Base.pou",
            SourceText = text.Replace("METHOD ABSTRACT TakePicture : BOOL", "METHOD ABSTRACT TakePicture : BOOL\n// edited"),
        });
        Assert.True(update.Accepted, update.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Contains(ide.Recorded, r => r == "writecontent:Base");
        Assert.Equal(label, ide.ClassOf("TakePicture"));
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete:", System.StringComparison.Ordinal) || r == "create:TakePicture");

        AssertKeptInPlace(ide, Push(ide, new SetItemOp { Name = "Base.pou", ToName = "Base2.pou" }), "TakePicture", label);
        AssertKeptInPlace(ide, Push(ide, new SetItemOp { Name = "Base2.pou", ToFolder = "Elsewhere" }), "TakePicture", label);
    }
}
