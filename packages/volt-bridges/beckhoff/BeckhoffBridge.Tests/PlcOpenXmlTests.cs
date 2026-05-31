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
}
