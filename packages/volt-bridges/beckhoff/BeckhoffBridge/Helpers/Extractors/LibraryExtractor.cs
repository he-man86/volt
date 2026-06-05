namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Library reference → text manifest.
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
/// Mirrors the CODESYS bridge's <c>format_library_ref</c> output —
/// same keys where the underlying data exists in both vendors, so a
/// library reference written by either bridge looks the same on disk.
/// </summary>
internal sealed class LibraryExtractor : IConfigExtractor
{
	public string Kind => "library";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		return new ExtractorPairs()
			.Add("name", ExtractorXml.ChildText(root, "Title"))
			.Add("placeholder", ExtractorXml.ChildText(root, "PlaceholderName"))
			.Add("namespace", ExtractorXml.ChildText(root, "Namespace"))
			.Add("version", ExtractorXml.ChildText(root, "Version"))
			.Add("distributor", ExtractorXml.ChildText(root, "Distributor"))
			.Add("category", ExtractorXml.ChildText(root, "Category"))
			.Add("resolution", ExtractorXml.ChildText(root, "EffectiveResolution"))
			.Add("default-resolution", ExtractorXml.ChildText(root, "DefaultResolution"))
			.Add("system", ExtractorXml.ChildBool(root, "SystemLibrary"))
			.Add("optional", ExtractorXml.ChildBool(root, "Optional"))
			.Add("qualified-only", ExtractorXml.ChildBool(root, "QualifiedOnly"))
			.Build();
	}
}
