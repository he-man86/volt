using Volt.Engine.Item;

namespace Volt.Engine.Format.St;

/// <summary>
/// How the IEC layout lays out a source kind's FILE (design step 4, F6 — a layout fact, not a kind fact):
/// <see cref="Shape.Composite"/>, the file is split into a declaration, a body or members, and an END line (a POU, an
/// interface; a GVL or a DUT is one declaration, read as sent); <see cref="Shape.MembersInside"/>, its members sit INSIDE
/// its block and are signatures (an interface).
/// </summary>
internal static class IecLayout
{
    internal readonly record struct Shape(bool Composite, bool MembersInside);

    internal static Shape Of(string kind) => kind switch
    {
        ItemKind.Kinds.Pou => new Shape(Composite: true, MembersInside: false),
        ItemKind.Kinds.Interface => new Shape(Composite: true, MembersInside: true),
        _ => new Shape(Composite: false, MembersInside: false),
    };
}
