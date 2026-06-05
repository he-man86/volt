namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Visualization screen → minimal text manifest (size + element count).
///
/// TwinCAT visualizations are graphical compositions of buttons,
/// frames, rectangles, etc. — the internal element tree IS large
/// XML (often hundreds of KB per screen) and we deliberately do NOT
/// expand it: Volt's AI authors ST, never visualizations, so the
/// internal element structure stays opaque to the agent.
///
/// We still emit the screen as a tracked item so structural presence
/// (added / removed / renamed visualizations) shows up via the
/// agent's structureVersion. The manifest captures the high-level
/// state engineers care about for AI context: dimensions and how
/// busy the screen is.
///
/// Matches the policy of CODESYS's <c>format_visualization</c> —
/// content stays sparse, structural presence carries the signal.
/// </summary>
internal sealed class VisualizationExtractor : IConfigExtractor
{
	public string Kind => "visualization";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		// Element count = number of direct children of Elements, if it
		// exists. We don't recurse — only top-level elements count, on
		// purpose (a frame with 20 sub-elements is one screen-level
		// composition; the engineer's intent is captured at this
		// granularity).
		int elementCount = root.Element("Elements")?.Elements().Count() ?? 0;

		return new ExtractorPairs()
			.Add("width", ExtractorXml.ChildInt(root, "Width"))
			.Add("height", ExtractorXml.ChildInt(root, "Height"))
			.Add("element-count", elementCount)
			.Add("startup", ExtractorXml.ChildText(root, "Startup"))
			.Build();
	}
}
