using System.Globalization;
using System.Xml.Linq;

namespace Volt.Ide.Twincat.Tests;

/// <summary>The NWL item ids of a TwinCAT archive, as the tests read them: a <c>&lt;v n="Id"&gt;</c>, an Int64 archived
/// <c>17L</c> (ld-fbd-coverage gate 2-2: every body a push writes holds each Id once).</summary>
internal static class TcIds
{
    public static bool IsId(XElement v) => (string?)v.Attribute("n") == "Id";

    public static long Value(XElement v) =>
        long.Parse(v.Value.Trim().TrimEnd('L'), NumberStyles.Integer, CultureInfo.InvariantCulture);
}
