using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Engine;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Ide;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Tests.Shared.NwlArchive;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// THE NWL COMPLETENESS ORACLE, CODESYS HALF (openspec <c>ld-fbd-coverage</c> 1b.3, red first): for every LD/FBD network
/// of the five CODESYS corpora, the vendor's archive as recorded (<c>test/fixtures/nwl-corpus</c>,
/// <c>scripts/record-nwl-corpus.py</c>) goes NWL → network text → NWL through the SHIPPED code — the reader, the text
/// writer and reader, and the writer — and every archived member that is not a measured editor cache must come back
/// exactly (<see cref="NwlDisposition"/>, design "1b.2"; a member the table does not name fails by name).
///
/// <para><b>What "back" is: a CREATE.</b> Each body is written into a FRESH aspect (the object made in the language the
/// text states, as a create makes it), so every network is built from its text and nothing survives because the live
/// object did. That is the path every network a push rebuilds takes (the change gate lets only changed networks
/// through, and a rebuilt network is fresh items in the network object); a member the rebuild does not write is a
/// member the text does not carry — "not written" below — unless a <c>vendor-facts</c> row shows the IDE re-derives it.
/// The rebuilt nodes are the suite's NWL doubles (<see cref="Nwl"/>), laid over a FRESH VENDOR OBJECT of each class
/// (gate 1b-3): every object the shipped writer constructs was made in a live CODESYS as it makes it, and its archive
/// recorded (<c>live.codesys.xml</c>, <c>scripts/record-nwl-live.py</c>), so a member the writer never sets is judged
/// against what the vendor's fresh object holds — not against a double's initial value — and the doubles' initial
/// values are held to that recording (<see cref="The_doubles_start_as_a_fresh_vendor_object"/>). The body object itself
/// (<c>NWLImplementationObject</c>) has no fresh recording: its members the writer does not set read "not written".</para>
///
/// <para><b>The reader is handed what the IDE answers.</b> The doubles are hydrated from the archive, and where the
/// recording measured the API answering otherwise (<see cref="NwlCorpus.ApiAnswers"/>, <see cref="NwlCorpus.ApiMismatches"/>:
/// <c>Operand.SymbolComment</c> / <c>.Address</c> answer the archive SENTINEL on every operand, a null
/// <c>InputFlags</c> answers a list of unset flags), they answer that. A recorded answer this hydration does not know
/// fails by name.</para>
///
/// <para><b>Red first.</b> <see cref="Known"/> is every loss the oracle finds today, by member and kind, with the task
/// that closes it and its counts (networks / nodes). The run must find exactly those (<see cref="NwlLedger"/>).</para>
/// </summary>
public class CodesysNwlCompletenessOracleTests
{
    static readonly string[] Corpora = { "lenze-mid", "pro2193", "awa-palletizer", "bakon-nano", "CodesysTestProject" };

    sealed class Outcome
    {
        public string Corpus = "";
        public string Body = "";
        public int Networks;
        /// <summary>Network id → the reason it was refused (reader, text writer or push), by name.</summary>
        public Dictionary<string, string> Refused = new(StringComparer.Ordinal);
        /// <summary>Per compared unit (a network, or a body for its body-level members): its findings.</summary>
        public List<(string Unit, List<NwlFinding> Findings)> Findings = new();
        public List<string> Unlisted = new();
        public List<string> RefusableNotRefused = new();
    }

    static readonly Lazy<(List<NwlCorpus> Corpora, List<Outcome> Outcomes)> Run = new(RunAll);

    /// <summary>The live recording: the fresh vendor objects and the shipped reader's live reads.</summary>
    static readonly Lazy<NwlLive> Live = new(() => ReadLive(Path.Combine(CorpusDir(CorpusProjects.CliRoot().FullName), "live.codesys.xml")));

    static (List<NwlCorpus>, List<Outcome>) RunAll()
    {
        var dir = CorpusDir(CorpusProjects.CliRoot().FullName);
        var corpora = Corpora.Select(c => ReadCorpus(Path.Combine(dir, c + ".nwl.xml"))).ToList();
        var outcomes = new List<Outcome>();
        foreach (var corpus in corpora)
        {
            var project = CorpusProject.At(Path.Combine(CorpusProjects.CorpusRoot(), corpus.Name));
            var api = new ApiView(corpus);
            foreach (var body in corpus.Bodies) outcomes.Add(RoundTrip(corpus, project, api, body));
        }
        // VOLT_NWL_ORACLE_TRACE=<file>: every refusal and every finding, one line each — what a ledger entry stands for.
        if (Environment.GetEnvironmentVariable("VOLT_NWL_ORACLE_TRACE") is { Length: > 0 } trace)
            File.WriteAllLines(trace, outcomes.SelectMany(o =>
                o.Refused.Select(r => $"REFUSED {r.Key}: {r.Value}")
                    .Concat(o.Findings.SelectMany(f => f.Findings.Select(x => "FINDING " + x))))
                .Append("DRAFT\n" + NwlLedger.Draft(outcomes.SelectMany(o => o.Findings))));
        return (corpora, outcomes);
    }

    // ── the round trip ─────────────────────────────────────────────────────────────────────────────────────────────

    static Outcome RoundTrip(NwlCorpus corpus, CorpusProject project, ApiView api, CorpusBody body)
    {
        var id = corpus.Name + "/" + body.Path;
        var outcome = new Outcome { Corpus = corpus.Name, Body = id };
        outcome.Unlisted.AddRange(NwlCompare.Unlisted(body.Impl).Distinct());
        var language = body.Impl.Str("DefaultViewMode") switch
        {
            "Ld" => BodyLanguage.Ld,
            "Fbd" => BodyLanguage.Fbd,
            var v => throw new InvalidDataException($"{id}: a body in view '{v}' — the corpus holds LD and FBD only"),
        };
        var scope = ScopeOf(project, body, id);
        var hydrated = new Hydrate(api, body.Path).Impl(body.Impl);
        var storedNets = ((ArchiveList)body.Impl["NetworkList"]!).Items.Cast<ArchiveNode>().ToList();
        outcome.Networks = storedNets.Count;

        var survivors = new List<(int Index, Network Model)>();
        for (var i = 0; i < storedNets.Count; i++)
        {
            var net = $"{id}#{i}";
            Network model;
            try { model = CodesysNetworkReader.ReadNetwork(hydrated.NetworkList[i], i); }
            catch (UnrepresentableBodyException e) { outcome.Refused[net] = "read: " + e.Reason; continue; }
            string text;
            try { text = NetworkTextWriter.Write(new NetworkBody(language, new[] { model }), scope); }
            catch (UnrepresentableBodyException e) { outcome.Refused[net] = "text: " + e.Reason; continue; }
            var back = NetworkTextReader.Read(text, scope);
            Assert.True(back.Ok, $"{net}: the text the writer wrote does not read back:\n{text}\n" +
                                 string.Join("\n", back.Diagnostics.Select(d => $"{d.Code} {d.Message}")));
            var reread = back.Body!.Networks.Single();
            // The push's own refusals, per network, before any rebuild: a scratch build of this network alone.
            try { CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), new Nwl.Network(), reread, language, scope); }
            catch (Exception e) when (e is NotSupportedException or BridgeException or NetworkTextException)
            { outcome.Refused[net] = "push: " + Normalized(e); continue; }
            survivors.Add((i, reread));
        }
        // THE CREATE: a fresh aspect in the text's language, every surviving network written into it.
        var fresh = new Nwl.NWLImplementationObject { DefaultViewMode = language == BodyLanguage.Ld ? "Ld" : "Fbd" };
        CodesysNetworkWriter.Write(new Holder(fresh),
            new NetworkBody(language, survivors.Select(s => s.Model).ToList()), scope);
        var written = Fresh.Over(Dump.Impl(fresh));
        var writtenNets = ((ArchiveList)written["NetworkList"]!).Items.Cast<ArchiveNode>().ToList();
        Assert.Equal(survivors.Count, writtenNets.Count);

        outcome.Findings.Add((id, NwlCompare.Node(body.Impl, written, id, "NetworkList")));
        for (var k = 0; k < survivors.Count; k++)
        {
            var net = $"{id}#{survivors[k].Index}";
            outcome.Findings.Add((net, NwlCompare.Node(storedNets[survivors[k].Index], writtenNets[k], net)));
        }
        return outcome;
    }

    /// <summary>A refusal's words with the names in it ('…') folded, so the table counts reasons, not boxes.</summary>
    static string Normalized(Exception e) =>
        e.GetType().Name + ": " + Regex.Replace(e.Message.Split(new[] { ". " }, StringSplitOptions.None)[0], "'[^']*'", "'…'");

    /// <summary>The scope the push reads this body against: its declarations from the pulled corpus — the owner's file,
    /// the member's site in it — and the project's (as <c>ModelRoundTripOracleTests</c> reads every corpus body).</summary>
    static NetworkScope ScopeOf(CorpusProject project, CorpusBody body, string id)
    {
        var path = body.Path.Split('/');
        var member = body.Owner is "POUObject" ? null : path[path.Length - 1];
        var pou = member is null ? path[path.Length - 1] : path[path.Length - 2];
        var file = project.FileOf(pou) ?? throw new InvalidDataException($"{id}: no corpus file for the POU '{pou}'");
        var sites = SourceScopes.SitesOf(CorpusProjects.Split(file))
            .Where(s => s.Site.Accessor is null && string.Equals(s.Site.Member, member, StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (sites.Count != 1) throw new InvalidDataException($"{id}: {sites.Count} body sites in {file} for '{member ?? "(the POU)"}'");
        return project.Scope(sites[0].Declaration);
    }

    sealed class Holder
    {
        public Holder(object implementation) => Implementation = implementation;
        public object Implementation { get; }
    }

    // ── the API the reader is handed ───────────────────────────────────────────────────────────────────────────────

    /// <summary>What the recording measured the API answering where it differs from the archive.</summary>
    sealed class ApiView
    {
        readonly Dictionary<(string, string), string> _byPath = new();
        readonly Dictionary<(string, string, string), string> _counted = new();

        public ApiView(NwlCorpus corpus)
        {
            foreach (var m in corpus.ApiMismatches) _byPath[(m.Path, m.Member)] = m.Answered;
            foreach (var a in corpus.ApiAnswers) _counted[(a.Class + "." + a.Member, a.Api, a.ArchiveHeld)] = a.Answered;
        }

        /// <summary>The string the API answers for <paramref name="member"/> of the operand at <paramref name="path"/>.</summary>
        public string? OperandText(string path, string member, string? archived)
        {
            if (_byPath.TryGetValue((path, member), out var answered)) return answered;
            var held = string.IsNullOrEmpty(archived) ? "empty" : archived!.StartsWith("Constant_", StringComparison.Ordinal) ? "sentinel" : null;
            return held is not null && _counted.TryGetValue(("Operand." + member, member, held), out var a) ? a : archived;
        }
    }

    /// <summary>The shapes of API answer this hydration reproduces; a recording holding any other fails by name.</summary>
    static readonly string[] KnownApiShapes =
    {
        "Operand.SymbolComment (empty) -> SymbolComment = 'Constant_SymbolComment_Serialization_Value'",
        "Operand.Address (empty) -> Address = 'Constant_Address_Serialization_Value'",
        "BoxTreeBox.InputFlags (null) -> InputFlags = 'a list of unset flags, one per input'",
    };

    /// <summary>Archive → the suite's NWL doubles, speaking the API names the reader asks (<c>OperandExpr</c>,
    /// <c>IsLValue</c>, <c>InputItemList</c>, <c>Outputs</c>, <c>En</c>, …), with the recorded API answers.</summary>
    sealed class Hydrate
    {
        readonly ApiView _api;
        readonly string _root;
        public Hydrate(ApiView api, string root) { _api = api; _root = root; }

        public Nwl.NWLImplementationObject Impl(ArchiveNode n)
        {
            var impl = new Nwl.NWLImplementationObject { DefaultViewMode = n.Str("DefaultViewMode") };
            var nets = (ArchiveList)n["NetworkList"]!;
            for (var i = 0; i < nets.Items.Count; i++) impl.NetworkList.Add(Network((ArchiveNode)nets.Items[i]!, $"{_root}.NetworkList[{i}]"));
            return impl;
        }

        Nwl.Network Network(ArchiveNode n, string path)
        {
            var net = new Nwl.Network
            {
                Title = n.Str("Title")!, Label = n.Str("Label")!, Comment = n.Str("Comment")!,
                OutCommented = n.Str("OutCommented") == "true",
            };
            var items = (ArchiveList)n["NetworkItems"]!;
            return net.With(items.Items.Select((t, j) => Tree((ArchiveNode)t!, $"{path}.NetworkItems[{j}]")).ToArray());
        }

        object? TreeOrNull(object? v, string path) => v is ArchiveNode n ? Tree(n, path) : null;

        object Tree(ArchiveNode n, string path) => n.Class switch
        {
            "BoxTreeOperand" => new Nwl.BoxTreeOperand(Operand((ArchiveNode)n["Operand"]!, path + ".Operand")),
            "BoxTreeAssign" => Assign(n, path),
            "BoxTreeBox" => Box(n, path),
            "BoxTreeDemux" => new Nwl.BoxTreeDemux { VarId = int.Parse(n.Str("VarId")!), Input = TreeOrNull(n["Input"], path + ".Input"), Flags = null },
            "BoxTreeParallel" => Parallel(n, path),
            "BoxTreeTerminator" => new Nwl.BoxTreeTerminator { Input = TreeOrNull(n["Input"], path + ".Input"), Flags = Flags(n["Flags"]) },
            _ => throw new InvalidDataException($"{path}: a tree node '{n.Class}' this hydration has no double for"),
        };

        object Assign(ArchiveNode n, string path)
        {
            var a = new Nwl.BoxTreeAssign { RValue = TreeOrNull(n["RValue"], path + ".RValue"), Flags = Flags(n["Flags"]) };
            var outs = (ArchiveList)((ArchiveNode)n["OutputItems"]!)["OutputItems"]!;
            for (var k = 0; k < outs.Items.Count; k++)
                a.Outputs.AppendOutputItem(outs.Items[k] is ArchiveNode o ? Operand(o, $"{path}.OutputItems.OutputItems[{k}]") : null!);
            return a;
        }

        object Box(ArchiveNode n, string path)
        {
            var inputs = (ArchiveList)n["InputItems"]!;
            var box = new Nwl.BoxTreeBox
            {
                BoxType = n.Str("BoxType")!,
                Instance = n["Instance"] is ArchiveNode inst ? Operand(inst, path + ".Instance") : null,
                CallType = n.Str("CallType"),
                InputItemList = inputs.Items.Select((t, j) => TreeOrNull(t, $"{path}.InputItems[{j}]")!).ToArray(),
                InputParams = Params(n["InputParam"]),
                OutputParams = Params(n["OutputParam"]),
                MainOutputIndex = n.Str("api.MainOutputIndex") is { } mi ? int.Parse(mi) : null,
                En = Bool(n["EN"]),
                Eno = Bool(n["ENO"]),
                Flags = Flags(n["Flags"]),
            };
            // A null archive list is answered as unset flags, one per input — the double's own default (KnownApiShapes).
            if (n["InputFlags"] is ArchiveList pins) box.InputFlags = pins.Items.Select(f => (object)Flags(f)!).ToArray();
            var outs = n["OutputItems"] is ArchiveNode holder ? (ArchiveList)holder["OutputItems"]! : null;
            box.Outputs = new Nwl.OutputItemList();
            if (outs is not null)
                for (var k = 0; k < outs.Items.Count; k++)
                    box.Outputs.AppendOutputItem(outs.Items[k] is ArchiveNode o ? Operand(o, $"{path}.OutputItems.OutputItems[{k}]") : null!);
            if (n["STSnippet"] is ArchiveNode snippet)
            {
                var doc = (ArchiveNode)((ArchiveNode)((ArchiveNode)snippet["STSnippet"]!)["TextDocument"]!);
                var st = new _3S.CoDeSys.STObject.STImplementationObject();
                var text = doc.Str("api.Text") ?? throw new InvalidDataException($"{path}: a snippet document with no recorded text");
                Nwl.TextDocument.ThrowsAfterInsert = false;
                try { st.TextDocument.Insert(0, text); }
                finally { Nwl.TextDocument.ThrowsAfterInsert = true; }
                box.STSnippet = new Nwl.STSnippet { Snippet = st };
            }
            return box;
        }

        object Parallel(ArchiveNode n, string path)
        {
            var mode = (Nwl.OperationMode)Enum.Parse(typeof(Nwl.OperationMode), n.Str("Mode")!);
            var par = new Nwl.BoxTreeParallel { Mode = mode, Input = TreeOrNull(n["Input"], path + ".Input") };
            var trees = (ArchiveList)n["Trees"]!;
            par.Trees.AddRange(trees.Items.Select((t, j) => TreeOrNull(t, $"{path}.Trees[{j}]")!));
            return par;
        }

        Nwl.Operand Operand(ArchiveNode n, string path) => new()
        {
            OperandExpr = n.Str("Operand")!,
            Type = n.Str("Type")!,
            SymbolComment = _api.OperandText(path, "SymbolComment", n.Str("SymbolComment"))!,
            StoredSymbolComment = n.Str("SymbolComment")!,
            Address = _api.OperandText(path, "Address", n.Str("Address"))!,
            IsLValue = n.Str("LValue") == "true",
            IsInstance = n.Str("IsInstance") == "true",
            Flags = Flags(n["Flags"]),
        };

        static object? Bool(object? v) => v is ArchiveScalar s ? s.Text == "true" : null;

        static Nwl.ParamList Params(object? v)
        {
            if (v is not ArchiveNode p) throw new InvalidDataException("a box with no parameter list");
            return new Nwl.ParamList
            {
                Names = ((ArchiveList)p["Names"]!).Items.Select(x => ((ArchiveScalar)x!).Text).ToArray(),
                Types = ((ArchiveList)p["Types"]!).Items.Select(x => ((ArchiveScalar)x!).Text).ToArray(),
            };
        }

        static Nwl.Flags? Flags(object? v)
        {
            if (v is not ArchiveNode f) return null;
            var bits = int.Parse(f.Str("Flags")!);
            return new Nwl.Flags
            {
                Negation = (bits & 1) != 0, Set = (bits & 2) != 0, Jump = (bits & 4) != 0,
                Return = (bits & 8) != 0, Rtrig = (bits & 16) != 0, Ftrig = (bits & 32) != 0,
            };
        }
    }

    // ── the fresh vendor objects under what the writer built ──────────────────────────────────────────────────────

    /// <summary>What the writer built, as the vendor holds it: each written node laid over the fresh vendor object of its
    /// class — a member the doubles carry is the written value, every other member the fresh object's (recorded, never a
    /// double's default). A class with no fresh recording stays as written.</summary>
    static class Fresh
    {
        /// <summary>The fresh object of each class: the recorded objects, then the value nodes inside them (<c>Flags</c>,
        /// <c>OutputItemList</c>, <c>ParamList</c>) — each held identically by every fresh object that holds one.</summary>
        static readonly Lazy<Dictionary<string, ArchiveNode>> ByClass = new(() =>
        {
            var map = new Dictionary<string, ArchiveNode>(Live.Value.Fresh, StringComparer.Ordinal);
            foreach (var inner in Live.Value.Fresh.Values.SelectMany(f => NwlCompare.Nodes(f).Skip(1)))
            {
                if (Live.Value.Fresh.ContainsKey(inner.Class)) continue;   // a top-level fresh object is the class's own
                if (map.TryGetValue(inner.Class, out var seen))
                {
                    if (NwlCompare.Node(seen, inner, inner.Class).Count != 0)
                        throw new InvalidDataException($"two fresh '{inner.Class}' differ — no one fresh value to judge by");
                }
                else map[inner.Class] = inner;
            }
            return map;
        });

        public static ArchiveNode Over(ArchiveNode written)
        {
            if (!ByClass.Value.TryGetValue(written.Class, out var fresh)) return Copy(written, Over);
            var node = new ArchiveNode(written.Class);
            foreach (var m in fresh.Members)
                node.Members.Add(new(m.Key, written.Has(m.Key) ? Written(written[m.Key]) : Clone(m.Value)));
            foreach (var m in written.Members.Where(m => !fresh.Has(m.Key)))
                node.Members.Add(new(m.Key, Written(m.Value)));
            return node;
        }

        static object? Written(object? v) => v switch
        {
            ArchiveNode n => Over(n),
            ArchiveList l => new ArchiveList(l.Items.Select(Written)),
            _ => v,
        };

        static ArchiveNode Copy(ArchiveNode n, Func<ArchiveNode, ArchiveNode> child)
        {
            var copy = new ArchiveNode(n.Class);
            foreach (var m in n.Members)
                copy.Members.Add(new(m.Key, m.Value switch
                {
                    ArchiveNode c => child(c),
                    ArchiveList l => new ArchiveList(l.Items.Select(x => x is ArchiveNode c ? (object)child(c) : x)),
                    var v => v,
                }));
            return copy;
        }

        static object? Clone(object? v) => v switch
        {
            ArchiveNode n => Copy(n, c => (ArchiveNode)Clone(c)!),
            ArchiveList l => new ArchiveList(l.Items.Select(Clone)),
            _ => v,
        };
    }

    // ── what the writer built, as an archive ───────────────────────────────────────────────────────────────────────

    /// <summary>The written doubles → archive nodes, by ARCHIVE name. A member the doubles do not model is absent —
    /// Volt never sets it — and so is one a double holds only as "never set" (a box's <c>CallType</c>, <c>InputFlags</c>).</summary>
    static class Dump
    {
        public static ArchiveNode Impl(Nwl.NWLImplementationObject impl) =>
            new ArchiveNode("NWLImplementationObject")
                .Set("DefaultViewMode", impl.DefaultViewMode is { } v ? S(v) : null)
                .Set("NetworkList", new ArchiveList(impl.NetworkList.Cast<Nwl.Network>().Select(Network)));

        internal static ArchiveNode Network(Nwl.Network n) =>
            new ArchiveNode("Network")
                .Set("Title", S(n.Title)).Set("Label", S(n.Label)).Set("Comment", S(n.Comment))
                .Set("OutCommented", B(n.OutCommented))
                .Set("NetworkItems", new ArchiveList(Enumerable.Range(0, n.NetworkItemCount).Select(i => Tree(n.GetTree(i)))));

        internal static object? Tree(object? t) => t switch
        {
            null => null,
            Nwl.BoxTreeOperand o => new ArchiveNode("BoxTreeOperand").Set("Operand", Operand(o.Operand)),
            Nwl.BoxTreeAssign a => new ArchiveNode("BoxTreeAssign")
                .Set("OutputItems", Outputs(a.Outputs)).Set("Flags", Flags(a.Flags)).Set("RValue", Tree(a.RValue)),
            Nwl.BoxTreeBox b => Box(b),
            Nwl.BoxTreeDemux d => new ArchiveNode("BoxTreeDemux").Set("VarId", I(d.VarId)).Set("Input", Tree(d.Input)),
            Nwl.BoxTreeParallel p => new ArchiveNode("BoxTreeParallel")
                .Set("Trees", new ArchiveList(p.Trees.Select(Tree))).Set("Input", Tree(p.Input)).Set("Mode", E(p.Mode.ToString())),
            Nwl.BoxTreeTerminator x => new ArchiveNode("BoxTreeTerminator").Set("Input", Tree(x.Input)).Set("Flags", Flags(x.Flags)),
            _ => throw new InvalidOperationException($"the writer built a '{t.GetType().Name}' this dump does not know"),
        };

        static ArchiveNode Box(Nwl.BoxTreeBox b)
        {
            var node = new ArchiveNode("BoxTreeBox")
                .Set("BoxType", S(b.BoxType))
                .Set("Instance", b.Instance is Nwl.Operand inst ? Operand(inst) : null)
                .Set("OutputItems", Outputs(b.Outputs));
            // The vendor box always holds a Flags object (the writer mutates it: ApplyFlags); the double holds none until
            // a modifier is written, so an unset one is the box with no bits.
            node.Set("Flags", Flags(b.Flags ?? new Nwl.Flags()));
            var inputFlagsSet = (bool)typeof(Nwl.BoxTreeBox).GetField("_inputFlagsSet", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.GetValue(b)!;
            if (inputFlagsSet) node.Set("InputFlags", b.InputFlags is { } pins ? new ArchiveList(pins.Select(Flags)) : null);
            node.Set("InputItems", new ArchiveList(b.InputItemList.Select(Tree)))
                .Set("InputParam", Params(b.InputParams))
                .Set("OutputParam", Params(b.OutputParams));
            if (b.CallType is not null) node.Set("CallType", E(b.CallType.ToString()!));
            node.Set("EN", b.En is bool en ? B(en) : null).Set("ENO", b.Eno is bool eno ? B(eno) : null)
                .Set("STSnippet", b.STSnippet is Nwl.STSnippet s ? Snippet(s) : null)
                .Set("ProvidesSTSnippet", B(b.ProvidesSTSnippet));
            return node;
        }

        static ArchiveNode Snippet(Nwl.STSnippet s)
        {
            var st = (_3S.CoDeSys.STObject.STImplementationObject)s.Snippet!;
            return new ArchiveNode("STSnippet").Set("STSnippet",
                new ArchiveNode("STImplementationObject").Set("TextDocument",
                    new ArchiveNode("TextDocument").Set("api.Text", S(st.TextDocument.Text))));
        }

        static ArchiveNode Outputs(Nwl.OutputItemList o) =>
            new ArchiveNode("OutputItemList").Set("OutputItems",
                new ArchiveList(o.List.Select(x => x is Nwl.Operand op ? (object)Operand(op) : null)));

        static ArchiveNode Params(object? p)
        {
            var list = (Nwl.ParamList)p!;
            return new ArchiveNode("ParamList")
                .Set("Names", new ArchiveList(list.Names.Select(x => (object)S(x))))
                .Set("Types", new ArchiveList(list.Types.Select(x => (object)S(x))));
        }

        internal static ArchiveNode Operand(Nwl.Operand o) =>
            new ArchiveNode("Operand")
                .Set("Operand", o.OperandExpr is { } e ? S(e) : null)
                .Set("Type", o.Type is { } t ? S(t) : null)
                .Set("SymbolComment", o.StoredSymbolComment is { } c ? S(c) : null)
                .Set("Address", o.Address is { } a ? S(a) : null)
                .Set("Flags", Flags(o.Flags))
                .Set("LValue", B(o.IsLValue))
                .Set("IsInstance", B(o.IsInstance));

        static ArchiveNode? Flags(object? f)
        {
            if (f is not Nwl.Flags x) return null;
            var bits = (x.Negation ? 1 : 0) | (x.Set ? 2 : 0) | (x.Jump ? 4 : 0) | (x.Return ? 8 : 0) | (x.Rtrig ? 16 : 0) | (x.Ftrig ? 32 : 0);
            return new ArchiveNode("Flags").Set("Flags", I(bits));
        }
    }

    // ── the tests ──────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The recording is the census's: 44 CODESYS bodies (lenze-mid 40, pro2193 2, awa-palletizer 1,
    /// bakon-nano 1, CodesysTestProject 0), 388 networks.</summary>
    [Fact]
    public void The_recorded_corpora_are_the_census()
    {
        var (corpora, outcomes) = Run.Value;
        Assert.Equal(new[] { 40, 2, 1, 1, 0 }, corpora.Select(c => c.Bodies.Count).ToArray());
        Assert.Equal(388, outcomes.Sum(o => o.Networks));
        Assert.All(corpora, c => Assert.Equal("CODESYS 3.5.21.40", c.Ide));
    }

    /// <summary>A member the stored archives hold that the table does not name fails BY NAME — a vendor adding a member
    /// in a future SP is a red test, never a silent loss. And the table names nothing the corpora never hold, except
    /// the classes with no corpus occurrence (decided without a witness) and the TwinCAT-only document members.</summary>
    [Fact]
    public void Every_archived_member_is_in_the_table()
    {
        var (corpora, outcomes) = Run.Value;
        var unlisted = outcomes.SelectMany(o => o.Unlisted).Distinct().OrderBy(k => k, StringComparer.Ordinal).ToList();
        Assert.True(unlisted.Count == 0, "members the disposition table does not name: " + string.Join(", ", unlisted));

        var held = corpora.SelectMany(c => c.Bodies).SelectMany(b => NwlCompare.Keys(b.Impl)).ToHashSet(StringComparer.Ordinal);
        var unheld = NwlDisposition.Rules
            .Where(r => !held.Contains(r.Key) && !NwlDisposition.Unwitnessed.Contains(r.Class) && r.Class is not "TextLine"
                        && r.Key is not "TextDocument.TextLines")
            .Select(r => r.Key).ToList();
        Assert.True(unheld.Count == 0, "table rows no CODESYS corpus archive holds: " + string.Join(", ", unheld));
    }

    /// <summary>The API answers the recording measured are exactly the shapes the hydration reproduces — anything else
    /// would hand the reader an answer the IDE does not give.</summary>
    [Fact]
    public void The_recorded_API_answers_are_the_ones_the_hydration_reproduces()
    {
        var (corpora, _) = Run.Value;
        var shapes = corpora.SelectMany(c => c.ApiAnswers)
            .Select(a => $"{a.Class}.{a.Member} ({a.ArchiveHeld}) -> {a.Api} = '{a.Answered}'").Distinct().ToList();
        Assert.Empty(shapes.Except(KnownApiShapes));
        // Where the archive holds a VALUE and the API answers otherwise, by path: the ten symbol comments of pro2193
        // `Cylinder_53ValveFB.SetAlarm`, which the API answers as the sentinel (see the reader's symbol-comment test).
        var listed = corpora.SelectMany(c => c.ApiMismatches).ToList();
        Assert.All(listed, m => Assert.Equal(("Operand", "SymbolComment", "Constant_SymbolComment_Serialization_Value"), (m.Class, m.Member, m.Answered)));
        Assert.Equal(10, listed.Count);
    }

    /// <summary>THE DOUBLES START AS A FRESH VENDOR OBJECT (gate 1b-3): every member the oracle reads off a double the
    /// writer has just constructed — as the writer constructs it — holds what the vendor's fresh object of that class
    /// holds (<c>live.codesys.xml</c>), except the members the writer ALWAYS sets (named below, each with where). The two
    /// the review asked about, <c>Operand.Address</c> and <c>Operand.SymbolComment</c>, the writer never sets: a fresh
    /// vendor operand archives "" for both (the sentinel is NOT what a fresh operand holds), so the ledger's Address
    /// entries are the stored sentinel against "" and no operand storing "" hides a change.</summary>
    [Fact]
    public void The_doubles_start_as_a_fresh_vendor_object()
    {
        var live = Live.Value;
        Assert.Equal("CODESYS 3.5.21.40", live.Ide);
        var made = new (string Class, ArchiveNode Dumped)[]
        {
            ("Network", Dump.Network(new Nwl.Network())),
            ("BoxTreeOperand", (ArchiveNode)Dump.Tree(new Nwl.BoxTreeOperand(new Nwl.Operand("x")))!),
            ("BoxTreeAssign", (ArchiveNode)Dump.Tree(new Nwl.BoxTreeAssign())!),
            ("BoxTreeBox", (ArchiveNode)Dump.Tree(new Nwl.BoxTreeBox())!),
            ("BoxTreeDemux", (ArchiveNode)Dump.Tree(new Nwl.BoxTreeDemux())!),
            ("BoxTreeTerminator", (ArchiveNode)Dump.Tree(new Nwl.BoxTreeTerminator())!),
            ("BoxTreeParallel", (ArchiveNode)Dump.Tree(new Nwl.BoxTreeParallel())!),
            ("Operand", Dump.Operand(new Nwl.Operand("x"))),
        };
        // The writer always sets these on the object it built, so the double's initial value is never what is compared.
        var alwaysSet = new HashSet<string>(StringComparer.Ordinal)
        {
            "BoxTreeAssign.RValue",                     // Set(asg, "RValue", Node(a.Value))
            "BoxTreeBox.BoxType",                       // Set(box, "BoxType", b.Type)
            "Operand.Operand in BoxTreeBox.Instance",   // the instance's OperandExpr: its text, or "" on a function/operator
            "BoxTreeDemux.VarId",                       // Set(dm, "VarId", d.VarId)
        };
        var differs = new List<string>();
        foreach (var (cls, dumped) in made)
        {
            var fresh = live.Fresh.TryGetValue(cls, out var f) ? f : throw new InvalidDataException($"no fresh '{cls}' recorded");
            foreach (var d in NwlCompare.Node(dumped, fresh, cls))
                if (!alwaysSet.Contains(d.Ledger.Substring(0, d.Ledger.IndexOf(" — ", StringComparison.Ordinal)))) differs.Add(d.ToString());
        }
        Assert.True(differs.Count == 0, "a double starts unlike the vendor's fresh object: " + string.Join(" | ", differs));
        Assert.Equal("", live.Fresh["Operand"].Str("Address"));
        Assert.Equal("", live.Fresh["Operand"].Str("SymbolComment"));
    }

    /// <summary>THE SHIPPED READER READS A STORED SYMBOL COMMENT IN A LIVE CODESYS (gate 1b-3, DIALECT N27): the bridge's
    /// own <c>CodesysNetworkReader.ReadNetwork</c>, loaded from the built DLL into the IDE, read every network of the
    /// corpus that stores one — pro2193 <c>Cylinder_53ValveFB.SetAlarm</c> #0, its ten comments, exactly the ones the
    /// corpus recording holds — through <c>NwlInterop</c>'s reflection over the real vendor objects, and the shipped
    /// rebuild refusal fired on that model: gate 1b-1's refusal has its live witness. (That network's TEXT is refused today
    /// — S1 — so no pull shows it; a pull's e2e witness follows S1 in 2.3.)</summary>
    [Fact]
    public void The_shipped_reader_reads_the_stored_symbol_comments_live()
    {
        var live = Live.Value;
        Assert.Equal("pro2193", live.ReaderCorpus);
        var read = Assert.Single(live.Reads);
        Assert.Equal(("Device/Plc Logic/Application/Cylinder_53ValveFB/SetAlarm", 0, 10), (read.Path, read.Index, read.Stored));
        Assert.Null(read.ReadRefused);
        var stored = Run.Value.Corpora.Single(c => c.Name == "pro2193").Bodies.Single(b => b.Path == read.Path).Impl;
        var storedNet = (ArchiveNode)((ArchiveList)stored["NetworkList"]!).Items[read.Index]!;
        var storedComments = NwlCompare.Nodes(storedNet).Where(n => n.Class == "Operand")
            .Select(o => (Operand: o.Str("Operand")!, Text: o.Str("SymbolComment")!)).Where(c => c.Text.Length > 0)
            .OrderBy(c => c.Operand, StringComparer.Ordinal).ThenBy(c => c.Text, StringComparer.Ordinal).ToList();
        Assert.Equal(10, storedComments.Count);
        Assert.Equal(storedComments, read.Comments.OrderBy(c => c.Operand, StringComparer.Ordinal).ThenBy(c => c.Text, StringComparer.Ordinal).ToList());
        Assert.StartsWith("CODESYS: network 1 holds a symbol comment on 'SetAlarm', 'xOutput', 'xOutInv', 'xSensor'", read.Refusal);
    }

    /// <summary>X members off their default occur in no corpus network; were one there, its network must have been refused.</summary>
    [Fact]
    public void No_refusable_member_reaches_a_compared_network() =>
        Assert.Empty(Run.Value.Outcomes.SelectMany(o => o.Findings).SelectMany(f => f.Findings)
            .Where(f => f.Kind == "present and not refused").Select(f => f.ToString()));

    /// <summary>NO LD/FBD BODY IS UNSUPPORTED FOR ONE NETWORK (openspec ld-fbd-coverage 1b.4): every corpus body pulls — the
    /// shipped pull read (<c>ReadShown</c>) and render (<c>WritePulled</c>) over the recorded archive — as network text, a
    /// network the text cannot spell shown as its <c>UNSUPPORTED "&lt;shape&gt;";</c> line. The 12 bodies the census found
    /// UNSUPPORTED (tasks 0.1) held 22 such lines until 2.3 spelled S1, S2, S3, S5 and S6: no corpus network is a line
    /// now; and every body's text reads back to the same text (pushed back unchanged, every network pairs with itself).</summary>
    [Fact]
    public void Every_body_pulls_as_network_text_with_its_unspellable_networks_as_lines()
    {
        var (corpora, outcomes) = Run.Value;
        var lines = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var corpus in corpora)
        {
            var project = CorpusProject.At(Path.Combine(CorpusProjects.CorpusRoot(), corpus.Name));
            var api = new ApiView(corpus);
            foreach (var body in corpus.Bodies)
            {
                var id = corpus.Name + "/" + body.Path;
                var language = body.Impl.Str("DefaultViewMode") == "Ld" ? BodyLanguage.Ld : BodyLanguage.Fbd;
                var scope = ScopeOf(project, body, id);
                var shown = CodesysNetworkReader.ReadShown(new Hydrate(api, body.Path).Impl(body.Impl), language);
                var text = NetworkTextWriter.WritePulled(shown, scope);
                var back = NetworkTextReader.Read(text, scope);
                Assert.True(back.Ok, $"{id}: the pulled text does not read back:\n{text}");
                Assert.Equal(text, NetworkTextWriter.Write(back.Body!, scope));
                var n = Regex.Matches(text, "^  UNSUPPORTED \"", RegexOptions.Multiline).Count;
                if (n > 0) lines[id] = n;
            }
        }
        Assert.Empty(lines);
        // The same networks the round trip's text writer refuses, body for body.
        var refused = outcomes.SelectMany(o => o.Refused.Where(r => r.Value.StartsWith("text: ", StringComparison.Ordinal)))
            .GroupBy(r => r.Key.Substring(0, r.Key.LastIndexOf('#')), StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal);
        Assert.Equal(refused.OrderBy(k => k.Key, StringComparer.Ordinal), lines.OrderBy(k => k.Key, StringComparer.Ordinal));
    }

    /// <summary>The networks the round trip refuses, by reason — the census's UNSUPPORTED shapes (tasks 0.1) and the
    /// push's own refusals. Pinned: a count moving is a spelling learned or lost.</summary>
    [Fact]
    public void Refusal_tally()
    {
        var tally = Run.Value.Outcomes.SelectMany(o => o.Refused.Values)
            .GroupBy(r => r, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal);
        Assert.Equal(RefusedByReason.OrderBy(k => k.Key, StringComparer.Ordinal).ToList(),
                     tally.OrderBy(k => k.Key, StringComparer.Ordinal).ToList());
    }

    static readonly Dictionary<string, int> RefusedByReason = new(StringComparer.Ordinal)
    {
        // The census's UNSUPPORTED shapes (tasks 0.1): S1 7, S2 6, S3 6, S4 1, S5 1, S6 1 — every one spelled since 2.3
        // (S4 since 1b.4): the text writer refuses no corpus network. What is left is the PUSH's own refusals over the
        // networks the text now reaches, each a network a push keeps untouched while its text is unchanged (1b.4):
        // DIALECT N21: a consumed enabled comparison does not build in any shape Volt can write — 26 networks of lenze-mid
        // (23 before 2.3, and 3 of the S1/S2 networks hold one too).
        ["push: NotSupportedException: CODESYS: the '…' box is a consumed enabled comparison: CODESYS does not compile one " +
         "Volt builds, with or without `.ENO` (its result variable hangs off an output index Volt cannot set, DIALECT N21)"] = 26,
        // S4 (1b.4): a call read through a named main output other than its first — its MainOutputIndex is read-only on a
        // box Volt builds (N21). Lenze FirstErrorCapture.call_FirstErrorCapture_FB #2 and #8, which the S1 and S6 lines hid.
        ["push: NotSupportedException: CODESYS: network 1 changed, and its '…' box is read through its output '…', which is " +
         "not the box's first output: a box Volt builds cannot be read through any other (its main output index is read-only, " +
         "DIALECT N21), so the consumer would read another value than the text says"] = 2,
    };

    /// <summary>THE ORACLE: every non-cache member of every compared network comes back, or its loss is a known one.</summary>
    [Fact]
    public void Every_member_comes_back_or_is_a_known_loss() =>
        NwlLedger.AssertExactly("codesys", Run.Value.Outcomes.SelectMany(o => o.Findings), Known);

    /// <summary>Every loss the oracle finds today (red first), with the task that closes it. Judged against the fresh
    /// vendor objects (gate 1b-3): a member the writer never sets reads as the fresh object's value, so a member whose
    /// fresh value is what every compared network stores — <c>Operand.Comment</c> "", <c>Flags.Extensible</c> false, a
    /// box's <c>ContainsExtensibleInputs</c> false and <c>InputFlags</c> null, the network's IL/FBD flags false — comes
    /// back without the writer setting it (those D rows hold by the fresh object), and the R rows read "changed" against
    /// the fresh value (<c>Id</c> -1, <c>CallType</c> None, <c>Boolean</c> false, <c>Fixed</c> false) instead of "not
    /// written".</summary>
    static readonly NwlKnown[] Known =
    {
        // ld-fbd-coverage 2.3 brought the S1/S2/S3/S5/S6 networks (25, but the 2 S4 and 3 more N21 ones a push refuses)
        // into the comparison: the counts below grew by what those networks hold, and OutputParam's four entries closed
        // (its Names and Types are the box's pragma members, NetworkMembers.OfBox).
                        new("BoxTreeBox.BoxType — changed", 19, 19, "2.3 design gap (1b.3): an FB/program call's BoxType is the instance's declared type — D with {BoxType := '…'}"),
        new("BoxTreeBox.CallType — changed", 306, 1063, "2.2 nwl-call-type (R): a fresh box holds None"),
        new("BoxTreeBox.EN — changed", 162, 227, "2.2 nwl-box-en-eno (R)"),
        new("BoxTreeBox.ENO — changed", 162, 227, "2.2 nwl-box-en-eno (R)"),
        new("BoxTreeBox.InputFlags — changed", 2, 2, "2.3 nwl-input-flags-list (R): a zero-only InputFlags list (lenze FirstErrorCapture #3, #4) — the API answers an archived null as unset flags (KnownApiShapes), so the reader must read the archive, as SymbolComment (N27)"),
        new("Flags.Fixed in BoxTreeAssign.OutputItems.OutputItems.Flags — changed", 106, 222, "2.2 nwl-flags-fixed (R): a fresh flag set holds false"),
        new("Flags.Fixed in BoxTreeBox.Flags — changed", 144, 182, "2.2 nwl-flags-fixed (R): a fresh flag set holds false"),
        new("Flags.Fixed in BoxTreeBox.InputFlags — changed", 1, 4, "2.2 nwl-flags-fixed (R): a pin's flag set (S6's pro2193 SetAlarm)"),
        new("Flags.Fixed in BoxTreeOperand.Operand.Flags — changed", 251, 1279, "2.2 nwl-flags-fixed (R): a fresh flag set holds false"),
        new("Flags.Flags in BoxTreeAssign.Flags — changed", 1, 1, "2.2 nwl-assign-item-flags (R); 2.3: the writer ORs the target's Return onto the item"),
        new("NWLImplementationObject.BranchCounter — not written", 44, 44, "2.2 nwl-branch-counter (R)"),
        new("NWLImplementationObject.NetworkListComment — not written", 44, 44, "2.3 D: the writer sets the constant"),
        new("NWLImplementationObject.ValidIds — not written", 44, 44, "2.3 D: the writer sets the constant"),
        new("Network.Comment — changed", 8, 8, "2.3 S: the CR LF fold and the trailing trim go; {Comment := '…'}"),
        new("Network.Title — changed", 21, 21, "2.3 S exact: the trailing trim goes"),
        new("Operand.Address in BoxTreeAssign.OutputItems.OutputItems — changed", 16, 30, "2.2 nwl-address-sentinel (R): the stored sentinel against the fresh \"\""),
        new("Operand.Address in BoxTreeBox.Instance — changed", 8, 8, "2.2 nwl-address-sentinel (R): the stored sentinel against the fresh \"\""),
        new("Operand.Address in BoxTreeBox.OutputItems.OutputItems — changed", 3, 16, "2.2 nwl-address-sentinel (R): an unwired output slot's stored sentinel, compared since the slots are laid out as the vendor's (2.3)"),
        new("Operand.Address in BoxTreeOperand.Operand — changed", 26, 204, "2.2 nwl-address-sentinel (R): the stored sentinel against the fresh \"\""),
        new("Operand.Boolean in BoxTreeAssign.OutputItems.OutputItems — changed", 234, 514, "2.2 nwl-operand-boolean (R): a fresh operand holds false"),
        new("Operand.Boolean in BoxTreeOperand.Operand — changed", 264, 1596, "2.2 nwl-operand-boolean (R): a fresh operand holds false"),
        new("Operand.IsInstance in BoxTreeBox.Instance — changed", 313, 1070, "2.3 D: true exactly for the box's Instance"),
        new("Operand.LValue in BoxTreeAssign.OutputItems.OutputItems — changed", 246, 528, "2.3 D: true exactly for an assign target or a box output slot"),
        new("Operand.LValue in BoxTreeBox.OutputItems.OutputItems — changed", 92, 385, "2.3 D: true exactly for an assign target or a box output slot — the unwired slots a push lays out are empty operands the writer does not mark"),
        new("Operand.Operand in BoxTreeBox.Instance — changed", 271, 933, "2.3 D: null on a function/operator instance (the writer writes '')"),
        new("Operand.SymbolComment in BoxTreeAssign.OutputItems.OutputItems — changed", 1, 1, "2.3 S+: {SymbolComment := '…'} — pro2193 SetAlarm #0, reached since S6 (a real rebuild of it is refused: NetworkText.RefuseSymbolCommentLoss)"),
        new("Operand.SymbolComment in BoxTreeOperand.Operand — changed", 1, 9, "2.3 S+: {SymbolComment := '…'} — pro2193 SetAlarm #0, reached since S6 (a real rebuild of it is refused: NetworkText.RefuseSymbolCommentLoss)"),
        new("Operand.Type in BoxTreeAssign.OutputItems.OutputItems — changed", 246, 528, "2.2 nwl-operand-type (R)"),
        new("Operand.Type in BoxTreeBox.Instance — changed", 119, 156, "2.2 nwl-instance-type (R)"),
        new("Operand.Type in BoxTreeBox.OutputItems.OutputItems — changed", 84, 352, "2.2 nwl-operand-type (R): an output slot's stored type, the unwired ones included since the slots are laid out as the vendor's"),
        new("Operand.Type in BoxTreeOperand.Operand — changed", 325, 2421, "2.2 nwl-operand-type (R) — a leaf feeding a wire writes its stored type since S3a (2.3)"),
        new("OutputItemList.OutputItems in BoxTreeBox.OutputItems — changed", 1, 1, "2.3: S4's top-level call (lenze FirstErrorCapture #4) stores its null on its main output, slot 1 — a main output index no push can set (N21); every other box's slots are laid out as the vendor's"),
        new("OutputItemList.OutputItems in BoxTreeBox.OutputItems — list length changed", 83, 108, "DIALECT N37: a drawn function box's null result slot, which goes with its name '   ' (98 boxes); and 2.3 R nwl-output-param-names: a PROGRAM call with EN stores two null output slots for its one name ['ENO'] (10 boxes) — one slot per name is every other box's layout"),
        new("ParamList.Names in BoxTreeBox.InputParam — list length changed", 35, 73, "2.3 D: a partial list names only the named pins — the writer pads every input"),
        new("ParamList.Names in BoxTreeBox.OutputParam — list length changed", 75, 98, "DIALECT N37 (a vendor limit, 2.3): a drawn FUNCTION box's result pin '   ' — spelled by its pragma, and no box Volt builds can hold it (CODESYS: ''   ' is no component of F', its main output index read-only, N21); every rebuild of its network names the loss (RebuildLoss)"),
        new("ParamList.Types in BoxTreeBox.InputParam — changed", 194, 1228, "2.2 nwl-param-types (R)"),
        new("ParamList.Types in BoxTreeBox.InputParam — list length changed", 35, 73, "2.2 nwl-param-types (R)"),
        new("ParamList.Types in BoxTreeBox.OutputParam — list length changed", 75, 98, "DIALECT N37 (a vendor limit, 2.3): the type of a drawn function box's result pin '   ', which goes with the name (see ParamList.Names)"),
        new("TextDocument.TextBlobForSerialisation in STSnippet.STSnippet.TextDocument — a cache citing no vendor-facts row ('text-blob-serialisation')", 7, 7, "2.3: the vendor-facts row text-blob-serialisation, carried from 2.2 (not in 2.2's row list; bridge-one-to-one left it open: completeness.known.ts)"),
    };
}
