using System;

namespace Volt.Bridge.Codesys
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
                try { t = a.GetType(fullName, false); } catch { }
                if (t != null) return t;
            }
            return null;
        }
    }
}
