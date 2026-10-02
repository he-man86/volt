using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Cli.Sync;
using Volt.Engine.Item;
using static Volt.Cli.Tests.CommandHarness;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// EVERY EXTENSION LIST THE CLI SHOWS A PERSON IS RENDERED FROM THE ONE TABLE (<see cref="ItemKind.FileExtensions"/>,
/// through <see cref="Extensions"/>), never typed out. The push's unrecognized-extension refusal and the scaffolded
/// README each kept a hand-written kind→extension list — "a DUT is .struct/.enum/.union/.alias, by its
/// declaration", a table row "DUT | `.struct` `.enum` …" — which is item-kind knowledge in the layer whose job is
/// git (openspec <c>dut-subtype-on-the-wire</c>, 4.4), and which had already drifted: the README named `.cfc`/`.sfc`
/// files no Volt writes, and neither list named `.task`, a file a push writes.
/// </summary>
public class ExtensionListTextTests
{
    private static readonly Regex ExtToken = new(@"(?<![\w/])\.([a-z_]+)\b");

    private static string[] Tokens(string text) =>
        ExtToken.Matches(text).Select(m => m.Groups[1].Value).Distinct().OrderBy(x => x).ToArray();

    private static string[] Writable() =>
        ItemKind.FileExtensions.Where(x => x.IsWritable).Select(x => x.Ext).Distinct().OrderBy(x => x).ToArray();

    [Fact]
    public void The_unrecognized_extension_refusal_names_exactly_the_pushable_extensions()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(Path.Combine(root, "src", "notes"), "not a PLC item");

            var r = Commands.Push(root, client);
            Assert.Equal("rejected", r.Kind);
            // The file list is the part after the colon-newline; the advice is the line before it.
            var advice = r.Reason!.Split('\n')[0];
            Assert.Equal(Writable(), Tokens(advice));
            // It also asserted no `dut` here. `.dut` is a writable DUT extension since openspec push-without-header-check
            // 5.B (owner: the DUT whose vendor states no subtype), so the table — and therefore this list — names it.
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void The_scaffolded_readme_names_exactly_the_extensions_of_the_table()
    {
        var root = Directory.CreateTempSubdirectory("volt-scaffold-").FullName;
        try
        {
            Scaffold.WriteWorkspaceScaffold(root, "Demo");
            var readme = File.ReadAllText(Path.Combine(root, "README.md"));

            // `.git`/`.vscode`/`.claude` are directories the README describes, not item extensions.
            var named = Tokens(readme).Except(new[] { "git", "vscode", "claude" }).ToArray();
            Assert.Equal(ItemKind.FileExtensions.Select(x => x.Ext).Distinct().OrderBy(x => x).ToArray(), named);
            // No `dut` assertion any more: `.dut` is a table extension since push-without-header-check 5.B (owner).
        }
        finally { TestUtil.ForceDelete(root); }
    }
}
