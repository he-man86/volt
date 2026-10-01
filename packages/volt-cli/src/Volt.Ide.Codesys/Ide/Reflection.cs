using System;
using System.IO;
using System.Linq;
using System.Reflection;

namespace Volt.Ide.Codesys
{
    /// <summary>Shared reflection helpers for reaching CODESYS types already loaded in the IDE's
    /// AppDomain, so this DLL needs no compile-time CODESYS reference.</summary>
    internal static class Reflection
    {
        /// <summary>The overload of <paramref name="name"/> among <paramref name="methods"/> that takes
        /// <paramref name="args"/> — chosen by the arguments' TYPES, not merely their count — or null when no
        /// method of that name and arity exists (the one answer a caller may treat as "not there").
        ///
        /// <para><b>Name + arity is not an identity on the vendor's surface.</b> The binders here used to take "the
        /// first method with this name and this many parameters", on the belief that no CODESYS surface has two of
        /// the same arity. SP21's <c>IObjectManager</c> has two: <c>GetObjectToRead(int nProjectHandle, int nIndex)</c>
        /// and <c>GetObjectToRead(int nProjectHandle, Guid objectGuid)</c>, and the same pair for
        /// <c>GetObjectToModify</c> (DIALECT C26). "First" is the runtime's <c>GetMethods()</c> order, which the CLR
        /// does not specify and which CHANGES inside one running IDE — measured on a Pro2193 copy: <c>(Int32, Guid)</c>
        /// listed first in a fresh session, <c>(Int32, Int32)</c> first after one scripting read. From then on every
        /// object read passed a Guid as an index and <c>refs</c> failed the whole project with
        /// <c>Object of type 'System.Guid' cannot be converted to type 'System.Int32'</c>.</para>
        ///
        /// <para>The choice is the framework's own overload resolution (<see cref="Type.DefaultBinder"/>): a
        /// candidate whose parameters cannot take the arguments is never called, and two that both could are an
        /// <see cref="AmbiguousMatchException"/> — loud, never a coin toss. Arguments that fit no candidate throw
        /// <see cref="MissingMethodException"/> naming their types.</para></summary>
        public static MethodInfo? Overload(System.Collections.Generic.IEnumerable<MethodInfo> methods, string name, object?[] args)
        {
            var candidates = methods.Where(m => m.Name == name && m.GetParameters().Length == args.Length)
                                    .Cast<MethodBase>().ToArray();
            if (candidates.Length == 0) return null;
            var bound = (object?[])args.Clone();   // BindToMethod may rewrite the array; the caller's stays as given
            try
            {
                return (MethodInfo)Type.DefaultBinder.BindToMethod(
                    BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic,
                    candidates, ref bound, null, null, null, out _);
            }
            catch (MissingMethodException)
            {
                throw new MissingMethodException(
                    $"No '{name}' on {candidates[0].DeclaringType?.FullName} takes ({string.Join(", ", args.Select(a => a?.GetType().Name ?? "null"))}) - " +
                    $"it has {string.Join(" | ", candidates.Select(c => $"{name}({string.Join(", ", c.GetParameters().Select(p => p.ParameterType.Name))})"))}");
            }
        }

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
        /// <summary>A loaded type by SIMPLE name — the scripting API's helper objects are reached that way
        /// because their namespace varies by CODESYS version, the same reason <see cref="FindEnum"/> exists.</summary>
        public static Type? FindTypeBySimpleName(string simpleName)
        {
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type[] types;
                try { types = a.GetTypes(); }
                catch (ReflectionTypeLoadException ex) { types = ex.Types.Where(t => t != null).ToArray()!; }
                catch (Exception ex) when (ex is TypeLoadException || ex is FileNotFoundException) { continue; }
                foreach (var t in types)
                    if (t != null && string.Equals(t.Name, simpleName, StringComparison.Ordinal)) return t;
            }
            return null;
        }

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
