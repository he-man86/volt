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
        return sb.ToString();
    }
}
