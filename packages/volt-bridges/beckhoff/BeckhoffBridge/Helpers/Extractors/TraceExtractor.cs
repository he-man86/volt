namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Trace → text manifest of its sampling + trigger configuration.
///
/// TwinCAT Trace is typically a system-level service (TIPC tree), but
/// it also surfaces as a configurable child of the PLC project under
/// some XAE configurations. The bridge emits whichever it walks into.
/// When the walker hits an item Beckhoff hasn't yet mapped (logged via
/// <c>WarnUnknownCode</c> in BlockTypeMapper), add a `Trace` constant +
/// `ToConfigKind` case there; the extractor below is already wired in.
///
/// Mirrors CODESYS's <c>format_trace</c> key set so the manifest is
/// bridge-portable — a `.trace` file produced by either bridge has the
/// same shape on disk.
///
/// Probable ProduceXml shape (modeled on CODESYS's exposed properties;
/// TwinCAT XML tag names may differ — extra/missing fields degrade
/// gracefully to "empty pairs" via <see cref="ExtractorXml.ChildText"/>
/// returning null):
/// <code>
/// &lt;TreeItem&gt;
///   &lt;Trace&gt;
///     &lt;Resolution&gt;MilliSeconds&lt;/Resolution&gt;
///     &lt;Task&gt;PlcTask&lt;/Task&gt;
///     &lt;SamplePeriod&gt;10&lt;/SamplePeriod&gt;
///     &lt;TriggerVariable&gt;PLC_PRG.bTrigger&lt;/TriggerVariable&gt;
///     &lt;TriggerEdge&gt;Positive&lt;/TriggerEdge&gt;
///     &lt;TriggerPosition&gt;50&lt;/TriggerPosition&gt;
///   &lt;/Trace&gt;
/// &lt;/TreeItem&gt;
/// </code>
/// </summary>
internal sealed class TraceExtractor : IConfigExtractor
{
	public string Kind => "trace";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		return new ExtractorPairs()
			.Add("resolution", ExtractorXml.ChildText(root, "Resolution"))
			.Add("task", ExtractorXml.ChildText(root, "Task"))
			.Add("sample-period", ExtractorXml.ChildText(root, "SamplePeriod"))
			.Add("trigger-variable", ExtractorXml.ChildText(root, "TriggerVariable"))
			.Add("trigger-edge", ExtractorXml.ChildText(root, "TriggerEdge"))
			.Add("trigger-position", ExtractorXml.ChildText(root, "TriggerPosition"))
			.Build();
	}
}
