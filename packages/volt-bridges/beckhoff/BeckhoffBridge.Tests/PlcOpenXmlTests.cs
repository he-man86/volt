using System.Xml.Linq;
using BeckhoffBridge.Helpers;
using Xunit;

namespace BeckhoffBridge.Tests;

/// <summary>
/// Body-swap unit tests for `PlcOpenXml.ReplaceBodyInPou`. Parallel to
/// CODESYS's `test_plcopen_xml.py:TestReplaceBodyInPou` — both test
/// the load-bearing surgery of the export-as-template push pattern.
///
/// Captured fixtures (not random strings) so format quirks the live
/// vendors emit are exercised faithfully.
/// </summary>
public class PlcOpenXmlTests
{
	// Schema-valid PLCopenXML — minimum elements both TC and CODESYS
	// require on import (fileHeader, contentHeader, coordinateInfo).
	private const string TemplateFbdPou = @"<?xml version=""1.0"" encoding=""utf-8""?>
<project xmlns=""http://www.plcopen.org/xml/tc6_0200"">
  <fileHeader companyName=""Volt"" productName=""volt-bridges"" productVersion=""5.0.0"" creationDateTime=""2026-05-30T20:00:00Z"" />
  <contentHeader name=""Test.project"" modificationDateTime=""2026-05-30T20:00:00Z"">
    <coordinateInfo>
      <fbd><scaling x=""1"" y=""1"" /></fbd>
    </coordinateInfo>
  </contentHeader>
  <types>
    <dataTypes />
    <pous>
      <pou name=""MyFB"" pouType=""functionBlock"">
        <interface />
        <body>
          <FBD>
            <inVariable localId=""1"">
              <position x=""0"" y=""0"" />
              <connectionPointOut />
              <expression>OLD_VAR</expression>
            </inVariable>
          </FBD>
        </body>
        <addData />
      </pou>
    </pous>
  </types>
</project>";

	private const string NewBody = @"<body xmlns=""http://www.plcopen.org/xml/tc6_0200"">
  <FBD>
    <inVariable localId=""100"">
      <position x=""50"" y=""50"" />
      <connectionPointOut />
      <expression>NEW_VAR</expression>
    </inVariable>
  </FBD>
</body>";

	[Fact]
	public void Swaps_Body_Preserving_Other_Elements()
	{
		var result = PlcOpenXml.ReplaceBodyInPou(TemplateFbdPou, "MyFB", NewBody);
		Assert.NotNull(result);
		Assert.Contains("NEW_VAR", result);
		Assert.DoesNotContain("OLD_VAR", result);
		// Schema-required elements preserved
		Assert.Contains("fileHeader", result);
		Assert.Contains("contentHeader", result);
		Assert.Contains("coordinateInfo", result);
		// POU identity preserved
		Assert.Contains("name=\"MyFB\"", result);
		Assert.Contains("pouType=\"functionBlock\"", result);
	}

	[Fact]
	public void Returns_Null_When_Pou_Not_In_Template()
	{
		Assert.Null(PlcOpenXml.ReplaceBodyInPou(TemplateFbdPou, "DoesNotExist", NewBody));
	}

	[Fact]
	public void Returns_Null_On_Malformed_Template()
	{
		Assert.Null(PlcOpenXml.ReplaceBodyInPou("<not-xml>", "MyFB", NewBody));
	}

	[Fact]
	public void Returns_Null_On_Malformed_New_Body()
	{
		Assert.Null(PlcOpenXml.ReplaceBodyInPou(TemplateFbdPou, "MyFB", "not xml"));
	}

	[Fact]
	public void Handles_BOM_Prefix()
	{
		// CODESYS prepends a UTF-8 BOM to its export output.
		var result = PlcOpenXml.ReplaceBodyInPou("﻿" + TemplateFbdPou, "MyFB", NewBody);
		Assert.NotNull(result);
		Assert.Contains("NEW_VAR", result);
	}

	[Fact]
	public void Case_Insensitive_Name_Match()
	{
		var result = PlcOpenXml.ReplaceBodyInPou(TemplateFbdPou, "myfb", NewBody);
		Assert.NotNull(result);
		Assert.Contains("NEW_VAR", result);
	}

	[Fact]
	public void Result_Is_Valid_Xml()
	{
		var result = PlcOpenXml.ReplaceBodyInPou(TemplateFbdPou, "MyFB", NewBody);
		Assert.NotNull(result);
		var doc = XDocument.Parse(result);
		Assert.NotNull(doc.Root);
	}

	[Fact]
	public void Returns_Null_On_Empty_Template()
	{
		Assert.Null(PlcOpenXml.ReplaceBodyInPou("", "MyFB", NewBody));
		Assert.Null(PlcOpenXml.ReplaceBodyInPou(null!, "MyFB", NewBody));
	}

	[Fact]
	public void Rejects_Non_Body_Root_Element()
	{
		// Passing a bare <FBD>...</FBD> instead of <body><FBD>...</FBD></body>
		// must be rejected — splicing it directly under <pou> would
		// produce a malformed document.
		const string notABody = @"<FBD xmlns=""http://www.plcopen.org/xml/tc6_0200""><inVariable localId=""1"" /></FBD>";
		Assert.Null(PlcOpenXml.ReplaceBodyInPou(TemplateFbdPou, "MyFB", notABody));
	}

	// ─── DetectBodyLanguage ───────────────────────────────────────────

	[Fact]
	public void DetectBodyLanguage_Returns_FBD_For_Fbd_Body()
	{
		const string body = @"<body xmlns=""http://www.plcopen.org/xml/tc6_0200""><FBD><inVariable localId=""1""/></FBD></body>";
		Assert.Equal("FBD", PlcOpenXml.DetectBodyLanguage(body));
	}

	[Fact]
	public void DetectBodyLanguage_Returns_LD_For_Ld_Body()
	{
		const string body = @"<body xmlns=""http://www.plcopen.org/xml/tc6_0200""><LD><leftPowerRail localId=""1""/></LD></body>";
		Assert.Equal("LD", PlcOpenXml.DetectBodyLanguage(body));
	}

	[Fact]
	public void DetectBodyLanguage_Returns_SFC_For_Sfc_Body()
	{
		const string body = @"<body xmlns=""http://www.plcopen.org/xml/tc6_0200""><SFC><step name=""S1""/></SFC></body>";
		Assert.Equal("SFC", PlcOpenXml.DetectBodyLanguage(body));
	}

	[Fact]
	public void DetectBodyLanguage_Returns_CFC_For_Cfc_Body()
	{
		const string body = @"<body xmlns=""http://www.plcopen.org/xml/tc6_0200""><CFC><inVariable localId=""1""/></CFC></body>";
		Assert.Equal("CFC", PlcOpenXml.DetectBodyLanguage(body));
	}

	[Fact]
	public void DetectBodyLanguage_Returns_ST_For_St_Body()
	{
		const string body = @"<body xmlns=""http://www.plcopen.org/xml/tc6_0200""><ST><xhtml xmlns=""http://www.w3.org/1999/xhtml"">x := 1;</xhtml></ST></body>";
		Assert.Equal("ST", PlcOpenXml.DetectBodyLanguage(body));
	}

	[Fact]
	public void DetectBodyLanguage_Accepts_Naked_Language_Tag()
	{
		// Defensive: caller might pass the inner <FBD>...</FBD> directly.
		const string naked = @"<FBD><inVariable localId=""1""/></FBD>";
		Assert.Equal("FBD", PlcOpenXml.DetectBodyLanguage(naked));
	}

	[Fact]
	public void DetectBodyLanguage_Returns_Null_For_Empty_String()
	{
		Assert.Null(PlcOpenXml.DetectBodyLanguage(""));
	}

	[Fact]
	public void DetectBodyLanguage_Returns_Null_For_Unrecognized_Tag()
	{
		const string body = @"<body xmlns=""http://www.plcopen.org/xml/tc6_0200""><FOO><inVariable localId=""1""/></FOO></body>";
		Assert.Null(PlcOpenXml.DetectBodyLanguage(body));
	}

	[Fact]
	public void DetectBodyLanguage_Returns_Null_For_Malformed_Xml()
	{
		Assert.Null(PlcOpenXml.DetectBodyLanguage("<body><FBD>"));
	}

	[Fact]
	public void DetectBodyLanguage_Returns_Null_For_Empty_Body()
	{
		const string emptyBody = @"<body xmlns=""http://www.plcopen.org/xml/tc6_0200""></body>";
		Assert.Null(PlcOpenXml.DetectBodyLanguage(emptyBody));
	}
}
