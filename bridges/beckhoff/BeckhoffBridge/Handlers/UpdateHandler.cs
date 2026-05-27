using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using BeckhoffBridge.Helpers;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// Internal helper invoked by <see cref="SetHandler"/> (which itself is
/// invoked by <see cref="PushHandler"/>). Not wired to an HTTP route —
/// the public wire surface is `POST /push`.
///
/// Updates and/or renames an existing POU, GVL, DUT, interface, folder,
/// or child item. Accepts pre-split `declaration`/`implementation` fields.
/// Renames use explicit `newName` field (works for all types including
/// GVL/folder). Children have `declaration`, `implementation`,
/// `getterCode`, `setterCode`.
/// </summary>
internal sealed class UpdateHandler
{
	private readonly BeckhoffConnection _connection;

	public UpdateHandler(BeckhoffConnection connection)
	{
		_connection = connection;
	}

	public object Handle(JsonObject body)
	{
		if (!_connection.IsConnected) throw BridgeException.NotConnected();

		var name = body["name"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("Missing 'name' field");
		var declaration = body["declaration"]?.GetValue<string>();

		// Determine type from declaration header
		string? type = null;
		if (!string.IsNullOrWhiteSpace(declaration))
		{
			var header = CodeHelper.ParseCodeHeader(declaration);
			type = header.Type;
		}

		// --- Rename phase (explicit newName only) ---
		var newName = body["newName"]?.GetValue<string>();
		if (!string.IsNullOrWhiteSpace(newName))
		{
			bool isChild = name.Contains('.');
			if (isChild)
				RenameChildItem(name, newName, "child");
			else
				RenameTopLevel(name, newName, type != null ? TypeLabel(type) : "item");

			if (isChild)
			{
				var parts = name.Split('.', 2);
				name = parts.Length >= 2 ? $"{parts[0]}.{newName}" : newName;
			}
			else
			{
				name = newName;
			}
		}

		// --- Code phase ---
		// No declaration → no top-level code update (e.g. children-only
		// bodies). The wire validation that updatePou / updateChild ALWAYS
		// arrive with both declaration + implementation lives in
		// PushHandler.ApplyUpdate{Pou,Child}, so anything reaching here
		// without a declaration is either a children-only body or a
		// rename-only op.
		if (type == "property")
			return UpdateProperty(name, declaration, body);

		object codeResult;

		if (string.IsNullOrWhiteSpace(declaration))
			codeResult = new { success = true };
		else
		{
			codeResult = type switch
			{
				"function_block" or "function" or "program" => UpdatePou(name, body),
				"gvl" => UpdateGvl(name, body),
				"structure" or "enumeration" or "union" or "alias" => UpdateDut(name, body),
				"interface" => UpdateInterface(name, body),
				"folder" => new { success = true },
				_ => throw BridgeException.BadRequest($"Unknown type: {type}"),
			};
		}

		// --- Children phase ---
		var childrenNode = body["children"]?.AsArray();
		if (childrenNode != null && childrenNode.Count > 0)
		{
			var parentItem = _connection.LookupItemByName(name)
				?? _connection.FindItemOrThrow(name, "item");
			var childResults = ProcessChildren(parentItem, name, childrenNode);
			return new Dictionary<string, object?>
			{
				["success"] = true,
				["children"] = childResults,
			};
		}

		return codeResult;
	}

	// =========================================================================
	// Rename helpers
	// =========================================================================

	private void RenameTopLevel(string oldName, string newName, string typeName)
	{
		var root = _connection.GetPlcProjectRoot();
		var item = _connection.FindItemByName(root, oldName)
			?? throw BridgeException.NotFound(typeName, oldName);

		try { item.Name = newName; }
		catch (Exception ex)
		{
			throw new BridgeException(400, "RENAME_FAILED",
				$"Failed to rename {typeName} '{oldName}' to '{newName}': {ex.Message}");
		}
	}

	private void RenameChildItem(string oldDottedName, string newChildName, string type)
	{
		var oldParts = oldDottedName.Split('.', 2);
		if (oldParts.Length < 2)
			throw BridgeException.BadRequest("Expected 'ParentName.ChildName' format for name");

		var parentName = oldParts[0];
		var oldChildName = oldParts[1];

		var parentItem = _connection.LookupItemByName(parentName)
			?? throw BridgeException.NotFound("POU", parentName);
		var childItem = _connection.FindItemByName(parentItem, oldChildName)
			?? throw BridgeException.NotFound(type, oldDottedName);

		try { childItem.Name = newChildName; }
		catch (Exception ex)
		{
			throw new BridgeException(400, "RENAME_FAILED",
				$"Failed to rename {type} '{oldDottedName}' to '{parentName}.{newChildName}': {ex.Message}");
		}
	}

	private static string TypeLabel(string type) => type switch
	{
		"function_block" or "function" or "program" => "POU",
		"gvl" => "GVL",
		"structure" or "enumeration" or "union" or "alias" => "DUT",
		"interface" => "interface",
		"folder" => "folder",
		_ => type,
	};

	// =========================================================================
	// Code update helpers
	// =========================================================================

	private object UpdatePou(string name, JsonObject body)
	{
		var declaration = body["declaration"]?.GetValue<string>();
		var implementation = body["implementation"]?.GetValue<string>();
		var item = _connection.FindItemOrThrow(name, "POU");
		CreateHandler.SetCode(item, declaration, implementation);
		return new { success = true };
	}

	private object UpdateGvl(string name, JsonObject body)
	{
		var declaration = body["declaration"]?.GetValue<string>();
		var item = _connection.FindItemOrThrow(name, "GVL");
		CreateHandler.SetCode(item, declaration, null);
		return new { success = true };
	}

	private object UpdateDut(string name, JsonObject body)
	{
		var declaration = body["declaration"]?.GetValue<string>();
		var item = _connection.FindItemOrThrow(name, "DUT");
		CreateHandler.SetCode(item, declaration, null);
		return new { success = true };
	}

	private object UpdateInterface(string name, JsonObject body)
	{
		var declaration = body["declaration"]?.GetValue<string>();
		var item = _connection.FindItemOrThrow(name, "interface");
		CreateHandler.SetCode(item, declaration, null);
		return new { success = true };
	}

	private object UpdateProperty(string dottedName, string? declaration, JsonObject body)
	{
		var parts = dottedName.Split('.', 2);
		if (parts.Length < 2)
		{
			if (string.IsNullOrWhiteSpace(declaration)
				&& body["getterCode"] == null && body["setterCode"] == null)
				return new { success = true };
			throw BridgeException.BadRequest($"Expected 'ParentName.PropertyName' format, got: {dottedName}");
		}

		var parentName = parts[0];
		var childName = parts[1];

		var parent = _connection.FindItemOrThrow(parentName, "POU");
		var child = _connection.FindItemByName(parent, childName)
			?? throw BridgeException.NotFound("property", dottedName);

		if (!string.IsNullOrWhiteSpace(declaration))
		{
			// Properties: declaration-only (implementation lives in Get/Set children)
			CreateHandler.SetCode(child, declaration, null);
		}

		var getterCode = body["getterCode"]?.GetValue<string>();
		var setterCode = body["setterCode"]?.GetValue<string>();
		var getterDeclaration = body["getterDeclaration"]?.GetValue<string>();
		var setterDeclaration = body["setterDeclaration"]?.GetValue<string>();
		bool hasGetter = body.ContainsKey("getterCode");
		bool hasSetter = body.ContainsKey("setterCode");
		bool wantGet = !hasGetter && !hasSetter || hasGetter;
		bool wantSet = !hasGetter && !hasSetter || hasSetter;
		CreateHandler.EnsureAccessors(child, wantGet, wantSet);
		CreateHandler.ApplyAccessorCode(child, getterCode, setterCode, childName, getterDeclaration, setterDeclaration);

		return new { success = true };
	}

	// =========================================================================
	// Children processing (per-child create/update/delete)
	// =========================================================================

	private List<Dictionary<string, object?>> ProcessChildren(
		dynamic parentItem, string parentName, JsonArray children)
	{
		bool isInterface = CreateHandler.IsInterface(parentItem);
		var results = new List<Dictionary<string, object?>>();

		foreach (var childNode in children)
		{
			if (childNode is not JsonObject child) continue;

			var op = child["op"]?.GetValue<string>() ?? "create";
			var childDecl = child["declaration"]?.GetValue<string>();
			var childImpl = child["implementation"]?.GetValue<string>();
			string childName;

			// Both create and update require a declaration: create needs
			// it to provision the new item; update needs it because the
			// wire spec is "always send full paired state" (the upstream
			// PushHandler validates the same on updateChild ops). For
			// create, name can be parsed from the header; for update /
			// delete, name is required on the op.
			if (op == "delete")
			{
				childName = child["name"]?.GetValue<string>() ?? "";
			}
			else
			{
				if (string.IsNullOrWhiteSpace(childDecl))
					throw BridgeException.BadRequest($"Child {op} missing 'declaration' field");
				var childHeader = CodeHelper.ParseCodeHeader(childDecl);
				childName = child["name"]?.GetValue<string>() ?? childHeader.Name ?? "";
			}

			try
			{
				switch (op)
				{
					case "create":
						CreateChildOnParent(parentItem, child, childDecl!, childImpl, childName, isInterface);
						break;
					case "update":
						UpdateChildOnParent(parentItem, parentName, child, childDecl!, childImpl, childName, isInterface);
						break;
					case "delete":
						DeleteChildOnParent(parentItem, childName);
						break;
					default:
						throw BridgeException.BadRequest($"Unknown child op: {op}");
				}
				results.Add(new Dictionary<string, object?>
				{
					["name"] = childName,
					["success"] = true,
				});
			}
			catch (Exception ex)
			{
				results.Add(new Dictionary<string, object?>
				{
					["name"] = childName,
					["success"] = false,
					["error"] = ex.Message,
				});
			}
		}

		return results;
	}

	private void CreateChildOnParent(
		dynamic parentItem, JsonObject child, string childDecl, string? childImpl, string childName, bool isInterface)
	{
		var childHeader = CodeHelper.ParseCodeHeader(childDecl);
		var childType = childHeader.Type;
		int subType = CreateHandler.GetChildSubType(childType, isInterface);
		object? vInfo = CreateHandler.BuildChildVInfo(childType, childHeader.ReturnType, childHeader.DataType, isInterface, childHeader.AccessModifier);

		// Navigate to subfolder if folder is specified
		var folder = child["folder"]?.GetValue<string>();
		dynamic targetParent = parentItem;
		if (!string.IsNullOrEmpty(folder))
		{
			targetParent = CreateHandler.NavigateOrCreateFolder(parentItem, folder);
		}

		dynamic newChild = ComCall.Invoke(
			"CreateChild(child, update path)",
			() => targetParent.CreateChild(childName, subType, "", vInfo),
			("name", childName), ("subType", subType), ("childType", childType));

		CreateHandler.SetChildCode(newChild, childDecl, childImpl, childType, isInterface);

		if (childType == "property")
			CreateHandler.SetupPropertyAccessors(parentItem, newChild, child, childName, isInterface);
	}

	private void UpdateChildOnParent(
		dynamic parentItem, string parentName, JsonObject child, string childDecl, string? childImpl, string childName, bool isInterface)
	{
		var childHeader = CodeHelper.ParseCodeHeader(childDecl);
		var childType = childHeader.Type;

		var childItem = _connection.FindItemByName(parentItem, childName)
			?? throw BridgeException.NotFound(childType, $"{parentName}.{childName}");

		// Rename via explicit newName
		var newChildName = child["newName"]?.GetValue<string>();
		if (!string.IsNullOrWhiteSpace(newChildName))
		{
			try { childItem.Name = newChildName; }
			catch (Exception ex)
			{
				throw new BridgeException(400, "RENAME_FAILED",
					$"Failed to rename {childType} '{childName}' to '{newChildName}': {ex.Message}");
			}
		}

		var effectiveName = newChildName ?? childName;

		CreateHandler.SetChildCode(childItem, childDecl, childImpl, childType, isInterface);

		if (childType == "property")
		{
			var getterCode = child["getterCode"]?.GetValue<string>();
			var setterCode = child["setterCode"]?.GetValue<string>();
			var getterDeclaration = child["getterDeclaration"]?.GetValue<string>();
			var setterDeclaration = child["setterDeclaration"]?.GetValue<string>();
			bool hasGetter = child.ContainsKey("getterCode");
			bool hasSetter = child.ContainsKey("setterCode");
			bool wantGet = !hasGetter && !hasSetter || hasGetter;
			bool wantSet = !hasGetter && !hasSetter || hasSetter;
			CreateHandler.EnsureAccessors(childItem, wantGet, wantSet);
			CreateHandler.ApplyAccessorCode(childItem, getterCode, setterCode, effectiveName, getterDeclaration, setterDeclaration);
		}
	}

	private void DeleteChildOnParent(dynamic parentItem, string childName)
	{
		try
		{
			parentItem.DeleteChild(childName);
			return;
		}
		catch (Exception ex)
		{
			Log.Warn($"[Update] Warning: DeleteChild '{childName}' failed on LookupTreeItem reference, trying NestedProject: {ex.Message}");
		}

		string parentName = (string)parentItem.Name;
		var root = _connection.GetPlcProjectRoot();
		var nestedParent = _connection.FindItemByName(root, parentName)
			?? throw new BridgeException(404, "NOT_FOUND",
				$"Failed to delete child '{childName}': parent '{parentName}' not found in NestedProject");
		ComCall.Invoke(
			"DeleteChild(child, NestedProject fallback)",
			() => nestedParent.DeleteChild(childName),
			("parent", parentName), ("name", childName));
	}
}
