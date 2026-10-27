using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// THE PLAIN-ST CASE SET, ON THE BRIDGE'S SIDE (openspec <c>network-text-st</c> 2.3; <see cref="NetworkTextCases.StRoot"/>):
/// <c>test/fixtures/network-text-st/</c>, in the format of the v2 set. Its accept cases ARE the v2 accept cases, each body
/// written as a pull writes it (<see cref="StNetworkWriter.WritePulled"/>, against the case's scope) — so the two sets
/// cannot drift apart, and the file is generated: <c>VOLT_WRITE_ST_CASES=1</c> rewrites it, and otherwise this FAILS on a
/// difference. Its refuse cases are written by hand, one per refusal of the reader. The LSP reads the same files (its
/// network check, <c>src/analysis/checks/network/_plain-st.test.ts</c>): a case the two sides judge differently fails
/// both suites (design.md oracle 2).
/// </summary>
public class StNetworkCaseTests
{
    private static bool Writing => Environment.GetEnvironmentVariable("VOLT_WRITE_ST_CASES") == "1";

    private static string AcceptDir => Path.Combine(NetworkTextCases.StRoot(), "accept");

    /// <summary>One accept file's text: every v2 accept case of <paramref name="v2File"/>, its body in plain ST.</summary>
    private static string Generated(string v2File)
    {
        var sb = new StringBuilder();
        foreach (var c in NetworkTextCases.Read(v2File).Where(c => c.Accept))
        {
            var scope = c.ScopeOf();
            var gate = NetworkTextGate.Validate(c.Text, scope);
            Assert.True(gate.Ok, $"{c}: the v2 gate refuses an accept case");
            var text = StNetworkWriter.WritePulled(gate.Body!, scope);
            var back = StNetworkReader.Read(text, scope);
            if (sb.Length > 0) sb.Append('\n');
            sb.Append("#### ").Append(c.Name).Append(" — the v2 case ").Append(c.ToString()).Append(", as a pull writes it\n");
            if (c.Scope.Count > 0) sb.Append("=== scope\n").Append(string.Join("\n", c.Scope)).Append('\n');
            sb.Append("=== text\n").Append(text);
            sb.Append("=== model\n").Append(NetworkModelDump.Of(back));
        }
        return sb.ToString();
    }

    [Fact]
    public void The_accept_set_is_the_v2_accept_set_written_as_a_pull_writes_it()
    {
        var files = Directory.EnumerateFiles(Path.Combine(NetworkTextCases.Root(), "accept"), "*.cases").OrderBy(f => f, StringComparer.Ordinal).ToList();
        if (Writing)
        {
            Directory.CreateDirectory(AcceptDir);
            foreach (var f in files) File.WriteAllText(Path.Combine(AcceptDir, Path.GetFileName(f)), Generated(f));
            return;
        }
        foreach (var f in files)
        {
            var committed = Path.Combine(AcceptDir, Path.GetFileName(f));
            Assert.True(File.Exists(committed), $"{committed} is missing — regenerate with VOLT_WRITE_ST_CASES=1 dotnet test test/Volt.Engine.Tests");
            Assert.Equal(Generated(f), File.ReadAllText(committed).Replace("\r\n", "\n"));
        }
    }

    public static IEnumerable<object[]> Accepted() =>
        NetworkTextCases.AllIn(NetworkTextCases.StRoot()).Where(c => c.Accept).Select(c => new object[] { c.ToString() });

    public static IEnumerable<object[]> Refused() =>
        NetworkTextCases.AllIn(NetworkTextCases.StRoot()).Where(c => !c.Accept).Select(c => new object[] { c.ToString() });

    private static NetworkTextCase Case(string id) => NetworkTextCases.AllIn(NetworkTextCases.StRoot()).Single(c => c.ToString() == id);

    [Theory]
    [MemberData(nameof(Accepted))]
    public void An_accepted_case_reads_to_its_model_and_writes_back_its_text(string id)
    {
        var c = Case(id);
        var scope = c.ScopeOf();
        var body = StNetworkReader.Read(c.Text, scope);
        Assert.Equal(NetworkModelDump.Normalized(c.Model!), NetworkModelDump.Normalized(NetworkModelDump.Of(body)));
        Assert.Equal(c.Text, StNetworkWriter.WritePulled(body, scope));
    }

    [Theory]
    [MemberData(nameof(Refused))]
    public void A_refused_case_is_refused_by_name(string id)
    {
        var c = Case(id);
        var ex = Assert.Throws<StNetworkReadException>(() => StNetworkReader.Read(c.Text, c.ScopeOf()));
        Assert.True(c.RefusedPhrase is null || ex.Message.IndexOf(c.RefusedPhrase, StringComparison.OrdinalIgnoreCase) >= 0,
            $"{c}: expected '{c.RefusedPhrase}', got: {ex.Message}");
    }

    /// <summary>The set covers the reader: every v2 accept case, and a refusal for each rule of what a network holds.</summary>
    [Fact]
    public void The_case_set_is_there()
    {
        var all = NetworkTextCases.AllIn(NetworkTextCases.StRoot());
        Assert.True(all.Count(c => c.Accept) >= 100, $"{all.Count(c => c.Accept)} accept cases");
        Assert.True(all.Count(c => !c.Accept) >= 25, $"{all.Count(c => !c.Accept)} refuse cases");
    }
}
