using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Xunit;
using Volt.Tests.Shared;

namespace Volt.Repo.Gates;

/// <summary>
/// ONE IMPLEMENTATION PER WIRE RULE, GATED (openspec <c>volt-cli-rework</c> 1.3). PLC Assist, a second client written
/// against the docs, found seven wire defects; the pattern was a rule enforced at several call sites, one of which
/// drifted (strict members on push only, case-insensitive paths on push only). So each wire rule has one implementation,
/// and a new call site that does the rule's job beside it fails here.
///
/// <para>Where a rule already has exactly one implementation the assertion is exact. Where it lives in more than one place
/// today it is a RATCHET (<see cref="Ratchet"/>): today's sites are pinned per file and may only go down; the note on
/// each pin table says where the extra sites are. The rules:</para>
/// <list type="bullet">
/// <item>the PATH COMPARER — "an addressed path ignores case, a held key is exact" (wire.html#identity);</item>
/// <item>the WIRE-NAME MINTER — an item's path <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c> (<c>Versioning.PathOf</c>);</item>
/// <item>the STRICT REQUEST READER — a body member the op does not have is BAD_REQUEST (<c>BridgePipeHost.Body</c>);</item>
/// <item>the PROTOCOL NUMBER beside the schema pin (<c>WireProtocol.Version</c>, <c>DocDataTests</c>);</item>
/// <item>the ERROR-CODE MAPPING — a coded exception keeps its code, anything else is INTERNAL_ERROR (<c>PipeServer</c>).</item>
/// </list>
/// </summary>
public class WireRulesHaveOneImplementationTests
{
    private static string Src(string rel) => Path.Combine(SourceScan.SrcDir(), rel.Replace('/', Path.DirectorySeparatorChar));

    private static IEnumerable<(string File, int Line, string Code)> AllSource() =>
        Directory.EnumerateDirectories(SourceScan.SrcDir()).Select(Path.GetFileName)
            .Where(d => d!.StartsWith("Volt.", StringComparison.Ordinal))
            .OrderBy(d => d, StringComparer.Ordinal)
            .SelectMany(d => SourceScan.Lines(d!));

    // ── the path comparer ────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// THE PATH COMPARER has no one implementation yet (map E6): every comparison in the path layer picks its comparer at
    /// the call site, so "addressed ignores case, held is exact" is re-decided at each one — the exact shape of PLC Assist's
    /// "case-insensitive paths on push only". The one implementation (an addressed/held comparer pair in <c>Item/</c>) is
    /// rework step 3; until then this counts every comparer chosen in the path layer — Engine <c>Sync/</c>, <c>Item/</c>,
    /// <c>Ide/</c> and the host — and the count only goes down. A proxy: it also counts comparisons of non-path strings
    /// (kind names, members), which move with the paths.
    /// </summary>
    [Fact]
    public void Path_comparison_picks_no_new_comparer_at_a_call_site_ratchet()
    {
        var comparer = new Regex(@"\b(StringComparison|StringComparer)\.(Ordinal|OrdinalIgnoreCase)\b", RegexOptions.CultureInvariant);
        var actual = new SortedDictionary<string, int>(StringComparer.Ordinal);
        foreach (var dir in new[] { "Volt.Engine/Sync", "Volt.Engine/Item", "Volt.Engine/Ide", "Volt.Engine.Host" })
            foreach (var (file, count) in SourceScan.CountPerFile(SourceScan.Lines(dir), comparer))
                actual[file] = count;
        Ratchet.Hold("A comparer chosen at a call site in the path layer (no one path comparer exists yet).",
            PathComparerPins, actual,
            "Compare a wire path through the one comparer (rework step 3), not a StringComparison picked here.");
    }

    // ── the wire-name minter ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The extension half of a wire name is joined in ONE place, <c>Materializer.FullWireName</c>, and only the
    /// minter <c>Versioning.PathOf</c> (and the materialized item's own name) calls it.</summary>
    [Fact]
    public void Only_the_minter_joins_a_name_and_its_kind_extension()
    {
        var callers = AllSource().Where(l => Regex.IsMatch(l.Code, @"\bFullWireName\(", RegexOptions.CultureInvariant))
            .Select(l => l.File).Distinct().OrderBy(f => f, StringComparer.Ordinal).ToList();
        Assert.Equal(new[] { "Volt.Engine/Sync/Materializer.cs", "Volt.Engine/Sync/Versioning.cs" }, callers);
    }

    /// <summary>
    /// A PATH IS MINTED BY <c>Versioning.PathOf</c>. <c>ItemPath.Of</c> joins a folder and a file name; called anywhere
    /// else it builds a wire path beside the minter. Today's extra sites:
    /// <list type="bullet">
    /// <item><c>Sync/Versioning.cs</c> — the minter itself, and the <c>unreadableNodes</c> node path (a node has no kind);</item>
    /// <item><c>Sync/BuildService.cs</c> — the bare path a diagnostic is placed by;</item>
    /// <item><c>Sync/PushService.cs</c> — the walk's unreadable nodes (the reject path) and the <c>renamedTo</c> receipt;</item>
    /// <item><c>Library/LibraryFetch.cs</c> — a library signature's path in the library's own folder;</item>
    /// <item><c>Volt.Ide.Codesys/Driver/CodesysDriver.cs</c>, <c>Volt.Ide.Twincat/Driver/BeckhoffDriver.cs</c> — the hosts
    /// placing a build diagnostic by bare path.</item>
    /// </list>
    /// And one host reaches up into <c>Sync</c> for the minter (map E5/T1): <c>BeckhoffDriver.Tree.cs</c>.
    /// </summary>
    [Fact]
    public void A_wire_path_is_minted_beside_the_minter_nowhere_new_ratchet()
    {
        var join = new Regex(@"\bItemPath\.Of\(", RegexOptions.CultureInvariant);
        var actual = SourceScan.CountPerFile(AllSource().Where(l => l.File != "Volt.Engine/Item/ItemPath.cs"), join);
        Ratchet.Hold("ItemPath.Of — a wire path joined outside the minter (Versioning.PathOf).", ItemPathOfPins, actual,
            "Mint an item's path with Versioning.PathOf (or extend it), so a path is spelled in one place.");

        var upReach = new Regex(@"\bVersioning\.PathOf\(", RegexOptions.CultureInvariant);
        var hosts = SourceScan.CountPerFile(AllSource().Where(l => !l.File.StartsWith("Volt.Engine/", StringComparison.Ordinal)), upReach);
        Ratchet.Hold("Versioning.PathOf called from outside Volt.Engine (a host reaching up into Sync, map E5).", MinterUpReachPins, hosts,
            "The minter moves into Item/ (rework step 5); a host must not reach up into Sync for it.");
    }

    // ── the strict request reader ────────────────────────────────────────────────────────────────────────────────────

    /// <summary>A request body is read in ONE place, <c>BridgePipeHost.Body&lt;T&gt;</c>, with <c>WireJson.Request</c>
    /// (strict members, exact case, the push discriminator anywhere). No other code reads a request type or the strict
    /// options — a second reader is how "strict members on push only" happened.</summary>
    [Fact]
    public void A_request_body_is_read_only_by_the_host_strict_reader()
    {
        var strict = AllSource().Where(l => Regex.IsMatch(l.Code, @"\bWireJson\.Request\b", RegexOptions.CultureInvariant))
            .Select(l => l.File).Distinct().ToList();
        Assert.Equal(new[] { "Volt.Engine.Host/BridgePipeHost.cs" }, strict);

        var readers = AllSource()
            .Where(l => Regex.IsMatch(l.Code, @"Deserialize<(?!PipeRequest\b)\w*Request>", RegexOptions.CultureInvariant))
            .Select(l => $"{l.File}:{l.Line}").ToList();
        Assert.True(readers.Count == 0,
            "a request type read outside BridgePipeHost.Body<T> (the one strict reader):\n  " + string.Join("\n  ", readers));
    }

    /// <summary>
    /// EVERY OP READS ITS BODY THROUGH THE STRICT READER. wire.html promises BAD_REQUEST for "a body member the op does
    /// not have" on every op; an arm of <c>BridgePipeHost.Dispatch</c> that never calls <c>Body&lt;T&gt;</c> skips that
    /// rule for its op. Today: <c>health</c> and <c>disconnect</c> (the contract suite's finding: a member they do not
    /// have is answered, not refused). Pinned as <c>BridgePipeHost.cs#&lt;op&gt;</c>.
    /// </summary>
    [Fact]
    public void Every_op_arm_reads_its_body_strictly_ratchet()
    {
        var text = File.ReadAllText(Src("Volt.Engine.Host/BridgePipeHost.cs"));
        var dispatch = text.IndexOf("switch (req.Op)", StringComparison.Ordinal);
        Assert.True(dispatch >= 0, "BridgePipeHost.Dispatch's `switch (req.Op)` not found — did the dispatch move?");
        var body = text.Substring(dispatch);
        var arms = Regex.Matches(body, @"case Ops\.(\w+):", RegexOptions.CultureInvariant);
        Assert.True(arms.Count >= 8, $"only {arms.Count} op arms found in Dispatch");
        var actual = new SortedDictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < arms.Count; i++)
        {
            var end = i + 1 < arms.Count ? arms[i + 1].Index : body.IndexOf("default:", arms[i].Index, StringComparison.Ordinal);
            var arm = body.Substring(arms[i].Index, end - arms[i].Index);
            if (!arm.Contains("Body<", StringComparison.Ordinal))
                actual[$"Volt.Engine.Host/BridgePipeHost.cs#{arms[i].Groups[1].Value}"] = 1;
        }
        Ratchet.Hold("An op arm of BridgePipeHost.Dispatch that never reads its body through Body<T> (the strict reader).",
            UnreadBodyPins, actual,
            "Read the op's body through Body<T>, so a member it does not have is BAD_REQUEST as wire.html promises.");
    }

    // ── the protocol number beside the schema pin ────────────────────────────────────────────────────────────────────

    /// <summary>
    /// ONE PROTOCOL NUMBER, PINNED BESIDE THE SCHEMA. <c>WireProtocol.Version</c> is the only protocol constant in the
    /// source; the generated OpenRPC document's <c>info.version</c> states it; and <c>DocDataTests</c> pins it beside the
    /// hash of that document (<c>PinnedProtocol</c> next to <c>PinnedWireShape</c>), so a shape change cannot ship without
    /// its author deciding the number.
    /// </summary>
    [Fact]
    public void The_protocol_number_is_one_constant_pinned_beside_the_schema()
    {
        var declared = AllSource().Where(l => Regex.IsMatch(l.Code, @"\b(const|static readonly)\s+int\??\s+\w*Protocol\w*\s*=", RegexOptions.CultureInvariant))
            .Select(l => $"{l.File}:{l.Line}").ToList();
        Assert.True(declared.Count == 0, "a protocol constant beside WireProtocol.Version:\n  " + string.Join("\n  ", declared));

        var wp = File.ReadAllText(Src("Volt.Contracts/Wire/WireProtocol.cs"));
        var m = Regex.Match(wp, @"public const int Version = (\d+);", RegexOptions.CultureInvariant);
        Assert.True(m.Success, "WireProtocol.Version not found as `public const int Version = N;`");
        var version = m.Groups[1].Value;

        var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(RepoPaths.PackageDir().FullName, "docs", "volt-bridge.openrpc.json")));
        Assert.Equal(version, doc.RootElement.GetProperty("info").GetProperty("version").GetString());

        var dd = File.ReadAllLines(Path.Combine(RepoPaths.PackageDir().FullName, "test", "Volt.Engine.Tests", "docs", "DocDataTests.cs"));
        var pin = Array.FindIndex(dd, l => Regex.IsMatch(l, @"private const int PinnedProtocol = \d+;", RegexOptions.CultureInvariant));
        Assert.True(pin >= 0, "DocDataTests has no `PinnedProtocol` — the protocol is no longer pinned beside the schema hash");
        Assert.Contains($"PinnedProtocol = {version};", dd[pin], StringComparison.Ordinal);
        Assert.True(pin + 1 < dd.Length && dd[pin + 1].Contains("PinnedWireShape = \"", StringComparison.Ordinal),
            "DocDataTests' PinnedWireShape must stand on the line after PinnedProtocol: the number is pinned BESIDE the shape");
        Assert.Contains(dd, l => l.Contains("WireProtocol.Version == PinnedProtocol && hash == PinnedWireShape", StringComparison.Ordinal));
    }

    /// <summary>A protocol a bridge states that does NOT come from <c>WireProtocol.Version</c>: the test seam
    /// <c>BridgePipeHost(ide, pipe, int? protocol)</c>, which lets a test stand for a peer of another release. One site
    /// today; the mixed-version cell replaces what it stands for with a real previous release.</summary>
    [Fact]
    public void No_new_way_to_state_a_protocol_number_ratchet()
    {
        var seam = new Regex(@"\bint\?\s+protocol\b", RegexOptions.CultureInvariant);
        Ratchet.Hold("A protocol number a bridge can state other than WireProtocol.Version.", ProtocolSeamPins,
            SourceScan.CountPerFile(AllSource(), seam),
            "State WireProtocol.Version; a peer of another release is the mixed-version cell's job, not a constructor argument.");
    }

    // ── the error-code mapping ───────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// THE ERROR-CODE MAPPING is <c>PipeServer.Handle</c>: a coded exception (<c>ICodedError</c>) keeps its code, anything
    /// else is INTERNAL_ERROR. Every other place that inspects <c>ICodedError</c> or defaults a code to INTERNAL_ERROR
    /// decides the mapping again. Today's extra sites:
    /// <list type="bullet">
    /// <item><c>Sync/PushService.cs</c> — <c>ConflictFor</c> (a conflict's code: it ALSO maps <c>NotSupportedException</c> to
    /// UNSUPPORTED, which the frame mapping does not) and the create guard's UNREADABLE filter;</item>
    /// <item><c>Sync/BuildService.cs</c> — an uncoded build failure becomes a failed build, a coded one a frame;</item>
    /// <item><c>Ide/ItemLookup.cs</c> — an uncoded IDE read failure becomes ITEM_UNVERIFIED (7 sites);</item>
    /// <item><c>Ide/ProjectDeclarations.cs</c> — re-words an ITEM_UNVERIFIED;</item>
    /// <item><c>Volt.Relay/RelayTunnel.cs</c> — every failed relay call is INTERNAL_ERROR.</item>
    /// </list>
    /// <c>Volt.Contracts/ICodedError.cs</c> is the definition, not a site.
    /// </summary>
    [Fact]
    public void An_exception_is_mapped_to_a_wire_code_nowhere_new_ratchet()
    {
        var pipe = File.ReadAllText(Src("Volt.Wire/PipeServer.cs"));
        Assert.Contains("if (ex is ICodedError coded) { code = coded.ErrorCode;", pipe, StringComparison.Ordinal);
        Assert.Contains("code = BridgeErrorCodes.InternalError;", pipe, StringComparison.Ordinal);

        var site = new Regex(@"\bICodedError\b|\b\w+\s*=\s*BridgeErrorCodes\.InternalError\s*;|:\s*BridgeErrorCodes\.InternalError\)",
            RegexOptions.CultureInvariant);
        var actual = SourceScan.CountPerFile(AllSource().Where(l => l.File != "Volt.Contracts/ICodedError.cs"), site);
        Ratchet.Hold("An exception mapped to a wire error code outside PipeServer.Handle.", ErrorMappingPins, actual,
            "Let the coded exception reach PipeServer (or the push's one conflict mapping) instead of deciding a code here.");
    }

    /// <summary>A wire error code is spelled once, in <c>Volt.Contracts/Vocabulary</c>; a string literal of one elsewhere is a
    /// second definition. The one site today is not a code: <c>ImplementationMarker.UnsupportedWord</c> is the
    /// <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c> keyword of the file format, which spells the same word.</summary>
    [Fact]
    public void A_wire_error_code_is_spelled_only_in_the_vocabulary_ratchet()
    {
        var vocab = Path.Combine(SourceScan.SrcDir(), "Volt.Contracts", "Vocabulary");
        var codes = new[] { "BridgeErrorCodes.cs", "ConflictCodes.cs" }.Select(f => Path.Combine(vocab, f))
            .SelectMany(f => Regex.Matches(File.ReadAllText(f), @"public const string \w+ = ""([A-Z_]+)"";", RegexOptions.CultureInvariant))
            .Select(m => m.Groups[1].Value).Distinct(StringComparer.Ordinal).ToList();
        Assert.True(codes.Count >= 15, $"only {codes.Count} codes read from Contracts/Vocabulary");
        var literal = new Regex("\"(" + string.Join("|", codes.Select(Regex.Escape)) + ")\"", RegexOptions.CultureInvariant);
        var actual = SourceScan.CountPerFile(AllSource().Where(l => !l.File.StartsWith("Volt.Contracts/Vocabulary/", StringComparison.Ordinal)), literal);
        Ratchet.Hold("A wire error code spelled as a string literal outside Volt.Contracts/Vocabulary.", CodeLiteralPins, actual,
            "Use the BridgeErrorCodes/ConflictCodes constant.");
    }

    // ── the pins (2026-10-22). Lower a pin in the commit that removes a site; a file at 0 leaves the table. ─────────────

    /// <summary>Every site is an extra site: the one comparer does not exist yet. <c>Item/ItemPath.cs</c>'s
    /// <c>IsUnder</c> (segment-wise, ignoring case) is the nearest thing to it; <c>PushService.cs</c> holds half of them
    /// (bare names <c>Ordinal</c>, the op cache and the one-op-per-item rule <c>OrdinalIgnoreCase</c>, map E6).</summary>
    private static readonly Dictionary<string, int> PathComparerPins = new(StringComparer.Ordinal)
    {
        ["Volt.Engine.Host/BridgePipeHost.cs"] = 1,
        ["Volt.Engine.Host/SingleFlight.cs"] = 1,   // keys a running refs by its REQUEST BODY, not a path
        ["Volt.Engine/Ide/BothVendorsRefusedNames.cs"] = 1,
        ["Volt.Engine/Ide/BridgeLog.cs"] = 1,
        ["Volt.Engine/Ide/ItemLookup.cs"] = 3,
        ["Volt.Engine/Ide/MeasuredNames.cs"] = 1,
        ["Volt.Engine/Ide/ProjectDeclarations.cs"] = 2,
        ["Volt.Engine/Ide/PushedDeclarations.cs"] = 2,
        ["Volt.Engine/Ide/SourceScopes.cs"] = 1,
        ["Volt.Engine/Ide/TreeNav.cs"] = 4,
        ["Volt.Engine/Item/ItemKind.cs"] = 4,
        ["Volt.Engine/Item/ItemPath.cs"] = 2,
        ["Volt.Engine/Sync/BuildService.cs"] = 6,
        ["Volt.Engine/Sync/FetchService.cs"] = 2,
        ["Volt.Engine/Sync/GrepService.cs"] = 4,
        ["Volt.Engine/Sync/Hasher.cs"] = 1,
        ["Volt.Engine/Sync/Materializer.cs"] = 1,
        ["Volt.Engine/Sync/OpGuard.cs"] = 2,
        ["Volt.Engine/Sync/ProjectSnapshot.cs"] = 3,
        ["Volt.Engine/Sync/PushConflicts.cs"] = 2,
        ["Volt.Engine/Sync/PushService.cs"] = 55,
        ["Volt.Engine/Sync/PushedText.cs"] = 2,
        ["Volt.Engine/Sync/Removal.cs"] = 5,
        ["Volt.Engine/Sync/SnapshotClock.cs"] = 1,   // per-application timing for the refs log line only; no identity decision
        ["Volt.Engine/Sync/Versioning.cs"] = 1,
    };

    /// <summary>Where each extra join is: see <see cref="A_wire_path_is_minted_beside_the_minter_nowhere_new_ratchet"/>.</summary>
    private static readonly Dictionary<string, int> ItemPathOfPins = new(StringComparer.Ordinal)
    {
        ["Volt.Engine/Library/LibraryFetch.cs"] = 2,
        ["Volt.Engine/Sync/BuildService.cs"] = 1,
        ["Volt.Engine/Sync/PushService.cs"] = 3,
        ["Volt.Engine/Sync/Versioning.cs"] = 2,
        ["Volt.Ide.Codesys/Driver/CodesysDriver.cs"] = 2,
        ["Volt.Ide.Twincat/Driver/BeckhoffDriver.cs"] = 1,
    };

    private static readonly Dictionary<string, int> MinterUpReachPins = new(StringComparer.Ordinal)
    {
        ["Volt.Ide.Twincat/Driver/BeckhoffDriver.Tree.cs"] = 1,
    };

    /// <summary><c>health</c> and <c>disconnect</c> answer a body they never read (the contract suite's finding).</summary>
    private static readonly Dictionary<string, int> UnreadBodyPins = new(StringComparer.Ordinal)
    {
        ["Volt.Engine.Host/BridgePipeHost.cs#Disconnect"] = 1,
        ["Volt.Engine.Host/BridgePipeHost.cs#Health"] = 1,
    };

    private static readonly Dictionary<string, int> ProtocolSeamPins = new(StringComparer.Ordinal)
    {
        ["Volt.Engine.Host/BridgePipeHost.cs"] = 1,
    };

    /// <summary><c>Volt.Wire/PipeServer.cs</c>'s 2 are the one implementation; the rest are the extra sites listed on
    /// <see cref="An_exception_is_mapped_to_a_wire_code_nowhere_new_ratchet"/>.</summary>
    private static readonly Dictionary<string, int> ErrorMappingPins = new(StringComparer.Ordinal)
    {
        ["Volt.Engine/Ide/ItemLookup.cs"] = 7,
        ["Volt.Engine/Ide/ProjectDeclarations.cs"] = 1,
        ["Volt.Engine/Sync/BuildService.cs"] = 1,
        ["Volt.Engine/Sync/PushService.cs"] = 3,
        ["Volt.Relay/RelayTunnel.cs"] = 1,
        ["Volt.Wire/PipeServer.cs"] = 2,
    };

    private static readonly Dictionary<string, int> CodeLiteralPins = new(StringComparer.Ordinal)
    {
        ["Volt.Engine/Format/St/ImplementationMarker.cs"] = 1,
        // The IMPLEMENTATION line's own word UNSUPPORTED, spelled like the code as ImplementationMarker's is: the new
        // contract's line grammar (volt-cli-rework step 3), which replaces that one in step 7.
        ["Volt.Engine/Seam/LanguageRegistry.cs"] = 1,
    };
}
