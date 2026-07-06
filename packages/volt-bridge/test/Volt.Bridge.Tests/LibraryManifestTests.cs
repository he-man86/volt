using Volt.Bridge.Core.Library;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>The one canonical `.library` manifest shape — the parity contract BOTH drivers (CODESYS + TwinCAT)
/// must produce via the shared builder, so the wire is byte-identical for the same concept.</summary>
public class LibraryManifestTests
{
    [Fact]
    public void Build_produces_the_canonical_shape_with_dependencies()
    {
        var m = LibraryManifest.Build(
            "CAA RTCLK", "RTCLK", "CAA Real Time Clock Extern, 3.5.17.0 (CAA Technical Workgroup)",
            placeholder: true, system: false, dependencies: new[] { "CAA Types", "CAA Async Manager" });

        Assert.Equal(
            "LIBRARY CAA RTCLK\n" +
            "NAMESPACE RTCLK\n" +
            "RESOLUTION CAA Real Time Clock Extern, 3.5.17.0 (CAA Technical Workgroup)\n" +
            "PLACEHOLDER true\n" +
            "SYSTEM false\n" +
            "DEPENDENCIES CAA Types, CAA Async Manager\n",
            m);
    }

    [Fact]
    public void Resolution_formats_name_version_distributor()
    {
        Assert.Equal("Tc2_System, 3.10.1.0 (Beckhoff Automation GmbH)",
            LibraryManifest.Resolution("Tc2_System", "3.10.1.0", "Beckhoff Automation GmbH"));
    }

    [Fact]
    public void Build_omits_the_dependencies_line_when_there_are_none()
    {
        var m = LibraryManifest.Build(
            "Tc2_Standard", "Tc2_Standard", "Tc2_Standard, * (Beckhoff Automation GmbH)",
            placeholder: true, system: true);

        Assert.Equal(
            "LIBRARY Tc2_Standard\n" +
            "NAMESPACE Tc2_Standard\n" +
            "RESOLUTION Tc2_Standard, * (Beckhoff Automation GmbH)\n" +
            "PLACEHOLDER true\n" +
            "SYSTEM true\n",
            m);
    }
}
