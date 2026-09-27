using System.Collections.Generic;
using System.Text;

namespace Volt.Engine.Library;

/// <summary>The ONE canonical `.library` manifest — the fetch body AND the version-hash basis. Each driver
/// extracts the raw fields from its own model (CODESYS <c>ILibManItem</c>, TwinCAT item XML) and calls this;
/// neither driver formats the manifest LAYOUT itself, so the key/order/line shape is identical on both.
///
/// <para>Two FIELD values are not cross-vendor identical, and that is the current state, not the intent:
/// <c>RESOLUTION</c> is Core-formatted only on TwinCAT (<see cref="Resolution"/>); CODESYS passes the IDE's own
/// display string through (<c>EffectiveResolution</c>'s DisplayName, else <c>DefaultResolution</c>, else the ref
/// name — and its Title+Version fallback isn't even `name, version (distributor)` shaped). <c>SYSTEM</c> is real
/// on CODESYS (<c>SystemLibrary</c>) and hardcoded false on TwinCAT, which exposes no such flag on a reference.
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
    /// <c>NETWORK &lt;n&gt; &lt;LANG&gt;</c> header. A v2 reader refuses format 2's bodies by name ("re-pull").</item>
    /// </list>
    /// Bump it whenever what a pull writes changes meaning: the manifest is the library's version-hash basis, so the bump
    /// itself re-fetches every library on the next pull and restates the number the LSP reads — which is the repair.
    /// (A graphical body needs no bump to be re-fetched: its version hashes its text, which the new writer changes.)</summary>
    public const int Materialization = 3;

    public static string Build(
        string name,
        string @namespace,
        string resolution,
        bool placeholder,
        bool system,
        IReadOnlyList<string>? dependencies = null)
    {
        var sb = new StringBuilder();
        sb.Append("LIBRARY ").Append(name).Append('\n');
        sb.Append("NAMESPACE ").Append(@namespace).Append('\n');
        sb.Append("RESOLUTION ").Append(resolution).Append('\n');
        sb.Append("PLACEHOLDER ").Append(placeholder ? "true" : "false").Append('\n');
        sb.Append("SYSTEM ").Append(system ? "true" : "false").Append('\n');
        // Direct dependencies, by name — the tree captured as a reference (the deps live once in the flat list).
        if (dependencies != null && dependencies.Count > 0)
            sb.Append("DEPENDENCIES ").Append(string.Join(", ", dependencies)).Append('\n');
        sb.Append("MATERIALIZATION ").Append(Materialization).Append('\n');
        return sb.ToString();
    }
}
