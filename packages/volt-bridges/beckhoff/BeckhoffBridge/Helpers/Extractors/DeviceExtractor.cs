using System.Linq;

namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// I/O device → text manifest of its identification + child boxes.
///
/// TwinCAT I/O devices live under <c>TIID</c> (DevicesContainer,
/// ItemType 17) in the system tree, NOT under the PLC NestedProject.
/// They're walked separately by
/// <see cref="BeckhoffConnection.WalkIoDevices"/>.
///
/// ProduceXml shape (EtherCAT-style master, abbreviated):
/// <code>
/// &lt;TreeItem&gt;
///   &lt;Name&gt;Device 1 (EtherCAT)&lt;/Name&gt;
///   &lt;DeviceDef&gt;
///     &lt;DeviceType&gt;94&lt;/DeviceType&gt;
///     &lt;ImageId&gt;ETHERCAT&lt;/ImageId&gt;
///     &lt;Vendor&gt;Beckhoff Automation GmbH&lt;/Vendor&gt;
///     &lt;ProductCode&gt;0x1010&lt;/ProductCode&gt;
///     &lt;Disabled&gt;FALSE&lt;/Disabled&gt;
///     &lt;Boxes&gt;
///       &lt;Box name="Box 1 (AX5103)"&gt;
///         &lt;Type&gt;AX5103&lt;/Type&gt;
///         &lt;Address&gt;1001&lt;/Address&gt;
///       &lt;/Box&gt;
///       ...
///     &lt;/Boxes&gt;
///   &lt;/DeviceDef&gt;
/// &lt;/TreeItem&gt;
/// </code>
///
/// Mirrors CODESYS's <c>format_device</c> output keys:
/// <c>device-type</c> / <c>device-id</c> / <c>device-version</c> /
/// <c>vendor</c> / <c>product</c> / <c>enabled</c>. Adds a Beckhoff-
/// specific child-box listing (CODESYS doesn't have an equivalent
/// concept under a single device — it puts sub-devices at the same
/// tree level).
/// </summary>
internal sealed class DeviceExtractor : IConfigExtractor
{
	public string Kind => "device";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		var pairs = new ExtractorPairs()
			.Add("device-type", ExtractorXml.ChildText(root, "DeviceType"))
			.Add("device-id", ExtractorXml.ChildText(root, "DeviceId") ?? ExtractorXml.ChildText(root, "ImageId"))
			.Add("device-version", ExtractorXml.ChildText(root, "Version"))
			.Add("vendor", ExtractorXml.ChildText(root, "Vendor"))
			.Add("product", ExtractorXml.ChildText(root, "ProductCode") ?? ExtractorXml.ChildText(root, "ProductName"))
			.Add("hardware-revision", ExtractorXml.ChildText(root, "HardwareRevision"))
			.Add("enabled", ExtractorXml.ChildBool(root, "Disabled") is bool d ? !d : (bool?)null);

		// Child boxes (EtherCAT slaves, drives, terminals). Listed in
		// document order — that order matches the physical bus
		// topology in TwinCAT, semantically meaningful.
		var boxes = root.Element("Boxes");
		if (boxes is not null)
		{
			foreach (var box in boxes.Elements())
			{
				var boxName = ExtractorXml.Attr(box, "name") ?? ExtractorXml.ChildText(box, "Name") ?? "?";
				var boxType = ExtractorXml.ChildText(box, "Type");
				var address = ExtractorXml.ChildText(box, "Address");
				var parts = new System.Collections.Generic.List<string>();
				if (boxType is not null) parts.Add($"type={boxType}");
				if (address is not null) parts.Add($"address={address}");
				pairs.AddRaw(parts.Count > 0 ? $"box: {boxName} | {string.Join(", ", parts)}" : $"box: {boxName}");
			}
		}
		return pairs.Build();
	}
}
