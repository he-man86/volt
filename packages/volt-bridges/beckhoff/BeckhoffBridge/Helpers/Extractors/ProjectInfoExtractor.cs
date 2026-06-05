using System.Linq;

namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Project Information → text manifest.
///
/// TwinCAT exposes project metadata through the PLC project's
/// <c>ProjectInfo</c> tree item (one level below the PLC project
/// root). ProduceXml shape:
/// <code>
/// &lt;TreeItem&gt;
///   &lt;Name&gt;Project Information&lt;/Name&gt;
///   &lt;ProjectInfo&gt;
///     &lt;Title&gt;...&lt;/Title&gt;
///     &lt;Version&gt;1.0.0.0&lt;/Version&gt;
///     &lt;Author&gt;...&lt;/Author&gt;
///     &lt;Company&gt;...&lt;/Company&gt;
///     &lt;Description&gt;...&lt;/Description&gt;
///     &lt;Released&gt;FALSE&lt;/Released&gt;
///     &lt;CustomFields&gt;
///       &lt;Field name="..."&gt;...&lt;/Field&gt;
///       ...
///     &lt;/CustomFields&gt;
///   &lt;/ProjectInfo&gt;
/// &lt;/TreeItem&gt;
/// </code>
///
/// Mirrors the CODESYS bridge's <c>format_project_info</c> — same
/// `custom:&lt;key&gt; = &lt;value&gt;` line shape for user-defined
/// fields so the manifest is bridge-portable. Custom fields are
/// sorted alphabetically by name for byte-stability across project
/// loads.
/// </summary>
internal sealed class ProjectInfoExtractor : IConfigExtractor
{
	public string Kind => "project_info";

	public string Extract(object item)
	{
		// Cast Parse/KindRoot results — dynamic propagates through return
		// values when arg is dynamic; breaks LINQ + tuple destructuring.
		System.Xml.Linq.XDocument doc = ExtractorXml.Parse(item);
		System.Xml.Linq.XElement root = ExtractorXml.KindRoot(doc);

		var pairs = new ExtractorPairs()
			.Add("title", ExtractorXml.ChildText(root, "Title"))
			.Add("version", ExtractorXml.ChildText(root, "Version"))
			.Add("author", ExtractorXml.ChildText(root, "Author"))
			.Add("company", ExtractorXml.ChildText(root, "Company"))
			.Add("description", ExtractorXml.ChildText(root, "Description"))
			.Add("released", ExtractorXml.ChildBool(root, "Released"));

		var customFields = root.Element("CustomFields");
		if (customFields is not null)
		{
			var sorted = customFields
				.Elements("Field")
				.Select(f => (Name: ExtractorXml.Attr(f, "name") ?? "", Value: f.Value?.Trim() ?? ""))
				.Where(t => t.Name.Length > 0)
				.OrderBy(t => t.Name, System.StringComparer.Ordinal);
			foreach (var (name, value) in sorted)
			{
				if (!string.IsNullOrEmpty(value))
					pairs.AddRaw($"custom:{name} = {value}");
			}
		}

		return pairs.Build();
	}
}
