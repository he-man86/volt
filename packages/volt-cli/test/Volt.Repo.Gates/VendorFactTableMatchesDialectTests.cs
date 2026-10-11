using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// EVERY RE-MEASURABLE VENDOR FACT IS PROBED, AND THE PROBE CITES ONLY WHAT DIALECT MARKS (openspec
/// <c>vendor-fact-probe</c> 1.1).
///
/// <para>A <c>DIALECT.md</c> row whose id cell carries <c>[PROBE: &lt;fact-id&gt;]</c> is a vendor fact the one probe
/// (<c>scripts/vendor-facts.ts</c>) re-measures, and each row of its table (<c>scripts/vendor-facts.table.ts</c>) names
/// the DIALECT rows it backs (<c>dialect: ["C2e", …]</c>). The gate builds the pair set <c>{(dialectId, factId)}</c> from
/// both files and asserts they are EQUAL, naming each side's extras. Equality is stronger than "marker → row" plus "row →
/// existing id": it also refuses a table row citing a DIALECT row that does not carry its marker. Further, by name: table
/// ids are unique, every table row cites at least one row, a cited id exists, and a marker never sits on a retracted
/// (<c>~~id~~</c>) row — a withdrawn fact is not re-measurable.</para>
///
/// <para>Both files are read as TEXT (no Repo.Gate starts a process). The table keeps one literal shape per row inside
/// <c>export const ROWS</c>: <c>id: "&lt;kebab&gt;"</c> and <c>dialect: ["Id", …]</c>, no computed ids, no spreads. Every
/// <c>id:</c> / <c>dialect:</c> the parse does not read in that shape is a finding, so a table edit the parse would
/// silently skip fails here instead. Likewise a DIALECT id cell that mentions <c>PROBE</c> in any other spelling or case,
/// and a <c>[PROBE</c> marker in any cell but the id cell. Those DIALECT-only findings are reported even while the table
/// is missing (until 2.1), so a marker mistake does not hide behind that red.</para>
/// </summary>
public class VendorFactTableMatchesDialectTests
{
    private const string TableRel = "packages/volt-cli/scripts/vendor-facts.table.ts";
    private const string DialectRel = "packages/volt-cli/src/Volt.Engine/Ide/DIALECT.md";

    [Fact]
    public void The_probe_table_and_the_DIALECT_markers_name_the_same_facts()
    {
        var root = NoCodeCheckLeftTests.RepoRoot();
        var dialectPath = Path.Combine(root, DialectRel);
        var tablePath = Path.Combine(root, TableRel);
        Assert.True(File.Exists(dialectPath), $"{DialectRel} not found — the gate cannot read the markers.");

        var dialect = Dialect(File.ReadAllText(dialectPath));
        Assert.True(dialect.Ids.Count >= 100, $"only {dialect.Ids.Count} DIALECT row id(s) read — the gate is not reading DIALECT.md.");
        Assert.True(dialect.Markers.Count > 0, "no [PROBE: …] marker read from DIALECT.md — the gate is not reading the markers.");
        // The DIALECT half is checked even while the table is missing: a marker mistake must not hide behind that red.
        Assert.True(File.Exists(tablePath), MissingTableMessage(dialect));

        var findings = Findings(dialect, Table(File.ReadAllText(tablePath)));
        Assert.True(findings.Count == 0,
            $"The vendor-fact probe table ({TableRel}) and the [PROBE: …] markers in {DialectRel} must name the same " +
            "(DIALECT row, fact) pairs (openspec vendor-fact-probe 1.1):\n  " + string.Join("\n  ", findings));
    }

    // ── the reads ────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>What DIALECT.md says: every row id, the retracted ones, every <c>(id, fact)</c> marker pair, and the id
    /// cells that mention PROBE (any case) in a spelling the reader does not take, or a marker outside the id cell.</summary>
    internal sealed record DialectRead(HashSet<string> Ids, HashSet<string> Retracted, List<(string Id, string Fact)> Markers,
                                       List<string> Malformed);

    /// <summary>One table row: its fact id and the DIALECT ids it cites. <see cref="Error"/> names a row the strict
    /// parse could not read.</summary>
    internal sealed record TableRow(string Fact, List<string> Dialect, string? Error = null);

    private static readonly Regex IdCell = new(
        @"^(\*\*)?(~~)?(?<id>[A-DNV]\d+[a-z]?)(~~)?(\*\*)?(?<markers>(?:\s*\[PROBE: [a-z0-9-]+\])*)$", RegexOptions.CultureInvariant);
    private static readonly Regex Marker = new(@"\[PROBE: ([a-z0-9-]+)\]", RegexOptions.CultureInvariant);

    internal static DialectRead Dialect(string md)
    {
        var read = new DialectRead(new(StringComparer.Ordinal), new(StringComparer.Ordinal), new(), new());
        foreach (var raw in md.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (!line.StartsWith("|", StringComparison.Ordinal)) continue;
            var bar = line.IndexOf('|', 1);
            if (bar < 0) continue;
            var cell = line.Substring(1, bar - 1).Trim();
            var m = IdCell.Match(cell);
            if (!m.Success)
            {
                if (cell.Contains("PROBE", StringComparison.OrdinalIgnoreCase))
                    read.Malformed.Add($"DIALECT id cell `{cell}`: a PROBE marker not in the spelling `| **<id>** [PROBE: <kebab-fact-id>] |`");
                continue;
            }
            var id = m.Groups["id"].Value;
            read.Ids.Add(id);
            if (line.Substring(bar).Contains("[PROBE", StringComparison.OrdinalIgnoreCase))
                read.Malformed.Add($"DIALECT {id}: a [PROBE: …] marker outside the id cell — the reader takes markers only from `| **<id>** [PROBE: <kebab-fact-id>] |`");
            if (cell.Contains("~~", StringComparison.Ordinal)) read.Retracted.Add(id);
            foreach (Match k in Marker.Matches(m.Groups["markers"].Value)) read.Markers.Add((id, k.Groups[1].Value));
        }
        return read;
    }

    private static readonly Regex RowId = new(@"\bid:\s*""(?<fact>[a-z0-9]+(?:-[a-z0-9]+)*)""", RegexOptions.CultureInvariant);
    private static readonly Regex AnyId = new(@"\bid:", RegexOptions.CultureInvariant);
    private static readonly Regex RowDialect = new(
        @"\bdialect:\s*\[\s*(?<ids>(?:""[A-DNV]\d+[a-z]?""\s*,\s*)*(?:""[A-DNV]\d+[a-z]?""\s*,?\s*)?)\]", RegexOptions.CultureInvariant);
    private static readonly Regex AnyDialect = new(@"\bdialect:", RegexOptions.CultureInvariant);

    /// <summary>The rows of <c>export const ROWS</c>: each opens at <c>id: "&lt;kebab&gt;"</c> and holds exactly one
    /// <c>dialect: [ "Id", … ]</c> before the next row opens.</summary>
    internal static List<TableRow> Table(string ts)
    {
        var start = ts.IndexOf("export const ROWS", StringComparison.Ordinal);
        if (start < 0) return new() { new TableRow("?", new(), "the table has no `export const ROWS` — the gate cannot read its rows") };
        var body = ts.Substring(start);
        var rows = new List<TableRow>();
        var heads = RowId.Matches(body);
        if (AnyId.Matches(body).Count != heads.Count)
            rows.Add(new TableRow("?", new(), $"{AnyId.Matches(body).Count} `id:` in ROWS but {heads.Count} in the literal shape " +
                                              "`id: \"<kebab>\"` — a computed or misspelt id the gate cannot read"));
        if (heads.Count > 0 && AnyDialect.IsMatch(body.Substring(0, heads[0].Index)))
            rows.Add(new TableRow("?", new(), "a `dialect:` before the first row's `id:` — every row opens with its id"));
        for (var i = 0; i < heads.Count; i++)
        {
            var fact = heads[i].Groups["fact"].Value;
            var end = i + 1 < heads.Count ? heads[i + 1].Index : body.Length;
            var chunk = body.Substring(heads[i].Index, end - heads[i].Index);
            var any = AnyDialect.Matches(chunk).Count;
            var lists = RowDialect.Matches(chunk);
            if (any != 1 || lists.Count != 1)
            {
                rows.Add(new TableRow(fact, new(), any == 0 ? "no `dialect:`"
                    : any > 1 ? $"{any} `dialect:` — one per row"
                    : "a `dialect:` not in the literal shape `dialect: [\"C2e\", …]`"));
                continue;
            }
            var ids = Regex.Matches(lists[0].Groups["ids"].Value, @"""([^""]+)""").Select(x => x.Groups[1].Value).ToList();
            rows.Add(new TableRow(fact, ids));
        }
        return rows;
    }

    /// <summary>The red for a missing table, carrying every finding DIALECT.md alone already gives.</summary>
    internal static string MissingTableMessage(DialectRead dialect)
    {
        var findings = DialectFindings(dialect);
        return findings.Count == 0 ? "vendor-facts.table.ts not found (task 2.1)"
            : "vendor-facts.table.ts not found (task 2.1); DIALECT.md alone already fails:\n  " + string.Join("\n  ", findings);
    }

    /// <summary>The findings that need no table: malformed markers and markers on retracted rows.</summary>
    internal static List<string> DialectFindings(DialectRead dialect)
    {
        var findings = new List<string>(dialect.Malformed);
        foreach (var (id, fact) in dialect.Markers.Where(p => dialect.Retracted.Contains(p.Id)))
            findings.Add($"DIALECT {id} [PROBE: {fact}]: the row is retracted — a withdrawn fact is not re-measurable; drop the marker");
        return findings;
    }

    // ── the comparison ───────────────────────────────────────────────────────────────────────────────────────────

    internal static List<string> Findings(DialectRead dialect, IReadOnlyList<TableRow> table)
    {
        var findings = DialectFindings(dialect);
        foreach (var row in table.Where(r => r.Error != null))
            findings.Add($"table row `{row.Fact}`: {row.Error}");
        var rows = table.Where(r => r.Error == null).ToList();

        foreach (var dup in rows.GroupBy(r => r.Fact, StringComparer.Ordinal).Where(g => g.Count() > 1))
            findings.Add($"table row `{dup.Key}`: {dup.Count()} rows with that id — one row per fact");
        foreach (var row in rows.Where(r => r.Dialect.Count == 0))
            findings.Add($"table row `{row.Fact}`: cites no DIALECT row — every probed fact backs one");
        foreach (var row in rows)
            foreach (var id in row.Dialect.Where(id => !dialect.Ids.Contains(id)))
                findings.Add($"table row `{row.Fact}`: cites DIALECT {id}, which DIALECT.md does not have");

        var marked = dialect.Markers.Select(p => (p.Id, p.Fact)).ToHashSet();
        var cited = rows.SelectMany(r => r.Dialect.Select(id => (Id: id, r.Fact))).ToHashSet();
        foreach (var (id, fact) in marked.Except(cited).OrderBy(p => p.Id, StringComparer.Ordinal).ThenBy(p => p.Fact, StringComparer.Ordinal))
            findings.Add(rows.Any(r => r.Fact == fact)
                ? $"DIALECT {id} [PROBE: {fact}]: table row `{fact}` does not cite {id} — add it to its `dialect:`"
                : $"DIALECT {id} [PROBE: {fact}]: no table row `{fact}` — a marked fact must be probed (add the row)");
        foreach (var (id, fact) in cited.Except(marked).Where(p => dialect.Ids.Contains(p.Id))
                     .OrderBy(p => p.Fact, StringComparer.Ordinal).ThenBy(p => p.Id, StringComparer.Ordinal))
            findings.Add($"table row `{fact}`: cites DIALECT {id}, which carries no [PROBE: {fact}] marker — mark the row, or drop the citation");
        return findings;
    }

    // ── the gate's own teeth ─────────────────────────────────────────────────────────────────────────────────────

    // Synthetic rows use N-ids (N903, N999 — ids DIALECT.md does not have) on purpose: `bun run check` reads every
    // `DIALECT <A–D id>` in this tree as a real citation, and these rows are not in DIALECT.md.
    private const string Md = """
        | id | fact |
        |---|---|
        | **C2e** [PROBE: dut-subtype-in-place] [PROBE: kind-source] | a |
        | **C2g** [PROBE: kind-source] | b |
        | **N903** | c |
        | ~~D9~~ | gone |
        | **V1** [PROBE: ide-identity] | d |
        """;

    private const string Ts = """
        export type Row = { id: string; dialect: string[] }
        export const ROWS: Row[] = [
            {
                id: "dut-subtype-in-place",
                dialect: ["C2e"],
                steps: [],
            },
            { id: "kind-source", dialect: ["C2e", "C2g"], steps: [] },
            {
                id: "ide-identity",
                dialect: [
                    "V1",
                ],
            },
            // more
        ]
        """;

    private static List<string> Run(string md, string ts) => Findings(Dialect(md), Table(ts));

    [Fact]
    public void The_readers_read_markers_ids_and_rows()
    {
        var d = Dialect(Md);
        Assert.Equal(new[] { ("C2e", "dut-subtype-in-place"), ("C2e", "kind-source"), ("C2g", "kind-source"), ("V1", "ide-identity") },
                     d.Markers.ToArray());
        Assert.Equal(new[] { "C2e", "C2g", "D9", "N903", "V1" }, d.Ids.OrderBy(x => x, StringComparer.Ordinal));
        Assert.Equal(new[] { "D9" }, d.Retracted);
        Assert.Equal(new[] { "dut-subtype-in-place:C2e", "kind-source:C2e,C2g", "ide-identity:V1" },
                     Table(Ts).Select(r => $"{r.Fact}:{string.Join(",", r.Dialect)}"));
    }

    [Fact]
    public void Equal_pair_sets_are_no_finding() => Assert.Empty(Run(Md, Ts));

    [Fact]
    public void A_marked_row_without_a_table_row_fails() =>
        Assert.Contains(Run(Md.Replace("| **N903** |", "| **N903** [PROBE: new-fact] |"), Ts),
                        f => f.StartsWith("DIALECT N903 [PROBE: new-fact]: no table row", StringComparison.Ordinal));

    [Fact]
    public void A_marked_row_its_table_row_does_not_cite_fails() =>
        Assert.Contains(Run(Md, Ts.Replace("dialect: [\"C2e\", \"C2g\"]", "dialect: [\"C2e\"]")),
                        f => f.StartsWith("DIALECT C2g [PROBE: kind-source]: table row `kind-source` does not cite C2g", StringComparison.Ordinal));

    [Fact]
    public void A_table_row_citing_a_missing_id_fails() =>
        Assert.Contains(Run(Md, Ts.Replace("[\"C2e\", \"C2g\"]", "[\"C2e\", \"C2g\", \"N999\"]")),
                        f => f == "table row `kind-source`: cites DIALECT N999, which DIALECT.md does not have");

    [Fact]
    public void A_table_row_citing_an_unmarked_row_fails() =>
        Assert.Contains(Run(Md, Ts.Replace("[\"C2e\", \"C2g\"]", "[\"C2e\", \"C2g\", \"N903\"]")),
                        f => f.StartsWith("table row `kind-source`: cites DIALECT N903, which carries no [PROBE: kind-source] marker", StringComparison.Ordinal));

    [Fact]
    public void A_duplicate_table_id_fails() =>
        Assert.Contains(Run(Md, Ts.Replace("// more", "{ id: \"kind-source\", dialect: [\"C2g\"] },")),
                        f => f == "table row `kind-source`: 2 rows with that id — one row per fact");

    [Fact]
    public void A_row_citing_nothing_fails() =>
        Assert.Contains(Run(Md, Ts.Replace("// more", "{ id: \"orphan\", dialect: [] },")),
                        f => f.StartsWith("table row `orphan`: cites no DIALECT row", StringComparison.Ordinal));

    [Fact]
    public void A_marker_on_a_retracted_row_fails() =>
        Assert.Contains(Run(Md.Replace("| ~~D9~~ |", "| ~~D9~~ [PROBE: gone-fact] |"),
                            Ts.Replace("// more", "{ id: \"gone-fact\", dialect: [\"D9\"] },")),
                        f => f.StartsWith("DIALECT D9 [PROBE: gone-fact]: the row is retracted", StringComparison.Ordinal));

    [Fact]
    public void A_row_the_strict_parse_cannot_read_fails_by_name()
    {
        Assert.Contains(Run(Md, Ts.Replace("// more", "{ id: \"computed\", dialect: CITES },")),
                        f => f.StartsWith("table row `computed`: a `dialect:` not in the literal shape", StringComparison.Ordinal));
        Assert.Contains(Run(Md, Ts.Replace("// more", "{ id: \"no-cite\" },")),
                        f => f == "table row `no-cite`: no `dialect:`");
        Assert.Contains(Run(Md, Ts.Replace("// more", "{ id: `x-${n}`, dialect: [\"N903\"] },")),
                        f => f.Contains("a computed or misspelt id", StringComparison.Ordinal));
        Assert.Contains(Run(Md, "export const TABLE = []"), f => f.Contains("no `export const ROWS`", StringComparison.Ordinal));
    }

    [Fact]
    public void A_marker_in_another_spelling_fails() =>
        Assert.Contains(Run(Md.Replace("| **N903** |", "| **N903** [PROBE: Not_Kebab] |"), Ts),
                        f => f.StartsWith("DIALECT id cell `**N903** [PROBE: Not_Kebab]`", StringComparison.Ordinal));

    [Fact]
    public void A_marker_in_another_case_fails()
    {
        Assert.Contains(Run(Md.Replace("| **N903** |", "| **N903** [probe: new-fact] |"), Ts),
                        f => f.StartsWith("DIALECT id cell `**N903** [probe: new-fact]`", StringComparison.Ordinal));
        Assert.Contains(Run(Md.Replace("| **N903** |", "| **N903** [Probe: new-fact] |"), Ts),
                        f => f.StartsWith("DIALECT id cell `**N903** [Probe: new-fact]`", StringComparison.Ordinal));
    }

    [Fact]
    public void A_marker_outside_the_id_cell_fails() =>
        Assert.Contains(Run(Md.Replace("| c |", "| c [PROBE: new-fact] |"), Ts),
                        f => f.StartsWith("DIALECT N903: a [PROBE: …] marker outside the id cell", StringComparison.Ordinal));

    [Fact]
    public void A_missing_table_still_reports_the_DIALECT_findings()
    {
        var message = MissingTableMessage(Dialect(Md.Replace("| ~~D9~~ |", "| ~~D9~~ [PROBE: x] |")));
        Assert.StartsWith("vendor-facts.table.ts not found (task 2.1)", message, StringComparison.Ordinal);
        Assert.Contains("DIALECT D9 [PROBE: x]: the row is retracted", message, StringComparison.Ordinal);
        Assert.Equal("vendor-facts.table.ts not found (task 2.1)", MissingTableMessage(Dialect(Md)));
    }
}
