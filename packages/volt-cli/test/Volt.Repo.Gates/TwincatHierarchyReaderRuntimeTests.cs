using System.IO;
using System.Linq;
using System.Xml.Linq;
using Xunit;
using Volt.Tests.Shared;

namespace Volt.Repo.Gates;

/// <summary>
/// THE x86 HIERARCHY READER RUNS ON EVERY .NET FRAMEWORK A TWINCAT MACHINE HAS (environment audit of the x86-helper
/// fix, DIALECT C2t). <c>VoltTwincatExplorer.exe</c> is the one Volt process that runs on the machine's own .NET
/// Framework instead of a runtime Volt ships. Built for 4.8 its build writes a <c>supportedRuntime sku=".NETFramework,Version=v4.8"</c>
/// config (the publish copied only the exe, by luck), and on a machine with only 4.7.2 (Windows 10 LTSC 2019, a common panel-PC image) the runtime shim answers that
/// with a MODAL "install .NET Framework" dialog — a hidden child process waiting on a dialog nobody sees, so the read hangs
/// to its timeout. Targeting 4.7.2 makes the requirement one every supported Windows 10/11 meets.
/// </summary>
public class TwincatHierarchyReaderRuntimeTests
{
    private static string PackageRoot() => RepoPaths.PackageDir().FullName;

    [Fact]
    public void The_x86_hierarchy_reader_targets_dotnet_framework_4_7_2_and_x86()
    {
        var csproj = XDocument.Load(Path.Combine(PackageRoot(), "src", "Volt.Ide.Twincat.Explorer", "Volt.Ide.Twincat.Explorer.csproj"));
        string? Prop(string name) => csproj.Descendants(name).Select(e => e.Value.Trim()).SingleOrDefault();

        Assert.Equal("net472", Prop("TargetFramework"));
        Assert.Equal("x86", Prop("PlatformTarget"));
    }
}
