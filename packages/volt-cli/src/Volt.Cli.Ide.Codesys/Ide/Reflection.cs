using System;
using System.IO;

namespace Volt.Cli.Ide.Codesys
{
    /// <summary>Shared reflection helpers for reaching CODESYS types already loaded in the IDE's
    /// AppDomain, so this DLL needs no compile-time CODESYS reference.</summary>
    internal static class Reflection
    {
        /// <summary>The first loaded type whose full name matches <paramref name="fullName"/>, or null.</summary>
        public static Type? FindType(string fullName)
        {
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type? t = null;
                // ponytail: ONE assembly whose dependencies can't resolve must not abort the scan of the other
                // ~200 loaded in the IDE — but only the load failures GetType documents are swallowed, so an
                // unexpected failure of this primitive (the whole in-proc bridge stands on it) still surfaces
                // instead of reading as "type not present".
                try { t = a.GetType(fullName, false); }
                catch (Exception ex) when (ex is TypeLoadException || ex is FileNotFoundException
                                           || ex is FileLoadException || ex is BadImageFormatException) { }
                if (t != null) return t;
            }
            return null;
        }
    }
}
