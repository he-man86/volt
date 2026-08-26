namespace Volt.Engine.Ide;

/// <summary>
/// The TWO code transports, plus the language gate and the non-source manifest read. This is the only
/// surface that moves code in/out of the IDE; the choice between transports is made wholesale by
/// <see cref="BodyLanguage"/> (Core decides — see <c>NetworkCode</c>). Every method throws on real
/// IDE failure; there is no silent fallback.
/// </summary>
public interface ICodeStore
{
    // ── Transport 1: textual (ST/IL) ──
    // `ReadImplementation` used to sit here. It had ZERO callers through this interface: a POU's body comes out of
    // the PLCopen export with everything else, and DUT/GVL (the only kinds still read as text) have no body slot.
    // Each driver keeps its own object-model body read where it is genuinely needed — TwinCAT's `BodyLanguage`
    // sniffs `ImplementationText` — but that is vendor-internal, not a transport Core asks for.
    string ReadDeclaration(ItemRef item);
    /// <summary>Write an item's text. A <c>null</c> <paramref name="declaration"/> means the item HAS no
    /// declaration and none must be written — actions are the case: they are body-only (their "ACTION
    /// name" line is synthesized on read, never persisted). TwinCAT models this faithfully and rejects a
    /// declaration write on an action; CODESYS silently no-ops it. Passing null is correct on both.</summary>
    void WriteText(ItemRef item, string? declaration, string? implementation);

    // ── Transport 2: the PLCopen DOCUMENT — a POU's whole content ──
    // Not "the graphical transport" any more, which is what this said. `ReadXml` is the PRIMARY read for every POU
    // kind, textual included (declaration, body, methods, actions, properties, accessors all come out of it), and
    // `WriteXml` carries the whole textual POU back. A graphical body is one thing carried IN this document, not
    // the reason for it.
    /// <summary>The item's graphical body language (<c>FBD</c>/<c>LD</c>/<c>CFC</c>/<c>SFC</c>), or
    /// null for a textual (ST/IL) body. Made as cheap as the vendor allows.</summary>
    string? BodyLanguage(ItemRef item);
    /// <summary>Export the item's whole POU as a PLCopen XML string. Throws on failure (never null).</summary>
    string ReadXml(ItemRef item);
    /// <summary>Import a full PLCopen XML POU back in place, MERGING into the existing object (no delete), so a
    /// refused import leaves the original untouched.</summary>
    void WriteXml(ItemRef item, string xml);

    // ── Non-source kinds (libraries, tasks, …) ──
    /// <summary>The item's MANIFEST: a canonical text body for a non-source item (library ref, task, device,
    /// project info, trace, recipe, symbol config) — the vendor's metadata rendered as deterministic text. It is
    /// wire-observable twice over: <c>Materializer</c> writes it verbatim as the item's workspace file, and
    /// <c>Hasher</c> takes the item's content version from it. So it is PARITY-CRITICAL — the same project must
    /// yield byte-identical manifests on both vendors (see <c>Library/LibraryManifest</c>, the shared renderer for
    /// <c>.library</c> refs). An item whose vendor exposes no metadata for this kind yields the canonical
    /// kind-stamped body <c>ItemKind.EmptyManifest(kind)</c> — never null, never empty, so the version basis stays
    /// stable. CODESYS falls through to that SAME body for a kind it tracks but has no descriptor reader for, and
    /// LOGS the missing reader once per session. Throws on real IDE failure; there is no silent fallback.</summary>
    // ponytail (half retired): the "{kind}\n" literal is no longer hand-written per driver — it is
    // ItemKind.EmptyManifest(kind), which BOTH drivers call, so that value can no longer diverge per vendor.
    // ponytail: the CODESYS fall-through for a kind with no descriptor reader is now decided loudly only in the
    // LOG. The BYTES are deliberately left alone: naming the item in the body (Name=<name>) would make the two
    // vendors select this constant by DIFFERENT predicates — CODESYS kind-keyed, TwinCAT "ProduceXml returned
    // empty" — i.e. a new vendor-detectable manifest divergence in exactly the kinds it targets, bought with a
    // one-time rewrite of every .visualization/.text_list/.image_pool file in every existing workspace, after
    // which the item's CONTENT would still be unversioned. The real fix is the missing descriptor readers
    // (visualization, image pool, text list, class diagram); write those and this body stops being reachable
    // for a tracked kind.
    string ReadManifest(ItemRef item, string kind);
}
