using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// EVERY SHIPPED BINARY IS BUILT FOR THE MACHINES VOLT INSTALLS ON (openspec <c>environment-dependency-audit</c> 1.2, the
/// bitness/target gate). The PE header of every binary in the payload is read by <c>scripts/binary-targets.ts</c>, which
/// <c>build-payload.ts</c> runs on the tree it built (the in-proc CODESYS DLL AnyCPU, the hierarchy reader x86, the rest
/// x64/AnyCPU). What a PE header cannot say is held here as text, each one a choice the hotfix of 2026-10-13 made and
/// nothing gated (0.1 census): the LSP compiled for bun's BASELINE x64 (the default needs AVX2, which the Atom/Celeron of
/// an industrial panel PC lacks — the LSP crashed at start there), the installer refusing a non-x64 Windows, and the
/// payload check actually wired in. The x86 reader's .NET Framework (4.7.2) is <c>TwincatHierarchyReaderRuntimeTests</c>.
/// </summary>
public class ShippedBinaryTargetTests
{
    private static string Root => NoCodeCheckLeftTests.RepoRoot();

    [Fact]
    public void The_LSP_is_compiled_for_the_baseline_x64_target()
    {
        var payload = File.ReadAllText(Path.Combine(Root, "scripts", "build-payload.ts"));
        Assert.Matches(new Regex(@"""--target=bun-windows-x64-baseline""", RegexOptions.CultureInvariant), payload);
        Assert.DoesNotMatch(new Regex(@"--target=bun-windows-x64(?!-baseline)", RegexOptions.CultureInvariant), payload);
    }

    [Fact]
    public void The_installer_installs_on_x64_Windows_only_and_in_64_bit_mode()
    {
        var iss = File.ReadAllLines(Path.Combine(Root, "installer", "Volt.iss")).Select(l => l.Trim()).ToList();
        Assert.Contains("ArchitecturesAllowed=x64compatible", iss);
        Assert.Contains("ArchitecturesInstallIn64BitMode=x64compatible", iss);
    }

    [Fact]
    public void The_payload_build_checks_every_binarys_target()
    {
        var payload = File.ReadAllText(Path.Combine(Root, "scripts", "build-payload.ts"));
        Assert.Contains("from \"./binary-targets.js\"", payload);
        Assert.Matches(new Regex(@"checkTargets\(out\)", RegexOptions.CultureInvariant), payload);
        var targets = File.ReadAllText(Path.Combine(Root, "scripts", "binary-targets.ts"));
        Assert.Contains("\"codesys/Volt.Ide.Codesys.dll\") return [\"AnyCPU\"]", targets);
        Assert.Contains("\"connector/VoltTwincatExplorer.exe\") return [\"x86\"]", targets);
        // Every DLL CODESYS loads in-proc, not only the bridge: a dependency built for x64 beside it fails in a 32-bit IDE
        // (review of gate 1).
        Assert.Contains("path.startsWith(\"codesys/\") && path.toLowerCase().endsWith(\".dll\")) return [\"AnyCPU\"]", targets);
    }

    /// <summary>The in-proc CODESYS bridge loads into a 32-bit AND a 64-bit IDE: its project states no platform but AnyCPU
    /// and does not prefer 32 bits (the PE check reads the built DLL; this names the line that would break it).</summary>
    [Fact]
    public void The_CODESYS_bridge_project_stays_AnyCPU()
    {
        var csproj = XDocument.Load(Path.Combine(Root, "packages", "volt-cli", "src", "Volt.Ide.Codesys", "Volt.Ide.Codesys.csproj"));
        foreach (var p in csproj.Descendants("PlatformTarget")) Assert.Equal("AnyCPU", p.Value.Trim());
        foreach (var p in csproj.Descendants("Prefer32Bit")) Assert.Equal("false", p.Value.Trim().ToLowerInvariant());
    }
}
