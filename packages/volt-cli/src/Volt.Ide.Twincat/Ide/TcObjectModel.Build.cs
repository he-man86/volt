using System;
using System.Collections.Generic;
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
            VoltLog.Warn($"File.SaveAll failed — applied writes may not be on disk: {ex.Message}");
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"the IDE could not save the applied changes, so they are NOT committed to disk: {ex.Message}", ex);
        }
    }

    public bool Build()
    {
        if (_dte == null) return false;
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
        catch { return false; }
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
                var regex = new Regex(
                    @"^(.+?)(?:\((\d+)(?:,(\d+))?\))?\s*:\s*(error|warning|message)\s*:\s*(.+)$",
                    RegexOptions.IgnoreCase | RegexOptions.Multiline);
                foreach (Match m in regex.Matches(text))
                {
                    int lineNum = 0, colNum = 0;
                    if (m.Groups[2].Success) int.TryParse(m.Groups[2].Value, out lineNum);
                    if (m.Groups[3].Success) int.TryParse(m.Groups[3].Value, out colNum);
                    var diagnostic = new BridgeDiagnostic
                    {
                        // "message" is TwinCAT's word for informational; Severity.Of maps it.
                        Severity = Volt.Contracts.Severity.Of(m.Groups[4].Value),
                        Message = m.Groups[5].Value.Trim(),
                        Line = lineNum,
                        Column = colNum,
                    };
                    // ONE ENTRY PER DIAGNOSTIC, however many panes carry it. A PLC build writes the same error
                    // to Visual Studio's own Build pane AND to TwinCAT's, so now that every pane is read the
                    // same error arrives twice; the engineer would see it twice in the Problems list. Keyed on
                    // everything the wire carries, so two genuinely different errors on one line both survive.
                    if (seen.Add($"{diagnostic.Severity}{diagnostic.Line}{diagnostic.Column}{diagnostic.Message}"))
                        result.Add(diagnostic);
                }
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
}
