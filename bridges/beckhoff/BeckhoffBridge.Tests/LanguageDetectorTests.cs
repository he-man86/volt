using BeckhoffBridge.Helpers;
using Xunit;

namespace BeckhoffBridge.Tests;

/// <summary>
/// Regression tests for LanguageDetector. Cases hand-derived from
/// real ImplementationText payloads pulled via the bridge's /debug
/// endpoint against a TwinCAT project. Keep the FBD/LD fixtures
/// faithful to TwinCAT's actual XML — sniffing tests pass cheaply on
/// invented strings while real TwinCAT bodies surface format quirks.
/// </summary>
public class LanguageDetectorTests
{
	[Fact]
	public void Empty_Or_Null_Is_ST()
	{
		Assert.Equal("ST", LanguageDetector.Detect(null));
		Assert.Equal("ST", LanguageDetector.Detect(""));
		Assert.Equal("ST", LanguageDetector.Detect("   "));
	}

	[Fact]
	public void Plain_ST_Body_Is_ST()
	{
		Assert.Equal("ST", LanguageDetector.Detect("x := x + 1;"));
		Assert.Equal("ST", LanguageDetector.Detect("IF a THEN\n  b := TRUE;\nEND_IF\n"));
	}

	[Fact]
	public void NWL_With_Fbd_View_Is_FBD()
	{
		var body = "<NWL><XmlArchive><Data><o t=\"NWLImplementationObject\">"
			+ "<v n=\"DefaultViewMode\">\"Fbd\"</v></o></Data></XmlArchive></NWL>";
		Assert.Equal("FBD", LanguageDetector.Detect(body));
	}

	[Fact]
	public void NWL_With_Ld_View_Is_LD()
	{
		var body = "<NWL><XmlArchive><Data><o t=\"NWLImplementationObject\">"
			+ "<v n=\"DefaultViewMode\">\"Ld\"</v></o></Data></XmlArchive></NWL>";
		Assert.Equal("LD", LanguageDetector.Detect(body));
	}

	[Fact]
	public void NWL_Without_Explicit_View_Defaults_To_FBD()
	{
		// Real-world: some TwinCAT versions omit DefaultViewMode for
		// freshly-created networks. FBD is the dominant default.
		Assert.Equal("FBD", LanguageDetector.Detect("<NWL>...</NWL>"));
	}

	[Fact]
	public void STBody_Wrapper_Is_SFC()
	{
		Assert.Equal("SFC", LanguageDetector.Detect("<STBody>...</STBody>"));
	}

	[Fact]
	public void CFC_Wrapper_Is_CFC()
	{
		Assert.Equal("CFC", LanguageDetector.Detect("<CFC>...</CFC>"));
	}

	[Fact]
	public void Unknown_XML_Wrapper_Returns_UNKNOWN()
	{
		// A future graphical language TwinCAT adds — surface it so we
		// notice in logs and add a case, instead of silently treating
		// as ST and clobbering the body via text edits.
		Assert.Equal("UNKNOWN", LanguageDetector.Detect("<SomethingNew>body</SomethingNew>"));
	}

	[Fact]
	public void Leading_Whitespace_Does_Not_Mask_The_Wrapper()
	{
		Assert.Equal("FBD", LanguageDetector.Detect("\r\n  <NWL>...</NWL>"));
		Assert.Equal("ST", LanguageDetector.Detect("\r\n  x := 1;"));
	}

	[Fact]
	public void Case_Insensitive_Wrapper_Match()
	{
		// Defensive — TwinCAT emits uppercase but be lenient on input.
		Assert.Equal("FBD", LanguageDetector.Detect("<nwl>...</nwl>"));
		Assert.Equal("CFC", LanguageDetector.Detect("<cfc>...</cfc>"));
	}

	[Fact]
	public void IsGraphical_Mirrors_Detect()
	{
		Assert.False(LanguageDetector.IsGraphical(""));
		Assert.False(LanguageDetector.IsGraphical("x := 1;"));
		Assert.True(LanguageDetector.IsGraphical("<NWL>...</NWL>"));
		Assert.True(LanguageDetector.IsGraphical("<CFC>...</CFC>"));
		Assert.True(LanguageDetector.IsGraphical("<STBody>...</STBody>"));
		// UNKNOWN counts as graphical — same safety treatment (masked).
		Assert.True(LanguageDetector.IsGraphical("<Future>...</Future>"));
	}
}
