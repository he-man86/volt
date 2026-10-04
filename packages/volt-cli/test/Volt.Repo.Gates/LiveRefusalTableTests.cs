using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// EVERY WIRE CODE HAS ITS LIVE ROW (openspec <c>bridge-refusal-review</c> 8.3, beside V.4's <see cref="WireVocabularyTests"/>).
///
/// <para>V.4 holds each code to one situation, raised and documented. This holds each code to a LIVE trigger: the negative
/// matrix <c>test/e2e/refusals/table.ts</c> drives one minimal trigger per code against both fixture IDEs (8.1), and a code
/// that is only ever proven by an offline double has not been shown to be what a real IDE answers. So every code a client
/// can receive (every <c>BridgeErrorCodes</c> / <c>ConflictCodes</c> constant; <c>&lt;project&gt;</c> is a conflict NAME,
/// not a code) must have exactly one row there.</para>
///
/// <para>A row is either live (<c>live: true</c>) or says why no live trigger exists (<c>live: false</c> + a
/// <c>reason</c>). The codes allowed to have no live row are pinned below, each with the reason the table gives — so a code
/// ADDED later fails until it has a live row, and moving an existing code off its live row fails too. The NETWORK_* codes
/// are not live by the owner's decision (2026-10-03: live network-text tests wait for the LD/FBD design) and must say so
/// with the table's <c>DEFERRED_LD_FBD</c> prefix. Rejected: reading the e2e suite for any mention of a code (a code in a
/// comment or an <c>expect(...).not</c> proves nothing) and running the matrix here (it needs two live IDEs).</para>
/// </summary>
public class LiveRefusalTableTests
{
    /// <summary>The codes with no live trigger, measured 2026-10-04 (table.ts says why for each). Shrinks only.</summary>
    private static readonly HashSet<string> NoLiveTrigger = new(StringComparer.Ordinal)
    {
        "IDE_UNSUPPORTED",   // an IDE below the minimum; both fixture IDEs meet it
        "IDE_SAVE_FAILED",   // TwinCAT SaveAll refusal: only reachable through a modal dialog; CODESYS saves nothing
        "INTERNAL_ERROR",    // Volt's own broken invariant: a live trigger IS a bug
        "IDE_LOST_ITEM",     // a post-condition: a healthy IDE does not lose what it just took
        "ITEM_UNVERIFIED",   // an enumeration the IDE refuses; neither fixture refuses one without crashing XAE
    };

    /// <summary>The live rows that pin one vendor's DIFFERENT answer (table.ts <c>divergence</c>, as
    /// <c>vendor:CODE</c>) — each an irreducible vendor fact LISTED FOR THE OWNER (8.4), never accepted by an agent.
    /// A row's code is proven live only on the vendor that answers it, so a new divergence fails here until the owner
    /// lists it, and one that is taken off (the vendors converged) must leave this list. Shrinks only.</summary>
    private static readonly Dictionary<string, string> PinnedDivergence = new(StringComparer.Ordinal)
    {
        ["UNREADABLE"] = "codesys:ITEM_EXISTS", // DIALECT C2i: TwinCAT stores no POU type; listed for the owner (8.4 (1))
    };

    private const string Deferred = "DEFERRED_LD_FBD";

    [Fact]
    public void Every_client_visible_code_has_one_row_in_the_live_refusal_table()
    {
        var root = NoCodeCheckLeftTests.RepoRoot();
        var cli = Path.Combine(root, "packages", "volt-cli");
        var contracts = Path.Combine(cli, "src", "Volt.Contracts", "Vocabulary");
        var codes = WireVocabularyTests.Consts(File.ReadAllText(Path.Combine(contracts, "BridgeErrorCodes.cs")), "BridgeErrorCodes")
            .Concat(WireVocabularyTests.Consts(File.ReadAllText(Path.Combine(contracts, "ConflictCodes.cs")), "ConflictCodes"))
            .Select(c => c.Code).ToList();
        Assert.True(codes.Count >= 20, $"only {codes.Count} code constant(s) read — the gate is not reading Contracts.");

        var table = File.ReadAllText(Path.Combine(cli, "test", "e2e", "refusals", "table.ts"));
        var findings = Findings(codes, Rows(table));
        Assert.True(findings.Count == 0,
            "The live negative matrix (openspec bridge-refusal-review 8.1/8.3, test/e2e/refusals/table.ts) — every wire " +
            "code has one row, live unless listed:\n  " + string.Join("\n  ", findings));
    }

    /// <summary>One row of the table as the gate reads it.</summary>
    internal sealed record Row(string Code, bool Live, string? Reason, string? Divergence = null);

    /// <summary>The rows of <c>ROWS</c>: each opens with <c>code: "X",</c> followed by <c>live: true|false</c>; a non-live
    /// row's <c>reason</c> is the first <c>reason:</c> before the next row (its text, or the template's leading
    /// <c>${DEFERRED_LD_FBD}</c>).</summary>
    internal static List<Row> Rows(string table)
    {
        var start = table.IndexOf("export const ROWS", StringComparison.Ordinal);
        Assert.True(start >= 0, "table.ts has no `export const ROWS` — the gate cannot read the matrix.");
        var body = table.Substring(start);
        var heads = Regex.Matches(body, @"code:\s*""([A-Z_]+)"",\s*live:\s*(true|false)");
        var rows = new List<Row>();
        for (var i = 0; i < heads.Count; i++)
        {
            var end = i + 1 < heads.Count ? heads[i + 1].Index : body.Length;
            var chunk = body.Substring(heads[i].Index, end - heads[i].Index);
            var reason = Regex.Match(chunk, @"reason:\s*(?:`\$\{(\w+)\}|""([^""]*)""|`([^`]*)`)");
            var text = !reason.Success ? null
                : reason.Groups[1].Success ? reason.Groups[1].Value
                : reason.Groups[2].Success ? reason.Groups[2].Value : reason.Groups[3].Value;
            var diverges = Regex.Match(chunk, @"\bdivergence:\s*\{\s*vendor:\s*""(\w+)"",\s*answers:\s*""([A-Z_]+)""");
            rows.Add(new Row(heads[i].Groups[1].Value, heads[i].Groups[2].Value == "true", text,
                             diverges.Success ? $"{diverges.Groups[1].Value}:{diverges.Groups[2].Value}" : null));
        }
        return rows;
    }

    internal static List<string> Findings(IReadOnlyCollection<string> codes, IReadOnlyList<Row> rows)
    {
        var findings = new List<string>();
        foreach (var code in codes)
        {
            var mine = rows.Where(r => r.Code == code).ToList();
            if (mine.Count == 0) { findings.Add($"{code}: no row — add its minimal live trigger to test/e2e/refusals/table.ts"); continue; }
            if (mine.Count > 1) { findings.Add($"{code}: {mine.Count} rows — one trigger per code"); continue; }
            var row = mine[0];
            var network = code.StartsWith("NETWORK_", StringComparison.Ordinal);
            if (network)
            {
                if (row.Live || row.Reason != Deferred)
                    findings.Add($"{code}: a NETWORK_* row is `live: false` with the reason `${{{Deferred}}} …` until the LD/FBD design lands (owner, 2026-10-03)");
                continue;
            }
            PinnedDivergence.TryGetValue(code, out var pinned);
            if (row.Divergence != null && row.Divergence != pinned)
                findings.Add($"{code}: a divergence ({row.Divergence}) the owner has not listed — a vendor answering " +
                             "differently is a defect below the seam (8.4); fix the driver, or list it for the owner");
            else if (row.Divergence == null && pinned != null)
                findings.Add($"{code}: no longer diverges — take it off this gate's pinned-divergence list");
            if (row.Live) continue;
            if (!NoLiveTrigger.Contains(code))
                findings.Add($"{code}: has no live row — a code added (or moved off its live row) needs a live trigger; only " +
                             string.Join(", ", NoLiveTrigger.OrderBy(c => c, StringComparer.Ordinal)) + " may say why there is none");
            else if (string.IsNullOrWhiteSpace(row.Reason))
                findings.Add($"{code}: `live: false` without a `reason` — say why no live trigger exists");
        }
        foreach (var row in rows.Where(r => !codes.Contains(r.Code)))
            findings.Add($"{row.Code}: a row for a code the vocabulary does not have");
        foreach (var code in NoLiveTrigger.Where(c => rows.Any(r => r.Code == c && r.Live)))
            findings.Add($"{code}: now has a live row — take it off this gate's no-live-trigger list");
        return findings;
    }

    // ── the gate's own teeth ─────────────────────────────────────────────────────────────────────────────────────

    private const string Table = """
        export const ROWS: Row[] = [
            {
                code: "BAD_REQUEST",
                live: true,
                trigger: "x",
            },
            { code: "INTERNAL_ERROR", live: false, reason: "a live trigger is a bug" },
            { code: "NETWORK_PARSE", live: false, reason: `${DEFERRED_LD_FBD} — y` },
            // more
        ]
        """;

    [Fact]
    public void The_reader_reads_live_and_non_live_rows_with_their_reasons() =>
        Assert.Equal(new[] { new Row("BAD_REQUEST", true, null), new Row("INTERNAL_ERROR", false, "a live trigger is a bug"),
                             new Row("NETWORK_PARSE", false, Deferred) }, Rows(Table));

    [Fact]
    public void A_matching_table_is_no_finding() =>
        Assert.Empty(Findings(new[] { "BAD_REQUEST", "INTERNAL_ERROR", "NETWORK_PARSE" }, Rows(Table)));

    [Fact]
    public void A_code_added_without_a_row_fails() =>
        Assert.Contains(Findings(new[] { "BAD_REQUEST", "INTERNAL_ERROR", "NETWORK_PARSE", "NEW_CODE" }, Rows(Table)),
                        f => f.StartsWith("NEW_CODE: no row", StringComparison.Ordinal));

    [Fact]
    public void A_code_added_with_a_non_live_row_fails() =>
        Assert.Contains(Findings(new[] { "BAD_REQUEST", "INTERNAL_ERROR", "NETWORK_PARSE", "NEW_CODE" },
                                 Rows(Table.Replace("// more", "{ code: \"NEW_CODE\", live: false, reason: \"later\" },"))),
                        f => f.StartsWith("NEW_CODE: has no live row", StringComparison.Ordinal));

    [Fact]
    public void A_live_code_moved_off_its_live_row_fails() =>
        Assert.Contains(Findings(new[] { "BAD_REQUEST", "INTERNAL_ERROR", "NETWORK_PARSE" },
                                 Rows(Table.Replace("live: true,", "live: false, reason: \"hard\","))),
                        f => f.StartsWith("BAD_REQUEST: has no live row", StringComparison.Ordinal));

    [Fact]
    public void A_network_code_without_the_deferral_fails() =>
        Assert.Contains(Findings(new[] { "BAD_REQUEST", "INTERNAL_ERROR", "NETWORK_PARSE" },
                                 Rows(Table.Replace("`${DEFERRED_LD_FBD} — y`", "\"not now\""))),
                        f => f.StartsWith("NETWORK_PARSE:", StringComparison.Ordinal));

    [Fact]
    public void A_row_for_no_code_and_a_duplicate_row_fail()
    {
        var f = Findings(new[] { "BAD_REQUEST", "INTERNAL_ERROR", "NETWORK_PARSE" },
                         Rows(Table.Replace("// more", "{ code: \"GONE\", live: true },\n{ code: \"BAD_REQUEST\", live: true },")));
        Assert.Contains(f, x => x.StartsWith("GONE:", StringComparison.Ordinal));
        Assert.Contains(f, x => x.StartsWith("BAD_REQUEST: 2 rows", StringComparison.Ordinal));
    }

    [Fact]
    public void A_listed_code_that_gained_a_live_row_must_leave_the_list() =>
        Assert.Contains(Findings(new[] { "BAD_REQUEST", "INTERNAL_ERROR", "NETWORK_PARSE" },
                                 Rows(Table.Replace("{ code: \"INTERNAL_ERROR\", live: false, reason: \"a live trigger is a bug\" }",
                                                    "{ code: \"INTERNAL_ERROR\", live: true }"))),
                        f => f.StartsWith("INTERNAL_ERROR: now has a live row", StringComparison.Ordinal));

    [Fact]
    public void A_divergence_not_listed_for_the_owner_fails() =>
        Assert.Contains(Findings(new[] { "BAD_REQUEST", "INTERNAL_ERROR", "NETWORK_PARSE" },
                                 Rows(Table.Replace("trigger: \"x\",",
                                                    "trigger: \"x\",\n divergence: { vendor: \"twincat\", answers: \"ITEM_MISSING\", why: \"x\" },"))),
                        f => f.StartsWith("BAD_REQUEST: a divergence", StringComparison.Ordinal));

    [Fact]
    public void The_reader_reads_a_divergence() =>
        Assert.Equal(new Row("BAD_REQUEST", true, null, "codesys:ITEM_EXISTS"),
                     Rows(Table.Replace("trigger: \"x\",",
                                        "trigger: \"x\",\n divergence: {\n vendor: \"codesys\",\n answers: \"ITEM_EXISTS\",\n why: \"x\" },"))[0]);

    [Fact]
    public void The_listed_divergence_is_no_finding_and_dropping_it_must_leave_the_list()
    {
        var codes = new[] { "UNREADABLE" };
        const string listed = "export const ROWS: Row[] = [\n{\n code: \"UNREADABLE\",\n live: true,\n" +
                              " divergence: { vendor: \"codesys\", answers: \"ITEM_EXISTS\", why: \"w\" },\n},\n]";
        Assert.Empty(Findings(codes, Rows(listed)));
        Assert.Contains(Findings(codes, Rows(listed.Replace("answers: \"ITEM_EXISTS\"", "answers: \"ITEM_MISSING\""))),
                        f => f.StartsWith("UNREADABLE: a divergence", StringComparison.Ordinal));
        Assert.Contains(Findings(codes, Rows(listed.Replace("divergence:", "noDivergence:"))),
                        f => f.StartsWith("UNREADABLE: no longer diverges", StringComparison.Ordinal));
    }
}
