using System.Text.RegularExpressions;

namespace Volt.Engine.Library
{
    /// <summary>Where a referenced library's files live in the workspace. ONE definition, because THREE views of
    /// it must agree and did not: the folder the file is WRITTEN to (<c>/fetch</c>'s <c>Changed[].Folder</c>), the
    /// folder the client is TOLD it lives in (<c>Folders</c>, on <c>/fetch</c> AND <c>/refs</c> AND the push
    /// receipt), and the item version's hash basis.
    /// <para>They disagreed in the same response: the stub was written to <c>Library Manager/&lt;lib&gt;/</c> and
    /// reported at <c>Library Manager/</c>, with the version hashed over the folder it is NOT in. A client that
    /// trusts <c>Folders</c> looks for the file where it was never written.</para></summary>
    public static class LibraryLayout
    {
    /// <summary>The folder an element goes under when its owning library matched no `.library` reference.
    ///
    /// <para><b>Shared because two places must agree on it.</b> `LibraryFetch` WRITES this tree, and it is the
    /// one library tree with no `.library` stub in it — so every client-side protection, all of which key on
    /// stub presence (`IdeTree.LibraryRoots`), missed it at once: the push read-only guard, the stale-signature
    /// removal sweep, and the dropped-file check. A `.pou` signature under here was an ordinary writable project
    /// item, so a bare-name collision with a real POU let a declaration-only signature overwrite the engineer's
    /// code in the live PLC. Naming the marker once, here, is what lets the protection recognise it without
    /// anyone fabricating a fake vendor `.library` file to stand in for a library that does not exist.</para></summary>
    public const string UnresolvedFolder = "(unresolved)";

        /// <summary>A library's own workspace folder — holding both the <c>.library</c> stub and the element
        /// signatures rendered beside it, so the two always colocate.</summary>
        public static string FolderFor(string? folder, string name) =>
            string.IsNullOrEmpty(folder) ? Sanitize(name) : $"{folder}/{Sanitize(name)}";

        /// <summary>The folder name for an element whose owning library matched no `.library` ref — derived from
        /// the vendor's own <c>LibraryPath</c>, and it must be STABLE ACROSS RUNS AND MACHINES.
        ///
        /// <para><b>It was not.</b> The name was the whole first comma-segment, sanitized, and for a library the
        /// IDE extracted to a temp directory that segment is an ABSOLUTE PATH WITH A FRESH GUID IN IT —
        /// materializing <c>(unresolved)/_TEMPORARY__C__Users_marce_AppData_Local_Temp_87217613-…-a69c378925bf_
        /// Visu_Itfs.compiled-library-v3/</c>. Measured: <c>awa-palletizer</c> and <c>bakon-nano</c> produced
        /// DIFFERENT GUIDs for the same library in the same session, so every pull adds a directory and orphans
        /// the last one — in the engineer's git repo, forever. It also embeds the username and the machine's temp
        /// path in a committed tree.</para>
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
        /// <para>There were TWO of these, and they disagreed: this one wrote the class as <c>[&lt;&gt;:"/\|?*]</c>,
        /// where the <c>\|</c> escapes the PIPE and so leaves a backslash untouched, while the fetch's copy
        /// stripped it. A backslash in a library name is a path separator on Windows, so the lenient rule was the
        /// wrong one; the strict rule wins and there is now one of them.</para></summary>
        public static string Sanitize(string s) => Regex.Replace(s, "[<>:\"/\\\\|?*]", "_").Trim();
    }
}
