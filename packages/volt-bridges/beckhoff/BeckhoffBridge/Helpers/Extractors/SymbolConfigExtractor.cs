namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Symbol Configuration → text manifest.
///
/// ProduceXml shape (typical TC3 XAE):
/// <code>
/// &lt;TreeItem&gt;
///   &lt;Name&gt;SymbolConfiguration&lt;/Name&gt;
///   &lt;SymbolConfiguration&gt;
///     &lt;LibrariesEnabled&gt;TRUE&lt;/LibrariesEnabled&gt;
///     &lt;XmlOutputPath&gt;...&lt;/XmlOutputPath&gt;
///     &lt;PersistEnabled&gt;FALSE&lt;/PersistEnabled&gt;
///     &lt;CommentsEnabled&gt;FALSE&lt;/CommentsEnabled&gt;
///     &lt;Symbols&gt;
///       &lt;Symbol&gt;PLC_PRG.iCounter&lt;/Symbol&gt;
///       ...
///     &lt;/Symbols&gt;
///   &lt;/SymbolConfiguration&gt;
/// &lt;/TreeItem&gt;
/// </code>
///
/// Symbol list is rendered as one line per symbol in document order
/// (TwinCAT preserves the engineer's intended order). Same shape as
/// the task POU call list.
/// </summary>
internal sealed class SymbolConfigExtractor : IConfigExtractor
{
	public string Kind => "symbol_config";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		var pairs = new ExtractorPairs()
			.Add("libraries-enabled", ExtractorXml.ChildBool(root, "LibrariesEnabled"))
			.Add("persist-enabled", ExtractorXml.ChildBool(root, "PersistEnabled"))
			.Add("comments-enabled", ExtractorXml.ChildBool(root, "CommentsEnabled"))
			.Add("xml-output-path", ExtractorXml.ChildText(root, "XmlOutputPath"));

		var symbols = root.Element("Symbols");
		if (symbols is not null)
		{
			foreach (var sym in symbols.Elements())
			{
				var name = sym.Value?.Trim();
				if (!string.IsNullOrEmpty(name))
					pairs.AddRaw($"symbol = {name}");
			}
		}

		return pairs.Build();
	}
}
