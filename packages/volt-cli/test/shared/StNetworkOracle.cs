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
        var spelled = new NetworkBody(language, body.Networks.Select(n => n with { Trees = n.Trees.SelectMany(t => SpelledItems(t, members, scope)).ToList() }).ToList());
        var d = NetworkModelEquality.FirstDifference(Canonical(NetworkTextFacts.Carried(spelled)), got);
        if (d is null) return new(source, index, Stored, "", members.ToList(), null, text);
        return new(source, index, Gap, "diff: " + Category(d), members.ToList(), d + "\n" + text, text);
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

    /// <summary>An item as the text spells it: one item, or (owner, 2026-10-28) a coil or jump sharing its value with a jump as
    /// one item per target, the coils first.</summary>
    static IEnumerable<Node> SpelledItems(Node t, ISet<string> fired, NetworkScope scope)
    {
        static bool Control(Operand x) => x.Flags is { Jump: true } or { Return: true };
        if (t is Assign a && a.Targets.Count > 1 && a.Targets.Any(Control))
        {
            fired.Add("a coil or jump sharing its value with a jump as one item per target");
            var coils = a.Targets.Where(x => !Control(x)).ToList();
            if (coils.Count > 0) yield return Spelled(new Assign(a.Value, coils, Flags.None), fired, scope, root: true);
            foreach (var c in a.Targets.Where(Control))
                yield return Spelled(new Assign(a.Value, new[] { c }, c.Flags!.Jump ? Flags.None with { Jump = true } : Flags.None with { Return = true }), fired, scope, root: true);
            yield break;
        }
        yield return Spelled(t, fired, scope, root: true);
    }

    /// <summary>design.md "Stored members, not spelled": the tree as the text spells it. Each rule that changes the tree
    /// names itself in <paramref name="fired"/>.</summary>
    public static Node Spelled(Node n, ISet<string> fired, NetworkScope scope, bool root = false)
    {
        Node S(Node x) => Spelled(x, fired, scope);
        switch (n)
        {
            case Terminator { Flags.IsNone: true } when root:
                fired.Add("an empty item stored as the rail as the empty operand");
                return new Leaf(new Operand(""), Flags.None);
            case Terminator t when !root:
                fired.Add("rail (Terminator) as TRUE");
                return new Leaf(new Operand("TRUE"), t.Flags);
            case Leaf { Operand.Text.Length: > 0 } l when !StNetworkReader.IsOperand(l.Operand.Text) && StNetworkReader.IsExpression(l.Operand.Text):
            {
                fired.Add("an operand holding an ST expression as its boxes");
                var tree = ExpressionTree(l.Operand.Text, scope);
                if (l.Flags.Negated) tree = Negate(tree);
                return l.Flags.Rising || l.Flags.Falling ? EdgeOn(tree, l.Flags) : tree;
            }
            case Assign a:
            {
                var control = a.Flags.Jump || a.Flags.Return || a.Targets.Any(x => x.Flags is { Jump: true } or { Return: true });
                Node value;
                if (control && a.Value is Leaf { Operand.Text.Length: 0, Flags.IsNone: true })
                {
                    fired.Add("an unconditional jump stored as an empty operand as the rail");
                    value = new Terminator(Flags.None);
                }
                else value = control && a.Value is Terminator { Flags.IsNone: true } ? a.Value : S(a.Value);
                var targets = a.Targets.ToList();
                if (targets.Any(x => x.Flags is { Rising: true } or { Falling: true }))
                {
                    fired.Add("edge flag on a coil");
                    targets = targets.Select(x => x.Flags is { } f ? x with { Flags = f with { Rising = false, Falling = false } } : x).ToList();
                }
                if (targets.Count == 1 && targets[0].Flags is { Negated: true, Reset: false } nf)
                {
                    fired.Add("negated coil");
                    targets[0] = targets[0] with { Flags = nf with { Negated = false } };
                    value = Negate(value);
                }
                return new Assign(value, targets, a.Flags);
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
                var inputs = kept.Select(i =>
                {
                    var v = S(i.Value);
                    var f = i.Flags;
                    if (f.Negated)
                    {
                        fired.Add("negated pin");
                        v = Negate(v);
                        f = f with { Negated = false };
                    }
                    if (f.Rising || f.Falling)
                    {
                        fired.Add("edge on a pin as the edge on its value");
                        v = EdgeOn(v, f);
                        f = f with { Rising = false, Falling = false };
                    }
                    return new Input(i.Formal, v, f);
                }).ToList();
                var enable = b.Enable is null ? null : S(b.Enable);
                var enableFlags = b.EnableFlags;
                if (enable is not null && enableFlags.Negated)
                {
                    fired.Add("negated EN");
                    enable = Negate(enable);
                    enableFlags = enableFlags with { Negated = false };
                }
                if (enable is not null && (enableFlags.Rising || enableFlags.Falling))
                {
                    fired.Add("edge on EN as the edge on its value");
                    enable = EdgeOn(enable, enableFlags);
                    enableFlags = enableFlags with { Rising = false, Falling = false };
                }
                var outputs = b.Outputs.ToList();
                if (outputs.RemoveAll(o => o.Formal is null && o.Value.Text == Box.UnnamedInstance) > 0)
                    fired.Add("extra output slot (???)");
                var type = b.Type;
                var instance = b.Instance;
                if (b.Instance is { } undeclared && undeclared.Text != Box.UnnamedInstance && scope.InstanceType(undeclared.Text) is null
                    && scope.IsBlockType(type))
                {
                    fired.Add("an FB instance no declaration holds as the unnamed instance");
                    instance = undeclared with { Text = Box.UnnamedInstance };
                }
                if (b.Instance is { } inst && scope.InstanceType(inst.Text) is { } declared && declared != type
                    && Volt.Engine.Format.St.StDeclaration.SameType(declared, type))
                {
                    fired.Add("an FB type spelled as its declaration");
                    type = declared;
                }
                Node box = b with { Type = type, Instance = instance, Inputs = inputs, Enable = enable, Outputs = outputs, EnableFlags = enableFlags };
                if (b.Flags.Negated && !root)
                {
                    fired.Add("negated box output as a NOT box");
                    box = StNetworkWriter.NotBox(((Box)box) with { Flags = Flags.None }) with { Flags = b.Flags with { Negated = false } };
                }
                return box;
            }
            default: return n;
        }
    }

    // ── the stored-member rules, stated here in the oracle's own code (design.md "Stored members, not spelled") ──
    // The writer applies the same rules to write them; sharing the code would make the oracle agree with the writer by
    // construction.

    /// <summary>A negation as the text spells it: a plain leaf negated, anything else under a NOT box.</summary>
    static Node Negate(Node n) => n switch
    {
        Terminator t => Negate(new Leaf(new Operand("TRUE"), t.Flags)),
        Leaf { Flags: { Negated: false, Rising: false, Falling: false } } l => l with { Flags = l.Flags with { Negated = true } },
        _ => StNetworkWriter.NotBox(n),
    };

    /// <summary>An edge as the text spells it: on the leaf or the box it is carried onto (the rail as a <c>TRUE</c> leaf).</summary>
    static Node EdgeOn(Node n, Flags f) => n switch
    {
        Terminator t => EdgeOn(new Leaf(new Operand("TRUE"), t.Flags), f),
        Leaf l => l with { Flags = l.Flags with { Rising = f.Rising, Falling = f.Falling } },
        Box b => b with { Flags = b.Flags with { Rising = f.Rising, Falling = f.Falling } },
        _ => n,
    };

    /// <summary>The boxes an operand holding an ST expression reads back as: the expression read as ST.</summary>
    static Node ExpressionTree(string text, NetworkScope scope) => StNetworkReader.ExpressionTree(text, scope);

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
