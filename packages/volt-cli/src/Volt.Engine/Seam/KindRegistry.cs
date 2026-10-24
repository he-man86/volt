using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Contracts;
using Volt.Engine.Item;

namespace Volt.Engine.Seam;

/// <summary>What an item of a kind IS to the engine.</summary>
public enum KindRole
{
    /// <summary>A text file the engine reads and writes through the kind's <see cref="IItemFormat"/>.</summary>
    Source,
    /// <summary>A manifest the host renders (<c>ReadManifest</c>); a push never writes it.</summary>
    Descriptor,
    /// <summary>A manifest a push writes back (today: <c>task</c>).</summary>
    WritableDescriptor,
    /// <summary>A part of a source item (a method, a routine): no file, no extension.</summary>
    Member,
}

/// <summary>One kind, as a vendor declares it. <see cref="Kind"/> is the engine's word for it, <see cref="Extension"/>
/// the wire's (<c>&lt;folder&gt;/&lt;name&gt;.&lt;Extension&gt;</c>, and the workspace file's), <see cref="Shape"/> what a
/// source or member kind's text holds, and <see cref="Format"/> a source kind's file layout.</summary>
public sealed record KindRow(string Kind, string? Extension, KindRole Role, KindShape? Shape = null, IItemFormat? Format = null)
{
    public static KindRow Source(string kind, string extension, KindShape shape, IItemFormat format) =>
        new(kind, extension, KindRole.Source, shape, format);

    public static KindRow Descriptor(string kind, string extension, bool writable = false) =>
        new(kind, extension, writable ? KindRole.WritableDescriptor : KindRole.Descriptor);

    public static KindRow Member(string kind, KindShape shape) => new(kind, null, KindRole.Member, shape);

    /// <summary>The same row: every field, the format by its name (two hosts each hold their own instance of one format).</summary>
    public bool SameAs(KindRow other) =>
        Kind == other.Kind && Extension == other.Extension && Role == other.Role && Equals(Shape, other.Shape)
        && Format?.Name == other.Format?.Name;

    public override string ToString() =>
        $"{Kind} ({Role}{(Extension is null ? "" : ", ." + Extension)}{(Format is null ? "" : ", format " + Format.Name)})";
}

/// <summary>
/// THE kind table, filled by the hosts (vendor-neutrality S1): an extension names a kind and picks its handler, each
/// host states its own kinds, and nothing above the seam holds the list. A kind two hosts share (the CODESYS family's
/// <c>pou</c>) is registered by both and must be spelled alike: registration refuses one kind with two extensions, one
/// extension for two kinds, and one kind with another role, shape or format — naming both vendors.
/// <para>Lookups refuse by name too: an extension no host registered is <c>BAD_REQUEST</c> naming it and the known set.</para>
/// </summary>
public sealed class KindRegistry
{
    private static readonly Regex Word = new("^[a-z][a-z0-9_]*$", RegexOptions.CultureInvariant);

    private readonly Dictionary<string, KindRow> _byKind = new(StringComparer.Ordinal);
    private readonly Dictionary<string, KindRow> _byExtension = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SortedSet<string>> _vendors = new(StringComparer.Ordinal);

    public void Register(string vendor, IEnumerable<KindRow> rows)
    {
        if (rows is null) throw new ArgumentNullException(nameof(rows));
        foreach (var row in rows) Register(vendor, row);
    }

    public void Register(string vendor, KindRow row)
    {
        if (row is null) throw new ArgumentNullException(nameof(row));
        if (!Word.IsMatch(row.Kind ?? ""))
            throw Conflict(vendor, $"kind '{row.Kind}' is no lower-case word");
        if (row.Role == KindRole.Member ? row.Extension is not null : !Word.IsMatch(row.Extension ?? ""))
            throw Conflict(vendor, row.Role == KindRole.Member
                ? $"member kind '{row.Kind}' has the extension '{row.Extension}': a member is no file"
                : $"kind '{row.Kind}' has the extension '{row.Extension}', which is no lower-case word");
        if (row.Role is KindRole.Source or KindRole.Member && row.Shape is null)
            throw Conflict(vendor, $"kind '{row.Kind}' is a {row.Role} with no shape");
        if ((row.Role == KindRole.Source) != (row.Format is not null))
            throw Conflict(vendor, row.Role == KindRole.Source
                ? $"source kind '{row.Kind}' has no file format"
                : $"kind '{row.Kind}' is a {row.Role} and has a file format; only a source kind is read through one");

        if (_byKind.TryGetValue(row.Kind!, out var held) && !held.SameAs(row))
            throw Conflict(vendor, $"kind '{row.Kind}' is {row} here but {held} as {Owners(row.Kind!)} registered it");
        if (row.Extension is { } ext && _byExtension.TryGetValue(ext, out var other) && other.Kind != row.Kind)
            throw Conflict(vendor, $"the extension '.{ext}' names kind '{row.Kind}' here but kind '{other.Kind}' as " +
                                   $"{Owners(other.Kind)} registered it");

        _byKind[row.Kind!] = row;
        if (row.Extension is { } e) _byExtension[e] = row;
        if (!_vendors.TryGetValue(row.Kind!, out var owners)) _vendors[row.Kind!] = owners = new SortedSet<string>(StringComparer.Ordinal);
        owners.Add(vendor);
    }

    /// <summary>Every row, in kind order.</summary>
    public IReadOnlyList<KindRow> Rows => _byKind.Values.OrderBy(r => r.Kind, StringComparer.Ordinal).ToList();

    /// <summary>The vendors that registered <paramref name="kind"/>, in ordinal order (empty for an unknown kind).</summary>
    public IReadOnlyList<string> VendorsOf(string kind) =>
        _vendors.TryGetValue(kind, out var v) ? v.ToList() : new List<string>();

    /// <summary>The row of <paramref name="kind"/>, or null.</summary>
    public KindRow? Find(string kind) => _byKind.TryGetValue(kind ?? "", out var row) ? row : null;

    /// <summary>The row of a kind the caller already holds (from a walk or a wire name): a miss is Volt's bug.</summary>
    public KindRow Require(string kind) =>
        Find(kind) ?? throw new ArgumentException($"no host registered the kind '{kind}'", nameof(kind));

    /// <summary>The row an extension names. An extension no host registered is the CLIENT's request naming nothing:
    /// <c>BAD_REQUEST</c>, naming it and every known extension.</summary>
    public KindRow ForExtension(string extension) =>
        _byExtension.TryGetValue(extension ?? "", out var row)
            ? row
            : throw new BridgeException(BridgeErrorCodes.BadRequest,
                $"'.{extension}' is no item extension a host registered (known: {string.Join(", ", Extensions.Select(x => "." + x))})");

    /// <summary>The kind a wire name denotes, read off the extension after its LAST dot (<c>POUs/Motor.blk</c> is
    /// <c>blk</c>'s kind) — refused like <see cref="ForExtension"/> when it names none, and when there is no extension.</summary>
    public KindRow ForWireName(string wireName)
    {
        var dot = (wireName ?? "").LastIndexOf('.');
        if (dot < 0 || dot < wireName!.LastIndexOf('/'))
            throw new BridgeException(BridgeErrorCodes.BadRequest, $"'{wireName}' has no extension, so it names no item kind");
        return ForExtension(wireName.Substring(dot + 1));
    }

    /// <summary>The row of the item kind a wire name denotes by the extension after its last dot, or null when it names
    /// none — for the caller that refuses such a name in its own words (a push names the op).</summary>
    public KindRow? FindByWireName(string wireName)
    {
        var dot = (wireName ?? "").LastIndexOf('.');
        return dot < 0 ? null : _byExtension.TryGetValue(wireName!.Substring(dot + 1), out var row) ? row : null;
    }

    /// <summary>The extension of an item kind. A member kind or an unknown one has none: Volt's bug, refused by name.</summary>
    public string ExtensionOf(string kind) =>
        Require(kind).Extension ?? throw new ArgumentException($"kind '{kind}' is a member and has no extension", nameof(kind));

    /// <summary>Every item extension, in ordinal order.</summary>
    public IReadOnlyList<string> Extensions => _byExtension.Keys.OrderBy(x => x, StringComparer.Ordinal).ToList();

    /// <summary>THE source extension set: what <c>bun run check</c> compares the LSP, volt-control, VS Code and plugin copies
    /// against. In ordinal order.</summary>
    public IReadOnlyList<string> SourceExtensions =>
        _byExtension.Values.Where(r => r.Role == KindRole.Source).Select(r => r.Extension!).OrderBy(x => x, StringComparer.Ordinal).ToList();

    private string Owners(string kind) => string.Join(" and ", VendorsOf(kind));

    private static VoltInvariantException Conflict(string vendor, string what) =>
        new($"vendor '{vendor}' cannot register its kinds: {what}");
}
