using System;
using System.Xml.Linq;
using Volt.Engine.Format.St;

namespace Volt.Ide.Twincat;

/// <summary>
/// A device-tree node's read-only <c>.device</c> descriptor, rendered from the node's own
/// <c>ProduceXml</c> document.
///
/// <para><b>IDENTITY ONLY — never configuration.</b> TwinCAT's <c>ProduceXml</c> for a device is its full
/// settings dump: an EtherCAT master's is ~2.9KB and an EK1100 coupler's ~10.6KB, carrying
/// <c>AmsNetId</c> (which embeds the engineer's machine address), <c>ObjectId</c>, <c>FieldbusAddress</c>,
/// <c>PhysAddr</c>, <c>SerialNo</c>, DC timing windows and per-state transition commands. None of that belongs
/// in a git repository: it is machine- and wiring-specific, it would put a network address in the engineer's
/// history, and because this text IS the item's version-hash input, every unrelated fieldbus tweak would show
/// up as a change to the file. CODESYS answers the same question with a short identity block, and that is what
/// this renders too.</para>
///
/// <para><b>The mapping is by MEANING, not by field name</b>, and it is deliberately partial. The two IDEs do
/// not expose the same facts, so the goal is the same FORMAT and the same KIND of content, not byte equality
/// across vendors — that is unreachable here and pretending otherwise would mean inventing values.
/// <see cref="Descriptor"/> omits an empty value entirely, so a node that lacks a field simply has no such
/// line.</para>
///
/// <list type="bullet">
///   <item><c>Name</c> ← <c>ItemName</c> — the name the engineer sees in the tree.</item>
///   <item><c>Type</c> ← <c>ItemSubTypeName</c> — the readable type ("EtherCAT Master",
///         "EK1100 EtherCAT Coupler (2A E-Bus)").</item>
///   <item><c>ID</c> ← <c>ItemSubType</c> — TwinCAT's numeric type id (111, 9099). Stable for a device type.</item>
///   <item><c>Version</c> ← <c>ProductRevision</c> — the hardware revision string ("EK1100-0000-0018"), present
///         on fieldbus slaves and absent on a master, which is exactly when the line should be absent.</item>
/// </list>
///
/// <para><b>Vendor is deliberately NOT filled.</b> TwinCAT exposes <c>VendorId</c>, a number (Beckhoff is 2),
/// where CODESYS's <c>Vendor</c> is a company NAME. Writing "Vendor: 2" would put a different KIND of value
/// under a shared label — worse than leaving it out, because a reader comparing the two vendors' files would be
/// misled rather than merely under-informed. Likewise <c>ProductCode</c> is not used as <c>ID</c>: it exists
/// only for EtherCAT slaves, so it would make the field mean one thing on a coupler and another on a master.</para>
/// </summary>
internal static class TcDeviceDescriptor
{
    /// <summary>Render the descriptor. Returns null when the document is not a readable <c>TreeItem</c>, so the
    /// caller can fall back to the canonical empty manifest for the kind rather than emit a half-built file.</summary>
    public static string? From(string? produceXml)
    {
        if (string.IsNullOrWhiteSpace(produceXml)) return null;

        XElement root;
        try { root = XElement.Parse(produceXml); }
        catch (System.Xml.XmlException) { return null; }

        // Padding 14 is the DEVICE descriptor's width, shared with CODESYS's renderer. It is a hashed byte, so
        // it is passed explicitly rather than left to the auto-width rule (see Descriptor's own note).
        return new Descriptor(14)
            .Add("Name", Value(root, "ItemName"))
            .Add("Vendor", null)                                // see the type doc: numeric on TwinCAT, a name on CODESYS
            .Add("Type", Value(root, "ItemSubTypeName"))
            .Add("ID", Value(root, "ItemSubType"))
            .Add("Version", Value(root, "ProductRevision"))
            .Add("Order number", null)                          // not exposed by ProduceXml on either node measured
            .Add("Description", Value(root, "DeviceDesc"))
            .ToString();
    }

    /// <summary>The text of the ONE element with this name, anywhere in the document — or null if there is not
    /// exactly one.
    ///
    /// <para>It has to search at depth: the fields are not all at the top. <c>ItemName</c>, <c>ItemSubType</c>
    /// and <c>ItemSubTypeName</c> are direct children of <c>TreeItem</c>, but a slave's <c>ProductRevision</c>
    /// sits at <c>EtherCAT/Slave/Info/</c>. Hard-coding that path would bind this renderer to one fieldbus;
    /// searching by name does not.</para>
    ///
    /// <para><b>"Exactly one" is the guard, and it is why this cannot quietly pick the wrong field.</b> The
    /// dumps DO repeat names at depth — an EK1100 carries several <c>Transition</c> and <c>Cmd</c> blocks — so
    /// a first-match search would be a coin flip the day a field name collides. Measured across both captured
    /// fixtures, every name used here occurs at most once (ProductRevision 1/0, ItemName 1/1, ItemSubTypeName
    /// 1/1, ItemSubType 1/1, DeviceDesc 0/1). If that ever stops holding, the line is dropped rather than
    /// guessed — an absent field, which the descriptor already renders as absent.</para></summary>
    private static string? Value(XElement root, string name)
    {
        string? only = null;
        foreach (var e in root.DescendantsAndSelf(name))
        {
            if (only != null) return null;   // ambiguous — say nothing rather than pick one
            only = e.Value;
        }
        return only;
    }
}
