using System.Linq;

namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Global Text List → text manifest of every translation row.
///
/// ProduceXml shape (TwinCAT uses a column-per-language schema):
/// <code>
/// &lt;TreeItem&gt;
///   &lt;Name&gt;GlobalTextList&lt;/Name&gt;
///   &lt;GlobalTextList&gt;
///     &lt;Languages&gt;
///       &lt;Language&gt;de&lt;/Language&gt;
///       &lt;Language&gt;en&lt;/Language&gt;
///       ...
///     &lt;/Languages&gt;
///     &lt;Rows&gt;
///       &lt;Row id="HELLO"&gt;
///         &lt;Value language="de"&gt;Hallo&lt;/Value&gt;
///         &lt;Value language="en"&gt;Hello&lt;/Value&gt;
///       &lt;/Row&gt;
///       ...
///     &lt;/Rows&gt;
///   &lt;/GlobalTextList&gt;
/// &lt;/TreeItem&gt;
/// </code>
///
/// Each row renders as <c>&lt;id&gt; | de=Hallo | en=Hello</c> with
/// languages sorted alphabetically for byte-stability (TwinCAT may
/// reorder them per save). Row order preserved (engineer-controlled).
///
/// Mirrors CODESYS's <c>format_text_list</c> line shape.
/// </summary>
internal sealed class TextListExtractor : IConfigExtractor
{
	public string Kind => "text_list";

	public string Extract(object item)
	{
		// Cast Parse/KindRoot results to their static types — passing a
		// `dynamic` arg propagates `dynamic` through the return value,
		// which then breaks LINQ lambdas downstream (CS1977).
		System.Xml.Linq.XDocument doc = ExtractorXml.Parse(item);
		System.Xml.Linq.XElement root = ExtractorXml.KindRoot(doc);

		var pairs = new ExtractorPairs();
		var rows = root.Element("Rows");
		if (rows is null) return pairs.Build();

		foreach (var row in rows.Elements())
		{
			var id = ExtractorXml.Attr(row, "id") ?? "?";
			var values = row.Elements("Value")
				.Select(v => (Lang: ExtractorXml.Attr(v, "language") ?? "", Text: v.Value?.Trim() ?? ""))
				.Where(t => t.Lang.Length > 0)
				.OrderBy(t => t.Lang, System.StringComparer.Ordinal)
				.Select(t => $"{t.Lang}={t.Text}");
			var joined = string.Join(" | ", values);
			pairs.AddRaw(string.IsNullOrEmpty(joined) ? id : $"{id} | {joined}");
		}
		return pairs.Build();
	}
}
