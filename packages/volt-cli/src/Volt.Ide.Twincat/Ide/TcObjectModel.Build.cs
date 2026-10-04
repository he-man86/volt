using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Volt.Engine;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Host;

namespace Volt.Ide.Twincat;

/// <summary>Building the PLC project and scraping the Output window for diagnostics.
/// <para>The parse is a regex over human-readable build output — the only diagnostic source TwinCAT offers —
/// which is why it is kept apart from the typed object-model calls around it.</para></summary>
internal sealed partial class TcObjectModel
{
    // ── build / diagnostics ─────────────────────────────────────────
    /// <summary>Commit applied writes to TwinCAT's own store, via the ONE shell command <c>File.SaveAll</c> — it
    /// persists open documents, every dirty PROJECT (including the <c>.plcproj</c>) and the solution in a single
    /// call. Tree operations (create/delete/rename) change the project structure on disk, so the projects must be
    /// persisted too — otherwise a later rename collides with stale files from async tree deletions.
    /// <para>A failure here is NOT swallowed. Durability is this method's entire purpose: `push` calls it and then
    /// reports success, so a silently-failed save means Volt tells the engineer their work is committed while it
    /// exists only in the IDE's memory — and an IDE crash loses it. Fail loud instead, and let the push fail.</para></summary>
    public void FlushPendingWrites()
    {
        if (_dte == null)
            throw new BridgeException(BridgeErrorCodes.PlcDisconnected,
                "cannot commit writes — no IDE is attached");
        // ponytail: saves the whole solution + ALL open documents, which also commits the engineer's unrelated dirty
        // editors — a side effect on data Volt does not own. DECIDED (2026-07-30) to scope this to only what Volt
        // wrote; not yet implemented because a write here targets a system-manager TREE NODE
        // (n.DeclarationText/ImplementationText), and a tree node exposes no DTE document or file path, so the
        // node -> document/project mapping has to be found against the live COM model first. Until then the broad
        // save stays, because it is what makes `push` durable at all (CODESYS commits on write, so dropping it would
        // leave push durable on one vendor and not the other). Upgrade path in
        // openspec/changes/fix-push-data-loss tasks §4.
        // `Solution.Save()` DOES NOT EXIST. EnvDTE's solution interface exposes SaveAs, not Save, so this line threw
        // `'System.__ComObject' does not contain a definition for 'Save'` on EVERY push — and because it threw
        // FIRST, `Documents.SaveAll()` never ran either. Under the old bare `catch { }` the whole method was a
        // silent no-op, which is why a 90-pass TwinCAT baseline was recorded against a save that never happened;
        // making the failure loud (838c4140e1) turned that into 63 red e2e tests, exactly the diagnostic that
        // commit predicted. `File.SaveAll` is the shell command behind File > Save All: it persists open documents,
        // every dirty PROJECT (including the `.plcproj` whose missing registration is the orphan bug,
        // openspec/changes/fix-push-data-loss §3) and the solution, in one call that actually exists.
        try
        {
            _dte.ExecuteCommand("File.SaveAll");
        }
        catch (Exception ex)
        {
            // IDE_SAVE_FAILED: the applied writes are in the IDE's memory, not on disk — a transient state whose remedy is
            // to save, never a vendor limit (UNSUPPORTED) nor a Volt bug (INTERNAL_ERROR). It arrives as a frame on push
            // and build, which declare it (review of openspec bridge-refusal-review step V).
            VoltLog.Warn($"File.SaveAll failed — applied writes may not be on disk: {ex.Message}");
            throw new BridgeException(BridgeErrorCodes.IdeSaveFailed,
                $"the IDE could not save the applied changes, so they are NOT committed to disk: {ex.Message} " +
                "Save in the IDE (File > Save All) or retry, then `volt pull` to see what landed.", ex);
        }
    }

    /// <summary>Build the solution and report whether it passed.
    ///
    /// <para><b>An unreadable VERDICT is reported as failure; a dead CHANNEL is not a verdict at all.</b> The two
    /// were the same answer here — one bare `catch` around the whole method turned both into `false` and
    /// destroyed the exception. That matters because the exception is the only thing
    /// <c>BeckhoffDriver.ShouldMarkDegraded</c> can classify: it matches the RPC HRESULT family
    /// (<c>0x800101xx</c>, <c>0x800706BA/BE/BF</c>) that a dropped or hung XAE raises, and
    /// <c>BridgePipeHost</c> uses that verdict to mark the session degraded so <c>Recover()</c> runs. Swallowed,
    /// an RPC fault during <c>volt build</c> left health GREEN while every following op failed the same way —
    /// the identical failure this driver documents three times elsewhere and DIALECT D29(a) describes.</para>
    ///
    /// <para>So the RPC family propagates, everything else is logged and reported as a failed build (the
    /// standing rule for "I could not read the result"), and a null <c>_dte</c> — no IDE attached — is
    /// <c>PlcDisconnected</c> rather than "your project does not compile", which is what
    /// <c>FlushPendingWrites</c> already answers for the same state.</para></summary>
    public bool Build()
    {
        if (_dte == null)
            throw new BridgeException(BridgeErrorCodes.PlcDisconnected,
                "no TwinCAT XAE is attached, so there is nothing to build — this is a disconnected session, " +
                "not a project that failed to compile");
        try
        {
            dynamic sb = _dte.Solution.SolutionBuild;

            // WAIT FOR A BUILD THE ENGINEER STARTED IN THE IDE, and refuse if one is still running. Starting a
            // second build over the top of a live one is what the old code did on expiry: the loop simply fell
            // through and called Build() anyway.
            if (!WaitForIdle(sb)) return false;

            // MEASURED SYNCHRONOUS (2026-08-30, live TcXaeShell 15.0): `Build(true)` is EnvDTE's
            // `WaitForBuildToFinish` overload and it blocks — a Clean+Build cycle returned after 758ms and
            // 1230ms respectively, with `BuildState` already `vsBuildStateDone`(3) on return and never once
            // observed as `vsBuildStateInProgress`(2). So there is NO poll after this call.
            //
            // There used to be one, and it was the bug: 100x100ms, and on expiry it did not throw, did not log,
            // and did not stop — it fell through to `LastBuildInfo`, which then reported the PREVIOUS build's
            // failed-project count as this build's verdict, on a wire-visible boolean. Ten seconds is also not a
            // plausible ceiling for a real PLC build, so the fall-through was reachable rather than theoretical.
            // The file's own rule five lines down says it: "NOT catch { failed = 0; }. That turned 'I could not
            // read the build result' into 'the build passed'."
            sb.Build(true);
            // NOT `catch { failed = 0; }`. That turned "I could not read the build result" into "the build
            // passed" — on a WIRE-VISIBLE boolean, so a client is told a failing project compiles. The sibling
            // GetBuildDiagnostics already applies the opposite reasoning to its own partial-parse case.
            int failed;
            try { failed = sb.LastBuildInfo; }
            catch (Exception ex)
            {
                VoltLog.Warn($"twincat: build finished but LastBuildInfo is unreadable — reporting FAILURE " +
                             $"rather than assuming success: {ex.Message}");
                return false;
            }
            return failed == 0;
        }
        catch (Exception ex) when (!BeckhoffDriver.IsRpcFault(ex))
        {
            // NOT the RPC family: a real build-time failure whose verdict we could not read. Report FAILURE —
            // never "it passed" — and say why, because this used to be a bare catch with no log at all.
            VoltLog.Warn($"twincat: the build could not be completed or its result read — reporting FAILURE " +
                         $"rather than assuming success: {ex.Message}");
            return false;
        }
    }

    /// <summary>Wait until no build is running, and say whether we got there.
    ///
    /// <para><c>false</c> means "a build is still running, or I could not tell" — and the caller reports the
    /// build as FAILED, which is this file's standing rule for an unreadable verdict ("reporting FAILURE rather
    /// than assuming success"). It is never "assume idle and start another one": that is exactly what the
    /// expiring loop this replaces did, issuing <c>Build(true)</c> over a build already in flight.</para>
    ///
    /// <para>The state read is NOT swallowed. It used to sit in a bare <c>catch { }</c> with no log, so a COM
    /// fault on the very first poll looked identical to "idle" and the method carried on.</para></summary>
    private static bool WaitForIdle(dynamic sb)
    {
        const int VsBuildStateInProgress = 2;   // EnvDTE vsBuildState: NotStarted=1, InProgress=2, Done=3
        for (int i = 0; i < 100; i++)
        {
            int state;
            try { state = (int)sb.BuildState; }
            catch (Exception ex)
            {
                VoltLog.Warn($"twincat: the IDE's build state is unreadable — reporting FAILURE rather than " +
                             $"starting a build over one that may be running: {ex.Message}");
                return false;
            }
            if (state != VsBuildStateInProgress) return true;
            System.Threading.Thread.Sleep(100);
        }
        VoltLog.Warn("twincat: a build started in the IDE is still running after 10s — reporting FAILURE rather " +
                     "than starting a second build over it");
        return false;
    }

    public IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics()
    {
        var result = new List<BridgeDiagnostic>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        if (_dte == null) return result;
        try
        {
            dynamic output = _dte.Windows.Item("{34E76E81-EE4A-11D0-AE2E-00A0C90FFFC3}").Object;
            int paneCount = output.OutputWindowPanes.Count;
            for (int p = 1; p <= paneCount; p++)
            {
                dynamic pane;
                try { pane = output.OutputWindowPanes.Item(p); } catch { continue; }
                // EVERY PANE IS PARSED. This does not need to know WHICH pane a build writes to — it needs the
                // diagnostics, and the regex below already IS the test: a line only matches if it is shaped
                // `file(line,col) : error|warning|message : text`, which is a compiler's output and not a
                // window's chrome.
                //
                // It used to select panes by `pane.Name.Contains("Build") || .Contains("TwinCAT")` — a
                // case-sensitive substring test on the shell's USER-VISIBLE caption. The driver supports full
                // Visual Studio as well as TcXaeShell, and full VS ships localized UI in Beckhoff's own market;
                // on such a host nothing matches, and a FAILING build is then reported with zero errors.
                // Selecting by pane GUID instead would only trade one magic string for another: the Build pane's
                // GUID is a documented VS SDK constant, but TwinCAT's own pane GUID is documented nowhere and was
                // measured on a single install, so it is exactly the kind of value that quietly stops matching
                // on the next version. Not identifying the pane at all removes the question.
                // AN EMPTY PANE THROWS, and that is its ordinary state — not a fault to abort the sweep for.
                // Measured on live TcXaeShell 15.0 (2026-08-30): of seven panes, `Build`, `TwinCAT` and
                // `Source Control - Git` return text, while `Debug`, `Build Order` and the two other source
                // control panes each answer `COMException 0x80004005` (E_FAIL) from `TextDocument`. Letting that
                // reach the outer catch aborted the WHOLE parse on the first empty pane, so the build reported
                // one synthetic "could not finish reading" error and nothing else.
                //
                // Skipping here does NOT hide a failing build: the verdict comes from `LastBuildInfo` in
                // `Build()`, never from this list, so the worst case is a failure reported without its detail —
                // and this now reads every pane, where the previous name-matching version read at most two.
                string text;
                try
                {
                    dynamic td = pane.TextDocument;
                    dynamic ep = td.StartPoint.CreateEditPoint();
                    text = (string)ep.GetText(td.EndPoint);
                }
                catch (Exception ex)
                {
                    VoltLog.Debug($"twincat: an Output pane has no readable text (usually an empty one): {ex.Message}");
                    continue;
                }
                if (string.IsNullOrEmpty(text)) continue;
                CollectPane(text, seen, result);
            }
        }
        catch (Exception ex)
        {
            // A PARTIAL diagnostic list is worse than none: the caller reports it as the build result, so a
            // truncated parse makes a failing build look cleaner than it is — errors the engineer never sees.
            VoltLog.Warn($"twincat: build-output parsing stopped early after {result.Count} diagnostic(s) — " +
                         $"the reported list may be INCOMPLETE: {ex.Message}");
            // The comment above is right that a partial list is worse than none — and returning one anyway is
            // what made it happen. The caller reports this list AS the build result, so a truncated parse makes
            // a failing build look cleaner than it is. Say so IN the list, where the caller and the engineer both
            // see it, rather than only in a log neither reads.
            result.Add(new BridgeDiagnostic
            {
                Severity = Volt.Contracts.Severity.Error,
                Message = $"volt could not finish reading the build output after {result.Count} diagnostic(s) " +
                          $"({ex.Message}) — this list is INCOMPLETE and the build result is unknown, not clean. " +
                          "Check the IDE's own error list.",
                Line = 0,
                Column = 0,
            });
        }
        return result;
    }

    /// <summary>One pane's diagnostics, appended to <paramref name="into"/> unless an earlier pane already carried them.
    ///
    /// <para>ONE ENTRY PER DIAGNOSTIC, however many panes carry it. A PLC build writes the same error to Visual Studio's
    /// own Build pane AND to TwinCAT's, so with every pane read the same error arrives twice; the engineer would see it
    /// twice. But ONLY a repeat is dropped: the key is the OBJECT the compiler named (the file stem plus the dotted path
    /// after its `;`), not what the wire publishes. The wire folds a property accessor into its property (`FB.Prop.Get`
    /// and `FB.Prop.Set` are both `member: Prop`) and TwinCAT writes no column, so a key built from the published fields
    /// merged a GET's error into the SET's identical one - a real IDE diagnostic lost, while CODESYS returned both
    /// (openspec <c>codesys-diagnostic-child-names</c>). The MSBuild `N&gt;` prefix the Build pane adds is not in the
    /// key, which is what lets the two panes' copies of one error meet.</para></summary>
    internal static void CollectPane(string text, HashSet<string> seen, List<BridgeDiagnostic> into)
    {
        foreach (var (diagnostic, key) in ParseLines(text))
            if (seen.Add(key)) into.Add(diagnostic);
    }

    /// <summary>One Output pane's text, parsed into diagnostics, each with its cross-pane identity (<see cref="CollectPane"/>).</summary>
    /// <remarks>
    /// A line matches only if it is shaped `file(line,col) : error|warning|message : text`, which is a compiler's
    /// output and not a window's chrome — that shape IS the pane filter, which is why no pane is selected by name.
    ///
    /// A MESSAGE MAY SPAN LINES, and cutting it at the first one is data corruption the wire then carries. CODESYS
    /// quotes source text back at you — `The code '.size;&lt;newline&gt;' has no effect. Is this the intent?` — and
    /// `.` does not match a newline, so the recorded TwinCAT message was `The code '.size;`, no closing quote
    /// (found from the LSP conformance recordings, 2026-09-17). Continuation is recognised by an UNBALANCED QUOTE
    /// rather than by "the next line is not a diagnostic": the pane is full of build chrome, and appending that to
    /// the previous message would corrupt far more than the break does.
    /// </remarks>
    private static List<(BridgeDiagnostic Diagnostic, string Key)> ParseLines(string text)
    {
        var parsed = new List<(BridgeDiagnostic, string)>();
        var regex = new Regex(
            @"^(.+?)(?:\((\d+)(?:,(\d+))?\))?\s*:\s*(error|warning|message)\s*:\s*(.+)$",
            RegexOptions.IgnoreCase | RegexOptions.Multiline);
        foreach (Match m in regex.Matches(text))
        {
            int lineNum = 0, colNum = 0;
            if (m.Groups[2].Success) int.TryParse(m.Groups[2].Value, out lineNum);
            if (m.Groups[3].Success) int.TryParse(m.Groups[3].Value, out colNum);
            var captured = m.Groups[1].Value;
            // The BARE name -- BuildService promotes it to the wire's full `name.kind`. Group 1 is the file the
            // compiler named, and it was captured and DROPPED: the diagnostic kept a line number with nothing to
            // anchor it to, so a client had a position and no file to put it in.
            var file = BareNameOf(FileOf(captured));
            var obj = ObjectOf(captured);
            var (name, member) = obj is null ? (file, null) : ChildOf(file, obj);
            var diagnostic = new BridgeDiagnostic
            {
                // "message" is TwinCAT's word for informational; Severity.Of maps it.
                Severity = Volt.Contracts.Severity.Of(m.Groups[4].Value),
                Message = WithContinuation(text, m).Trim(),
                Line = lineNum,
                Column = colNum,
                Name = name,
                Member = member,
            };
            // Separated by U+0001 so no two field splits collide.
            parsed.Add((diagnostic,
                $"{file}\u0001{obj}\u0001{diagnostic.Severity}\u0001{lineNum}\u0001{colNum}\u0001{diagnostic.Message}"));
        }
        return parsed;
    }

    /// <summary>The FILE half of what the compiler named — `C:\p\FB.TcPOU;FB.Execute` → `C:\p\FB.TcPOU`.
    ///
    /// <para>AN ERROR INSIDE A CHILD OBJECT IS WRITTEN `FILE;OBJECT`. Measured on live TcXaeShell 15.0 (DIALECT D36,
    /// openspec <c>codesys-diagnostic-child-names</c> 3.3): a method body's error reads
    /// `...\FB.TcPOU;FB.Compute(6) : error: ...`, a property GET's `...;FB.Prop.Get(2)`, an action's `...;FB.Act(3)`,
    /// while the POU's own body stays `...\FB.TcPOU(6)`. Taking the stem of the whole capture gave `FB.TcPOU;FB`, a
    /// name no item has, so the engine resolved it to nothing and every such diagnostic reached the wire unnamed —
    /// the same gap the CODESYS driver had through a different door.</para></summary>
    private static string FileOf(string captured)
    {
        var semi = captured.IndexOf(';');
        return semi < 0 ? captured : captured.Substring(0, semi);
    }

    /// <summary>The dotted OBJECT path after the `;` (see <see cref="FileOf"/>) — `FB.Prop.Get` — or null when the
    /// compiler named the file alone, which is the item's own declaration or body.</summary>
    private static string? ObjectOf(string captured)
    {
        var semi = captured.IndexOf(';');
        return semi < 0 ? null : captured.Substring(semi + 1).Trim();
    }

    /// <summary>The item and the CHILD an object path names: the segment after the POU's own name — `FB.Compute` →
    /// `Compute`, and `FB.Prop.Get` → `Prop`, because a property accessor is read with its property, not beside it (the
    /// CODESYS driver names it the same way, which is the parity the wire needs).
    ///
    /// <para>THE PATH MUST START AT THE FILE'S OWN POU. Every measured line does (`VltE2E_raw.TcPOU;VltE2E_raw.…`); a
    /// path that starts anywhere else, or has no child segment, is a shape nobody measured, and reading its second
    /// segment as a member of the file's POU would be a guess. Such a diagnostic is published with neither name nor
    /// member - its message intact, its location not invented - and the line is logged so the shape can be measured.
    /// UNMEASURED: whether a method in a POU-internal folder is written `FB.Folder.Method` (which would publish the
    /// folder as the member).</para></summary>
    private static (string? Name, string? Member) ChildOf(string? pou, string obj)
    {
        var path = obj.Split('.');
        if (pou is not null && path.Length >= 2 && path[1].Length > 0
            && string.Equals(path[0], pou, StringComparison.OrdinalIgnoreCase))
            return (pou, path[1]);
        VoltLog.Warn($"twincat: a build diagnostic names the object '{obj}' in the file of '{pou}', a shape that is not " +
                     "a child of that POU — reporting it without an item or member rather than guessing one");
        return (null, null);
    }

    /// <summary>The item a compiler line names, as the IDE's own BARE name — `1&gt;C:\p\MAIN.TcPOU` → `MAIN`.
    ///
    /// <para>Null when group 1 holds no file, which is how a PROJECT-level message reports "no item": MSBuild
    /// writes `1&gt;TwinCAT Project1 : error : ...`, and naming the solution as though it were a POU would be
    /// worse than naming nothing. The `N&gt;` prefix is MSBuild's project number, not part of the path.</para>
    ///
    /// <para>The stem is BARE, and deliberately not turned into a wire name here: `.TcPOU` is one vendor file
    /// type covering `prg`, `fb` and `func`, so the extension on disk cannot say which kind the wire name
    /// carries — only the declaration can, and that lives above this seam.</para></summary>
    private static string? BareNameOf(string captured)
    {
        var s = captured.Trim();
        var arrow = s.IndexOf('>');
        if (arrow > 0 && s.Substring(0, arrow).All(char.IsDigit)) s = s.Substring(arrow + 1).Trim();

        // A PATH IS WHAT A COMPILER NAMES AN ITEM WITH, and requiring one is a POSITIVE test: the field has to
        // look like a file before anything is read out of it. The test used to be the ABSENCE of a space, on the
        // grounds that an IEC identifier cannot contain one — which rejects `1>TwinCAT Project1 : error : ...`
        // and lets through every project whose name happens to have none (`1>Untitled1`, `1>PLC`). Those came
        // back as item names, and the engine resolves a name against the tree, so a project-level error landed
        // on whatever POU happened to share the caption and pointed an editor at the wrong file.
        var slash = s.LastIndexOfAny(new[] { '\\', '/' });
        if (slash < 0) return null;
        s = s.Substring(slash + 1);

        var dot = s.LastIndexOf('.');
        if (dot <= 0) return null;                      // a path segment with no extension is not a POU file
        s = s.Substring(0, dot);
        return s.Length > 0 && s.IndexOf(' ') < 0 ? s : null;
    }

    /// <summary>
    /// The matched message plus the lines its unterminated quote continues onto, with the BREAKS AS THE PANE WROTE
    /// THEM — the compiler is quoting source text, and `The code '.size;&lt;CRLF&gt;'` is what it means to say.
    /// </summary>
    private static string WithContinuation(string text, Match m)
    {
        // `$` matches before the `\n`, so the capture keeps the `\r` of a CRLF pane; the real break is re-read below.
        var message = m.Groups[5].Value.TrimEnd('\r');
        int at = m.Index + m.Length;
        if (at > 0 && text[at - 1] == '\r') at--; // greedy `.+` swallowed the CR; the break starts there
        while (CountQuotes(message) % 2 != 0 && at < text.Length)
        {
            // AN ODD QUOTE COUNT IS NOT PROOF THE MESSAGE IS UNFINISHED. It quotes SOURCE at you, and ST source
            // is full of string literals: "String constant ''...' too long for destination type 'STRING(4)'"
            // carries FIVE quotes, because the constant it names is itself `''`. The loop then looked for a
            // closing quote that never comes and joined line after line — the error list's own path echo, then
            // the whole build log — into one "message".
            //
            // Measured 2026-09-20 over the TwinCAT conformance recording: 24 diagnostics carried build chrome
            // this way, and it made TwinCAT look like it disagreed with the LSP about a family of string
            // warnings it reports identically. The remark above chose the unbalanced quote OVER "the next line
            // is not a diagnostic" — but the two are not alternatives, and without the second this one runs
            // away. A continuation is SOURCE TEXT; a line that is itself a diagnostic, or the build's own
            // chrome, is not, whatever the quotes say.
            if (IsNotContinuation(text, at)) break;
            int lineStart = at;
            if (text[at] == '\r') at++;
            if (at < text.Length && text[at] == '\n') at++;
            if (at == lineStart) break; // not at a line break — nothing more to join
            int end = text.IndexOf('\n', at);
            if (end < 0) end = text.Length;
            message += text.Substring(lineStart, at - lineStart) + text.Substring(at, end - at).TrimEnd('\r');
            at = end;
        }
        return message;
    }

    /// <summary>Is the line starting at <paramref name="at"/> something a message can never continue INTO
    /// - a diagnostic of its own, or the build's own chrome? Checked on the line as the pane wrote it,
    /// prefix and all.</summary>
    private static bool IsNotContinuation(string text, int at)
    {
        int start = at;
        while (start < text.Length && (text[start] == '\r' || text[start] == '\n')) start++;
        int end = text.IndexOf('\n', start);
        if (end < 0) end = text.Length;
        var line = text.Substring(start, end - start).TrimEnd('\r');
        if (line.Length == 0) return false;
        // its own diagnostic - the same shape the top-level regex matches
        if (Regex.IsMatch(line, @"^.+?(?:\(\d+(?:,\d+)?\))?\s*:\s*(error|warning|message)\s*:\s*", RegexOptions.IgnoreCase))
            return true;
        // the build's own running commentary, which no compiler message continues into
        foreach (var chrome in BuildChrome)
            if (line.IndexOf(chrome, StringComparison.OrdinalIgnoreCase) >= 0) return true;
        return false;
    }

    /// <summary>Lines TwinCAT's build writes about itself. Substrings, because each carries a pane prefix and
    /// a trailing count that differ per build.</summary>
    private static readonly string[] BuildChrome =
    {
        "------ Build started", "Build complete", "Build FAILED", "Build succeeded",
        // "Compile complete -- 1 errors, 0 warnings" is the one that got through: the message above it is
        // "Outputs can't be of type 'REFERENCE TO'", whose apostrophe makes THREE quotes, so the odd-count rule
        // read it as unfinished and swallowed the summary line into the diagnostic (conformance
        // `cc4_output_reference_type`, recorded 2026-09-20 - the only contaminated row left in 2524).
        "Compile complete",
        "Size of generated code", "Size of global data", "Total allocated memory size",
        "Generate TMC information", "Import symbol", "ready for download",
    };

    private static int CountQuotes(string s)
    {
        int n = 0;
        foreach (var c in s) if (c == '\'') n++;
        return n;
    }
}
