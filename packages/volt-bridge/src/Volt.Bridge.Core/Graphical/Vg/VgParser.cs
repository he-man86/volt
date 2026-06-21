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
            var seenIndices = new HashSet<int>();   // network indices must be unique — duplicates collide localIds
            void Flush() { if (cur != null) { networks.Add(cur.Build()); cur = null; } }

            int lineNum = 0;
            foreach (var raw in text.Replace("\r", "").Split('\n'))
            {
                lineNum++;
                try
                {
                var line = raw.Trim();
                if (line.Length == 0) continue;
                if (line.Equals("END_NETWORK", StringComparison.OrdinalIgnoreCase))
                {
                    // Structure is enforced, not tolerated: a malformed graphical body must be refused (it can
                    // corrupt the IDE on import), never silently reshaped. END_NETWORK closes exactly one open network.
                    if (cur == null) throw new VgParseException("END_NETWORK without an open NETWORK block");
                    Flush();
                    continue;
                }
                if (line.StartsWith("NETWORK"))
                {
                    if (cur != null) throw new VgParseException($"network {cur.Order} is not closed by END_NETWORK", "VG_NETWORK_NOT_CLOSED");
                    // NETWORK <index> <LANG> ["label"] [DISABLED] — the leading integer is the real
                    // network index (preserved verbatim so gapped bodies don't re-number; it bases the
                    // localIds index*10^10+1…, mirroring PlcOpenReader); the next word is the body
                    // language (FBD/LD), carried here instead of a separate %LANG header.
                    var header = line.Substring("NETWORK".Length).Trim();
                    var nm = Regex.Match(header, @"^(\d+)(?:\s+([A-Za-z]\w*))?\s*");
                    int order = nm.Groups[1].Success ? int.Parse(nm.Groups[1].Value) : ordinal;
                    if (!seenIndices.Add(order))
                        throw new VgParseException($"network index {order} appears more than once — indices must be unique (their localIds would collide)", "VG_DUPLICATE_NETWORK");
                    if (nm.Groups[2].Success) lang = nm.Groups[2].Value;
                    cur = new NetworkBuilder(nm.Success ? header.Substring(nm.Length) : header,
                        order, order * NetworkStride + 1);
                    ordinal++;
                    continue;
                }
                if (cur == null) throw new VgParseException("statement before any NETWORK: " + line);
                if (line.StartsWith("//")) { cur.AddComment(line.Substring(2).Trim()); continue; }
                // A `LET <name> := …` introduces an internal wire (the synthetic i*/g*/en* names); a bare
                // `<name> := …` writes a sink. Both buffer as statements — ScanLetWires (in Build) records the
                // LET names so the parser can tell a named producer from an outVariable sink.
                cur.AddStatement(line.TrimEnd(';').Trim(), lineNum);
                }
                catch (VgParseException ex) { ex.Line ??= lineNum; throw; }
            }
            if (cur != null) throw new VgParseException($"network {cur.Order} is not closed by END_NETWORK", "VG_NETWORK_NOT_CLOSED") { Line = lineNum };
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
            private readonly HashSet<string> _declared = new(StringComparer.Ordinal);   // every defined name/label, to refuse duplicates
            // Statements are BUFFERED, then parsed in Build() — a two-pass: a network can't be understood
            // line-by-line (an EN/ENO `en := src` is only recognisable once we've seen its `IF en THEN …`
            // guard). Reusable: the feedback-cycle work needs the same pre-scan-then-parse shape.
            private readonly List<(string Stmt, int Line)> _stmts = new();
            private readonly Dictionary<string, (Conn Conn, Mods Mods)> _enSource = new(StringComparer.Ordinal);
            private readonly Dictionary<string, long> _eno = new(StringComparer.Ordinal);   // en wire → its EN/ENO block (its ENO output)
            private long _nextId;

            public NetworkBuilder(string header, int order, long baseId)
            {
                _order = order;
                _nextId = baseId;   // network-encoded so nodes are unique across networks
                _disabled = Regex.IsMatch(header, @"\bDISABLED\b");
                var m = Regex.Match(header, "\"([^\"]*)\"");
                _label = m.Success ? m.Groups[1].Value : null;
            }

            public int Order => _order;

            public void AddComment(string c) => _comments.Add(c);

            /// <summary>Pass 0: record every <c>LET &lt;name&gt; := …</c> wire definition (the synthetic
            /// i*/g*/en* names — including inside an EN/ENO <c>IF … THEN LET g := …</c> body). A name in this
            /// set is read as a NAMED producer; a bare <c>name := …</c> is an outVariable sink. Replaces the old
            /// VAR_TEMP block — the wire's identity is marked at its definition, not in a header.</summary>
            private void ScanLetWires()
            {
                foreach (var (stmt, _) in _stmts)
                    foreach (Match m in Regex.Matches(stmt, @"\bLET\s+(\w+)\s*:="))
                        _temps.Add(m.Groups[1].Value);
            }

            public void AddStatement(string stmt, int line) => _stmts.Add((stmt, line));

            /// <summary>Names used as an <c>IF &lt;name&gt; THEN … := …</c> guard — the EN/ENO enable wires. A
            /// pre-scan finds them so a preceding <c>&lt;name&gt; := src</c> is read as an EN binding (the box's
            /// EN source), not a leaf/result. (An <c>IF … THEN JMP/RETURN</c> has no <c>:=</c> → not an en wire.)</summary>
            private HashSet<string> ScanEnWires()
            {
                var en = new HashSet<string>(StringComparer.Ordinal);
                foreach (var (stmt, _) in _stmts)
                {
                    var m = Regex.Match(stmt, @"^IF\s+(\w+)\s+THEN\b.*:=", RegexOptions.IgnoreCase);
                    if (m.Success) en.Add(m.Groups[1].Value);
                }
                return en;
            }

            private void ParseStatement(string stmt, HashSet<string> enWires)
            {
                if (stmt.Length == 0) return;
                if (StartsWithWord(stmt, "LET")) stmt = stmt.Substring(3).Trim();   // a wire definition — LET marks lhs as an internal wire
                if (TryControlFlow(stmt)) return;             // label / JMP / RETURN (control flow)

                var enif = Regex.Match(stmt, @"^IF\s+(\w+)\s+THEN\s+(.+?)\s*;?\s*END_IF$", RegexOptions.IgnoreCase);
                if (enif.Success && enWires.Contains(enif.Groups[1].Value))
                { ParseEnEnoIf(enif.Groups[1].Value, enif.Groups[2].Value.Trim()); return; }

                var asg = SplitAssignment(stmt);              // (lhs, rhs) or null for a bare FB call
                if (asg == null) { ParseFbCall(stmt); return; }
                var (lhs, rhs) = asg.Value;
                if (lhs.Length == 0) throw new VgParseException("assignment has no target: '" + stmt + "'", "VG_PARSE");

                if (enWires.Contains(lhs))                    // en := <EN source> — held until its IF builds the box
                { Declare(lhs); _enSource[lhs] = ParseOperand(rhs); return; }

                if (_temps.Contains(lhs))                     // declared temp → a NAMED producer
                {
                    Declare(lhs);
                    if (rhs.StartsWith("(") || IsCall(rhs))   // operator / function block → name its result
                        _blockByName[lhs] = ParseCore(rhs).RefLocalId;
                    else                                      // an OPAQUE leaf the writer couldn't inline (it has spaces/operators)
                    {
                        var (core, mods) = ExtractMods(rhs);
                        EnsureLeafIsSource(core, $"'{lhs} := {rhs}'");   // a leaf is a literal/real-var source, never an alias of a temp
                        var iv = new InVar(_nextId++, null, core, mods);
                        _blockByName[lhs] = iv.LocalId;
                        _nodes.Add(iv);
                    }
                }
                else                                          // not a temp → outVariable sink
                {
                    var (conn, mods) = ParseOperand(rhs);
                    _nodes.Add(new OutVar(_nextId++, null, lhs, mods, conn));
                }
            }

            /// <summary>Rebuild an EN/ENO box from <c>IF en THEN result := &lt;expr&gt;</c>: its EN pin is the
            /// held <c>en</c> source, its operands become <c>In2…</c> pins, and it gains <c>Out2</c>/<c>ENO</c>
            /// outputs. <c>result</c> then names its <c>Out2</c> value and <c>en</c> resolves to its <c>ENO</c>
            /// (downstream EN wires chain off it). Pin names follow TwinCAT's EN/ENO convention.</summary>
            private void ParseEnEnoIf(string en, string body)
            {
                if (!_enSource.TryGetValue(en, out var enSrc))
                    throw new VgParseException($"'IF {en} THEN …' has no preceding '{en} := …' enable assignment", "VG_BAD_EXPRESSION");
                if (StartsWithWord(body, "LET")) body = body.Substring(3).Trim();   // a named EN/ENO result; into-sink bodies stay bare
                var asg = SplitAssignment(body);
                if (asg == null)   // EN/ENO FUNCTION BLOCK: `IF en THEN inst(IN := x); END_IF` — its value outputs are read elsewhere via inst.Pin
                {
                    var (inst, inner) = SplitCall(body);
                    var fbPins = new List<Pin> { new Pin("EN", enSrc.Conn, enSrc.Mods) };
                    fbPins.AddRange(SplitArgs(inner).Select(a =>
                    {
                        var p = a.Split(new[] { ":=" }, 2, StringSplitOptions.None);
                        if (p.Length != 2) throw new VgParseException("FB call arg needs 'pin := value': " + a);
                        var (conn, mods) = ParseOperand(p[1].Trim());
                        return new Pin(p[0].Trim(), conn, mods);
                    }));
                    var fid = _nextId++;
                    Declare(inst);
                    _blockByName[inst] = fid;   // so `inst.Q` etc. resolve downstream
                    _nodes.Add(new Block(fid, null, "", inst, fbPins, new List<string> { "ENO" }, "functionblock"));
                    _eno[en] = fid;             // en resolves to this box's ENO
                    return;
                }
                var (result, rhs) = asg.Value;

                string typeName, callType;
                List<(Conn Conn, Mods Mods)> operands;
                if (rhs.StartsWith("("))
                {
                    var (op, ops) = SplitTopLevelOperator(rhs.Substring(1, rhs.Length - 2));
                    typeName = FbdOperators.SymbolToType[op]; callType = "operator";
                    operands = ops.Select(ParseOperand).ToList();
                }
                else if (IsCall(rhs))
                {
                    var (fn, inner) = SplitCall(rhs);
                    typeName = fn; callType = "function";
                    operands = SplitArgs(inner).Select(ParseOperand).ToList();
                }
                else throw new VgParseException("EN/ENO body must be 'result := (expr)' or 'result := FN(args)': " + body, "VG_BAD_EXPRESSION");

                var id = _nextId++;
                var pins = new List<Pin> { new Pin("EN", enSrc.Conn, enSrc.Mods) };
                for (int k = 0; k < operands.Count; k++) pins.Add(new Pin("In" + (k + 2), operands[k].Conn, operands[k].Mods));
                _nodes.Add(new Block(id, null, typeName, null, pins, new List<string> { "Out2", "ENO" }, callType));
                if (_temps.Contains(result))   // a declared temp → name the box's Out2 value
                { Declare(result); _blockByName[result] = id; }
                else                           // into-sink: `IF en THEN out := …` writes the box straight to a sink
                    _nodes.Add(new OutVar(_nextId++, null, result, Mods.None, new Conn(id, "Out2")));
                _eno[en] = id;                 // en resolves to this box's ENO
            }

            /// <summary>Control flow as valid CODESYS ST: <c>name:</c> (label), <c>JMP name;</c>,
            /// <c>RETURN;</c>, and the conditional <c>IF cond THEN JMP name; END_IF</c> /
            /// <c>IF cond THEN RETURN; END_IF</c>. Returns false if the statement is not control flow.</summary>
            private bool TryControlFlow(string stmt)
            {
                var lbl = Regex.Match(stmt, @"^(\w+)\s*:$");
                if (lbl.Success) { Declare(lbl.Groups[1].Value); _nodes.Add(new Label(_nextId++, null, lbl.Groups[1].Value)); return true; }

                var cif = Regex.Match(stmt, @"^IF\s+(.+?)\s+THEN\s+(JMP\s+(\w+)|RETURN)\s*;?\s*END_IF$", RegexOptions.IgnoreCase);
                if (cif.Success)
                {
                    var (core, mods) = ExtractMods(cif.Groups[1].Value);
                    if (cif.Groups[3].Success) _nodes.Add(new Jump(_nextId++, null, cif.Groups[3].Value, ParseCore(core), mods));
                    else _nodes.Add(new Return(_nextId++, null, ParseCore(core), mods));
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
                    var (conn, mods) = ParseOperand(p[1].Trim());
                    return new Pin(p[0].Trim(), conn, mods);
                }).ToList();
                var id = _nextId++;
                Declare(name);
                _blockByName[name] = id;
                _nodes.Add(new Block(id, null, "", name, pins, new List<string>(), "functionblock"));
            }

            // ── recursive expression engine — the inverse of VgWriter's RenderExpr ───────────────────
            /// <summary>An operand → its producer wire (+ its consuming-pin modifiers). A leading <c>NOT</c> /
            /// trailing edge|storage rides the PIN; the bare core is resolved by <see cref="ParseCore"/>.</summary>
            private (Conn Conn, Mods Mods) ParseOperand(string token)
            {
                var (core, mods) = ExtractMods(token);
                return (ParseCore(core), mods);
            }

            /// <summary>A bare operand core → a wire, creating nodes bottom-up: a parenthesised group is an
            /// operator block, <c>FN(args)</c> a function block, a declared name a reference (<c>name.Pin</c> for
            /// an FB output), and anything else a FRESH leaf <c>inVariable</c> (the controlled relaxation that
            /// lets inlined literals/variables round-trip — each is its own single-use box).</summary>
            private Conn ParseCore(string core)
            {
                core = core.Trim();
                if (IsSingleGroup(core)) return ParseOperatorExpr(core.Substring(1, core.Length - 2));
                if (IsCall(core)) return ParseFunctionExpr(core);
                if (core.IndexOf('(') >= 0 || core.IndexOf(')') >= 0)   // parens that form neither a single group nor a call → malformed
                    throw new VgParseException("malformed expression — unbalanced or partially-parenthesised: '" + core + "'", "VG_BAD_EXPRESSION");
                var dot = core.IndexOf('.');
                var baseName = dot >= 0 ? core.Substring(0, dot) : core;
                if (_eno.TryGetValue(baseName, out var enoBlock)) return new Conn(enoBlock, "ENO");   // an EN/ENO box's enable echo
                if (_blockByName.TryGetValue(baseName, out var bid))
                    return new Conn(bid, dot >= 0 ? core.Substring(dot + 1) : null);
                EnsureLeafIsSource(core, "operand '" + core + "'");   // a leaf is a literal/real-var source, never an alias of a temp
                var iv = new InVar(_nextId++, null, core, Mods.None);   // a literal / variable leaf
                _nodes.Add(iv);
                return new Conn(iv.LocalId, null);
            }

            /// <summary>True iff <paramref name="s"/> is ONE balanced parenthesised group — its outer
            /// <c>(</c> closes only at the very end. Distinguishes <c>(a AND b)</c> (a group) from
            /// <c>(a) + (b)</c> or <c>(a AND b) OR c</c> (which the writer never emits — they're malformed).</summary>
            private static bool IsSingleGroup(string s)
            {
                if (s.Length < 2 || s[0] != '(' || s[s.Length - 1] != ')') return false;
                int depth = 0;
                for (int i = 0; i < s.Length; i++)
                {
                    if (s[i] == '(') depth++;
                    else if (s[i] == ')') { depth--; if (depth == 0 && i < s.Length - 1) return false; }
                }
                return depth == 0;
            }

            private Conn ParseOperatorExpr(string inner)
            {
                var (op, operands) = SplitTopLevelOperator(inner);
                var id = _nextId++;
                var pins = operands.Select((o, k) => { var (conn, mods) = ParseOperand(o); return new Pin("IN" + (k + 1), conn, mods); }).ToList();
                _nodes.Add(new Block(id, null, FbdOperators.SymbolToType[op], null, pins, new List<string> { "OUT" }, "operator"));
                return new Conn(id, null);
            }

            private Conn ParseFunctionExpr(string call)
            {
                var (fn, inner) = SplitCall(call);
                var id = _nextId++;
                var pins = SplitArgs(inner).Select((a, k) => { var (conn, mods) = ParseOperand(a); return new Pin("IN" + (k + 1), conn, mods); }).ToList();
                _nodes.Add(new Block(id, null, fn, null, pins, new List<string> { "OUT" }, "function"));
                return new Conn(id, null);
            }

            /// <summary>A leaf is a real SOURCE — a literal or a real variable — never an alias/modifier of a
            /// temp. A temp is a graph node, so a leaf whose text cites one is not a valid FBD node: a NOT/edge
            /// modifier rides on the CONSUMER (<c>out := NOT g1</c>, not <c>g2 := NOT g1</c>), and an expression
            /// over temps is written inline at its consumer. Emitting it would produce XML referencing temp names
            /// (stripped on push) and CORRUPT the IDE on import — refuse it here.</summary>
            /// <summary>Record a defined name (wire result, leaf, FB instance, EN wire, label) and refuse a
            /// duplicate: two nodes with one name is ambiguous structure — the second silently orphans the first
            /// and corrupts what the IDE re-imports.</summary>
            private void Declare(string name)
            {
                if (!_declared.Add(name))
                    throw new VgParseException($"'{name}' is defined more than once in this network — each wire, result, instance, and label name must be unique", "VG_DUPLICATE_NAME");
            }

            private void EnsureLeafIsSource(string core, string display)
            {
                foreach (Match m in Regex.Matches(core, @"[A-Za-z_]\w*"))
                    if (_temps.Contains(m.Value))
                        throw new VgParseException(
                            $"{display} derives from the temp '{m.Value}', so it is not a valid leaf. A NOT/edge "
                            + "modifier rides on the CONSUMER ('out := NOT g1', not 'g2 := NOT g1'), and an expression "
                            + "over temps is written inline (fully parenthesised) at its consumer.",
                            "VG_LEAF_REFERENCES_TEMP");
            }

            /// <summary>Split a parenthesised operator body into its single operator + operands, respecting
            /// nested parens (each <c>(…)</c> group is ONE operand). The writer fully-parenthesises, so each
            /// level is exactly one operator — mixed operators at one level are malformed.</summary>
            private static (string Op, List<string> Operands) SplitTopLevelOperator(string inner)
            {
                var tokens = new List<string>();
                int depth = 0; var sb = new System.Text.StringBuilder();
                foreach (var ch in inner)
                {
                    if (ch == '(') { depth++; sb.Append(ch); }
                    else if (ch == ')') { depth--; sb.Append(ch); }
                    else if (char.IsWhiteSpace(ch) && depth == 0) { if (sb.Length > 0) { tokens.Add(sb.ToString()); sb.Clear(); } }
                    else sb.Append(ch);
                }
                if (sb.Length > 0) tokens.Add(sb.ToString());

                // Merge a leading NOT onto the operand it negates, so even=operand / odd=operator holds.
                var merged = new List<string>();
                for (int i = 0; i < tokens.Count; i++)
                {
                    if (string.Equals(tokens[i], "NOT", StringComparison.OrdinalIgnoreCase) && i + 1 < tokens.Count)
                    { merged.Add("NOT " + tokens[i + 1]); i++; }
                    else merged.Add(tokens[i]);
                }
                if (merged.Count < 3 || merged.Count % 2 == 0)
                    throw new VgParseException("operator expression must be 'a OP b [OP c …]': " + inner, "VG_BAD_EXPRESSION");
                var op = merged[1];
                if (!FbdOperators.SymbolToType.ContainsKey(op)) throw new VgParseException("unknown operator '" + op + "'", "VG_UNKNOWN_OPERATOR");
                var operands = new List<string>();
                for (int i = 0; i < merged.Count; i++)
                {
                    if (i % 2 == 0) operands.Add(merged[i]);
                    else if (!string.Equals(merged[i], op, StringComparison.OrdinalIgnoreCase))
                        throw new VgParseException("one operator per parenthesised group; found '" + merged[i] + "' and '" + op + "'", "VG_BAD_EXPRESSION");
                }
                return (op, operands);
            }

            public GraphNetwork Build()
            {
                ScanLetWires();                // pass 0: which names are LET-defined internal wires
                var enWires = ScanEnWires();   // pass 1: which names are EN/ENO enable wires
                foreach (var (stmt, line) in _stmts)   // pass 2: parse, attaching the source line to any throw
                    try { ParseStatement(stmt, enWires); }
                    catch (VgParseException ex) { ex.Line ??= line; throw; }
                return new(_order, _label, _comments.Count > 0 ? string.Join("\n", _comments) : null, _disabled, _nodes);
            }

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

    /// <summary>A structured VG diagnostic: a stable <see cref="Code"/> (e.g. VG_LEAF_REFERENCES_TEMP) the AI
    /// can branch on, the 1-based source <see cref="Line"/> within the body (attached by the parse loop), and
    /// the human message. Format-only — it never depends on the actual PLC code semantics.</summary>
    public sealed class VgParseException : Exception
    {
        public string Code { get; }
        public int? Line { get; set; }   // settable: the Parse loop attaches the line a builder throw came from
        public VgParseException(string message, string code = "VG_PARSE") : base(message) { Code = code; }
    }
}
