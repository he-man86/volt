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
            try { for (int i = 0; i < 100; i++) { if ((int)sb.BuildState != 2) break; System.Threading.Thread.Sleep(100); } } catch { }
            sb.Build(true);
            try { for (int i = 0; i < 100; i++) { if ((int)sb.BuildState != 2) break; System.Threading.Thread.Sleep(100); } } catch { }
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

    public IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics()
    {
        var result = new List<BridgeDiagnostic>();
        if (_dte == null) return result;
        try
        {
            dynamic output = _dte.Windows.Item("{34E76E81-EE4A-11D0-AE2E-00A0C90FFFC3}").Object;
            int paneCount = output.OutputWindowPanes.Count;
            for (int p = 1; p <= paneCount; p++)
            {
                dynamic pane;
                try { pane = output.OutputWindowPanes.Item(p); } catch { continue; }
                string name = (string)pane.Name;
                if (!name.Contains("Build") && !name.Contains("TwinCAT")) continue;
                dynamic td = pane.TextDocument;
                dynamic ep = td.StartPoint.CreateEditPoint();
                string text = (string)ep.GetText(td.EndPoint);
                if (string.IsNullOrEmpty(text)) continue;
                var regex = new Regex(
                    @"^(.+?)(?:\((\d+)(?:,(\d+))?\))?\s*:\s*(error|warning|message)\s*:\s*(.+)$",
                    RegexOptions.IgnoreCase | RegexOptions.Multiline);
                foreach (Match m in regex.Matches(text))
                {
                    int lineNum = 0, colNum = 0;
                    if (m.Groups[2].Success) int.TryParse(m.Groups[2].Value, out lineNum);
                    if (m.Groups[3].Success) int.TryParse(m.Groups[3].Value, out colNum);
                    result.Add(new BridgeDiagnostic
                    {
                        // "message" is TwinCAT's word for informational; Severity.Of maps it.
                        Severity = Volt.Contracts.Severity.Of(m.Groups[4].Value),
                        Message = m.Groups[5].Value.Trim(),
                        Line = lineNum,
                        Column = colNum,
                    });
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
