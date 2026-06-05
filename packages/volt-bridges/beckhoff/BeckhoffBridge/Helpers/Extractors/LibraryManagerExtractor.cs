namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Library Manager (the "References" container under TwinCAT) →
/// minimal text manifest.
///
/// Two-line shape captures the structurally meaningful state — what
/// the manager's name is, and how many library references it
/// currently lists. The individual library refs are emitted as their
/// own items by the walker (they're hybrid container children), so
/// the manager's own manifest doesn't need to enumerate them.
///
/// Beckhoff-only kind — CODESYS drills the Library Manager into
/// individual library refs and doesn't emit the container itself.
/// </summary>
internal sealed class LibraryManagerExtractor : IConfigExtractor
{
	public string Kind => "library_manager";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		int refCount = root.Element("LibraryReferences")?.Elements().Count() ?? 0;
		return new ExtractorPairs()
			.Add("name", ExtractorXml.ChildText(root, "Name"))
			.Add("reference-count", refCount)
			.Build();
	}
}
