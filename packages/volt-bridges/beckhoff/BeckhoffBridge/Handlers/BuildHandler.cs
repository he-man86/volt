using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// POST /build — Build the TwinCAT project via DTE.Solution.SolutionBuild
/// and emit diagnostics in the cross-bridge canonical shape.
///
/// Response shape (must match CODESYS / TIA bridges):
///   { "success": bool, "duration": ms, "diagnostics": [ ... ] }
///
/// Each diagnostic is the canonical cross-bridge shape:
///   { "severity": "error"|"warning"|"info",
///     "message":  string,
///     "line":     <int, 0 = unknown>,
///     "object":   string | null,    // bare or dotted (e.g. "FB_X.Method")
///     "section":  "decl" | "impl" | null }
///
/// Translation from the IDE's native error shape to this canonical shape
/// lives HERE — each bridge owns the vendor-specific extraction. TwinCAT
/// requires regex parsing of the Build output pane because TcXaeShell does
/// not expose `DTE.ToolWindows.ErrorList` (full Visual Studio does, but
/// TcXaeShell throws `'System.__ComObject' does not contain a definition
/// for 'ToolWindows'`). This is the single source of truth on this
/// platform — no fallbacks, no alternative paths that could mask a bug.
/// </summary>
internal sealed class BuildHandler
{
	private readonly BeckhoffConnection _connection;

	public BuildHandler(BeckhoffConnection connection)
	{
		_connection = connection;
	}

	public object Handle(JsonObject body)
	{
		if (!_connection.IsConnected) throw BridgeException.NotConnected();

		var sw = Stopwatch.StartNew();

		try
		{
			dynamic dte = GetDte();
			dynamic solutionBuild = dte.Solution.SolutionBuild;

			// Wait for any in-progress build to finish before starting a new one.
			// Build(true) is supposed to be synchronous, but TwinCAT may have
			// post-build processing that keeps BuildState at InProgress (2).
			WaitForBuildIdle(solutionBuild);

			// Save all documents before building so in-memory changes flush to
			// disk before the compiler reads them. Without this, builds can
			// produce ghost errors / phantom passes against stale source.
			try { dte.Documents.SaveAll(); }
			catch (Exception ex) { Log.Warn($"[Build] Documents.SaveAll failed - build may use stale on-disk code: {ex.Message}"); }

			// Clear the Build pane so we only parse output from THIS build.
			// Without this, the regex picks up stale diagnostics from earlier
			// builds and reports phantom errors.
			ClearBuildOutputPane(dte);

			solutionBuild.Build(true); // true = wait for build

			// Build(true) may return before TwinCAT finishes post-build
			// processing. Wait until BuildState leaves InProgress so the
			// output pane is fully populated before we read it.
			WaitForBuildIdle(solutionBuild);

			sw.Stop();

			int failedProjects = 0;
			try { failedProjects = solutionBuild.LastBuildInfo; } catch { }
			bool success = failedProjects == 0;

			return new
			{
				success,
				duration = sw.ElapsedMilliseconds,
				diagnostics = ParseBuildPane(dte),
			};
		}
		catch (Exception ex)
		{
			sw.Stop();
			return new
			{
				success = false,
				duration = sw.ElapsedMilliseconds,
				diagnostics = new List<object>
				{
					new Dictionary<string, object?>
					{
						["severity"] = "error",
						["message"] = $"Build failed: {ex.Message}",
						["line"] = 0,
						["object"] = null,
						["section"] = null,
					}
				},
			};
		}
	}

	/// <summary>
	/// Read the Build pane's text and extract diagnostics with the canonical
	/// "file(line) : error|warning: message" regex. Any line that doesn't
	/// match this exact shape is noise (summary lines, status, blank lines)
	/// and skipped.
	/// </summary>
	private static List<object> ParseBuildPane(dynamic dte)
	{
		var diagnostics = new List<object>();
		var paneText = GetBuildPaneText(dte);
		if (string.IsNullOrWhiteSpace(paneText)) return diagnostics;

		// Diagnostic logging — written to bridge log so we can audit
		// what TC actually wrote vs what the regex picked up. Key when
		// a conformance recording is missing diagnostics that a solo
		// push surfaces ("batch-fidelity issue"). Trimmed line counts:
		// total lines, lines that matched the regex, lines that didn't
		// — quick triage of "is the pane content arriving" vs "is the
		// regex too narrow".
		var totalLines = 0;
		var nonEmptyLines = 0;
		var matchedLines = 0;
		var unmatchedSamples = new List<string>();

		foreach (var rawLine in paneText.Split('\n'))
		{
			totalLines++;
			var line = rawLine.Trim();
			if (line.Length == 0) continue;
			nonEmptyLines++;
			var match = LinePattern.Match(line);
			if (!match.Success)
			{
				if (unmatchedSamples.Count < 10) unmatchedSamples.Add(line);
				continue;
			}
			matchedLines++;

			string filePath = match.Groups[1].Value.Trim();
			// Group 2 is optional now (line number — absent for some
			// structural errors). Defaults to 0 = "unknown line".
			int lineNum = 0;
			if (match.Groups[2].Success) int.TryParse(match.Groups[2].Value, out lineNum);
			// Map TC's `message` severity to `info` on the wire — same
			// thing the BridgeDiagnostic shape uses ("info" not "message").
			string severity = match.Groups[3].Value.ToLowerInvariant();
			if (severity == "message") severity = "info";
			string message = match.Groups[4].Value.Trim();

			diagnostics.Add(new Dictionary<string, object?>
			{
				["severity"] = severity,
				["message"] = message,
				["line"] = lineNum,
				["object"] = ExtractObjectName(filePath),
				["section"] = DetectSection(filePath),
			});
		}

		Log.Ide($"[Build] pane: {paneText.Length} chars, {totalLines} lines, {nonEmptyLines} non-empty, {matchedLines} matched-regex, {diagnostics.Count} diagnostics");
		if (unmatchedSamples.Count > 0)
		{
			Log.Ide($"[Build] {unmatchedSamples.Count} unmatched samples (up to 10):");
			foreach (var s in unmatchedSamples) Log.Ide($"[Build]   | {s}");
		}
		// Full pane dump to temp file for diagnosing batch-fidelity
		// issues (errors that solo-push surfaces but disappear in bulk).
		// Filename includes a timestamp so multiple consecutive builds
		// each get their own file — no overwrite, easy to compare.
		try
		{
			var dumpPath = System.IO.Path.Combine(
				System.IO.Path.GetTempPath(),
				$"volt-beckhoff-build-pane-{DateTime.Now:HHmmss}.txt");
			System.IO.File.WriteAllText(dumpPath, paneText);
			Log.Ide($"[Build] full pane dumped to {dumpPath}");
		}
		catch (Exception ex)
		{
			Log.Warn($"[Build] pane dump failed: {ex.Message}");
		}
		return diagnostics;
	}

	/// <summary>
	/// Match TwinCAT build pane lines in the canonical shapes:
	///   "path\file.TcPOU(line) : error|warning|message: text"
	///   "path\file.TcPOU;Obj.Method : error|warning|message: text"  (no line — structural / signature errors)
	///   "path\file.TcPOU : error|warning|message: text"             (no line, no nested object)
	///
	/// The `(line)` group is OPTIONAL because TC writes line-numberless
	/// errors for declaration-level issues (e.g. "An 'FB_Init'-Method
	/// of a functionblock needs two inputs 'bInitRetains' and
	/// 'bInCopyCode' of type BOOL"). Without this, lifecycle errors
	/// silently dropped — surfaced via the conformance harness.
	///
	/// `message` is a TC-specific severity used for `{info}` / `{text}`
	/// pragma output (and possibly other channels). Maps to LSP-side
	/// `info` severity in DetectSection… no, in the BuildResponse
	/// shape it stays as `"message"`; clients can choose how to map.
	/// </summary>
	private static readonly Regex LinePattern = new(
		@"^(.+?)(?:\((\d+)\))?\s*:\s*(error|warning|message)\s*:\s*(.+)$",
		RegexOptions.IgnoreCase | RegexOptions.Compiled);

	/// <summary>
	/// Concatenated text of every output pane named "Build" or "TwinCAT".
	/// Both names appear in the wild depending on TcXaeShell version.
	/// </summary>
	private static string GetBuildPaneText(dynamic dte)
	{
		var sb = new System.Text.StringBuilder();
		try
		{
			dynamic outputWindow = dte.Windows.Item("{34E76E81-EE4A-11D0-AE2E-00A0C90FFFC3}");
			dynamic outputObj = outputWindow.Object;
			int paneCount = outputObj.OutputWindowPanes.Count;

			for (int p = 1; p <= paneCount; p++)
			{
				try
				{
					dynamic pane = outputObj.OutputWindowPanes.Item(p);
					string paneName = (string)pane.Name;
					if (!paneName.Contains("Build", StringComparison.OrdinalIgnoreCase)
						&& !paneName.Contains("TwinCAT", StringComparison.OrdinalIgnoreCase))
					{
						continue;
					}
					dynamic textDoc = pane.TextDocument;
					dynamic editPoint = textDoc.StartPoint.CreateEditPoint();
					string text = editPoint.GetText(textDoc.EndPoint);
					if (!string.IsNullOrEmpty(text)) sb.Append(text).Append('\n');
				}
				catch { /* skip individual panes that misbehave */ }
			}
		}
		catch (Exception ex)
		{
			Log.Warn($"[Build] Output pane unreachable: {ex.Message}");
		}
		return sb.ToString();
	}

	/// <summary>Clear the Build output pane so we only parse output from the current build.</summary>
	private static void ClearBuildOutputPane(dynamic dte)
	{
		try
		{
			dynamic outputWindow = dte.Windows.Item("{34E76E81-EE4A-11D0-AE2E-00A0C90FFFC3}");
			dynamic outputObj = outputWindow.Object;
			int paneCount = outputObj.OutputWindowPanes.Count;
			for (int p = 1; p <= paneCount; p++)
			{
				try
				{
					dynamic pane = outputObj.OutputWindowPanes.Item(p);
					string paneName = (string)pane.Name;
					if (paneName.Contains("Build", StringComparison.OrdinalIgnoreCase)
						|| paneName.Contains("TwinCAT", StringComparison.OrdinalIgnoreCase))
					{
						pane.Clear();
					}
				}
				catch { continue; }
			}
		}
		catch { /* ignore — proceed and tolerate stale output */ }
	}

	/// <summary>
	/// Wait until no build is in progress (BuildState != 2).
	/// Polls every 100ms, times out after 10s.
	/// </summary>
	private static void WaitForBuildIdle(dynamic solutionBuild)
	{
		try
		{
			for (int i = 0; i < 100; i++) // 100 × 100ms = 10s max
			{
				int state = (int)solutionBuild.BuildState;
				if (state != 2) return; // 2 = vsBuildStateInProgress
				Thread.Sleep(100);
			}
		}
		catch { /* ignore — proceed with build attempt */ }
	}

	private dynamic GetDte()
	{
		return _connection.Dte
			?? throw BridgeException.NotConnected();
	}

	/// <summary>
	/// Map a TwinCAT path to a canonical object name.
	///   "C:\…\POUs\MAIN.TcPOU"                       → "MAIN"
	///   "C:\…\FB_X.TcPOU;FB_X.TriggerAlert"          → "FB_X.TriggerAlert"
	///   "C:\…\FB_X.TcPOU;FB_X.Speed (Declaration)"   → "FB_X.Speed"
	///   ""                                            → null  (project-level)
	/// </summary>
	private static string? ExtractObjectName(string path)
	{
		if (string.IsNullOrEmpty(path)) return null;
		var stripped = StripSectionSuffix(path);
		var semi = stripped.IndexOf(';');
		if (semi >= 0) return stripped[(semi + 1)..].Trim();
		var match = Regex.Match(stripped, @"[/\\]([^/\\]+)\.Tc(?:POU|DUT|GVL)$", RegexOptions.IgnoreCase);
		return match.Success ? match.Groups[1].Value : null;
	}

	/// <summary>
	/// TwinCAT marks "(Declaration)" / "(Implementation)" in the FileName tail.
	/// Map to the canonical "decl" / "impl" or null when neither marker is present.
	/// </summary>
	private static string? DetectSection(string path)
	{
		if (string.IsNullOrEmpty(path)) return null;
		if (path.Contains("(Declaration)", StringComparison.OrdinalIgnoreCase)) return "decl";
		if (path.Contains("(Implementation)", StringComparison.OrdinalIgnoreCase)) return "impl";
		return null;
	}

	private static string StripSectionSuffix(string path)
	{
		var m = Regex.Match(path, @"\s*\((Declaration|Implementation)\)\s*$", RegexOptions.IgnoreCase);
		return m.Success ? path[..m.Index].TrimEnd() : path;
	}
}
