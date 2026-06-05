using System.Linq;

namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// IEC task → text manifest.
///
/// TwinCAT ProduceXml shape (TC3 XAE, verified shape — fields below
/// may not all appear for every task; e.g. cyclic tasks omit
/// ExtEventName, freerun tasks omit Priority):
/// <code>
/// &lt;TreeItem&gt;
///   &lt;Name&gt;PlcTask&lt;/Name&gt;
///   &lt;ItemType&gt;...&lt;/ItemType&gt;
///   &lt;Task&gt;
///     &lt;Priority&gt;20&lt;/Priority&gt;
///     &lt;CycleTime&gt;100000&lt;/CycleTime&gt;    &lt;!-- ns --&gt;
///     &lt;AdtTasks&gt;0&lt;/AdtTasks&gt;
///     &lt;Disabled&gt;FALSE&lt;/Disabled&gt;
///     &lt;AutoStart&gt;TRUE&lt;/AutoStart&gt;
///     &lt;Watchdog&gt;FALSE&lt;/Watchdog&gt;
///     &lt;WatchdogStack&gt;0&lt;/WatchdogStack&gt;
///     &lt;Comment&gt;...&lt;/Comment&gt;
///     &lt;ExtEventName&gt;...&lt;/ExtEventName&gt;
///     &lt;PouCallList&gt;
///       &lt;Pou&gt;MAIN&lt;/Pou&gt;
///       &lt;Pou&gt;PLC_PRG&lt;/Pou&gt;
///     &lt;/PouCallList&gt;
///   &lt;/Task&gt;
/// &lt;/TreeItem&gt;
/// </code>
///
/// CycleTime is reported in nanoseconds. We emit it verbatim (raw ns)
/// so the manifest stays machine-readable; converting to ms here would
/// lose precision for sub-millisecond cycles.
///
/// POU call list order is semantically meaningful (TwinCAT calls them
/// in the listed sequence). Document order is preserved.
/// </summary>
internal sealed class TaskExtractor : IConfigExtractor
{
	public string Kind => "task";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		var pairs = new ExtractorPairs()
			.Add("priority", ExtractorXml.ChildInt(root, "Priority"))
			.Add("cycle-time-ns", ExtractorXml.ChildInt(root, "CycleTime"))
			.Add("auto-start", ExtractorXml.ChildBool(root, "AutoStart"))
			.Add("disabled", ExtractorXml.ChildBool(root, "Disabled"))
			.Add("watchdog", ExtractorXml.ChildBool(root, "Watchdog"))
			.Add("watchdog-stack", ExtractorXml.ChildInt(root, "WatchdogStack"))
			.Add("ext-event", ExtractorXml.ChildText(root, "ExtEventName"))
			.Add("comment", ExtractorXml.ChildText(root, "Comment"));

		// POU call list — preserve document order. Each entry on its
		// own line as "pou = <Name>" so the manifest matches the
		// CODESYS bridge's task formatter shape exactly.
		var pouList = root.Element("PouCallList");
		if (pouList is not null)
		{
			foreach (var pou in pouList.Elements())
			{
				var name = pou.Value?.Trim();
				if (!string.IsNullOrEmpty(name))
					pairs.AddRaw($"pou = {name}");
			}
		}

		return pairs.Build();
	}
}
