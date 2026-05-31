using System;
using System.Linq;
using System.Xml.Linq;

namespace BeckhoffBridge.Helpers;

/// <summary>
/// PLCopenXML body-swap utility — surgical replacement of a POU's
/// `&lt;body&gt;` element in a full PLCopenXML document.
///
/// **Parallel to CODESYS bridge's `helpers/plcopen_xml.py
/// :replace_body_in_pou`.** Both implement the same export-as-template
/// pattern (`README.md` → "Graphical-POU round-trip" section) and
/// both are unit-tested against captured fixtures so they stay in sync.
///
/// Why this lives in its own class rather than on BeckhoffConnection:
/// pure-data XML surgery has no COM dependencies, so it should be
/// testable without spinning up TC.
/// </summary>
public static class PlcOpenXml
{
	private static readonly XNamespace Ns = "http://www.plcopen.org/xml/tc6_0200";

	/// <summary>
	/// Replace the named POU's `&lt;body&gt;` element in the template
	/// document with `newBodyXml`. Returns the modified document as a
	/// string, or null when the named POU / its body can't be located,
	/// the template isn't valid XML, or the new body isn't valid XML.
	/// </summary>
	public static string? ReplaceBodyInPou(string templateXml, string itemName, string newBodyXml)
	{
		if (string.IsNullOrEmpty(templateXml)) return null;
		// Strip BOM if the vendor's export prepended one.
		if (templateXml.Length > 0 && templateXml[0] == '﻿')
			templateXml = templateXml.Substring(1);

		XDocument doc;
		try { doc = XDocument.Parse(templateXml); }
		catch { return null; }

		var pou = doc.Descendants(Ns + "pou")
			.FirstOrDefault(p => string.Equals(
				(string?)p.Attribute("name") ?? "",
				itemName,
				StringComparison.OrdinalIgnoreCase));
		var body = pou?.Element(Ns + "body");
		if (body == null) return null;

		XElement newBody;
		try { newBody = XElement.Parse(newBodyXml); }
		catch { return null; }

		// Reject mis-named elements (e.g. someone passed a bare <FBD>
		// instead of <body><FBD>...</body>) — splicing would produce
		// a malformed document the vendor silently rejects on import.
		if (newBody.Name != Ns + "body") return null;

		body.ReplaceWith(newBody);
		return (doc.Declaration?.ToString() + "\n" + doc.ToString()).TrimStart('\n');
	}
}
