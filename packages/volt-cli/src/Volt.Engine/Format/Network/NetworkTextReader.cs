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
/// <see cref="Demux"/> carrying that producer - the vendor's own fan-out item, keyed by a VarId. That is
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

                // A COMMENT'S OWN INDENTATION IS ITS TEXT. This used to `Trim()` what followed the `//`, but
                // the writer emits `"  // " + line` verbatim — so an engineer's aligned block comment came back
                // flattened to the left margin, and the canonical-form gate then refused their push over
                // whitespace they never touched. Only the ONE separator space the writer adds is removed, which
                // makes this the exact inverse of it — including a TRAILING space, which is also the
                // engineer's. Measured live: one comment in the project ends `could be missed. `, and
                // trimming it meant the first push after a pull rewrote a comment nobody had edited.
                // (The canonical-form gate compares lines with trailing whitespace ignored, so keeping
                // it here costs nothing there.)
                if (line.StartsWith("//", StringComparison.Ordinal))
                {
                    var raw = lines[i];
                    var body = raw.Substring(raw.IndexOf("//", StringComparison.Ordinal) + 2);
                    if (body.StartsWith(" ", StringComparison.Ordinal)) body = body.Substring(1);
                    cur.AddComment(body);
                    continue;
                }

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

        /// <summary>Every <c>en*</c> echo this network binds, and the index of the statement its
        /// <c>IF … THEN</c> guards. <see cref="MergeEnableEchoes"/> is the only reader of it.</summary>
        private readonly Dictionary<string, int> _echoes = new(StringComparer.Ordinal);

        /// <summary>Echoes whose box is substituted INTO a consumer rather than standing as its own statement
        /// — an enabled box at operand position. Applied over the inline map in <see cref="Build"/>.</summary>
        private readonly Dictionary<string, Node> _echoInline = new(StringComparer.Ordinal);

        public Builder(int order, string rest)
        {
            Order = order;
            // The optional header fields are NAMED (`LABEL: x TITLE: "y"`), so neither can be mistaken for the
            // other, for the language, or for `DISABLED`, and order does not matter.
            //
            // One network, one jump target. Naming the field makes a second label a REPEATED FIELD rather than
            // a stray statement, but it is still refused: keeping the first silently would drop a target a
            // `JMP` may already name, and the writer could not reproduce the text either way.
            var labels = Regex.Matches(rest, @"\bLABEL:\s*(\w+)", RegexOptions.IgnoreCase);
            if (labels.Count > 0) _label = labels[0].Groups[1].Value;
            if (labels.Count > 1)
                throw new NetworkTextException(
                    $"label '{labels[1].Groups[1].Value}' - the network already declares the label '{_label}'; "
                    + "a network is a single jump target", "NETWORK_DUPLICATE_NAME");

            // The title runs to the first UNDOUBLED quote (the writer doubles any quote in the text), so a
            // title that contains one survives instead of ending the moment it reaches it.
            var q = Regex.Match(rest, "\\bTITLE:\\s*\"((?:[^\"]|\"\")*)\"", RegexOptions.IgnoreCase);
            if (q.Success) _title = q.Groups[1].Value.Replace("\"\"", "\"");

            // DISABLED is looked for only AFTER the title, never inside it. Scanning the whole header meant
            // a network titled "DISABLED during commissioning" turned itself off on the way back in — the
            // flag is a header keyword, and text the engineer wrote is not the header.
            var tail = q.Success ? rest.Substring(q.Index + q.Length) : rest;
            _disabled = Regex.IsMatch(tail, @"\bDISABLED\b", RegexOptions.IgnoreCase);
        }

        public void AddComment(string c) => _comments.Add(c);

        public void AddExecute(string? en, string st)
        {
            var box = new Box("EXECUTE", null, CallKind.Function, new List<Input>(), new List<Output>(),
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

                // An enabled box reads its enable from the box's `en*` echo, which must be a wire this
                // network BINDS. (A conditional JMP/RETURN, handled above, takes any operand - it is a
                // different production in the grammar.)
                if (cond is Leaf g && !_lets.ContainsKey(g.Operand.Text))
                    throw new NetworkTextException(
                        $"the EN guard '{g.Operand.Text}' is not defined in this network - an enabled box reads "
                        + "its enable from a wire introduced with LET", "NETWORK_BAD_EXPRESSION");

                var (let, node) = ParseSimple(inner);
                _stmts.Add((let, Enable(node, cond)));
                // Remember which statement this echo guards. A LATER statement may drive a coil FROM the echo
                // — the box's ENO continuing the rung — and `MergeEnableEchoes` needs to find the box again.
                if (cond is Leaf e) _echoes[e.Operand.Text] = _stmts.Count - 1;
                if (let != null) _lets[let] = ((Assign)_stmts[_stmts.Count - 1].Node).Value!;
                return;
            }

            // AN UNCONDITIONAL JUMP OR RETURN IS DRAWN ON A RUNG THAT NOTHING DRIVES, so its value is an
            // unconnected TERMINATOR rather than null.
            //
            // Both used to build an assign with NO value at all, which is an item holding nothing: no
            // input, and (for RETURN) no output either. Measured live, both vendors refused to save it,
            // and neither error said why — CODESYS answered "Object reference not set to an instance of
            // an object" and TwinCAT "Value cannot be null. Parameter name: source". The CONDITIONAL
            // form worked on both all along, which is the tell: the difference is exactly the missing
            // value. `BoxTreeTerminator` with no input is the vendor's own spelling for a rung end that
            // nothing drives (it is what `coil := ;` reads back as), so it is what an unconditional one
            // gets — a measured shape reused, not a new one invented.
            if (Regex.IsMatch(line, @"^JMP\s+\w+$", RegexOptions.IgnoreCase))
            {
                _stmts.Add((null, new Assign(new Terminator(null, Flags.None),
                                             new List<Operand> { new(line.Substring(4).Trim()) },
                                             Flags.None with { Jump = true })));
                return;
            }
            if (line.Equals("RETURN", StringComparison.OrdinalIgnoreCase))
            {
                _stmts.Add((null, new Assign(new Terminator(null, Flags.None), new List<Operand>(),
                                             Flags.None with { Return = true })));
                return;
            }
            // A bare `myLabel:` line USED to be how the jump target was written. It is a property of the
            // network, not a statement, so it moved to the header as `LABEL:` — refuse it here rather than
            // let it fall through to the expression parser and fail as something unrecognisable.
            if (Regex.IsMatch(line, @"^\w+\s*:$"))
                throw new NetworkTextException(
                    $"'{line}' - a jump label belongs on the NETWORK header now (`NETWORK n LD LABEL: {line.TrimEnd(':', ' ')}`), "
                    + "not on a line of its own", "NETWORK_PARSE");

            var (letName, stmt) = ParseSimple(line);
            _stmts.Add((letName, stmt));
            if (letName != null) _lets[letName] = ((Assign)stmt).Value!;
        }

        /// <summary>A wire definition, a sink, or a bare call. Returns the LET name when there is one.</summary>
        private (string? Let, Node Node) ParseSimple(string line)
        {
            // `(.*)`, NOT `(.+)`: the value may be EMPTY. `LET en1 := ;` is a box whose EN pin is SHOWN and
            // wired to nothing, which is an ordinary shape - the format spells every unconnected pin as
            // nothing at all (§3), and `coil := ;` has always been read that way. Requiring a character here
            // meant the line matched no production, so the name was never bound and the guard below refused
            // the body: "the EN guard 'en1' is not defined in this network". Nine POUs in one real project,
            // every one of them unpushable.
            var let = Regex.Match(line, @"^LET\s+(\w+)\s*:=\s*(.*)$", RegexOptions.IgnoreCase);
            if (let.Success)
            {
                var name = let.Groups[1].Value;
                if (_lets.ContainsKey(name))
                    throw new NetworkTextException(
                        $"the wire '{name}' is defined twice - a name introduced with LET IS its definition, "
                        + "and two definitions of one wire have no single meaning", "NETWORK_DUPLICATE_NAME");
                // `LET i<n> := …` IS AN OPAQUE LEAF, and its text stays TEXT.
                //
                // The `i` prefix is the format's marker for one (§6 "Opaque leaf"): a single `inVariable` whose
                // text is not a safe token — `DINT_TO_REAL(x)`, `fc_dinttotime(a,2)` — so it cannot sit at an
                // operand position and gets a statement of its own. Parsing it like any other LET turned that
                // one leaf into a whole function-call BOX, and `Build` then substituted the box into its
                // consumer. The text no longer round-tripped (the writer re-emits a box inline, never hoisted),
                // and worse, pushing it would have built a real call box where the IDE holds one variable.
                //
                // Measured on Lenze_MID-S100: 23 networks, every one refused by the canonical-form gate — which
                // is the only reason this surfaced as a refusal rather than as a silently restructured body.
                var rhs = let.Groups[2].Value.Trim();
                var value = rhs.Length == 0
                    ? new Terminator(null, Flags.None)      // the pin is there and nothing drives it
                    : OpaqueLeaf.IsMatch(name)
                        ? new Leaf(new Operand(rhs), Flags.None)
                        : ParseOperand(let.Groups[2].Value);
                return (name, new Assign(value, new List<Operand> { new(name) }, Flags.None));
            }

            var asg = SplitAssign(line);
            if (asg is { } a)
            {
                if (a.Lhs.Length == 0)
                    throw new NetworkTextException("assignment with no target: " + line);

                // AN EMPTY RIGHT-HAND SIDE IS A RUNG WITH NOTHING ON IT — `coil := ;` — and it is a shape the
                // IDE really holds, not an authoring mistake. Measured in a user's ladder: a SET coil whose
                // `BoxTreeAssign.RValue` is a `BoxTreeTerminator` with no input, i.e. a coil sitting on a rung
                // that nothing drives.
                //
                // This arm was the FIRST place the empty slot was read deliberately, and for a while the only
                // one — which is why `( * iRPM * 6)` and `RESET := , PV := )` stayed unreadable long after
                // `coil := ;` worked. `Cursor.IsEmptyOperand` now applies the same rule everywhere an operand
                // can stand, so this is no longer a special case so much as the statement-level instance of
                // one. It reads back as the TERMINATOR the vendor holds rather than as a null, because that is
                // what the archive has: a null would make the in-place writer refuse ("the 'RValue' input of an
                // item is removed") and lose the rung.
                if (a.Rhs.Trim().Length == 0)
                    return (null, new Assign(new Terminator(null, Flags.None),
                                             new List<Operand> { new(a.Lhs, Flags: a.Storage) }, Flags.None));

                return (null, new Assign(ParseOperand(a.Rhs),
                                         new List<Operand> { new(a.Lhs, Flags: a.Storage) }, Flags.None));
            }

            // A bare call statement is an FB INSTANCE invocation, and an instance binds its pins BY NAME. A
            // positional call (`inst(IN)`) is a function call: it produces a value, so it cannot stand alone as
            // a statement, and accepting it would push a call whose result goes nowhere.
            var node = ParseOperand(line);
            if (node is Box box)
            {
                // An UNWIRED OPERATOR BOX is a real thing the IDE holds, and the text has to be able to say it.
                // Measured in the vendor's own POU_PBD.TcPOU: an AND box whose OutputItems list holds a single
                // NULL entry - one output slot, connected to nothing. It renders as `(FALSE AND FALSE);` and
                // this arm then refused to read it back, so a POU the IDE was perfectly happy with could be
                // pulled and never pushed.
                //
                // A POSITIONAL CALL STANDS ALONE TOO, for exactly the same reason.
                //
                // This arm used to refuse it, arguing that `f(a, b)` as a statement is "a call whose RESULT goes
                // nowhere, which is an authoring mistake rather than a shape the IDE gave us". The second half
                // was false, and measurably so: a real customer project (Lenze_MID-S100, 373 networks) renders
                // `MOVE(g0, iDec);` in 34 of them. A MOVE box in a ladder with its EN wired and its output
                // connected to nothing is ordinary, the vendor holds it happily, and the text has to be able to
                // say what the IDE is holding. Refusing meant those POUs could be pulled and never pushed back —
                // the same failure the unwired-operator arm above was fixed for, on the same kind of evidence.
                //
                // The distinction that still stands is call vs NON-call: an operand that is not a box at all (a
                // bare name, a literal) is not a statement, and falls through to the throw below.
                return (null, node);
            }
            // A BARE `?;` — an item the IDE holds that is wired to nothing at all. The writer emits it for
            // exactly that (it used to emit no line, dropping the item), so the reader has to take it back.
            if (node is Terminator) return (null, node);

            throw new NetworkTextException("not a statement: " + line);
        }

        /// <summary>Split on the FIRST top-level assignment operator — one inside a call's argument list
        /// (<c>t1(IN := a)</c>) is not the statement's assignment.
        ///
        /// <para>Three operators, and the one used says what KIND OF COIL the target is: <c>:=</c> a plain
        /// coil, <c>S=</c> a set coil, <c>R=</c> a reset coil. They are ExST's own (see
        /// <c>NetworkTextWriter.AssignOp</c>), so the storage rides on the operator rather than as a trailing
        /// word on the value.</para>
        ///
        /// <para><c>S=</c>/<c>R=</c> are recognised only as a TOKEN OF THEIR OWN — preceded by whitespace, not
        /// followed by another <c>=</c> — so a comparison, or an l-value whose name merely ends in those
        /// letters, cannot be mistaken for one.</para></summary>
        private static (string Lhs, string Rhs, Flags Storage)? SplitAssign(string s)
        {
            int depth = 0;
            for (int i = 0; i + 1 < s.Length; i++)
            {
                var c = s[i];
                if (c == '(') depth++;
                else if (c == ')') depth--;
                else if (depth == 0 && c == ':' && s[i + 1] == '=')
                    return (s.Substring(0, i).Trim(), s.Substring(i + 2).Trim(), Flags.None);
                else if (depth == 0 && (c == 'S' || c == 'R') && s[i + 1] == '='
                         && i > 0 && char.IsWhiteSpace(s[i - 1])
                         && (i + 2 >= s.Length || s[i + 2] != '='))
                    return (s.Substring(0, i).Trim(), s.Substring(i + 2).Trim(),
                            c == 'S' ? Flags.None with { Set = true } : Flags.None with { Reset = true });
            }
            return null;
        }

        private static Node Enable(Node n, Node cond) => n switch
        {
            Assign a when a.Value is Box b => a with { Value = b with { Enable = cond } },
            Box b => b with { Enable = cond },
            _ => n,
        };

        /// <summary>A coil driven by an <c>en*</c> ECHO is driven by the BOX, and this puts it back on the box.
        ///
        /// <para>The shape, which the writer emits whenever an enabled box writes its own output pin AND the
        /// rung carries on into a coil:</para>
        /// <code>
        /// LET en1 := g20;
        /// IF en1 THEN Bobbine.Control.AutoSpeed := MOVE(860); END_IF   -- the box's RESULT pin
        /// Bobbine.Control.StartAuto := en1;                            -- the coil, driven by its ENO
        /// </code>
        /// <para>The vendor holds that as ONE item: <c>Assign{ RValue = the MOVE box, Targets = [StartAuto] }</c>,
        /// with the box carrying <c>AutoSpeed</c> on its own output pin. Rebuilt statement-by-statement it comes
        /// back as three unrelated things, and <c>en1</c> — referenced by the guard AND by the coil — trips the
        /// use-count rule below into calling it a fan-out WIRE. The text then stops round-tripping
        /// (<c>LET g3 := g20; LET en1 := g3; … := g3;</c>) and the canonical-form gate refuses the push. 20 such
        /// statements across 6 POUs in one real project.</para>
        ///
        /// <para><b>The prefix decides here too.</b> The rule below already knows <c>g*</c> is a wire and
        /// <c>i*</c> an opaque leaf because those are names the WRITER mints; <c>en*</c> is minted just as
        /// deliberately and means neither. Inlining it instead would be no better — it would COPY the enable
        /// subtree into the coil, duplicating the very box the wire exists to share.</para>
        ///
        /// <para>Only the exact shape merges. A guard whose statement is not a box, a consumer that binds a
        /// <c>LET</c>, a jump or a return — all left alone, so anything unrecognised keeps whatever behaviour
        /// it had rather than being quietly restructured.</para></summary>
        private void MergeEnableEchoes()
        {
            if (_echoes.Count == 0) return;
            var drop = new HashSet<int>();

            foreach (var kv in _echoes)
            {
                var echo = kv.Key;
                var at = kv.Value;
                if (drop.Contains(at)) continue;
                if (_stmts[at].Let is not null) continue;

                // The coils this echo drives: statements whose WHOLE value is a reference to it.
                var consumers = new List<int>();
                for (int i = 0; i < _stmts.Count; i++)
                {
                    if (i == at || drop.Contains(i) || _stmts[i].Let is not null) continue;
                    if (_stmts[i].Node is Assign { Value: Leaf l } c
                        && string.Equals(l.Operand.Text, echo, StringComparison.Ordinal)
                        && !c.Flags.Jump && !c.Flags.Return
                        && c.Targets.Count > 0)
                        consumers.Add(i);
                }
                if (consumers.Count == 0) continue;

                // The guarded statement holds the box; its own target is the box's RESULT pin.
                var box = _stmts[at].Node switch { Assign { Value: Box b } => b, Box b => b, _ => null };
                if (box is null) continue;
                if (_stmts[at].Node is Assign { Targets.Count: > 0 } guarded)
                    box = box with
                    {
                        Outputs = box.Outputs.Concat(guarded.Targets.Select(t => new Output(null, t))).ToList(),
                    };

                var targets = consumers.SelectMany(i => ((Assign)_stmts[i].Node).Targets).ToList();
                _stmts[at] = (null, new Assign(box, targets, Flags.None));
                foreach (var i in consumers) drop.Add(i);
            }

            // AN ECHO REFERENCED FROM INSIDE AN EXPRESSION is an enabled box at OPERAND position — the
            // writer hoists one because EN/ENO has no inline form, and the consumer chains off the echo. The
            // box belongs in that consumer, so it is substituted there and its own statement goes away.
            //
            // Its `Enable` is rebound to the enable EXPRESSION first. The reader set it to a reference to the
            // echo itself (that is how `Enable(node, cond)` records the guard), so leaving it would make the
            // substitution self-referential.
            foreach (var kv in _echoes)
            {
                var echo = kv.Key;
                var at = kv.Value;
                if (drop.Contains(at) || _echoInline.ContainsKey(echo)) continue;
                if (_stmts[at].Let is not null || !_lets.TryGetValue(echo, out var enableExpr)) continue;

                // Referenced anywhere OTHER than by the guard's own statement?
                var uses = new Dictionary<string, int>(StringComparer.Ordinal) { [echo] = 0 };
                for (int i = 0; i < _stmts.Count; i++)
                {
                    if (i == at || drop.Contains(i)) continue;
                    CountRefs(_stmts[i].Let is null ? _stmts[i].Node : _lets[_stmts[i].Let!], uses);
                }
                if (uses[echo] == 0) continue;

                var box = _stmts[at].Node switch { Assign { Value: Box b2 } => b2, Box b2 => b2, _ => null };
                if (box is null) continue;
                if (_stmts[at].Node is Assign { Targets.Count: > 0 } g2)
                    box = box with
                    {
                        Outputs = box.Outputs.Concat(g2.Targets.Select(t => new Output(null, t))).ToList(),
                    };

                _echoInline[echo] = box with { Enable = enableExpr };
                drop.Add(at);
            }

            if (drop.Count == 0) return;
            var kept = new List<(string? Let, Node Node)>();
            for (int i = 0; i < _stmts.Count; i++)
                if (!drop.Contains(i)) kept.Add(_stmts[i]);
            _stmts.Clear();
            _stmts.AddRange(kept);
        }

        public Network Build()
        {
            // BEFORE the use count, because it is what makes the count right: an `en*` echo referenced by a
            // guard and by a coil is ONE box, not a wire with two consumers.
            MergeEnableEchoes();

            // Use count decides what a LET is. Count references across every statement AND every other LET's
            // value, so a chain (`LET a := …; LET b := (a OR x); out := b;`) resolves correctly.
            var uses = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var name in _lets.Keys) uses[name] = 0;
            foreach (var (let, node) in _stmts) CountRefs(let is null ? node : _lets[let], uses);

            // A LET used ONCE is a textual convenience, substituted into its consumer. A LET used TWICE OR MORE
            // is a STRUCTURE - the wire the vendor holds as a `BoxTreeDemux`, keyed by a VarId - so it is built
            // as a `Demux` here, the shape the driver already knows how to write.
            //
            // This used to emit a `Network.SplitPoints` entry plus an ordinary `Assign` to the wire's NAME: a
            // SECOND encoding of fan-out that no vendor understood, so the assignment landed as a real
            // assignment to an undeclared symbol and the POU stopped compiling. One model, one encoding, and it
            // is the vendor's own.
            var inline = new Dictionary<string, Node>(StringComparer.Ordinal);
            var wires = new Dictionary<string, int>(StringComparer.Ordinal);
            // THE PREFIX DECIDES, and the use count only breaks ties for names nobody minted.
            //
            // `g<n>` is a wire and `i<n>` an opaque leaf because those are the names the WRITER mints for
            // exactly those two things — it never mints a `g` for anything but a `Demux` or a shared value, and
            // never an `i` for anything but a hoisted leaf. Deciding by use count instead threw that away: a
            // `BoxTreeDemux` feeding ONE consumer is an item the IDE is holding (a branch point drawn on the
            // rung), and inlining it deleted the item on the way back — `LET g28 := (…); out := f(IN := g28)`
            // came back as `out := f(IN := (…))`, one item lighter, with the push accepted. Measured on
            // Lenze_MID-S100: 3 networks, alongside 23 where the same heuristic dissolved an opaque leaf.
            //
            // A name the writer did not mint is hand-authored, and there the count is still the only signal
            // there is: used twice it must be a wire, or the value would be duplicated into both consumers.
            foreach (var kv in _lets)
            {
                var wire = WireName.IsMatch(kv.Key)
                           || (!OpaqueLeaf.IsMatch(kv.Key)
                               && uses.TryGetValue(kv.Key, out var n) && n >= 2);
                if (wire) wires[kv.Key] = VarIdOf(kv.Key, wires.Count);
                else inline[kv.Key] = kv.Value;
            }

            // An echo standing for a hoisted box beats both: it is neither a wire the vendor holds nor its
            // own enable expression, it IS the box.
            foreach (var kv in _echoInline)
            {
                wires.Remove(kv.Key);
                inline[kv.Key] = kv.Value;
            }

            var trees = new List<Node>();
            foreach (var (let, node) in _stmts)
            {
                if (let != null && inline.ContainsKey(let)) continue;   // substituted into its one consumer
                var resolved = Resolve(node, inline, new HashSet<string>(StringComparer.Ordinal));

                if (let != null && wires.TryGetValue(let, out var defId))
                    resolved = new Demux(defId, resolved is Assign da ? da.Value : resolved, Flags.None);

                trees.Add(ReferencesToDemux(resolved, wires));
            }

            return new Network(Order, _title, _label,
                               _comments.Count == 0 ? null : string.Join("\n", _comments),
                               _disabled, trees);
        }

        /// <summary>The opaque-leaf name the writer mints: `i` followed by digits (docs/network-text.md §6).
        /// `g<n>` is a fan-out wire and `en<n>` an enable echo; those are real structure and are parsed.</summary>
        private static readonly Regex OpaqueLeaf = new(@"^i\d+$", RegexOptions.Compiled);

        /// <summary>The fan-out wire name the writer mints: `g` followed by digits (docs/network-text.md §5).</summary>
        private static readonly Regex WireName = new(@"^g\d+$", RegexOptions.Compiled);

        /// <summary>The VarId for a wire name. `g7` carries its own id, so a pull -> push round trip lands the
        /// SAME id the IDE had; a name that is not `g&lt;n&gt;` gets a fresh one.</summary>
        private static int VarIdOf(string name, int fallback) =>
            name.Length > 1 && name[0] == 'g' && int.TryParse(name.Substring(1), out var id) ? id : fallback + 1;

        /// <summary>Rewrite every REFERENCE to a fan-out wire into a `Demux` carrying the same VarId and NO
        /// input - exactly how the vendor spells "the other end of this wire".</summary>
        private static Node ReferencesToDemux(Node n, Dictionary<string, int> wires)
        {
            switch (n)
            {
                case Leaf l when wires.TryGetValue(l.Operand.Text, out var id):
                    return new Demux(id, null, l.Flags);
                case Assign a:
                    return a with { Value = a.Value is null ? null : ReferencesToDemux(a.Value, wires) };
                case Box b:
                    return b with
                    {
                        Inputs = b.Inputs.Select(i => i with { Value = ReferencesToDemux(i.Value, wires) }).ToList(),
                        Enable = b.Enable is null ? null : ReferencesToDemux(b.Enable, wires),
                    };
                case Parallel p:
                    return p with
                    {
                        Input = p.Input is null ? null : ReferencesToDemux(p.Input, wires),
                        Branches = p.Branches.Select(x => ReferencesToDemux(x, wires)).ToList(),
                    };
                case Terminator t:
                    return t with { Input = t.Input is null ? null : ReferencesToDemux(t.Input, wires) };
                case Demux d:
                    return d with { Input = d.Input is null ? null : ReferencesToDemux(d.Input, wires) };
                default:
                    return n;
            }
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
        // Trailing text after a complete operand means the expression was only PARTIALLY parenthesised
        // (`(a AND b) OR c`). The grammar has no precedence, so the parentheses carry the topology and a
        // half-parenthesised expression has no single reading.
        if (!p.AtEnd)
            throw new NetworkTextException(
                "the expression is only partially parenthesised: " + s.Trim()
                + " - every operator group needs its own parentheses, because network text has no precedence",
                "NETWORK_BAD_EXPRESSION");
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

            // AN EMPTY SLOT IS A PIN CONNECTED TO NOTHING, and it is read here rather than thrown on.
            // `NetworkTextWriter` renders an unconnected input as nothing at all, so the vendor's own bodies
            // arrive as `( * iRPM * 6)`, `MOVE(, iDec)` and `RESET := , PV := )`. Only the statement-level case
            // (`coil := ;`) was ever read back, so 110 of one real project's 373 networks (Lenze_MID-S100)
            // could be pulled and never pushed. Same rule, every position an operand can stand.
            if (IsEmptyOperand()) return new Terminator(null, Flags.None);

            // `NOT(x)` IS A BOX NAMED NOT; `NOT x` IS THE NEGATION MODIFIER. FBD has both, and they are
            // different things in the IDE — a NOT box item versus a negation dot on a pin — so reading one as
            // the other rewrites the drawing. This arm took every `NOT` as the modifier, so a real NOT box
            // (rendered through the ordinary call path as `NOT(g20)`, since NOT is not in the operator table)
            // collapsed into a flag on its input and the box was gone on the next push.
            //
            // The two are told apart by the parenthesis being ADJACENT, which is not a coincidence of layout:
            // `ApplyMods` writes the modifier as `"NOT " + value` and always has, and `Definition` writes a call
            // as `type + "("` and always has. So this reads exactly what the two emitters produce, and it is
            // the one place in the format where a space carries meaning (§3).
            bool negated = !AtCall("NOT") && Word("NOT");
            var core = Core();
            SkipWs();
            bool rising = Word("RISING"), falling = !rising && Word("FALLING");
            // NO STORAGE HERE. `SET`/`RESET` used to be read as trailing modifiers on the value; storage is a
            // property of the COIL and is now the assignment operator (`S=` / `R=`), read where the target is.
            var f = new Flags(negated, false, false, false, false, rising, falling);
            return f.IsNone ? core : WithFlags(core, f);
        }

        private Node Core()
        {
            SkipWs();
            if (AtEnd) throw new NetworkTextException("expected an operand", "NETWORK_BAD_EXPRESSION");

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
                    throw new NetworkTextException(
                        $"'{op}' is not an FBD operator", "NETWORK_UNKNOWN_OPERATOR");
                sym ??= op;
                if (op != sym)
                    throw new NetworkTextException(
                        $"a group mixes '{sym}' and '{op}' - one operator kind per group, use nested parentheses",
                        "NETWORK_BAD_EXPRESSION");
                // AN OPERATOR STILL NEEDS SOMETHING TO ITS RIGHT, and that asymmetry with the empty LEFT
                // operand above is deliberate rather than tidy. What is measured is `( * iRPM * 6)` — 14 of
                // them across Lenze_MID-S100, an operator box whose FIRST pin is unconnected. Not one case of
                // `(a AND )` appears in the same project, so accepting it would be inferring a shape from a
                // model that merely looks like it should permit one, which is the reasoning this codebase
                // refuses everywhere else. Refusing is also the safe direction: it says "Volt cannot take this
                // back" instead of guessing at what the IDE meant. Measure one, then delete this.
                SkipWs();
                if (AtEnd || _s[_i] == ')')
                    throw new NetworkTextException(
                        $"the operator '{op}' has no right-hand operand", "NETWORK_BAD_EXPRESSION");
                args.Add(Operand());
                SkipWs();
            }
            if (AtEnd) throw new NetworkTextException("unclosed '(' in operand", "NETWORK_BAD_EXPRESSION");
            _i++;   // ')'
            if (sym is null)
                return args[0];   // a parenthesised single operand
            return new Box(FbdOperators.SymbolToType[sym], null, CallKind.Operator,
                           args.Select(a => new Input(null, a, Flags.None)).ToList(),
                           new List<Output>(), null, null, Flags.None);
        }

        /// <summary>A call. Named arguments (<c>PIN := v</c>) mean an FB INSTANCE; positional ones mean a
        /// stateless function.</summary>
        private Node Call(string name)
        {
            _i++;   // '('
            var args = new List<Input>();
            SkipWs();
            var outs = new List<Output>();
            bool isOutput = false;

            // DRIVEN BY THE COMMAS, not by "is there something before the `)`". The old loop asked whether the
            // next character was `)` and stopped if it was, so `f(a, )` — a call whose LAST pin is unconnected —
            // silently lost that pin: the box came back with one input instead of two, changing its arity with
            // nothing in the text or the diff to show it. A comma promises another argument, and an empty one
            // is an argument that is empty.
            bool more = !AtEnd && _s[_i] != ')';
            while (more)
            {
                SkipWs();
                string? formal = null;
                // The probe only runs where a formal name COULD start. A pin name is an identifier, so an
                // argument opening with `(` — a parenthesised group, which is most of a real ladder's arguments —
                // has none, and asking `Token()` there threw "expected a name at" and refused the whole push.
                if (!IsEmptyOperand() && _s[_i] != '(')
                {
                    int save = _i;
                    var maybe = Token();
                    SkipWs();
                    if (!AtEnd && _s[_i] == ':' && _i + 1 < _s.Length && _s[_i + 1] == '=')
                    {
                        _i += 2;
                        formal = maybe;
                    }
                    else if (!AtEnd && _s[_i] == '=' && _i + 1 < _s.Length && _s[_i + 1] == '>')
                    {
                        _i += 2;
                        formal = maybe;
                        isOutput = true;
                    }
                    else _i = save;
                }

                // `NAME => target` is an OUTPUT pin, not an input. ST's own output-parameter operator, and
                // the reason the probe above has to look past `:=` too: both start with an identifier.
                if (isOutput)
                {
                    outs.Add(new Output(formal, new Operand(Token())));
                    isOutput = false;
                }
                else
                {
                    var val = Operand();
                    args.Add(new Input(formal, val, Flags.None));
                }
                SkipWs();
                if (!AtEnd && _s[_i] == ',') { _i++; more = true; }
                else more = false;
            }
            if (AtEnd) throw new NetworkTextException($"unclosed '(' in call to '{name}'");
            _i++;   // ')'

            // An INSTANCE call is one whose INPUT pins are named. A box that only names an OUTPUT
            // (`fc_MeanValue(20, oMeanValue => x)`) is still a function — naming a result pin says nothing
            // about whether the call has an instance.
            var instanceCall = args.Any(a => !string.IsNullOrEmpty(a.Formal));
            return instanceCall
                ? new Box(name, new Operand(name, IsInstance: true), CallKind.FunctionBlock, args,
                          outs, null, null, Flags.None)
                : new Box(name, null, CallKind.Function, args, outs, null, null, Flags.None);
        }

        /// <summary>Is there NO operand at this position?
        ///
        /// <para>A POSITION, not a token — which is the whole reason there is no magic "unconnected" word in
        /// this format. A token was tried (`?`) and had to be withdrawn: CODESYS writes `???` into a box whose
        /// instance is unresolved — a real compile error the engineer needs to SEE — and one real project holds
        /// five, including `??? := ioAxis.xVirtual;`. A sigil chosen for being impossible was already content,
        /// so Volt carries `???` through verbatim and claims no spelling of its own.</para>
        ///
        /// <para>The grammar is fully parenthesised with no precedence (§4), so every operand sits between two
        /// structural marks. Finding the NEXT mark where an operand should have started — end of input, `)`,
        /// `,`, or an operator symbol — is therefore an unambiguous statement that the pin is wired to
        /// nothing.</para></summary>
        private bool IsEmptyOperand()
        {
            SkipWs();
            if (AtEnd || _s[_i] == ')' || _s[_i] == ',') return true;

            // An OPERATOR where an operand belongs: `( * iRPM * 6)` is a three-input multiply whose first pin
            // is unconnected. Peeked without consuming, so a real operand is left untouched for Core().
            int save = _i;
            try { return FbdOperators.SymbolToType.ContainsKey(Token()); }
            catch (NetworkTextException) { return false; }
            finally { _i = save; }
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

            // A MEMBER ACCESS MAY HAVE SPACES AROUND ITS DOT, because the engineer typed them and the IDE kept
            // them: a real project holds the operand `scSimulationDowntimes .uiMaxSimulationEvents`. The dot
            // itself never ended a token, so only the SPACE split this in two, and the leftover half then read
            // as a second operand — reported as "the expression is only partially parenthesised", which points
            // at precedence and is nowhere near the truth. The whitespace is kept in the returned text: the
            // operand has to round-trip verbatim, and re-spacing it would rewrite the engineer's name.
            int end = _i;
            while (true)
            {
                int save = _i;
                SkipWs();
                if (AtEnd || _s[_i] != '.') { _i = save; break; }
                _i++;                                     // '.'
                while (_i < _s.Length && !char.IsWhiteSpace(_s[_i]) &&
                       _s[_i] != '(' && _s[_i] != ')' && _s[_i] != ',')
                {
                    if (_s[_i] == ':' && _i + 1 < _s.Length && _s[_i + 1] == '=') break;
                    _i++;
                }
                end = _i;
            }
            return _s.Substring(start, end - start);
        }

        /// <summary>Is the text at the cursor a CALL to <paramref name="name"/> — the name with `(` directly
        /// after it, no space? Consumes nothing.</summary>
        private bool AtCall(string name)
        {
            SkipWs();
            return _i + name.Length < _s.Length
                && string.Compare(_s, _i, name, 0, name.Length, StringComparison.OrdinalIgnoreCase) == 0
                && _s[_i + name.Length] == '(';
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
