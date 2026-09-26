using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;

namespace Volt.Engine.Format.Network.Next;

/// <summary>
/// What a graphical body can see besides its own text: every name in scope (the POU's variables, globals, the
/// owning FB's members seen from a method or action), the POUs it can call, and, for the names that are FB
/// instances, their type.
///
/// <para><b>Why the reader needs it at all.</b> Four facts in network text v2 are not in the text and are in the
/// declarations: (1) whether a call head is an FB INSTANCE or a function (<c>t1(IN := a)</c> is either), (2) the
/// FB's type, which the text deliberately does not repeat (it would bury every rung — page, "FB BoxType not
/// written"), (3) the reserved set a wire name must not collide with, case-insensitively — the SAME set the
/// writer renames against, or the writer's output would be refused by the reader — and (4) whether a POU or an
/// instance takes a name the text spells a construct with (<c>R_EDGE</c>, <c>PARALLEL</c>): a variable of that
/// name is harmless (an operand spelled like a word of the text is backticked), a callable one would make
/// <c>R_EDGE(x)</c> mean two things. A reader that guessed any of these would be a reader that assumes; so the
/// scope is a required argument, and a caller that has none passes <see cref="Empty"/> and says so.</para>
/// </summary>
public sealed class NextNetworkScope
{
    private readonly HashSet<string> _names;
    private readonly HashSet<string> _pous;
    private readonly Dictionary<string, string> _instances;

    /// <param name="names">Every name in scope.</param>
    /// <param name="pous">The POUs the body can call (functions, FB types, programs). Each is also a name in scope.</param>
    /// <param name="instanceTypes">FB instance name → its FB type. Each instance is also a name in scope. A key is
    /// a NAME a declaration makes — an identifier, or a qualified one (<c>GVL.fbTimer</c>) — never an expression
    /// such as <c>fbs[1]</c>: no declaration produces that key, so a scope holding one would let the text round-trip
    /// an instance the push path cannot resolve.</param>
    public NextNetworkScope(IEnumerable<string> names, IEnumerable<string> pous, IReadOnlyDictionary<string, string> instanceTypes)
    {
        if (names is null) throw new ArgumentNullException(nameof(names));
        if (pous is null) throw new ArgumentNullException(nameof(pous));
        if (instanceTypes is null) throw new ArgumentNullException(nameof(instanceTypes));
        _instances = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in instanceTypes)
        {
            if (!NextSpelling.IsName(kv.Key))
                throw new ArgumentException($"the FB instance '{kv.Key}' is no name a declaration makes.", nameof(instanceTypes));
            _instances[kv.Key] = kv.Value;
        }
        _pous = new HashSet<string>(pous, StringComparer.OrdinalIgnoreCase);
        _names = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
        _names.UnionWith(_pous);
        _names.UnionWith(_instances.Keys);
    }

    /// <summary>A scope that knows nothing — explicit, never a default.</summary>
    public static NextNetworkScope Empty { get; } =
        new(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string>());

    /// <summary>Every name in scope, for the writer's reserved set.</summary>
    public IReadOnlyCollection<string> Names => _names;

    public bool Contains(string name) => _names.Contains(name);

    /// <summary>Whether <paramref name="name"/> is a POU or an FB instance — something a call can name.</summary>
    public bool IsCallable(string name) => _pous.Contains(name) || _instances.ContainsKey(name);

    /// <summary>The FB type of <paramref name="head"/> when it is an instance in scope, else null.</summary>
    public string? InstanceType(string head) => _instances.TryGetValue(head, out var t) ? t : null;
}

/// <summary>
/// The v2 writer's one refusal: the fact it has no spelling for (<see cref="Body.UnrepresentableBodyException.Marker"/>,
/// the reason a pull materializes the marker for) and WHERE it met it. A pull only needs the reason; a push needs
/// the place too, because there the model came from the engineer's text and the finding belongs at the construct
/// that holds the fact — so the writer records the innermost node it was writing and the network it was in.
/// </summary>
public sealed class NextUnrepresentableException : Body.UnrepresentableBodyException
{
    internal NextUnrepresentableException(string reason, string detail)
        : base(reason, "network text has no spelling for " + reason + ": " + detail +
                       " Volt materializes the body as a marker rather than write it without that fact.")
        => Detail = detail;

    /// <summary>What was found, without the pull's "materializes a marker" consequence.</summary>
    public string Detail { get; }

    /// <summary>The innermost model node being written when the fact was met; null for a network's own field.</summary>
    internal Node? At { get; set; }

    /// <summary>The position of the network being written, in the body.</summary>
    internal int? Network { get; set; }
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
