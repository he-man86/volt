using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using BeckhoffBridge.Helpers;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// POST /push — Atomic batch of ITEM-LEVEL ops on the PLC project tree.
///
/// Wire shape v2 (2026-05-29) — ST-on-the-wire:
/// The agent sends raw workspace `.st` / `.gvl` / `.dut` / `.itf` file
/// content per item; the bridge runs <see cref="StSplitter"/> on it to
/// recover the POU + children structure, then drives existing
/// Create/Update/Delete/Rename handlers. The agent no longer parses
/// ST or emits per-child ops — that work moves here.
///
/// Op categories (4 total):
///   <c>pushItem</c>   — create-or-update one tree item. Carries full
///                       <c>sourceText</c>. `ifVersion`: null = create
///                       new; string = update existing (must match).
///   <c>deleteItem</c> — remove one tree item.
///   <c>renameItem</c> — rename one tree item.
///   <c>moveItem</c>   — change the folder of one tree item.
///
/// Two-pass: validate every op's ifVersion against the pre-batch
/// state (with forward simulation so an in-batch create + later op on
/// the same name validates cleanly), then apply in declared order on
/// success.
/// </summary>
internal sealed class PushHandler
{
	private readonly BeckhoffConnection _connection;
	private readonly CreateHandler _create;
	private readonly UpdateHandler _update;
	private readonly RenameHandler _rename;
	private readonly DeleteHandler _delete;

	public PushHandler(BeckhoffConnection connection)
	{
		_connection = connection;
		_create = new CreateHandler(connection);
		_update = new UpdateHandler(connection);
		_rename = new RenameHandler(connection);
		_delete = new DeleteHandler(connection);
	}

	public object Handle(JsonObject body)
	{
		if (!_connection.IsConnected) throw BridgeException.NotConnected();

		var ops = body["ops"] as JsonArray
			?? throw BridgeException.BadRequest("Missing 'ops' array");
		var expectedProjectVersion = body["expectedProjectVersion"]?.GetValue<string>();

		// ── Pre-flight: collect current per-item versions + item map ─────
		// We walk the project tree ONCE up front. The version map drives
		// pre-flight ifVersion checks; the item map lets ApplyPushItem do
		// O(1) lookups for existence + child enumeration instead of
		// re-walking the tree per pushItem op (which made big batches
		// scale O(K×N) — a real wall on projects with 100+ items).
		var currentVersions = new Dictionary<string, string>();
		var itemCache = new Dictionary<string, dynamic>(StringComparer.OrdinalIgnoreCase);
		BuildCurrentVersions(currentVersions, itemCache);
		var currentProjectVersion = BeckhoffConnection.ComputeProjectVersion(currentVersions);

		var conflicts = new List<Dictionary<string, object?>>();

		if (expectedProjectVersion != null && expectedProjectVersion != currentProjectVersion)
		{
			conflicts.Add(new Dictionary<string, object?>
			{
				["name"] = "<project>",
				["yourVersion"] = expectedProjectVersion,
				["currentVersion"] = currentProjectVersion,
				["reason"] = "project-level drift since you computed your batch",
			});
		}

		// Forward-state simulation: pending tracks each item's
		// existence as we walk ops in declared order, so a batch like
		// [deleteItem A, pushItem B] validates cleanly even when both
		// refer to the same project.
		var pending = currentVersions.ToDictionary(kv => kv.Key, kv => (string?)kv.Value);

		foreach (var opNode in ops)
		{
			if (opNode is not JsonObject op) continue;
			var opType = op["op"]?.GetValue<string>() ?? "";
			var name = op["name"]?.GetValue<string>();
			if (name == null) continue;
			var clientIfVersion = op.TryGetPropertyValue("ifVersion", out var ifvNode)
				&& ifvNode is JsonValue ifv && ifv.TryGetValue<string>(out var s) ? s : null;
			var currentVersion = pending.TryGetValue(name, out var v) ? v : null;

			switch (opType)
			{
				case "pushItem":
					if (clientIfVersion == null)
					{
						// Create-new semantics: item must NOT exist.
						if (currentVersion != null)
						{
							conflicts.Add(new Dictionary<string, object?>
							{
								["name"] = name,
								["yourVersion"] = null,
								["currentVersion"] = currentVersion,
								["reason"] = "expected to create new item but it already exists",
							});
						}
						else
						{
							pending[name] = ""; // placeholder; real hash recomputed post-apply
						}
					}
					else
					{
						// Update semantics: ifVersion must match.
						if (currentVersion != clientIfVersion)
						{
							conflicts.Add(new Dictionary<string, object?>
							{
								["name"] = name,
								["yourVersion"] = clientIfVersion,
								["currentVersion"] = currentVersion,
								["reason"] = currentVersion == null
									? $"expected item '{name}' to exist but it doesn't"
									: $"item '{name}' changed since you fetched its version",
							});
						}
						// Existence stays; version recomputed post-apply.
					}
					break;

				case "deleteItem":
				case "renameItem":
				case "moveItem":
					if (clientIfVersion != null && currentVersion != clientIfVersion)
					{
						conflicts.Add(new Dictionary<string, object?>
						{
							["name"] = name,
							["yourVersion"] = clientIfVersion,
							["currentVersion"] = currentVersion,
							["reason"] = currentVersion == null
								? $"expected item '{name}' to exist but it doesn't"
								: $"item '{name}' changed since you fetched its version",
						});
					}
					else
					{
						switch (opType)
						{
							case "deleteItem":
								pending.Remove(name);
								break;
							case "renameItem":
							{
								var newName = op["newName"]?.GetValue<string>();
								if (newName != null)
								{
									pending.Remove(name);
									pending[newName] = "";
								}
								break;
							}
							// moveItem keeps the same name + version
							// (snapshot/restore inside the bridge); no
							// pending change.
						}
					}
					break;

				default:
					throw BridgeException.BadRequest($"Unknown op type: {opType}");
			}
		}

		if (conflicts.Count > 0)
		{
			return new Dictionary<string, object?>
			{
				["accepted"] = false,
				["conflicts"] = conflicts,
				["currentProjectVersion"] = currentProjectVersion,
			};
		}

		// ── Apply ─────────────────────────────────────────────────────────
		foreach (var opNode in ops)
		{
			if (opNode is not JsonObject op) continue;
			var opType = op["op"]?.GetValue<string>() ?? "";
			switch (opType)
			{
				case "pushItem":   ApplyPushItem(op, itemCache);   break;
				case "deleteItem": ApplyDeleteItem(op); break;
				case "renameItem": ApplyRenameItem(op); break;
				case "moveItem":   ApplyMoveItem(op);   break;
				default: throw BridgeException.BadRequest($"Unknown op type: {opType}");
			}
		}

		// ── Recompute refs and report ────────────────────────────────────
		// (Second walk is unavoidable — items added/removed by the ops
		// above need fresh enumeration. Item cache is discarded.)
		var newVersions = new Dictionary<string, string>();
		BuildCurrentVersions(newVersions);
		return new Dictionary<string, object?>
		{
			["accepted"] = true,
			["newProjectVersion"] = BeckhoffConnection.ComputeProjectVersion(newVersions),
			["newItems"] = newVersions,
		};
	}

	// ─── Op applicators ───────────────────────────────────────────────

	/// <summary>
	/// Apply a pushItem op — create the item if it doesn't exist, or
	/// update it (with embedded child-diff) if it does. Uses the cached
	/// itemMap from the pre-flight walk to avoid an O(N) tree re-walk
	/// per op.
	/// </summary>
	private void ApplyPushItem(JsonObject op, Dictionary<string, dynamic> itemCache)
	{
		var name = op["name"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("pushItem missing 'name'");
		var sourceText = op["sourceText"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("pushItem missing 'sourceText'");
		var folder = op["folder"]?.GetValue<string>();

		// Graphical body push: optional. Present for FBD/LD/SFC/CFC
		// POUs; agent extracts via extractGraphicalBody() before send.
		var implementationXml = op["implementationXml"]?.GetValue<string>();

		// SplitSt recovers POU + children from the raw .st text.
		var split = StSplitter.SplitSt(sourceText);

		// CreateHandler / UpdateHandler accept the same body shape:
		// { name, declaration, implementation?, folder?, children?: [...] }
		var existing = itemCache.TryGetValue(name, out var cached) ? cached : null;

		if (existing == null)
		{
			// Graphical-POU creation isn't supported yet — TC's
			// create_pou path doesn't know how to set body language
			// via the COM surface. Reject explicitly so the caller
			// sees the gap.
			if (!string.IsNullOrEmpty(implementationXml))
			{
				throw new BridgeException(400, "GRAPHICAL_CREATE_UNSUPPORTED",
					$"creating new graphical POU '{name}' from PLCopenXML not supported yet — " +
					"create it in TC first, then re-pull and edit");
			}
			// Create: all children are net-new.
			var body = BuildCreateBody(name, folder, split);
			_create.Handle(body);
		}
		else
		{
			// Update: diff embedded children against TC's current state.
			var existingChildren = EnumerateChildNames(existing);
			var body = BuildUpdateBody(name, folder, split, existingChildren);
			_update.Handle(body);
			// Apply graphical body AFTER decl/impl write — the PLCopenXML
			// import treats the existing POU as the target by name match;
			// the textual declaration we just wrote becomes the interface
			// (CODESYS-compatible behavior, verified live).
			if (!string.IsNullOrEmpty(implementationXml))
			{
				var importError = _connection.ImportItemBodyAsXml(existing, name, implementationXml);
				if (importError != null)
				{
					throw new BridgeException(500, "GRAPHICAL_IMPORT_FAILED",
						$"PlcOpenImport on '{name}' failed: {importError}");
				}
			}
		}
	}

	private void ApplyDeleteItem(JsonObject op)
	{
		var body = new JsonObject { ["name"] = op["name"]?.DeepClone() };
		_delete.Handle(body);
	}

	private void ApplyRenameItem(JsonObject op)
	{
		var body = new JsonObject
		{
			["name"] = op["name"]?.DeepClone(),
			["newName"] = op["newName"]?.DeepClone(),
		};
		_rename.Handle(body);
	}

	private void ApplyMoveItem(JsonObject op)
	{
		// TwinCAT COM doesn't expose a clean cross-folder MoveItem
		// primitive on the surface we use. Implement moveItem as a
		// controlled delete-then-recreate-at-new-folder, capturing the
		// full item state (declaration + implementation + children +
		// accessors) up front so nothing's lost across the dance.
		var name = op["name"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("moveItem missing 'name'");
		var newFolder = op["newFolder"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("moveItem missing 'newFolder'");

		var item = _connection.LookupItemByName(name)
			?? throw new BridgeException(404, "NOT_FOUND",
				$"moveItem: item '{name}' not found");

		// Capture snapshot via the same builder /fetch uses.
		var snapshot = GetHandler.BuildResult(_connection, name, item);
		var snapshotNode = JsonNode.Parse(JsonSerializer.Serialize(snapshot))
			?? throw new BridgeException(500, "INTERNAL_ERROR",
				$"moveItem: failed to serialize snapshot for '{name}'");
		var createBody = snapshotNode.AsObject();
		createBody["folder"] = newFolder;

		_delete.Handle(new JsonObject { ["name"] = name });
		_create.Handle(createBody);
	}

	// ─── Body builders ────────────────────────────────────────────────

	/// <summary>
	/// Build the body shape for CreateHandler.Handle from a SplitSt
	/// result. All children are emitted as net-new creates.
	/// </summary>
	private static JsonObject BuildCreateBody(string name, string? folder, StSplitter.StSplitResult split)
	{
		var body = new JsonObject
		{
			["name"] = name,
			["declaration"] = split.PouDeclaration,
		};
		if (!string.IsNullOrEmpty(split.PouImplementation))
			body["implementation"] = split.PouImplementation;
		if (folder != null) body["folder"] = folder;
		if (split.Children.Count > 0)
		{
			var childrenArr = new JsonArray();
			foreach (var child in split.Children)
				childrenArr.Add(ChildToJson(child, op: "create"));
			body["children"] = childrenArr;
		}
		return body;
	}

	/// <summary>
	/// Build the body shape for UpdateHandler.Handle from a SplitSt
	/// result, with child diff against the existing TC item's current
	/// children. Adds: children present in source but not TC. Updates:
	/// children present in both. Deletes: children present in TC but
	/// not in source.
	/// </summary>
	private static JsonObject BuildUpdateBody(string name, string? folder, StSplitter.StSplitResult split, HashSet<string> existingChildren)
	{
		var body = new JsonObject
		{
			["name"] = name,
			["declaration"] = split.PouDeclaration,
			["implementation"] = split.PouImplementation,
		};
		if (folder != null) body["folder"] = folder;

		var newNames = new HashSet<string>(split.Children.Select(c => c.Name), StringComparer.OrdinalIgnoreCase);
		var childrenArr = new JsonArray();
		// Adds + updates
		foreach (var child in split.Children)
		{
			var op = existingChildren.Contains(child.Name) ? "update" : "create";
			childrenArr.Add(ChildToJson(child, op));
		}
		// Deletes
		foreach (var existing in existingChildren)
		{
			if (newNames.Contains(existing)) continue;
			childrenArr.Add(new JsonObject
			{
				["op"] = "delete",
				["name"] = existing,
			});
		}
		if (childrenArr.Count > 0) body["children"] = childrenArr;
		return body;
	}

	/// <summary>
	/// Convert a SplitSt StChild record into the JSON shape that
	/// Create/Update handlers consume.
	/// </summary>
	private static JsonObject ChildToJson(StSplitter.StChild child, string op)
	{
		var obj = new JsonObject
		{
			["op"] = op,
			["name"] = child.Name,
			["kind"] = child.Kind,
			["declaration"] = child.Declaration,
		};
		if (child.Implementation.Length > 0)
			obj["implementation"] = child.Implementation;
		if (child.Folder != null) obj["folder"] = child.Folder;
		// Properties: encode accessor decl + impl in the field names
		// UpdateHandler.ProcessChildren / EnsureAccessors already speak.
		if (child.Kind == "property")
		{
			if (child.Getter != null)
			{
				obj["getterCode"] = child.Getter.Implementation;
				if (!string.IsNullOrEmpty(child.Getter.Declaration))
					obj["getterDeclaration"] = child.Getter.Declaration;
			}
			if (child.Setter != null)
			{
				obj["setterCode"] = child.Setter.Implementation;
				if (!string.IsNullOrEmpty(child.Setter.Declaration))
					obj["setterDeclaration"] = child.Setter.Declaration;
			}
		}
		return obj;
	}

	/// <summary>Enumerate names of an item's direct children (methods/actions/properties).</summary>
	private static HashSet<string> EnumerateChildNames(dynamic parentItem)
	{
		var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
		try
		{
			int count = (int)parentItem.ChildCount;
			for (int i = 1; i <= count; i++)
			{
				try
				{
					dynamic child = parentItem.Child[i];
					string childName = (string)child.Name;
					names.Add(childName);
				}
				catch { /* skip degenerate child */ }
			}
		}
		catch { /* no children or COM hiccup; treat as empty */ }
		return names;
	}

	// ─── Helpers (item-version walk) ──────────────────────────────────

	private void BuildCurrentVersions(Dictionary<string, string> versions)
	{
		var root = _connection.GetPlcProjectRoot();
		CollectVersions(root, versions, null);
	}

	private void BuildCurrentVersions(Dictionary<string, string> versions, Dictionary<string, dynamic> items)
	{
		var root = _connection.GetPlcProjectRoot();
		CollectVersions(root, versions, items);
	}

	private void CollectVersions(dynamic node, Dictionary<string, string> versions, Dictionary<string, dynamic>? items)
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

			int itemType = BeckhoffConnection.GetItemType(child);

			if (itemType == BlockTypeMapper.FolderSubType)
			{
				CollectVersions(child, versions, items);
				continue;
			}

			if (!BlockTypeMapper.IsTopLevelCrud(itemType)) continue;

			try { versions[name] = BeckhoffConnection.ComputeItemVersion(child); }
			catch { /* skip */ }

			// Populate the item cache so ApplyPushItem can avoid a
			// fresh LookupItemByName walk per pushItem op. The cached
			// item supports ChildCount/Child[i] (used by
			// EnumerateChildNames). Write operations go through
			// _create.Handle / _update.Handle which do their own
			// write-capable lookups, so we don't need the LookupTreeItem
			// path here.
			if (items != null)
			{
				try { items[name] = child; } catch { /* skip */ }
			}
		}
	}
}
