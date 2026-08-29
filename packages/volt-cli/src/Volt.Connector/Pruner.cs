using System;
using System.IO;
using System.Linq;
using Volt.Contracts;

namespace Volt.Connector
{
    /// <summary>
    /// Removes superseded version directories from a versioned install (…\Programs\Volt\app-&lt;version&gt;\).
    ///
    /// The installer never prunes: at install time the outgoing version is still in use (its processes are running,
    /// and the connector may be the very process that launched setup). The connector does it instead — at startup,
    /// when nothing holds the superseded directories. Best-effort: a directory still locked (e.g. an editor left the
    /// desktop app open) is logged and skipped, never fatal, and removed on a later start. Retains at most two.
    /// </summary>
    internal static class Pruner
    {
        private const int Retain = 2;

        public static void PruneOldVersions()
        {
            try
            {
                // The connector runs from …\Programs\Volt\app-<version>\VoltConnector.exe, so BaseDirectory IS the
                // active version dir and its parent is the install root. (When running flat/dev there is no app-*
                // sibling, so this simply finds nothing to prune.)
                var active = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
                var root = Directory.GetParent(active)?.FullName;
                if (root == null || !Directory.Exists(root)) return;

                var versionDirs = Directory.GetDirectories(root, "app-*");
                if (versionDirs.Length <= Retain) return;

                // Newest first by directory name. app-<X.Y.Z.build> sorts correctly as an ordinal string only while
                // the numeric fields keep their width; builds are a monotonic commit count, so in practice this is
                // the right order. Always keep the active dir even if the ordering somehow disagrees, then keep the
                // next newest up to Retain; delete the rest.
                var keep = versionDirs
                    .OrderByDescending(d => d, StringComparer.OrdinalIgnoreCase)
                    .Take(Retain)
                    .ToList();
                if (!keep.Any(d => PathEquals(d, active)) && Directory.Exists(active))
                    keep[keep.Count - 1] = active; // swap the oldest kept for the active one (the early return
                                                   // above guarantees Take(Retain) yielded exactly Retain entries)

                foreach (var dir in versionDirs)
                {
                    if (keep.Any(k => PathEquals(k, dir))) continue;
                    try
                    {
                        Directory.Delete(dir, recursive: true);
                        VoltLog.Info($"pruned superseded version dir {Path.GetFileName(dir)}");
                    }
                    catch (Exception e)
                    {
                        // Locked (a process still holds a file, most often the desktop app). Leave it — the next
                        // startup retries. Never let cleanup break the connector.
                        VoltLog.Warn($"could not prune {Path.GetFileName(dir)} (in use), will retry next start: {e.Message}");
                    }
                }
            }
            catch (Exception e)
            {
                VoltLog.Warn($"prune skipped: {e.Message}");
            }
        }

        private static bool PathEquals(string a, string b) =>
            string.Equals(a.TrimEnd(Path.DirectorySeparatorChar), b.TrimEnd(Path.DirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase);
    }
}
