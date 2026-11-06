using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Volt.Engine.Format.Network;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Tests.Shared;

/// <summary>
/// THE PLAIN-ST ROUND-TRIP ORACLE (openspec <c>network-text-st</c> 2.2; it grew out of the gap probe 911876691e): every
/// network of a source goes model → <see cref="StNetworkWriter"/> → <see cref="StNetworkReader"/> → model, and lands in
/// exactly one bucket:
/// <list type="bullet">
/// <item><b>identical</b>: <c>Carried(m) ≅ Carried(back)</c> (the model oracle's list of facts no text carries);</item>
/// <item><b>stored members only</b>: equal once the design's "Stored members, not spelled" are put in their spelled form
/// (<see cref="Spelled"/>, each rule named);</item>
/// <item><b>unsupported</b>: the writer refuses it by name — the network a pull shows as its <c>%UNSUPPORTED</c> line;</item>
/// <item><b>gap</b>: the reader refuses the writer's own text, or the model comes back different — never expected: a
/// gap is a writer that spells a shape it cannot read back, and fails the suite by name;</item>
/// <item><b>vendor refused</b>: the vendor reader refuses the network before any text (not the text's).</item>
/// </list>
/// </summary>
public static class StNetworkOracle
{
    public sealed record Result(string Source, int Index, string Bucket, string Category, IReadOnlyList<string> Members,
                                string? Detail, string? Text = null);

    public const string Identical = "identical";
    public const string Stored = "stored members only";
    public const string Unsupported = "unsupported";
    public const string Gap = "gap";
    public const string VendorRefused = "vendor refused";

    public static Result Refused(string source, int index, string reason) => new(source, index, VendorRefused, reason, Array.Empty<string>(), null);

    public static Result Check(string source, int index, BodyLanguage language, Network net, NetworkScope scope)
    {
        var body = new NetworkBody(language, new[] { net with { Order = 0 } });
        string text;
        try { text = StNetworkWriter.Write(body, scope); }
        catch (StNetworkUnspellableException e)
        {
            return new(source, index, Unsupported, e.Reason, Array.Empty<string>(), e.Detail);
        }
        NetworkBody back;
        try { back = StNetworkReader.Read(text, scope); }
        catch (StNetworkReadException e)
        {
            return new(source, index, Gap, "reader: " + Regex.Replace(e.Message, " at '.*", ""), Array.Empty<string>(), e.Message + "\n" + text);
        }
        var want = Canonical(NetworkTextFacts.Carried(body));
        var got = Canonical(NetworkTextFacts.Carried(back));
        if (NetworkModelEquality.FirstDifference(want, got) is null) return new(source, index, Identical, "", Array.Empty<string>(), null, text);

        var members = new SortedSet<string>(StringComparer.Ordinal);
        var spelled = new NetworkBody(language, body.Networks.Select(n => n with { Trees = n.Trees.Select(t => Spelled(t, members, scope, language, root: true)).ToList() }).ToList());
        var d = NetworkModelEquality.FirstDifference(Canonical(NetworkTextFacts.Carried(spelled)), got);
        if (d is null) return new(source, index, Stored, "", members.ToList(), null, text);
        return new(source, index, Gap, "diff: " + Category(d), members.ToList(), d + "\n" + text, text);
    }

    /// <summary>Every network of <paramref name="body"/> through <see cref="Check"/>, against the scope its model states
    /// (<see cref="NetworkModelScopes.ScopeOf"/>), for a source with no declarations; a gap fails here, naming it.</summary>
    public static IReadOnlyList<Result> CheckBody(string source, NetworkBody body)
    {
        var scope = NetworkModelScopes.ScopeOf(body);
        var results = body.Networks.Select((n, i) => Check(source, i, body.Language, n, scope)).ToList();
        var gaps = results.Where(r => r.Bucket == Gap).ToList();
        if (gaps.Count > 0)
            throw new Xunit.Sdk.XunitException("the plain-ST writer wrote text that does not read back to the network it wrote:\n" +
                string.Join("\n\n", gaps.Select(g => $"{g.Source} #{g.Index}: {g.Category}\n{g.Detail}")));
        return results;
    }

    /// <summary>The model with each network's Demux VarIds numbered 1, 2, … by where their definitions stand (the trees in
    /// order, a node before its children): the text names wires across the body (design.md 1.4) and does not spell the
    /// vendor's VarId, so the oracle compares wires by position, in its own code.</summary>
    static NetworkBody Canonical(NetworkBody body) =>
        body with { Networks = body.Networks.Select(n => n with { Trees = Renumbered(n.Trees) }).ToList() };

    static IReadOnlyList<Node> Renumbered(IReadOnlyList<Node> trees)
    {
        var ids = new Dictionary<int, int>();
        void Walk(Node? n)
        {
            if (n is Demux { Input: not null } d && !ids.ContainsKey(d.VarId)) ids[d.VarId] = ids.Count + 1;
            if (n is not null) foreach (var c in n.Children()) Walk(c);
        }
        foreach (var t in trees) Walk(t);
        Node Map(Node n) => n switch
        {
            Demux d => new Demux(ids.TryGetValue(d.VarId, out var id) ? id : -d.VarId, d.Input is null ? null : Map(d.Input)),
            Assign a => a with { Value = Map(a.Value) },
            Box b => b with { Enable = b.Enable is null ? null : Map(b.Enable), Inputs = b.Inputs.Select(i => i with { Value = Map(i.Value) }).ToList() },
            Parallel p => new Parallel(p.Input is null ? null : Map(p.Input), p.Branches.Select(Map).ToList(), p.Mode),
            _ => n,
        };
        return trees.Select(Map).ToList();
    }

    /// <summary>A difference's path with its indices dropped and its values summarised: the gap's category.</summary>
    private static string Category(string diff)
    {
        var colon = diff.IndexOf(": ", StringComparison.Ordinal);
        var path = Regex.Replace(colon < 0 ? diff : diff.Substring(0, colon), @"\[\d+\]", "");
        path = Regex.Replace(path, @"^Networks\.", "");
        var values = colon < 0 ? "" : diff.Substring(colon + 2);
        values = Regex.Replace(values, @"Operand \{[^}]*\}", "Operand");
        if (values.Length > 60) values = values.Substring(0, 60) + "…";
        return path + " (" + values + ")";
    }

    // ── the design's stored members, in their spelled form ──────────────────────────────────────────────────────

    /// <summary>design.md "Stored members, not spelled": the tree as the text spells it. Each rule that changes the tree
    /// names itself in <paramref name="fired"/>.</summary>
    public static Node Spelled(Node n, ISet<string> fired, NetworkScope scope, BodyLanguage language, bool root = false)
    {
        Node S(Node x) => Spelled(x, fired, scope, language);
        switch (n)
        {
            case Assign a:
            {
                // network-language rule 1: the marks of the line into the coil and of its value read as one stack, the outer ones
                // on the line (its negation outside its edge), the rest on the value's node.
                var (value, line) = Placed(S(a.Value), a.Flags with { Jump = false, Return = false }, item: true, fired);
                return a with { Value = value, Flags = line with { Jump = a.Flags.Jump, Return = a.Flags.Return } };
            }
            case Demux d: return d.Input is null ? d : new Demux(d.VarId, S(d.Input));
            case Parallel p:
                return new Parallel(p.Input is null ? null : S(p.Input), p.Branches.Select(S).ToList(), p.Mode);
            case Box b:
            {
                // An unconnected FB input (an empty operand on a named pin) is the pin left out (measured, design.md 2.1).
                var kept = b.Inputs.Where(i => !(b.Instance is not null && i.Formal is not null && i.Flags.IsNone
                                                 && i.Value is Leaf { Operand.Text.Length: 0, Flags.IsNone: true })).ToList();
                if (kept.Count != b.Inputs.Count) fired.Add("an unconnected FB input as the pin left out");
                var contact = IsContact(b, language);
                var inputs = kept.Select(i =>
                {
                    if (contact) return i with { Value = S(i.Value) };
                    var (value, pin) = Placed(S(i.Value), i.Flags, item: false, fired);
                    return i with { Value = value, Flags = pin };
                }).ToList();
                Node? enable = null;
                var enableFlags = b.EnableFlags;
                if (b.Enable is { } en) (enable, enableFlags) = Placed(S(en), b.EnableFlags, item: false, fired);
                // A FUNCTION's or a PROGRAM's unmarked `???` past its stored output names is no output (box-states 1099-1118, 1127-1143, lost-inert).
                var outputs = b.Outputs.Where(o => !(NetworkSpelling.PastStoredNames(b, NetworkSpelling.SignatureOf(b, scope), o)
                                                     && o.Value.Text == Box.UnnamedInstance && o.Value.Flags is null or { IsNone: true })).ToList();
                if (outputs.Count != b.Outputs.Count) fired.Add("a function's or a program's ??? past its stored output names as no output");
                // An FB box is the call of its instance (design "FB boxes: the instance is the call head"); a declared one
                // carries its declaration's spelling of the type.
                var type = b.Type;
                var instance = b.Instance;
                if (b.Instance is { } inst && scope.InstanceType(inst.Text) is { } declared && declared != type
                    && Volt.Engine.Format.St.StDeclaration.SameType(declared, type))
                {
                    fired.Add("an FB type spelled as its declaration");
                    type = declared;
                }
                // network-language rule 4: at a root nothing reads the flow, so whether ENO is shown is not in the text; it is shown
                // where EN is, but on a function or an operator wiring no value (with ENO it does not build), and always on the
                // Execute box, whose one output it is.
                // network-language rule 4: an FB read by its first output with no EN states no member, so the name it is read by is
                // its declaration's, in the declaration's case.
                var mainName = b.MainOutputName;
                if (!root && b.Instance is not null && b.Enable is null && mainName is not null &&
                    NetworkSpelling.SignatureOf(b, scope) is { Outputs.Count: > 0 } fbSignature &&
                    string.Equals(fbSignature.Outputs[0], mainName, StringComparison.OrdinalIgnoreCase) && fbSignature.Outputs[0] != mainName)
                {
                    fired.Add("an FB's first output in its declaration's case");
                    mainName = fbSignature.Outputs[0];
                }
                var hasEno = b.HasEnoOutput;
                if (root && !NetworkSpelling.ConnectedByEno(b) && b.ConnectedSlot is not > 0 && b.MainOutputName is null)
                {
                    var signature = NetworkSpelling.SignatureOf(b, scope);
                    var shown = b.StCode is not null || b.Enable is not null && (signature is not { Shape: CalleeShape.Function } || outputs.Any(o => o.Formal is null));
                    if (shown != hasEno)
                    {
                        fired.Add("a root box's ENO shown where its EN is");
                        hasEno = shown;
                    }
                }
                return b with { Type = type, Instance = instance, Inputs = inputs, Enable = enable, Outputs = outputs, HasEnoOutput = hasEno, MainOutputName = mainName }
                    with { EnableFlags = enableFlags };
            }
            default: return n;
        }
    }

    /// <summary>A contact, as the writer spells one infix: an AND/OR box with no output, no pin of its own and no formal, the IDE storing
    /// no output name (with none stated, any in LD).</summary>
    static bool IsContact(Box b, BodyLanguage language) =>
        b.Type is "AND" or "OR" && b.Instance is null && b.Enable is null && b.StCode is null && b.Outputs.Count == 0 && b.Inputs.Count >= 2 &&
        b.Inputs.All(p => p.Flags.IsNone && p.Formal is null) &&
        (b.Members?[NetworkMembers.OutputNames] is { } names ? names.AsTexts.Count == 0 : language == BodyLanguage.Ld);

    /// <summary>
    /// network-language rule 1, stated in the oracle's own code: the marks of a receiver (<paramref name="item"/>: the line into a coil,
    /// its negation outside its edge; else a pin or EN, one mark) and of the node it receives (a contact's operand or a box, its edge
    /// outside its negation) are one stack, outermost first. The text spells the stack, so it is read back with the receiver taking
    /// the outer marks as far as it holds them, and the node the rest.
    /// </summary>
    static (Node Value, Flags Receiver) Placed(Node value, Flags receiver, bool item, ISet<string> fired)
    {
        var own = value is Leaf or Box ? value.Flags : Flags.None;
        if (receiver.IsNone && own.IsNone) return (value, receiver);
        var stack = new List<char>();
        void Edge(Flags f) { if (f.Rising) stack.Add('R'); if (f.Falling) stack.Add('F'); }
        if (item) { if (receiver.Negated) stack.Add('N'); Edge(receiver); }
        else { if (receiver.Negated) stack.Add('N'); Edge(receiver); }
        Edge(own);
        if (own.Negated) stack.Add('N');
        // a stack no position holds as written (two edges, an edge stacked on a pin's negation) stays as it is: the writer refuses it
        if (stack.Count(c => c != 'N') > 2 || (receiver.Rising && receiver.Falling) || (own.Rising && own.Falling) ||
            !item && !receiver.IsNone && receiver.Negated && (receiver.Rising || receiver.Falling))
            return (value, receiver);
        var k = 0;
        var line = receiver with { Negated = false, Rising = false, Falling = false };
        if (item)
        {
            if (k < stack.Count && stack[k] == 'N') { line = line with { Negated = true }; k++; }
            if (k < stack.Count && stack[k] != 'N') { line = line with { Rising = stack[k] == 'R', Falling = stack[k] == 'F' }; k++; }
        }
        else if (k < stack.Count)
        {
            line = stack[k] == 'N' ? line with { Negated = true } : line with { Rising = stack[k] == 'R', Falling = stack[k] == 'F' };
            k++;
        }
        var node = Flags.None;
        if (k < stack.Count && stack[k] != 'N') { node = node with { Rising = stack[k] == 'R', Falling = stack[k] == 'F' }; k++; }
        if (k < stack.Count && stack[k] == 'N') { node = node with { Negated = true }; k++; }
        if (k < stack.Count || value is not (Leaf or Box) && !node.IsNone) return (value, receiver);
        var placed = value is Leaf l ? l with { Flags = own with { Negated = node.Negated, Rising = node.Rising, Falling = node.Falling } }
            : value is Box b ? b with { Flags = own with { Negated = node.Negated, Rising = node.Rising, Falling = node.Falling } }
            : value;
        if (line != receiver || !placed.Flags.Equals(value.Flags)) fired.Add("a mark read at its receiver");
        return (placed, line);
    }

    // ── the report ─────────────────────────────────────────────────────────────────────────────────────────────

    public static string Report(string title, IEnumerable<Result> results)
    {
        var list = results.ToList();
        var sb = new StringBuilder();
        sb.Append("== ").Append(title).Append(" ==\n");
        foreach (var g in list.GroupBy(r => r.Source.Split('/')[0]).OrderBy(g => g.Key, StringComparer.Ordinal))
            sb.Append($"  {g.Key}: {g.Count()} networks — identical {g.Count(r => r.Bucket == Identical)}, stored members only {g.Count(r => r.Bucket == Stored)}, unsupported {g.Count(r => r.Bucket == Unsupported)}, gap {g.Count(r => r.Bucket == Gap)}, vendor refused {g.Count(r => r.Bucket == VendorRefused)}\n");
        sb.Append($"  TOTAL: {list.Count} — identical {list.Count(r => r.Bucket == Identical)}, stored {list.Count(r => r.Bucket == Stored)}, unsupported {list.Count(r => r.Bucket == Unsupported)}, gap {list.Count(r => r.Bucket == Gap)}, vendor refused {list.Count(r => r.Bucket == VendorRefused)}\n");
        sb.Append("  stored members (networks):\n");
        foreach (var m in list.Where(r => r.Bucket == Stored).SelectMany(r => r.Members).GroupBy(m => m).OrderByDescending(g => g.Count()))
            sb.Append($"    {N(m.Count())} {m.Key}\n");
        sb.Append("  unsupported, gaps and vendor refusals:\n");
        foreach (var c in list.Where(r => r.Bucket is Gap or VendorRefused or Unsupported).GroupBy(r => r.Bucket + ": " + r.Category).OrderByDescending(g => g.Count()))
        {
            var ex = c.First();
            sb.Append($"    {N(c.Count())} {c.Key}\n        e.g. {ex.Source} #{ex.Index}: {Indent(ex.Detail)}\n");
            foreach (var more in c.Skip(1).Take(4)) sb.Append($"        also {more.Source} #{more.Index}\n");
        }
        return sb.ToString();

        static string N(int n) => n.ToString(System.Globalization.CultureInfo.InvariantCulture).PadLeft(4);
        static string Indent(string? s) => (s ?? "").Replace("\n", "\n          | ");
    }

    /// <summary>The pinned tally: the bucket counts and every unsupported / vendor-refused category's count, and NO gap. A
    /// mismatch prints the actual table as code, so a changed count is diagnosed (and, when meant, re-pinned) from the
    /// failure alone.</summary>
    public static void AssertTally(IEnumerable<Result> results, string report, int identical, int stored,
                                   IReadOnlyDictionary<string, int> unsupported)
    {
        var list = results.ToList();
        var gaps = list.Where(r => r.Bucket == Gap).ToList();
        if (gaps.Count > 0)
            throw new Xunit.Sdk.XunitException("the plain-ST writer wrote text that does not read back to the network it wrote:\n" +
                string.Join("\n\n", gaps.Select(g => $"{g.Source} #{g.Index}: {g.Category}\n{g.Detail}")) + "\n\n" + report);
        var actual = list.Where(r => r.Bucket is VendorRefused or Unsupported)
            .GroupBy(r => (r.Bucket == VendorRefused ? "vendor refused: " : "") + r.Category)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal);
        var ok = list.Count(r => r.Bucket == Identical) == identical && list.Count(r => r.Bucket == Stored) == stored &&
                 actual.Count == unsupported.Count && actual.All(kv => unsupported.TryGetValue(kv.Key, out var n) && n == kv.Value);
        if (ok) return;
        var table = $"identical: {list.Count(r => r.Bucket == Identical)}, stored: {list.Count(r => r.Bucket == Stored)},\n" +
                    string.Join("\n", actual.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => $"    [\"{kv.Key}\"] = {kv.Value},"));
        throw new Xunit.Sdk.XunitException("the plain-ST oracle's tally changed:\n" + table + "\n\n" + report);
    }

    /// <summary>Write the report where <c>VOLT_ST_ORACLE_REPORT</c> points (a directory), one file per suite.</summary>
    public static void Save(string name, string report, IEnumerable<Result>? results = null)
    {
        if (Environment.GetEnvironmentVariable("VOLT_ST_ORACLE_REPORT") is not { Length: > 0 } dir) return;
        System.IO.File.WriteAllText(System.IO.Path.Combine(dir, name + ".txt"), report);
        if (results is not null)
            System.IO.File.WriteAllText(System.IO.Path.Combine(dir, name + ".st.txt"),
                string.Concat(results.Select(r => $"==== {r.Source} #{r.Index} [{r.Bucket}{(r.Members.Count > 0 ? ": " + string.Join("; ", r.Members) : "")}]\n{r.Text ?? r.Category + "\n"}")));
    }

    /// <summary>A scope of the FB instances a body's boxes name, with their types — for a source with no declarations (the
    /// TwinCAT archives). An instance that is no name a declaration makes (<c>fbs[i]</c>) is its array's element.</summary>
    public static NetworkScope InstancesOf(NetworkBody body)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        void Walk(Node? n)
        {
            if (n is Box { Instance: { } i } b)
            {
                var key = Regex.IsMatch(i.Text, @"^[A-Za-z_][A-Za-z0-9_.]*$") ? i.Text
                    : Regex.Match(i.Text, @"^([A-Za-z_][A-Za-z0-9_.]*)\[[^\]]*\]$") is { Success: true } m ? m.Groups[1].Value + NetworkScope.ArrayKey
                    : null;
                if (key is not null) map[key] = b.Type;
            }
            if (n is not null) foreach (var c in n.Children()) Walk(c);
        }
        foreach (var net in body.Networks) foreach (var t in net.Trees) Walk(t);
        return new NetworkScope(Array.Empty<string>(), Array.Empty<string>(), map);
    }
}
