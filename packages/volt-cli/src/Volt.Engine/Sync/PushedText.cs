using System.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Format.Task;
using Volt.Engine.Item;

namespace Volt.Engine.Sync;

/// <summary>
/// The post-push question — is the IDE's text of a pushed item the pushed text laid out otherwise? — answered by the
/// same per-kind format dispatch the push gates an item by, in the engine that owns it. The CLI used to carry its own
/// copy of that dispatch (a second task check, an ST read without the wire kind), and the copy is what drifted: a
/// `.task` reached the ST reader after the IDE had applied the push.
/// </summary>
public static class PushedText
{
    /// <summary>Whether <paramref name="held"/> — the IDE's text of <paramref name="wireName"/> after a push — is
    /// <paramref name="pushed"/> but for layout: the same declarations, folders and ST bodies byte for byte, and every
    /// graphical body the same tokens (<see cref="NetworkTextGate.SameTokens"/>) — the one place the format lets layout
    /// vary. A TASK is a descriptor, not ST, and is compared by its own format.
    ///
    /// <para>Read by the WIRE KIND (<see cref="ItemKind.KindForWireName"/>), as the ST reader's contract asks wherever a
    /// wire name exists: the extension is the kind, so a text whose header says otherwise is refused, never compared
    /// as another kind.</para></summary>
    public static bool SameExceptLayout(string wireName, string pushed, string held)
    {
        if (ItemKind.IsTaskWireName(wireName)) return TaskDescriptorFormat.SameDescriptor(pushed, held);
        var kind = ItemKind.KindForWireName(wireName);
        var a = StReader.Read(pushed, kind);
        var b = StReader.Read(held, kind);
        return a.Kind == b.Kind && a.Declaration == b.Declaration && SameBody(a.Body, b.Body)
               && a.Members.Count == b.Members.Count && a.Members.Zip(b.Members, SameMember).All(same => same);

        static bool SameMember(Member x, Member y) =>
            x.Kind == y.Kind && x.Name == y.Name && x.Declaration == y.Declaration && x.Folder == y.Folder
            && x.ReturnType == y.ReturnType && x.DataType == y.DataType && SameBody(x.Body, y.Body)
            && SameAccessor(x.Getter, y.Getter) && SameAccessor(x.Setter, y.Setter);

        static bool SameAccessor(Accessor? x, Accessor? y) =>
            x is null ? y is null : y is not null && x.Declaration == y.Declaration && SameBody(x.Body, y.Body);

        static bool SameBody(string? x, string? y) =>
            x == y || (x is not null && y is not null && NetworkText.Is(x) && NetworkText.Is(y) && NetworkTextGate.SameTokens(x, y));
    }
}
