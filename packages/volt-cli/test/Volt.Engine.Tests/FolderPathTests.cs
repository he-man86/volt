using Xunit;
using Volt.Engine.Format.Body;
using Volt.Engine.PlcOpen;
using Volt.Engine.Item;

namespace Volt.Cli.Tests;

/// <summary>
/// The folder-path codec: an IDE folder name containing the path separator, a Windows-reserved character,
/// or leading/trailing whitespace must round-trip through the `/`-joined wire folder AND a filesystem path
/// without ambiguity or loss. The load-bearing real case is a CODESYS folder literally named
/// "Interfaces / Data" (a '/' in the NAME), which a raw join can't distinguish from nested folders.
/// </summary>
public class FolderPathTests
{
    [Theory]
    [InlineData("Interfaces / Data")]   // the real Pro2193 case — '/' in the name
    [InlineData("plain")]
    [InlineData("31.00 - IMM")]         // dots + spaces, all internal — must stay readable/literal
    [InlineData("a\\b")]                // backslash (Windows separator)
    [InlineData("weird:*?\"<>|name")]   // Windows-reserved characters
    [InlineData(" leading")]            // leading space (Windows-hostile)
    [InlineData("trailing ")]           // trailing space (Windows strips it)
    [InlineData("dot.")]                // trailing dot (Windows strips it)
    [InlineData(".hidden")]             // leading dot (hidden dir — dotfile-skipping tooling drops it)
    [InlineData(".Interfaces / Data")]  // the real Pro2193 case — leading dot AND a '/'
    [InlineData("100%")]                // percent must self-escape to stay reversible
    [InlineData("   ")]                 // all spaces
    public void Encode_decode_round_trips(string name)
    {
        Assert.Equal(name, FolderPath.Decode(FolderPath.Encode(name)));
    }

    [Fact]
    public void Encode_removes_the_separator_and_stays_readable()
    {
        var e = FolderPath.Encode("Interfaces / Data");
        Assert.DoesNotContain('/', e);                 // no separator collision on the wire / filesystem
        Assert.Equal("Interfaces %2F Data", e);        // internal spaces + letters stay literal
    }

    [Fact]
    public void Encode_unhides_a_leading_dot_directory()
    {
        // A leading dot makes a hidden dir that dotfile-skipping tools (incl. the LSP file scan) drop.
        Assert.False(FolderPath.Encode(".Interfaces / Data").StartsWith("."));
        Assert.Equal("%2EInterfaces %2F Data", FolderPath.Encode(".Interfaces / Data"));
    }

    [Fact]
    public void Append_then_Segments_round_trips_a_full_path()
    {
        var path = FolderPath.Append(FolderPath.Append("", "31.00 - IMM"), "Interfaces / Data");
        Assert.DoesNotContain("Interfaces / Data", path);            // the name's '/' is encoded
        Assert.Equal(new[] { "31.00 - IMM", "Interfaces / Data" }, FolderPath.Segments(path));
    }

    [Fact]
    public void Segments_of_empty_is_empty()
    {
        Assert.Empty(FolderPath.Segments(null));
        Assert.Empty(FolderPath.Segments(""));
    }

    [Fact]
    public void A_literal_percent_escape_in_a_name_is_not_mistaken_for_an_encoding()
    {
        // A user folder literally named "%2F" must NOT decode as '/': Encode escapes the '%' first.
        var e = FolderPath.Encode("%2F");
        Assert.Equal("%252F", e);
        Assert.Equal("%2F", FolderPath.Decode(e));
    }
}
