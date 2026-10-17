using System;
using System.Collections.Generic;
using System.Linq;

namespace Volt.Engine.Format.Network;

/// <summary>
/// THE MEMBERS A PUSH DERIVES FOR A CALL BOX (ld-fbd-coverage 2R.4, B7 D): what the editor fills in from the callee's
/// declaration when it draws the box, and the text does not spell. Vendor-neutral: each driver supplies the declaration
/// through its <see cref="NetworkScope"/> (<see cref="NetworkScope.Callee"/>) and writes the result in its own form.
/// </summary>
public static class NetworkDerivation
{
    /// <summary><paramref name="body"/> with every call box whose callee the scope names (<see cref="NetworkScope.Callee"/>)
    /// given its derived input names (<see cref="WithCallee"/>) — what the push builds, on either vendor, and so what the
    /// next pull shows. <paramref name="origin"/> maps each rebuilt node to the node it replaces, so a refusal raised on a
    /// derived node is reported where the engineer wrote it. A body with nothing to derive comes back as it is.</summary>
    public static NetworkBody Derive(NetworkBody body, NetworkScope scope, out IReadOnlyDictionary<Node, Node> origin) =>
        Derive(body, b => scope.Callee(b.Type), out origin);

    /// <summary><paramref name="pushed"/> given, box for box, the input names the IDE's box holds where the pushed box
    /// leaves them positional: the push's derivation, read back off <paramref name="held"/> instead of off the callee's
    /// declaration — for a reader with no project to derive from (the CLI's post-push check, <c>PushedText</c>). A box of
    /// the same type at the same place, every input of it named, lends its names to the pushed box's positional pins; any
    /// other pair lends nothing. A pin the pushed text names keeps its own name, so a pin the IDE holds under another
    /// name is no derivation and stays a difference.</summary>
    public static NetworkBody NamedAs(NetworkBody pushed, NetworkBody held)
    {
        var boxes = new List<Box>();
        Derive(held, b => { boxes.Add(b); return null; }, out _);
        var at = 0;
        return Derive(pushed, b =>
        {
            var h = at < boxes.Count ? boxes[at] : null;
            at++;
            return h is not null && h.Type == b.Type && h.Inputs.Count == b.Inputs.Count && h.Inputs.All(i => i.Formal is not null)
                ? new Callee(Callee.FunctionCallType, h.Inputs.Select(i => i.Formal!).ToList(), null)
                : null;
        }, out _);
    }

    // The one walk both derivations share: every call box with no instance and no ST asked once, in one fixed order — a
    // box's enable and inputs before the box itself, networks and trees in order.
    private static NetworkBody Derive(NetworkBody body, Func<Box, Callee?> calleeOf, out IReadOnlyDictionary<Node, Node> origin)
    {
        var map = new Dictionary<Node, Node>(NetworkTextReader.ByIdentity.Instance);
        origin = map;
        var changed = false;
        var networks = new List<Network>(body.Networks.Count);
        foreach (var n in body.Networks)
        {
            var trees = n.Trees.Select(t => Node(t, calleeOf, map)).ToList();
            if (trees.Where((t, i) => !ReferenceEquals(t, n.Trees[i])).Any())
            {
                networks.Add(n with { Trees = trees });
                changed = true;
            }
            else networks.Add(n);
        }
        return changed ? body with { Networks = networks } : body;
    }

    private static Node Node(Node n, Func<Box, Callee?> calleeOf, Dictionary<Node, Node> map)
    {
        Node Kid(Node k) => Node(k, calleeOf, map);
        Node result = n switch
        {
            Box b => BoxOf(b, calleeOf, map),
            Assign a when Kid(a.Value) is var v && !ReferenceEquals(v, a.Value) => a with { Value = v },
            Parallel p => ParallelOf(p, calleeOf, map),
            Demux { Input: { } i } d when Kid(i) is var v && !ReferenceEquals(v, i) => d with { Input = v },
            _ => n,
        };
        if (!ReferenceEquals(result, n)) map[result] = n;
        return result;
    }

    private static Box BoxOf(Box b, Func<Box, Callee?> calleeOf, Dictionary<Node, Node> map)
    {
        var enable = b.Enable is null ? null : Node(b.Enable, calleeOf, map);
        var inputs = b.Inputs.Select(i => Node(i.Value, calleeOf, map) is var v && !ReferenceEquals(v, i.Value) ? i with { Value = v } : i).ToList();
        var inner = ReferenceEquals(enable, b.Enable) && inputs.Where((x, i) => !ReferenceEquals(x, b.Inputs[i])).Any() == false
            ? b
            : b with { Enable = enable, Inputs = inputs };
        return inner.Instance is null && inner.StCode is null && calleeOf(inner) is { } callee
            ? WithCallee(inner, callee)
            : inner;
    }

    private static Node ParallelOf(Parallel p, Func<Box, Callee?> calleeOf, Dictionary<Node, Node> map)
    {
        var input = p.Input is null ? null : Node(p.Input, calleeOf, map);
        var branches = p.Branches.Select(x => Node(x, calleeOf, map)).ToList();
        return ReferenceEquals(input, p.Input) && !branches.Where((x, i) => !ReferenceEquals(x, p.Branches[i])).Any()
            ? p
            : p with { Input = input, Branches = branches };
    }

    /// <summary><paramref name="box"/> with each positional input given the callee's formal at its position — the
    /// declaration's input order, as a positional call fills it; a pin the text names keeps its name. Measured live
    /// (CODESYS SP21, design "2R.4"): a FUNCTION's box without its input names does not compile ("The assignment source is
    /// incorrect."). A box with more positional values than the callee declares inputs is returned as it is: there is no
    /// name to give the extra one, and the build names the arity.</summary>
    private static Box WithCallee(Box box, Callee callee)
    {
        var positional = box.Inputs.TakeWhile(i => i.Formal is null).Count();
        if (positional == 0 || positional > callee.Inputs.Count) return box;
        var inputs = new List<Input>(box.Inputs.Count);
        for (var i = 0; i < box.Inputs.Count; i++)
            inputs.Add(i < positional ? box.Inputs[i] with { Formal = callee.Inputs[i] } : box.Inputs[i]);
        return box with { Inputs = inputs };
    }

    /// <summary>The output names a FUNCTION's box is built with, as the editor draws it — measured over the corpora (113
    /// function boxes, design "2R.4"): without EN its result pin <c>'   '</c> and then every <c>VAR_OUTPUT</c> in
    /// declaration order, wired or not (97 + 6 + 2 boxes); with EN the ENO echo and then the outputs, no result pin (6 + 1
    /// + 1). Null for any other callee (a METHOD: the text's own pins build it, measured to run), and for a box with a
    /// POSITIONAL output pin (<c>=&gt; y</c>): the text places that one by its own slot order, which no drawn function box
    /// was measured holding — its slots stay the text's. The '   ' pin builds and runs on a box carrying
    /// <c>CallType Function</c> (measured live; without the CallType it is "no component", N37).</summary>
    public static IReadOnlyList<string>? OutputNames(Box box, Callee callee, bool eno) =>
        callee.CallType == Callee.FunctionCallType && callee.Outputs is { } outputs && box.Outputs.All(o => o.Formal is not null)
            ? new[] { eno ? Box.EnoPin : NetworkMembers.FunctionResult }.Concat(outputs).ToList()
            : null;
}
