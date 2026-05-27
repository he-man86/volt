using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using BeckhoffBridge.Helpers;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// POST /push — Atomic batch of PRIMITIVE ops.
///
/// 11 op types, one IDE operation each. The bridge does ZERO diff logic —
/// "what changed since last time?" is the CLIENT's job (serve-git walks
/// git trees; AIs / scripts compute it however they want). The bridge
/// just applies what it's told.
///
/// Op categories:
///   POU lifecycle:    createPou, updatePou, deletePou, renamePou, movePou
///   Child lifecycle:  createChild, updateChild, deleteChild, renameChild
///   Property accessor: setAccessor, deleteAccessor
///
/// All ops carry `ifVersion` against the *affected POU's* current content
/// hash (or `null` for create-new). Two-pass: validate every op's
/// ifVersion against pre-batch state, then apply in declared order on
/// success.
///
/// Why per-op primitives:
///   - Bridge has no type-filtering decisions. The recurring "ItemSubType
///     returns 0 on NestedProject" bug class can't bite anymore — the
///     bridge no longer enumerates children to figure out diffs.
///   - CODESYS / TIA bridge implementers get a clearer contract:
///     "implement these 11 primitive operations." No diff logic to
///     duplicate.
///   - Bug surface goes way down. Each op is a one-COM-call function;
///     failures are localized.
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

		// ── Pre-flight: collect current per-POU versions ─────────────────
		var currentVersions = new Dictionary<string, string>();
		BuildCurrentVersions(currentVersions);
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

		// ── Per-op validation ─────────────────────────────────────────────
		// Each op carries an ifVersion against the *affected POU* (the op's
		// `name` for POU ops, `parent` for child/accessor ops).
		//
		// We walk a VIRTUAL state forward as we go: existence (and a
		// version placeholder) for each POU at the moment its op would
		// apply. This lets a batch like
		//   [deletePou A, createPou B, createChild parent=B …]
		// validate cleanly — the createChild's "parent must exist" check
		// looks at the state after `createPou B` has been notionally
		// applied, not at the literal pre-batch state.
		//
		// We don't actually mutate the IDE during validation; we just
		// track what each POU's existence/version WOULD be if every prior
		// op succeeded. The apply pass below uses the same op order.
		var pending = currentVersions.ToDictionary(kv => kv.Key, kv => (string?)kv.Value);

		foreach (var opNode in ops)
		{
			if (opNode is not JsonObject op) continue;
			var opType = op["op"]?.GetValue<string>() ?? "";
			var affected = AffectedPouName(op);
			if (affected == null) continue;
			var clientIfVersion = op.TryGetPropertyValue("ifVersion", out var ifvNode) && ifvNode is JsonValue ifv && ifv.TryGetValue<string>(out var s) ? s : null;
			var currentVersion = pending.TryGetValue(affected, out var v) ? v : null;

			if (opType == "createPou")
			{
				if (currentVersion != null)
				{
					conflicts.Add(new Dictionary<string, object?>
					{
						["name"] = affected,
						["yourVersion"] = null,
						["currentVersion"] = currentVersion,
						["reason"] = "expected to create new POU but it already exists",
					});
				}
				else
				{
					// Mark as existing for subsequent ops in this batch.
					// Real version is computed post-apply; "" is a
					// placeholder that satisfies `currentVersion != null`.
					pending[affected] = "";
				}
				continue;
			}

			// createChild / setAccessor with ifVersion=null: parent POU
			// must exist (either pre-batch or as the product of an earlier
			// op in this batch).
			if (clientIfVersion == null && (opType == "createChild" || opType == "setAccessor"))
			{
				if (currentVersion == null)
				{
					conflicts.Add(new Dictionary<string, object?>
					{
						["name"] = affected,
						["yourVersion"] = null,
						["currentVersion"] = null,
						["reason"] = $"expected parent POU '{affected}' to exist for {opType}",
					});
				}
				continue;
			}

			// All other ops require ifVersion to match current.
			if (clientIfVersion != null && currentVersion != clientIfVersion)
			{
				conflicts.Add(new Dictionary<string, object?>
				{
					["name"] = affected,
					["yourVersion"] = clientIfVersion,
					["currentVersion"] = currentVersion,
					["reason"] = currentVersion == null
						? $"expected POU '{affected}' to exist but it doesn't"
						: $"POU '{affected}' changed since you fetched its version",
				});
				continue;
			}

			// Track EXISTENCE-changing ops so later ops see the right
			// presence. We deliberately do NOT touch pending after
			// updatePou: the POU still exists with the same identity,
			// and subsequent ops in the same batch (e.g. updateChild
			// against the same parent) were computed by the client
			// against the PRE-BATCH version. Stomping pending[affected]
			// with a "" placeholder here would break those — the next
			// op's `ifVersion` would compare against "" and fail.
			//
			// movePou also keeps the same name + version (snapshot/restore
			// inside the bridge); no state change here.
			switch (opType)
			{
				case "deletePou":
					pending.Remove(affected);
					break;
				case "renamePou":
					{
						var newName = op["newName"]?.GetValue<string>();
						if (newName != null)
						{
							pending.Remove(affected);
							pending[newName] = "";
						}
						break;
					}
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
		// Each op = one IDE operation. We translate the op into the body
		// shape an existing handler accepts (CreateHandler / UpdateHandler /
		// RenameHandler / DeleteHandler) — keeping all the COM-touching
		// code in those proven handlers, but stripping the diff logic that
		// used to live in SetHandler.
		foreach (var opNode in ops)
		{
			if (opNode is not JsonObject op) continue;
			var opType = op["op"]?.GetValue<string>() ?? "";
			switch (opType)
			{
				case "createPou":     ApplyCreatePou(op); break;
				case "updatePou":     ApplyUpdatePou(op); break;
				case "deletePou":     ApplyDeletePou(op); break;
				case "renamePou":     ApplyRenamePou(op); break;
				case "movePou":       ApplyMovePou(op); break;
				case "createChild":   ApplyCreateChild(op); break;
				case "updateChild":   ApplyUpdateChild(op); break;
				case "deleteChild":   ApplyDeleteChild(op); break;
				case "renameChild":   ApplyRenameChild(op); break;
				case "setAccessor":   ApplySetAccessor(op); break;
				case "deleteAccessor": ApplyDeleteAccessor(op); break;
				default: throw BridgeException.BadRequest($"Unknown op type: {opType}");
			}
		}

		// ── Recompute refs and report ────────────────────────────────────
		var newVersions = new Dictionary<string, string>();
		BuildCurrentVersions(newVersions);
		return new Dictionary<string, object?>
		{
			["accepted"] = true,
			["newProjectVersion"] = BeckhoffConnection.ComputeProjectVersion(newVersions),
			["newItems"] = newVersions,
		};
	}

	/// <summary>The POU whose version an op's ifVersion is validated against.</summary>
	private static string? AffectedPouName(JsonObject op)
	{
		var type = op["op"]?.GetValue<string>() ?? "";
		switch (type)
		{
			case "createPou":
			case "updatePou":
			case "deletePou":
			case "renamePou":
			case "movePou":
				return op["name"]?.GetValue<string>();
			case "createChild":
			case "updateChild":
			case "deleteChild":
			case "renameChild":
			case "setAccessor":
			case "deleteAccessor":
				return op["parent"]?.GetValue<string>();
			default:
				return null;
		}
	}

	// ─── Op applicators ───────────────────────────────────────────────
	// Each one translates the new primitive op into the body shape that
	// the existing handler (CreateHandler/UpdateHandler/etc.) accepts.
	// This keeps the COM-touching code in the proven handlers; we only
	// own the translation layer.

	private void ApplyCreatePou(JsonObject op)
	{
		// CreateHandler.Handle expects { name, declaration, implementation?, folder?, children? }
		var body = new JsonObject
		{
			["name"] = op["name"]?.DeepClone(),
			["declaration"] = op["declaration"]?.DeepClone(),
		};
		if (op["implementation"] is JsonNode impl) body["implementation"] = impl.DeepClone();
		if (op["folder"] is JsonNode folder) body["folder"] = folder.DeepClone();
		_create.Handle(body);
	}

	private void ApplyUpdatePou(JsonObject op)
	{
		// Wire contract: updatePou ALWAYS carries both fields, even if
		// only one changed. Mirrors TwinCAT COM's paired-property model
		// and matches every other bridge implementation's behaviour.
		// Pass empty string for fields that don't apply to a given POU
		// kind (e.g. implementation on a GVL) — SetCode silently no-ops
		// writes the underlying COM item doesn't support.
		var decl = op["declaration"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("updatePou missing 'declaration' field");
		var impl = op["implementation"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("updatePou missing 'implementation' field");
		var body = new JsonObject
		{
			["name"] = op["name"]?.DeepClone(),
			["declaration"] = decl,
			["implementation"] = impl,
		};
		_update.Handle(body);
	}

	private void ApplyDeletePou(JsonObject op)
	{
		var body = new JsonObject { ["name"] = op["name"]?.DeepClone() };
		_delete.Handle(body);
	}

	private void ApplyRenamePou(JsonObject op)
	{
		var body = new JsonObject
		{
			["name"] = op["name"]?.DeepClone(),
			["newName"] = op["newName"]?.DeepClone(),
		};
		_rename.Handle(body);
	}

	private void ApplyMovePou(JsonObject op)
	{
		// TwinCAT COM doesn't expose a clean cross-folder MoveItem primitive
		// on the surface we use. We implement movePou as a controlled
		// delete-then-recreate-at-new-folder, capturing the full POU state
		// (declaration + implementation + children + accessors) up front so
		// nothing's lost across the dance.
		//
		// Why bridge-internal vs leaving it to the client to emit two ops:
		//   - One semantic op on the wire — clients aren't lied to about
		//     what they asked for ("move this POU"), and they don't have to
		//     replicate the snapshot dance.
		//   - Sidesteps the pre-batch-validation problem: if the wire had
		//     deletePou + createPou for the same name, validation against
		//     pre-batch state would reject the createPou as "already exists."
		//   - The recreated POU has identical content → same hash → other
		//     ops in the batch that reference its version still validate.
		//   - Future-friendly: if TwinCAT ever exposes a real move primitive
		//     (or CODESYS does on its side), the implementation swap is
		//     local to this method — wire shape doesn't change.

		var name = op["name"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("movePou missing 'name'");
		var newFolder = op["newFolder"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("movePou missing 'newFolder'");

		var item = _connection.LookupItemByName(name)
			?? throw new BridgeException(404, "NOT_FOUND",
				$"movePou: POU '{name}' not found");

		// Capture snapshot via the same builder /fetch uses, so we preserve
		// declaration + implementation + every child + every accessor's
		// declaration & code. The snapshot is in AIGetResult shape.
		var snapshot = GetHandler.BuildResult(_connection, name, item);

		// Convert snapshot to JsonObject so we can hand it to CreateHandler.
		var snapshotNode = JsonNode.Parse(JsonSerializer.Serialize(snapshot))
			?? throw new BridgeException(500, "INTERNAL_ERROR",
				$"movePou: failed to serialize snapshot for '{name}'");
		var createBody = snapshotNode.AsObject();

		// Override the folder to the new target. Any pre-existing `folder`
		// in the snapshot reflected the OLD location; replace it.
		createBody["folder"] = newFolder;

		// Delete from the old location.
		_delete.Handle(new JsonObject { ["name"] = name });

		// Re-create at the new folder with the captured content. CreateHandler
		// dispatches on the declaration header to pick the right kind, then
		// inline-creates children + accessors.
		_create.Handle(createBody);
	}

	private void ApplyCreateChild(JsonObject op)
	{
		// CreateHandler exposes per-child create via the children-list path in
		// UpdateHandler. Easiest: build a children-of-one update body.
		var body = new JsonObject
		{
			["name"] = op["parent"]?.DeepClone(),
			["children"] = new JsonArray
			{
				BuildChildOpBody(op, isCreate: true),
			},
		};
		_update.Handle(body);
	}

	private void ApplyUpdateChild(JsonObject op)
	{
		// Same wire contract as updatePou: both fields always present.
		// Pass empty string for kinds where one side is meaningless
		// (e.g. implementation on a property — accessors carry the
		// actual code, set via setAccessor ops).
		if (op["declaration"] is not JsonNode)
			throw BridgeException.BadRequest("updateChild missing 'declaration' field");
		if (op["implementation"] is not JsonNode)
			throw BridgeException.BadRequest("updateChild missing 'implementation' field");
		var body = new JsonObject
		{
			["name"] = op["parent"]?.DeepClone(),
			["children"] = new JsonArray
			{
				BuildChildOpBody(op, isCreate: false),
			},
		};
		_update.Handle(body);
	}

	private void ApplyDeleteChild(JsonObject op)
	{
		var child = new JsonObject
		{
			["op"] = "delete",
			["name"] = op["name"]?.DeepClone(),
		};
		var body = new JsonObject
		{
			["name"] = op["parent"]?.DeepClone(),
			["children"] = new JsonArray { child },
		};
		_update.Handle(body);
	}

	private void ApplyRenameChild(JsonObject op)
	{
		var child = new JsonObject
		{
			["op"] = "update",
			["name"] = op["name"]?.DeepClone(),
			["newName"] = op["newName"]?.DeepClone(),
		};
		var body = new JsonObject
		{
			["name"] = op["parent"]?.DeepClone(),
			["children"] = new JsonArray { child },
		};
		_update.Handle(body);
	}

	private void ApplySetAccessor(JsonObject op)
	{
		// Accessors are property children. We address the property as a
		// child-update with accessor fields populated.
		var which = op["which"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("setAccessor missing 'which'");
		var implementation = op["implementation"]?.GetValue<string>() ?? "";
		var declaration = op["declaration"]?.GetValue<string>();

		var child = new JsonObject
		{
			["op"] = "update",
			["name"] = op["property"]?.DeepClone(),
		};
		if (which == "get")
		{
			child["getterCode"] = implementation;
			if (declaration != null) child["getterDeclaration"] = declaration;
		}
		else if (which == "set")
		{
			child["setterCode"] = implementation;
			if (declaration != null) child["setterDeclaration"] = declaration;
		}
		else
		{
			throw BridgeException.BadRequest($"setAccessor: 'which' must be 'get' or 'set', got '{which}'");
		}

		var body = new JsonObject
		{
			["name"] = op["parent"]?.DeepClone(),
			["children"] = new JsonArray { child },
		};
		_update.Handle(body);
	}

	private void ApplyDeleteAccessor(JsonObject op)
	{
		var which = op["which"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("deleteAccessor missing 'which'");

		// To "delete" an accessor we use the update path: child has an empty
		// getterCode/setterCode, which UpdateHandler interprets as "ensure
		// accessor is gone."
		var child = new JsonObject
		{
			["op"] = "update",
			["name"] = op["property"]?.DeepClone(),
		};
		if (which == "get")
		{
			// Sending explicit null for getterCode requests removal; UpdateHandler
			// passes null through EnsureAccessors which drops the accessor.
			child["getterCode"] = null;
		}
		else if (which == "set")
		{
			child["setterCode"] = null;
		}
		else
		{
			throw BridgeException.BadRequest($"deleteAccessor: 'which' must be 'get' or 'set', got '{which}'");
		}

		var body = new JsonObject
		{
			["name"] = op["parent"]?.DeepClone(),
			["children"] = new JsonArray { child },
		};
		_update.Handle(body);
	}

	private static JsonObject BuildChildOpBody(JsonObject op, bool isCreate)
	{
		var child = new JsonObject
		{
			["op"] = isCreate ? "create" : "update",
			["name"] = op["name"]?.DeepClone(),
		};
		if (op["folder"] is JsonNode folder) child["folder"] = folder.DeepClone();
		if (op["declaration"] is JsonNode decl) child["declaration"] = decl.DeepClone();
		if (op["implementation"] is JsonNode impl) child["implementation"] = impl.DeepClone();
		if (op["kind"] is JsonNode kind) child["kind"] = kind.DeepClone();
		return child;
	}

	// ─── Helpers ──────────────────────────────────────────────────────

	private void BuildCurrentVersions(Dictionary<string, string> versions)
	{
		var root = _connection.GetPlcProjectRoot();
		CollectVersions(root, versions);
	}

	private void CollectVersions(dynamic node, Dictionary<string, string> versions)
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
				CollectVersions(child, versions);
				continue;
			}

			if (!BlockTypeMapper.IsTopLevelCrud(itemType)) continue;

			try { versions[name] = BeckhoffConnection.ComputeItemVersion(child); }
			catch { /* skip */ }
		}
	}
}
