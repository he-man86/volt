using System.Linq;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// THE BRIDGE SAYS WHICH COPY OF ITS WIRE ASSEMBLIES IT BOUND (openspec <c>codesys-minimum-version</c> 3.1).
///
/// <para>Two field failures — <c>MissingMethodException: Volt.Wire.PipeClient.Call(String, Object,
/// Action`1[JsonElement], Int32)</c> on 3.5.17, <c>MissingFieldException: Volt.Contracts.WireJson.Write</c> on
/// 3.5.21.50 — are both a member whose signature carries a <c>System.Text.Json</c> type, which points at a second
/// copy of a Volt or System.Text.Json assembly bound in the CODESYS process. Which copy won was visible nowhere.
/// One line per assembly at start settles it the next time it happens.</para>
/// </summary>
public class BoundAssembliesTests
{
    [Theory]
    [InlineData("Volt.Wire")]
    [InlineData("Volt.Contracts")]
    [InlineData("System.Text.Json")]
    public void Each_wire_assembly_is_logged_with_its_version_and_location(string name)
    {
        var lines = BoundAssemblies.Describe();

        var line = Assert.Single(lines, l => l.StartsWith(name + " "));
        var loaded = System.AppDomain.CurrentDomain.GetAssemblies().First(a => a.GetName().Name == name);
        Assert.Contains(loaded.GetName().Version!.ToString(), line);
        Assert.Contains(loaded.Location, line);
    }

    /// <summary>The two members the field failures named, resolved from the assembly that DECLARES them — the
    /// copy of System.Text.Json each one actually binds, which is the question the failures asked.</summary>
    [Fact]
    public void The_System_Text_Json_each_Volt_wire_member_binds_is_named()
    {
        var lines = BoundAssemblies.Describe();

        Assert.Contains(lines, l => l.Contains("Volt.Wire.PipeClient.Call") && l.Contains("System.Text.Json"));
        Assert.Contains(lines, l => l.Contains("Volt.Contracts.WireJson.Write") && l.Contains("System.Text.Json"));
    }
}
