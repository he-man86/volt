using System;

namespace Volt.Engine.Ide;

/// <summary>The one DATA-SAFETY policy shared by both drivers' <c>WriteXml</c>: replace a POU by re-import, and if
/// the import fails, restore the original once and rethrow — so a bad edit does not lose or move a POU, PROVIDED the
/// restore itself succeeds. Pinned here (not hand-copied into each driver) because a per-vendor drift in this policy
/// is a silent data-loss bug on that vendor. The vendor supplies the primitives (export/delete/import); the ORDER and
/// the restore guard live once. PLCopenXML carries no folder membership, so a driver's import primitive must target
/// the item's ORIGINAL parent, never the project root.
/// <para>ARCH FOLLOW-UP — the restore is unguarded and unlogged: if <c>import(original)</c> throws, control leaves
/// the catch with the RESTORE exception, the <c>throw;</c> is never reached, and the real import failure (the reason
/// the user's push failed) is lost while the item is already deleted. Nothing here calls <c>VoltLog</c>, against
/// "skipped/errored items are logged, never silently dropped". Fix: catch the primary, attempt the restore in a
/// nested try, log both (Warn when restored, Error when the item is gone) and surface the PRIMARY. That changes the
/// error text on the wire and adds log lines, so it is a change of its own, not a refactor edit.</para></summary>
public static class PlcOpenTransport
{
    public static void ReplaceByReimport(Func<string> exportOriginal, Action delete, Action<string> import, string xml)
    {
        var original = exportOriginal(); // capture BEFORE the delete — the restore copy
        delete();
        try { import(xml); }
        catch { import(original); throw; } // single restore attempt, then rethrow loudly — NB a restore that itself
                                           // throws replaces this exception and the item stays deleted (see the type doc)
    }
}
