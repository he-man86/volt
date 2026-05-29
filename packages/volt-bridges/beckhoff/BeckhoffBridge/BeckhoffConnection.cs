using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using BeckhoffBridge.Helpers;

namespace BeckhoffBridge;

/// <summary>
/// Manages the connection to a running TwinCAT XAE instance via COM Automation Interface.
/// Uses dynamic/late-binding for COM interop so no compile-time TwinCAT references are needed.
///
/// Key COM objects used (all via dynamic dispatch):
///   EnvDTE80.DTE2         - Visual Studio / TcXaeShell automation root
///   ITcSysManager         - TwinCAT System Manager (from project.Object)
///   ITcSmTreeItem         - Tree items (POUs, GVLs, DUTs, folders)
///   ITcPlcDeclaration     - Provides DeclarationText property
///   ITcPlcImplementation  - Provides ImplementationText property
/// </summary>
internal sealed class BeckhoffConnection
{
	private dynamic? _dte;          // EnvDTE80.DTE2
	private dynamic? _sysManager;   // ITcSysManager
	private dynamic? _nestedProject; // ITcSmTreeItem — NestedProject (source code root)
	private dynamic? _plcNode;      // The PLC project node (for re-acquiring NestedProject)
	private string? _projectName;
	private string? _projectPath;
	private string? _plcProjectName;
	private string? _plcProjectPath; // e.g. "TIPC^Untitled1"
	private string? _lookupBasePath; // LookupTreeItem base path for NestedProject items
	private string? _ideProgId;     // The DTE ProgID we attached with (for IdeName)
	private string? _ideVersion;    // Captured at Connect() — _dte.Version may be unreadable later

	private readonly BlockingCollection<Action> _staQueue = new();

	// -------------------------------------------------------------------------
	// Properties
	// -------------------------------------------------------------------------

	public bool IsConnected => _dte != null && _sysManager != null && _plcProjectPath != null;
	public string? ProjectName => _projectName;
	public string? PlcProjectName => _plcProjectName;
	public string? PlcProjectPath => _plcProjectPath;

	/// <summary>
	/// Set when an HTTP handler caught an RPC-class COM failure (server
	/// unavailable, call rejected, proxy disconnected, …). The HTTP
	/// dispatcher rejects subsequent non-/health calls with 503
	/// PLC_DEGRADED until the next /health probe verifies the channel
	/// is responsive again. Volatile so reads from the HTTP threadpool
	/// see writes from the STA thread without locking.
	/// </summary>
	private volatile bool _isDegraded;
	private string? _degradedReason;
	public bool IsDegraded => _isDegraded;
	public string? DegradedReason => _degradedReason;

	/// <summary>Flag the COM channel as wedged. Logged loudly so the bridge log shows the trigger.</summary>
	public void MarkDegraded(string reason)
	{
		_degradedReason = reason;
		if (!_isDegraded)
		{
			_isDegraded = true;
			Log.Warn($"[Connection] DEGRADED: {reason}");
		}
	}

	/// <summary>Clear the degraded flag — called from BuildHealthSnapshot after a successful probe.</summary>
	public void ClearDegraded()
	{
		if (_isDegraded)
		{
			Log.Ide("[Connection] DEGRADED cleared — COM channel responsive again");
		}
		_isDegraded = false;
		_degradedReason = null;
	}

	/// <summary>
	/// Walk an exception chain and decide whether it looks like a TwinCAT
	/// COM RPC failure (server gone, channel busy, call rejected). Used
	/// by HttpBridge to flip the connection into DEGRADED state. Bare
	/// "item not found" COMExceptions (E_INVALIDARG etc.) are NOT
	/// RPC failures — we deliberately scope this to HRESULTs that
	/// indicate the COM channel itself is broken, not domain errors
	/// that just happen to come through COM.
	/// </summary>
	public static bool IsRpcFailure(Exception? ex)
	{
		for (var e = ex; e != null; e = e.InnerException)
		{
			if (e is COMException com)
			{
				uint hr = unchecked((uint)com.HResult);
				// RPC_S_SERVER_UNAVAILABLE
				if (hr == 0x800706BAu) return true;
				// RPC_S_CALL_FAILED, RPC_S_CALL_FAILED_DNE
				if (hr == 0x800706BEu || hr == 0x800706BFu) return true;
				// RPC_E_* family: 0x80010001..0x800101FF (call rejected /
				// disconnected / retry-later / call cancelled, etc.).
				if ((hr & 0xFFFFFF00u) == 0x80010100u) return true;
				if (hr == 0x80010001u || hr == 0x80010108u || hr == 0x8001010Au) return true;
			}
		}
		return false;
	}

	/// <summary>Friendly name of the host IDE we attached to (e.g. "Visual Studio 2022", "TcXaeShell").</summary>
	public string? IdeName => _ideProgId switch
	{
		"VisualStudio.DTE.17.0" => "Visual Studio 2022",
		"VisualStudio.DTE.16.0" => "Visual Studio 2019",
		"TcXaeShell.DTE.15.0" => "TcXaeShell",
		_ => _ideProgId,
	};

	/// <summary>DTE version string captured at Connect time (e.g. "17.0").</summary>
	public string? IdeVersion => _ideVersion;

	/// <summary>
	/// LookupTreeItem base path for items inside the PLC project.
	/// e.g. "TIPC^Untitled1^Untitled1 Project" — used to resolve NestedProject
	/// items to their LookupTreeItem paths for write operations.
	/// </summary>
	public string? LookupBasePath => _lookupBasePath;

	/// <summary>The DTE automation root (for compile/build operations).</summary>
	public dynamic? Dte => _dte;

	public bool ProjectDirty
	{
		get
		{
			try
			{
				if (_dte == null) return false;
				return !_dte.Solution.Saved;
			}
			catch { return false; }
		}
	}

	// -------------------------------------------------------------------------
	// Connection
	// -------------------------------------------------------------------------

	/// <summary>
	/// Discover a running TwinCAT XAE instance and attach to it.
	/// Tries VS 2022, VS 2019, and TcXaeShell in order.
	/// </summary>
	public void Connect()
	{
		// Try different DTE ProgIDs for various IDE versions
		string[] progIds =
		[
			"VisualStudio.DTE.17.0",   // VS 2022
			"VisualStudio.DTE.16.0",   // VS 2019
			"TcXaeShell.DTE.15.0",     // TcXaeShell
		];

		Exception? lastException = null;
		foreach (var progId in progIds)
		{
			try
			{
				_dte = GetActiveObject(progId);
				_ideProgId = progId;
				try { _ideVersion = (string?)_dte!.Version; } catch { _ideVersion = null; }
				break;
			}
			catch (COMException ex)
			{
				lastException = ex;
				continue;
			}
		}

		if (_dte == null)
			throw new InvalidOperationException(
				"No running TwinCAT XAE instance found. "
				+ "Start Visual Studio or TcXaeShell with a TwinCAT project open first.",
				lastException);

		// Find the TwinCAT project in the solution
		FindTwinCatProject();

		// Find the PLC project within the TwinCAT project
		FindPlcProject();
	}

	/// <summary>Release COM references.</summary>
	public void Disconnect()
	{
		if (_sysManager != null)
		{
			try { Marshal.ReleaseComObject(_sysManager); } catch { /* ignore */ }
			_sysManager = null;
		}

		// Don't close the DTE - we're just detaching, not closing the IDE
		if (_dte != null)
		{
			try { Marshal.ReleaseComObject(_dte); } catch { /* ignore */ }
			_dte = null;
		}

		if (_nestedProject != null)
		{
			try { Marshal.ReleaseComObject(_nestedProject); } catch { /* ignore */ }
			_nestedProject = null;
		}

		_projectName = null;
		_projectPath = null;
		_plcProjectName = null;
		_plcProjectPath = null;
		_lookupBasePath = null;
		_ideProgId = null;
		_ideVersion = null;
		// IsConnected is now false — the degraded gate would be
		// redundant with PLC_DISCONNECTED. Clear it so the next
		// Connect() starts fresh.
		_isDegraded = false;
		_degradedReason = null;
	}

	/// <summary>
	/// Cheaply verify the attached IDE process is still alive by touching a
	/// COM property. Returns false if the DTE is gone (e.g. user closed
	/// TwinCAT) — RPC failures throw, indicating the COM object is dead.
	/// MUST be called on the STA thread.
	/// </summary>
	public bool ProbeIdeAlive()
	{
		if (_dte == null) return false;
		try
		{
			// Touching Solution.Count is one of the cheapest valid DTE calls
			// and reliably faults if the IDE has exited.
			var _ = (int)_dte.Solution.Count;
			return true;
		}
		catch
		{
			return false;
		}
	}

	/// <summary>
	/// Build the consolidated /health response. Probes the IDE; if the probe
	/// fails, drops cached COM references so subsequent calls report
	/// disconnected. MUST be called on the STA thread.
	/// </summary>
	public object BuildHealthSnapshot(string version)
	{
		bool ideAlive = ProbeIdeAlive();

		if (!ideAlive && _dte != null)
		{
			// IDE went away — release stale COM refs without throwing.
			try { Disconnect(); } catch { /* ignore */ }
		}
		else if (ideAlive && _isDegraded)
		{
			// COM channel is responsive again — clear the degraded
			// gate so the next non-/health call can proceed.
			ClearDegraded();
		}

		bool connected = IsConnected;
		return new
		{
			status = connected ? (_isDegraded ? "degraded" : "healthy") : "unavailable",
			platform = "beckhoff",
			connected,
			ideAlive,
			degraded = _isDegraded,
			degradedReason = _degradedReason,
			ideName = IdeName,
			ideVersion = IdeVersion,
			version,
			projectName = _projectName,
			plcProjectName = _plcProjectName,
			projectDirty = ProjectDirty,
		};
	}

	/// <summary>Save the solution.</summary>
	public void SaveProject()
	{
		if (_dte == null) throw new InvalidOperationException("Not connected");
		_dte.Solution.SaveAs(_dte.Solution.FileName);
	}

	// -------------------------------------------------------------------------
	// STA Thread Dispatching
	// -------------------------------------------------------------------------

	/// <summary>
	/// Execute an action on the STA thread and wait for the result.
	/// Called from the HTTP background thread; the action is queued and
	/// processed by the main STA thread's message pump.
	/// </summary>
	public T RunOnStaThread<T>(Func<T> action)
	{
		var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
		_staQueue.Add(() =>
		{
			try
			{
				tcs.SetResult(action());
			}
			catch (Exception ex)
			{
				tcs.SetException(ex);
			}
		});
		return tcs.Task.GetAwaiter().GetResult();
	}

	/// <summary>
	/// Process queued actions on the STA thread.
	/// Called from the main thread's message pump loop.
	/// Wraps each action in try-catch to prevent COM faults from crashing the process.
	/// </summary>
	public void ProcessQueue()
	{
		while (_staQueue.TryTake(out var action, TimeSpan.FromMilliseconds(50)))
		{
			try
			{
				action();
			}
			catch (Exception ex)
			{
				Log.Warn($"[STA] Unhandled exception in queue action: {ex.Message}");
			}
		}
	}

	// -------------------------------------------------------------------------
	// Tree Navigation
	// -------------------------------------------------------------------------

	/// <summary>Wrapper around ITcSysManager.LookupTreeItem.</summary>
	public dynamic LookupTreeItem(string path)
	{
		if (_sysManager == null) throw new InvalidOperationException("Not connected");
		try
		{
			return _sysManager.LookupTreeItem(path);
		}
		catch (COMException ex)
		{
			throw new InvalidOperationException($"Tree item not found: {path}", ex);
		}
	}

	/// <summary>
	/// Recursively search for an item by name starting from a parent tree item.
	/// Returns null if not found.
	/// </summary>
	public dynamic? FindItemByName(dynamic parent, string name)
	{
		try
		{
			int count = parent.ChildCount;
			for (int i = 1; i <= count; i++) // COM collections are 1-based
			{
				dynamic child = parent.Child[i];
				string childName = child.Name;

				if (string.Equals(childName, name, StringComparison.OrdinalIgnoreCase))
				{
					// Only return real CRUD items (POU/GVL/DUT/Interface).
					// PlcTask child entries (TaskCallReference, subType 650)
					// share names with the programs they call — if a program
					// "PLC_PRG" was removed but the task still references that
					// name, the call-ref child has Name="PLC_PRG" and used to
					// be returned here, causing pushItem-create to falsely error
					// "ALREADY_EXISTS" and pushItem-update to crash on a COM object
					// that has no DeclarationText property. Same problem for
					// Tasks (621), Libraries (657), TmcFile (653), etc. that
					// happen to share a name with a real CRUD item.
					int itemType = GetItemType(child);
					if (BlockTypeMapper.IsTopLevelCrud(itemType))
						return child;
					// Fall through: continue walking — maybe the real CRUD
					// item lives deeper.
				}

				// Skip recursion into properties — their children (Get/Set) are never
				// the items we search for, and interface properties crash COM.
				if (IsPropertyItem(child))
					continue;

				var found = FindItemByName(child, name);
				if (found != null) return found;
			}
		}
		catch (Exception ex)
		{
			// Catching here aborts the rest of this branch silently —
			// items at higher indices won't be visited. That's a real
			// risk for "name not found" mysteries, so log it.
			Log.Warn($"[Connection] FindItemByName aborted while searching for '{name}': {ex.Message}");
		}

		return null;
	}

	/// <summary>
	/// Get the TwinCAT System Manager root — the parent of TIPC (PLC),
	/// TIID (I/O Devices), TINC (Motion / NC), and other top-level subtrees.
	/// Used by the discovery endpoints (/tree, /debug with path) to reach
	/// items outside the PLC source-code tree — drives, NC axes, IO
	/// devices, etc. — purely for type-code documentation; volt-agent
	/// itself only syncs PLC source.
	///
	/// Strategy: probe a list of known top-level subtree paths and return
	/// a synthetic parent node that exposes them as children. ITcSysManager
	/// doesn't expose a single "root" via LookupTreeItem (empty string
	/// throws on many versions), so we enumerate the well-known subtrees
	/// instead — same approach TwinCAT's own UI uses to populate Solution
	/// Explorer's left rail.
	/// </summary>
	public List<dynamic> GetSystemRoots()
	{
		if (_sysManager == null) throw new InvalidOperationException("Not connected");
		// Well-known top-level subtree paths in TwinCAT 3:
		//   TIPC = PLC, TIID = I/O Devices, TINC = NC (Motion),
		//   TICC = CNC, TISC = Safety, TIRC = Real-Time, TIRT = Routes,
		//   TIRR = Run-Time, TIAC = Analytics, TIAE = AE (TC/BSD)
		// We probe each — missing subtrees just throw (TwinCAT installs
		// vary by license), so we collect only what's actually present.
		var roots = new List<dynamic>();
		string[] knownPaths = { "TIPC", "TIID", "TINC", "TICC", "TISC", "TIRC", "TIRT", "TIRR", "TIAC", "TIAE" };
		foreach (var path in knownPaths)
		{
			try { roots.Add(_sysManager.LookupTreeItem(path)); }
			catch { /* subtree not present in this license — skip */ }
		}
		// Also expose the PLC NestedProject — it's a parallel COM view that
		// LookupTreeItem doesn't reach. Most of what humans care about lives
		// here: POUs, DUTs, GVLs, Interfaces, Visualizations, Recipe Manager,
		// Image Pools, plus their nested method/property/action children.
		// Without this, /tree misses ~everything code-shaped.
		try
		{
			var nested = GetPlcProjectRoot();
			if (nested != null) roots.Add(nested);
		}
		catch { /* no PLC project bound — skip */ }
		return roots;
	}

	/// <summary>
	/// Get the PLC project root tree item (NestedProject if available).
	/// This is the correct root for CRUD operations on POUs, GVLs, DUTs.
	/// </summary>
	public dynamic GetPlcProjectRoot()
	{
		// Always re-acquire NestedProject fresh from the PLC node
		// to avoid stale COM references after tree modifications
		if (_plcNode != null)
		{
			try { return _plcNode.NestedProject; }
			catch (Exception ex)
			{
				// Loud — falling back to a stale or LookupTreeItem-based
				// root means subsequent writes won't see in-flight tree
				// changes. If this fires we want to know.
				Log.Warn($"[Connection] Re-acquiring NestedProject failed, falling back: {ex.Message}");
			}
		}
		if (_nestedProject != null) return _nestedProject;
		if (_plcProjectPath == null) throw new InvalidOperationException("No PLC project found");
		return LookupTreeItem(_plcProjectPath);
	}

	/// <summary>
	/// Find the parent COM object that directly contains a named child item.
	/// Searches the NestedProject tree recursively.
	/// Returns null if not found.
	/// </summary>
	private dynamic? FindParentItem(string name)
	{
		var root = GetPlcProjectRoot();
		return FindParentItemRecursive(root, name);
	}

	private dynamic? FindParentItemRecursive(dynamic parent, string name)
	{
		try
		{
			int count = parent.ChildCount;
			for (int i = 1; i <= count; i++)
			{
				dynamic child = parent.Child[i];
				string childName = (string)child.Name;

				if (string.Equals(childName, name, StringComparison.OrdinalIgnoreCase))
					return parent;

				// Skip recursion into properties — their children are Get/Set only,
				// and interface properties crash COM on enumeration.
				if (IsPropertyItem(child))
					continue;

				var found = FindParentItemRecursive(child, name);
				if (found != null) return found;
			}
		}
		catch (Exception ex)
		{
			Log.Warn($"[Connection] FindParentItemRecursive aborted while searching for '{name}': {ex.Message}");
		}

		return null;
	}

	/// <summary>
	/// Find an item by name using LookupTreeItem (main tree), falling back to
	/// NestedProject search. The main tree item supports all write operations.
	/// </summary>
	public dynamic? LookupItemByName(string name)
	{
		// Try LookupTreeItem with the base path first (supports all operations)
		if (_lookupBasePath != null)
		{
			// Search NestedProject to find the relative path
			var root = GetPlcProjectRoot();
			string? relativePath = FindRelativePath(root, name);
			if (relativePath != null)
			{
				try
				{
					string fullPath = $"{_lookupBasePath}^{relativePath}";
					return _sysManager!.LookupTreeItem(fullPath);
				}
				catch { /* LookupTreeItem failed, fall through */ }
			}
		}

		// Fallback: search NestedProject directly
		var rootFallback = GetPlcProjectRoot();
		return FindItemByName(rootFallback, name);
	}

	/// <summary>
	/// Find the write-capable parent of a named item via LookupTreeItem.
	/// Falls back to FindParentItem (NestedProject) if LookupTreeItem fails.
	/// </summary>
	public dynamic? LookupParentByName(string name)
	{
		if (_lookupBasePath != null)
		{
			var root = GetPlcProjectRoot();
			string? relativePath = FindRelativePath(root, name);
			if (relativePath != null)
			{
				int lastCaret = relativePath.LastIndexOf('^');
				try
				{
					if (lastCaret < 0)
					{
						// Item is directly under project root
						return _sysManager!.LookupTreeItem(_lookupBasePath);
					}
					string parentRelPath = relativePath.Substring(0, lastCaret);
					return _sysManager!.LookupTreeItem($"{_lookupBasePath}^{parentRelPath}");
				}
				catch { /* LookupTreeItem failed, fall through */ }
			}
		}

		// Fallback
		return FindParentItem(name);
	}

	/// <summary>
	/// Find the relative path from the project root to a named item.
	/// e.g. returns "POUs^MAIN" or "_Test_FB" depending on tree structure.
	/// </summary>
	public string? FindRelativePath(dynamic parent, string name, string prefix = "")
	{
		try
		{
			int count = parent.ChildCount;
			for (int i = 1; i <= count; i++)
			{
				dynamic child = parent.Child[i];
				string childName = (string)child.Name;
				string path = string.IsNullOrEmpty(prefix) ? childName : $"{prefix}^{childName}";

				if (string.Equals(childName, name, StringComparison.OrdinalIgnoreCase))
				{
					// Same filter as FindItemByName: only top-level CRUD items
					// (POU/GVL/DUT/Interface). Tasks call references (650) and
					// other PlcTask children commonly share names with the
					// programs they reference — without this filter a deleted
					// program POU + still-present task-call-ref would route
					// here and return a path that, when handed to
					// LookupTreeItem, resolves to the call-ref COM object
					// instead of the missing program.
					int itemType = GetItemType(child);
					if (BlockTypeMapper.IsTopLevelCrud(itemType))
						return path;
					// Fall through and keep walking.
				}

				// Skip recursion into properties — their children are Get/Set accessors,
				// never the items we search for. Interface property children crash COM.
				if (IsPropertyItem(child))
					continue;

				var found = FindRelativePath(child, name, path);
				if (found != null) return found;
			}
		}
		catch (Exception ex)
		{
			Log.Warn($"[Connection] FindRelativePath aborted while searching for '{name}': {ex.Message}");
		}

		return null;
	}

	// -------------------------------------------------------------------------
	// Private Helpers
	// -------------------------------------------------------------------------

	/// <summary>Find the TwinCAT project in the open solution.</summary>
	private void FindTwinCatProject()
	{
		dynamic solution = _dte!.Solution;
		_projectPath = (string)solution.FileName;

		int projectCount = solution.Projects.Count;
		for (int i = 1; i <= projectCount; i++)
		{
			dynamic project = solution.Projects.Item(i);
			try
			{
				// TwinCAT projects expose ITcSysManager via project.Object
				dynamic sysManager = project.Object;
				// Verify it's a TwinCAT project by trying to access the PLC config
				sysManager.LookupTreeItem("TIPC");

				_sysManager = sysManager;
				_projectName = (string)project.Name;
				return;
			}
			catch
			{
				// Not a TwinCAT project, continue
				continue;
			}
		}

		throw new InvalidOperationException(
			"No TwinCAT project found in the open solution. "
			+ "Make sure a TwinCAT XAE project is loaded.");
	}

	/// <summary>Find the first PLC project under TIPC.</summary>
	private void FindPlcProject()
	{
		dynamic tipc = LookupTreeItem("TIPC");
		int childCount = tipc.ChildCount;

		if (childCount == 0)
			throw new InvalidOperationException(
				"No PLC project found. Add a PLC project to the TwinCAT solution first.");

		// Use the first PLC project
		dynamic plcNode = tipc.Child[1];
		_plcProjectName = (string)plcNode.Name;

		// Access the NestedProject (contains POUs, GVLs, DUTs — the source code tree).
		// TwinCAT PLC projects have two areas:
		//   NestedProject = source code (POUs, GVLs, DUTs) — via ITcProjectRoot
		//   Child[1]      = Instance (task configuration) — via regular children
		try
		{
			_plcNode = plcNode;
			_nestedProject = plcNode.NestedProject;
			_plcProjectPath = $"TIPC^{_plcProjectName}";

			// Find the LookupTreeItem base path for NestedProject items.
			// Items in NestedProject are resolved via "TIPC^{name}^{name} Project^..."
			int projChildCount = plcNode.ChildCount;
			for (int j = 1; j <= projChildCount; j++)
			{
				try
				{
					dynamic projChild = plcNode.Child[j];
					string projChildName = (string)projChild.Name;
					if (projChildName.EndsWith(" Project", StringComparison.OrdinalIgnoreCase))
					{
						_lookupBasePath = $"TIPC^{_plcProjectName}^{projChildName}";
						break;
					}
				}
				catch { /* ignore */ }
			}
			// Fallback: construct the typical path pattern
			if (_lookupBasePath == null)
				_lookupBasePath = $"TIPC^{_plcProjectName}^{_plcProjectName} Project";
			return;
		}
		catch (Exception ex)
		{
			Log.Warn($"[Connection] NestedProject not available: {ex.Message}");
		}

		// Fallback: find the project container via Child[] enumeration
		int plcChildCount = plcNode.ChildCount;
		for (int i = 1; i <= plcChildCount; i++)
		{
			dynamic child = plcNode.Child[i];
			string childName = (string)child.Name;

			if (childName.EndsWith(" Project", StringComparison.OrdinalIgnoreCase))
			{
				_plcProjectPath = $"TIPC^{_plcProjectName}^{childName}";
				return;
			}
		}

		// Last fallback: use the PLC node itself
		_plcProjectPath = $"TIPC^{_plcProjectName}";
	}

	// -------------------------------------------------------------------------
	// Shared Helpers for Handlers
	// -------------------------------------------------------------------------

	/// <summary>
	/// Find an item by name in the PLC project tree, or throw NotFound.
	/// Uses LookupTreeItem (write-capable) first, falls back to NestedProject.
	/// </summary>
	public dynamic FindItemOrThrow(string name, string typeName)
	{
		return LookupItemByName(name)
			?? throw BridgeException.NotFound(typeName, name);
	}

	/// <summary>
	/// Check if a tree item is a property (should skip recursion into its children).
	/// Properties' children are Get/Set accessors — never the items we search for.
	/// Enumerating interface property children (subtypes 654/655) crashes TwinCAT COM.
	/// Detects by subtype (608/612) AND by declaration header for NestedProject items (subtype 0).
	/// </summary>
	private static bool IsPropertyItem(dynamic child)
	{
		int subType = 0;
		try { subType = (int)child.ItemSubType; } catch { }
		if (subType == 608 || subType == 612) // PropertySubType, InterfacePropertySubType
			return true;
		if (subType == 0)
		{
			// NestedProject item — detect by declaration header
			string decl = ReadDeclaration(child);
			if (decl.TrimStart().StartsWith("PROPERTY", StringComparison.OrdinalIgnoreCase))
				return true;
		}
		return false;
	}

	// -------------------------------------------------------------------------
	// Item versioning (content fingerprints for the /refs, /fetch, /push wire)
	// -------------------------------------------------------------------------

	/// <summary>
	/// Compute a stable per-item version — a short sha1 over the item's
	/// canonical content (declaration + implementation + recursively the
	/// same for each child, sorted by name). Two reads of the same IDE
	/// state always produce the same version; any change to the content
	/// changes the version. The wire equivalent of git's blob SHA, scoped
	/// per POU/GVL/DUT/Interface.
	///
	/// Returns the first 16 hex chars — collision-resistant enough for a
	/// project's worth of items.
	/// </summary>
	public static string ComputeItemVersion(dynamic item)
	{
		string topName = "?";
		try { topName = (string)item.Name; } catch { }
		Log.Ide($"[hash] start: {topName}");
		try
		{
			var sb = new StringBuilder();
			AppendItemContent(sb, item, topName);
			var v = ShortSha1(sb.ToString());
			Log.Ide($"[hash] done:  {topName} -> {v}");
			return v;
		}
		catch (Exception ex)
		{
			Log.Warn($"[hash] FAILED on {topName}: {ex.Message}");
			throw;
		}
	}

	private static void AppendItemContent(StringBuilder sb, dynamic item, string crumb)
	{
		// Per-item COM reads. Logged BEFORE the call so a TwinCAT crash
		// leaves a clear "we were reading X" trail in bridge.log — the
		// last [hash] line before silence is the offending item.
		Log.Ide($"[hash]   read decl: {crumb}");
		sb.Append("d=").Append(ReadDeclaration(item)).Append('\0');
		Log.Ide($"[hash]   read impl: {crumb}");
		sb.Append("i=").Append(ReadImplementation(item)).Append('\0');

		// Walk children sorted by name for stability.
		var named = new List<(string name, dynamic child)>();
		try
		{
			int count = (int)item.ChildCount;
			Log.Ide($"[hash]   children of {crumb}: {count}");
			for (int i = 1; i <= count; i++)
			{
				try
				{
					var child = item.Child[i];
					string name = (string)child.Name;
					named.Add((name, child));
				}
				catch (Exception ex) { Log.Warn($"[hash]   skip child {i} of {crumb}: {ex.Message}"); }
			}
		}
		catch (Exception ex) { Log.Warn($"[hash]   ChildCount failed on {crumb}: {ex.Message}"); }

		// Compute parent-type ONCE before iterating children. Each per-child
		// ItemSubType / GetItemType call is a COM round-trip that runs at
		// ~13s when the channel is degraded (e.g. after touching an
		// interface property accessor). Reading once + reusing avoids
		// compounding the slowdown across N children.
		int thisType = 0;
		try { thisType = GetItemType(item); } catch (Exception ex) { Log.Warn($"[hash]   GetItemType failed on {crumb}: {ex.Message}"); }

		named.Sort((a, b) => string.CompareOrdinal(a.name, b.name));
		sb.Append("c[\0");
		foreach (var (name, child) in named)
		{
			sb.Append(" n=").Append(name).Append('\0');
			AppendChildContent(sb, thisType, child, $"{crumb}.{name}");
			sb.Append(" --\0");
		}
		sb.Append("]\0");
	}

	/// <summary>
	/// Recurse into a child item, but apply guards for known TwinCAT COM
	/// fragility based on the PARENT type (passed in pre-computed):
	///   1. Parent is InterfaceProperty (612): Get/Set accessor children
	///      HAVE NO BODY. Reading `ImplementationText` on them hangs the
	///      COM channel for ~13s and trips an RPC-unavailable error
	///      (verified live via instrumented hash walk against
	///      TC3_PlcSample_BasicPlcElements). Emit a stable placeholder
	///      so the hash changes on signature changes but skip the
	///      crash-prone COM call.
	/// </summary>
	private static void AppendChildContent(StringBuilder sb, int parentType, dynamic child, string crumb)
	{
		if (parentType == 612 /* InterfaceProperty */)
		{
			// Interface property accessor (Get / Set). They are signatures
			// — no body, no addressable declaration text either. Reading
			// EITHER DeclarationText or ImplementationText via COM hangs
			// the channel for ~13s per call and trips RPC-unavailable.
			// Hash by accessor name only (Get vs Set is the only thing
			// that varies); presence already comes through the parent's
			// hasGetter / hasSetter on the wire.
			Log.Ide($"[hash]   skip accessor (interface): {crumb}");
			sb.Append("d=<interface-accessor>\0");
			sb.Append("i=<interface-accessor-no-body>\0");
			sb.Append("c[]\0");
			return;
		}

		AppendItemContent(sb, child, crumb);
	}

	/// <summary>
	/// Compute a project-wide version — sha1 of the sorted (name → itemVersion)
	/// map. Add/remove an item → project version changes. Change any item's
	/// content → its version changes → project version changes. The "ref"
	/// the bridge advertises in /refs.
	/// </summary>
	public static string ComputeProjectVersion(IReadOnlyDictionary<string, string> itemVersions)
	{
		var sb = new StringBuilder();
		foreach (var kvp in itemVersions.OrderBy(p => p.Key, StringComparer.Ordinal))
		{
			sb.Append(kvp.Key).Append(':').Append(kvp.Value).Append('\n');
		}
		return ShortSha1(sb.ToString());
	}

	/// <summary>
	/// Compute a project STRUCTURE version — sha1 of just the sorted item
	/// names. Stable across content edits; only changes when items are
	/// added, renamed, or deleted. Used by the client to pick a stable
	/// workspace dir (`~/.volt/workspaces/&lt;structureVersion&gt;/`) that
	/// doesn't churn on every code edit.
	/// </summary>
	public static string ComputeStructureVersion(IReadOnlyDictionary<string, string> itemVersions)
	{
		var sb = new StringBuilder();
		foreach (var name in itemVersions.Keys.OrderBy(n => n, StringComparer.Ordinal))
		{
			sb.Append(name).Append('\n');
		}
		return ShortSha1(sb.ToString());
	}

	private static string ShortSha1(string content)
	{
		using var sha = SHA1.Create();
		byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(content));
		// 16 hex chars = 64 bits; ample for collision-free naming of POUs in any realistic project.
		return Convert.ToHexString(hash).Substring(0, 16).ToLowerInvariant();
	}

	/// <summary>
	/// Safely read <c>ItemType</c> — the canonical TwinCAT type code (601 =
	/// folder, 602 = program, 604 = FB, 608 = action, 609 = method, etc.;
	/// see BlockTypeMapper). Returns 0 if unavailable.
	///
	/// Always read <c>ItemType</c>, not <c>ItemSubType</c>. The latter
	/// returns 0 for NestedProject items (POUs / DUTs / GVLs / methods /
	/// properties / folders / actions) and only carries meaning in narrow
	/// CreateChild-return contexts.
	/// </summary>
	public static int GetItemType(dynamic item)
	{
		try { return (int)item.ItemType; }
		catch { return 0; }
	}

	/// <summary>Safely read DeclarationText from a COM tree item.</summary>
	public static string ReadDeclaration(dynamic item)
	{
		try { return NormalizeTurkishChars((string)item.DeclarationText ?? ""); }
		catch { return ""; }
	}

	/// <summary>Safely read ImplementationText from a COM tree item.</summary>
	public static string ReadImplementation(dynamic item)
	{
		try { return NormalizeTurkishChars((string)item.ImplementationText ?? ""); }
		catch { return ""; }
	}

	/// <summary>
	/// Replace Turkish locale characters with ASCII equivalents.
	/// TwinCAT's COM automation generates locale-dependent text on Turkish
	/// Windows: CreateChild auto-adds "PUBLİC" instead of "PUBLIC" to
	/// property accessor declarations. OrdinalIgnoreCase comparison doesn't
	/// match İ (U+0130) vs I (U+0049), so StripAccessorPublic fails to
	/// strip it. Normalizing at the read boundary fixes all downstream paths.
	/// </summary>
	internal static string NormalizeTurkishChars(string text)
	{
		if (string.IsNullOrEmpty(text)) return text;
		// İ (U+0130 Latin Capital Letter I With Dot Above) → I
		// ı (U+0131 Latin Small Letter Dotless I) → i
		return text.Replace('İ', 'I').Replace('ı', 'i');
	}

	// -------------------------------------------------------------------------
	// COM Activation (P/Invoke for .NET 8)
	// -------------------------------------------------------------------------

	/// <summary>
	/// .NET 8 replacement for Marshal.GetActiveObject (removed in .NET 5+).
	/// Retrieves a running COM object registered in the Running Object Table (ROT).
	/// Windows-only by construction (TwinCAT XAE runs on Windows) — the
	/// `net8.0-windows` TFM in the csproj scopes platform constraints
	/// project-wide.
	/// </summary>
	internal static object GetActiveObject(string progId)
	{
		var type = Type.GetTypeFromProgID(progId, throwOnError: true)!;
		Guid clsid = type.GUID;
		GetActiveObject(ref clsid, IntPtr.Zero, out object obj);
		return obj;
	}

	[DllImport("oleaut32.dll", PreserveSig = false)]
	private static extern void GetActiveObject(
		ref Guid rclsid,
		IntPtr pvReserved,
		[MarshalAs(UnmanagedType.IUnknown)] out object ppunk);
}
