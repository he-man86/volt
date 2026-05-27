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
/// Creates a new POU, GVL, DUT, or folder in the PLC project. Accepts
/// pre-split `declaration`/`implementation` fields. Children have
/// `declaration`, `implementation`, `getterCode`, `setterCode`. Also
/// exposes the static helpers (<see cref="SetCode"/>, <see cref="EnsureAccessors"/>,
/// <see cref="ApplyAccessorCode"/>, etc.) reused by <see cref="UpdateHandler"/>.
/// </summary>
internal sealed class CreateHandler
{
	private readonly BeckhoffConnection _connection;

	public CreateHandler(BeckhoffConnection connection)
	{
		_connection = connection;
	}

	public object Handle(JsonObject body)
	{
		if (!_connection.IsConnected) throw BridgeException.NotConnected();

		var declaration = body["declaration"]?.GetValue<string>();
		var explicitName = body["name"]?.GetValue<string>();

		// No declaration = folder create (folders have no code)
		if (string.IsNullOrWhiteSpace(declaration))
			return CreateFolder(explicitName ?? throw BridgeException.BadRequest("Missing 'name' for folder"), body);

		var header = CodeHelper.ParseCodeHeader(declaration);
		var name = explicitName ?? header.Name
			?? throw BridgeException.BadRequest("'name' is required");

		// Reject duplicate creates upfront — without this, parent.CreateChild
		// throws a cryptic COM message ("'name' already exists" wrapped in
		// .NET noise). CODESYS bridge does the same via _check_duplicate so
		// both bridges return the same shape on conflict.
		// Folder create has its own idempotent path (CreateFolder) and is not
		// reached here because folders have no declaration.
		if (_connection.LookupItemByName(name) != null)
			throw BridgeException.AlreadyExists(name);

		return header.Type switch
		{
			"function_block" or "program" or "function" => CreatePou(name, body, header),
			"gvl" => CreateGvl(name, body),
			"structure" or "enumeration" or "union" or "alias" => CreateDut(name, body, header.Type),
			"interface" => CreateInterface(name, body),
			_ => throw BridgeException.BadRequest($"Unknown type from code: {header.Type}"),
		};
	}

	private object CreatePou(string name, JsonObject body, CodeHelper.CodeHeader header)
	{
		var declaration = body["declaration"]?.GetValue<string>();
		var implementation = body["implementation"]?.GetValue<string>();
		var folder = body["folder"]?.GetValue<string>();

		int subType = BlockTypeMapper.PouTypeToSubType(header.Type);
		var parent = GetParentFolder(folder);

		// Functions need return type; all POUs use "ST" language via string vInfo
		// "void" means no return type — treat as untyped
		var returnType = header.ReturnType;
		var effectiveReturnType = string.Equals(returnType, "void", StringComparison.OrdinalIgnoreCase) ? null : returnType;
		object? vInfo = subType == BlockTypeMapper.FunctionSubType && effectiveReturnType != null
			? (object)new string[] { "ST", effectiveReturnType }
			: (object)"ST";

		dynamic newItem = ComCall.Invoke(
			"CreateChild(POU)",
			() => parent.CreateChild(name, subType, "", vInfo),
			("name", name), ("subType", subType), ("returnType", effectiveReturnType));

		SetCode(newItem, declaration, implementation);

		var createdChildren = CreateChildren(newItem, name, body);

		var result = new Dictionary<string, object?>
		{
			["success"] = true,
			["name"] = name,
		};
		if (createdChildren.Count > 0)
			result["children"] = createdChildren;

		return result;
	}

	private object CreateGvl(string name, JsonObject body)
	{
		var declaration = body["declaration"]?.GetValue<string>();
		var folder = body["folder"]?.GetValue<string>();

		var parent = GetParentFolder(folder);
		dynamic newItem = ComCall.Invoke(
			"CreateChild(GVL)",
			() => parent.CreateChild(name, BlockTypeMapper.GvlSubType, "", null),
			("name", name));

		SetCode(newItem, declaration, null);

		return new { success = true, name };
	}

	private object CreateDut(string name, JsonObject body, string requestType)
	{
		var declaration = body["declaration"]?.GetValue<string>();
		var folder = body["folder"]?.GetValue<string>();

		int subType = BlockTypeMapper.DutTypeToSubType(requestType);
		var parent = GetParentFolder(folder);
		dynamic newItem = ComCall.Invoke(
			"CreateChild(DUT)",
			() => parent.CreateChild(name, subType, "", null),
			("name", name), ("subType", subType), ("dutType", requestType));

		SetCode(newItem, declaration, null);

		return new { success = true, name };
	}

	private object CreateFolder(string name, JsonObject body)
	{
		var folder = body["folder"]?.GetValue<string>();
		var parent = GetParentFolder(folder);

		// Check if folder already exists — return success silently (idempotent)
		var existing = FindDirectChild(parent, name);
		if (existing == null)
		{
			try
			{
				parent.CreateChild(name, BlockTypeMapper.FolderSubType, "", null);
			}
			catch (Exception ex) when (ex.Message.Contains("already exists", StringComparison.OrdinalIgnoreCase))
			{
				// TwinCAT throws when the disk folder pre-exists even though
				// CreateChild succeeded. The folder is in the project tree — safe to ignore.
			}
		}

		return new { success = true, name };
	}

	private object CreateInterface(string name, JsonObject body)
	{
		var declaration = body["declaration"]?.GetValue<string>();
		var folder = body["folder"]?.GetValue<string>();

		var parent = GetParentFolder(folder);
		dynamic newItem = ComCall.Invoke(
			"CreateChild(Interface)",
			() => parent.CreateChild(name, BlockTypeMapper.InterfaceSubType, "", null),
			("name", name));

		SetCode(newItem, declaration, null);

		var createdChildren = CreateChildren(newItem, name, body);

		var result = new Dictionary<string, object?>
		{
			["success"] = true,
			["name"] = name,
		};
		if (createdChildren.Count > 0)
			result["children"] = createdChildren;

		return result;
	}

	/// <summary>
	/// Create inline child items under a freshly-created parent.
	/// Each child must have a `declaration` field with a header (METHOD/ACTION/PROPERTY).
	/// </summary>
	private List<Dictionary<string, object?>> CreateChildren(dynamic parentItem, string parentName, JsonObject body)
	{
		var results = new List<Dictionary<string, object?>>();
		var children = body["children"]?.AsArray();
		if (children == null || children.Count == 0) return results;

		bool isInterface = IsInterface(parentItem);

		foreach (var childNode in children)
		{
			if (childNode is not JsonObject child) continue;

			var childDecl = child["declaration"]?.GetValue<string>()
				?? throw BridgeException.BadRequest("Child missing 'declaration' field");
			var childImpl = child["implementation"]?.GetValue<string>();

			var childHeader = CodeHelper.ParseCodeHeader(childDecl);
			var childType = childHeader.Type;
			var explicitChildName = child["name"]?.GetValue<string>();
			var childName = explicitChildName ?? childHeader.Name
				?? throw BridgeException.BadRequest("'name' is required for child");
			var returnType = childHeader.ReturnType;
			var dataType = childHeader.DataType;
			var accessModifier = childHeader.AccessModifier;

			try
			{
				// Navigate to subfolder if folder is specified
				var folder = child["folder"]?.GetValue<string>();
				dynamic targetParent = parentItem;
				if (!string.IsNullOrEmpty(folder))
				{
					targetParent = NavigateOrCreateFolder(parentItem, folder);
				}

				int subType = GetChildSubType(childType, isInterface);
				object? vInfo = BuildChildVInfo(childType, returnType, dataType, isInterface, accessModifier);

				dynamic newChild = ComCall.Invoke(
					"CreateChild(child)",
					() => targetParent.CreateChild(childName, subType, "", vInfo),
					("parent", parentName), ("name", childName),
					("subType", subType), ("childType", childType));

				SetChildCode(newChild, childDecl, childImpl, childType, isInterface);

				if (childType == "property")
					SetupPropertyAccessors(parentItem, newChild, child, childName, isInterface);

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

	/// <summary>
	/// Write code to a child item, respecting COM object limitations:
	/// - Actions: implementation only (no DeclarationText on COM object)
	/// - Properties: declaration only (implementation lives in Get/Set)
	/// - Interface children: declaration only (no ImplementationText)
	/// </summary>
	internal static void SetChildCode(
		dynamic item, string? decl, string? impl, string childType, bool isInterface)
	{
		var writeDecl = childType != "action" ? decl : null;
		var writeImpl = (childType != "property" && !isInterface) ? impl : null;
		SetCode(item, writeDecl, writeImpl);
	}

	/// <summary>
	/// Set up Get/Set accessors and their code on a property.
	/// Shared between CreateChildren and UpdateHandler.CreateChildOnParent.
	/// </summary>
	internal static void SetupPropertyAccessors(
		dynamic parentItem, dynamic propertyItem, JsonObject child, string childName, bool isInterface)
	{
		var getterCode = child["getterCode"]?.GetValue<string>();
		var setterCode = child["setterCode"]?.GetValue<string>();
		var getterDeclaration = child["getterDeclaration"]?.GetValue<string>();
		var setterDeclaration = child["setterDeclaration"]?.GetValue<string>();
		bool hasGetter = child.ContainsKey("getterCode");
		bool hasSetter = child.ContainsKey("setterCode");
		bool wantGet = !hasGetter && !hasSetter || hasGetter;
		bool wantSet = !hasGetter && !hasSetter || hasSetter;

		if (isInterface)
		{
			// The newChild reference from CreateChild is stale for interface properties.
			// Get a fresh reference by finding the child directly on the parent.
			dynamic? freshProp = FindDirectChild(parentItem, childName);
			if (freshProp != null)
				CreateInterfaceAccessors(freshProp, wantGet, wantSet);
		}
		else
		{
			EnsureAccessors(propertyItem, wantGet, wantSet);
			ApplyAccessorCode(propertyItem, getterCode, setterCode, childName, getterDeclaration, setterDeclaration);
		}
	}

	/// <summary>Apply getter/setter code strings to a property's accessors.</summary>
	internal static void ApplyAccessorCode(
		dynamic property, string? getterCode, string? setterCode, string propName,
		string? getterDeclaration = null, string? setterDeclaration = null)
	{
		if (!string.IsNullOrWhiteSpace(getterCode))
		{
			dynamic? getter = FindDirectChild(property, "Get");
			if (getter != null)
			{
				try
				{
					StripAccessorPublic(getter);
					getter.ImplementationText = getterCode;
				}
				catch (Exception ex)
				{
					throw new BridgeException(500, "WRITE_FAILED",
						$"Failed to set getter implementation for '{propName}': {ex.Message}");
				}
			}
			else
			{
				throw new BridgeException(404, "NOT_FOUND",
					$"Get accessor not found for property '{propName}'");
			}
		}

		// Write getter declaration (VAR block) if provided
		if (getterDeclaration != null)
		{
			dynamic? getter = FindDirectChild(property, "Get");
			if (getter != null)
			{
				try { getter.DeclarationText = getterDeclaration; }
				catch { /* COM may not support DeclarationText on some accessor types */ }
			}
		}

		if (!string.IsNullOrWhiteSpace(setterCode))
		{
			dynamic? setter = FindDirectChild(property, "Set");
			if (setter != null)
			{
				try
				{
					StripAccessorPublic(setter);
					setter.ImplementationText = setterCode;
				}
				catch (Exception ex)
				{
					throw new BridgeException(500, "WRITE_FAILED",
						$"Failed to set setter implementation for '{propName}': {ex.Message}");
				}
			}
			else
			{
				throw new BridgeException(404, "NOT_FOUND",
					$"Set accessor not found for property '{propName}'");
			}
		}

		// Write setter declaration (VAR block) if provided
		if (setterDeclaration != null)
		{
			dynamic? setter = FindDirectChild(property, "Set");
			if (setter != null)
			{
				try { setter.DeclarationText = setterDeclaration; }
				catch { /* COM may not support DeclarationText on some accessor types */ }
			}
		}
	}

	/// <summary>
	/// Ensure the correct Get/Set accessors exist on an interface property.
	/// TwinCAT may auto-create Get on property creation. Uses CreateChild with
	/// subtypes 654/655 and vInfo=null (per Beckhoff docs) to create missing ones.
	/// Deletes unwanted accessors (e.g. Set for getter-only properties).
	/// </summary>
	internal static void CreateInterfaceAccessors(dynamic propertyItem, bool wantGet, bool wantSet)
	{
		if (wantGet && FindDirectChild(propertyItem, "Get") == null)
			ComCall.Invoke("CreateChild(InterfaceProperty.Get)",
				() => propertyItem.CreateChild("Get", BlockTypeMapper.InterfacePropertyGetSubType, "", "ST"));

		if (wantSet && FindDirectChild(propertyItem, "Set") == null)
			ComCall.Invoke("CreateChild(InterfaceProperty.Set)",
				() => propertyItem.CreateChild("Set", BlockTypeMapper.InterfacePropertySetSubType, "", "ST"));

		if (!wantGet && FindDirectChild(propertyItem, "Get") != null)
			ComCall.Invoke("DeleteChild(InterfaceProperty.Get)",
				() => propertyItem.DeleteChild("Get"));

		if (!wantSet && FindDirectChild(propertyItem, "Set") != null)
			ComCall.Invoke("DeleteChild(InterfaceProperty.Set)",
				() => propertyItem.DeleteChild("Set"));
	}

	/// <summary>
	/// Build the vInfo parameter for CreateChild on child items.
	/// Uses string[] matching the official Beckhoff sample format:
	///   string[4] { language, returnType, accessModifier, plcopenXml }
	/// </summary>
	internal static object? BuildChildVInfo(string childType, string? returnType, string? dataType, bool isInterface = false, string? accessModifier = null)
	{
		var rt = string.Equals(returnType, "void", StringComparison.OrdinalIgnoreCase) ? null : returnType;
		var dt = string.Equals(dataType, "void", StringComparison.OrdinalIgnoreCase) ? null : dataType;
		bool hasAccess = !string.IsNullOrWhiteSpace(accessModifier);

		if (isInterface)
		{
			return childType switch
			{
				"method" when rt != null => rt,
				"property" when dt != null => dt,
				_ => null,
			};
		}

		// Only include access modifier in vInfo when explicitly provided.
		// TwinCAT defaults to PUBLIC if included — bridge should just write what it receives.
		return childType switch
		{
			"method" when hasAccess && rt != null => new string[] { "ST", rt, accessModifier! },
			"method" when hasAccess => new string[] { "ST", "", accessModifier! },
			"method" when rt != null => new string[] { "ST", rt },
			"method" => "ST",
			"property" when hasAccess && dt != null => new string[] { "ST", dt, accessModifier! },
			"property" when hasAccess => new string[] { "ST", "", accessModifier! },
			"property" when dt != null => new string[] { "ST", dt },
			"property" => "ST",
			"action" => "ST",
			_ => null,
		};
	}

	/// <summary>
	/// Ensure the requested Get/Set accessors exist under a POU property.
	/// </summary>
	internal static void EnsureAccessors(dynamic property, bool wantGet = true, bool wantSet = true)
	{
		if (wantGet && FindDirectChild(property, "Get") == null)
			ComCall.Invoke("CreateChild(Property.Get)",
				() => property.CreateChild("Get", BlockTypeMapper.PropertyGetSubType, "", "ST"));

		if (wantSet && FindDirectChild(property, "Set") == null)
			ComCall.Invoke("CreateChild(Property.Set)",
				() => property.CreateChild("Set", BlockTypeMapper.PropertySetSubType, "", "ST"));

		if (!wantGet && FindDirectChild(property, "Get") != null)
			ComCall.Invoke("DeleteChild(Property.Get)",
				() => property.DeleteChild("Get"));

		if (!wantSet && FindDirectChild(property, "Set") != null)
			ComCall.Invoke("DeleteChild(Property.Set)",
				() => property.DeleteChild("Set"));
	}

	/// <summary>
	/// Strip the auto-added PUBLIC line from a getter/setter DeclarationText.
	/// TwinCAT defaults accessor declarations to "PUBLIC\nVAR\nEND_VAR".
	/// Under Turkish Windows locale, TwinCAT writes "PUBLİC" (U+0130)
	/// instead of "PUBLIC" — OrdinalIgnoreCase doesn't match İ vs I, so
	/// we normalize Turkish chars first before checking.
	/// </summary>
	internal static void StripAccessorPublic(dynamic accessor)
	{
		try
		{
			string decl = BeckhoffConnection.NormalizeTurkishChars(
				(string)accessor.DeclarationText ?? "");
			if (decl.TrimStart().StartsWith("PUBLIC", StringComparison.OrdinalIgnoreCase))
			{
				var stripped = System.Text.RegularExpressions.Regex.Replace(
					decl, @"^\s*PUBLIC\s*\r?\n?", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
				accessor.DeclarationText = stripped;
			}
		}
		catch { /* COM may not support DeclarationText on some accessor types */ }
	}

	/// <summary>
	/// Find a direct child by name under a parent (non-recursive, case-insensitive).
	/// Safe for interfaces: only checks direct children, never recurses.
	/// </summary>
	internal static dynamic? FindDirectChild(dynamic parent, string childName)
	{
		try
		{
			int count = parent.ChildCount;
			for (int i = 1; i <= count; i++)
			{
				dynamic child = parent.Child[i];
				if (string.Equals((string)child.Name, childName, StringComparison.OrdinalIgnoreCase))
					return child;
			}
		}
		catch { /* COM may fail on some parent types */ }
		return null;
	}

	/// <summary>Detect if a tree item is an interface.</summary>
	internal static bool IsInterface(dynamic item)
	{
		try
		{
			int subType = (int)item.ItemSubType;
			if (subType == BlockTypeMapper.InterfaceSubType) return true;
		}
		catch { /* NestedProject items have subtype 0 */ }

		try
		{
			string decl = (string)item.DeclarationText ?? "";
			return decl.TrimStart().StartsWith("INTERFACE", StringComparison.OrdinalIgnoreCase);
		}
		catch { }

		return false;
	}

	/// <summary>Get the correct CreateChild subtype based on parent type.</summary>
	internal static int GetChildSubType(string childType, bool isInterface)
	{
		return childType switch
		{
			"action" => BlockTypeMapper.ActionSubType,
			"method" when isInterface => BlockTypeMapper.InterfaceMethodSubType,
			"method" => BlockTypeMapper.MethodSubType,
			"property" when isInterface => BlockTypeMapper.InterfacePropertySubType,
			"property" => BlockTypeMapper.PropertySubType,
			_ => throw BridgeException.BadRequest($"Unknown child type: {childType}"),
		};
	}

	/// <summary>
	/// Get the parent for creating new items.
	///
	/// `folder` is a slash-joined path RELATIVE TO THE PLC PROJECT ROOT
	/// (e.g. "POUs", "Drives/Modes"). Missing segments are CREATED on the
	/// fly via <see cref="NavigateOrCreateFolder"/> — the wire protocol
	/// addresses items by path, so requiring the client to pre-create the
	/// folder tree as a separate step would be both redundant and
	/// impossible from a git-based client (git has no folder primitive
	/// distinct from "a directory containing a file").
	///
	/// Empty/absent folder = the PLC project root.
	/// </summary>
	private dynamic GetParentFolder(string? folder)
	{
		var root = _connection.GetPlcProjectRoot();
		if (string.IsNullOrWhiteSpace(folder)) return root;
		return NavigateOrCreateFolder(root, folder);
	}

	/// <summary>
	/// Set declaration and implementation text on an item. Throws on failure.
	/// </summary>
	internal static void SetCode(dynamic item, string? declaration, string? implementation)
	{
		// null = don't touch, anything else = write (even empty, to clear old code)
		string? itemName = SafeName(item);
		if (declaration != null)
		{
			try
			{
				item.DeclarationText = declaration;
			}
			catch (Exception ex)
			{
				throw new BridgeException(500, "WRITE_FAILED",
					$"DeclarationText assignment failed: {ex.Message} | item={itemName ?? "<unknown>"} declLen={declaration.Length}");
			}
		}

		// Skip graphical language placeholder — preserve existing graphical implementation
		if (implementation != null && implementation.TrimStart().StartsWith("(graphical language"))
			return;

		if (implementation != null)
		{
			try
			{
				item.ImplementationText = implementation;
			}
			catch (Exception ex)
			{
				// COM legitimately rejects ImplementationText on graphical items
				// (FBD/LD/CFC) and on items that don't support it (interfaces,
				// property roots, action wrappers depending on TwinCAT version).
				// Log so silent rejections are visible during diagnosis, but
				// don't fail the request — caller has already filtered the
				// obvious cases via SetChildCode.
				Log.Warn($"[SetCode] ImplementationText rejected for item={itemName ?? "<unknown>"} implLen={implementation.Length}: {ex.Message}");
			}
		}
	}

	private static string? SafeName(dynamic item)
	{
		try { return (string?)item.Name; }
		catch { return null; }
	}

	/// <summary>
	/// Navigate to a subfolder under a parent item, creating folders as needed.
	/// Path supports "/" separators for multi-level nesting (e.g. "Modes/SubModes").
	/// Folders are created with subtype 601 (FolderSubType).
	/// </summary>
	internal static dynamic NavigateOrCreateFolder(dynamic parent, string folderPath)
	{
		dynamic current = parent;
		foreach (var part in folderPath.Split('/'))
		{
			var trimmed = part.Trim();
			if (string.IsNullOrEmpty(trimmed)) continue;

			// Try to find existing folder
			var existing = FindDirectChild(current, trimmed);
			if (existing != null)
			{
				current = existing;
			}
			else
			{
				// Create folder (subtype 601)
				try
				{
					current = current.CreateChild(trimmed, BlockTypeMapper.FolderSubType, "");
				}
				catch (Exception ex) when (ex.Message.Contains("already exists", StringComparison.OrdinalIgnoreCase))
				{
					// TwinCAT throws when the disk folder pre-exists — re-find the child
					current = FindDirectChild(current, trimmed)
						?? throw new BridgeException(500, "INTERNAL_ERROR",
							$"Folder '{trimmed}' was created but cannot be found");
				}
				catch (Exception ex)
				{
					throw new BridgeException(500, "COM_CALL_FAILED",
						$"CreateChild(folder): {ex.Message} | path={folderPath} segment={trimmed}");
				}
			}
		}
		return current;
	}
}
