using VoltBridge.Core;
using Xunit;

namespace VoltBridge.Core.Tests;

public class SourceAssemblerGuardTests
{
    [Theory]
    [InlineData("<NWL><XmlArchive>…</XmlArchive></NWL>", "FBD")]
    [InlineData("  <NWL>…", "FBD")]            // leading whitespace tolerated
    [InlineData("<FBD>…", "FBD")]
    [InlineData("<LD>…", "LD")]
    [InlineData("<CFC>…", "CFC")]
    [InlineData("<SFC>…", "SFC")]
    public void Detects_graphical_serialization(string impl, string lang)
        => Assert.Equal(lang, SourceAssembler.GraphicalLangOrNull(impl));

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("x := 1;")]
    [InlineData("IF a THEN b := 2; END_IF")]
    [InlineData("// a comment")]
    public void Plain_ST_is_not_graphical(string? impl)
        => Assert.Null(SourceAssembler.GraphicalLangOrNull(impl));
}
