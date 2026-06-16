using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Volt.Bridge.Core.Graphical.Vg
{
    /// <summary>
    /// Parses VG text back into a <see cref="GraphBody"/> — the inverse of <see cref="VgWriter"/>.
    /// The bridge uses this purely as a VALIDATING GATE: anything outside the strict form (nested
    /// sub-expressions, inline literals/variables as operands, multi-operator statements, unresolved
    /// references) throws <see cref="VgParseException"/> and the push is rejected. (Preventing such
    /// input is the LSP's job; the bridge only checks and errors.) Every node is its own statement:
    /// a <c>VAR_TEMP</c>-declared <c>i*</c> := … is a leaf <c>inVariable</c>; a named <c>g*</c> := op
    /// /call is a block; a bare <c>name</c> := ref is an <c>outVariable</c> sink. The per-network
    /// <c>VAR_TEMP</c> block is consumed (names only — types ignored) and produces no nodes, so it is
    /// stripped on push. FB-call type names are NOT in VG (they live in the POU declaration) — left
    /// empty here and resolved by the writer.
    /// </summary>
    public static class VgParser
    {
        // localIds must encode the network index (index = localId / 10^10), mirroring PlcOpenReader,
        // so a multi-network body's nodes don't collide across networks (they would otherwise all
        // restart at 1 → duplicate localIds → networks collapse / import breaks on push).
        private const long NetworkStride = 10_000_000_000L;

        // Canonical operator table (symbol ↔ type) lives in FbdOperators, shared with the writer.
        public static GraphBody Parse(string text)
        {
            string lang = "FBD";
            var networks = new List<GraphNetwork>();
            NetworkBuilder? cur = null;
            int ordinal = 0;
            bool inTemp = false;
            void Flush() { if (cur != null) { networks.Add(cur.Build()); cur = null; } }

            foreach (var raw in text.Replace("\r", "").Split('\n'))
            {
                var line = raw.Trim();
                if (line.Length == 0) continue;
                if (line.Equals("END_NETWORK", StringComparison.OrdinalIgnoreCase)) { Flush(); inTemp = false; continue; }
                if (line.StartsWith("NETWORK"))
                {
                    Flush();
                    inTemp = false;
                    // NETWORK <index> <LANG> ["label"] [DISABLED] — the leading integer is the real
                    // network index (preserved verbatim so gapped bodies don't re-number; it bases the
                    // localIds index*10^10+1…, mirroring PlcOpenReader); the next word is the body
                    // language (FBD/LD), carried here instead of a separate %LANG header.
                    var header = line.Substring("NETWORK".Length).Trim();
                    var nm = Regex.Match(header, @"^(\d+)(?:\s+([A-Za-z]\w*))?\s*");
                    int order = nm.Groups[1].Success ? int.Parse(nm.Groups[1].Value) : ordinal;
                    if (nm.Groups[2].Success) lang = nm.Groups[2].Value;
                    cur = new NetworkBuilder(nm.Success ? header.Substring(nm.Length) : header,
                        order, order * NetworkStride + 1);
                    ordinal++;
                    continue;
                }
                if (cur == null) throw new VgParseException("statement before any NETWORK: " + line);
                if (line.StartsWith("//")) { cur.AddComment(line.Substring(2).Trim()); continue; }
                // The per-network VAR_TEMP block declares the synthetic temps (i*/g*). It's a VG-only
                // construct: we record the NAMES (to tell a leaf assignment from an outVariable sink)
                // and IGNORE the declared types — types are writer-owned, never load-bearing — then the
                // block creates no nodes and is dropped (stripped on push).
                if (line.Equals("VAR_TEMP", StringComparison.OrdinalIgnoreCase)) { inTemp = true; continue; }
                if (inTemp)
                {
                    if (line.Equals("END_VAR", StringComparison.OrdinalIgnoreCase)) { inTemp = false; continue; }
                    cur.AddTemp(line);
                    continue;
                }
                cur.AddStatement(line.TrimEnd(';').Trim());
            }
            Flush();
            return new GraphBody(lang, networks);
        }

        private sealed class NetworkBuilder
        {
            private readonly int _order;
            private readonly string? _label;
            private readonly bool _disabled;
            private readonly List<string> _comments = new();
            private readonly List<GraphNode> _nodes = new();
            private readonly Dictionary<string, long> _blockByName = new(StringComparer.Ordinal);
            private readonly HashSet<string> _temps = new(StringComparer.Ordinal);
            private long _nextId;

            public NetworkBuilder(string header, int order, long baseId)
            {
                _order = order;
                _nextId = baseId;   // network-encoded so nodes are unique across networks
                _disabled = Regex.IsMatch(header, @"\bDISABLED\b");
                var m = Regex.Match(header, "\"([^\"]*)\"");
                _label = m.Success ? m.Groups[1].Value : null;
            }

            public void AddComment(string c) => _comments.Add(c);

            /// <summary>Record a VAR_TEMP declaration line (<c>name : TYPE;</c>) — the NAME only; the
            /// type is ignored (writer-owned). Marks the name as a synthetic temp so a later
            /// <c>name := …</c> is read as a leaf inVariable, not an outVariable sink.</summary>
            public void AddTemp(string decl)
            {
                var i = decl.IndexOf(':');
                var name = (i >= 0 ? decl.Substring(0, i) : decl.TrimEnd(';')).Trim();
                if (name.Length > 0) _temps.Add(name);
            }

            public void AddStatement(string stmt)
            {
                if (stmt.Length == 0) return;
                if (TryControlFlow(stmt)) return;             // label / JMP / RETURN (control flow)
                var asg = SplitAssignment(stmt);              // (lhs, rhs) or null for a bare FB call
                if (asg == null) { ParseFbCall(stmt); return; }
                var (lhs, rhs) = asg.Value;

                if (rhs.StartsWith("(") && rhs.EndsWith(")"))         // named operator block
                    ParseOperator(lhs, rhs.Substring(1, rhs.Length - 2));
                else if (IsCall(rhs))                                 // named function block
                    ParseFunction(lhs, rhs);
                else
                {
                    var (core, mods) = ExtractMods(rhs);
                    if (_temps.Contains(lhs))                         // declared temp → leaf inVariable
                    {
                        var iv = new InVar(_nextId++, null, core, mods);   // RHS is opaque pin text
                        _blockByName[lhs] = iv.LocalId;
                        _nodes.Add(iv);
                    }
                    else                                             // not a temp → outVariable sink
                        _nodes.Add(new OutVar(_nextId++, null, lhs, mods, RefOf(core)));
                }
            }

            /// <summary>Control flow as valid CODESYS ST: <c>name:</c> (label), <c>JMP name;</c>,
            /// <c>RETURN;</c>, and the conditional <c>IF cond THEN JMP name; END_IF</c> /
            /// <c>IF cond THEN RETURN; END_IF</c>. Returns false if the statement is not control flow.</summary>
            private bool TryControlFlow(string stmt)
            {
                var lbl = Regex.Match(stmt, @"^(\w+)\s*:$");
                if (lbl.Success) { _nodes.Add(new Label(_nextId++, null, lbl.Groups[1].Value)); return true; }

                var cif = Regex.Match(stmt, @"^IF\s+(.+?)\s+THEN\s+(JMP\s+(\w+)|RETURN)\s*;?\s*END_IF$", RegexOptions.IgnoreCase);
                if (cif.Success)
                {
                    var (core, mods) = ExtractMods(cif.Groups[1].Value);
                    if (cif.Groups[3].Success) _nodes.Add(new Jump(_nextId++, null, cif.Groups[3].Value, RefOf(core), mods));
                    else _nodes.Add(new Return(_nextId++, null, RefOf(core), mods));
                    return true;
                }

                var jmp = Regex.Match(stmt, @"^JMP\s+(\w+)$", RegexOptions.IgnoreCase);
                if (jmp.Success) { _nodes.Add(new Jump(_nextId++, null, jmp.Groups[1].Value, null, Mods.None)); return true; }
                if (string.Equals(stmt, "RETURN", StringComparison.OrdinalIgnoreCase))
                { _nodes.Add(new Return(_nextId++, null, null, Mods.None)); return true; }

                return false;
            }

            // ── statement kinds ───────────────────────────────────────────
            private void ParseFbCall(string stmt)
            {
                var (name, inner) = SplitCall(stmt);
                var pins = SplitArgs(inner).Select(a =>
                {
                    var p = a.Split(new[] { ":=" }, 2, StringSplitOptions.None);
                    if (p.Length != 2) throw new VgParseException("FB call arg needs 'pin := value': " + a);
                    var (core, mods) = ExtractMods(p[1].Trim());
                    return new Pin(p[0].Trim(), RefOf(core), mods);
                }).ToList();
                var id = _nextId++;
                _blockByName[name] = id;
                _nodes.Add(new Block(id, null, "", name, pins, new List<string>(), "functionblock"));
            }

            private void ParseOperator(string name, string inner)
            {
                // split on a single infix operator; reject mixed operators (ambiguous topology)
                var rawToks = Regex.Split(inner.Trim(), @"\s+").Where(t => t.Length > 0).ToList();
                // Merge a leading NOT onto the operand it negates, so the even=operand / odd=operator
                // split still holds for negated inputs ("NOT a AND b").
                var toks = new List<string>();
                for (int i = 0; i < rawToks.Count; i++)
                {
                    if (string.Equals(rawToks[i], "NOT", StringComparison.OrdinalIgnoreCase) && i + 1 < rawToks.Count)
                    { toks.Add("NOT " + rawToks[i + 1]); i++; }
                    else toks.Add(rawToks[i]);
                }
                if (toks.Count < 3 || toks.Count % 2 == 0)
                    throw new VgParseException("operator statement must be 'a OP b [OP c …]': " + inner);
                var op = toks[1];
                if (!FbdOperators.SymbolToType.ContainsKey(op)) throw new VgParseException("unknown operator '" + op + "'");
                var operands = new List<string>();
                for (int i = 0; i < toks.Count; i++)
                {
                    if (i % 2 == 0) operands.Add(toks[i]);
                    else if (!string.Equals(toks[i], op, StringComparison.OrdinalIgnoreCase))
                        throw new VgParseException("one operator per statement; found '" + toks[i] + "' and '" + op + "'");
                }
                var id = _nextId++;
                _blockByName[name] = id;
                var pins = operands.Select((o, k) =>
                {
                    var (core, mods) = ExtractMods(o);
                    return new Pin("IN" + (k + 1), RefOf(core), mods);
                }).ToList();
                _nodes.Add(new Block(id, null, FbdOperators.SymbolToType[op], null, pins, new List<string> { "OUT" }, "operator"));
            }

            private void ParseFunction(string name, string call)
            {
                var (fn, inner) = SplitCall(call);
                var pins = SplitArgs(inner).Select((a, k) =>
                {
                    var (core, mods) = ExtractMods(a.Trim());
                    return new Pin("IN" + (k + 1), RefOf(core), mods);
                }).ToList();
                var id = _nextId++;
                _blockByName[name] = id;
                _nodes.Add(new Block(id, null, fn, null, pins, new List<string> { "OUT" }, "function"));
            }

            /// <summary>Resolve an operand to a wire. EVERY operand must be a NAME — a declared temp
            /// (<c>i*</c>/<c>g*</c>) or an FB instance (optionally <c>name.Pin</c>). Inline literals
            /// (`TRUE`), bare variables, or un-named expressions are REJECTED: each must be its own
            /// declared leaf. This is what keeps VG isomorphic to FBD (no syntax for a non-FBD shape).</summary>
            private Conn RefOf(string token)
            {
                token = token.Trim();
                var dot = token.IndexOf('.');
                var baseName = dot >= 0 ? token.Substring(0, dot) : token;
                if (_blockByName.TryGetValue(baseName, out var bid))
                    return new Conn(bid, dot >= 0 ? token.Substring(dot + 1) : null);
                throw new VgParseException("operand must reference a declared temp or FB instance "
                    + "(literals/variables must be their own leaf statement): '" + token + "'");
            }

            public GraphNetwork Build()
                => new(_order, _label, _comments.Count > 0 ? string.Join("\n", _comments) : null, _disabled, _nodes);

            /// <summary>Strip pin/operand modifiers from a VG operand — leading <c>NOT</c>
            /// (negation), trailing <c>RISING</c>/<c>FALLING</c> (edge), trailing <c>SET</c>/
            /// <c>RESET</c> (storage) — returning the bare operand + its <see cref="Mods"/>. Inverse
            /// of <c>VgWriter.ApplyMods</c>.</summary>
            private static (string Core, Mods Mods) ExtractMods(string token)
            {
                token = token.Trim();
                bool neg = false;
                var edge = EdgeMod.None;
                var storage = StorageMod.None;

                if (StartsWithWord(token, "NOT")) { neg = true; token = token.Substring(3).Trim(); }

                bool stripped = true;
                while (stripped)
                {
                    stripped = false;
                    if (EndsWithWord(token, "RISING")) { edge = EdgeMod.Rising; token = Chop(token, 6); stripped = true; }
                    else if (EndsWithWord(token, "FALLING")) { edge = EdgeMod.Falling; token = Chop(token, 7); stripped = true; }
                    else if (EndsWithWord(token, "SET")) { storage = StorageMod.Set; token = Chop(token, 3); stripped = true; }
                    else if (EndsWithWord(token, "RESET")) { storage = StorageMod.Reset; token = Chop(token, 5); stripped = true; }
                }

                var mods = (!neg && edge == EdgeMod.None && storage == StorageMod.None)
                    ? Mods.None : new Mods(neg, edge, storage);
                return (token, mods);
            }

            private static string Chop(string s, int n) => s.Substring(0, s.Length - n).Trim();

            private static bool StartsWithWord(string s, string word) =>
                s.Length > word.Length && s.StartsWith(word, StringComparison.OrdinalIgnoreCase) && char.IsWhiteSpace(s[word.Length]);

            private static bool EndsWithWord(string s, string word) =>
                s.Length > word.Length && s.EndsWith(word, StringComparison.OrdinalIgnoreCase) && char.IsWhiteSpace(s[s.Length - word.Length - 1]);

            // ── tiny helpers ──────────────────────────────────────────────
            private static (string lhs, string rhs)? SplitAssignment(string s)
            {
                var i = s.IndexOf(":=", StringComparison.Ordinal);
                if (i < 0) return null;
                // an FB call ("inst(pin := x)") has its first ':=' INSIDE parentheses
                var paren = s.IndexOf('(');
                if (paren >= 0 && paren < i) return null;
                return (s.Substring(0, i).Trim(), s.Substring(i + 2).Trim());
            }

            private static bool IsCall(string s) => Regex.IsMatch(s, @"^\w[\w]*\(.*\)$");

            private static (string name, string inner) SplitCall(string s)
            {
                var open = s.IndexOf('(');
                if (open < 0 || !s.EndsWith(")")) throw new VgParseException("expected a call: " + s);
                return (s.Substring(0, open).Trim(), s.Substring(open + 1, s.Length - open - 2));
            }

            private static List<string> SplitArgs(string inner)
            {
                inner = inner.Trim();
                if (inner.Length == 0) return new List<string>();
                var args = new List<string>();
                int depth = 0, start = 0;
                for (int i = 0; i < inner.Length; i++)
                {
                    var c = inner[i];
                    if (c == '(') depth++;
                    else if (c == ')') depth--;
                    else if (c == ',' && depth == 0) { args.Add(inner.Substring(start, i - start).Trim()); start = i + 1; }
                }
                args.Add(inner.Substring(start).Trim());
                return args;
            }
        }
    }

    public sealed class VgParseException : Exception
    {
        public VgParseException(string message) : base(message) { }
    }
}
