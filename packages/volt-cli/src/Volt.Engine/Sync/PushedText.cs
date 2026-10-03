using System.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Format.Task;
using Volt.Engine.Ide;
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
    /// extension, DIALECT C2f, and this paired the three POU extensions; it kept a POU/DUT whitelist after that, which left a
    /// GVL or an interface in another case unpaired.) Any other pair is two items (<c>X.pou</c> beside <c>X.dut</c>, the
    /// item-name invariant).</summary>
    public static bool MayBeHeldAs(string pushedWireName, string heldWireName)
    {
        return !string.Equals(pushedWireName, heldWireName, System.StringComparison.Ordinal)
               && ItemKind.KindForWireName(pushedWireName) is { } kind && ItemKind.KindForWireName(heldWireName) == kind
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
        if (!(a.Kind == b.Kind && a.Declaration == b.Declaration
               && StReader.OuterEndKeyword(pushed, kind) == StReader.OuterEndKeyword(held, kind)
               && a.Members.Count == b.Members.Count && a.Members.Zip(b.Members, SameMember).All(same => same)))
            return false;
        // Declarations, members and accessors agree; every body is compared in the scope it resolves against.
        return SourceScopes.BodiesOf(a).Zip(SourceScopes.BodiesOf(b), (x, y) => SameBody(x.Body, y.Body, x.Declaration))
                           .All(same => same);

        static bool SameMember(Member x, Member y) =>
            x.Kind == y.Kind && x.Name == y.Name && x.Declaration == y.Declaration && x.Folder == y.Folder
            && x.ReturnType == y.ReturnType && x.DataType == y.DataType
            && (x.Getter is null) == (y.Getter is null) && (x.Setter is null) == (y.Setter is null)
            && x.Getter?.Declaration == y.Getter?.Declaration && x.Setter?.Declaration == y.Setter?.Declaration;
    }

    /// <summary>One body against the other: byte-equal, the same tokens (<see cref="NetworkTextGate.SameTokens"/>), or
    /// — since another SPELLING of a graphical body is written and comes back canonical (openspec
    /// <c>bridge-refusal-review</c> 2.12) — the same canonical text. The canonical form is read against the body's own
    /// declarations only (<paramref name="declaration"/>): the CLI has no project to resolve against, and both texts are
    /// read in that one scope, so equal canonical renderings are one model. A text that does not read in it is not
    /// claimed to be the same.</summary>
    private static bool SameBody(string? x, string? y, string? declaration)
    {
        if (x == y) return true;
        if (x is null || y is null || !NetworkText.Is(x) || !NetworkText.Is(y)) return false;
        if (NetworkTextGate.SameTokens(x, y)) return true;
        var scope = NetworkScope.FromDeclarations(declaration, _ => null, () => System.Array.Empty<string>());
        var cx = NetworkTextGate.Validate(x, scope);
        var cy = NetworkTextGate.Validate(y, scope);
        return cx.Canonical is { } canonicalX && cy.Canonical is { } canonicalY && canonicalX == canonicalY;
    }
}
