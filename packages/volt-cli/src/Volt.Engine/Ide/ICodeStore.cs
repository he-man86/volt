namespace Volt.Engine.Ide;

/// <summary>
/// The TWO code transports, plus the language gate and the non-source manifest read. This is the only
/// surface that moves code in/out of the IDE; the choice between transports is made wholesale by
/// <see cref="BodyLanguage"/> (Core decides — see <c>GraphicalCode</c>). Every method throws on real
/// IDE failure; there is no silent fallback.
/// </summary>
public interface ICodeStore
{
    // ── Transport 1: textual (ST/IL) ──
    string ReadDeclaration(ItemRef item);
    string ReadImplementation(ItemRef item);
    /// <summary>Write an item's text. A <c>null</c> <paramref name="declaration"/> means the item HAS no
    /// declaration and none must be written — actions are the case: they are body-only (their "ACTION
    /// name" line is synthesized on read, never persisted). TwinCAT models this faithfully and rejects a
    /// declaration write on an action; CODESYS silently no-ops it. Passing null is correct on both.</summary>
    void WriteText(ItemRef item, string? declaration, string? implementation);

    // ── Transport 2: PLCopen XML (graphical FBD/LD/CFC/SFC) ──
    /// <summary>The item's graphical body language (<c>FBD</c>/<c>LD</c>/<c>CFC</c>/<c>SFC</c>), or
    /// null for a textual (ST/IL) body. Made as cheap as the vendor allows.</summary>
    string? BodyLanguage(ItemRef item);
    /// <summary>Export the item's whole POU as a PLCopen XML string. Throws on failure (never null).</summary>
    string ReadXml(ItemRef item);
    /// <summary>Import a full PLCopen XML POU back in place; the vendor restores the original on a
    /// failed import before rethrowing.</summary>
    void WriteXml(ItemRef item, string xml);

    // ── Non-source kinds (libraries, tasks, …) ──
    /// <summary>The item's MANIFEST: a canonical text body for a non-source item (library ref, task, device,
    /// project info, trace, recipe, symbol config) — the vendor's metadata rendered as deterministic text. It is
    /// wire-observable twice over: <c>Materializer</c> writes it verbatim as the item's workspace file, and
    /// <c>Hasher</c> takes the item's content version from it. So it is PARITY-CRITICAL — the same project must
    /// yield byte-identical manifests on both vendors (see <c>Library/LibraryManifest</c>, the shared renderer for
    /// <c>.library</c> refs). An item whose vendor exposes no metadata for this kind yields the canonical
    /// kind-stamped body <c>"{kind}\n"</c> — never null, never empty, so the version basis stays stable.
    /// Throws on real IDE failure; there is no silent fallback.</summary>
    // ponytail: the "{kind}\n" literal is still hand-written in BOTH drivers (CodesysDriver.Code.cs /
    // BeckhoffDriver.Code.cs) — pinning the contract here is the cheap half. Upgrade path: a Core helper
    // (ItemKind.EmptyManifest(kind)) both drivers call, so a change to that value can't diverge per vendor.
    // CODESYS additionally falls through to it for a kind whose descriptor reader was never written, which hides a
    // missing implementation instead of failing — decide that loudly in the same pass.
    string ReadManifest(ItemRef item, string kind);
}
