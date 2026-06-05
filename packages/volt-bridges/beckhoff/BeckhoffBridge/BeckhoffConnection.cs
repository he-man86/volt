using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using BeckhoffBridge.Helpers;
using BeckhoffBridge.Helpers.Extractors;

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
///
/// Structural contracts: <c>WalkProjectTree</c> below is the single walker
/// used by refs/fetch/push handlers — see <c>packages/volt-bridges/INVARIANTS.md</c>
/// for the rules (single walker, post-push fetch invariant, itemCache through apply).
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
	/// <summary>
	/// Per-item version hash. Foundation principle:
	/// <c>version = SHA1(everything the materializer needs)</c> —
	/// content (decl + impl + child digests + body XML) AND
	/// location (<paramref name="folderPath"/>). When the engineer
	/// MOVES a POU in TwinCAT the content stays identical but the
	/// folder changes; including folder in the hash gives the agent
	/// the version bump it needs to detect the move via /refs and
	/// re-materialize at the new path. No /move verb, no parallel
	/// folder map on /refs.
	///
	/// <para>Callers MUST pass the folder path they already track
	/// (from <see cref="TreeItemVisit.FolderPath"/> on the walker
	/// paths, or computed via <see cref="FindRelativePath"/> for
	/// per-item code paths). Don't fall back to empty — that
	/// re-introduces the bug.</para>
	/// </summary>
	public static string ComputeItemVersion(dynamic item, string folderPath)
	{
		string topName = "?";
		try { topName = (string)item.Name; } catch { }
		Log.Ide($"[hash] start: {topName} @ {folderPath}");
		try
		{
			var sb = new StringBuilder();
			// Folder FIRST so a move bumps the hash even when no
			// other content changed. Prefix tag keeps the input
			// unambiguous if a folder path happens to look like
			// declaration text.
			sb.Append("folder=").Append(folderPath ?? "").Append('\0');
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
	/// <summary>
	/// Force TC to commit any in-memory document changes back into the
	/// project tree, normalizing source text as it does so. Required
	/// before any operation that READS the post-write state and reports
	/// a hash from it — without this, TC keeps the buffer in-memory until
	/// some later trigger (usually a build's own SaveAll), and a hash
	/// computed against the buffer differs from the hash computed against
	/// the eventually-saved form, surfacing as phantom drift on the next
	/// push.
	///
	/// Used by:
	///   - PushHandler: after `Apply`, before recomputing newProjectVersion.
	///     Without this the post-apply walk sees pre-normalization source;
	///     the next /fetch (which runs after some build normalizes things)
	///     sees a DIFFERENT hash and the client thinks the project drifted.
	///   - BuildHandler: before invoking the compiler. Ensures the compile
	///     reads our intended source, not stale on-disk content.
	/// </summary>
	public void FlushPendingWrites()
	{
		if (_dte == null) return;
		try { _dte.Documents.SaveAll(); }
		catch (Exception ex) { Log.Warn($"[Connection] Documents.SaveAll failed: {ex.Message}"); }
	}

	/// <summary>
	/// Single source of truth for "walk the PLC project tree, yield each
	/// significant item, recurse into folders and hybrid containers."
	///
	/// Used by RefsHandler / FetchHandler / PushHandler — all three need
	/// to enumerate the exact same item set to compute coherent project
	/// versions. Before this lived in one place, each handler had its
	/// own walker, and the three diverged on hybrid-container recursion
	/// + filter logic, producing different `projectVersion` hashes for
	/// the same project — every push after a pull rejected with phantom
	/// drift.
	///
	/// Semantics applied to each tree node:
	///   - Folder           → recurse with folder path appended
	///   - Inlined-in-POU   → skip (methods/actions/properties ride in
	///                        their parent POU's sourceText)
	///   - Top-level CRUD   → visitor called with isTopLevelCrud=true
	///                        (POU / GVL / DUT / Interface)
	///   - Other items      → visitor called with isTopLevelCrud=false
	///                        (visualizations, tasks, libraries, etc.)
	///   - Hybrid container → visitor called for the container ITSELF,
	///                        then we recurse so its children are
	///                        ALSO visited. The "References" node is
	///                        the canonical example: it carries a
	///                        library_manager identity AND contains
	///                        individual library refs as children;
	///                        both the container and the libraries
	///                        end up in the version map.
	/// </summary>
	public void WalkProjectTree(Action<TreeItemVisit> visitor)
	{
		WalkInner(GetPlcProjectRoot(), "", visitor);
	}

	/// <summary>
	/// Walk the TwinCAT I/O Devices subtree (<c>TIID</c>) and yield one
	/// visit per direct child device (EtherCAT master, EAP master,
	/// USB camera, etc.). Sub-elements of each device (slave boxes,
	/// channels, terminals) are NOT emitted as separate items — the
	/// <see cref="Extractors.DeviceExtractor"/> enumerates them inline
	/// within the parent device's manifest. This matches the
	/// "structural presence at device level, content detail inside" cut.
	///
	/// I/O devices live in a parallel COM tree (system tree, not PLC
	/// tree) — they're addressed by ITcSysManager.LookupTreeItem(\"TIID\")
	/// and their child-walking uses the same ITcSmTreeItem.Child[i]
	/// surface as PLC items, so the visit shape is identical.
	///
	/// Returns silently when TIID isn't present (some TwinCAT installs
	/// lack the I/O license, or the project doesn't yet have any I/O
	/// config). Logs a warning loud enough to surface in bridge.log
	/// when individual device probing fails.
	/// </summary>
	public void WalkIoDevices(Action<TreeItemVisit> visitor)
	{
		if (_sysManager == null) return;
		dynamic tiid;
		try { tiid = _sysManager.LookupTreeItem("TIID"); }
		catch
		{
			// No I/O devices subtree on this install — skip silently.
			return;
		}

		int count;
		try { count = (int)tiid.ChildCount; }
		catch (Exception ex)
		{
			Log.Warn($"[Connection] WalkIoDevices: ChildCount on TIID failed: {ex.Message}");
			return;
		}

		for (int i = 1; i <= count; i++)
		{
			dynamic device;
			try { device = tiid.Child[i]; }
			catch (Exception ex)
			{
				Log.Warn($"[Connection] WalkIoDevices: TIID.Child[{i}] failed: {ex.Message}");
				continue;
			}
			string name;
			try { name = (string)device.Name; }
			catch (Exception ex)
			{
				Log.Warn($"[Connection] WalkIoDevices: child[{i}].Name read failed: {ex.Message}");
				continue;
			}
			int itemType = GetItemType(device);
			visitor(new TreeItemVisit
			{
				Name = name,
				Item = device,
				ItemType = itemType,
				IsTopLevelCrud = false,
				// All devices land under a fixed "I/O Devices" folder so
				// they don't collide with PLC-tree items if names happen
				// to overlap (rare but possible — e.g. "Tasks" exists in
				// both subtrees).
				FolderPath = "I/O Devices",
			});
		}
	}

	private static void WalkInner(dynamic node, string folderPath, Action<TreeItemVisit> visitor)
	{
		int count;
		try { count = (int)node.ChildCount; }
		catch { return; }

		for (int i = 1; i <= count; i++)
		{
			dynamic child;
			try { child = node.Child[i]; }
			catch { continue; }

			string name;
			try { name = (string)child.Name; }
			catch { continue; }

			int itemType = GetItemType(child);

			if (itemType == BlockTypeMapper.FolderSubType)
			{
				// Recurse with the folder appended. Folder names compose with
				// `/` so the on-disk layout matches the IDE's tree exactly
				// (e.g. POUs/Motors/FB_Stepper.st).
				var nested = string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}";
				WalkInner(child, nested, visitor);
				continue;
			}

			if (BlockTypeMapper.IsInlinedInPou(itemType))
			{
				// Methods/actions/properties/transitions ride inline via
				// StAssembler — they appear in the parent POU's sourceText,
				// not as standalone items.
				continue;
			}

			int childCount = 0;
			try { childCount = (int)child.ChildCount; } catch { }
			bool isTopLevelCrud = BlockTypeMapper.IsTopLevelCrud(itemType);
			bool isHybrid = childCount > 0 && !isTopLevelCrud;
			string emitFolder = isHybrid
				? (string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}")
				: folderPath;

			visitor(new TreeItemVisit
			{
				Name = name,
				Item = child,
				ItemType = itemType,
				IsTopLevelCrud = isTopLevelCrud,
				FolderPath = emitFolder,
			});

			// Hybrid containers (non-CRUD with children — RecipeManager +
			// Recipes, References + libraries, etc.) have their own item
			// identity AND children. We've already emitted the container;
			// now recurse into its children so they're emitted too. Visited
			// folder is the container's own folder so children land
			// alongside the parent's file (component-folder convention).
			if (isHybrid)
			{
				WalkInner(child, emitFolder, visitor);
			}
		}
	}

	/// <summary>
	/// One visit yielded by <see cref="WalkProjectTree"/>. Callers
	/// project this into their own per-handler shape (RefsHandler maps
	/// to versions/kinds; FetchHandler additionally builds sourceText;
	/// PushHandler caches the item for later op application).
	/// </summary>
	internal struct TreeItemVisit
	{
		public string Name;
		public dynamic Item;
		public int ItemType;
		public bool IsTopLevelCrud;
		/// <summary>Folder path WITH the hybrid container's own name
		/// appended (when applicable) — matches the component-folder
		/// convention used in /fetch's emitFolder.</summary>
		public string FolderPath;
	}

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
	/// Export a graphical POU's `&lt;body&gt;` PLCopenXML for the wire's
	/// `implementationXml` field. Returns null on failure / non-graphical
	/// items / older TC versions that don't expose the IEC project
	/// interface — caller falls through to placeholder text.
	///
	/// Implementation: TwinCAT's `ITcPlcIECProject.PlcOpenExport` writes
	/// the entire project as PLCopenXML to a file (no string overload,
	/// no item-scoped variant — see infosys 242870539). We pass the
	/// item's dotted path as the selection filter, write to a temp file,
	/// parse, and pull out just the `&lt;body&gt;` element so the wire
	/// shape matches what the CODESYS bridge sends.
	///
	/// Must run on STA thread (use RunOnStaThread when calling from
	/// the HTTP threadpool).
	/// </summary>
	/// <summary>
	/// Universal serializer for non-CRUD tree items (tasks, visualizations,
	/// library managers, image pools, recipe managers, text lists, etc.).
	/// Calls `ITcSmTreeItem.ProduceXml()` which works on every tree-item
	/// subclass — verified empirically via /debug against TC3 sample project:
	/// returns 374-8014 byte distinct XML payloads per kind, all wrapped in
	/// `&lt;TreeItem&gt;...&lt;/TreeItem&gt;`. Unlike `PlcOpenExport` (which
	/// only handles POU-shaped IEC items), `ProduceXml` is the TwinCAT
	/// Automation Interface's generic round-trippable serialization and
	/// covers everything in the PLC tree.
	///
	/// Returns empty string on failure (logged). Caller treats result as
	/// "opaque XML blob, write verbatim" — same opaque-passthrough policy
	/// the CODESYS bridge uses for its config items.
	/// </summary>
	/// <summary>
	/// Render a non-CRUD config item as its (sourceText, version) pair
	/// using the per-kind typed extractor. Returns <c>null</c> when no
	/// extractor is registered for the kind — caller should SKIP the
	/// item with a warning rather than fall back to opaque XML (per the
	/// <c>no-fallbacks</c> rule). The closed kind set is owned by
	/// <see cref="Extractors.ExtractorRegistry"/>; an unregistered kind
	/// means either (a) the bridge emitted a new kind without
	/// registering an extractor, or (b) BlockTypeMapper hit its
	/// catch-all "config" branch — both real bugs to fix at the
	/// SOURCE, not paper over here.
	///
	/// Used by RefsHandler (needs the version only) and FetchHandler
	/// (needs both fields). RefsHandler discards <c>sourceText</c>;
	/// extracting it twice would be wasteful but extracting it ONCE
	/// keeps the hash trivially consistent across the two handlers.
	/// </summary>
	/// <summary>
	/// Build the deterministic text manifest + per-item version for a
	/// non-CRUD config item (task / library / device / visualization /
	/// recipe / textlist / image-pool / TMC / class-diagram / etc.).
	///
	/// <para>Version = SHA1("folder=" + <paramref name="folderPath"/>
	/// + "\0" + manifest). Folder participates so a MOVE in TwinCAT
	/// (e.g. dragging a task into a different Task Configuration
	/// folder) produces a version bump the agent detects on /refs —
	/// same foundation principle as
	/// <see cref="ComputeItemVersion(dynamic, string)"/> for source
	/// items.</para>
	/// </summary>
	/// <summary>
	/// Result of <see cref="BuildConfigManifest"/>. A real record (not a
	/// ValueTuple) because callers pass <c>dynamic</c> arguments — that
	/// makes the call site late-bound and the return type degrades to
	/// <c>dynamic</c>. Named tuple members like <c>.Version</c> are only
	/// compile-time metadata; the DLR sees through to <c>Item1</c> /
	/// <c>Item2</c> and named accessors fail. A record exposes real
	/// properties that work over dynamic dispatch.
	/// </summary>
	public sealed record ConfigManifest(string SourceText, string Version);

	public ConfigManifest? BuildConfigManifest(dynamic item, string configKind, string itemName, string folderPath)
	{
		var extractor = ExtractorRegistry.Get(configKind);
		if (extractor is null)
		{
			Log.Warn($"[Connection] BuildConfigManifest({itemName}): no extractor for kind '{configKind}' — skipping (register one in ExtractorRegistry.cs).");
			return null;
		}
		string sourceText;
		try
		{
			sourceText = extractor.Extract(item);
		}
		catch (Exception ex)
		{
			// Per-item containment: one bad item must not kill the whole
			// walk. We log LOUDLY with the kind + item name + stack trace
			// origin so bridge.log captures exactly which item failed and
			// why — this is the "structured logging" version of error
			// handling, not a silent swallow. The agent will see the
			// item as `removed` next round, which is the correct
			// user-visible signal for "bridge can't currently render
			// this item".
			Log.Warn($"[Connection] BuildConfigManifest({itemName}) extractor for '{configKind}' threw: {ex.GetType().Name}: {ex.Message}");
			return null;
		}
		// SHA1 of "folder=<path>\0<manifest>" — content + location.
		// Moving a config item bumps the hash even when the manifest
		// text didn't change.
		string version = ShortSha1("folder=" + (folderPath ?? "") + "\0" + sourceText);
		return new ConfigManifest(sourceText, version);
	}

	public string? ExportItemBodyAsXml(dynamic item, string itemName)
	{
		// `PlcOpenExport` lives on ITcPlcIECProject, which is the
		// interface for the NestedProject (the source-code container
		// inside the PLC project), NOT the outer PLC project node.
		// `_plcNode.PlcOpenExport(...)` throws "no definition for
		// PlcOpenExport" — `_nestedProject.PlcOpenExport(...)` works.
		if (_nestedProject == null)
		{
			Log.Warn($"[Connection] ExportItemBodyAsXml({itemName}): no NestedProject cached");
			return null;
		}

		// Build the dotted selection string. TwinCAT uses ^ in tree
		// paths (e.g. "TIPC^Untitled1^POUs^FB_X") but PlcOpenExport
		// expects . (e.g. "POUs.FB_X" — folder-qualified, no project
		// name). Easiest robust mapping: walk parents until we hit
		// the NestedProject node, collecting names.
		string? selection = BuildPlcOpenSelectionPath(item);
		if (selection == null)
		{
			Log.Warn($"[Connection] ExportItemBodyAsXml({itemName}): couldn't derive selection path");
			return null;
		}

		string tempFile = System.IO.Path.Combine(
			System.IO.Path.GetTempPath(),
			$"volt-tc-export-{Guid.NewGuid():N}.xml");
		try
		{
			dynamic iecProject = _nestedProject;
			iecProject.PlcOpenExport(tempFile, selection);

			if (!System.IO.File.Exists(tempFile))
			{
				Log.Warn($"[Connection] ExportItemBodyAsXml({itemName}): PlcOpenExport produced no file");
				return null;
			}
			string xml = System.IO.File.ReadAllText(tempFile);
			return ExtractBodyElement(xml, itemName);
		}
		catch (Exception ex)
		{
			Log.Warn($"[Connection] ExportItemBodyAsXml({itemName}) failed: {ex.GetType().Name}: {ex.Message}");
			return null;
		}
		finally
		{
			try { if (System.IO.File.Exists(tempFile)) System.IO.File.Delete(tempFile); }
			catch { /* best-effort cleanup */ }
		}
	}

	/// <summary>
	/// Walk parents from `item` up to the NestedProject root,
	/// collecting names, and return them joined with `.` for
	/// PlcOpenExport's selection string. Returns null when the walk
	/// can't reach the project root (item from a different project,
	/// orphaned reference, etc.).
	/// </summary>
	private string? BuildPlcOpenSelectionPath(dynamic item)
	{
		// PlcOpenExport expects a dotted path RELATIVE to the IEC
		// project root (the "{plcProjectName} Project" node), not
		// relative to the PLC project or TIPC. So we walk parents
		// upward, collecting names, until we hit either:
		//   * the "{plcProjectName} Project" anchor (stop, don't include)
		//   * the bare plcProjectName node (also stop — same logical
		//     anchor, depends on TC version)
		//   * loss of parent (give up — orphaned item)
		string projectAnchor = $"{_plcProjectName} Project";
		try
		{
			var segments = new List<string>();
			dynamic cursor = item;
			// Sanity bound — even deeply-nested folders don't reach 50.
			for (int i = 0; i < 50; i++)
			{
				string name = (string)cursor.Name;
				if (string.Equals(name, projectAnchor, StringComparison.OrdinalIgnoreCase)
				    || string.Equals(name, _plcProjectName, StringComparison.OrdinalIgnoreCase))
				{
					segments.Reverse();
					return string.Join(".", segments);
				}
				segments.Add(name);
				dynamic? parent = null;
				try { parent = cursor.Parent; } catch { parent = null; }
				if (parent == null) break;
				cursor = parent;
			}
		}
		catch (Exception ex)
		{
			Log.Warn($"[Connection] BuildPlcOpenSelectionPath aborted: {ex.Message}");
		}
		return null;
	}

	/// <summary>
	/// TwinCAT's `ITcPlcIECProject.PlcOpenImport` conflict-resolution
	/// argument. The 1-arg form rejects on name collision with
	/// "Import conflict!" — we always pass an explicit value to force
	/// the replace-existing behavior we want for update-style pushes.
	///
	/// Values per infosys 242870539:
	///   0 = ask user (interactive — bridge runs headless, so unusable)
	///   1 = replace existing             ← what we want
	///   2 = skip on conflict             ← no-ops our update
	///   3 = copy with new name           ← creates duplicate
	/// </summary>
	private const int PLCOPEN_CONFLICT_REPLACE = 1;

	/// <summary>
	/// Inverse of `ExportItemBodyAsXml` — apply a `&lt;body&gt;` PLCopenXML
	/// element back into TC. Uses the export-as-template pattern:
	/// export the item to get a schema-valid wrapper, splice the new
	/// body in, re-import via `PlcOpenImport(file, REPLACE)`. Returns
	/// null on success, or a human-readable error string for the push
	/// response.
	///
	/// Update-only — the caller has confirmed the POU already exists.
	///
	/// Must run on STA thread (RunOnStaThread from HTTP context).
	/// </summary>
	public string? ImportItemBodyAsXml(dynamic item, string itemName, string bodyXml)
	{
		if (_nestedProject == null) return "no NestedProject cached";

		// **Export-as-template pattern** (parallel to CODESYS's
		// `plcopen_xml.replace_body_in_pou`):
		//   1. Export the item via PlcOpenExport → guaranteed
		//      schema-valid template carrying fileHeader, contentHeader,
		//      coordinateInfo, and TC-specific addData blocks.
		//   2. Parse, replace <body> with the incoming body XML.
		//   3. Import the modified document via PlcOpenImport.
		// Hand-crafted documents fail validation: TC rejects missing
		// fileHeader / contentHeader / coordinateInfo / etc.
		string? selection = BuildPlcOpenSelectionPath(item);
		if (selection == null) return "couldn't derive selection path";

		string templateFile = System.IO.Path.Combine(
			System.IO.Path.GetTempPath(), $"volt-tc-template-{Guid.NewGuid():N}.xml");
		string importFile = System.IO.Path.Combine(
			System.IO.Path.GetTempPath(), $"volt-tc-import-{Guid.NewGuid():N}.xml");
		try
		{
			dynamic iecProject = _nestedProject;
			iecProject.PlcOpenExport(templateFile, selection);
			if (!System.IO.File.Exists(templateFile)) return "PlcOpenExport produced no template";

			string templateXml = System.IO.File.ReadAllText(templateFile);
			string? modifiedXml = PlcOpenXml.ReplaceBodyInPou(templateXml, itemName, bodyXml);
			if (modifiedXml == null) return "couldn't locate <body> in template";

			System.IO.File.WriteAllText(importFile, modifiedXml, new System.Text.UTF8Encoding(false));
			iecProject.PlcOpenImport(importFile, PLCOPEN_CONFLICT_REPLACE);
			return null;
		}
		catch (Exception ex)
		{
			Log.Warn($"[Connection] ImportItemBodyAsXml({itemName}) failed: {ex.GetType().Name}: {ex.Message}");
			return $"{ex.GetType().Name}: {ex.Message}";
		}
		finally
		{
			try { if (System.IO.File.Exists(templateFile)) System.IO.File.Delete(templateFile); } catch { }
			try { if (System.IO.File.Exists(importFile)) System.IO.File.Delete(importFile); } catch { }
		}
	}

	/// <summary>
	/// Pull the `&lt;body&gt;` element out of a PLCopenXML document for
	/// the named POU. The document shape is
	/// `&lt;project&gt;&lt;types&gt;&lt;pous&gt;&lt;pou name="X"&gt;&lt;interface/&gt;&lt;body&gt;...&lt;/body&gt;&lt;/pou&gt;...`
	/// Returns null if the POU or its body isn't present (e.g. a
	/// declaration-only item like a GVL).
	/// </summary>
	private static string? ExtractBodyElement(string xml, string itemName)
	{
		try
		{
			var doc = System.Xml.Linq.XDocument.Parse(xml);
			System.Xml.Linq.XNamespace ns = "http://www.plcopen.org/xml/tc6_0200";
			var pou = doc.Descendants(ns + "pou")
				.FirstOrDefault(p => string.Equals(
					(string?)p.Attribute("name") ?? "", itemName, StringComparison.OrdinalIgnoreCase));
			var body = pou?.Element(ns + "body");
			return body?.ToString();
		}
		catch (Exception ex)
		{
			Log.Warn($"[Connection] ExtractBodyElement({itemName}) parse failed: {ex.Message}");
			return null;
		}
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
