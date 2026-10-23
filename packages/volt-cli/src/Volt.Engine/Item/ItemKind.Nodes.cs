namespace Volt.Engine.Item;

/// <summary>The IEC tables' codes on the new contract: what a node of a code IS (<see cref="ClassOf"/>) and the one code
/// each kind is created as (<see cref="CreateCode"/>), the conversions a host whose tree answers these codes calls.</summary>
public static partial class ItemKind
{
    /// <summary>What a node of this code IS on the new contract (<see cref="Seam.NodeClass"/>), for a host whose tree
    /// answers these codes: a user folder; an application (an item can be placed in it); the Task Configuration (it takes
    /// tasks); a source item; a member or accessor of one; a task or a descriptor; a transient node; and every other node
    /// a container the walk descends by name. Every code the old engine's predicates read maps to the role they decided
    /// by, so the engine's rules over roles decide what they decided over codes.</summary>
    public static Seam.NodeClass ClassOf(int code) => code switch
    {
        PlcFolder => Seam.NodeClass.Folder,
        Application => Seam.NodeClass.Container(holdsItems: true) with { Noun = NounOf(code) },
        TaskConfig => Seam.NodeClass.Container(false, Kinds.Task) with { Noun = NounOf(code) },
        Skip or Unknown => Seam.NodeClass.Skip with { Noun = NounOf(code) },
        _ when IsTopLevelCrud(code) => Seam.NodeClass.Item(Map(code)!) with { Noun = NounOf(code) },
        _ when IsContainerManager(code) => Seam.NodeClass.Container(false) with { Noun = NounOf(code) },
        _ when IsInlinedInPou(code) && Map(code) is { } member => Seam.NodeClass.Member(member) with { Noun = NounOf(code) },
        _ when Map(code) is { } kind => Seam.NodeClass.Item(kind) with { Noun = NounOf(code) },
        _ => Seam.NodeClass.Container(false) with { Noun = NounOf(code) },
    };

    /// <summary>What a refusal calls a node that is no folder.</summary>
    private static string NounOf(int code) => code switch
    {
        Device => "device node",
        PlcLogic => "PLC logic node",
        TaskConfig => "task configuration node",
        GenericContainer => "container node",
        _ => Map(code) is { } wire ? $"{wire} node" : $"tree node of item type {code}",
    };

    /// <summary>The one code each kind is created as (design 5.Qa, S1): every POU as a function block and every DUT as a
    /// struct — the vendor takes the kind the TEXT declares (DIALECT C2f/C2g, C2h), and a function block accepts every
    /// member kind until the declaration says otherwise (C2k).</summary>
    public static int CreateCode(string kind) => kind switch
    {
        Kinds.Pou => PlcPou,
        Kinds.Dut => PlcDut,
        Kinds.Gvl => PlcGvl,
        Kinds.Interface => PlcItf,
        Kinds.Task => PlcTask,
        Kinds.PropertyGet => PlcPropGet,
        Kinds.PropertySet => PlcPropSet,
        Kinds.InterfacePropertyGet => PlcItfPropGet,
        Kinds.InterfacePropertySet => PlcItfPropSet,
        _ => MemberCode(kind),
    };
}
