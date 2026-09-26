using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;

namespace Volt.Engine.Format.Network.Next;

/// <summary>
/// What a graphical body can see besides its own text: every name in scope (the POU's variables, globals, the
/// owning FB's members seen from a method or action) and, for the names that are FB instances, their type.
///
/// <para><b>Why the reader needs it at all.</b> Three facts in network text v2 are not in the text and are in the
/// declarations: (1) whether a call head is an FB INSTANCE or a function (<c>t1(IN := a)</c> is either), (2) the
/// FB's type, which the text deliberately does not repeat (it would bury every rung — page, "FB BoxType not
/// written"), and (3) the reserved set a wire name must not collide with, case-insensitively — the SAME set the
/// writer renames against, or the writer's output would be refused by the reader. A reader that guessed any of
/// the three would be a reader that assumes; so the scope is a required argument, and a caller that has none
/// passes <see cref="Empty"/> and says so.</para>
/// </summary>
public sealed class NextNetworkScope
{
    private readonly HashSet<string> _names;
    private readonly Dictionary<string, string> _instances;

    /// <param name="names">Every name in scope.</param>
    /// <param name="instanceTypes">FB instance name → its FB type. Each instance is also a name in scope.</param>
    public NextNetworkScope(IEnumerable<string> names, IReadOnlyDictionary<string, string> instanceTypes)
    {
        if (names is null) throw new ArgumentNullException(nameof(names));
        if (instanceTypes is null) throw new ArgumentNullException(nameof(instanceTypes));
        _instances = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in instanceTypes) _instances[kv.Key] = kv.Value;
        _names = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
        _names.UnionWith(_instances.Keys);
    }

    /// <summary>A scope that knows nothing — explicit, never a default.</summary>
    public static NextNetworkScope Empty { get; } =
        new(Array.Empty<string>(), new Dictionary<string, string>());

    /// <summary>Every name in scope, for the writer's reserved set.</summary>
    public IReadOnlyCollection<string> Names => _names;

    public bool Contains(string name) => _names.Contains(name);

    /// <summary>The FB type of <paramref name="head"/> when it is an instance in scope, else null.</summary>
    public string? InstanceType(string head) => _instances.TryGetValue(head, out var t) ? t : null;
}

/// <summary>One finding against a network-text body: a <c>NETWORK_*</c> code (<see cref="ConflictCodes"/>), a
/// message that names what was found, and the 1-based span it was found at.</summary>
public sealed record NextNetworkTextDiagnostic(string Code, string Message, int Line, int Column, int Length);

/// <summary>What <see cref="NextNetworkTextReader.Read"/> returns: the model when the text is valid, else null,
/// and every diagnostic found. Bad input is never an exception — the push reports each finding at its span.</summary>
public sealed record NextReadResult(NetworkBody? Body, IReadOnlyList<NextNetworkTextDiagnostic> Diagnostics)
{
    public bool Ok => Body is not null && Diagnostics.Count == 0;
}
