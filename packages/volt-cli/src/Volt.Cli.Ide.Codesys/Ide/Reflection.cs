using System;
using System.IO;
using System.Linq;
using System.Reflection;

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

        /// <summary>The first loaded ENUM whose SIMPLE name matches, or null. Separate from
        /// <see cref="FindType"/> because CODESYS's enums are reached by simple name (their namespace varies by
        /// version), which needs <c>GetTypes()</c> rather than a full-name lookup.
        /// <para>It lives here so there is ONE place that walks the AppDomain: two hand-rolled copies of this
        /// scan had drifted, and the copy that mattered swallowed <em>every</em> exception from
        /// <c>GetTypes()</c> — including an unexpected failure of the primitive the whole in-proc bridge stands
        /// on — where this one swallows only the load failures the API documents.</para></summary>
        public static Type? FindEnum(string simpleName)
        {
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type[] types;
                try { types = a.GetTypes(); }
                catch (ReflectionTypeLoadException ex) { types = ex.Types.Where(t => t != null).ToArray()!; }
                catch (Exception ex) when (ex is TypeLoadException || ex is FileNotFoundException
                                           || ex is FileLoadException || ex is BadImageFormatException) { continue; }
                foreach (var t in types)
                    if (t.IsEnum && t.Name == simpleName) return t;
            }
            return null;
        }
    }
}
