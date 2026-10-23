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
    private readonly Func<string, Format.Network.Callee?> _callee;
    private readonly Func<string, IReadOnlyList<string>?> _blockOutputs;

    /// <param name="names">Every name in scope.</param>
    /// <param name="pous">The POUs the body can call (functions, FB types, programs). Each is also a name in scope.</param>
    /// <param name="instanceTypes">FB instance name → its FB type. Each instance is also a name in scope. A key is
    /// a NAME a declaration makes — an identifier, or a qualified one (<c>GVL.fbTimer</c>), or <c>SUPER^</c> — never an expression
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
            // `SUPER^` (S5) is the one instance no declaration names, as `FromDeclarations` answers it; `fbs[]` is an
            // ARRAY of FBs of that type (2R.5, #17), whose ELEMENTS `fbs[1]` are the instances.
            if (!NetworkSpelling.IsName(kv.Key) && !string.Equals(kv.Key, St.StDeclaration.SuperCall, StringComparison.OrdinalIgnoreCase) &&
                !(kv.Key.EndsWith(ArrayKey, StringComparison.Ordinal) && NetworkSpelling.IsName(kv.Key.Substring(0, kv.Key.Length - ArrayKey.Length))))
                throw new ArgumentException($"the FB instance '{kv.Key}' is no name a declaration makes.", nameof(instanceTypes));
            instances[kv.Key] = kv.Value;
        }
        var pouSet = new HashSet<string>(pous, StringComparer.OrdinalIgnoreCase);
        var nameSet = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
        nameSet.UnionWith(pouSet);
        nameSet.UnionWith(instances.Keys);
        _contains = nameSet.Contains;
        _isPou = pouSet.Contains;
        _instanceType = n =>
            instances.TryGetValue(n, out var t) ? t
            : ArrayElementBase(n) is { } array && instances.TryGetValue(array + ArrayKey, out var e) ? e
            : null;
        // A scope stated as name lists holds no declaration to derive a callee or a block's outputs from.
        _callee = _ => null;
        _blockOutputs = _ => null;
    }

    private NetworkScope(Func<string, bool> contains, Func<string, bool> isPou, Func<string, string?> instanceType,
                         Func<string, Format.Network.Callee?> callee, Func<string, IReadOnlyList<string>?> blockOutputs)
    {
        _contains = contains;
        _isPou = isPou;
        _instanceType = instanceType;
        _callee = callee;
        _blockOutputs = blockOutputs;
    }

    /// <summary>The key suffix the name-list constructor reads as "an ARRAY of FBs of that type": <c>fbs[]</c>.</summary>
    public const string ArrayKey = "[]";

    /// <summary>The array a call head subscripts — <c>fbs</c> of <c>fbs[1]</c>, <c>GVL.fbs</c> of <c>GVL.fbs[i, 2]</c> — or
    /// null where the head is no single subscript of a name (2R.5, #17).</summary>
    private static string? ArrayElementBase(string head)
    {
        var open = head.IndexOf('[');
        if (open <= 0 || !head.EndsWith("]", StringComparison.Ordinal) || head.IndexOf('[', open + 1) >= 0 ||
            head.IndexOf(']') != head.Length - 1 || head.Length - open < 3)
            return null;
        var path = head.Substring(0, open);
        return NetworkSpelling.IsName(path) ? path : null;
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
    /// (<c>IVendorStore.RefusedName</c>), below the seam (D4). A word no POU can be named is no function block's type —
    /// <c>INT</c>, <c>STRING</c>, the heads <c>ARRAY</c>, <c>POINTER</c>, <c>REFERENCE</c>; on CODESYS also <c>LDT</c>,
    /// which TwinCAT takes as a name.</param>
    /// <param name="libraryFunction">A referenced LIBRARY's FUNCTION by the bare name a call box names, as the IDE's
    /// library signatures state it (<c>ProjectDeclarations</c>: the driver's read, ld-fbd-coverage 2R.4b), or null when no
    /// library declares one function of that name. Asked only for a call head nothing else names — no project item, no
    /// variable, no word the vendor refuses as a POU name (an operator, a conversion) — so a body with no such box never
    /// reads the libraries. A caller with no IDE passes <c>_ =&gt; null</c> and says so.</param>
    public static NetworkScope FromDeclarations(string? declaration, Func<string, string?> declarationOf,
                                                Func<IEnumerable<string>> globals, Func<string, string?> kindOf,
                                                Func<string, bool> isRefusedPouName,
                                                Func<string, Format.Network.Callee?> libraryFunction)
    {
        if (declarationOf is null) throw new ArgumentNullException(nameof(declarationOf));
        if (globals is null) throw new ArgumentNullException(nameof(globals));
        if (kindOf is null) throw new ArgumentNullException(nameof(kindOf));
        if (isRefusedPouName is null) throw new ArgumentNullException(nameof(isRefusedPouName));
        if (libraryFunction is null) throw new ArgumentNullException(nameof(libraryFunction));
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
            // S5 (ld-fbd-coverage 2.3): `SUPER^` is the instance a derived FB calls its base through — no name a declaration
            // makes, and an instance all the same, of the base the POU's (or its owner's) EXTENDS names. The text spells
            // it between backticks, `` `SUPER^`(…) ``.
            if (string.Equals(head, St.StDeclaration.SuperCall, StringComparison.OrdinalIgnoreCase))
                return St.StDeclaration.TypeOfCallTarget(declaration, head, declarationOf);
            // 2R.5 (#17): an ELEMENT of an array of FBs is an instance of the element type — the IDE stores the box with
            // the subscripted operand as its instance, and it builds and runs (awkward-sweep, CODESYS SP21).
            if (ArrayElementBase(head) is not null)
            {
                var element = St.StDeclaration.TypeOfArrayElement(declaration, head, declarationOf)
                              ?? (head.IndexOf('.') < 0 && global.Value.Names.Contains(ArrayElementBase(head)!)
                                  ? St.StDeclaration.TypeOfArrayElement(global.Value.Text, head, declarationOf)
                                  : null);
                return element is not null && CanBeBlock(element) ? element : null;
            }
            if (!NetworkSpelling.IsName(head)) return null;
            var type = DeclaredType(head);
            return type is not null && CanBeBlock(type) ? type : null;
        }

        // The declared type of a variable path: a local or owner variable first, then a global.
        string? DeclaredType(string head) =>
            !NetworkSpelling.IsName(head) ? null
            : St.StDeclaration.TypeOfCallTarget(declaration, head, declarationOf)
              ?? (head.IndexOf('.') < 0 && global.Value.Names.Contains(head)
                  ? St.StDeclaration.TypeOfCallTarget(global.Value.Text, head, declarationOf)
                  : null);

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

        // B7 D (2R.4): a project FUNCTION, by its own declaration's header — a callee by NAME only (a dotted head is a
        // member or a library's, an instance is a block).
        Format.Network.Callee? CalleeOf(string type)
        {
            // A METHOD of an instance in scope (`fbm.Visible`) or of an interface variable (`itf.M`): its box compiles
            // only with CallType Method (measured, design "2R.4"; the interface's and an instance ACTION's box recorded
            // by `ng_m_*`, 2R.4 gate). Its inputs are the method's, which no top-level declaration holds — none derived.
            var dot = type.LastIndexOf('.');
            if (dot > 0)
            {
                var owner = type.Substring(0, dot);
                return InstanceType(type) is null
                       && (InstanceType(owner) is not null || DeclaredType(owner) is { } t && kindOf(t) == ItemKind.Kinds.Interface)
                    ? new Format.Network.Callee(Format.Network.Callee.MethodCallType, Array.Empty<string>(), null)
                    : null;
            }
            if (InstanceType(type) is not null || local.Contains(type)) return null;
            // 2R.4b: a name the project holds no item of, no variable takes and the vendor does not reserve (an operator,
            // a conversion) is a referenced library's — its box builds only with CallType Function and its input names,
            // as a project function's (measured live, SP21: `ng_m_library_function*`, bakon-nano's REPLACE/DELETE).
            if (!IsPou(type))
                return NetworkSpelling.IsName(type) && kindOf(type) is null && !isRefusedPouName(type) && !Contains(type) &&
                       libraryFunction(type) is { CallType: Format.Network.Callee.FunctionCallType } library
                    ? library
                    : null;
            var declaration = declarationOf(type);
            return St.StDeclaration.IsFunction(declaration)
                ? new Format.Network.Callee(Format.Network.Callee.FunctionCallType, St.StDeclaration.InputNames(declaration),
                                            St.StDeclaration.OutputNames(declaration))
                : null;
        }

        // An FB's VAR_OUTPUTs in declaration order, its inherited ones first (a derived FB's box lists its base's outputs
        // before its own): a project FB by its declaration, a library's by the IDE's signature. What a `.name` read's slot
        // is derived from (NetworkDerivation, v2-spec section 7).
        IReadOnlyList<string>? BlockOutputs(string type)
        {
            if (IsPou(type))
            {
                var own = declarationOf(type);
                return own is null || St.StDeclaration.IsFunction(own) ? null : InheritedOutputs(type, own, 0);
            }
            var bare = type.Substring(type.LastIndexOf('.') + 1);
            return NetworkSpelling.IsName(type) && kindOf(bare) is null && libraryFunction(bare) is { CallType: Format.Network.Callee.FunctionBlockCallType } block
                ? block.Outputs
                : null;
        }

        IReadOnlyList<string>? InheritedOutputs(string type, string declaration, int depth)
        {
            var own = St.StDeclaration.OutputNames(declaration);
            if (St.StDeclaration.BaseOf(declaration) is not { } baseName || depth > 32) return own;
            var baseOutputs = IsPou(baseName) && declarationOf(baseName) is { } b
                ? InheritedOutputs(baseName, b, depth + 1)
                : libraryFunction(baseName) is { CallType: Format.Network.Callee.FunctionBlockCallType } lib ? lib.Outputs : null;
            return baseOutputs is null ? null : baseOutputs.Concat(own).ToList();
        }

        return new NetworkScope(Contains, IsPou, InstanceType, CalleeOf, BlockOutputs);
    }

    public bool Contains(string name) => _contains(name);

    /// <summary>What a call box of <paramref name="type"/> is built with besides its text (B7 D, ld-fbd-coverage 2R.4):
    /// the vendor <c>CallType</c> and the callee's input names, from its declaration — or null where nothing is derived.
    /// Answers a project FUNCTION only: measured live (CODESYS SP21, design "2R.4"), its box compiles only with
    /// <c>CallType Function</c> and its input names, while every other call kind Volt builds without them compiles
    /// and runs as drawn. A referenced library's FUNCTION answers from the IDE's library signature (2R.4b); a name no
    /// library declares one function of answers null, never a guess.</summary>
    public Format.Network.Callee? Callee(string type) => _callee(type);

    /// <summary>An FB type's outputs in the order its box lists them (inherited first), or null where no declaration or
    /// library signature in reach states them — what the push derives a <c>.name</c> read's slot from.</summary>
    public IReadOnlyList<string>? BlockOutputs(string fbType) => _blockOutputs(fbType);

    /// <summary>Whether <paramref name="name"/> is a POU or an FB instance — something a call can name.</summary>
    public bool IsCallable(string name) => _isPou(name) || _instanceType(name) is not null;

    /// <summary>The FB type of <paramref name="head"/> when it is an instance in scope, else null.</summary>
    public string? InstanceType(string head) => _instanceType(head);
}

/// <summary>A call box's derived members (B7 D, ld-fbd-coverage 2R.4): the vendor <c>CallType</c> member name, the
/// callee's input names in declaration order (<see cref="NetworkScope.Callee"/>) and its <c>VAR_OUTPUT</c> names — null
/// where the declaration is not read (a METHOD's), so no output list is derived.</summary>
public sealed record Callee(string CallType, IReadOnlyList<string> Inputs, IReadOnlyList<string>? Outputs)
{
    /// <summary>The vendor enum member a FUNCTION's box holds (CODESYS <c>Operator.Function</c>; 113 corpus boxes).</summary>
    public const string FunctionCallType = "Function";

    /// <summary>A library FUNCTION BLOCK's signature, as <see cref="Volt.Engine.Library.LibraryFunctions"/> answers it: its
    /// outputs give a <c>.name</c> read's slot. No box is built with it as a CallType.</summary>
    public const string FunctionBlockCallType = "FunctionBlock";

    /// <summary>The vendor enum member a METHOD's box holds (CODESYS <c>Operator.Method</c>, the drawn box measured
    /// 2026-10-16; 0 in the corpora).</summary>
    public const string MethodCallType = "Method";
}
