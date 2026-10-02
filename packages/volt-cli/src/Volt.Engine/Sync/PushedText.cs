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
    /// <summary>Whether the IDE can publish the ONE object pushed as <paramref name="pushedWireName"/> under
    /// <paramref name="heldWireName"/> instead: the same bare name in another CASE (IEC names are case-insensitive, and
    /// the IDE keeps the spelling of the object it holds) and the same kind. A push writes the text as sent and never
    /// reads its header (openspec <c>push-without-header-check</c>), and a POU is <c>X.pou</c> and a DUT <c>X.dut</c>
    /// whatever their text says (5.Q, 5.P), so a text write moves no object to another name: the case-variant pair is
    /// all that is left. (Until 5.Q, CODESYS re-published a function block whose text said PROGRAM under the program's
    /// extension, DIALECT C2f, and this paired the three POU extensions.) Any other pair is two items (<c>X.pou</c> beside <c>X.dut</c>, the
    /// item-name invariant).</summary>
    public static bool MayBeHeldAs(string pushedWireName, string heldWireName)
    {
        static string? Family(string wireName) => ItemKind.KindForWireName(wireName) switch
        {
            ItemKind.Kinds.Pou => ItemKind.Kinds.Pou,
            ItemKind.Kinds.Dut => ItemKind.Kinds.Dut,
            _ => null,
        };
        return !string.Equals(pushedWireName, heldWireName, System.StringComparison.Ordinal)
               && Family(pushedWireName) is { } family && Family(heldWireName) == family
               && string.Equals(Materializer.Bare(pushedWireName), Materializer.Bare(heldWireName),
                                System.StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Whether <paramref name="held"/> — the IDE's text of <paramref name="wireName"/> after a push — is
    /// <paramref name="pushed"/> but for layout: the same declarations, folders and ST bodies byte for byte, and every
    /// graphical body the same tokens (<see cref="NetworkTextGate.SameTokens"/>) — the one place the format lets layout
    /// vary. A TASK is a descriptor, not ST, and is compared by its own format.
    ///
    /// <para>Read by the WIRE KIND (<see cref="ItemKind.KindForWireName"/>), as the ST reader's contract asks: the
    /// extension is the kind, and the text's header is never read for it.</para></summary>
    public static bool SameExceptLayout(string wireName, string pushed, string held)
    {
        if (ItemKind.IsTaskWireName(wireName)) return TaskDescriptorFormat.SameDescriptor(pushed, held);
        var kind = ItemKind.KindForWireName(wireName)
            ?? throw new System.ArgumentException($"'{wireName}' is not a wire name: its extension names no item kind", nameof(wireName));
        var a = StReader.Read(pushed, kind);
        var b = StReader.Read(held, kind);
        // The outer END line is a token the item content does not carry (the IDE stores no END line; a pull writes it
        // from the declaration's own header, `StWriter`), so it is compared on its own: a pushed END line that does not
        // match its header (`PROGRAM X … END_FUNCTION_BLOCK`) comes back as `… END_PROGRAM`, which is not the pushed
        // text laid out otherwise — the client is told, and the next pull brings the IDE's text in.
        return a.Kind == b.Kind && a.Declaration == b.Declaration && SameBody(a.Body, b.Body)
               && StReader.OuterEndKeyword(pushed, kind) == StReader.OuterEndKeyword(held, kind)
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
