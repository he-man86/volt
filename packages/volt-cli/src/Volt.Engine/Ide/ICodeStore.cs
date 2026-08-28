using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>
/// How code moves in and out of an IDE. <b>The whole surface is Volt's own vocabulary</b> — an
/// <see cref="ItemContent"/> in, an <see cref="ItemContent"/> out — and the engine never learns which
/// transport produced it. Every method throws on real IDE failure; there is no silent fallback.
///
/// <para><b>This interface used to demand a PLCopen document</b>:</para>
/// <code>
/// string ReadXml(ItemRef item);              // "export this POU as PLCopen XML"
/// void   WriteXml(ItemRef item, string xml);
/// string? BodyLanguage(ItemRef item);
/// </code>
/// <para>which made a vendor's file format part of the vendor-neutral contract. Three consequences, all of
/// them real rather than theoretical:</para>
/// <list type="bullet">
/// <item>An IDE with no PLCopen export <b>could not implement the contract at all</b>. TIA Portal is the
/// concrete case: Openness has its own representation and no PLCopen, so a Siemens driver was impossible for
/// a reason that had nothing to do with Siemens.</item>
/// <item>TwinCAT could not adopt its own better transport, because the engine would not accept it — which is
/// how PLCopen's seven checklist failures on TwinCAT became Volt's failures.</item>
/// <item>CODESYS could not hand over the typed objects it actually has, and had to serialize a document
/// instead.</item>
/// </list>
///
/// <para><b>What a driver now owns</b> is everything between its IDE and <see cref="ItemContent"/>: reading a
/// declaration, deciding a body's language, rendering a graphical body to network text, and putting all of it
/// back. What the ENGINE owns is unchanged and is Volt's own: the canonical <c>.fb</c> layout, network text,
/// the model, and sync. <c>BodyLanguage</c> is gone from the contract because the language now arrives INSIDE
/// the content — a second round-trip to ask "what language is this" was the transport leaking upward.</para>
/// </summary>
public interface ICodeStore
{
    /// <summary>Everything about one item: kind, declaration, body language, body, and members with theirs.
    /// A body is workspace TEXT — ST verbatim, a graphical body as network text, an unsupported language as
    /// its marker — because that is what the workspace stores and what the ST layer round-trips.</summary>
    ItemContent ReadContent(ItemRef item);

    /// <summary>Apply content to an item, in place. The driver decides how much of it actually changes: a
    /// write must not disturb what the engineer did not edit, which on CODESYS means mutating the live objects
    /// and on TwinCAT means rewriting only the networks that differ.
    /// <para>A <c>null</c> body means the item HAS no body and none must be written; an EMPTY body means clear
    /// it. That distinction is load-bearing and was paid for once already — TwinCAT skipped empty
    /// implementations, so emptying a body silently kept the old code.</para></summary>
    void WriteContent(ItemRef item, ItemContent content);

    /// <summary>The item's MANIFEST: a canonical text body for a NON-SOURCE item (library ref, task, device,
    /// project info, trace, recipe, symbol config) — the vendor's metadata rendered as deterministic text. It is
    /// wire-observable twice over: <c>Materializer</c> writes it verbatim as the item's workspace file, and
    /// <c>Hasher</c> takes the item's content version from it. So it is PARITY-CRITICAL — the same project must
    /// yield byte-identical manifests on both vendors (see <c>Library/LibraryManifest</c>, the shared renderer
    /// for <c>.library</c> refs). An item whose vendor exposes no metadata for this kind yields the canonical
    /// kind-stamped body <c>ItemKind.EmptyManifest(kind)</c> — never null, never empty, so the version basis
    /// stays stable. Throws on real IDE failure; there is no silent fallback.</summary>
    string ReadManifest(ItemRef item, string kind);
}
