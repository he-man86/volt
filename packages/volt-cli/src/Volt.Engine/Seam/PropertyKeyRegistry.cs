using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Contracts;

namespace Volt.Engine.Seam;

/// <summary>What a <c>%</c>-line's value may be.</summary>
public enum PropertyGrammar
{
    /// <summary>No value: the line's presence is the fact (<c>%EXCLUDE_FROM_BUILD</c>).</summary>
    Flag,
    /// <summary>One integer, invariant culture (<c>%ONLINE_CHANGE_RESERVE 4</c>).</summary>
    Integer,
    /// <summary>One token with no blank (<c>%REVISION 2.1</c>).</summary>
    Word,
    /// <summary>Any non-empty rest of the line (<c>%CLASS CHECK CheckBounds</c>).</summary>
    Words,
    /// <summary>One quoted string, as the line spells it (<c>%COMMENT 'start delay'</c>).</summary>
    Text,
}

/// <summary>One object-property key as a vendor declares it: the word after <c>%</c>, its value's grammar, and whether
/// one object may carry the line more than once.</summary>
public sealed record PropertyKey(string Key, PropertyGrammar Grammar, bool Repeats = false);

/// <summary>One object property as the text spells it: <c>%Key</c> or <c>%Key Value</c>. Value is null for a flag.</summary>
public sealed record Property(string Key, string? Value)
{
    public override string ToString() => Value is null ? "%" + Key : $"%{Key} {Value}";
}

/// <summary>An object's properties, in the order its text spells them. Equal when every property is.</summary>
public sealed class PropertySet : IEquatable<PropertySet>
{
    public static readonly PropertySet Empty = new(Array.Empty<Property>());

    public PropertySet(IReadOnlyList<Property> items) => Items = items ?? throw new ArgumentNullException(nameof(items));

    public IReadOnlyList<Property> Items { get; }

    public bool Equals(PropertySet? other) => other is not null && Items.SequenceEqual(other.Items);
    public override bool Equals(object? obj) => Equals(obj as PropertySet);
    public override int GetHashCode() => Items.Aggregate(17, (h, p) => h * 31 + p.GetHashCode());
    public override string ToString() => string.Join("\n", Items);
}

/// <summary>
/// THE <c>%</c>-key set (vendor-neutrality W8/C8): the union of the keys the hosts declare, each with its value grammar.
/// CLOSED per process — a key no host declared is refused by name, never carried as an opaque bag — but no longer a
/// record in the Engine: a vendor's own fact (a block number, a routine type) is a key its host declares. Whether THIS
/// vendor holds a key stays the host's pre-flight answer (<c>ValidateProperties</c>).
/// </summary>
public sealed class PropertyKeyRegistry
{
    /// <summary>A member's place in its item (<c>%FOLDER</c>) is structure, not a property: no host declares it.</summary>
    public const string FolderKey = "FOLDER";

    /// <summary>The key whose value is the object's vendor CLASS where a host declares one (<c>%CLASS CHECK CheckBounds</c>):
    /// a class is made at the create (<see cref="CreateArgs.Class"/>) and never changes in place, so a push that states
    /// another is refused by the engine, by name.</summary>
    public const string ClassKey = "CLASS";

    /// <summary>The value of <paramref name="set"/>'s <see cref="ClassKey"/> property, or null for an object of the plain
    /// class.</summary>
    public static string? ClassOf(PropertySet set) =>
        (set ?? throw new ArgumentNullException(nameof(set))).Items.FirstOrDefault(p => p.Key == ClassKey)?.Value;

    private static readonly Regex KeyShape = new("^[A-Z][A-Z0-9_]*$", RegexOptions.CultureInvariant);
    private static readonly Regex Line = new(@"^%([A-Za-z_][A-Za-z0-9_]*)(?:[ \t]+(.*?))?\s*$", RegexOptions.CultureInvariant);

    private readonly Dictionary<string, PropertyKey> _keys = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _owner = new(StringComparer.Ordinal);

    public void Register(string vendor, IEnumerable<PropertyKey> keys)
    {
        if (keys is null) throw new ArgumentNullException(nameof(keys));
        foreach (var key in keys) Register(vendor, key);
    }

    public void Register(string vendor, PropertyKey key)
    {
        if (key is null) throw new ArgumentNullException(nameof(key));
        if (!KeyShape.IsMatch(key.Key ?? "") || key.Key == FolderKey)
            throw new InvalidOperationException(
                $"vendor '{vendor}' cannot register the property key '{key.Key}': a key is an upper-case word, and " +
                $"%{FolderKey} is a member's place, not a property");
        if (_keys.TryGetValue(key.Key!, out var held) && held != key)
            throw new InvalidOperationException(
                $"vendor '{vendor}' registers %{key.Key} as {Describe(key)}, but '{_owner[key.Key!]}' registered it as " +
                $"{Describe(held)}: one key is one grammar");
        if (held is null) { _keys[key.Key!] = key; _owner[key.Key!] = vendor; }
    }

    /// <summary>Every key, in ordinal order.</summary>
    public IReadOnlyList<PropertyKey> Keys => _keys.Values.OrderBy(k => k.Key, StringComparer.Ordinal).ToList();

    public PropertyKey? Find(string key) => _keys.TryGetValue(key ?? "", out var k) ? k : null;

    /// <summary>Is this line a <c>%</c>-line of a declared key (whatever its value)? The question a format asks to tell a
    /// property line from code.</summary>
    public bool IsPropertyLine(string line)
    {
        var m = Line.Match(line ?? "");
        return m.Success && _keys.ContainsKey(m.Groups[1].Value);
    }

    /// <summary>Parse one <c>%</c>-line. A key no host declared, or a value its grammar refuses, is the text's error:
    /// <c>INVALID_ST</c> (the layout error code, vendor-neutrality W6), naming the line.</summary>
    public Property Parse(string line)
    {
        var m = Line.Match(line ?? "");
        if (!m.Success)
            throw new BridgeException(BridgeErrorCodes.InvalidSt, $"'{line}' is no %-line (%KEY or %KEY value)");
        var keyWord = m.Groups[1].Value;
        var key = Find(keyWord)
            ?? throw new BridgeException(BridgeErrorCodes.InvalidSt,
                $"'{line}': %{keyWord} is no property key a host declared (known: {string.Join(", ", _keys.Keys.OrderBy(k => k, StringComparer.Ordinal).Select(k => "%" + k))})");
        var value = m.Groups[2].Success && m.Groups[2].Value.Length > 0 ? m.Groups[2].Value : null;
        if (Refusal(key, value) is { } why)
            throw new BridgeException(BridgeErrorCodes.InvalidSt, $"'{line}': {why}");
        return new Property(key.Key, value);
    }

    /// <summary>Parse an object's lines, refusing a non-repeating key stated twice.</summary>
    public PropertySet ParseAll(IEnumerable<string> lines)
    {
        var items = new List<Property>();
        foreach (var line in lines)
        {
            var p = Parse(line);
            if (!_keys[p.Key].Repeats && items.Any(i => i.Key == p.Key))
                throw new BridgeException(BridgeErrorCodes.InvalidSt, $"'{line}': %{p.Key} is stated twice for one object");
            items.Add(p);
        }
        return new PropertySet(items);
    }

    /// <summary>The line of a property, refusing one the registry would not read back.</summary>
    public string Format(Property property)
    {
        if (property is null) throw new ArgumentNullException(nameof(property));
        var key = Find(property.Key) ?? throw new ArgumentException($"%{property.Key} is no declared key", nameof(property));
        if (Refusal(key, property.Value) is { } why) throw new ArgumentException($"{property}: {why}", nameof(property));
        return property.ToString();
    }

    private static string? Refusal(PropertyKey key, string? value) => key.Grammar switch
    {
        PropertyGrammar.Flag => value is null ? null : $"%{key.Key} is a flag and takes no value",
        PropertyGrammar.Integer => value is not null && int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _)
            ? null : $"%{key.Key} takes one integer",
        PropertyGrammar.Word => value is not null && value.IndexOfAny(new[] { ' ', '\t' }) < 0 ? null : $"%{key.Key} takes one word",
        PropertyGrammar.Words => value is not null ? null : $"%{key.Key} takes a value",
        PropertyGrammar.Text => value is { Length: >= 2 } && value[0] == '\'' && value[value.Length - 1] == '\''
            ? null : $"%{key.Key} takes one quoted string",
        _ => throw new ArgumentOutOfRangeException(nameof(key)),
    };

    private static string Describe(PropertyKey k) => k.Grammar + (k.Repeats ? ", repeating" : "");
}
