using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// The committed TwinCAT fixture solutions must not reference a file that does not exist.
/// <para><b>This is not tidiness — a dangling reference CRASHES the IDE.</b> A <c>.plcproj</c> whose
/// <c>&lt;Compile Include&gt;</c> names a missing <c>.TcPOU</c> produces a tree where <c>ChildCount</c> counts the
/// phantom but resolving it faults: <c>ChildAt</c> answers <c>RPC_E_CALL_FAILED (0x800706BE)</c> and the TwinCAT
/// System Manager then dies, taking TcXaeShell with it. Every call after that is
/// <c>RPC server unavailable (0x800706BA)</c>, which surfaces to the client as the generic
/// "Bridge is waiting for an IDE project" — a message that describes none of it.</para>
/// <para>All three fixtures shipped this way from the commit that introduced them, so the TwinCAT live tier had
/// never worked: any <c>refs</c> against them killed the IDE on the first tree walk. Two of the three phantoms
/// were <c>VltE2E_*</c> POUs — e2e artifacts whose files were cleaned up while the project file kept the entry,
/// and that state was committed as "deterministic IDE fixtures".</para>
/// <para>It is checked HERE rather than by eye because the failure is silent in git (a `.plcproj` diff looks like
/// an ordinary edit) and expensive live (a crashed IDE, twice, before anyone suspects the fixture).</para>
/// </summary>
public class FixtureProjectIntegrityTests
{
    /// <summary>Walk up from the test binary to the package root — the fixtures live in <c>test/</c>, outside the
    /// copied-to-output <c>fixtures/</c> tree, because they are whole IDE solutions rather than single files.</summary>
    private static string TestRoot()
    {
        var dir = new DirectoryInfo(System.AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Volt.Cli.sln"))) dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, "test");
    }

    [Fact]
    public void Every_plcproj_reference_resolves_to_a_file_that_exists()
    {
        var root = TestRoot();
        var projects = Directory.GetFiles(root, "*.plcproj", SearchOption.AllDirectories);
        Assert.NotEmpty(projects);   // a passing test over zero fixtures would be worthless

        var dangling = new System.Collections.Generic.List<string>();
        foreach (var proj in projects)
        {
            var dir = Path.GetDirectoryName(proj)!;
            var text = File.ReadAllText(proj);
            foreach (Match m in Regex.Matches(text, @"<(?:Compile|None) Include=""([^""]+)"""))
            {
                var include = m.Groups[1].Value.Replace('\\', Path.DirectorySeparatorChar);
                if (!File.Exists(Path.Combine(dir, include)))
                    dangling.Add($"{Path.GetFileName(proj)} -> {m.Groups[1].Value}");
            }
        }

        Assert.True(dangling.Count == 0,
            "a TwinCAT fixture references files that do not exist; opening it and walking the tree CRASHES the " +
            "TwinCAT System Manager:\n  " + string.Join("\n  ", dangling));
    }
}
