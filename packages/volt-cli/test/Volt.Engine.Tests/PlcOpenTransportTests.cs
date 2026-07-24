using System;
using Volt.Engine.Ide;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>Pins the ONE data-safety policy both drivers' WriteXml share (K3): a POU replace that fails must restore
/// the original once and rethrow, so a bad edit never loses or moves a POU. A per-vendor drift here is silent data
/// loss, which is why the policy lives in Core, not hand-copied into each driver.</summary>
public class PlcOpenTransportTests
{
    [Fact]
    public void A_successful_import_replaces_and_never_restores()
    {
        string? imported = null;
        var deleted = false;
        PlcOpenTransport.ReplaceByReimport(
            exportOriginal: () => "ORIGINAL",
            delete: () => deleted = true,
            import: x => imported = x,
            xml: "NEW");

        Assert.True(deleted);
        Assert.Equal("NEW", imported); // the new POU landed; the original was never re-imported
    }

    [Fact]
    public void A_failed_import_restores_the_original_once_then_rethrows()
    {
        var imports = new System.Collections.Generic.List<string>();
        var boom = new InvalidOperationException("import failed");

        var thrown = Assert.Throws<InvalidOperationException>(() =>
            PlcOpenTransport.ReplaceByReimport(
                exportOriginal: () => "ORIGINAL",
                delete: () => { },
                import: x => { imports.Add(x); if (x == "NEW") throw boom; }, // the new import fails; the restore succeeds
                xml: "NEW"));

        Assert.Same(boom, thrown);                       // the original failure is rethrown loudly, not swallowed
        Assert.Equal(new[] { "NEW", "ORIGINAL" }, imports); // exactly one restore attempt, with the captured original
    }
}
