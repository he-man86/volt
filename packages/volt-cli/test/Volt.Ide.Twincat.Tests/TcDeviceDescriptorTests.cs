using System;
using System.IO;
using Xunit;
using Volt.Ide.Twincat;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// The <c>.device</c> descriptor TwinCAT renders for an I/O node.
///
/// <para>The fixtures are REAL: both were captured from a live TcXaeShell 15.0 by calling <c>ProduceXml</c> on
/// an EtherCAT master and on the EK1100 coupler beneath it. That matters here more than usual, because the whole
/// point of this renderer is deciding what to LEAVE OUT, and only a genuine settings dump contains the things
/// that must not reach a git repository.</para>
/// </summary>
public class TcDeviceDescriptorTests
{
    private static string Fixture(string name) => Fixtures.Text(name);

    /// <summary>A fieldbus MASTER: it has a readable type and no hardware revision, so the Version line is
    /// absent rather than blank.</summary>
    [Fact]
    public void An_ethercat_master_renders_its_identity()
    {
        var text = TcDeviceDescriptor.From(Fixture("device-ethercat-master.xml"));

        Assert.NotNull(text);
        Assert.Contains("Name:", text);
        Assert.Contains("Device 1 (EtherCAT)", text);
        Assert.Contains("EtherCAT Master", text);   // ItemSubTypeName
        Assert.Contains("111", text);               // ItemSubType, the numeric type id
        Assert.DoesNotContain("Version:", text);    // no ProductRevision on a master — so no empty line either
    }

    /// <summary>A SLAVE: same shape, plus the hardware revision that a master does not have.</summary>
    [Fact]
    public void A_coupler_renders_its_identity_including_the_hardware_revision()
    {
        var text = TcDeviceDescriptor.From(Fixture("device-ek1100-coupler.xml"));

        Assert.NotNull(text);
        Assert.Contains("Term 1 (EK1100)", text);
        Assert.Contains("EK1100 EtherCAT Coupler (2A E-Bus)", text);
        Assert.Contains("9099", text);
        Assert.Contains("EK1100-0000-0018", text);  // ProductRevision -> Version
    }

    /// <summary>THE POINT OF THE RENDERER. Everything machine-specific, wiring-specific or volatile stays OUT.
    ///
    /// <para>These bytes are the item's version-hash input and land in the engineer's repository, so a
    /// configuration dump here would (a) publish the engineer's machine address, and (b) make every unrelated
    /// fieldbus tweak show up as a change to a file nobody edited. The EK1100's dump is 10.6KB; the descriptor
    /// is a handful of lines.</para></summary>
    [Theory]
    [InlineData("device-ethercat-master.xml")]
    [InlineData("device-ek1100-coupler.xml")]
    public void No_machine_specific_or_volatile_setting_reaches_the_descriptor(string fixture)
    {
        var raw = Fixture(fixture);
        var text = TcDeviceDescriptor.From(raw)!;

        // The address of the engineer's own machine is in the master's dump. It must never be committed.
        Assert.DoesNotContain("AmsNetId", text);
        Assert.DoesNotContain("192.168", text);
        // Instance and wiring identity: reshuffling a fieldbus must not rewrite files.
        foreach (var volatileField in new[] { "ObjectId", "FieldbusAddress", "PhysAddr", "AutoIncAddr", "SerialNo", "AmsPort" })
            Assert.DoesNotContain(volatileField, text);
        // …and it is a summary, not a dump.
        Assert.True(text.Length < raw.Length / 5, $"descriptor is {text.Length} chars of a {raw.Length}-char dump — too much came through");
    }

    /// <summary>Vendor is left OUT rather than filled with a number. TwinCAT exposes VendorId (Beckhoff = 2)
    /// where CODESYS exposes a company NAME; putting a different kind of value under a shared label would
    /// mislead a reader comparing the two vendors' files.</summary>
    [Fact]
    public void Vendor_is_omitted_rather_than_rendered_as_a_numeric_id()
    {
        var text = TcDeviceDescriptor.From(Fixture("device-ek1100-coupler.xml"))!;

        Assert.DoesNotContain("Vendor:", text);
        Assert.DoesNotContain("VendorId", text);
    }

    /// <summary>A document that is not a readable TreeItem yields null, so the caller emits the canonical empty
    /// manifest for the kind instead of a half-built file. Null and empty are not errors here — an item that
    /// produces no XML is a real state.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not xml at all")]
    public void An_unreadable_document_yields_null(string? input)
    {
        Assert.Null(TcDeviceDescriptor.From(input));
    }
}
