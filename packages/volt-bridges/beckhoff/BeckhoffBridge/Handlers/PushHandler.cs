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

		// Flush BEFORE pre-flight. Two reasons:
		//   1. The version hashes /refs returned to the client (which
		//      now also flushes) and the hashes we're about to compute
		//      must agree. Without a flush here, an editor buffer
		//      mutation between /refs and /push would yield a different
		//      hash for the same nominally-unchanged item.
		//   2. The post-apply flush at the end of this handler keeps
		//      newItems consistent with the client's next /refs. Both
		//      "ends" of the push window must straddle a SaveAll.
		_connection.FlushPendingWrites();

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
		// Every apply method takes the same itemCache so per-op tree
		// walks become O(1) cache hits — mirrors the CODESYS bridge's
		// `_apply_*(connection, op, item_cache)` pattern. For a 50-item
		// delete batch in a 1000-item project, this drops apply cost
		// from 50 × O(N) COM walks to 50 × O(1) cache lookups. Both
		// bridges now use the same shape: cache-first, scan-fallback.
		foreach (var opNode in ops)
		{
			if (opNode is not JsonObject op) continue;
			var opType = op["op"]?.GetValue<string>() ?? "";
			switch (opType)
			{
				case "pushItem":   ApplyPushItem(op, itemCache);   break;
				case "deleteItem": ApplyDeleteItem(op, itemCache); break;
				case "renameItem": ApplyRenameItem(op, itemCache); break;
				case "moveItem":   ApplyMoveItem(op, itemCache);   break;
				default: throw BridgeException.BadRequest($"Unknown op type: {opType}");
			}
		}

		// Flush TC's open-document buffers BEFORE recomputing refs.
		// TC keeps the result of our writes in-memory until something
		// (usually a build's own SaveAll) persists them, at which point
		// it may normalize source text (re-indent, fold attributes into
		// canonical form, etc.). Without this flush, our post-apply walk
		// hashes the pre-normalization buffer, while the NEXT /fetch
		// hashes the eventually-saved form. The two hashes diverge and
		// the client's next push rejects with phantom drift.
		_connection.FlushPendingWrites();

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
		// ResolveItem is cache-first / name-lookup-fallback — same shape
		// as the other apply methods.
		var existing = ResolveItem(name, itemCache);

		if (existing == null)
		{
			// Create path — fan out by ST vs graphical (FBD/LD/SFC/CFC).
			// Graphical body present → detect the language tag from the
			// XML so CreateChild gets the right `vInfo` and TC opens the
			// POU in the correct editor; then splice the body via the
			// same export-template pattern the update path uses.
			if (!string.IsNullOrEmpty(implementationXml))
			{
				var bodyLanguage = PlcOpenXml.DetectBodyLanguage(implementationXml);
				if (bodyLanguage == null)
				{
					throw new BridgeException(400, "GRAPHICAL_BODY_UNRECOGNIZED",
						$"creating graphical POU '{name}' but body XML's root child is not " +
						"a recognized language tag (<FBD>/<LD>/<SFC>/<CFC>)");
				}
				var body = BuildCreateBody(name, folder, split);
				body["bodyLanguage"] = bodyLanguage;
				_create.Handle(body);
				// Re-resolve the freshly-created item and splice the body.
				var created = _connection.LookupItemByName(name)
					?? throw new BridgeException(500, "INTERNAL_ERROR",
						$"created '{name}' but couldn't re-resolve for body import");
				var importError = _connection.ImportItemBodyAsXml(created, name, implementationXml);
				if (importError != null)
				{
					throw new BridgeException(500, "GRAPHICAL_IMPORT_FAILED",
						$"PlcOpenImport on freshly-created '{name}' failed: {importError}");
				}
				return;
			}
			// Plain ST create: all children are net-new.
			var stBody = BuildCreateBody(name, folder, split);
			_create.Handle(stBody);
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

	/// <summary>
	/// Resolve an item by name using the pre-flight cache; fall through
	/// to a fresh tree walk only on cache miss. Mirrors the CODESYS
	/// bridge's `item_cache.get(name) or connection.find_by_name(name)`
	/// pattern so apply-side lookup behaviour matches across the two
	/// platforms.
	/// </summary>
	private dynamic? ResolveItem(string name, Dictionary<string, dynamic> itemCache)
	{
		if (itemCache.TryGetValue(name, out var cached)) return cached;
		return _connection.LookupItemByName(name);
	}

	private void ApplyDeleteItem(JsonObject op, Dictionary<string, dynamic> itemCache)
	{
		var name = op["name"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("deleteItem missing 'name'");
		// Cache-first parent lookup: if the cached item exposes its
		// .Parent COM property, we skip the full FindRelativePath walk
		// LookupParentByName would otherwise do. Falls back to the
		// name-based lookup if Parent isn't readable from the cached
		// reference (some TC versions throw on detached items).
		dynamic? parent = null;
		if (itemCache.TryGetValue(name, out var cached))
		{
			try { parent = cached.Parent; }
			catch { /* fall through to name-based lookup */ }
		}
		parent ??= _connection.LookupParentByName(name)
			?? throw BridgeException.NotFound("item", name);
		ComCall.Invoke(
			"DeleteChild(top-level)",
			() => parent.DeleteChild(name),
			("name", name));
	}

	private void ApplyRenameItem(JsonObject op, Dictionary<string, dynamic> itemCache)
	{
		var name = op["name"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("renameItem missing 'name'");
		var newName = op["newName"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("renameItem missing 'newName'");
		// _rename has its own internals; for consistency with the other
		// apply paths we resolve via cache first and forward the JSON
		// shape it already understands. If the cache had the item,
		// RenameHandler's internal lookup hits LookupTreeItem with a
		// path it can quickly resolve (warm caches inside TC's COM).
		_ = ResolveItem(name, itemCache); // keep cache locality warm
		_rename.Handle(new JsonObject
		{
			["name"] = name,
			["newName"] = newName,
		});
	}

	private void ApplyMoveItem(JsonObject op, Dictionary<string, dynamic> itemCache)
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

		var item = ResolveItem(name, itemCache)
			?? throw new BridgeException(404, "NOT_FOUND",
				$"moveItem: item '{name}' not found");

		// Capture snapshot via the same builder /fetch uses.
		var snapshot = GetHandler.BuildResult(_connection, name, item);

		// Safety: moveItem is implemented as delete-then-recreate, but
		// CreateHandler doesn't yet round-trip graphical bodies (the
		// agent treats them as read-only — see
		// `project_graphical_read_only` memory). If the parent has any
		// graphical children, the delete-recreate would silently lose
		// them. Refuse loudly so the engineer can move via the IDE
		// instead.
		// Pattern: pull out IList from the snapshot value. The
		// `is`-pattern binding doesn't propagate the cast back into the
		// trailing `Count` access cleanly under .NET 8's flow analysis
		// (CS0165), so do the two checks sequentially.
		snapshot.TryGetValue("graphicalChildren", out object? gcVal);
		var gcList = gcVal as System.Collections.IList;
		if (gcList != null && gcList.Count > 0)
		{
			throw new BridgeException(409, "MOVE_REFUSED_GRAPHICAL_CHILDREN",
				$"moveItem refused: '{name}' contains {gcList.Count} graphical child member(s) " +
				$"(FBD/LD/SFC/CFC) which can't be round-tripped through Volt yet. " +
				$"Move this POU in the TwinCAT IDE instead.");
		}

		var snapshotNode = JsonNode.Parse(JsonSerializer.Serialize(snapshot))
			?? throw new BridgeException(500, "INTERNAL_ERROR",
				$"moveItem: failed to serialize snapshot for '{name}'");
		var createBody = snapshotNode.AsObject();
		createBody["folder"] = newFolder;
		// Strip the graphicalChildren field — it's not part of the
		// create-body contract and CreateHandler ignores it. Keeps
		// the JSON shape clean across the delete-recreate boundary.
		createBody.Remove("graphicalChildren");

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
	//
	// Both signatures forward to the SHARED walker on BeckhoffConnection
	// — same code path RefsHandler and FetchHandler use, so the resulting
	// `versions` map (and the projectVersion hash derived from it) are
	// structurally guaranteed to agree across all three handlers.

	private void BuildCurrentVersions(Dictionary<string, string> versions)
	{
		CollectVersions(versions, items: null);
	}

	private void BuildCurrentVersions(Dictionary<string, string> versions, Dictionary<string, dynamic> items)
	{
		CollectVersions(versions, items: items);
	}

	private void CollectVersions(Dictionary<string, string> versions, Dictionary<string, dynamic>? items)
	{
		_connection.WalkProjectTree((visit) =>
		{
			if (visit.IsTopLevelCrud)
			{
				versions[visit.Name] = BeckhoffConnection.ComputeItemVersion(visit.Item, visit.FolderPath ?? "");
				// Cache CRUD items so ApplyPushItem avoids a fresh
				// LookupItemByName walk per op. Only CRUD items are
				// pushable, so caching only those is sufficient.
				if (items != null) items[visit.Name] = visit.Item;
			}
			else
			{
				string? configKind = BlockTypeMapper.ToConfigKind(visit.ItemType);
				if (configKind is null)
				{
					Log.Warn($"[push:versions] skipping {visit.Name}: ItemType {visit.ItemType} unmapped");
					return;
				}
				// Use the typed-extractor-derived version so the
				// post-push hash matches what /refs and /fetch produce
				// for the SAME item. Anything else risks phantom drift
				// after a successful push. `visit.Item` is dynamic → call is
				// late-bound, return degrades to dynamic; DLR auto-unboxes the
				// Nullable<ValueTuple>, so .Value fails — read named members directly.
				var manifest = _connection.BuildConfigManifest(visit.Item, configKind, visit.Name, visit.FolderPath ?? "");
				if (manifest is null) return;
				versions[visit.Name] = (string)manifest.Version;
			}
		});

		// I/O devices contribute to the project version too — same
		// rationale as RefsHandler / FetchHandler.
		_connection.WalkIoDevices((visit) =>
		{
			var manifest = _connection.BuildConfigManifest(visit.Item, "device", visit.Name, visit.FolderPath ?? "");
			if (manifest is null) return;
			versions[visit.Name] = (string)manifest.Version;
		});
	}
}
