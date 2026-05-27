using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// Internal helper invoked by <see cref="PushHandler"/> for each `rename` op
/// in a batch. Not wired to an HTTP route — the public wire surface is
/// <c>POST /push</c>.
///
/// Rename a top-level POU / GVL / DUT / interface.
///
/// Op shape:
///   { "op": "rename", "name": "FB_Old", "ifVersion": "...", "newName": "FB_New" }
///
/// Child renames (a method inside an FB) DON'T emit a separate rename op —
/// they ride inside an `upsert` via a `previousName` hint on the child
/// spec. That way the IDE keeps the child's rename history alongside the
/// other edits that landed in the same operation.
/// </summary>
internal sealed class RenameHandler
{
	private readonly BeckhoffConnection _connection;

	public RenameHandler(BeckhoffConnection connection)
	{
		_connection = connection;
	}

	public object Handle(JsonObject body)
	{
		if (!_connection.IsConnected) throw BridgeException.NotConnected();

		var name = body["name"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("Missing 'name' field");
		var newName = body["newName"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("Missing 'newName' field");

		if (string.IsNullOrWhiteSpace(newName))
			throw BridgeException.BadRequest("'newName' must not be empty");

		if (name == newName)
			return new Dictionary<string, object?> { ["success"] = true };

		var root = _connection.GetPlcProjectRoot();
		dynamic? item = _connection.FindItemByName(root, name);
		if (item == null)
			throw BridgeException.NotFound("item", name);

		try { item.Name = newName; }
		catch (Exception ex)
		{
			throw new BridgeException(400, "RENAME_FAILED",
				$"Failed to rename '{name}' to '{newName}': {ex.Message}");
		}

		return new Dictionary<string, object?> { ["success"] = true };
	}
}
