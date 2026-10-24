using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Contracts;

namespace Volt.Engine.Seam;

/// <summary>A vendor as the wire names it: its id (the binding's <c>vendor</c>, and the pipe <c>volt.bridge.&lt;Id&gt;.&lt;pid&gt;</c>)
/// and the name a person reads.</summary>
public sealed record VendorRow(string Id, string Display);

/// <summary>Every vendor a process knows, each registered by its own host's declaration (vendor-neutrality W10). One id
/// has one display name; an id that is no lower-case word cannot name a pipe and is refused.</summary>
public sealed class VendorRegistry
{
    private static readonly Regex IdShape = new("^[a-z][a-z0-9]*$", RegexOptions.CultureInvariant);
    private readonly Dictionary<string, VendorRow> _rows = new(StringComparer.Ordinal);

    public void Register(VendorRow row)
    {
        if (row is null) throw new ArgumentNullException(nameof(row));
        if (!IdShape.IsMatch(row.Id ?? ""))
            throw new VoltInvariantException($"vendor id '{row.Id}' is no lower-case word, so it cannot name a pipe (volt.bridge.<id>.<pid>)");
        if (string.IsNullOrWhiteSpace(row.Display))
            throw new VoltInvariantException($"vendor '{row.Id}' has no display name");
        if (_rows.TryGetValue(row.Id!, out var held) && held != row)
            throw new VoltInvariantException(
                $"vendor '{row.Id}' is registered twice with two display names: '{held.Display}' and '{row.Display}'");
        _rows[row.Id!] = row;
    }

    /// <summary>The ids, in ordinal order.</summary>
    public IReadOnlyList<string> Ids => _rows.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList();

    /// <summary>The display name of <paramref name="id"/>. An id no host registered is a caller's bug, refused naming the
    /// registered ones — never a name guessed for it.</summary>
    public string Display(string id) =>
        _rows.TryGetValue(id ?? "", out var row)
            ? row.Display
            : throw new ArgumentException($"'{id}' is not a registered vendor id ({string.Join(" | ", Ids)})", nameof(id));
}
