using System;
using System.Collections.Generic;
using Volt.Engine.Item;

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
    /// project has no such item: the vendor seam — only a driver can ask its IDE. It answers the hops of a qualified
    /// instance path (<c>GVL.timers.t1</c>) and an FB's inherited members.</param>
    /// <param name="globals">Every global variable list's declaration. Read LAZILY and at most once: a global
    /// only matters to a name shaped like a wire (<c>g&lt;digits&gt;</c>) and to a call head the local declarations
    /// do not name, so a body with neither never pays for the walk that finds them.</param>
    /// <param name="kindOf">The WIRE KIND of the top-level item of that name (<c>pou</c>, <c>dut</c>, <c>gvl</c>,
    /// <c>interface</c>, …) — the pushed item's own, else the IDE's class — or null when the project holds no item of
    /// that name. Never read off the item's text (openspec <c>bridge-refusal-review</c> D3).</param>
    /// <param name="isRefusedPouName">Whether the VENDOR refuses a word as the name of a POU: its measured name list
    /// (<c>ICodeStore.RefusedName</c>), below the seam (D4). A word no POU can be named is no function block's type —
    /// <c>INT</c>, <c>STRING</c>, the heads <c>ARRAY</c>, <c>POINTER</c>, <c>REFERENCE</c>; on CODESYS also <c>LDT</c>,
    /// which TwinCAT takes as a name.</param>
    public static NetworkScope FromDeclarations(string? declaration, Func<string, string?> declarationOf,
                                                Func<IEnumerable<string>> globals, Func<string, string?> kindOf,
                                                Func<string, bool> isRefusedPouName)
    {
        if (declarationOf is null) throw new ArgumentNullException(nameof(declarationOf));
        if (globals is null) throw new ArgumentNullException(nameof(globals));
        if (kindOf is null) throw new ArgumentNullException(nameof(kindOf));
        if (isRefusedPouName is null) throw new ArgumentNullException(nameof(isRefusedPouName));
        // An FB's inherited members are its own names too (EXTENDS, followed to the root), after its own so a nearer
        // declaration still wins.
        declaration = St.StDeclaration.WithInherited(declaration, declarationOf);
        var local = new HashSet<string>(St.StDeclaration.DeclaredNames(declaration), StringComparer.OrdinalIgnoreCase);
        var global = new Lazy<(HashSet<string> Names, string Text)>(() =>
        {
            var text = string.Join("\n", globals());
            return (new HashSet<string>(St.StDeclaration.DeclaredNames(text), StringComparer.OrdinalIgnoreCase), text);
        });

        // A POU is an item whose KIND is `pou` — the pushed item's wire kind, else the IDE's class — never a header read
        // off its text (D3; the move 5Qb made for GVLs): an FB whose declaration does not parse is a POU all the same.
        bool IsPou(string name) => NetworkSpelling.IsName(name) && kindOf(name) == ItemKind.Kinds.Pou;

        // An FB instance is a NAME a declaration makes: a local or owner variable first, then a global, then a
        // qualified path through a GVL and its structs. A head that is no name (`fbs[1]`, `SUPER^`) is none — census
        // 1.12, spec "an FB instance that is an expression": the text cannot say which instance it is.
        //
        // And only a variable whose type can be a FUNCTION BLOCK is an instance (the LSP's `instanceFb`, the other side
        // of the parity). Any variable's type was taken once: a BOOL named R_EDGE counted as a callable, so every edge
        // in its POU was refused on push and went to the marker on pull, and `k(x)` with `k : INT` became a box of an
        // FB named INT that the gate let through.
        string? InstanceType(string head)
        {
            if (!NetworkSpelling.IsName(head)) return null;
            var type = St.StDeclaration.TypeOfCallTarget(declaration, head, declarationOf)
                       ?? (head.IndexOf('.') < 0 && global.Value.Names.Contains(head)
                           ? St.StDeclaration.TypeOfCallTarget(global.Value.Text, head, declarationOf)
                           : null);
            return type is not null && CanBeBlock(type) ? type : null;
        }

        // D3 + D4 — by KIND and by the vendor's refused NAMES, never by a callee's text: a word the vendor refuses as a
        // POU name is no block on that vendor; a project item of another kind (a DUT, an interface, a GVL) is none; a
        // project POU of any kind, and a type the project does not hold (a library's: `TON`, `Standard.TON`), is one —
        // its box is written as sent, and the build judges it. A qualified type names a library's through its
        // namespace, which is no POU name to ask the vendor about.
        bool CanBeBlock(string type)
        {
            if (type.IndexOf('.') < 0 && isRefusedPouName(type)) return false;
            return kindOf(type) is not { } kind || kind == ItemKind.Kinds.Pou;
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
