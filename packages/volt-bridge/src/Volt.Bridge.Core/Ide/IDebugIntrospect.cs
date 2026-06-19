using System.Collections.Generic;

namespace Volt.Bridge.Core.Ide;

/// <summary>
/// Optional, diagnostic-only seam surfaced by <c>/debug</c> (DebugService): a vendor may expose the
/// raw type identity it classifies a node by, so a kind that falls to Unknown can be diagnosed from
/// ground truth instead of guesswork. CODESYS returns the <c>IObject</c> interface names (the exact basis
/// <c>CodesysTypeMap.CodeForObject</c> keys on); a vendor that classifies by a native numeric code can
/// return that. Never part of pull/push — a driver that doesn't implement it simply yields no tags.
/// </summary>
public interface IDebugIntrospect
{
    /// <summary>Vendor-specific type tags for a node (e.g. CODESYS IObject interface names). Empty if none.</summary>
    IReadOnlyList<string> TypeTags(ItemRef item);
}
