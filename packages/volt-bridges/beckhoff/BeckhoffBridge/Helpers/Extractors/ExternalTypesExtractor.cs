using System.Linq;

namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// External Types → text manifest listing every typedef.
///
/// TwinCAT-only (ItemType 652). External Types is a container for
/// IEC type aliases imported from C headers or referenced libraries —
/// the engineer's external-binding manifest. We emit one line per
/// type so structural changes (a typedef added / removed / renamed)
/// surface as content drift.
///
/// ProduceXml shape (typical):
/// <code>
/// &lt;TreeItem&gt;
///   &lt;Name&gt;External Types&lt;/Name&gt;
///   &lt;ExternalTypes&gt;
///     &lt;Type name="..." source="..."/&gt;
///     ...
///   &lt;/ExternalTypes&gt;
/// &lt;/TreeItem&gt;
/// </code>
///
/// Type entries are sorted alphabetically by name — TwinCAT's
/// document order varies per save in our observation, so we impose
/// stable order here.
/// </summary>
internal sealed class ExternalTypesExtractor : IConfigExtractor
{
	public string Kind => "external_types";

	public string Extract(object item)
	{
		// Cast Parse/KindRoot results — dynamic propagates through return
		// values when arg is dynamic; breaks LINQ + tuple destructuring.
		System.Xml.Linq.XDocument doc = ExtractorXml.Parse(item);
		System.Xml.Linq.XElement root = ExtractorXml.KindRoot(doc);

		var pairs = new ExtractorPairs();
		var types = root.Element("ExternalTypes") ?? root.Element("Types");
		if (types is null) return pairs.Build();

		var sorted = types
			.Elements()
			.Select(t => (
				Name: ExtractorXml.Attr(t, "name") ?? t.Value?.Trim() ?? "",
				Source: ExtractorXml.Attr(t, "source")))
			.Where(t => t.Name.Length > 0)
			.OrderBy(t => t.Name, System.StringComparer.Ordinal);

		foreach (var (name, source) in sorted)
		{
			pairs.AddRaw(source is null ? $"type = {name}" : $"type = {name} (from {source})");
		}
		return pairs.Build();
	}
}
