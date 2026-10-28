using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Volt.Engine.Format.Network;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Tests.Shared;

/// <summary>
/// THE MODEL AS A LINE OF TEXT — the shared network-text case set's expected model (<c>test/fixtures/network-text-st</c>,
/// openspec <c>ld-fbd-coverage</c> 2R.3): one S-expression per NWL item, over the model as the text CARRIES it
/// (<see cref="NetworkTextFacts.Carried"/>), so a case states exactly the facts the text is meant to carry and no other.
///
/// <code>
///   NETWORK [label:L] [disabled] [title:"…"] [comment:"…"] [unsupported:"…"]
///   leaf      a · 'Recipes' · -1 · `x + 1`        (backticked where it holds a space or a bracket)
///   flags     not:a · rise:a · rise:not:a · not:(AND a b)
///   empty     _
///   assign    (:= x S=y R=z VALUE)                  jump (jmp L VALUE) · return (ret VALUE) — a lone plain one
///             a coil's target: [S=|R=][not:|rise:|fall:](name | jmp:L | ret)   (:= x1 jmp:Done c) · (:= S=rise:xe c)
///   split     (split 3 VALUE) · a reference #3
///   box       (TYPE[@inst] input… [=>slot:target | =>Formal:target]… [en:VALUE] [conn:N] [eno:1] [name:N])
///             input: VALUE · Formal=VALUE · !Formal=VALUE (a negated pin) · /… \… (a rising / falling pin)
///             enable: en:VALUE · !en:VALUE /en: \en: (the EN pin's own modifier)
///   execute   (EXECUTE "st" [en:VALUE] [conn:N])
///   parallel  (par seq|sc FEED|- BRANCH…)
/// </code>
/// </summary>
public static class NetworkModelDump
{
    public static string Of(NetworkBody body)
    {
        var carried = NetworkTextFacts.Carried(body);
        var sb = new StringBuilder();
        foreach (var n in carried.Networks)
        {
            sb.Append("NETWORK");
            if (n.Label is { } l) sb.Append(" label:").Append(l);
            if (n.Disabled) sb.Append(" disabled");
            if (n.Title is { } t) sb.Append(" title:").Append(Quote(t));
            if (n.Comment is { } c) sb.Append(" comment:").Append(Quote(c));
            if (n.Unsupported is { } u) sb.Append(" unsupported:").Append(Quote(u));
            if (n.UnsupportedHash is { } h) sb.Append(" hash:").Append(h);
            sb.Append('\n');
            foreach (var tree in n.Trees) sb.Append("  ").Append(Node(tree)).Append('\n');
        }
        return sb.ToString();
    }

    /// <summary>A dump compared layout-free: runs of whitespace are one space, and none at a line's end.</summary>
    public static string Normalized(string dump) =>
        string.Join("\n", dump.Replace("\r\n", "\n").Split('\n').Select(l => Regex.Replace(l.Trim(), @"\s+", " ")).Where(l => l.Length > 0));

    private static string Node(Node n) => n switch
    {
        Leaf l => Flagged(Operand(l.Operand.Text), l.Flags),
        Terminator t => Flagged("_", t.Flags),
        Demux { Input: { } input } d => "(split " + d.VarId.ToString(CultureInfo.InvariantCulture) + " " + Node(input) + ")",
        Demux d => "#" + d.VarId.ToString(CultureInfo.InvariantCulture),
        Assign a => AssignOf(a),
        Box b => Flagged(BoxOf(b), b.Flags),
        Parallel p => "(par " + (p.Mode == ParallelMode.Sequential ? "seq" : "sc") + " " + (p.Input is null ? "-" : Node(p.Input)) +
                      string.Concat(p.Branches.Select(br => " " + Node(br))) + ")",
        _ => "(?" + n.GetType().Name + ")",
    };

    private static string AssignOf(Assign a)
    {
        // One target takes the item's control-flow bit (DIALECT C13; NetworkTextFacts carries it on the target).
        var targets = a.Targets.Count == 1 && (a.Flags.Jump || a.Flags.Return)
            ? new[] { a.Targets[0] with { Flags = (a.Targets[0].Flags ?? Flags.None) with { Jump = a.Flags.Jump || a.Targets[0].Flags?.Jump == true, Return = a.Flags.Return || a.Targets[0].Flags?.Return == true } } }
            : a.Targets.ToArray();
        if (targets.Length == 0 && a.Flags.Return) return "(ret " + Node(a.Value) + ")";
        // A lone plain jump or return keeps its own form.
        if (targets.Length == 1 && targets[0].Flags is { } lone && (lone.Jump || lone.Return) &&
            (lone with { Jump = false, Return = false }).IsNone)
            return lone.Jump ? "(jmp " + targets[0].Text + " " + Node(a.Value) + ")" : "(ret " + Node(a.Value) + ")";
        return "(:= " + string.Join(" ", targets.Select(Target)) + " " + Node(a.Value) + ")";
    }

    private static string Target(Operand t)
    {
        var f = t.Flags ?? Flags.None;
        var name = f.Jump ? "jmp:" + t.Text : f.Return ? "ret" : Operand(t.Text);
        return (f.Set ? "S=" : f.Reset ? "R=" : "") + Flagged(name, f with { Set = false, Reset = false, Jump = false, Return = false });
    }

    private static string Pin(Flags f) => (f.Rising ? "/" : f.Falling ? "\\" : "") + (f.Negated ? "!" : "");

    private static string BoxOf(Box b)
    {
        if (b.StCode is { } st)
        {
            var e = new StringBuilder("(EXECUTE ").Append(Quote(st));
            if (b.Enable is { } en) e.Append(' ').Append(Pin(b.EnableFlags)).Append("en:").Append(Node(en));
            if (b.ConnectedSlot is { } c) e.Append(" conn:").Append(c.ToString(CultureInfo.InvariantCulture));
            return e.Append(')').ToString();
        }
        var sb = new StringBuilder("(").Append(Operand(b.Type));
        if (b.Instance is { } inst) sb.Append('@').Append(Operand(inst.Text));
        foreach (var p in b.Inputs)
        {
            sb.Append(' ').Append(Pin(p.Flags));
            if (p.Formal is { } f) sb.Append(f).Append('=');
            sb.Append(Node(p.Value));
        }
        foreach (var o in b.Outputs)
            sb.Append(" =>").Append(o.Formal ?? o.Slot?.ToString(CultureInfo.InvariantCulture) ?? "?").Append(':').Append(Operand(o.Value.Text));
        if (b.Enable is { } enable) sb.Append(' ').Append(Pin(b.EnableFlags)).Append("en:").Append(Node(enable));
        if (b.ConnectedSlot is { } conn) sb.Append(" conn:").Append(conn.ToString(CultureInfo.InvariantCulture));
        if (b.HasEnoOutput) sb.Append(" eno:1");
        if (b.MainOutputName is { } name) sb.Append(" name:").Append(name);
        return sb.Append(')').ToString();
    }

    private static string Flagged(string core, Flags f)
    {
        if (f.Negated) core = "not:" + core;
        if (f.Rising) core = "rise:" + core;
        if (f.Falling) core = "fall:" + core;
        return core;
    }

    private static string Operand(string text) =>
        text.Length > 0 && Regex.IsMatch(text, @"^[A-Za-z0-9_.#%'""?:\-$]+$") ? text : "`" + text + "`";

    private static string Quote(string s)
    {
        var q = new StringBuilder("\"");
        foreach (var c in s)
            q.Append(c switch { '"' => "\\\"", '\\' => "\\\\", '\n' => "\\n", '\r' => "\\r", '\t' => "\\t", _ => c.ToString() });
        return q.Append('"').ToString();
    }
}
