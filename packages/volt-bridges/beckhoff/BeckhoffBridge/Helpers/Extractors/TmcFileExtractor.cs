using System.Linq;

namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// TMC file (TwinCAT Module Class) → text manifest of the module's
/// interface surface.
///
/// TMC is TwinCAT's binary-module manifest format — it describes a
/// C++/MATLAB-compiled TcCOM module's data types, interfaces, and
/// parameters. Engineers reference TMC files when integrating
/// pre-compiled C++ modules into PLC projects.
///
/// ProduceXml here returns the FULL .tmc XML (it's already an XML
/// format), wrapped in TreeItem. We surface the high-level shape:
/// module name, version, the data types it declares, and the symbols
/// it publishes. That gives the AI enough context to know what's
/// available without round-tripping the whole TMC content.
///
/// TwinCAT-only kind (ItemType 653). The agent registers it with
/// <c>nameIsVerbatim: true</c> because the bridge sends the file
/// name already carrying <c>.tmc</c> (e.g. "MyProject.tmc"); the
/// materializer skips the usual <c>.${ext}</c> suffix.
/// </summary>
internal sealed class TmcFileExtractor : IConfigExtractor
{
	public string Kind => "tmc_file";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		// The TMC payload is large; we only enumerate the structural
		// summary. Counts come from the typical TMC schema:
		//   Modules > Module > DataTypes > DataType, Interfaces > Interface
		var modules = root.Descendants("Module").FirstOrDefault();
		int dataTypeCount = modules?.Element("DataTypes")?.Elements().Count() ?? 0;
		int interfaceCount = modules?.Element("Interfaces")?.Elements().Count() ?? 0;
		int symbolCount = modules?.Element("Symbols")?.Elements().Count() ?? 0;

		return new ExtractorPairs()
			.Add("module-name", modules?.Element("Name")?.Value?.Trim() ?? ExtractorXml.ChildText(root, "Name"))
			.Add("version", modules?.Element("Version")?.Value?.Trim() ?? ExtractorXml.ChildText(root, "Version"))
			.Add("data-type-count", dataTypeCount)
			.Add("interface-count", interfaceCount)
			.Add("symbol-count", symbolCount)
			.Build();
	}
}
