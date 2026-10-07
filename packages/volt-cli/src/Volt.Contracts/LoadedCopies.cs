using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;

namespace Volt.Contracts;

/// <summary>
/// Which copies of Volt's own assemblies, and of the framework assemblies the wire binds, are loaded in THIS process —
/// the evidence the two open field failures need (openspec ide-identity-report 3.1 / 3.2, DIALECT V3).
///
/// <para>WHY: <c>MissingMethodException: Volt.Wire.PipeClient.Call(…Action`1[JsonElement]…)</c> (CODESYS 3.5.17) and
/// <c>MissingFieldException: Volt.Contracts.WireJson.Write</c> (3.5.21.50) are both a member whose signature carries a
/// <c>System.Text.Json</c> type — the shape of a second copy of a Volt or System.Text.Json assembly bound in the
/// CODESYS process. Every unstamped Volt build is <c>1.0.0.0</c>, unsigned, so neither the assembly version nor the
/// file version tells two builds apart; the file's <c>ProductVersion</c> (<c>1.0.0+&lt;commit&gt;</c>, or the stamped
/// release) does, and the location says where each copy came from (the bridge's folder, another folder, the GAC).</para>
///
/// <para>A CONFLICT is either a Volt assembly or System.Text.Json loaded more than once (<see cref="CanConflict"/>), or Volt assemblies from more than one build
/// (distinct <c>ProductVersion</c>s). This only reads; the CODESYS bridge refuses to serve when it finds one at start
/// (openspec <c>codesys-single-load-dependencies</c>: the bridge answers <c>IDE_UNSUPPORTED</c> naming the copies).</para>
///
/// <para>netstandard2.0 and BCL-only, like the rest of this assembly, and it touches no <c>System.Text.Json</c> type:
/// it must still run when that is exactly what failed to bind.</para>
/// </summary>
public static class LoadedCopies
{
    /// <summary>The framework assemblies the wire assemblies bind (System.Text.Json and its dependency closure as the
    /// CODESYS bundle ships it). Every <c>Volt.*</c> assembly is watched as well.</summary>
    public static readonly IReadOnlyList<string> Framework = new[]
    {
        "System.Text.Json", "System.Text.Encodings.Web", "Microsoft.Bcl.AsyncInterfaces", "System.Memory",
        "System.Buffers", "System.Numerics.Vectors", "System.Runtime.CompilerServices.Unsafe",
        "System.Threading.Tasks.Extensions",
    };

    public static bool IsWatched(string? name) =>
        name != null && (name.StartsWith("Volt.", StringComparison.Ordinal) || Framework.Contains(name));

    /// <summary>Whose second copy is a CONFLICT: Volt's own assemblies, and <c>System.Text.Json</c> — the assembly
    /// whose types (<c>JsonElement</c>, <c>JsonSerializerOptions</c>) are in the signatures of both failing members, so
    /// two instances of it split the type identity the wire binds. The rest of <see cref="Framework"/> is listed, not
    /// judged: CODESYS ships its own copies in <c>LacBinaries\GAC_MSIL</c>, and side-by-side strong-named versions of
    /// them are the NORMAL state of a plain CODESYS — measured live on SP21 Patch 4, 2026-10-03: System.Memory
    /// loaded 3 times (4.0.1.1 LacBinaries, 4.0.1.2 Windows GAC, 4.0.5.0 Volt's), Microsoft.Bcl.AsyncInterfaces 2
    /// (5.0.0.0 / 10.0.0.12), System.Threading.Tasks.Extensions 2 (4.2.0.1 / 4.2.4.0), with every Volt call served.
    /// Flagging those would put a "conflict" on every healthy install.</summary>
    public static bool CanConflict(string name) =>
        name.StartsWith("Volt.", StringComparison.Ordinal) || name == "System.Text.Json";

    /// <summary>One loaded copy, as read off the assembly and its file.</summary>
    public sealed class Copy
    {
        public Copy(string name, string? version, string? fileVersion, string? productVersion, string? location, bool gac)
        {
            Name = name; Version = version; FileVersion = fileVersion; ProductVersion = productVersion;
            Location = string.IsNullOrEmpty(location) ? null : location; Gac = gac;
        }

        public string Name { get; }
        public string? Version { get; }
        public string? FileVersion { get; }
        public string? ProductVersion { get; }
        /// <summary>The file it was loaded from; null when it was loaded from bytes.</summary>
        public string? Location { get; }
        public bool Gac { get; }
        public string? Folder => Location == null ? null : Path.GetDirectoryName(Location);

        /// <summary><c>1.0.0.0 (file 1.0.0.0, product 1.0.0+3a59f06a…[, GAC]) at C:\…\Volt.Wire.dll</c>.</summary>
        public string Describe() =>
            Location == null
                ? $"{Version} (no file: loaded from bytes)"
                : $"{Version} (file {FileVersion ?? "?"}, product {ProductVersion ?? "?"}{(Gac ? ", GAC" : "")}) at {Location}";
    }

    /// <summary>Read one assembly. Never throws: a field that cannot be read is <c>?</c> in <see cref="Copy.Describe"/>.
    /// Read once per assembly (health asks every poll); an assembly's file does not change under it.</summary>
    public static Copy Of(Assembly a) => Read.GetValue(a, Fresh);

    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<Assembly, Copy> Read = new();

    private static Copy Fresh(Assembly a)
    {
        var name = a.GetName();
        string? location = null;
        try { if (!a.IsDynamic) location = a.Location; } catch (NotSupportedException) { }
        string? file = null, product = null;
        if (!string.IsNullOrEmpty(location))
        {
            try
            {
                var info = FileVersionInfo.GetVersionInfo(location);
                file = info.FileVersion;
                product = info.ProductVersion;
            }
            catch (Exception) { /* the line shows "?" */ }
        }
        bool gac;
        try { gac = a.GlobalAssemblyCache; } catch (Exception) { gac = false; }
        return new Copy(name.Name ?? "?", name.Version?.ToString(), file, product, location, gac);
    }

    /// <summary>Every watched copy loaded in this process, ordered by name.</summary>
    public static IReadOnlyList<Copy> Loaded() => Loaded(AppDomain.CurrentDomain.GetAssemblies());

    public static IReadOnlyList<Copy> Loaded(IEnumerable<Assembly> assemblies) =>
        assemblies.Where(a => !a.IsDynamic && IsWatched(a.GetName().Name))
                  .Select(Of)
                  .OrderBy(c => c.Name, StringComparer.Ordinal)
                  .ToList();

    /// <summary>The conflicts in <paramref name="copies"/>, one self-contained line each; empty when there is one
    /// copy of each name and one Volt build.</summary>
    public static IReadOnlyList<string> Conflicts(IEnumerable<Copy> copies)
    {
        var all = copies.ToList();
        var lines = new List<string>();
        foreach (var g in all.GroupBy(c => c.Name, StringComparer.Ordinal).Where(g => g.Count() > 1 && CanConflict(g.Key)))
            lines.Add($"{g.Key} loaded {g.Count()} times: " + string.Join("; ", g.Select(c => c.Describe())));

        var builds = Builds(all);
        if (builds.Count > 1)
            lines.Add($"{builds.Count} Volt builds loaded: " + string.Join("; ", builds.Select(b => b.Describe())));
        return lines;
    }

    public static IReadOnlyList<string> Conflicts() => Conflicts(Loaded());

    /// <summary>One Volt build: a <c>ProductVersion</c> (the stamped release, or <c>1.0.0+&lt;commit&gt;</c>), the Volt
    /// assemblies loaded at it, and the folders they came from. Grouped by the version alone: the same build loaded
    /// from a second folder is not a second build — it shows as a name "loaded N times" instead.</summary>
    public sealed class Build
    {
        internal Build(string? productVersion, IReadOnlyList<string> names, IReadOnlyList<string> folders)
        { ProductVersion = productVersion; Names = names; Folders = folders; }

        public string? ProductVersion { get; }
        public IReadOnlyList<string> Names { get; }
        public IReadOnlyList<string> Folders { get; }

        public string Describe() =>
            $"product {ProductVersion ?? "?"} ({string.Join(", ", Names)}) at " +
            (Folders.Count == 0 ? "(no file)" : string.Join(" | ", Folders));
    }

    /// <summary>The Volt builds among <paramref name="copies"/>, by <c>ProductVersion</c>.</summary>
    public static IReadOnlyList<Build> Builds(IEnumerable<Copy> copies) =>
        copies.Where(c => c.Name.StartsWith("Volt.", StringComparison.Ordinal))
              .GroupBy(c => c.ProductVersion ?? "")
              .Select(g => new Build(g.First().ProductVersion,
                                     g.Select(c => c.Name).Distinct().OrderBy(n => n, StringComparer.Ordinal).ToList(),
                                     g.Select(c => c.Folder).Where(f => f != null).Select(f => f!)
                                      .Distinct(StringComparer.OrdinalIgnoreCase).ToList()))
              .OrderBy(b => b.ProductVersion, StringComparer.Ordinal)
              .ToList();
}
