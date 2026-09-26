using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;

namespace Volt.Engine.Format.Network;

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
public sealed class NetworkScope
{
    private readonly Func<string, bool> _contains;
    private readonly Func<string, bool> _isPou;
    private readonly Func<string, string?> _instanceType;

    /// <param name="names">Every name in scope.</param>
    /// <param name="pous">The POUs the body can call (functions, FB types, programs). Each is also a name in scope.</param>
    /// <param name="instanceTypes">FB instance name → its FB type. Each instance is also a name in scope. A key is
    /// a NAME a declaration makes — an identifier, or a qualified one (<c>GVL.fbTimer</c>) — never an expression
    /// such as <c>fbs[1]</c>: no declaration produces that key, so a scope holding one would let the text round-trip
    /// an instance the push path cannot resolve.</param>
    public NetworkScope(IEnumerable<string> names, IEnumerable<string> pous, IReadOnlyDictionary<string, string> instanceTypes)
    {
        if (names is null) throw new ArgumentNullException(nameof(names));
        if (pous is null) throw new ArgumentNullException(nameof(pous));
        if (instanceTypes is null) throw new ArgumentNullException(nameof(instanceTypes));
        var instances = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in instanceTypes)
        {
            if (!NetworkSpelling.IsName(kv.Key))
                throw new ArgumentException($"the FB instance '{kv.Key}' is no name a declaration makes.", nameof(instanceTypes));
            instances[kv.Key] = kv.Value;
        }
        var pouSet = new HashSet<string>(pous, StringComparer.OrdinalIgnoreCase);
        var nameSet = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
        nameSet.UnionWith(pouSet);
        nameSet.UnionWith(instances.Keys);
        _contains = nameSet.Contains;
        _isPou = pouSet.Contains;
        _instanceType = n => instances.TryGetValue(n, out var t) ? t : null;
    }

    private NetworkScope(Func<string, bool> contains, Func<string, bool> isPou, Func<string, string?> instanceType)
    {
        _contains = contains;
        _isPou = isPou;
        _instanceType = instanceType;
    }

    /// <summary>A scope that knows nothing — explicit, never a default.</summary>
    public static NetworkScope Empty { get; } =
        new(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string>());

    /// <summary>
    /// THE scope of a body, BUILT FROM THE DECLARATIONS it can see — the one the pull's writer and the push's reader
    /// both use (task 3.9, review 7.2), so a wire name the writer chose is one its reader accepts.
    ///
    /// <para>Built from declarations rather than handed a name list because the name list is where the two sides
    /// drifted: a wire named <c>g3</c> read in a METHOD collides with the owning FB's member <c>G3</c> and with a
    /// GVL global <c>G3</c> alike, and a scope that held only the method's own VAR block let the writer keep a name
    /// the compiler would resolve to the variable.</para>
    /// </summary>
    /// <param name="declaration">The declarations the body resolves against, innermost first — for a member its own
    /// then its owner's (<c>SourceScopes.Scope</c>), so an inner name shadows an outer one exactly as IEC says.</param>
    /// <param name="declarationOf">Another item's declaration by NAME (a POU, a GVL, a DUT), or null when the
    /// project has no such item: the vendor seam — only a driver can ask its IDE. It answers the POUs a body can
    /// call and the hops of a qualified instance path (<c>GVL.timers.t1</c>).</param>
    /// <param name="globals">Every global variable list's declaration. Read LAZILY and at most once: a global
    /// only matters to a name shaped like a wire (<c>g&lt;digits&gt;</c>) and to a call head the local declarations
    /// do not name, so a body with neither never pays for the walk that finds them.</param>
    public static NetworkScope FromDeclarations(string? declaration, Func<string, string?> declarationOf,
                                                Func<IEnumerable<string>> globals)
    {
        if (declarationOf is null) throw new ArgumentNullException(nameof(declarationOf));
        if (globals is null) throw new ArgumentNullException(nameof(globals));
        var local = new HashSet<string>(St.StDeclaration.DeclaredNames(declaration), StringComparer.OrdinalIgnoreCase);
        var global = new Lazy<(HashSet<string> Names, string Text)>(() =>
        {
            var text = string.Join("\n", globals());
            return (new HashSet<string>(St.StDeclaration.DeclaredNames(text), StringComparer.OrdinalIgnoreCase), text);
        });

        bool IsPou(string name) =>
            NetworkSpelling.IsName(name) && St.StDeclaration.IsCallableHeader(declarationOf(name));

        // An FB instance is a NAME a declaration makes: a local or owner variable first, then a global, then a
        // qualified path through a GVL and its structs. A head that is no name (`fbs[1]`, `SUPER^`) is none — census
        // 1.12, spec "an FB instance that is an expression": the text cannot say which instance it is.
        string? InstanceType(string head)
        {
            if (!NetworkSpelling.IsName(head)) return null;
            if (St.StDeclaration.TypeOfCallTarget(declaration, head, declarationOf) is { } local_) return local_;
            return head.IndexOf('.') < 0 && global.Value.Names.Contains(head)
                ? St.StDeclaration.TypeOfCallTarget(global.Value.Text, head, declarationOf)
                : null;
        }

        bool Contains(string name) =>
            local.Contains(name) || global.Value.Names.Contains(name) || declarationOf(name) is not null;

        return new NetworkScope(Contains, IsPou, InstanceType);
    }

    public bool Contains(string name) => _contains(name);

    /// <summary>Whether <paramref name="name"/> is a POU or an FB instance — something a call can name.</summary>
    public bool IsCallable(string name) => _isPou(name) || _instanceType(name) is not null;

    /// <summary>The FB type of <paramref name="head"/> when it is an instance in scope, else null.</summary>
    public string? InstanceType(string head) => _instanceType(head);
}

/// <summary>
/// The v2 writer's one refusal: the fact it has no spelling for (<see cref="Body.UnrepresentableBodyException.Marker"/>,
/// the reason a pull materializes the marker for) and WHERE it met it. A pull only needs the reason; a push needs
/// the place too, because there the model came from the engineer's text and the finding belongs at the construct
/// that holds the fact — so the writer records the innermost node it was writing and the network it was in.
/// </summary>
public sealed class NetworkUnrepresentableException : Body.UnrepresentableBodyException
{
    internal NetworkUnrepresentableException(string reason, string detail)
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
public sealed record NetworkTextDiagnostic(string Code, string Message, int Line, int Column, int Length);

/// <summary>What <see cref="NetworkTextReader.Read"/> returns: the model when the text is valid, else null,
/// and every diagnostic found. Bad input is never an exception — the push reports each finding at its span.</summary>
public sealed record NetworkReadResult(NetworkBody? Body, IReadOnlyList<NetworkTextDiagnostic> Diagnostics)
{
    public bool Ok => Body is not null && Diagnostics.Count == 0;
}
