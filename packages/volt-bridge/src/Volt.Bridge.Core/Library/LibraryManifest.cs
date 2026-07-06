using System.Collections.Generic;
using System.Text;

namespace Volt.Bridge.Core.Library;

/// <summary>The ONE canonical `.library` manifest — the fetch body AND the version-hash basis, identical across
/// vendors. Each driver extracts the raw fields from its own model (CODESYS <c>ILibManItem</c>, TwinCAT item XML)
/// and calls this; neither formats the manifest itself, so CODESYS and TwinCAT emit the same shape on the wire.
/// </summary>
public static class LibraryManifest
{
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
