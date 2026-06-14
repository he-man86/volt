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
        private static readonly HashSet<string> InfixOps = new(StringComparer.OrdinalIgnoreCase)
        { "OR", "AND", "XOR", "+", "-", "*", "/", "MOD", ">", "<", ">=", "<=", "=", "<>" };

        private static readonly Dictionary<string, string> OpWordToType = new(StringComparer.OrdinalIgnoreCase)
        { ["OR"] = "OR", ["AND"] = "AND", ["XOR"] = "XOR", ["+"] = "ADD", ["-"] = "SUB",
          ["*"] = "MUL", ["/"] = "DIV", ["MOD"] = "MOD", [">"] = "GT", ["<"] = "LT",
          [">="] = "GE", ["<="] = "LE", ["="] = "EQ", ["<>"] = "NE" };

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
                var asg = SplitAssignment(stmt);              // (lhs, rhs) or null for a bare FB call
                if (asg == null) { ParseFbCall(stmt); return; }
                var (lhs, rhs) = asg.Value;

                if (rhs.StartsWith("(") && rhs.EndsWith(")"))         // named operator block
                    ParseOperator(lhs, rhs.Substring(1, rhs.Length - 2));
                else if (IsCall(rhs))                                 // named function block
                    ParseFunction(lhs, rhs);
                else                                                  // outVariable := <ref/operand>
                    _nodes.Add(new OutVar(_nextId++, null, lhs, Mods.None, RefOf(rhs)));
            }

            // ── statement kinds ───────────────────────────────────────────
            private void ParseFbCall(string stmt)
            {
                var (name, inner) = SplitCall(stmt);
                var pins = SplitArgs(inner).Select(a =>
                {
                    var p = a.Split(new[] { ":=" }, 2, StringSplitOptions.None);
                    if (p.Length != 2) throw new VgParseException("FB call arg needs 'pin := value': " + a);
                    return new Pin(p[0].Trim(), RefOf(p[1].Trim()), Mods.None);
                }).ToList();
                var id = _nextId++;
                _blockByName[name] = id;
                _nodes.Add(new Block(id, null, "", name, pins, new List<string>(), "functionblock"));
            }

            private void ParseOperator(string name, string inner)
            {
                // split on a single infix operator; reject mixed operators (ambiguous topology)
                var toks = Regex.Split(inner.Trim(), @"\s+").Where(t => t.Length > 0).ToList();
                if (toks.Count < 3 || toks.Count % 2 == 0)
                    throw new VgParseException("operator statement must be 'a OP b [OP c …]': " + inner);
                var op = toks[1];
                if (!InfixOps.Contains(op)) throw new VgParseException("unknown operator '" + op + "'");
                var operands = new List<string>();
                for (int i = 0; i < toks.Count; i++)
                {
                    if (i % 2 == 0) operands.Add(toks[i]);
                    else if (!string.Equals(toks[i], op, StringComparison.OrdinalIgnoreCase))
                        throw new VgParseException("one operator per statement; found '" + toks[i] + "' and '" + op + "'");
                }
                var id = _nextId++;
                _blockByName[name] = id;
                var pins = operands.Select((o, k) => new Pin("IN" + (k + 1), RefOf(o), Mods.None)).ToList();
                _nodes.Add(new Block(id, null, OpWordToType[op], null, pins, new List<string> { "OUT" }, "operator"));
            }

            private void ParseFunction(string name, string call)
            {
                var (fn, inner) = SplitCall(call);
                var pins = SplitArgs(inner).Select((a, k) => new Pin("IN" + (k + 1), RefOf(a.Trim()), Mods.None)).ToList();
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
