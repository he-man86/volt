using System;
using System.Collections.Generic;
using System.Linq;

namespace Volt.Tests.Shared;

/// <summary>The disposition codes of openspec <c>ld-fbd-coverage</c> design "1b.2".</summary>
public enum NwlCode
{
    /// <summary>Spelled, existing form.</summary>
    S,
    /// <summary>Spelled, new form (2.3).</summary>
    SPlus,
    /// <summary>Derived: the writer sets the derivation; a stored value that differs is spelled by the pragma.</summary>
    D,
    /// <summary>A MEASURED editor cache — skipped, and only while its cited <c>vendor-facts</c> row exists.</summary>
    C,
    /// <summary>A cache candidate: spelled by the pragma unless its 2.2 <c>vendor-facts</c> row proves a cache.</summary>
    R,
    /// <summary>Refused by name, per network, when not at its default (0 occurrences in the corpora).</summary>
    X,
    /// <summary>Not an archive member: what the live object answers through its API (<c>api.&lt;X&gt;</c>), an input of
    /// the reader the recorder adds — never compared. (The snippet document's <c>api.Text</c> / <c>api.Lines</c> are not
    /// this code: the CODESYS archive holds that document only as editor caches, so they ARE its content.)</summary>
    Api,
}

public sealed class NwlRule
{
    public NwlRule(string cls, string member, NwlCode code, string text, string? row = null, Func<object?, bool>? atDefault = null)
    { Class = cls; Member = member; Code = code; Text = text; Row = row; AtDefault = atDefault; }

    public string Class { get; }
    public string Member { get; }
    public NwlCode Code { get; }
    /// <summary>The design table's text form / derivation / evidence.</summary>
    public string Text { get; }
    /// <summary>The <c>vendor-facts</c> row a C member is skipped on, or the 2.2 row an R member waits for.</summary>
    public string? Row { get; }
    /// <summary>An X member: whether a stored value is the member's default (then it carries nothing to refuse).</summary>
    public Func<object?, bool>? AtDefault { get; }
    public string Key => Class + "." + Member;
}

/// <summary>
/// THE MEMBER TABLE (openspec <c>ld-fbd-coverage</c> design "1b.2", which says: "the member table below IS the oracle's
/// member list"): every archived member of the 15 NWL classes and their base, each with its disposition, plus the
/// members of the ST document an Execute box embeds (outside the 15 classes, census 1b.1 row <c>STSnippet</c>) and the
/// API answers the recorder adds. A member a stored archive holds and this table does not name fails the oracle BY
/// NAME — so a vendor that adds a member in a future SP surfaces as a red test, never as a silent loss.
/// </summary>
public static class NwlDisposition
{
    static bool EmptyList(object? v) => v is ArchiveList l && l.Items.Count == 0;
    static bool Null(object? v) => v is null;
    static bool Never(object? v) => false;
    static bool ZeroFlags(object? v) =>
        v is ArchiveNode f && f.Str("Flags") == "0" && f.Str("Fixed") is null or "false" && f.Str("Extensible") is null or "false";

    static NwlRule R(string c, string m, NwlCode code, string text, string? row = null, Func<object?, bool>? atDefault = null) =>
        new(c, m, code, text, row, atDefault);

    const string Id = "Id";
    // A measured cache since 2.2 (vendor-facts nwl-item-id, DIALECT N29): both IDEs mint every Id themselves — CODESYS on
    // the push's commit and again on load (it renumbers a body's Ids on every commit, N28), TwinCAT in the import — so a
    // stored Id survives no rebuild on either vendor and the text never spells one (design 1b.4 rejects an id in the text).
    // Its VALUE is a cache; its UNIQUENESS is not: every body the corpora hold has each Id once (0 duplicates in 46
    // bodies), and TwinCAT keeps a stored Id across save and reopen (N28), so a push must not write one twice — the
    // TwinCAT splice mints the rebuilt network's above the body's (TcNetworkWriter.Splice), and the TwinCAT oracle's
    // Every_body_a_push_writes_holds_each_id_once checks it (gate 2-2).
    const string IdText = "an IDE allocator: minted per body by the IDE (CODESYS on commit and load, TwinCAT in the import), vendor-facts nwl-item-id; unique among a body's NWL items (0 duplicates in 46 bodies), which a push keeps";

    public static readonly IReadOnlyList<NwlRule> Rules = new[]
    {
        R("NWLImplementationObject", "DefaultViewMode", NwlCode.S, "%LANGUAGE LD|FBD"),
        R("NWLImplementationObject", "NetworkList", NwlCode.S, "the %NETWORK blocks, in order"),
        R("NWLImplementationObject", "NetworkListComment", NwlCode.D, "\"\"; else {NetworkListComment := '…'} on the %LANGUAGE line"),
        R("NWLImplementationObject", "BranchCounter", NwlCode.R, "no derivation found; a pragma on the %LANGUAGE line unless a cache", "nwl-branch-counter"),
        R("NWLImplementationObject", "ValidIds", NwlCode.D, "true; else pragma"),

        R("Network", "Label", NwlCode.S, "LABEL: x"),
        R("Network", "Title", NwlCode.S, "TITLE: \"…\", every stored character ($R$N, trailing spaces inside the quotes)"),
        R("Network", "Comment", NwlCode.S, "the // lines (S); their CR LF break D"),
        R("Network", "OutCommented", NwlCode.S, "DISABLED"),
        R("Network", "NetworkItems", NwlCode.S, "the statements, in order"),
        R("Network", "Connectors", NwlCode.X, "X if non-empty", atDefault: EmptyList),
        R("Network", "ILLines", NwlCode.X, "X if non-empty (with ILStatement)", atDefault: EmptyList),
        R("Network", "ILActive", NwlCode.D, "false"),
        R("Network", "ILValid", NwlCode.D, "false; else pragma"),
        R("Network", "FBDValid", NwlCode.D, "false; else pragma"),
        R("Network", Id, NwlCode.C, IdText, "nwl-item-id"),

        R("BoxTreeAssign", "OutputItems", NwlCode.S, "the targets t1 := t2 := … value"),
        R("BoxTreeAssign", "RValue", NwlCode.S, "the value"),
        R("BoxTreeAssign", "Flags", NwlCode.R, "the item's own Jump/Return bit, derivation 0; a stored bit {Flags := Jump|Return} before the ;", "nwl-assign-item-flags"),
        R("BoxTreeAssign", Id, NwlCode.C, IdText, "nwl-item-id"),

        R("BoxTreeBox", "BoxType", NwlCode.S, "a function/operator's callee name (S); an FB/program call's is the instance's declared type (D, 1b.3), {BoxType := '…'} where it differs"),
        R("BoxTreeBox", "Instance", NwlCode.S, "the instance in fb(…); its null operand on a function/operator is D"),
        R("BoxTreeBox", "OutputItems", NwlCode.S, "=> x, .slot, the main output in place (S4 .name S+); the null slot(s) D; a call's unconnected output pins open (1b.3)"),
        R("BoxTreeBox", "Flags", NwlCode.S, "negation/edge of the box output"),
        R("BoxTreeBox", "InputFlags", NwlCode.SPlus, "NOT IN1 := v (S6); D null unless a pin is flagged; a zero-only list R nwl-input-flags-list; an edge on a pin X", "nwl-input-flags-list"),
        R("BoxTreeBox", "InputItems", NwlCode.S, "the pin values"),
        R("BoxTreeBox", "InputParam", NwlCode.S, "Names: the formals and EN := (S), an enabled operator's ['EN'] alone D (1b.3); Types R nwl-param-types"),
        R("BoxTreeBox", "OutputParam", NwlCode.S, "Names: => formal, .ENO, .slot (S); the result pin '   ' D; 14 boxes R nwl-output-param-names; a call's unconnected outputs open (1b.3)", "nwl-output-param-names"),
        R("BoxTreeBox", "CallType", NwlCode.R, "derivation BoxType + the declarations; a differing value {CallType := …}", "nwl-call-type"),
        R("BoxTreeBox", "EN", NwlCode.S, "the EN := pin when the box has an EN slot (N13); otherwise the stored bool R", "nwl-box-en-eno"),
        R("BoxTreeBox", "ENO", NwlCode.S, ".ENO when used; the stored bool R", "nwl-box-en-eno"),
        R("BoxTreeBox", "STSnippet", NwlCode.S, "the EXECUTE body text"),
        R("BoxTreeBox", "ContainsExtensibleInputs", NwlCode.D, "false; else pragma"),
        R("BoxTreeBox", "ProvidesSTSnippet", NwlCode.D, "true exactly when STSnippet is set"),
        R("BoxTreeBox", "api.MainOutputIndex", NwlCode.Api, "not archived: the slot a consumer reads (DIALECT N16), read-only on a built box (N21)"),
        R("BoxTreeBox", Id, NwlCode.C, IdText, "nwl-item-id"),

        R("BoxTreeOperand", "Operand", NwlCode.S, "the operand"),
        R("BoxTreeOperand", Id, NwlCode.C, IdText, "nwl-item-id"),

        R("BoxTreeDemux", "VarId", NwlCode.S, "g<VarId>; a renamed wire {VarId := n}"),
        R("BoxTreeDemux", "Input", NwlCode.S, "g<n> := value; defines the wire, g<n> uses it"),
        R("BoxTreeDemux", Id, NwlCode.C, IdText, "nwl-item-id"),

        R("BoxTreeParallel", "Trees", NwlCode.S, "PARALLEL(b1, b2, …)"),
        R("BoxTreeParallel", "Input", NwlCode.S, "IN := v"),
        R("BoxTreeParallel", "Mode", NwlCode.S, "MODE := Sequential (BoxShortCircuit is not written)"),
        R("BoxTreeParallel", Id, NwlCode.C, IdText, "nwl-item-id"),

        R("BoxTreeTerminator", "Input", NwlCode.X, "X if non-null (task 1.10)", atDefault: Null),
        R("BoxTreeTerminator", "Flags", NwlCode.X, "X if non-zero", atDefault: ZeroFlags),
        R("BoxTreeTerminator", Id, NwlCode.C, IdText, "nwl-item-id"),

        R("BoxTreeMux", "VarId", NwlCode.X, "X (the node)", atDefault: Never),
        R("BoxTreeMux", "InputIndex", NwlCode.X, "X (the node)", atDefault: Never),
        R("BoxTreeMux", "Merger", NwlCode.X, "X (the node)", atDefault: Never),
        R("BoxTreeMux", Id, NwlCode.X, "X (the node)", atDefault: Never),

        R("ILStatement", "Operator", NwlCode.X, "X (the node)", atDefault: Never),
        R("ILStatement", "Prefix", NwlCode.X, "X (the node)", atDefault: Never),
        R("ILStatement", "Operand", NwlCode.X, "X (the node)", atDefault: Never),
        R("ILStatement", "Postfix", NwlCode.X, "X (the node)", atDefault: Never),
        R("ILStatement", Id, NwlCode.X, "X (the node)", atDefault: Never),

        R("STSnippet", "STSnippet", NwlCode.S, "the EXECUTE body text (the document itself)"),
        R("STSnippet", Id, NwlCode.C, IdText, "nwl-item-id"),
        // The snippet's document — outside the 15 NWL classes, and its archive differs by vendor (census 1b.1).
        R("STImplementationObject", "TextDocument", NwlCode.S, "the EXECUTE body text"),
        R("TextDocument", "LineInfoPersistence", NwlCode.C, "CODESYS: an editor cache (bridge-one-to-one editor-caches)", "editor-caches"),
        R("TextDocument", "TextBlobForSerialisation", NwlCode.C, "CODESYS: an editor cache (bridge-one-to-one text-blob-serialisation)", "text-blob-serialisation"),
        R("TextDocument", "api.Text", NwlCode.S, "CODESYS: the EXECUTE body text (the archive holds it only as the two caches)"),
        R("TextDocument", "api.Lines", NwlCode.C, "CODESYS: the per-line Id/Tag, minted by the IDE on load (-1 before; vendor-facts nwl-stsnippet-line-ids)", "nwl-stsnippet-line-ids"),
        R("Line", "Id", NwlCode.C, "CODESYS: minted by the IDE on load (-1 before), an allocator like the item Id", "nwl-stsnippet-line-ids"),
        R("Line", "Tag", NwlCode.C, "CODESYS: null ×56, and null on a pushed snippet before and after load", "nwl-stsnippet-line-ids"),
        R("TextDocument", "TextLines", NwlCode.S, "TwinCAT: the EXECUTE body text, one entry per line"),
        R("TextLine", "Text", NwlCode.S, "TwinCAT: one line of the EXECUTE body text"),
        R("TextLine", "Id", NwlCode.C, "TwinCAT: minted, an allocator like the item Id", "nwl-stsnippet-line-ids"),
        R("TextLine", "Tag", NwlCode.C, "TwinCAT: null ×2, beside the minted line Id", "nwl-stsnippet-line-ids"),

        R("Operand", "Operand", NwlCode.S, "the name / literal / expression; \"\" an unconnected pin; null on a function/operator instance D"),
        R("Operand", "Type", NwlCode.R, "on a wire its declared type (S); elsewhere the declared type; Instance.Type R nwl-instance-type", "nwl-operand-type"),
        R("Operand", "Comment", NwlCode.D, "\"\"; else {Comment := '…'}"),
        R("Operand", "SymbolComment", NwlCode.SPlus, "\"\"; else {SymbolComment := '…'}"),
        R("Operand", "Address", NwlCode.R, "\"\" vs the archive sentinel; a real address by the pragma", "nwl-address-sentinel"),
        R("Operand", "Flags", NwlCode.S, "see the Flags row"),
        R("Operand", "LValue", NwlCode.D, "true exactly for an assign target or a box output slot"),
        R("Operand", "Boolean", NwlCode.R, "not derivable from Type = BOOL (they differ on 342)", "nwl-operand-boolean"),
        R("Operand", "IsInstance", NwlCode.D, "true exactly for the box's Instance"),
        R("Operand", Id, NwlCode.C, IdText, "nwl-item-id"),

        R("Flags", "Flags", NwlCode.S, "NOT, S=, R=, JMP, RETURN, R_EDGE, F_EDGE; a negated pin S+ (S6); X: an edge on a pin, Rtrig+Ftrig, a flag on a Parallel/Demux"),
        R("Flags", "Fixed", NwlCode.R, "no derivation by position", "nwl-flags-fixed"),
        R("Flags", "Extensible", NwlCode.D, "false; else pragma"),

        R("OutputItemList", "OutputItems", NwlCode.S, "through its owner (assign targets, box outputs)"),
        R("ParamList", "Names", NwlCode.S, "the formals"),
        R("ParamList", "Types", NwlCode.R, "the callee's pin types", "nwl-param-types"),
    };

    static readonly Dictionary<string, NwlRule> ByKey = Rules.ToDictionary(r => r.Key, StringComparer.Ordinal);

    public static NwlRule? Of(string cls, string member) => ByKey.TryGetValue(cls + "." + member, out var r) ? r : null;

    /// <summary>Whether <c>scripts/vendor-facts.table.ts</c> holds the row <paramref name="row"/> (a row opens with
    /// <c>id: "&lt;kebab&gt;"</c>, the table's own rule).</summary>
    public static bool RowRecorded(string row) => RecordedRows.Value.Contains(row);

    static readonly Lazy<HashSet<string>> RecordedRows = new(() =>
    {
        var table = System.IO.Path.Combine(CorpusProjects.CliRoot().FullName, "scripts", "vendor-facts.table.ts");
        return new HashSet<string>(System.Text.RegularExpressions.Regex.Matches(System.IO.File.ReadAllText(table), @"(?m)^\s*id: ""([a-z0-9-]+)"",")
            .Cast<System.Text.RegularExpressions.Match>().Select(m => m.Groups[1].Value), StringComparer.Ordinal);
    });

    /// <summary>The classes with 0 occurrences in the corpora: their members are decided without a witness.</summary>
    public static readonly IReadOnlyCollection<string> Unwitnessed = new[] { "BoxTreeMux", "ILStatement" };
}

/// <summary>One member that did not come back: <see cref="Key"/> the member (<c>Class.Member</c>), <see cref="Kind"/>
/// what is wrong with it, value-free (so a known one is the same on every run), <see cref="Where"/> the node.</summary>
public sealed class NwlFinding
{
    public NwlFinding(string key, string context, string kind, string where, object? stored, object? written)
    { Key = key; Context = context; Kind = kind; Where = where; Stored = stored; Written = written; }

    public string Key { get; }
    /// <summary>The member chain from the tree node holding the member's node (<c>BoxTreeBox.OutputParam</c>), or the
    /// node's own class when it is a tree node.</summary>
    public string Context { get; }
    public string Kind { get; }
    public string Where { get; }
    public object? Stored { get; }
    public object? Written { get; }
    public string Ledger => Key + (Context == Key.Substring(0, Key.IndexOf('.')) ? "" : " in " + Context) + " — " + Kind;
    public override string ToString() => $"{Ledger} at {Where}: {NwlArchive.Show(Stored)} -> {NwlArchive.Show(Written)}";
}

/// <summary>
/// THE MEMBER COMPARISON of the completeness oracle: a stored archive node against the one NWL → text → NWL wrote,
/// member by member, by the table. Kinds: <c>unlisted</c> (the table does not name it — always a failure, never a
/// known divergence), <c>not written</c> (the written node has no such member: nothing Volt wrote carries it),
/// <c>changed</c>, <c>list length changed</c>, <c>node class changed</c>, <c>present and not refused</c> (an X member
/// off its default on a network nobody refused).
/// </summary>
public static class NwlCompare
{
    /// <summary>Compare <paramref name="stored"/> with <paramref name="written"/>; <paramref name="skip"/> names members
    /// the caller compares elsewhere (a body's <c>NetworkList</c>, compared network by network).</summary>
    public static List<NwlFinding> Node(ArchiveNode stored, ArchiveNode? written, string where, params string[] skip)
    {
        var findings = new List<NwlFinding>();
        Walk(stored, written, where, stored.Class, findings, new HashSet<string>(skip, StringComparer.Ordinal));
        return findings;
    }

    /// <summary>Every member of every node under <paramref name="node"/> the table does not name.</summary>
    public static IEnumerable<string> Unlisted(ArchiveNode node) =>
        Nodes(node).SelectMany(n => n.Members.Where(m => NwlDisposition.Of(n.Class, m.Key) is null).Select(m => n.Class + "." + m.Key));

    /// <summary>Every (class, member) under <paramref name="node"/>.</summary>
    public static IEnumerable<string> Keys(ArchiveNode node) => Nodes(node).SelectMany(n => n.Members.Select(m => n.Class + "." + m.Key));

    public static IEnumerable<ArchiveNode> Nodes(ArchiveNode node)
    {
        yield return node;
        foreach (var m in node.Members)
            foreach (var child in Children(m.Value))
                foreach (var n in Nodes(child))
                    yield return n;
    }

    static IEnumerable<ArchiveNode> Children(object? v) => v switch
    {
        ArchiveNode n => new[] { n },
        ArchiveList l => l.Items.OfType<ArchiveNode>(),
        _ => Array.Empty<ArchiveNode>(),
    };

    /// <summary>The X members off their default anywhere under <paramref name="node"/> — the network must have been
    /// refused by name.</summary>
    public static IEnumerable<string> RefusableX(ArchiveNode node) =>
        Nodes(node).SelectMany(n => n.Members
            .Where(m => NwlDisposition.Of(n.Class, m.Key) is { Code: NwlCode.X } r && !r.AtDefault!(m.Value))
            .Select(m => n.Class + "." + m.Key));

    /// <summary>Where a node sits, for a finding's ledger key: a tree node (and a network, a body, a snippet) stands
    /// for itself; a value node (an operand, a flag set, a parameter or output list, a document) is named by the chain
    /// of members from the tree node holding it — an assign's target and a box's output slot are both <c>Operand</c>s,
    /// and they are different findings.</summary>
    static string ContextOf(ArchiveNode n, string parent, string member) =>
        n.Class.StartsWith("BoxTree", StringComparison.Ordinal) || n.Class is "Network" or "NWLImplementationObject" or "STSnippet"
            ? n.Class
            : parent + "." + member;

    static void Walk(ArchiveNode s, ArchiveNode? w, string where, string context, List<NwlFinding> findings, HashSet<string> skip)
    {
        foreach (var m in s.Members)
        {
            if (skip.Contains(m.Key)) continue;
            var key = s.Class + "." + m.Key;
            var at = where + "." + m.Key;
            var rule = NwlDisposition.Of(s.Class, m.Key);
            if (rule is null) { findings.Add(new(key, context, "unlisted", at, m.Value, null)); continue; }
            switch (rule.Code)
            {
                // A cache is skipped only while the vendor-facts row that measured it exists (completeness.ts's rule).
                case NwlCode.C when NwlDisposition.RowRecorded(rule.Row!):
                case NwlCode.Api:
                    continue;
                case NwlCode.C:
                    findings.Add(new(key, context, $"a cache citing no vendor-facts row ('{rule.Row}')", at, m.Value, null));
                    continue;
                case NwlCode.X:
                    if (!rule.AtDefault!(m.Value)) findings.Add(new(key, context, "present and not refused", at, m.Value, null));
                    continue;
            }
            if (w is null || !w.Has(m.Key)) { findings.Add(new(key, context, "not written", at, m.Value, null)); continue; }
            Value(key, context, m.Key, m.Value, w[m.Key], at, findings);
        }
    }

    static void Value(string key, string context, string member, object? s, object? w, string at, List<NwlFinding> findings)
    {
        switch (s)
        {
            case ArchiveNode sn when w is ArchiveNode wn:
                if (sn.Class != wn.Class) findings.Add(new(key, context, "node class changed", at, sn, wn));
                else Walk(sn, wn, at, ContextOf(sn, context, member), findings, new HashSet<string>());
                return;
            case ArchiveList sl when w is ArchiveList wl:
                if (sl.Items.Count != wl.Items.Count) { findings.Add(new(key, context, "list length changed", at, sl, wl)); return; }
                for (var i = 0; i < sl.Items.Count; i++) Value(key, context, member, sl.Items[i], wl.Items[i], $"{at}[{i}]", findings);
                return;
            default:
                if (!Equals(s, w)) findings.Add(new(key, context, "changed", at, s, w));
                return;
        }
    }
}

/// <summary>
/// THE KNOWN DIVERGENCES of the completeness oracle — red first. Each entry is a member and the kind of loss
/// (<see cref="NwlFinding.Ledger"/>), the task that closes it, and how many NETWORKS (bodies, for a body-level member)
/// and nodes show it today. The run must find exactly these: a finding no entry names fails by name, an entry whose
/// count moved fails (read the change, never re-pin it blind), and an entry nothing shows any more fails as stale —
/// "it holds now, remove the mark".
/// </summary>
public sealed class NwlKnown
{
    public NwlKnown(string ledger, int networks, int nodes, string task) { Ledger = ledger; Networks = networks; Nodes = nodes; Task = task; }
    public string Ledger { get; }
    public int Networks { get; }
    public int Nodes { get; }
    public string Task { get; }
}

public static class NwlLedger
{
    /// <summary>Hold <paramref name="findings"/> (per network: its id and its findings) to <paramref name="known"/>.</summary>
    public static void AssertExactly(string vendor, IEnumerable<(string Network, List<NwlFinding> Findings)> findings,
        IReadOnlyList<NwlKnown> known)
    {
        var byLedger = new Dictionary<string, (HashSet<string> Networks, int Nodes, NwlFinding First)>(StringComparer.Ordinal);
        foreach (var (net, list) in findings)
            foreach (var f in list)
            {
                if (!byLedger.TryGetValue(f.Ledger, out var e)) e = (new HashSet<string>(StringComparer.Ordinal), 0, f);
                e.Networks.Add(net);
                byLedger[f.Ledger] = (e.Networks, e.Nodes + 1, e.First);
            }

        var knownBy = known.ToDictionary(k => k.Ledger, StringComparer.Ordinal);
        var problems = new List<string>();
        foreach (var kv in byLedger.OrderBy(k => k.Key, StringComparer.Ordinal))
        {
            if (!knownBy.TryGetValue(kv.Key, out var k))
                problems.Add($"UNEXPECTED {vendor}: {kv.Key} — {kv.Value.Networks.Count} network(s), {kv.Value.Nodes} node(s); first: {kv.Value.First}");
            else if (k.Networks != kv.Value.Networks.Count || k.Nodes != kv.Value.Nodes)
                problems.Add($"MOVED {vendor}: {kv.Key} — known {k.Networks} network(s) / {k.Nodes} node(s), now {kv.Value.Networks.Count} / {kv.Value.Nodes} (read the change; never re-pin blind); first: {kv.Value.First}");
        }
        foreach (var k in known.Where(k => !byLedger.ContainsKey(k.Ledger)))
            problems.Add($"STALE {vendor}: {k.Ledger} — no network shows it any more: task {k.Task} closed it. Remove the entry.");
        if (problems.Count > 0) throw new Xunit.Sdk.XunitException(string.Join("\n", problems));
    }

    /// <summary>The findings as known-entry source lines (to read, never to paste blind: each needs its task).</summary>
    public static string Draft(IEnumerable<(string Network, List<NwlFinding> Findings)> findings) =>
        string.Join("\n", findings.SelectMany(x => x.Findings.Select(f => (x.Network, f)))
            .GroupBy(x => x.f.Ledger, StringComparer.Ordinal).OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g => $"new(\"{g.Key}\", {g.Select(x => x.Network).Distinct().Count()}, {g.Count()}, \"?\"),"));
}
