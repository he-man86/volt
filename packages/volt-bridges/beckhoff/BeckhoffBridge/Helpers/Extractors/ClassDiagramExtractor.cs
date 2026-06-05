namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// UML Class Diagram → minimal text manifest.
///
/// TwinCAT-only kind (ItemType 631). Class diagrams are visual UML
/// composed of class nodes and relationships — same opaque-XML
/// reasoning as visualizations. The diagram structure isn't
/// AI-authored content; we only need structural presence + a count
/// of classes referenced for engineer context.
///
/// ProduceXml shape (typical):
/// <code>
/// &lt;TreeItem&gt;
///   &lt;Name&gt;Class Diagram&lt;/Name&gt;
///   &lt;ClassDiagram&gt;
///     &lt;Classes&gt;
///       &lt;Class name="FB_Motor"/&gt;
///       ...
///     &lt;/Classes&gt;
///   &lt;/ClassDiagram&gt;
/// &lt;/TreeItem&gt;
/// </code>
/// </summary>
internal sealed class ClassDiagramExtractor : IConfigExtractor
{
	public string Kind => "class_diagram";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		int classCount = root.Element("Classes")?.Elements().Count() ?? 0;
		return new ExtractorPairs()
			.Add("class-count", classCount)
			.Build();
	}
}
