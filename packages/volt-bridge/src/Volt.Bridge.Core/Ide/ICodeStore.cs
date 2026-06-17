namespace Volt.Bridge.Core.Ide;

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
    void WriteText(ItemRef item, string? declaration, string implementation);

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
    string ReadManifest(ItemRef item, string kind);
}
