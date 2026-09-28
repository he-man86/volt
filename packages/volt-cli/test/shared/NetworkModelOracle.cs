using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Xunit;
using Parallel = Volt.Engine.Format.Network.Parallel;
using Volt.Engine.Format.Body;

namespace Volt.Tests.Shared;

/// <summary>
/// THE MODEL ROUND-TRIP ORACLE for network text v2 — spec, "the round trip is checked on tokens and on models":
/// for a model <c>m</c> the writer either REFUSES it by name (<see cref="UnrepresentableBodyException"/>, which the
/// pull turns into the body marker) or <c>NetworkTextReader.Read(NetworkTextWriter.Write(m)) ≅ m</c>, where
/// ≅ is structural equality on what the text carries (<see cref="NetworkTextFacts.Carried"/>), and the gate
/// accepts the written text as canonical.
///
/// <para>Compiled into each suite that owns a model source (the engine's goldens and the corpus, TwinCAT's
/// archives), so every suite applies the SAME check and the per-reason refusal tables can be compared.</para>
///
/// <para>Anything else is a failure, loudly: the writer throwing any other exception (pull must never throw
/// anything but the refusal), the reader or gate refusing the writer's own text, or the model coming back
/// different — which is the "pull-side loss" the text round trip alone cannot see.</para>
/// </summary>
internal static class NetworkModelOracle
{
    /// <summary>What happened to one body: round-tripped (<see cref="Reason"/> null) or refused for a reason
    /// (the exception's <c>Marker</c> — the writer's name for the fact it cannot spell).</summary>
    public sealed record Outcome(string Source, int Networks, string? Reason);

    /// <param name="declared">The scope the body was READ against, when the source has one (the corpus: its project's
    /// own declarations, <c>NetworkScope.FromDeclarations</c>) — it decides which qualified instance paths are
    /// declared (<see cref="Instances"/>). Null for a source with no declarations (archives, test models).</param>
    public static Outcome Check(string source, NetworkBody m, NetworkScope? declared = null)
    {
        var outcome = CheckIn(source, m, ScopeOf(m, declared));
        // The pull does not always know every name the body uses: until task 3.9 builds the scope from every
        // declaration, a method reading a GVL's variable or its FB's member meets a scope without it. Read against
        // ScopeOf alone, the oracle only ever faced a scope holding every word of the body — and passed a writer that
        // left an undeclared `g5` bare for its own reader to refuse. So the same body is checked against the scope of
        // its CALLABLES only, no variable declared, and must come to the same end.
        var undeclared = CheckIn(source + " (no variable in scope)", m, CallablesOf(m, declared));
        Assert.True(undeclared.Reason == outcome.Reason,
            $"{source}: with its variables in scope the body is {outcome.Reason ?? "round-tripped"}, without them {undeclared.Reason ?? "round-tripped"} — a variable's declaration decides no spelling but a wire's name.");
        return outcome;
    }

    static Outcome CheckIn(string source, NetworkBody m, NetworkScope scope)
    {
        string text;
        try
        {
            text = NetworkTextWriter.Write(m, scope);
        }
        catch (UnrepresentableBodyException e)
        {
            return new Outcome(source, m.Networks.Count, e.Reason);
        }
        catch (Exception e)
        {
            // Not a refusal: a writer defect on the pull path, where only the refusal may escape.
            Assert.Fail($"{source}: the v2 writer threw {e.GetType().Name} instead of refusing by name: {e.Message}");
            throw;
        }

        var back = NetworkTextReader.Read(text, scope);
        Assert.True(back.Ok,
            $"{source}: the v2 reader refuses the v2 writer's own text:\n" +
            string.Join("\n", back.Diagnostics.Select(d => $"{d.Line}:{d.Column} {d.Code} {d.Message}")) + "\n\n" + text);

        var diff = NetworkModelEquality.FirstDifference(
            NetworkTextFacts.Carried(m), NetworkTextFacts.Carried(RestoreRenamedWires(source, m, back.Body!, scope)));
        Assert.True(diff is null, $"{source}: Read(Write(m)) differs from m at {diff}\n\n{text}");

        var gate = NetworkTextGate.Validate(text, scope);
        Assert.True(gate.Ok,
            $"{source}: the gate refuses the writer's own text:\n" +
            string.Join("\n", gate.Diagnostics.Select(d => $"{d.Code} {d.Message}")) + "\n\n" + text);

        return new Outcome(source, m.Networks.Count, null);
    }

    /// <summary>
    /// The one VarId change the spec makes on purpose: a wire whose <c>g&lt;VarId&gt;</c> collides with a name in
    /// scope or a word the body spells (the writer reserves both) is written as the lowest free <c>g&lt;n&gt;</c>, and reads back — and is pushed — as VarId n (spec,
    /// "the writer avoids a collision"). So the read-back ids are mapped back onto the model's, per network, in
    /// the order the wires occur — and ONLY where that rename was forced: an id that changed although its
    /// <c>g&lt;VarId&gt;</c> was free, or a mapping that is not one-to-one, fails here rather than being mapped away.
    /// </summary>
    static NetworkBody RestoreRenamedWires(string source, NetworkBody m, NetworkBody back, NetworkScope scope)
    {
        if (m.Networks.Count != back.Networks.Count) return back;
        var spelled = ScopeOf(m);   // every word the body spells: the writer's reserved set beside the scope
        var nets = new List<Network>();
        for (var i = 0; i < back.Networks.Count; i++)
        {
            var want = new List<int>();
            var got = new List<int>();
            foreach (var t in m.Networks[i].Trees) Ids(t, want);
            foreach (var t in back.Networks[i].Trees) Ids(t, got);
            if (want.Count != got.Count) return back;
            var map = new Dictionary<int, int>();
            var inverse = new Dictionary<int, int>();
            for (var k = 0; k < got.Count; k++)
            {
                if (map.TryGetValue(got[k], out var w) && w != want[k] || inverse.TryGetValue(want[k], out var g) && g != got[k])
                    return back;   // not one-to-one: the structures differ, and the comparison names where
                map[got[k]] = want[k];
                inverse[want[k]] = got[k];
                Assert.True(got[k] == want[k] || scope.Contains("g" + want[k]) || spelled.Contains("g" + want[k]),
                    $"{source}: network {i}'s wire VarId {want[k]} came back as {got[k]}, and g{want[k]} names nothing in scope or in the body — only a colliding wire is renamed.");
            }
            var net = back.Networks[i];
            nets.Add(net with { Trees = net.Trees.Select(t => Renumber(t, map)).ToList() });
        }
        return back with { Networks = nets };
    }

    static void Ids(Node? n, List<int> into)
    {
        switch (n)
        {
            case Demux d: into.Add(d.VarId); Ids(d.Input, into); break;
            case Assign a: Ids(a.Value, into); break;
            case Box b: Ids(b.Enable, into); foreach (var p in b.Inputs) Ids(p.Value, into); break;
            case Parallel p: Ids(p.Input, into); foreach (var br in p.Branches) Ids(br, into); break;
        }
    }

    static Node? RenumberOrNull(Node? n, Dictionary<int, int> map) => n is null ? null : Renumber(n, map);

    static Node Renumber(Node n, Dictionary<int, int> map) => n switch
    {
        Demux d => d with { VarId = map.TryGetValue(d.VarId, out var v) ? v : d.VarId, Input = RenumberOrNull(d.Input, map) },
        Assign a => a with { Value = Renumber(a.Value, map) },
        Box b => b with
        {
            Enable = RenumberOrNull(b.Enable, map),
            Inputs = b.Inputs.Select(p => p with { Value = Renumber(p.Value, map) }).ToList(),
        },
        Parallel p => p with { Input = RenumberOrNull(p.Input, map), Branches = p.Branches.Select(br => Renumber(br, map)).ToList() },
        _ => n,
    };

    /// <summary>The declarations a vendor model's text is read back against: every name it spells as an operand,
    /// target or instance, the POUs it calls (its box types), and its FB instances with their types
    /// (<see cref="Instances"/>). Taken from the model
    /// because these sources (archives, test models, corpus bodies) come without a parsed VAR block — and every
    /// operand of a body the vendor holds IS a name in scope (a variable, a global, a member), which is what the
    /// reader's "a wire-shaped name in no scope" refusal relies on.</summary>
    public static NetworkScope ScopeOf(NetworkBody body, NetworkScope? declared = null)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var pous = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Words(string text) => names.UnionWith(NetworkSpelling.Words(text));
        void Walk(Node? n)
        {
            switch (n)
            {
                case Leaf l: Words(l.Operand.Text); break;
                case Box b:
                    Words(b.Type);
                    pous.Add(b.Type);   // a function or FB type is a POU in scope
                    if (b.Instance is { } i) Words(i.Text);
                    foreach (var o in b.Outputs) Words(o.Value.Text);
                    Walk(b.Enable);
                    foreach (var p in b.Inputs) Walk(p.Value);
                    break;
                case Assign a: foreach (var t in a.Targets) Words(t.Text); Walk(a.Value); break;
                case Demux d: Walk(d.Input); break;
                case Parallel p: Walk(p.Input); foreach (var br in p.Branches) Walk(br); break;
            }
        }
        foreach (var net in body.Networks) foreach (var t in net.Trees) Walk(t);
        return new NetworkScope(names, pous, Instances(body, declared));
    }

    /// <summary>What the scope holds of a model when no VARIABLE is declared: its POUs (box types) and its FB
    /// instances with their types — the facts the text needs to read a call back — and nothing else.</summary>
    public static NetworkScope CallablesOf(NetworkBody body, NetworkScope? declared = null)
    {
        var pous = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Walk(Node? n)
        {
            switch (n)
            {
                case Box b:
                    pous.Add(b.Type);
                    Walk(b.Enable);
                    foreach (var p in b.Inputs) Walk(p.Value);
                    break;
                case Assign a: Walk(a.Value); break;
                case Demux d: Walk(d.Input); break;
                case Parallel p: Walk(p.Input); foreach (var br in p.Branches) Walk(br); break;
            }
        }
        foreach (var net in body.Networks) foreach (var t in net.Trees) Walk(t);
        return new NetworkScope(Array.Empty<string>(), pous, Instances(body, declared));
    }

    /// <summary>A model's FB instances with their types — what the POU's declarations would say of each, and
    /// ONLY what they can say. An identifier is a name a declaration makes. A QUALIFIED path
    /// (<c>Mach1_AuxData.IEC_TIMERS.OffDelayLockDrives</c>) is one only when the declarations resolve it through a GVL
    /// and its structs — the push reads it against the same <c>NetworkScope.FromDeclarations</c> the pull wrote it
    /// with — so it is declared here exactly when <paramref name="declared"/>, the scope the body was read against,
    /// says so; a source with no declarations has no such answer and declares none. An array element or
    /// <c>SUPER^</c> (census 1.12) is no name at all. Declaring more than the declarations do would make the oracle
    /// pass a body the push path loses; declaring less refuses one it keeps.</summary>
    public static Dictionary<string, string> Instances(NetworkBody body, NetworkScope? declared = null)
    {
        var instances = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        void Walk(Node? n)
        {
            switch (n)
            {
                case Box b:
                    if (b.Instance is { } i
                        && (NetworkSpelling.Identifier.IsMatch(i.Text) || declared?.InstanceType(i.Text) is not null))
                        instances[i.Text] = b.Type;
                    Walk(b.Enable);
                    foreach (var p in b.Inputs) Walk(p.Value);
                    break;
                case Assign a: Walk(a.Value); break;
                case Demux d: Walk(d.Input); break;
                case Parallel p: Walk(p.Input); foreach (var br in p.Branches) Walk(br); break;
            }
        }
        foreach (var net in body.Networks) foreach (var t in net.Trees) Walk(t);
        return instances;
    }

    /// <summary>The tally a suite pins: bodies and networks round-tripped, and refusals per reason.</summary>
    public static (int Bodies, int Networks, SortedDictionary<string, int> Refused) Tally(IEnumerable<Outcome> outcomes)
    {
        var list = outcomes.ToList();
        var refused = new SortedDictionary<string, int>(StringComparer.Ordinal);
        foreach (var o in list.Where(o => o.Reason is not null))
            refused[o.Reason!] = refused.TryGetValue(o.Reason!, out var n) ? n + 1 : 1;
        var ok = list.Where(o => o.Reason is null).ToList();
        return (ok.Count, ok.Sum(o => o.Networks), refused);
    }

    /// <summary>Assert a tally against its pinned table, printing the whole actual table on a mismatch so a
    /// changed count is diagnosed from the failure alone.</summary>
    public static void AssertTally(string what, IEnumerable<Outcome> outcomes, int bodies, int networks,
                                   IReadOnlyDictionary<string, int> refused)
    {
        var list = outcomes.ToList();
        var (b, n, r) = Tally(list);
        string Show() =>
            $"{what}: round-tripped {b} bodies / {n} networks; refused:\n" +
            string.Join("\n", r.Select(kv => $"  [\"{kv.Key}\"] = {kv.Value},")) +
            "\nby source:\n" + string.Join("\n", list.Where(o => o.Reason is not null).Select(o => $"  {o.Source}: {o.Reason}"));
        Assert.True(b == bodies && n == networks && r.Count == refused.Count &&
                    r.All(kv => refused.TryGetValue(kv.Key, out var want) && want == kv.Value), Show());
    }
}
