using Volt.Engine.Item;
namespace Volt.Cli.Sync;


public enum Access { R, Rw }

public sealed record ExtensionDef(string Ext, Access DefaultAccess);

/// <summary>
/// CLI-side extension registry: maps a workspace filename to its access (rw for source items, r for
/// references). The extension list + access is NOT re-declared here — it is DERIVED from
/// <see cref="ItemKind.FileExtensions"/> (the one canonical table), so a new kind is added in exactly one
/// place. A graphical CFC/SFC body is the same rw .fb/.prg/.fun (a push over it is refused by the bridge on
/// live IDE state, not pre-filtered here).
/// </summary>
public static class Extensions
{
    private static readonly ExtensionDef[] All =
        ItemKind.FileExtensions.Select(x => new ExtensionDef(x.Ext, x.IsWritable ? Access.Rw : Access.R)).ToArray();

    // ORDINAL, as the engine reads a wire name: a file name IS its wire name, so `E_Mode.Enum` is not the
    // `E_Mode.enum` the IDE publishes. Matched case-blind here it was pushed under its own spelling and then never
    // matched by the Ordinal baseline, version guard or removal sweep — a later edit was refused as a create beside
    // itself, and a DUT deleted in the IDE kept its file. Now it is a foreign file, refused by name before a push.
    private static readonly Dictionary<string, ExtensionDef> ByExt =
        All.ToDictionary(d => "." + d.Ext, StringComparer.Ordinal);

    private static ExtensionDef? GetByExt(string ext) => ByExt.TryGetValue(ext, out var d) ? d : null;

    private static ExtensionDef? GetByPath(string relPath)
    {
        var slash = relPath.LastIndexOf('/');
        var baseName = slash >= 0 ? relPath.Substring(slash + 1) : relPath;
        var dot = baseName.LastIndexOf('.');
        return dot < 0 ? null : GetByExt(baseName.Substring(dot));
    }

    /// <summary>The full filename from a workspace path ("POUs/FB_Motor.fb" → "FB_Motor.fb"). Matches the
    /// bridge's wire names (which include extensions).
    ///
    /// <para>There was a FOLDER-MARKER arm here that resolved `POUs/.gitkeep` to the folder name `POUs`.
    /// Nothing has written a `.gitkeep` since folders stopped being items (`Materialize`: "legacy `.gitkeep`
    /// files are only READ back — never produced here"), and what survived was a trap: `IsTrackedPath` said yes
    /// while `IsPushable` said no, so a `.gitkeep` an engineer added by hand showed as an outgoing change every
    /// `volt status` and `volt push` answered "nothing to push", forever. It now falls through to the same
    /// foreign-file refusal every other unsyncable file in `src/` gets, which says so by name.</para></summary>
    public static string? FullNameFromPath(string relPath)
    {
        var slash = relPath.LastIndexOf('/');
        var baseName = slash >= 0 ? relPath.Substring(slash + 1) : relPath;
        var dot = baseName.LastIndexOf('.');
        if (dot < 0) return null;
        return GetByExt(baseName.Substring(dot)) == null ? null : baseName;
    }

    /// <summary>The extension definition for a full filename ("PLC_PRG.prg" → { ext:"prg", rw }).</summary>
    public static ExtensionDef? DefFromName(string fullName)
    {
        var dot = fullName.LastIndexOf('.');
        return dot < 0 ? null : GetByExt(fullName.Substring(dot));
    }

    public static bool IsTrackedPath(string relPath)
    {
        if (relPath == ".gitattributes") return true;
        return GetByPath(relPath) != null;
    }

    /// <summary>The extensions a push writes, and those it only reads, in table order — for the text that names
    /// them to a person (the push's refusal, the scaffolded README). Rendered from the table rather than typed out:
    /// a hand-kept list there was item-kind knowledge in the CLI and had already drifted (it named files no Volt
    /// writes, and missed `.task`, which a push writes).</summary>
    public static IEnumerable<string> PushableExtensions => All.Where(d => d.DefaultAccess == Access.Rw).Select(d => d.Ext);
    public static IEnumerable<string> ReadOnlyExtensions => All.Where(d => d.DefaultAccess == Access.R).Select(d => d.Ext);

    public static bool IsPushable(string relPath) => GetByPath(relPath)?.DefaultAccess == Access.Rw;
    public static bool IsReadOnly(string relPath) => GetByPath(relPath)?.DefaultAccess == Access.R;

    /// <summary>Normalize EVERY workspace file to LF — the bridge always emits LF, so without this Windows git
    /// (core.autocrlf) round-trips the un-attributed read-only kinds through CRLF and pull/push see spurious drift.</summary>
    public static string GitattributesContent() => "* text=auto eol=lf\n";
}
