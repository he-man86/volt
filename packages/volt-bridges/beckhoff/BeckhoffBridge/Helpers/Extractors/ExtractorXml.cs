using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// XML helpers shared by every config extractor.
///
/// Every TwinCAT non-CRUD item exposes <c>ITcSmTreeItem.ProduceXml()</c>
/// — a round-trippable serialization wrapped in
/// <c>&lt;TreeItem&gt;...&lt;/TreeItem&gt;</c>. Each kind has its own
/// child schema (Task / LibraryReference / RecipeManager / ...).
/// Extractors pluck the fields they care about into a deterministic
/// text manifest.
///
/// All accessors are tolerant of missing nodes/attributes — TwinCAT
/// versions differ, and elements that aren't set typically don't appear
/// in ProduceXml at all. That's load-bearing: returning <c>null</c>
/// from these helpers feeds into <see cref="ExtractorPairs.Add"/>
/// which skips null/empty values, so absent properties simply omit
/// their line rather than show as blank.
/// </summary>
internal static class ExtractorXml
{
	/// <summary>Call ProduceXml on the item, parse as XDocument.
	/// Throws if the call fails or the result isn't valid XML — the
	/// extractor framework is built on the assumption that every
	/// non-CRUD TwinCAT item produces well-formed XML. A failure here
	/// is a real bug (TwinCAT crashed, item is in an inconsistent
	/// state, COM channel wedged), not a "kind doesn't support
	/// ProduceXml" situation — every ITcSmTreeItem has it.
	///
	/// Parameter is <c>object</c> (not <c>dynamic</c>) so the return
	/// type stays statically <c>XDocument</c> at the call site. A
	/// <c>dynamic</c> parameter would make the whole call late-bound,
	/// degrading every downstream call (KindRoot, ExtractorPairs.Add,
	/// LINQ) to dynamic dispatch — and named-tuple/overload-resolution
	/// errors propagate from there. The COM cast happens internally.</summary>
	public static XDocument Parse(object item)
	{
		string xml = (string)((dynamic)item).ProduceXml();
		if (string.IsNullOrEmpty(xml))
			throw new InvalidOperationException("ProduceXml returned empty");
		return XDocument.Parse(xml);
	}

	/// <summary>The first child of <c>&lt;TreeItem&gt;</c> — typically
	/// the kind-specific root (e.g. <c>&lt;Task&gt;</c>,
	/// <c>&lt;LibraryReference&gt;</c>). Throws if the TreeItem
	/// wrapper isn't there; that would mean ProduceXml drifted from
	/// the schema we've been written against.</summary>
	public static XElement KindRoot(XDocument doc)
	{
		var root = doc.Root
			?? throw new InvalidOperationException("ProduceXml has no root element");
		if (root.Name.LocalName != "TreeItem")
			throw new InvalidOperationException(
				$"ProduceXml root is <{root.Name.LocalName}>, expected <TreeItem>");
		var kindRoot = root.Elements().FirstOrDefault()
			?? throw new InvalidOperationException(
				"TreeItem has no child element — empty manifest");
		return kindRoot;
	}

	/// <summary>Get a child element's text content. Null if the
	/// element doesn't exist OR exists but has no text.</summary>
	public static string? ChildText(XElement parent, string name)
	{
		var v = parent.Element(name)?.Value;
		return string.IsNullOrWhiteSpace(v) ? null : v.Trim();
	}

	/// <summary>Get an attribute value. Null if the attribute doesn't
	/// exist OR is empty.</summary>
	public static string? Attr(XElement el, string name)
	{
		var v = el.Attribute(name)?.Value;
		return string.IsNullOrWhiteSpace(v) ? null : v.Trim();
	}

	/// <summary>Parse "TRUE"/"FALSE" (any case) into bool. Null on
	/// anything else, including "0"/"1" — TwinCAT uses the textual
	/// form consistently in ProduceXml.</summary>
	public static bool? ChildBool(XElement parent, string name)
	{
		var t = ChildText(parent, name);
		if (t is null) return null;
		if (t.Equals("TRUE", StringComparison.OrdinalIgnoreCase)) return true;
		if (t.Equals("FALSE", StringComparison.OrdinalIgnoreCase)) return false;
		return null;
	}

	/// <summary>Parse a child element's text as int. Null if missing
	/// or unparseable.</summary>
	public static int? ChildInt(XElement parent, string name)
	{
		var t = ChildText(parent, name);
		if (t is null) return null;
		return int.TryParse(t, System.Globalization.NumberStyles.Integer,
			System.Globalization.CultureInfo.InvariantCulture, out var n) ? n : null;
	}

	/// <summary>All direct children with the given name, in document
	/// order. Empty enumerable if none.</summary>
	public static IEnumerable<XElement> Children(XElement parent, string name)
	{
		return parent.Elements(name);
	}
}
