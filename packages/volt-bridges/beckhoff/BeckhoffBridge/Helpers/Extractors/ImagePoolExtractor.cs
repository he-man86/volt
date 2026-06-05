namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Image Pool → text manifest listing each image entry.
///
/// ProduceXml shape (typical):
/// <code>
/// &lt;TreeItem&gt;
///   &lt;Name&gt;ImagePool&lt;/Name&gt;
///   &lt;ImagePool&gt;
///     &lt;Images&gt;
///       &lt;Image id="logo"&gt;
///         &lt;FileName&gt;logo.png&lt;/FileName&gt;
///         &lt;Path&gt;...&lt;/Path&gt;
///       &lt;/Image&gt;
///       ...
///     &lt;/Images&gt;
///   &lt;/ImagePool&gt;
/// &lt;/TreeItem&gt;
/// </code>
///
/// Image entries preserve document order — that order is part of the
/// engineer's intent (sequence matters for some visualization
/// fallback paths). Mirrors CODESYS's <c>format_image_pool</c> line
/// shape (<c>image: id=..., name=..., path=...</c>).
/// </summary>
internal sealed class ImagePoolExtractor : IConfigExtractor
{
	public string Kind => "image_pool";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		var pairs = new ExtractorPairs();
		var images = root.Element("Images");
		if (images is not null)
		{
			foreach (var img in images.Elements())
			{
				var id = ExtractorXml.Attr(img, "id");
				var name = ExtractorXml.ChildText(img, "FileName")
					?? ExtractorXml.ChildText(img, "Name");
				var path = ExtractorXml.ChildText(img, "Path");

				var parts = new System.Collections.Generic.List<string>();
				if (id is not null) parts.Add($"id={id}");
				if (name is not null) parts.Add($"name={name}");
				if (path is not null && path != name) parts.Add($"path={path}");
				if (parts.Count > 0)
					pairs.AddRaw($"image: {string.Join(", ", parts)}");
			}
		}
		return pairs.Build();
	}
}
