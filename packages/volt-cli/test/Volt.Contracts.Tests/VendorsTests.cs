using Xunit;
using Volt.Contracts;

namespace Volt.Contracts.Tests;

/// <summary>The vendor id → human name the tray label and the CLI's bridge messages show. It was spelled three times
/// (a per-source <c>DisplayName</c>, <c>ConnectionManager.DisplayNameOf</c>, the CLI's <c>DisplayOf</c> — which named
/// any id that was not TwinCAT "CODESYS"); now once, and an unknown id is refused rather than named.</summary>
public class VendorsTests
{
    [Theory]
    [InlineData(Vendors.Codesys, "CODESYS")]
    [InlineData(Vendors.Twincat, "TwinCAT")]
    public void A_vendor_id_has_its_display_name(string vendor, string display) =>
        Assert.Equal(display, Vendors.Display(vendor));

    [Theory]
    [InlineData("siemens")]
    [InlineData("TWINCAT")]
    [InlineData("")]
    public void An_id_that_is_not_a_vendor_is_refused_not_named(string vendor) =>
        Assert.Throws<ArgumentException>(() => Vendors.Display(vendor));
}
