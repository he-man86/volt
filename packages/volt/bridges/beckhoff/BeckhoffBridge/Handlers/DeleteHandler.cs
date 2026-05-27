using System;
using System.Text.Json.Nodes;
using BeckhoffBridge.Helpers;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// Internal helper invoked by <see cref="PushHandler"/> for each `delete` op
/// in a batch. Not wired to an HTTP route — the public wire surface is
/// <c>POST /push</c>.
///
/// Deletes a POU, GVL, DUT, folder, or interface from the PLC project.
/// Finds the parent tree item by name and removes the child. Type is not
/// required — items are found by name (names are unique).
/// </summary>
internal sealed class DeleteHandler
{
	private readonly BeckhoffConnection _connection;

	public DeleteHandler(BeckhoffConnection connection)
	{
		_connection = connection;
	}

	public object Handle(JsonObject body)
	{
		if (!_connection.IsConnected) throw BridgeException.NotConnected();

		var name = body["name"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("Missing 'name' field");

		var parent = _connection.LookupParentByName(name)
			?? throw BridgeException.NotFound("item", name);

		ComCall.Invoke(
			"DeleteChild(top-level)",
			() => parent.DeleteChild(name),
			("name", name));

		return new { success = true };
	}
}
