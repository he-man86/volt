using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Volt.Engine.Format.Network;

/// <summary>
/// Parses network text into a <see cref="NetworkBody"/> — the inverse of <see cref="NetworkTextWriter"/>, and
/// a VALIDATING GATE: anything outside the strict form specified in <c>docs/network-text.md</c> throws
/// <see cref="NetworkTextException"/> and the push is refused. Preventing such input is the LSP's job; this
/// only checks and errors.
///
/// <para><b>The tree model removed the reader's hardest job.</b> The previous reader had to allocate a
/// <c>localId</c> for every node, band them per network (<c>index * 10^10 + n</c>, or a multi-network body's
/// ids collided and the networks collapsed on import), and rebuild wires as <c>refLocalId</c> references.
/// Network text is nested expressions and the model is now a tree, so parsing is a direct descent and the
/// identifiers never come into existence.</para>
///
/// <para><b>What a <c>LET</c> becomes is decided by USE COUNT, and that is the one real decision here.</b> A
/// wire named once is a textual necessity, not a structure: <c>LET i1 := NOT b; out := (a AND i1)</c> means the
/// same tree as <c>out := (a AND NOT b)</c>, so a single-use name is substituted back into its consumer. A name
/// used twice or more IS a structure — the value genuinely feeds two consumers — so it stays, as an
/// <see cref="Assign"/> to that name plus a <see cref="Network.SplitPoints"/> entry. That is exactly the
/// vendor's own split-point concept, so the round-trip is faithful in both directions.</para>
/// </summary>
public static class NetworkTextReader
{
    public static NetworkBody Parse(string text)
    {
        var language = BodyLanguage.Fbd;
        var networks = new List<Network>();
        Builder? cur = null;
        var seen = new HashSet<int>();

        var lines = text.Replace("\r", "").Split('\n');
        string? pendingEn = null;

        for (int i = 0; i < lines.Length; i++)
        {
            int lineNo = i + 1;
            try
            {
                var line = lines[i].Trim();
                if (line.Length == 0) continue;

                if (line.Equals("END_NETWORK", StringComparison.OrdinalIgnoreCase))
                {
                    if (cur == null) throw new NetworkTextException("END_NETWORK without an open NETWORK block");
                    networks.Add(cur.Build());
                    cur = null;
                    continue;
                }

                // On a WORD BOUNDARY, not a prefix: `NETWORK_OK := TRUE;` is an ordinary statement and
                // `NETWORK_OK` is an ordinary PLC identifier, but a bare StartsWith read it as a header and
                // refused the whole push pointing at a line that was not the problem.
                if (line.StartsWith("NETWORK", StringComparison.Ordinal)
                    && (line.Length == 7 || !(char.IsLetterOrDigit(line[7]) || line[7] == '_')))
                {
                    if (cur != null)
                        throw new NetworkTextException($"network {cur.Order} is not closed by END_NETWORK", "NETWORK_NOT_CLOSED");
                    var header = line.Substring("NETWORK".Length).Trim();
                    var m = Regex.Match(header, @"^(\d+)(?:\s+([A-Za-z]\w*))?\s*");
                    if (!m.Success || !m.Groups[1].Success)
                        throw new NetworkTextException("NETWORK header needs an index: NETWORK <n> <FBD|LD>");
                    int order = int.Parse(m.Groups[1].Value);
                    if (!seen.Add(order))
                        throw new NetworkTextException(
                            $"network index {order} appears more than once — indices must be unique",
                            "NETWORK_DUPLICATE_NETWORK");
                    if (m.Groups[2].Success)
                    {
                        var tag = m.Groups[2].Value;
                        if (tag.Equals("LD", StringComparison.OrdinalIgnoreCase)) language = BodyLanguage.Ld;
                        else if (tag.Equals("FBD", StringComparison.OrdinalIgnoreCase)) language = BodyLanguage.Fbd;
                        else throw new NetworkTextException($"unknown body language '{tag}' (expected FBD or LD)");
                    }
                    cur = new Builder(order, header.Substring(m.Length));
                    continue;
                }

                if (cur == null) throw new NetworkTextException("statement before any NETWORK: " + line);

                if (line.StartsWith("//", StringComparison.Ordinal)) { cur.AddComment(line.Substring(2).Trim()); continue; }

                // A multi-line `IF <en> THEN` guarding an EXECUTE block.
                var guard = Regex.Match(line, @"^IF\s+(\w+)\s+THEN$", RegexOptions.IgnoreCase);
                if (guard.Success) { pendingEn = guard.Groups[1].Value; continue; }

                if (line.Equals("EXECUTE", StringComparison.OrdinalIgnoreCase))
                {
                    var st = new List<string>();
                    int j = i + 1;
                    // BOUNDED at the network boundary. Without this a missing END_EXECUTE swallowed every
                    // following network into one box's verbatim ST, and survived validation because that ST is
                    // re-emitted verbatim — a single typo pushed the whole body to the IDE as flat ST.
                    for (; j < lines.Length; j++)
                    {
                        var t = lines[j].Trim();
                        if (t.Equals("END_EXECUTE", StringComparison.OrdinalIgnoreCase)) break;
                        if (t.Equals("END_NETWORK", StringComparison.OrdinalIgnoreCase) ||
                            t.StartsWith("NETWORK", StringComparison.OrdinalIgnoreCase))
                            throw new NetworkTextException("EXECUTE without a closing END_EXECUTE", "NETWORK_PARSE") { Line = lineNo };
                        st.Add(lines[j]);
                    }
                    if (j >= lines.Length)
                        throw new NetworkTextException("EXECUTE without a closing END_EXECUTE", "NETWORK_PARSE") { Line = lineNo };
                    cur.AddExecute(pendingEn, string.Join("\n", st));
                    i = j;
                    if (pendingEn != null)
                    {
                        int k = i + 1;
                        while (k < lines.Length && lines[k].Trim().Length == 0) k++;
                        if (k >= lines.Length || !lines[k].Trim().Equals("END_IF", StringComparison.OrdinalIgnoreCase))
                            throw new NetworkTextException("an EN-guarded EXECUTE needs a closing END_IF", "NETWORK_PARSE") { Line = lineNo };
                        i = k;
                    }
                    pendingEn = null;
                    continue;
                }

                cur.AddStatement(line);
            }
            catch (NetworkTextException ex)
            {
                ex.Line ??= lineNo;
                throw;
            }
        }

        if (cur != null) throw new NetworkTextException($"network {cur.Order} is not closed by END_NETWORK", "NETWORK_NOT_CLOSED");
        return new NetworkBody(language, networks);
    }

    // ── one network ───────────────────────────────────────────────────────────────────────────────

    private sealed class Builder
    {
        public int Order { get; }
        private readonly string? _title;
        private readonly bool _disabled;
        private readonly List<string> _comments = new();
        private string? _label;

        /// <summary>Statements in source order. A LET carries its name; everything else has none.</summary>
        private readonly List<(string? Let, Node Node)> _stmts = new();
        private readonly Dictionary<string, Node> _lets = new(StringComparer.Ordinal);

        public Builder(int order, string rest)
        {
            Order = order;
            var q = Regex.Match(rest, "\"([^\"]*)\"");
            if (q.Success) _title = q.Groups[1].Value;
            _disabled = Regex.IsMatch(rest, @"\bDISABLED\b", RegexOptions.IgnoreCase);
        }

        public void AddComment(string c) => _comments.Add(c);

        public void AddExecute(string? en, string st)
        {
            var box = new Box("EXECUTE", null, CallKind.Function, new List<Input>(), new List<Operand>(),
                              en is null ? null : new Leaf(new Operand(en), Flags.None), st, Flags.None);
            _stmts.Add((null, box));
        }

        public void AddStatement(string raw)
        {
            var line = raw.TrimEnd();
            if (line.EndsWith(";", StringComparison.Ordinal)) line = line.Substring(0, line.Length - 1).TrimEnd();

            // `IF <cond> THEN <inner>; END_IF` — an enabled box, a conditional jump, or a conditional return.
            var iff = Regex.Match(raw.Trim(), @"^IF\s+(.+?)\s+THEN\s+(.+?);?\s*END_IF$", RegexOptions.IgnoreCase);
            if (iff.Success)
            {
                var cond = ParseOperand(iff.Groups[1].Value);
                var inner = iff.Groups[2].Value.Trim().TrimEnd(';').Trim();

                var jmp = Regex.Match(inner, @"^JMP\s+(\w+)$", RegexOptions.IgnoreCase);
                if (jmp.Success)
                {
                    _stmts.Add((null, new Assign(cond, new List<Operand> { new(jmp.Groups[1].Value) },
                                                 Flags.None with { Jump = true })));
                    return;
                }
                if (inner.Equals("RETURN", StringComparison.OrdinalIgnoreCase))
                {
                    _stmts.Add((null, new Assign(cond, new List<Operand>(), Flags.None with { Return = true })));
                    return;
                }

                // An enabled box: parse the inner statement, then hang the enable on the box it produced.
                var (let, node) = ParseSimple(inner);
                _stmts.Add((let, Enable(node, cond)));
                if (let != null) _lets[let] = ((Assign)_stmts[_stmts.Count - 1].Node).Value!;
                return;
            }

            if (Regex.IsMatch(line, @"^JMP\s+\w+$", RegexOptions.IgnoreCase))
            {
                _stmts.Add((null, new Assign(null, new List<Operand> { new(line.Substring(4).Trim()) },
                                             Flags.None with { Jump = true })));
                return;
            }
            if (line.Equals("RETURN", StringComparison.OrdinalIgnoreCase))
            {
                _stmts.Add((null, new Assign(null, new List<Operand>(), Flags.None with { Return = true })));
                return;
            }
            // A label — `myLabel:` — is the network's jump target.
            var lbl = Regex.Match(line, @"^(\w+)\s*:$");
            if (lbl.Success) { _label = lbl.Groups[1].Value; return; }

            var (letName, stmt) = ParseSimple(line);
            _stmts.Add((letName, stmt));
            if (letName != null) _lets[letName] = ((Assign)stmt).Value!;
        }

        /// <summary>A wire definition, a sink, or a bare call. Returns the LET name when there is one.</summary>
        private (string? Let, Node Node) ParseSimple(string line)
        {
            var let = Regex.Match(line, @"^LET\s+(\w+)\s*:=\s*(.+)$", RegexOptions.IgnoreCase);
            if (let.Success)
            {
                var name = let.Groups[1].Value;
                var value = ParseOperand(let.Groups[2].Value);
                return (name, new Assign(value, new List<Operand> { new(name) }, Flags.None));
            }

            var asg = SplitAssign(line);
            if (asg is { } a)
                return (null, new Assign(ParseOperand(a.Rhs), new List<Operand> { new(a.Lhs) }, Flags.None));

            // A bare call statement — an FB instance invocation.
            var node = ParseOperand(line);
            if (node is Box) return (null, node);
            throw new NetworkTextException("not a statement: " + line);
        }

        /// <summary>Split on the FIRST top-level <c>:=</c> — one inside a call's argument list
        /// (<c>t1(IN := a)</c>) is not the statement's assignment.</summary>
        private static (string Lhs, string Rhs)? SplitAssign(string s)
        {
            int depth = 0;
            for (int i = 0; i + 1 < s.Length; i++)
            {
                var c = s[i];
                if (c == '(') depth++;
                else if (c == ')') depth--;
                else if (depth == 0 && c == ':' && s[i + 1] == '=')
                    return (s.Substring(0, i).Trim(), s.Substring(i + 2).Trim());
            }
            return null;
        }

        private static Node Enable(Node n, Node cond) => n switch
        {
            Assign a when a.Value is Box b => a with { Value = b with { Enable = cond } },
            Box b => b with { Enable = cond },
            _ => n,
        };

        public Network Build()
        {
            // Use count decides what a LET is. Count references across every statement AND every other LET's
            // value, so a chain (`LET a := …; LET b := (a OR x); out := b;`) resolves correctly.
            var uses = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var name in _lets.Keys) uses[name] = 0;
            foreach (var (let, node) in _stmts) CountRefs(let is null ? node : _lets[let], uses);

            var inline = new Dictionary<string, Node>(StringComparer.Ordinal);
            var splits = new List<Operand>();
            foreach (var kv in _lets)
                if (uses.TryGetValue(kv.Key, out var n) && n >= 2) splits.Add(new Operand(kv.Key));
                else inline[kv.Key] = kv.Value;

            var trees = new List<Node>();
            foreach (var (let, node) in _stmts)
            {
                if (let != null && inline.ContainsKey(let)) continue;   // substituted into its one consumer
                trees.Add(Resolve(node, inline, new HashSet<string>(StringComparer.Ordinal)));
            }

            return new Network(Order, _title, _label,
                               _comments.Count == 0 ? null : string.Join("\n", _comments),
                               _disabled, trees, splits);
        }

        private static void CountRefs(Node? n, Dictionary<string, int> uses)
        {
            switch (n)
            {
                case null: return;
                case Leaf l:
                    if (uses.ContainsKey(l.Operand.Text)) uses[l.Operand.Text]++;
                    return;
                case Box b:
                    CountRefs(b.Enable, uses);
                    foreach (var p in b.Inputs) CountRefs(p.Value, uses);
                    return;
                case Assign a:
                    CountRefs(a.Value, uses);
                    return;
                case Parallel p2:
                    CountRefs(p2.Input, uses);
                    foreach (var br in p2.Branches) CountRefs(br, uses);
                    return;
                case Terminator t:
                    CountRefs(t.Input, uses);
                    return;
            }
        }

        /// <summary>Substitute single-use wire names back into their consumer. <paramref name="active"/> guards
        /// a self-referential chain, which is malformed input rather than something to loop on.</summary>
        private static Node Resolve(Node n, IReadOnlyDictionary<string, Node> inline, HashSet<string> active)
        {
            switch (n)
            {
                case Leaf l when inline.TryGetValue(l.Operand.Text, out var repl):
                    if (!active.Add(l.Operand.Text))
                        throw new NetworkTextException($"wire '{l.Operand.Text}' is defined in terms of itself");
                    var r = Resolve(repl, inline, active);
                    active.Remove(l.Operand.Text);
                    return Combine(r, l.Flags);
                case Box b:
                    return b with
                    {
                        Enable = b.Enable is null ? null : Resolve(b.Enable, inline, active),
                        Inputs = b.Inputs.Select(p => p with { Value = Resolve(p.Value, inline, active) }).ToList(),
                    };
                case Assign a:
                    return a with { Value = a.Value is null ? null : Resolve(a.Value, inline, active) };
                case Parallel p:
                    return p with
                    {
                        Input = p.Input is null ? null : Resolve(p.Input, inline, active),
                        Branches = p.Branches.Select(x => Resolve(x, inline, active)).ToList(),
                    };
                case Terminator t:
                    return t with { Input = t.Input is null ? null : Resolve(t.Input, inline, active) };
                default:
                    return n;
            }
        }

        /// <summary>Merge the modifiers written at the REFERENCE onto the substituted value.</summary>
        private static Node Combine(Node value, Flags at)
        {
            if (at.IsNone) return value;
            var f = value.Flags with
            {
                Negated = value.Flags.Negated ^ at.Negated,
                Rising = value.Flags.Rising || at.Rising,
                Falling = value.Flags.Falling || at.Falling,
                Set = value.Flags.Set || at.Set,
                Reset = value.Flags.Reset || at.Reset,
            };
            return value switch
            {
                Leaf l => l with { Flags = f },
                Box b => b with { Flags = f },
                Parallel p => p with { Flags = f },
                Terminator t => t with { Flags = f },
                Assign a => a with { Flags = f },
                _ => value,
            };
        }
    }

    // ── expressions ───────────────────────────────────────────────────────────────────────────────

    private static Node ParseOperand(string s)
    {
        var p = new Cursor(s);
        var n = p.Operand();
        p.SkipWs();
        if (!p.AtEnd) throw new NetworkTextException("trailing text in operand: " + s.Trim());
        return n;
    }

    /// <summary>A recursive-descent cursor over one operand expression. The grammar is fully parenthesised with
    /// no precedence (<c>docs/network-text.md</c> §4), so there is no operator-precedence machinery here — the
    /// parentheses carry the topology.</summary>
    private sealed class Cursor
    {
        private readonly string _s;
        private int _i;
        public Cursor(string s) { _s = s; }
        public bool AtEnd => _i >= _s.Length;
        public void SkipWs() { while (_i < _s.Length && char.IsWhiteSpace(_s[_i])) _i++; }

        public Node Operand()
        {
            SkipWs();
            bool negated = Word("NOT");
            var core = Core();
            SkipWs();
            bool rising = Word("RISING"), falling = !rising && Word("FALLING");
            SkipWs();
            bool set = Word("SET"), reset = !set && Word("RESET");
            var f = new Flags(negated, set, reset, false, false, rising, falling);
            return f.IsNone ? core : WithFlags(core, f);
        }

        private Node Core()
        {
            SkipWs();
            if (AtEnd) throw new NetworkTextException("expected an operand");
            if (_s[_i] == '(') return Group();

            var name = Token();
            SkipWs();
            if (!AtEnd && _s[_i] == '(') return Call(name);
            return new Leaf(new Operand(name), Flags.None);
        }

        /// <summary>A fully-parenthesised group: <c>( operand OP operand { OP operand } )</c>, exactly one
        /// operator KIND per group.</summary>
        private Node Group()
        {
            _i++;   // '('
            var args = new List<Node> { Operand() };
            SkipWs();
            string? sym = null;
            while (!AtEnd && _s[_i] != ')')
            {
                var op = Token();
                if (!FbdOperators.SymbolToType.ContainsKey(op))
                    throw new NetworkTextException($"'{op}' is not an operator");
                sym ??= op;
                if (op != sym)
                    throw new NetworkTextException(
                        $"a group mixes '{sym}' and '{op}' — one operator kind per group, use nested parentheses");
                args.Add(Operand());
                SkipWs();
            }
            if (AtEnd) throw new NetworkTextException("unclosed '(' in operand");
            _i++;   // ')'
            if (sym is null)
                return args[0];   // a parenthesised single operand
            return new Box(FbdOperators.SymbolToType[sym], null, CallKind.Operator,
                           args.Select(a => new Input(null, a, Flags.None)).ToList(),
                           new List<Operand>(), null, null, Flags.None);
        }

        /// <summary>A call. Named arguments (<c>PIN := v</c>) mean an FB INSTANCE; positional ones mean a
        /// stateless function.</summary>
        private Node Call(string name)
        {
            _i++;   // '('
            var args = new List<Input>();
            SkipWs();
            bool named = false;
            while (!AtEnd && _s[_i] != ')')
            {
                SkipWs();
                string? formal = null;
                int save = _i;
                var maybe = Token();
                SkipWs();
                if (!AtEnd && _s[_i] == ':' && _i + 1 < _s.Length && _s[_i + 1] == '=')
                {
                    _i += 2;
                    formal = maybe;
                    named = true;
                }
                else _i = save;

                var val = Operand();
                args.Add(new Input(formal, val, Flags.None));
                SkipWs();
                if (!AtEnd && _s[_i] == ',') { _i++; SkipWs(); }
            }
            if (AtEnd) throw new NetworkTextException($"unclosed '(' in call to '{name}'");
            _i++;   // ')'

            return named
                ? new Box(name, new Operand(name, IsInstance: true), CallKind.FunctionBlock, args,
                          new List<Operand>(), null, null, Flags.None)
                : new Box(name, null, CallKind.Function, args, new List<Operand>(), null, null, Flags.None);
        }

        /// <summary>A bare token: an identifier, a member access (<c>inst.Q</c>), a literal, or an operator
        /// symbol. Ends at whitespace or a structural character.</summary>
        private string Token()
        {
            SkipWs();
            int start = _i;
            while (_i < _s.Length && !char.IsWhiteSpace(_s[_i]) &&
                   _s[_i] != '(' && _s[_i] != ')' && _s[_i] != ',')
            {
                if (_s[_i] == ':' && _i + 1 < _s.Length && _s[_i + 1] == '=') break;
                _i++;
            }
            if (_i == start) throw new NetworkTextException("expected a name at: " + _s.Substring(start));
            return _s.Substring(start, _i - start);
        }

        /// <summary>Match a keyword on a word boundary, consuming it only on a match.</summary>
        private bool Word(string w)
        {
            SkipWs();
            if (_i + w.Length > _s.Length) return false;
            if (string.Compare(_s, _i, w, 0, w.Length, StringComparison.OrdinalIgnoreCase) != 0) return false;
            int after = _i + w.Length;
            if (after < _s.Length && (char.IsLetterOrDigit(_s[after]) || _s[after] == '_')) return false;
            _i = after;
            return true;
        }

        private static Node WithFlags(Node n, Flags f) => n switch
        {
            Leaf l => l with { Flags = f },
            Box b => b with { Flags = f },
            Parallel p => p with { Flags = f },
            Terminator t => t with { Flags = f },
            Assign a => a with { Flags = f },
            _ => n,
        };
    }
}

public sealed class NetworkTextException : Exception
{
    public string Code { get; }
    public int? Line { get; set; }   // settable: the Parse loop attaches the line a builder throw came from
    public NetworkTextException(string message, string code = "NETWORK_PARSE") : base(message) { Code = code; }
}
