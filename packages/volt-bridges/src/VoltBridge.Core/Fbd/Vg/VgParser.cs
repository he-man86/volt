using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace VoltBridge.Core.Fbd.Vg
{
    /// <summary>
    /// Parses VG text back into a <see cref="GraphBody"/> — the inverse of <see cref="VgWriter"/>.
    /// The bridge uses this purely as a VALIDATING GATE: anything outside the constrained form
    /// (control flow, multi-operator statements, unresolved references) throws
    /// <see cref="VgParseException"/> and the push is rejected. (Preventing such input is the LSP's
    /// job; the bridge only checks and errors.) Leaf operands become <c>inVariable</c> nodes; named
    /// statements become blocks; bare assignments become <c>outVariable</c> nodes. FB-call type
    /// names are NOT in VG (they live in the POU declaration) — they're left empty here and resolved
    /// by the writer.
    /// </summary>
    public static class VgParser
    {
        // Canonical operator table (symbol ↔ type) lives in FbdOperators, shared with the writer.
        public static GraphBody Parse(string text)
        {
            string lang = "FBD";
            var networks = new List<GraphNetwork>();
            NetworkBuilder? cur = null;
            void Flush() { if (cur != null) { networks.Add(cur.Build()); cur = null; } }

            foreach (var raw in text.Replace("\r", "").Split('\n'))
            {
                var line = raw.Trim();
                if (line.Length == 0) continue;
                if (line.StartsWith("%LANG ")) { lang = line.Substring(6).Trim(); continue; }
                if (line.StartsWith("NETWORK"))
                {
                    Flush();
                    cur = new NetworkBuilder(line.Substring("NETWORK".Length).Trim());
                    continue;
                }
                if (cur == null) throw new VgParseException("statement before any NETWORK: " + line);
                if (line.StartsWith("//")) { cur.AddComment(line.Substring(2).Trim()); continue; }
                cur.AddStatement(line.TrimEnd(';').Trim());
            }
            Flush();
            return new GraphBody(lang, networks);
        }

        private sealed class NetworkBuilder
        {
            private readonly string? _label;
            private readonly bool _disabled;
            private readonly List<string> _comments = new();
            private readonly List<GraphNode> _nodes = new();
            private readonly Dictionary<string, long> _blockByName = new(StringComparer.Ordinal);
            private long _nextId = 1;

            public NetworkBuilder(string header)
            {
                _disabled = Regex.IsMatch(header, @"\bDISABLED\b");
                var m = Regex.Match(header, "\"([^\"]*)\"");
                _label = m.Success ? m.Groups[1].Value : null;
            }

            public void AddComment(string c) => _comments.Add(c);

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
                else                                                  // outVariable := <ref/operand>
                {
                    var (core, mods) = ExtractMods(rhs);
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

            /// <summary>Resolve an operand token to a wire: a reference to a named block (optionally
            /// <c>name.Pin</c>) becomes a <see cref="Conn"/> to that block; anything else is a leaf
            /// operand and becomes a fresh <c>inVariable</c>.</summary>
            private Conn RefOf(string token)
            {
                token = token.Trim();
                var dot = token.IndexOf('.');
                var baseName = dot >= 0 ? token.Substring(0, dot) : token;
                if (_blockByName.TryGetValue(baseName, out var bid))
                    return new Conn(bid, dot >= 0 ? token.Substring(dot + 1) : null);
                // A leaf operand must be a single token — an un-named expression (multiple tokens,
                // e.g. "A AND B OR C") is not convertible and is rejected.
                if (token.Length == 0 || Regex.IsMatch(token, @"\s"))
                    throw new VgParseException("operand must be a single value or named reference; "
                        + "wrap operators in their own statement: '" + token + "'");
                var iv = new InVar(_nextId++, null, token, Mods.None);
                _nodes.Add(iv);
                return new Conn(iv.LocalId, null);
            }

            public GraphNetwork Build()
                => new(null, _label, _comments.Count > 0 ? string.Join("\n", _comments) : null, _disabled, _nodes);

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
