using Volt.Engine.Item;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// AN ITEM'S APPLICATION IS MATCHED PER PATH SEGMENT (volt-cli-rework 1.0, finding (c), and foreign-client review F12).
/// The root <c>A/App</c> is a prefix of the string <c>A/App2/X.pou</c> but not of its segments: that item is in
/// <c>A/App2</c>, or in the pool when <c>A/App2</c> is no application. The finding was false (the match already ran on
/// <c>/</c> boundaries); this pins it.
/// </summary>
public class ApplicationOfTests
{
    [Theory]
    [InlineData("A/App2/X.pou", null)]
    [InlineData("A/App/X.pou", "A/App")]
    [InlineData("A/App", "A/App")]
    [InlineData("A/Application/X.pou", null)]
    public void A_root_holds_only_the_paths_under_its_own_segments(string path, string? expected) =>
        Assert.Equal(expected, ItemPath.ApplicationOf(path, new[] { "A/App" }));

    [Fact]
    public void The_longest_root_by_segment_wins() =>
        Assert.Equal("A/App2", ItemPath.ApplicationOf("A/App2/X.pou", new[] { "A/App", "A/App2" }));
}
