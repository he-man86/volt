using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Volt.Engine.Workspace.SourceText
{
    /// <summary>Instance name → FB type, read out of a POU's ST DECLARATION text.
    /// <para>It lived in the PLCopen document class, where it was the one member that never touched XML. It is a
    /// regex over Structured Text, so it belongs with the other ST text readers. Its caller needs it because VG
    /// omits an FB instance's type — the declaration is where that type comes back from.</para></summary>
    public static class InstanceTypes
    {
        /// <summary>FB instance → type names parsed from a POU declaration (e.g. <c>tmr : TON;</c>),
        /// so the writer can restore the <c>typeName</c> that VG does not carry.</summary>
        public static Dictionary<string, string> Of(string? decl)
        {
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (Match m in Regex.Matches(decl ?? "", @"(\w+)\s*:\s*([\w\.]+)\s*;"))
                map[m.Groups[1].Value] = m.Groups[2].Value;
            return map;
        }
    }
}
