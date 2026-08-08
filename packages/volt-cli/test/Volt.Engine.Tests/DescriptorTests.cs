using Volt.Engine.Workspace;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// The read-only descriptor format — the file body of every non-source item (`.device`, `.task`, `.trace`,
/// `.projectinfo`, `.symbols`, `.recipe`).
/// <para>These bytes are HASHED into the item's version, so a change re-writes the file in every user's repo. It
/// spent its life as six near-identical renderers inside the CODESYS driver, where no C# test could reach it and
/// the only oracle was a live run that is not CI. This is the first coverage it has had.</para>
/// </summary>
public class DescriptorTests
{
    /// <summary>Fixed width 14 — the device descriptor's. The column is measured from the start of the label and
    /// INCLUDES its colon, which is what the original's pre-colonned keys (`"Name:".PadRight(14)`) did.</summary>
    [Fact]
    public void A_fixed_width_pads_label_plus_colon()
    {
        var text = new Descriptor(14).Add("Name", "Motor").Add("Vendor", "Acme").ToString();

        Assert.Equal("Name:         Motor\nVendor:       Acme\n", text);
    }

    /// <summary>A value that overruns the column is not truncated and not wrapped — `PadRight` is a minimum.
    /// A long device type must stay readable even if it spoils the alignment.</summary>
    [Fact]
    public void B_a_label_longer_than_the_fixed_width_still_emits()
    {
        var text = new Descriptor(4).Add("Description", "x").ToString();

        Assert.Equal("Description:x\n", text);
    }

    /// <summary>Auto width = the widest DECLARED label + 2, counting fields whose value came back EMPTY.
    /// <para>This is the subtle one, and the reason the mode exists rather than being inferred. The original
    /// computed the column from the field TABLE before reading any values, so a project-info file carrying only a
    /// Title still aligned to `Default namespace`. Narrowing the column when a field happens to be blank would
    /// re-flow the file for every user whose project fills a different subset of them.</para></summary>
    [Fact]
    public void C_auto_width_counts_declared_labels_not_emitted_ones()
    {
        var text = new Descriptor()
            .Add("Title", "My Project")
            .Add("Default namespace", "")      // declared, empty — pads, does not emit
            .ToString();

        // Built from the rule rather than hand-counted spaces — a literal here is one keystroke from asserting
        // the wrong column, which is exactly the kind of silence this test exists to break.
        Assert.Equal("Title:".PadRight("Default namespace".Length + 2) + "My Project\n", text);
    }

    /// <summary>An absent field is ABSENT — not present and blank. Whitespace-only counts as absent, which is
    /// what keeps a descriptor diffing cleanly when a vendor starts returning `" "` where it returned null.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\n")]
    public void D_an_empty_value_emits_no_line(string? value)
    {
        Assert.Equal("", new Descriptor(11).Add("Event", value).ToString());
    }

    /// <summary>A multi-line vendor string collapses to one line. A device Description routinely wraps, and a
    /// raw line break inside a `Label: value` file would read as the start of a new field.</summary>
    [Fact]
    public void E_a_multi_line_value_is_flattened()
    {
        var text = new Descriptor(14).Add("Description", "first\r\nsecond\r\nthird").ToString();

        Assert.Equal("Description:  first second third\n", text);
    }

    /// <summary>`Unitize` appends a unit ONLY to a bare number. The vendor returns an interval either as a TIME
    /// literal or as a number plus a separate unit, and both must read unambiguously — `t#20ms ms` would not.</summary>
    [Theory]
    [InlineData("20", "ms", "20 ms")]
    [InlineData("t#20ms", "ms", "t#20ms")]     // already a literal — the unit would duplicate
    [InlineData("1.5", "s", "1.5 s")]
    [InlineData("-3", "ms", "-3 ms")]
    [InlineData("20", "", "20")]               // no unit to add
    [InlineData("", "ms", "")]                 // no value at all
    public void F_unitize_only_decorates_a_bare_number(string value, string unit, string expected)
    {
        Assert.Equal(expected, Descriptor.Unitize(value, unit));
    }
}
