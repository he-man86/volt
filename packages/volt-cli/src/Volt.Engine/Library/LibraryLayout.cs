using System.Text.RegularExpressions;

namespace Volt.Engine.Library
{
    /// <summary>Where a referenced library's files live in the workspace. ONE definition, because THREE views of
    /// it must agree and did not: the folder the file is WRITTEN to (<c>/fetch</c>'s <c>Changed[].Folder</c>), the
    /// folder the client is TOLD it lives in (<c>Folders</c>, on <c>/fetch</c> AND <c>/refs</c> AND the push
    /// receipt), and the item version's hash basis — or a client that trusts <c>Folders</c> looks for the file where it
    /// was never written.</summary>
    public static class LibraryLayout
    {
    /// <summary>The folder an element goes under when its owning library matched no `.library` reference.
    ///
    /// <para><b>Shared because two places must agree on it.</b> `LibraryFetch` WRITES this tree, and it is the
    /// one library tree with no `.library` stub in it, so the client-side protections that key on stub presence
    /// (`IdeTree.LibraryRoots`: the push read-only guard, the stale-signature removal sweep, the dropped-file check)
    /// recognise it by this name instead — else a `.pou` signature here is a writable project item whose bare-name
    /// collision with a real POU overwrites the engineer's code in the live PLC.</para></summary>
    public const string UnresolvedFolder = "(unresolved)";

        /// <summary>A library's own workspace folder — holding both the <c>.library</c> stub and the element
        /// signatures rendered beside it, so the two always colocate.</summary>
        public static string FolderFor(string? folder, string name) =>
            string.IsNullOrEmpty(folder) ? Sanitize(name) : $"{folder}/{Sanitize(name)}";

        /// <summary>The folder name for an element whose owning library matched no `.library` ref — derived from
        /// the vendor's own <c>LibraryPath</c>, and it must be STABLE ACROSS RUNS AND MACHINES.
        ///
        /// <para>For a library the IDE extracted to a temp directory, the first comma-segment is an ABSOLUTE PATH WITH
        /// A FRESH GUID IN IT (measured: <c>awa-palletizer</c> and <c>bakon-nano</c> gave different GUIDs for the same
        /// library in one session) — used whole, every pull would add a directory and orphan the last, and commit the
        /// username and temp path.</para>
        ///
        /// <para>The stable identity in that string is the library's own FILE NAME. A path-shaped resolution is
        /// reduced to its last segment with the compiled-library extension dropped, so the folder is
        /// <c>Visu_Itfs</c> however the IDE happened to stage the file this run. A resolution that is not
        /// path-shaped — the ordinary <c>Name, Version (Company)</c> — is untouched.</para>
        ///
        /// <para><b>This does not fix WHY it is unresolved</b>, and is not meant to. The ref publishes
        /// <c>RESOLUTION Visu Interfaces, * (System)</c> (a wildcard) while the signature carries the compiled
        /// library's path, so the two sides are matched on strings that cannot be equal. That gap is the subject
        /// of the `(unresolved)` marker itself — this only stops the marker from churning.</para></summary>
        public static string UnresolvedNameFor(string libraryPath)
        {
            var first = (libraryPath ?? "").Split(',')[0].Trim();
            var cut = first.LastIndexOfAny(new[] { '\\', '/' });
            if (cut >= 0) first = first.Substring(cut + 1);

            // `Visu_Itfs.compiled-library-v3` -> `Visu_Itfs`. Only the compiled-library extensions, so a library
            // legitimately named with a dot keeps it.
            foreach (var ext in new[] { ".compiled-library-v3", ".compiled-library", ".library" })
                if (first.EndsWith(ext, System.StringComparison.OrdinalIgnoreCase))
                {
                    first = first.Substring(0, first.Length - ext.Length);
                    break;
                }

            return Sanitize(first.Length > 0 ? first : (libraryPath ?? "").Trim());
        }

        /// <summary>Strip what a Windows path cannot carry — library names and resolutions are free text.
        /// <para>The ONE sanitizer: a backslash in a library name is a path separator on Windows, so it is stripped
        /// too.</para></summary>
        public static string Sanitize(string s) => Regex.Replace(s, "[<>:\"/\\\\|?*]", "_").Trim();
    }
}
