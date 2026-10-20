using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// ONE SITUATION PER CODE, EVERY CODE RAISED AND DOCUMENTED (openspec <c>bridge-refusal-review</c> V.4).
///
/// <para>A client reacts to a refusal by its CODE, so a code is only worth its name if it means one situation and the
/// remedy that goes with it. Three codes had drifted onto several: <c>BAD_REQUEST</c> (a request shape, and a stale item
/// version), <c>INTERNAL_ERROR</c> (Volt's own invariant, and IDE states — a refused child read, a refused save, a broken
/// post-condition), <c>UNSUPPORTED</c> (a vendor limit, and Volt's own wire rules); and <c>NO_SIDECAR</c> named a cache no
/// client sees. This gate holds the vocabulary to its meaning.</para>
///
/// <para><b>The census.</b> Every reference to a code constant (<c>BridgeErrorCodes.X</c> / <c>ConflictCodes.X</c>) in
/// the toolchain's code — comments stripped, <c>Volt.Contracts</c> (the definitions) and <c>Volt.Cli</c> (the client,
/// which MATCHES codes) excluded — is a raise site, counted per file. Each <see cref="Situation"/> below names one
/// situation, its remedy and the ONE code it is answered with, and lists the files that raise it with their exact count.
/// So: a new raise site fails until someone classifies it under a situation; a code classified under a second situation
/// fails (one situation per code — re-code the site instead); a code no situation raises fails (dead vocabulary); and
/// every code must have its row — <c>docs/wire.html</c> for the frame and gate codes, <c>docs/network-text.html</c> for
/// <c>NETWORK_*</c>. Rejected: a hand-written review list (drifts) and inferring the situation from the message text
/// (the content scan D9 removed).</para>
/// </summary>
public class WireVocabularyTests
{
    /// <summary>One situation: what happened, what the client does about it, the code it is answered with, and every
    /// file that raises it with its exact count of references.</summary>
    private sealed record Situation(string Name, string Means, string Code, Dictionary<string, int> Sites);

    private static Dictionary<string, int> At(params (string File, int Count)[] sites) =>
        sites.ToDictionary(s => s.File, s => s.Count, StringComparer.Ordinal);

    private static readonly Situation[] Situations =
    {
        // ── the frame codes ────────────────────────────────────────────────────────────────────────────────────
        new("no IDE project is served", "no project bound, or the bridge paused: send connect", "PLC_DISCONNECTED", At(
            ("Volt.Engine.Host/BridgePipeHost.cs", 1),
            ("Volt.Engine/BridgeException.cs", 2),
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.cs", 1),
            ("Volt.Ide.Twincat/Ide/TcObjectModel.Build.cs", 1),   // -1 the save Volt no longer makes (D45)
            ("Volt.Ide.Twincat/Ide/TcObjectModel.cs", 1))),   // a delete with no IDE attached, before its member documents are closed (D45)
        new("another project is served", "the bound project is not the one named: rebind, never merge", "WRONG_PROJECT", At(
            ("Volt.Engine/BridgeException.cs", 1))),
        new("the bridge cannot serve this IDE process (it lacks a capability, or Volt's assemblies loaded twice, or this worker cannot unmarshal its Solution Explorer)",
            "every op but health: the IDE has to change (upgraded, or restarted), not the call",
            "IDE_UNSUPPORTED", At(
            ("Volt.Engine.Host/BridgePipeHost.cs", 1),
            ("Volt.Ide.Twincat/Ide/TcObjectModel.cs", 1))),
        new("another push or build holds the IDE", "wait for it to answer, then try once: nothing was applied",
            "IDE_BUSY", At(
            ("Volt.Engine.Host/BridgePipeHost.cs", 1))),
        new("the request breaks the wire's own rules", "change the REQUEST", "BAD_REQUEST", At(
            ("Volt.Engine.Host/BridgePipeHost.cs", 2),
            ("Volt.Engine/Format/Task/TaskDescriptorFormat.cs", 1),
            ("Volt.Engine/Sync/BuildService.cs", 2),   // build-selects-application: an `applications` root the project does not hold, an empty list
            ("Volt.Engine/Sync/FetchService.cs", 1),
            ("Volt.Engine/Sync/GrepService.cs", 4),   // grep-item-sources: a limit out of range, an empty pattern, one that does not compile, one that times out on a line
            ("Volt.Engine/Sync/PushService.cs", 8),   // +1 a move into another application; +1 a task moved out of its container (multi-application-tree); -2 the base-type op dispatch: PushOp is abstract, an op with no discriminator is refused by the strict body read (refuse-unknown-request-members)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs", 1),
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Task.cs", 2),   // bridge-one-to-one §3: a TwinCAT member label, a bare `Watchdog: off`
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Nodes.cs", 1),   // a write into the solution's own structure, above a PLC project (multi-application-tree)
            ("Volt.Ide.Twincat/Ide/TcTaskSchedule.cs", 4),
            ("Volt.Relay/RelayTunnel.cs", 1),
            ("Volt.Wire/PipeServer.cs", 2))),   // +1 a request frame over MaxFrameBytes (volt-cli-rework 1.0 bug b)
        new("the IDE, or a documented Volt limit on a vendor shape, will not take it", "change the TEXT, or do it in the IDE",
            "UNSUPPORTED", At(
            ("Volt.Engine/Format/Body/BodyFormatGuard.cs", 12),  // abstract-member-parity: the NONE/ABSTRACT refusals as named builders (NONE off a member site, NONE without ABSTRACT, ABSTRACT dropped over NONE, statements under ABSTRACT) + a body over NONE at an item site, over a slotless concrete member, and a comment over NONE
            ("Volt.Engine/Format/Network/NetworkText.cs", 1),
            ("Volt.Engine/Format/St/ImplementationMarker.cs", 1),
            ("Volt.Engine/Format/St/StReader.cs", 3),
            ("Volt.Engine/Format/St/PropertyLines.cs", 1),   // gate review of step 3, finding 8: a %NETVAR value the line cannot carry
            ("Volt.Engine/Format/St/StWriter.cs", 3),
            ("Volt.Engine/Ide/InterfaceAccessorGuard.cs", 2),
            ("Volt.Engine/Ide/MemberSites.cs", 1),   // bridge-one-to-one §3: a transition, refused by name
            ("Volt.Engine/Item/ItemKind.cs", 1),
            ("Volt.Engine/Library/LibraryFetch.cs", 1),
            ("Volt.Engine/Sync/Materializer.cs", 4),
            ("Volt.Engine/Sync/PushService.cs", 10),
            ("Volt.Ide.Codesys/Driver/CodesysDriver.Content.cs", 4),   // +1: a body site whose type declares no Implementation (abstract-member-push); +1 a create carrying %NETVAR / %PARAMETER_LIST (gate review of step 3, 7c); +1 a create of %CLASS PERSISTENT / NVL (second review of step 3, finding 5)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs", 2),   // +1 a device member that is not there (gate review of step 3, 10)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs", 1),   // -1 a reference flag off its measured value (every flag is a manifest line now, C37b)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Properties.cs", 13),   // bridge-one-to-one §3: a property the bridge cannot read or write, by name; +2 a measured constant off its value, a %NETVAR value the line cannot carry (gate review of step 3, 2 / 8); +2 an archive member absent where it is no version fact, and one read where the platform lacks it with no measured meaning for its absence (environment-dependency-audit 2.0, DIALECT V7) — the item refused by name, as the rest
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Task.cs", 9),   // +2 a task member or a call stored with surrounding blanks (gate review of step 3, 8)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.cs", 4),
            ("Volt.Ide.Codesys/Ide/CodesysTypeMap.cs", 1),
            ("Volt.Ide.Codesys/Ide/NwlInterop.cs", 1),   // an LD/FBD write on a CODESYS older than SP21 (2026-10-10)
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Content.cs", 10),   // +1 a member's %EXCLUDE_FROM_BUILD inside a POU that carries it too (C39); +1 an interface accessor storing another declaration (gate review of step 3, 5); +1 a reference flag property unanswered / neither True nor False (two sites for the one flag property, C37b)
            ("Volt.Ide.Twincat/Ide/TcItemArchive.cs", 1),   // a member renamed since the save, which TwinCAT's archive does not carry (D45)
            ("Volt.Ide.Twincat/Ide/TcObjectModel.Properties.cs", 1),   // an Exclude write the IDE took and did not apply, read back (C39)
            ("Volt.Ide.Twincat/Ide/TcObjectModel.Task.cs", 4),
            ("Volt.Ide.Twincat/Ide/TcObjectModel.cs", 1),   // -2 the PLCopen import that built nothing (deleted with the import, twincat-inproc-host)
            ("Volt.Ide.Twincat/Ide/TcTaskSchedule.cs", 8))),   // +1 a TaskDef member none of the 13 measured (gate review of step 3, 6)
        new("Volt's own broken invariant, or a refusal nobody coded", "report a bug; code the refusal", "INTERNAL_ERROR", At(
            ("Volt.Engine/Item/ItemKind.cs", 1),
            ("Volt.Engine/Sync/ProjectSnapshot.cs", 1),
            ("Volt.Engine/Sync/PushService.cs", 7),
            ("Volt.Ide.Codesys/Driver/CodesysDriver.Content.cs", 1),
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Content.cs", 3),   // +1 a project-settings read of a node that is no PLC project's settings item (multi-application-tree)
            ("Volt.Relay/RelayTunnel.cs", 1),
            ("Volt.Wire/PipeServer.cs", 1))),
        new("the IDE no longer holds what Volt just wrote or read", "pull to see what landed, then push again",
            "IDE_LOST_ITEM", At(
            ("Volt.Engine/Sync/PushService.cs", 6),
            ("Volt.Ide.Codesys/Driver/CodesysDriver.Content.cs", 1),
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Content.cs", 4),
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Tree.cs", 3))),
        new("a create collided with a child already there", "rename, or update instead", "DUPLICATE_CHILD", At(
            ("Volt.Engine/Sync/PushService.cs", 1))),
        new("the text cannot be split into what the push writes", "fix the body", "INVALID_ST", At(
            ("Volt.Engine/Format/St/PropertyLines.cs", 1),   // bridge-one-to-one §3: the %-line grammar (one Refuse builder)
            ("Volt.Engine/Format/St/StReader.cs", 20))),   // +1: code under IMPLEMENTATION NONE (abstract-member-push)
        new("the IDE holds the item and Volt cannot read it whole",
            "fix it in the IDE, or push with force — or, for an item the IDE does not return, delete then create", "UNREADABLE", At(
            ("Volt.Engine/Ide/ItemLookup.cs", 1),
            ("Volt.Engine/Sync/PushConflicts.cs", 2),
            ("Volt.Engine/Sync/PushService.cs", 4),   // -1 ApplyToUnopened: an op of another kind no longer reaches it (resolved by path, unreadable-name-carries-kind 1.7)
            ("Volt.Ide.Codesys/Driver/CodesysDriver.Content.cs", 1),
            ("Volt.Ide.Codesys/Ide/CodesysNetworkReader.cs", 1),   // an archived SymbolComment that is not text (ld-fbd-coverage gate 1b-3)
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Content.cs", 3),   // +1 an item read as excluded by a folder the walk did not see (C39); +1 an interface accessor the saved file does not hold (gate review of step 3, 5)
            ("Volt.Ide.Twincat/Ide/TcObjectModel.Properties.cs", 8),   // +3 the live Exclude property: no item XML, none published, neither True nor False (C39); +4 no item XML, no FullPath, a saved file / .plcproj not on disk (gate review of step 3, 6)
            ("Volt.Ide.Twincat/Ide/TcObjectModel.cs", 2),   // bridge-one-to-one §3: a declaration or implementation that reads null
            ("Volt.Ide.Twincat/Ide/TcTaskSchedule.cs", 1))),   // a TaskDef that carries no measured member (gate review of step 3, 6)   // bridge-one-to-one §3: a declaration or implementation that reads null

        // ── the optimistic gate and the apply loop ─────────────────────────────────────────────────────────────
        new("the lease is stale", "pull, then push again", "STALE_PROJECT_VERSION", At(
            ("Volt.Engine/Sync/PushConflicts.cs", 1),
            ("Volt.Engine/Sync/PushService.cs", 1))),
        new("the item moved since its version was read", "pull that item, merge, push again", "STALE_ITEM_VERSION", At(
            ("Volt.Engine/Sync/PushConflicts.cs", 1),
            ("Volt.Engine/Sync/PushService.cs", 1))),
        new("a set landed on a path the IDE holds (a create, or a rename or move's to)",
            "a create: push an update or pick another name; a to: pick another or free it first", "ITEM_EXISTS", At(
            ("Volt.Engine/Sync/PushConflicts.cs", 1),
            ("Volt.Engine/Sync/PushService.cs", 2))),   // move-onto-existing-path-refused: a held `to`, a held name (C38)
        new("a quoted item is gone (complete walk)", "create it, or drop the op", "ITEM_MISSING", At(
            ("Volt.Engine/Sync/PushConflicts.cs", 1))),
        new("the push could not read where the item lives", "fix what stops the IDE enumerating that place",
            "ITEM_UNVERIFIED", At(
            ("Volt.Engine/Ide/ItemLookup.cs", 6),   // +3 the path descent's: a folder's children, a child, a child's name unreadable (multi-application-tree)
            ("Volt.Engine/Ide/ProjectDeclarations.cs", 1),
            ("Volt.Engine/Sync/PushConflicts.cs", 1),
            // -1 PushService: a forced replace's folder came from the walk; it is the op's path now (multi-application-tree)
            ("Volt.Ide.Twincat/Ide/ExplorerSnapshot.cs", 2),
            ("Volt.Ide.Twincat/Ide/TcObjectModel.cs", 6))),
        new("the push stopped before this op", "re-send it unchanged", "NOT_ATTEMPTED", At(
            ("Volt.Engine/Sync/PushService.cs", 1))),

        // ── the graphical body format ──────────────────────────────────────────────────────────────────────────
        new("network text that does not parse", "fix the text at the line", "NETWORK_PARSE", At(
            ("Volt.Engine/Format/Network/NetworkLexer.cs", 8),   // 2R.6b: a bad escape in a comment, title or backtick, and text after EXECUTE on its line
            ("Volt.Engine/Format/Network/NetworkText.cs", 1),
            ("Volt.Engine/Format/Network/NetworkTextReader.cs", 27))),   // 2R.6b (v2-spec): the old spellings that fail as no parse, each naming the new one
        new("a NETWORK block with no END_NETWORK", "close the block", "NETWORK_NOT_CLOSED", At(
            ("Volt.Engine/Format/Network/NetworkTextReader.cs", 1))),
        new("a wire declared twice, or named like a name in scope", "rename the wire", "NETWORK_DUPLICATE_NAME", At(
            ("Volt.Engine/Format/Network/NetworkValidator.cs", 1))),   // 2R.6b: a split defined twice (X17), checked once over the model
        new("a malformed operator group", "fix the expression", "NETWORK_BAD_EXPRESSION", At(
            ("Volt.Engine/Format/Network/NetworkTextReader.cs", 59),   // 2R.6b (v2-spec): the indentation check ("missing `;`?"), the bracket rules, one tree one text (a redundant bracket, the call form where a word holds it), ENO without EN, `.name` misuse, the split's type, the old symbols
            ("Volt.Engine/Format/Network/NetworkValidator.cs", 1))),   // 2R.6b: a split read and defined nowhere (X17)
        new("an operator outside the FBD/LD table", "use an operator of the table", "NETWORK_UNKNOWN_OPERATOR", At(
            ("Volt.Engine/Format/Network/NetworkTextReader.cs", 1))),
        new("a body shape network text has no spelling for", "draw it in the IDE", "NETWORK_UNSUPPORTED", At(
            ("Volt.Engine/Format/Network/NetworkText.cs", 1),
            ("Volt.Engine/Format/Network/NetworkValidator.cs", 1),   // 2R.6b: the shape refusals (X3–X17, the MEASURE shapes), checked once over the model
            ("Volt.Engine/Format/Network/NetworkTextWriter.cs", 1),   // 2R.6b: the validator's refusals (X3–X17, the MEASURE shapes) raised as one exception, by the code each names
            ("Volt.Engine/Format/Network/NetworkPairing.cs", 3),   // a pushed UNSUPPORTED line no live network pairs with (1b.4); +2 a removal that would erase what the text does not show — beside an insertion, or beside a network showing the same text (gate 1b-4)
            ("Volt.Engine/Format/Network/NetworkTextReader.cs", 8),   // 2R.6b: the reader keeps only what the grammar itself refuses (an UNSUPPORTED line beside other statements, a function read by `.name`, …); the shape refusals moved to the shared validator (NetworkValidator), raised through NetworkTextWriter
            // A shape the native builder has no TwinCAT form for (PARALLEL, a pin flag, an enabled bit operator,
            // a consumed call with no slot for its consumer) — it replaced the PLCopen import's refusals (twincat-inproc-host).
            ("Volt.Ide.Twincat/Ide/TcArchiveBuilder.cs", 1),
            // The 2R.5 shapes no TwinCAT build has measured (TcUnmeasured.RefuseUnbuilt).
            ("Volt.Ide.Twincat/Ide/TcUnmeasured.cs", 1))),
    };

    // ── the gate ─────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Every_code_means_one_situation_is_raised_where_the_census_says_and_is_documented()
    {
        var root = NoCodeCheckLeftTests.RepoRoot();
        var cli = Path.Combine(root, "packages", "volt-cli");
        var contracts = Path.Combine(cli, "src", "Volt.Contracts", "Vocabulary");
        var codes = Consts(File.ReadAllText(Path.Combine(contracts, "BridgeErrorCodes.cs")), "BridgeErrorCodes")
            .Concat(Consts(File.ReadAllText(Path.Combine(contracts, "ConflictCodes.cs")), "ConflictCodes"))
            .ToList();
        Assert.True(codes.Count >= 20, $"only {codes.Count} code constant(s) read — the gate is not reading Contracts.");

        var findings = Findings(codes, Situations, Census(Path.Combine(cli, "src"), codes),
                                File.ReadAllText(Path.Combine(cli, "docs", "wire.html")),
                                File.ReadAllText(Path.Combine(cli, "docs", "network-text.html")));

        Assert.True(findings.Count == 0,
            "The wire's error vocabulary (openspec bridge-refusal-review V.4) — one situation per code, raised and " +
            "documented:\n  " + string.Join("\n  ", findings));
    }

    // ── the gate's own teeth ─────────────────────────────────────────────────────────────────────────────────────

    private static readonly (string Const, string Code)[] TwoCodes = { ("BridgeErrorCodes.BadRequest", "BAD_REQUEST"), ("ConflictCodes.NetworkParse", "NETWORK_PARSE") };
    private const string Pages = "<td class=\"name\">BAD_REQUEST</td>";
    private const string NetworkPage = "<td class=\"name\">NETWORK_PARSE</td>";

    private static Situation S(string code, params (string, int)[] sites) => new("s", "m", code, At(sites));

    private static Dictionary<(string Code, string File), int> Actual(params (string, string, int)[] rows) =>
        rows.ToDictionary(r => (r.Item1, r.Item2), r => r.Item3);

    [Fact]
    public void A_matching_census_is_no_finding() =>
        Assert.Empty(Findings(TwoCodes, new[] { S("BAD_REQUEST", ("A.cs", 2)), S("NETWORK_PARSE", ("B.cs", 1)) },
                              Actual(("BAD_REQUEST", "A.cs", 2), ("NETWORK_PARSE", "B.cs", 1)), Pages, NetworkPage));

    [Fact]
    public void A_new_raise_site_fails_until_it_is_classified() =>
        Assert.Contains(Findings(TwoCodes, new[] { S("BAD_REQUEST", ("A.cs", 2)), S("NETWORK_PARSE", ("B.cs", 1)) },
                                 Actual(("BAD_REQUEST", "A.cs", 3), ("NETWORK_PARSE", "B.cs", 1)), Pages, NetworkPage),
                        f => f.Contains("BAD_REQUEST") && f.Contains("A.cs") && f.Contains("found 3"));

    [Fact]
    public void A_code_under_two_situations_fails() =>
        Assert.Contains(Findings(TwoCodes, new[] { S("BAD_REQUEST", ("A.cs", 1)), S("BAD_REQUEST", ("C.cs", 1)), S("NETWORK_PARSE", ("B.cs", 1)) },
                                 Actual(("BAD_REQUEST", "A.cs", 1), ("BAD_REQUEST", "C.cs", 1), ("NETWORK_PARSE", "B.cs", 1)), Pages, NetworkPage),
                        f => f.Contains("BAD_REQUEST") && f.Contains("2 situations"));

    [Fact]
    public void A_code_nothing_raises_fails() =>
        Assert.Contains(Findings(TwoCodes, new[] { S("BAD_REQUEST", ("A.cs", 1)), S("NETWORK_PARSE") },
                                 Actual(("BAD_REQUEST", "A.cs", 1)), Pages, NetworkPage),
                        f => f.Contains("NETWORK_PARSE") && f.Contains("raised nowhere"));

    [Fact]
    public void An_undocumented_code_fails()
    {
        var findings = Findings(TwoCodes, new[] { S("BAD_REQUEST", ("A.cs", 1)), S("NETWORK_PARSE", ("B.cs", 1)) },
                                Actual(("BAD_REQUEST", "A.cs", 1), ("NETWORK_PARSE", "B.cs", 1)), "", "");
        Assert.Contains(findings, f => f.Contains("BAD_REQUEST") && f.Contains("wire.html"));
        Assert.Contains(findings, f => f.Contains("NETWORK_PARSE") && f.Contains("network-text.html"));
    }

    [Fact]
    public void A_reference_in_a_comment_is_no_raise_site() =>
        Assert.Empty(Hits(NoCodeCheckLeftTests.StripComments("// BridgeErrorCodes.BadRequest was here\nvar x = 1;"), TwoCodes));

    // ── the checks ───────────────────────────────────────────────────────────────────────────────────────────────

    private static List<string> Findings(IReadOnlyList<(string Const, string Code)> codes, IReadOnlyList<Situation> situations,
                                         Dictionary<(string Code, string File), int> actual, string wirePage, string networkPage)
    {
        var findings = new List<string>();
        var known = codes.Select(c => c.Code).ToHashSet(StringComparer.Ordinal);

        foreach (var s in situations.Where(s => !known.Contains(s.Code)))
            findings.Add($"situation '{s.Name}' answers {s.Code}, which is no code constant in Contracts.");

        foreach (var code in known.OrderBy(c => c, StringComparer.Ordinal))
        {
            var mine = situations.Where(s => s.Code == code).ToList();
            if (mine.Count == 0) findings.Add($"{code}: no situation names it — classify it, or delete the code.");
            if (mine.Count > 1)
                findings.Add($"{code}: answers {mine.Count} situations ({string.Join("; ", mine.Select(s => s.Name))}) — one " +
                             "situation per code: re-code the sites of the other situation.");

            var declared = mine.SelectMany(s => s.Sites).GroupBy(kv => kv.Key)
                .ToDictionary(g => g.Key, g => g.Sum(kv => kv.Value), StringComparer.Ordinal);
            var found = actual.Where(kv => kv.Key.Code == code)
                .ToDictionary(kv => kv.Key.File, kv => kv.Value, StringComparer.Ordinal);
            if (found.Count == 0)
                findings.Add($"{code}: raised nowhere in the toolchain's code — a code no client can observe is a lie in the vocabulary.");
            foreach (var file in declared.Keys.Union(found.Keys).OrderBy(f => f, StringComparer.Ordinal))
            {
                declared.TryGetValue(file, out var want);
                found.TryGetValue(file, out var got);
                if (want != got)
                    findings.Add($"{code} in {file}: census {want}, found {got} — " +
                                 (got > want ? "a new raise site: classify it (its situation must be this code's, or re-code it)"
                                             : "a site is gone: lower the count") +
                                 $". Census line: (\"{file}\", {got})");
            }

            var network = code.StartsWith("NETWORK_", StringComparison.Ordinal);
            var page = network ? networkPage : wirePage;
            if (!page.Contains($"class=\"name\">{code}<", StringComparison.Ordinal))
                findings.Add($"{code}: no row in docs/{(network ? "network-text.html" : "wire.html")} naming its situation.");
        }
        return findings;
    }

    /// <summary>The <c>public const string X = "Y";</c> of a vocabulary class, as (X, Y) — read as text, since this gate
    /// references no package. A const whose value is no code (<c>ProjectName = "&lt;project&gt;"</c>) is not one.</summary>
    internal static IEnumerable<(string Const, string Code)> Consts(string source, string type) =>
        Regex.Matches(NoCodeCheckLeftTests.StripComments(source), @"public\s+const\s+string\s+(\w+)\s*=\s*""([A-Z_]+)""\s*;")
            .Select(m => ($"{type}.{m.Groups[1].Value}", m.Groups[2].Value));

    /// <summary>Every (code, file) → count of references to a code constant under <paramref name="src"/>, comments
    /// stripped, outside Contracts and the CLI client.</summary>
    private static Dictionary<(string Code, string File), int> Census(string src, IReadOnlyList<(string Const, string Code)> codes)
    {
        var census = new Dictionary<(string, string), int>();
        foreach (var path in Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(src, path).Replace('\\', '/');
            if (rel.Contains("/bin/") || rel.Contains("/obj/") || rel.StartsWith("Volt.Contracts/", StringComparison.Ordinal)
                || rel.StartsWith("Volt.Cli/", StringComparison.Ordinal)) continue;
            foreach (var code in Hits(NoCodeCheckLeftTests.StripComments(File.ReadAllText(path)), codes))
                census[(code, rel)] = census.TryGetValue((code, rel), out var n) ? n + 1 : 1;
        }
        return census;
    }

    /// <summary>The code of every reference to a code constant in comment-free <paramref name="code"/>.</summary>
    private static IEnumerable<string> Hits(string code, IReadOnlyList<(string Const, string Code)> codes)
    {
        var byConst = codes.ToDictionary(c => c.Const, c => c.Code, StringComparer.Ordinal);
        foreach (Match m in Regex.Matches(code, @"\b((?:BridgeErrorCodes|ConflictCodes)\.\w+)\b"))
            if (byConst.TryGetValue(m.Groups[1].Value, out var c)) yield return c;
    }

    // ── the codes assigned by TYPE ───────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// EVERY UNCODED THROW, COUNTED (review of step V). The census above sees a code only where it is SPELLED; a code
    /// assigned by an exception's TYPE is invisible to it. An uncoded exception reaches a client anyway: the push's
    /// <c>ConflictFor</c> answers a <c>NotSupportedException</c> <c>UNSUPPORTED</c> and every other uncoded exception
    /// <c>INTERNAL_ERROR</c>, as <c>PipeServer</c> does for a frame. So a new <c>throw new InvalidOperationException("CODESYS
    /// refused X")</c> in a driver was an IDE refusal answered "Volt bug", and the one-situation gate stayed green — the
    /// exact class V.1 re-coded by hand.
    ///
    /// <para>Here every <c>throw new</c> of a BCL exception type that carries no code (<see cref="UncodedThrow"/>) is
    /// counted per file, like the raise sites. A new one fails until someone decides: code it with its situation's code
    /// (an IDE refusal, a request rule, a vendor limit — almost always), or, when it really is Volt's own broken invariant
    /// (<c>INTERNAL_ERROR</c>'s situation) or caught inside the toolchain before any client sees it, raise its count here.
    /// <c>ArgumentException</c> and its kind are not counted: a parameter guard is a caller's broken invariant by
    /// definition.</para>
    /// </summary>
    private static readonly Dictionary<string, int> Uncoded = At(
        ("Volt.Engine/Format/Body/BodyFormatGuard.cs", 1),
        ("Volt.Engine/Format/Network/NetworkTextGate.cs", 2),
        ("Volt.Engine/Format/Network/NetworkMembers.cs", 1),   // a stored member value read as a list of strings it is not (MemberValue.AsTexts): Volt's own invariant (ld-fbd-coverage 2R.3, the pragma's value kept as the model's)
        ("Volt.Engine/Format/Network/NetworkTextReader.cs", 1),
        ("Volt.Engine/Format/St/ImplementationMarker.cs", 2),
        ("Volt.Engine/Format/St/PropertyLines.cs", 2),
        ("Volt.Engine/Format/St/StReader.cs", 1),
        ("Volt.Engine/Format/Task/TaskDescriptorFormat.cs", 1),
        ("Volt.Engine/Ide/SourceScopes.cs", 1),
        ("Volt.Engine/Sync/Materializer.cs", 1),
        ("Volt.Engine/Sync/PushService.cs", 2),   // the two op dispatches' default arm: a PushOp type with no apply arm, Volt's own invariant (PushOp is abstract with two members; refuse-unknown-request-members)
        ("Volt.Ide.Codesys/Driver/CodesysDriver.Content.cs", 0),   // -4 every "object could not be obtained" is ReadObject's own throw now (cli-bridges review B1)
        ("Volt.Ide.Codesys/Driver/CodesysDriver.Tree.cs", 1),
        ("Volt.Ide.Codesys/Driver/CodesysDriver.cs", 2),   // +1 no Application to extract library signatures for, moved here from CodesysObjectModel.Libraries.cs (per application, multi-application-tree)
        ("Volt.Ide.Codesys/Ide/CodesysNetworkWriter.cs", 16),   // 2R.5 +1 a named ENO pin on a box built with no ENO output (invariant: the reader refuses that text); +1 a changed network reading a box by a named main output (S4, N21; ld-fbd-coverage 1b.4); +3 a box that answers no pin flags, misaligned ones, or does not keep a negation (S6, 2.3) — NotSupported, UNSUPPORTED; +2 the output slots laid out by name (2.3): a named pin its names do not hold (NotSupported), and a positional pin the reader left unslotted (invariant)
        ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Build.cs", 1),
        ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Classes.cs", 3),   // +1 a persistent-list create refused until the oracle reproduces one (gate review of step 3, 7b)
        ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs", 4),   // -1 the device object read (ReadObject's own throw, B1)
        ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs", 17),   // -1 no Application: moved to CodesysDriver.cs (multi-application-tree)   // -1 the manager's object read (ReadObject's own throw, B1); +2 a redirection the manager answers no names / no resolution for (gate review of step 3, 4)
        ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Properties.cs", 5),
        ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Reflection.cs", 3),
        ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Scripting.cs", 7),
        ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Task.cs", 3),   // -2 the task object reads (ReadObject's own throw, B1)
        ("Volt.Ide.Codesys/Ide/CodesysObjectModel.cs", 13),   // +2 ReadObject refuses no object manager / a checkout with no object (cli-bridges review B1)
        ("Volt.Ide.Codesys/Ide/NwlInterop.cs", 1),
        ("Volt.Ide.Codesys/Ide/Reflection.cs", 1),
        ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Content.cs", 1),   // -1 the unused manifest name ReadManifest computed (cli-bridges review A7); -2 the import's stamp and splice (twincat-inproc-host)
        ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Tree.cs", 1),
        ("Volt.Ide.Twincat/Ide/TcArchive.cs", 2),
        // The native writer (twincat-inproc-host): the builder's invariants (an FB call with no instance, a positional
        // output with no slot, a RESET at the generic flag write) and its shape refusals (a slot two pins claim, a named
        // pin the names do not hold, a node with no archive form); the writer's refusals of what TwinCAT never writes.
        // +1 (merge onto 2R): a named ENO pin on a box built with no ENO output, which the reader refuses (P5).
        ("Volt.Ide.Twincat/Ide/TcArchiveBuilder.cs", 8),
        ("Volt.Ide.Twincat/Ide/TcArchiveWriter.cs", 4),
        ("Volt.Ide.Twincat/Ide/TcItemArchive.cs", 7),   // +2 carrying the live state (D45): an archive with no object element / no source document; +1 an undo restored under its saved name the rename back refused
        ("Volt.Ide.Twincat/Ide/TcLibrarySignatures.cs", 1),
        ("Volt.Ide.Twincat/Ide/TcNetworkWriter.cs", 6),   // +2 S4 in a changed network (unmeasured) and an insertion with no import to build it (1b.4)
        ("Volt.Ide.Twincat/Ide/TcObjectModel.Session.cs", 3),
        ("Volt.Ide.Twincat/Ide/TcObjectModel.Task.cs", 1),
        ("Volt.Ide.Twincat/Ide/TcObjectModel.cs", 2),   // +1 a library manager answering no signatures (cli-bridges review B7)
        ("Volt.Ide.Twincat/Ide/TcProjectSettings.cs", 6),
        ("Volt.Ide.Twincat/Ide/TcHierarchy.cs", 3),   // every one caught by TcObjectModel.Explorer: IDE_UNSUPPORTED or ITEM_UNVERIFIED
        ("Volt.Ide.Twincat/Ide/TcSolutionExplorer.cs", 2),   // +1: a refused manifest activation named on the proxy failure; caught the same way
        ("Volt.Ide.Twincat/Ide/TcTaskSchedule.cs", 3),
        ("Volt.Ide.Twincat/Ide/TcUnmeasured.cs", 1),
        ("Volt.Relay/RelayTunnel.cs", 2),
        ("Volt.Wire/PipeServer.cs", 0),   // -2 a held pipe name is PipeNameTakenException now (twincat-double-click-next-free-xae): it reaches the host that took the claim, never a frame
        ("Volt.Wire/PipeAcl.cs", 1));   // a pipe bind the OS refused (environment-dependency-audit 2.2): it reaches PipeServer.Start's caller, the host, which reports it — never a frame

    /// <summary>A <c>throw new</c> of a BCL exception type that carries no wire code.</summary>
    private static readonly Regex UncodedThrow = new(
        @"\bthrow\s+new\s+(?:System\.(?:IO\.|Runtime\.InteropServices\.)?)?(?:InvalidOperation|NotSupported|NotImplemented|IO|MissingMethod|COM)?Exception\s*\(",
        RegexOptions.Compiled);

    [Fact]
    public void Every_uncoded_throw_is_counted_so_a_new_one_is_classified()
    {
        var src = Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "packages", "volt-cli", "src");
        var findings = UncodedFindings(Uncoded, UncodedCensus(src));
        Assert.True(findings.Count == 0,
            "An uncoded throw reaches a client by its TYPE (NotSupportedException → UNSUPPORTED on a push conflict, anything " +
            "else → INTERNAL_ERROR) — code it with its situation's code, or count it as Volt's own invariant " +
            "(openspec bridge-refusal-review, review of step V):\n  " + string.Join("\n  ", findings));
    }

    [Fact]
    public void A_new_uncoded_throw_fails_until_it_is_counted() =>
        Assert.Contains(UncodedFindings(At(("A.cs", 1)), new Dictionary<string, int> { ["A.cs"] = 2 }),
                        f => f.Contains("A.cs") && f.Contains("found 2"));

    [Theory]
    [InlineData("throw new InvalidOperationException(\"CODESYS refused X\");", true)]
    [InlineData("throw new System.NotSupportedException(\"x\");", true)]
    [InlineData("throw new Exception(\"x\");", true)]
    [InlineData("throw new COMException(\"x\", 1);", true)]
    [InlineData("throw new BridgeException(BridgeErrorCodes.Unsupported, \"x\");", false)]
    [InlineData("throw new UnrepresentableBodyException(\"x\");", false)]
    [InlineData("throw new ArgumentNullException(nameof(x));", false)]
    public void An_uncoded_throw_is_one_of_a_BCL_type_that_carries_no_code(string line, bool counted) =>
        Assert.Equal(counted, UncodedThrow.IsMatch(line));

    private static List<string> UncodedFindings(Dictionary<string, int> declared, Dictionary<string, int> found)
    {
        var findings = new List<string>();
        foreach (var file in declared.Keys.Union(found.Keys).OrderBy(f => f, StringComparer.Ordinal))
        {
            declared.TryGetValue(file, out var want);
            found.TryGetValue(file, out var got);
            if (want != got)
                findings.Add($"uncoded throws in {file}: census {want}, found {got} — " +
                             (got > want ? "a new one: code it, or count it as an invariant" : "one is gone: lower the count") +
                             $". Census line: (\"{file}\", {got}),");
        }
        return findings;
    }

    /// <summary>File → count of <see cref="UncodedThrow"/> under <paramref name="src"/>, comments stripped, outside
    /// Contracts and the CLI client (the same scope as the raise-site census).</summary>
    private static Dictionary<string, int> UncodedCensus(string src)
    {
        var census = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var path in Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(src, path).Replace('\\', '/');
            if (rel.Contains("/bin/") || rel.Contains("/obj/") || rel.StartsWith("Volt.Contracts/", StringComparison.Ordinal)
                || rel.StartsWith("Volt.Cli/", StringComparison.Ordinal)) continue;
            var n = UncodedThrow.Matches(NoCodeCheckLeftTests.StripComments(File.ReadAllText(path))).Count;
            if (n > 0) census[rel] = n;
        }
        return census;
    }
}
