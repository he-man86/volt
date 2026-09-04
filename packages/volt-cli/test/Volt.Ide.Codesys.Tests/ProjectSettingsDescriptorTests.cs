using System.Collections.Generic;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// The `.projectsettings` warning-id rendering.
///
/// <para><b>Why this is the part under test.</b> <c>ProjectSettingsDescriptor</c> itself walks a CODESYS static
/// (<c>APEnvironment.LMServiceProvider</c>), so it is only exercisable against a live IDE — and it was, on
/// SP21, producing <c>Disabled warnings: C0371</c> for the pro2193 fixture. What CAN rot offline is the
/// translation between the two sides: CODESYS hands out <b>bare integers</b> (371), the LSP matches on
/// <b>Cnnnn</b> (C0371), and the collection is <c>null</c> — not empty — when nothing is configured. Get the
/// padding wrong and every code silently fails to match; treat null as an error and a default project throws.</para>
/// </summary>
public class ProjectSettingsDescriptorTests
{
    /// <summary>Drive the real private helper — a copy of the formatting rule here would test itself.</summary>
    private static string Render(object? ids)
    {
        var m = typeof(CodesysObjectModel).GetMethod(
            "WarningIds",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        Assert.NotNull(m);
        // The helper asks its first argument for `getter`; a dictionary-free stand-in is enough.
        return (string)m!.Invoke(null, new object?[] { new FakeWarnings(ids), "GetIds" })!;
    }

    /// <summary>Answers <c>GetIds()</c> with whatever it was handed — the shape `InvokeMethod` looks for.</summary>
    private sealed class FakeWarnings
    {
        private readonly object? _ids;
        public FakeWarnings(object? ids) => _ids = ids;
        public object? GetIds() => _ids;
    }

    [Fact]
    public void Bare_integer_ids_become_four_digit_Cnnnn_codes()
    {
        // 371 -> C0371 is the whole point: the LSP's CONFIGURABLE_CHECKS matches on the padded form.
        Assert.Equal("C0371", Render(new List<int> { 371 }));
        Assert.Equal("C0033", Render(new List<int> { 33 }));
        Assert.Equal("C0139, C0195, C0196", Render(new List<int> { 195, 139, 196 }));
    }

    [Fact]
    public void Ids_are_sorted_so_the_file_does_not_churn()
    {
        // The vendor's set has no defined order; an unsorted render would diff on every pull.
        Assert.Equal("C0033, C0139, C0371", Render(new List<int> { 371, 33, 139 }));
    }

    [Fact]
    public void A_null_collection_is_none_not_a_failure()
    {
        // CODESYS leaves the backing field null when nothing is configured — that IS "none", and a default
        // project must render an empty value (which Descriptor then drops) rather than throw.
        Assert.Equal("", Render(null));
    }

    [Fact]
    public void An_empty_collection_renders_as_none_too()
    {
        Assert.Equal("", Render(new List<int>()));
    }

    [Fact]
    public void A_non_numeric_id_is_skipped_rather_than_mangled()
    {
        // Defensive only against a vendor shape change: better to omit an id than to emit "C0NaN".
        Assert.Equal("C0371", Render(new List<object> { "371", "not-a-number" }));
    }
}
