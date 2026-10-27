using System.Collections.Generic;
using System.Text;

namespace Volt.Engine.Library;

/// <summary>The ONE canonical `.library` manifest — the fetch body AND the version-hash basis. Each driver
/// extracts the raw fields from its own model (CODESYS <c>ILibManItem</c>, TwinCAT item XML) and calls this;
/// neither driver formats the manifest LAYOUT itself, so the key/order/line shape is identical on both.
///
/// <para>Two FIELD values are not cross-vendor identical, and that is the current state, not the intent:
/// <c>RESOLUTION</c> is Core-formatted only on TwinCAT (<see cref="Resolution"/>); CODESYS passes the IDE's own
/// display string through (<c>EffectiveResolution</c>'s DisplayName, else <c>DefaultResolution</c>). <c>SYSTEM</c>,
/// <c>LINKALLCONTENT</c>, <c>QUALIFIEDONLY</c>, <c>OPTIONAL</c>, <c>HIDEWHENREFERENCEDASDEPENDENCY</c> and
/// <c>PUBLISHSYMBOLSINCONTAINER</c> are CODESYS's members (<c>SystemLibrary</c>, <c>LinkAllContent</c>,
/// <c>QualifiedOnly</c>, <c>Optional</c>, <c>HideWhenReferencedAsDependency</c>, <c>PublishSymbolsInContainer</c>;
/// TwinCAT has no system member and no <c>LinkAllContent</c> on a reference, <c>tc-library-system</c>, DIALECT C37; the
/// other four are its <c>QualifiedlAccessOnly</c> / <c>Optional</c> / <c>HideReference</c> / <c>PublishAll</c>, C37b),
/// and each is a flag
/// SPELLED ONLY WHERE IT IS TRUE (openspec <c>bridge-one-to-one</c> §1.2, §2.R): its absence is the value measured on
/// every reference without it, so a CODESYS non-system reference reads byte-identically to TwinCAT's.
/// Making RESOLUTION vendor-identical means having CODESYS hand over the parts and call <see cref="Resolution"/>
/// — it changes manifest bytes, hence library versions, hence a full re-fetch, so it is a deliberate change of
/// its own. Note the string is load-bearing beyond display: <c>Sync/FetchService</c> re-parses the RESOLUTION
/// line and joins it to <c>LibSignature.LibraryPath</c> to folder a library's signatures.</para>
/// </summary>
public static class LibraryManifest
{
    /// <summary>The canonical RESOLUTION string — <c>name, version (distributor)</c>. Built from parts by the
    /// TwinCAT driver only; CODESYS gets its RESOLUTION pre-formatted from the IDE and does NOT call this (see
    /// the class remarks).</summary>
    public static string Resolution(string name, string version, string distributor) =>
        $"{name}, {version} ({distributor})";

    /// <summary>WHICH MATERIALIZATION wrote the workspace, stated in every library manifest so a reader can tell a
    /// stale one. The manifest is the one file a pull always writes that can carry a format number (every project
    /// resolves at least one library, and no source file has a header to put it in), so this names the whole
    /// materialization, not only the declarations beside it — the LSP compares it with its own and names a mismatch
    /// once, where it would otherwise misread every file the other format wrote.
    /// <list type="bullet">
    /// <item>2: FUNCTIONs with no return type are rendered (<c>FUNCTION name</c>) — format 1 skipped them, so a
    /// workspace pulled by it lacks StringUtils' <c>StrTrimA</c>/<c>StrMidA</c>/<c>StrReplaceA</c>, and the LSP, which
    /// knows a library only through its materialization, reports every call to one as undefined. A manifest without
    /// the line is format 1.</item>
    /// <item>3: graphical bodies are network text v2 (<c>docs/network-text.html</c>) — no <c>LET</c>, no numbered
    /// <c>NETWORK &lt;n&gt; &lt;LANG&gt;</c> header.</item>
    /// <item>4: every body states its language on an <c>%LANGUAGE ST|LD|FBD</c> line
    /// (openspec <c>implementation-keyword</c>). A format-3 file has no boundary
    /// line and is refused by name ("pull once").</item>
    /// <item>5: the line is the property line <c>%LANGUAGE ST|LD|FBD</c> (openspec <c>language-line</c>), and a member with
    /// no body slot states none. A format-4 file's <c>%LANGUAGE</c> line is refused by name ("pull again").</item>
    /// </list>
    /// Bump it whenever what a pull writes changes meaning: the manifest is the library's version-hash basis, so the bump
    /// itself re-fetches every library on the next pull and restates the number the LSP reads — which is the repair.
    /// (A graphical body needs no bump to be re-fetched: its version hashes its text, which the new writer changes.)</summary>
    public const int Materialization = 5;

    public static string Build(
        string name,
        string @namespace,
        string resolution,
        bool placeholder,
        bool system,
        IReadOnlyList<string>? dependencies = null,
        bool linkAllContent = false,
        bool qualifiedOnly = false,
        IReadOnlyList<(string Name, string Value)>? parameters = null,
        string? redirect = null,
        bool optional = false,
        bool hideWhenReferencedAsDependency = false,
        bool publishSymbolsInContainer = false)
    {
        var sb = new StringBuilder();
        sb.Append("LIBRARY ").Append(name).Append('\n');
        sb.Append("NAMESPACE ").Append(@namespace).Append('\n');
        sb.Append("RESOLUTION ").Append(resolution).Append('\n');
        sb.Append("PLACEHOLDER ").Append(placeholder ? "true" : "false").Append('\n');
        if (system) sb.Append("SYSTEM true\n");
        if (linkAllContent) sb.Append("LINKALLCONTENT\n");
        if (qualifiedOnly) sb.Append("QUALIFIEDONLY\n");
        // The rest of CODESYS's reference dialog (census: false on all 264 corpus references; the default live fixture
        // holds Optional on CmpCodeMeter and PublishSymbolsInContainer on three Cmp* references). Spelled only where true,
        // like the flags above, so every manifest pulled before they were read keeps its bytes and its version.
        if (optional) sb.Append("OPTIONAL\n");
        if (hideWhenReferencedAsDependency) sb.Append("HIDEWHENREFERENCEDASDEPENDENCY\n");
        if (publishSymbolsInContainer) sb.Append("PUBLISHSYMBOLSINCONTAINER\n");
        // Direct dependencies, by name — the tree captured as a reference (the deps live once in the flat list).
        if (dependencies != null && dependencies.Count > 0)
            sb.Append("DEPENDENCIES ").Append(string.Join(", ", dependencies)).Append('\n');
        // The library's PARAMETERS as the project sets them (openspec bridge-one-to-one §1.1 library manager: TwinCAT's
        // reference `ParameterList`, e.g. Tc2_System's six `PARAM.*`), one line each, in the vendor's order.
        if (parameters != null)
            foreach (var (pname, value) in parameters)
                sb.Append("PARAMETER ").Append(name).Append(' ').Append(pname).Append(" := ").Append(value).Append('\n');
        // The placeholder's REDIRECTION as the library manager holds it (openspec bridge-one-to-one §1.1 library manager:
        // CODESYS's `PlaceholderRedirectionTable`, 193 entries in the corpora) — the resolution the project fixes for this
        // placeholder, the vendor's own string. TwinCAT has no such table (C37).
        if (redirect != null) sb.Append("REDIRECT ").Append(name).Append(' ').Append(redirect).Append('\n');
        sb.Append("MATERIALIZATION ").Append(Materialization).Append('\n');
        return sb.ToString();
    }
}
