using System.Linq;
using System.Xml.Linq;

namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Library reference → text manifest. Mirrors the CODESYS bridge's
/// <c>format_library_ref</c> output: every field has a matching key
/// on the CODESYS side where the underlying data exists in both
/// vendors, so a library reference written by either bridge looks
/// the same on disk.
///
/// ProduceXml shape (typical):
/// <code>
/// &lt;TreeItem&gt;
///   &lt;Name&gt;Tc2_Standard&lt;/Name&gt;
///   &lt;ItemType&gt;657&lt;/ItemType&gt;
///   &lt;LibraryReference&gt;
///     &lt;Title&gt;Tc2_Standard&lt;/Title&gt;
///     &lt;Version&gt;3.3.3.0&lt;/Version&gt;
///     &lt;Distributor&gt;Beckhoff Automation GmbH&lt;/Distributor&gt;
///     &lt;Category&gt;System&lt;/Category&gt;
///     &lt;Namespace&gt;Tc2_Standard&lt;/Namespace&gt;
///     &lt;PlaceholderName&gt;Tc2_Standard&lt;/PlaceholderName&gt;
///     &lt;EffectiveResolution&gt;Tc2_Standard, 3.3.3.0 (Beckhoff Automation GmbH)&lt;/EffectiveResolution&gt;
///     &lt;DefaultResolution&gt;Tc2_Standard, * (Beckhoff Automation GmbH)&lt;/DefaultResolution&gt;
///     &lt;SystemLibrary&gt;TRUE&lt;/SystemLibrary&gt;
///     &lt;Optional&gt;FALSE&lt;/Optional&gt;
///     &lt;QualifiedOnly&gt;FALSE&lt;/QualifiedOnly&gt;
///   &lt;/LibraryReference&gt;
/// &lt;/TreeItem&gt;
/// </code>
///
/// Additional fields we PROBE (TwinCAT versions vary on which appear
/// in ProduceXml; <c>ExtractorXml.ChildText</c> returns null for
/// missing elements and <c>ExtractorPairs.Add</c> skips null values,
/// so an absent property silently drops its manifest line):
///   <list type="bullet">
///     <item>
///       <description>Dependencies — TwinCAT auto-resolves a transitive
///       dep tree; per <a href="https://infosys.beckhoff.com/content/1033/tc3_plc_intro/4189713803.html">infosys</a>
///       the UI shows the tree. The element naming isn't documented;
///       we probe both <c>&lt;Dependencies&gt;</c> and
///       <c>&lt;DependentLibraries&gt;</c> containers with <c>&lt;Library&gt;</c>
///       or <c>&lt;LibraryReference&gt;</c> children, emit
///       semicolon-joined to match CODESYS's <c>dependencies</c> field.</description>
///     </item>
///     <item>
///       <description>Additional categories — per <a href="https://alltwincat.com/2018/08/16/library-categories/">AllTwinCAT</a>
///       a library can carry multiple categories. We probe a plural
///       <c>&lt;Categories&gt;</c> container alongside the singular
///       <c>&lt;Category&gt;</c> we already read, joining both. Single-category
///       libs (the common case) still emit one value; multi-cat libs
///       expand naturally.</description>
///     </item>
///     <item>
///       <description><c>&lt;Hidden&gt;</c> flag — relevant when this
///       library was added as a sub-library of a parent. Mirrors
///       CODESYS's <c>system_library</c> visibility but is a distinct
///       flag; emit if present.</description>
///     </item>
///   </list>
///
/// To audit what your TwinCAT actually emits, POST to
/// <c>/debug</c> with <c>{"name": "&lt;libname&gt;"}</c> — the response's
/// <c>produceXml</c> field is the raw schema this extractor reads.
/// </summary>
internal sealed class LibraryExtractor : IConfigExtractor
{
	public string Kind => "library";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		var pairs = new ExtractorPairs()
			.Add("name", ExtractorXml.ChildText(root, "Title"))
			.Add("placeholder", ExtractorXml.ChildText(root, "PlaceholderName"))
			.Add("namespace", ExtractorXml.ChildText(root, "Namespace"))
			.Add("version", ExtractorXml.ChildText(root, "Version"))
			.Add("distributor", ExtractorXml.ChildText(root, "Distributor"))
			.Add("category", JoinCategories(root))
			.Add("resolution", ExtractorXml.ChildText(root, "EffectiveResolution"))
			.Add("default-resolution", ExtractorXml.ChildText(root, "DefaultResolution"))
			.Add("system", ExtractorXml.ChildBool(root, "SystemLibrary"))
			.Add("optional", ExtractorXml.ChildBool(root, "Optional"))
			.Add("qualified-only", ExtractorXml.ChildBool(root, "QualifiedOnly"))
			.Add("hidden", ExtractorXml.ChildBool(root, "Hidden"))
			.Add("dependencies", JoinDependencies(root));

		return pairs.Build();
	}

	/// <summary>Read both the singular <c>&lt;Category&gt;</c> and a
	/// plural <c>&lt;Categories&gt;</c> container if present, joining
	/// with "; " into a single line. Most TwinCAT libraries carry one
	/// category and produce a single value identical to the previous
	/// behavior; multi-cat libs (per AllTwinCAT) expand naturally.</summary>
	private static string? JoinCategories(XElement root)
	{
		var values = new System.Collections.Generic.List<string>();
		var single = ExtractorXml.ChildText(root, "Category");
		if (single is not null) values.Add(single);
		var plural = root.Element("Categories");
		if (plural is not null)
		{
			foreach (var c in plural.Elements())
			{
				var t = c.Value?.Trim();
				if (!string.IsNullOrEmpty(t) && !values.Contains(t))
					values.Add(t);
			}
		}
		return values.Count == 0 ? null : string.Join("; ", values);
	}

	/// <summary>Probe for a dependency tree. TwinCAT's ProduceXml schema
	/// for this isn't publicly documented, so we try the two plausible
	/// container names (<c>&lt;Dependencies&gt;</c> first because git/
	/// CODESYS use that idiom; <c>&lt;DependentLibraries&gt;</c> as a
	/// fallback since some TwinCAT areas use that style). Each child
	/// is either a <c>&lt;Library&gt;</c> element with a child text
	/// node, or a self-describing reference. We pull whatever text
	/// content we can, join with "; ", and silently drop on schema
	/// mismatch — better to skip the line than emit garbage.</summary>
	private static string? JoinDependencies(XElement root)
	{
		var container = root.Element("Dependencies") ?? root.Element("DependentLibraries");
		if (container is null) return null;
		var values = container.Elements()
			.Select(e =>
			{
				// Common shapes: <Library>name</Library>,
				// <LibraryReference><Title>name</Title>...</LibraryReference>,
				// or an attribute-only reference.
				var direct = e.Value?.Trim();
				if (!string.IsNullOrEmpty(direct) && !e.HasElements) return direct;
				var title = ExtractorXml.ChildText(e, "Title");
				if (title is not null) return title;
				return ExtractorXml.ChildText(e, "Name");
			})
			.Where(s => !string.IsNullOrEmpty(s))
			.Distinct()
			.ToList();
		return values.Count == 0 ? null : string.Join("; ", values!);
	}
}
