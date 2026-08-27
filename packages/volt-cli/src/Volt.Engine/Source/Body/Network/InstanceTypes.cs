using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Volt.Engine.Vocabulary;
using Volt.Engine.Source.Body.Network;
using Volt.Engine.Source.Body.St;

namespace Volt.Engine.Source.Body.Network
{
    /// <summary>Instance name → FB type, for the one attribute network text does not carry.
    ///
    /// <para>A PLCopen <c>&lt;block&gt;</c> holds <c>typeName</c> and <c>instanceName</c> as attributes; the
    /// workspace text names only the instance. An operator or a function call carries its own name in the text,
    /// so it needs no lookup — an FB INSTANCE is the single case where the type exists in the XML and not in the
    /// text, and therefore the single case a write has to recover.</para>
    ///
    /// <para><b>There are two sources, and the order matters.</b> The body being REPLACED already carries the
    /// answer, straight from the IDE — <see cref="FromBody"/>. The declaration is a text parse, and a text parse
    /// of Structured Text is an approximation forever: multi-line declarations, block comments spanning lines,
    /// structured types. So the declaration is not the primary source, it is the source for a box that is NEW in
    /// this push and therefore has no existing element to inherit from. That reduces the parser from "must be
    /// perfect on every project" to "must handle the forms an engineer writes when adding a box", and anything
    /// it still misses fails LOUDLY at <see cref="GraphWriter"/> rather than being written as an empty type.</para>
    /// </summary>
    public static class InstanceTypes
    {
        /// <summary>Instance → type harvested from an existing graphical body. AUTHORITATIVE: these attributes
        /// were written by the IDE, so nothing is being inferred.</summary>
        public static Dictionary<string, string> FromBody(XElement? body)
        {
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            if (body is null) return map;
            foreach (var b in body.DescendantsAndSelf().Where(e => e.Name.LocalName == "block"))
            {
                var inst = b.Attribute("instanceName")?.Value;
                var type = b.Attribute("typeName")?.Value;
                if (!string.IsNullOrEmpty(inst) && !string.IsNullOrEmpty(type)) map[inst!] = type!;
            }
            return map;
        }

        // One declaration line: an optional comma-separated declarator list, an optional AT binding, the type,
        // and an optional initializer. Anchored on the trailing ';' so a VAR/END_VAR header cannot match.
        private static readonly Regex Decl = new(
            @"^\s*(?<names>[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?:AT\s+[^:]+?)?\s*:\s*(?<type>[^;]+?)\s*;",
            RegexOptions.Compiled);

        /// <summary>FB instance → type names parsed from a POU declaration.
        /// <para>Handles the forms an engineer actually writes: <c>tmr : TON;</c>, a comma list
        /// (<c>fbUp, fbDown : R_TRIG;</c> — the canonical reason to write one), an initializer
        /// (<c>tmr : TON := (PT := T#5S);</c>), an address binding (<c>trg AT %I* : R_TRIG;</c>) and
        /// <c>ARRAY[..] OF TON</c>. The previous regex was <c>(\w+)\s*:\s*([\w\.]+)\s*;</c>, which matched
        /// <c>name : TYPE ;</c> and nothing else: measured, a comma list yielded ONLY its second declarator and
        /// the other three forms yielded an empty map.</para>
        /// <para>Comments are stripped with <see cref="CodeHelper.CodeOn"/> — the repo's one trivia scanner —
        /// so a declaration trailed by <c>(* … *)</c> still parses and a block comment spanning lines cannot
        /// smuggle its contents in as a declaration.</para></summary>
        public static Dictionary<string, string> Of(string? decl)
        {
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            if (string.IsNullOrEmpty(decl)) return map;

            var inBlockComment = false;
            foreach (var raw in decl!.Replace("\r\n", "\n").Split('\n'))
            {
                var line = CodeHelper.CodeOn(raw, ref inBlockComment);
                if (line.Length == 0) continue;
                var m = Decl.Match(line);
                if (!m.Success) continue;
                if (TypeNameIn(m.Groups["type"].Value) is not { } type) continue;
                foreach (var n in m.Groups["names"].Value.Split(','))
                    map[n.Trim()] = type;
            }
            return map;
        }

        /// <summary>The FB type inside a type expression, or null when there is none to name.
        /// <para><c>ARRAY[1..3] OF TON</c> yields <c>TON</c>: the element type is what an instance of it is. The
        /// initializer is already excluded by the regex, which stops at the first <c>;</c>.</para></summary>
        private static string? TypeNameIn(string typeExpr)
        {
            var t = typeExpr.Trim();
            var of = t.LastIndexOf(" OF ", StringComparison.OrdinalIgnoreCase);
            if (of >= 0) t = t.Substring(of + 4).Trim();
            var m = Regex.Match(t, @"^[A-Za-z_][\w\.]*");
            return m.Success ? m.Value : null;
        }
    }
}
