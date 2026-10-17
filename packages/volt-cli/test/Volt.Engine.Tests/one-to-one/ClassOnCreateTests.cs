using System.Collections.Generic;
using Volt.Engine.Item;
using Xunit;
using static Volt.Engine.Tests.OneToOne.OneToOneSteps;

namespace Volt.Engine.Tests.OneToOne;

/// <summary>
/// FINDING 1 — THE CLASS ON EVERY CREATE (openspec <c>bridge-one-to-one</c> proposal 1, design §1.1 "Classes", §2.2).
///
/// <para>A pulled <c>CheckBounds</c> (<c>POUObjectCheckFunction</c>), a text-list enum, a persistent list, a sender GVL
/// with <c>NetVarProperties</c>, a parameter list and an NVL fold onto the plain kind on read (<c>CodesysTypeMap.cs:58/59/68</c>)
/// and a create makes the plain class (<c>CodesysObjectModel.Libraries.cs:376-382</c>) — the push says ACCEPTED and
/// CODESYS then calls the check 0 times. The design: the class is SPELLED (<c>%CLASS …</c>, <c>%NETVAR</c>,
/// <c>%PARAMETER_LIST</c>) and a create makes it, or is refused by name (NVL: its factory needs its wizard, C2r).</para>
///
/// <para>Closed by 3.1 (the contract carries the properties) and 3.2 (the CODESYS driver reads and creates the class).
/// The FakeIde holds the class as <see cref="FakeIde.Item.Properties"/>; a create the push makes WITH the class must
/// leave it there.</para>
/// </summary>
public class ClassOnCreateTests
{

    public sealed record Case(string Name, string Ext, int Code, string Decl, string? Impl, ObjectProperties Props,
                              string Anchor, string[] Lines, bool CreateRefused = false, bool CreateOrRefuse = false);

    private static readonly Dictionary<string, Case> Cases = new()
    {
        ["check"] = new("CheckBounds", "pou", ItemKind.PlcPou,
            "FUNCTION CheckBounds : DINT\nVAR_INPUT\n\tindex, lower, upper : DINT;\nEND_VAR", "CheckBounds := index;",
            Props(cls: new ObjectClass(ObjectClass.Check, "CheckBounds")),
            "IMPLEMENTATION ST", new[] { "%CLASS CHECK CheckBounds", "CheckBounds := index;" }),
        ["textlist-enum"] = new("IQSlices", "dut", ItemKind.PlcDut,
            "TYPE IQSlices :\n(\n\tSliceA,\n\tSliceB\n);\nEND_TYPE", null,
            Props(cls: new ObjectClass(ObjectClass.TextListEnum, null)),
            "END_TYPE", new[] { "%CLASS TEXTLIST_ENUM" }),
        // A persistent list's CREATE is decided by the completeness oracle 2.1 (design §1.1 classes: factory create if a
        // re-created list reproduces, else refused by name) — either answer passes; a plain GVL made silently does not.
        ["persistent"] = new("PersistentVars", "gvl", ItemKind.PlcGvl,
            "VAR_GLOBAL PERSISTENT RETAIN\n\tn : INT;\nEND_VAR", null,
            Props(cls: new ObjectClass(ObjectClass.Persistent, null)),
            "END_VAR", new[] { "%CLASS PERSISTENT" }, CreateOrRefuse: true),
        ["sender-gvl"] = new("NetVars", "gvl", ItemKind.PlcGvl,
            "VAR_GLOBAL\n\tnShared : INT;\nEND_VAR", null,
            Props(netVar: new[] { new NetVarSetting("ListIdentifier", "1"), new NetVarSetting("Interval", "T#50MS") }),
            "END_VAR", new[] { "%NETVAR ListIdentifier: 1", "%NETVAR Interval: T#50MS" }),
        ["parameter-list"] = new("Params", "gvl", ItemKind.PlcGvl,
            "VAR_GLOBAL CONSTANT\n\tnMax : INT := 10;\nEND_VAR", null,
            Props(parameterList: true),
            "END_VAR", new[] { "%PARAMETER_LIST" }),
        // The NVL's factory needs its wizard (NVLObjectFactory.Create() -> NullReferenceException, C2r): its create is
        // refused by name; an update keeps it (C2n).
        ["nvl"] = new("CAN_TO_PLC", "gvl", ItemKind.PlcGvl,
            "VAR_GLOBAL\n\tbReceived : BOOL;\nEND_VAR", null,
            Props(cls: new ObjectClass(ObjectClass.Nvl, null),
                  netVar: new[] { new NetVarSetting("SenderGVLName", "PLC_TO_CAN"), new NetVarSetting("TaskName", "CanTask") }),
            "END_VAR", new[] { "%CLASS NVL", "%NETVAR SenderGVLName: PLC_TO_CAN", "%NETVAR TaskName: CanTask" },
            CreateRefused: true),
    };

    public static IEnumerable<object[]> Names() { foreach (var k in Cases.Keys) yield return new object[] { k }; }

    private static FakeIde Holding(Case c) =>
        new(new FakeIde.Item(c.Name, c.Code, "Checks", true, c.Decl, c.Impl, null, null) { Properties = c.Props });

    /// <summary>The text a pull of the object must write: its text with the class lines in their place (§1.2).</summary>
    private static string Spelled(Case c) =>
        c.Impl is null
            ? c.Decl + "\n" + string.Join("\n", c.Lines) + "\n"
            : c.Decl + "\nIMPLEMENTATION ST\n" + string.Join("\n", c.Lines) + "\n\nEND_FUNCTION\n";

    [Theory, MemberData(nameof(Names))]
    public void The_pull_spells_the_class(string key)
    {
        var c = Cases[key];
        var text = Pulled(Holding(c), $"Checks/{c.Name}.{c.Ext}");
        Assert.Equal(c.Lines, After(text, c.Anchor, c.Lines.Length));
    }

    [Theory, MemberData(nameof(Names))]
    public void A_create_makes_the_class_or_is_refused_by_name(string key)
    {
        var c = Cases[key];
        var ide = new FakeIde();
        var resp = Create(ide, $"{c.Name}.{c.Ext}", Spelled(c), "Checks");
        if (c.CreateRefused || (c.CreateOrRefuse && !resp.Accepted))
        {
            RefusedNaming(resp, c.Name, c.Lines[0].Split(' ')[0]);
            Assert.False(ide.Exists(c.Name), "a refused create leaves nothing behind");
            return;
        }
        AcceptedOk(resp);
        Assert.Equal(c.Props, ide.PropertiesOf(c.Name));
    }

    /// <summary>An UPDATE with the spelled text keeps the class and writes no property line into the IDE's text: the
    /// lines are the object's properties, not its declaration (a DUT's <c>%CLASS</c> written into its declaration would
    /// be compiled as code).</summary>
    [Theory, MemberData(nameof(Names))]
    public void An_update_with_the_spelled_text_keeps_the_class_and_writes_no_property_line(string key)
    {
        var c = Cases[key];
        var ide = Holding(c);
        var resp = Update(ide, $"Checks/{c.Name}.{c.Ext}", Spelled(c).Replace(c.Decl, "// edited\n" + c.Decl));
        AcceptedOk(resp);
        Assert.Equal(c.Props, ide.PropertiesOf(c.Name));
        HoldsNoPropertyLine(ide.ReadDeclaration(new ItemRef(c.Name)));
        HoldsNoPropertyLine(ide.StoredImplementation(c.Name));
    }

    /// <summary>A class never changes in place (DIALECT C2l): a <c>%CLASS</c> pushed onto an existing object of another
    /// class is refused by name, never a delete + create and never ignored.</summary>
    [Fact]
    public void A_class_change_on_an_existing_object_is_refused_by_name()
    {
        var c = Cases["check"];
        var ide = new FakeIde(new FakeIde.Item(c.Name, c.Code, "Checks", true, c.Decl, c.Impl, null, null));
        var resp = Update(ide, "Checks/CheckBounds.pou", Spelled(c));
        RefusedNaming(resp, "CheckBounds", "%CLASS");
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete:", System.StringComparison.Ordinal));
    }
}
