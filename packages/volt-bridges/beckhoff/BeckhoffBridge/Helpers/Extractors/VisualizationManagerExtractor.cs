namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Visualization Manager → text manifest of its settings.
///
/// ProduceXml shape (typical):
/// <code>
/// &lt;TreeItem&gt;
///   &lt;Name&gt;Visualization Manager&lt;/Name&gt;
///   &lt;VisualizationManager&gt;
///     &lt;UsedTextList&gt;GlobalTextList&lt;/UsedTextList&gt;
///     &lt;UsedImagePool&gt;ImagePool&lt;/UsedImagePool&gt;
///     &lt;StartupVisualization&gt;Main&lt;/StartupVisualization&gt;
///     &lt;Style&gt;Default style, 3.5.x.x&lt;/Style&gt;
///     &lt;TargetVisualization&gt;Main&lt;/TargetVisualization&gt;
///     &lt;ScreenResolution&gt;1920x1080&lt;/ScreenResolution&gt;
///   &lt;/VisualizationManager&gt;
/// &lt;/TreeItem&gt;
/// </code>
///
/// Mirrors CODESYS's <c>format_visualization_manager</c> key set.
/// </summary>
internal sealed class VisualizationManagerExtractor : IConfigExtractor
{
	public string Kind => "visualization_manager";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		return new ExtractorPairs()
			.Add("used-text-list", ExtractorXml.ChildText(root, "UsedTextList"))
			.Add("used-image-pool", ExtractorXml.ChildText(root, "UsedImagePool"))
			.Add("startup-visualization", ExtractorXml.ChildText(root, "StartupVisualization"))
			.Add("style", ExtractorXml.ChildText(root, "Style"))
			.Add("target-visualization", ExtractorXml.ChildText(root, "TargetVisualization"))
			.Add("screen-resolution", ExtractorXml.ChildText(root, "ScreenResolution"))
			.Build();
	}
}
