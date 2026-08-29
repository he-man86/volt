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
    /// removal sweep, and the dropped-file check. A `.fb` signature under here was an ordinary writable project
    /// item, so a bare-name collision with a real POU let a declaration-only signature overwrite the engineer's
    /// code in the live PLC. Naming the marker once, here, is what lets the protection recognise it without
    /// anyone fabricating a fake vendor `.library` file to stand in for a library that does not exist.</para></summary>
    public const string UnresolvedFolder = "(unresolved)";

        /// <summary>A library's own workspace folder — holding both the <c>.library</c> stub and the element
        /// signatures rendered beside it, so the two always colocate.</summary>
        public static string FolderFor(string? folder, string name) =>
            string.IsNullOrEmpty(folder) ? Sanitize(name) : $"{folder}/{Sanitize(name)}";

        /// <summary>Strip what a Windows path cannot carry — library names and resolutions are free text.</summary>
        /// <summary>Strip what a Windows path cannot carry — library names and resolutions are free text.
        /// <para>There were TWO of these, and they disagreed: this one wrote the class as <c>[&lt;&gt;:"/\|?*]</c>,
        /// where the <c>\|</c> escapes the PIPE and so leaves a backslash untouched, while the fetch's copy
        /// stripped it. A backslash in a library name is a path separator on Windows, so the lenient rule was the
        /// wrong one; the strict rule wins and there is now one of them.</para></summary>
        public static string Sanitize(string s) => Regex.Replace(s, "[<>:\"/\\\\|?*]", "_").Trim();
    }
}
