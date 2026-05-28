using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using BeckhoffBridge.Helpers;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// Internal helper. The public wire surface is `POST /fetch`, which is
/// served by <see cref="FetchHandler"/>; FetchHandler calls
/// <see cref="BuildResult"/> here to serialize each changed item.
///
/// Retrieves POU/GVL/DUT/Interface data with separate `declaration` and
/// `implementation` fields. Children use the same split format, with
/// `getterCode`/`setterCode` for properties. Type is auto-detected from
/// the declaration header — the caller only sends `name`.
///
/// The instance <see cref="Handle"/> method is retained for ad-hoc debug
/// use (e.g. via the <c>/debug</c> endpoint) but is no longer routed.
/// </summary>
internal sealed class GetHandler
{
	private readonly BeckhoffConnection _connection;

	public GetHandler(BeckhoffConnection connection)
	{
		_connection = connection;
	}

	public object Handle(JsonObject body)
	{
		if (!_connection.IsConnected) throw BridgeException.NotConnected();

		var name = body["name"]?.GetValue<string>()
			?? throw BridgeException.BadRequest("Missing 'name' field");

		// Find item by name (names are unique across the project)
		var item = _connection.FindItemOrThrow(name, "item");
		return BuildResult(_connection, name, item);
	}

	/// <summary>
	/// Build an AIGetResult-shaped dictionary for a single project item.
	/// Shared between `/get` (one item by name) and `/readAll` (every top-level).
	/// </summary>
	public static Dictionary<string, object?> BuildResult(
		BeckhoffConnection connection, string name, dynamic item)
	{
		// Read declaration to determine type
		string declaration = BeckhoffConnection.ReadDeclaration(item);
		var header = CodeHelper.ParseCodeHeader(declaration);

		var result = header.Type switch
		{
			"function_block" or "function" or "program" => GetPou(connection, name, item, declaration),
			"gvl" => GetGvl(connection, name, declaration),
			"structure" or "enumeration" or "union" or "alias" => GetDut(connection, name, declaration),
			"interface" => GetInterface(connection, name, item, declaration),
			_ => throw BridgeException.BadRequest($"Unknown type detected from header: {header.Type}"),
		};

		// Vendor-neutral kind string — the canonical name every bridge
		// (Beckhoff today, CODESYS / TIA next) translates its native
		// type code to. Clients branch on this without knowing anything
		// about TwinCAT ItemType codes specifically.
		try
		{
			int code = BeckhoffConnection.GetItemType(item);
			result["kind"] = BlockTypeMapper.ToNodeType(code);
		}
		catch { /* leave field absent on read failure */ }
		return result;
	}

	private static Dictionary<string, object?> GetPou(BeckhoffConnection connection, string name, dynamic item, string declaration)
	{
		string implementation = BeckhoffConnection.ReadImplementation(item)?.Trim() ?? "";
		var children = BuildChildrenList(name, item);
		string language = DetectLanguage(implementation);

		var result = new Dictionary<string, object?>
		{
			["name"] = name,
			["declaration"] = declaration.Trim(),
			["language"] = language,
		};
		AttachParentPath(connection, result, name);
		// Mask graphical bodies with a placeholder so AI clients without
		// a graphical-language LSP can't accidentally clobber them with
		// text edits. The `language` field above tells the caller WHICH
		// language is being masked, so once an LSP exists we can drop
		// the mask cleanly without breaking the protocol.
		if (language != "ST")
			result["implementation"] = "(graphical language — not visible or editable as text)";
		else if (!string.IsNullOrEmpty(implementation))
			result["implementation"] = implementation;
		if (children != null) result["children"] = children;

		return result;
	}

	private static Dictionary<string, object?> GetGvl(BeckhoffConnection connection, string name, string declaration)
	{
		var result = new Dictionary<string, object?>
		{
			["name"] = name,
			["declaration"] = declaration.Trim(),
		};
		AttachParentPath(connection, result, name);
		return result;
	}

	private static Dictionary<string, object?> GetDut(BeckhoffConnection connection, string name, string declaration)
	{
		var result = new Dictionary<string, object?>
		{
			["name"] = name,
			["declaration"] = declaration.Trim(),
		};
		AttachParentPath(connection, result, name);
		return result;
	}

	private static Dictionary<string, object?> GetInterface(BeckhoffConnection connection, string name, dynamic item, string declaration)
	{
		// Build flat children list — flag interface to skip property child enumeration
		var children = BuildChildrenList(name, item, parentIsInterface: true);

		var result = new Dictionary<string, object?>
		{
			["name"] = name,
			["declaration"] = declaration.Trim(),
		};
		AttachParentPath(connection, result, name);
		if (children != null) result["children"] = children;

		return result;
	}

	/// <summary>
	/// Record the slash-joined folder path (e.g. "POUs/Motors") of a
	/// top-level item on the result dict. Uses the connection's existing
	/// `FindRelativePath` walker which descends from the NestedProject
	/// root via <c>Child[i]</c> — reliable regardless of whether the item
	/// itself was obtained via <c>LookupTreeItem</c> (whose <c>.Parent</c>
	/// property on a path-based item isn't guaranteed to link back into
	/// the NestedProject hierarchy). Silent on errors — missing
	/// folder is acceptable, wrong folder is not.
	/// </summary>
	private static void AttachParentPath(BeckhoffConnection connection, Dictionary<string, object?> result, string name)
	{
		try
		{
			var root = connection.GetPlcProjectRoot();
			string? relPath = connection.FindRelativePath(root, name);
			if (string.IsNullOrEmpty(relPath)) return;
			// `FindRelativePath` returns "Folder1^Folder2^ItemName" using
			// TwinCAT's `^` separator. Drop the trailing item name and
			// re-join with `/` to match the unified wire format.
			var segments = relPath.Split('^');
			if (segments.Length <= 1) return; // item sits at project root
			var folderPath = string.Join("/", segments, 0, segments.Length - 1);
			if (!string.IsNullOrEmpty(folderPath))
				result["folder"] = folderPath;
		}
		catch { /* best-effort */ }
	}

	/// <summary>
	/// Build a flat children array with separate declaration/implementation fields.
	/// Recurses into folders so that code items nested in organizational folders
	/// are included in the flat list.
	/// Methods: { name, declaration, implementation }
	/// Actions: { name, declaration, implementation }
	/// Properties: { name, declaration, getterCode?, setterCode? }
	/// </summary>
	private static List<Dictionary<string, object?>>? BuildChildrenList(
		string parentName, dynamic parent, bool parentIsInterface = false)
	{
		var children = new List<Dictionary<string, object?>>();
		CollectChildren(parent, children, parentIsInterface, "");
		return children.Count > 0 ? children : null;
	}

	private static void CollectChildren(dynamic parent, List<Dictionary<string, object?>> children, bool parentIsInterface, string folderPath)
	{
		try
		{
			int count = parent.ChildCount;
			for (int i = 1; i <= count; i++)
			{
				try
				{
					dynamic child = parent.Child[i];
					string childName = (string)child.Name;

					// Single source of truth — see BlockTypeMapper for why
					// ItemSubType is the wrong property to read.
					int itemType = BeckhoffConnection.GetItemType(child);

					// Folder → recurse with a folder crumb so flat children
					// can still report which folder they lived in.
					if (itemType == BlockTypeMapper.FolderSubType)
					{
						var subPath = string.IsNullOrEmpty(folderPath) ? childName : $"{folderPath}/{childName}";
						CollectChildren(child, children, parentIsInterface, subPath);
						continue;
					}

					string declaration = BeckhoffConnection.ReadDeclaration(child);
					string implementation = BeckhoffConnection.ReadImplementation(child);

					bool isMethod = itemType == BlockTypeMapper.MethodSubType
						|| itemType == BlockTypeMapper.InterfaceMethodSubType;
					bool isAction = itemType == BlockTypeMapper.ActionSubType;
					bool isProperty = itemType == BlockTypeMapper.PropertySubType
						|| itemType == BlockTypeMapper.InterfacePropertySubType;

					bool isInterfaceProperty = itemType == BlockTypeMapper.InterfacePropertySubType
						|| (parentIsInterface && isProperty);

					if (!isMethod && !isAction && !isProperty)
					{
						// Unknown / unhandled kind — skip rather than misclassify.
						// /debug the item, then add to BlockTypeMapper if it's a
						// real kind we should surface here.
						continue;
					}

					if (isMethod)
					{
						string methodImpl = implementation?.Trim() ?? "";
						string methodLang = DetectLanguage(methodImpl);
						var entry = new Dictionary<string, object?>
						{
							["name"] = childName,
							["declaration"] = declaration.Trim(),
							["language"] = methodLang,
						};
						if (methodLang != "ST")
							entry["implementation"] = "(graphical language — not visible or editable as text)";
						else if (!string.IsNullOrEmpty(methodImpl))
							entry["implementation"] = methodImpl;
						if (!string.IsNullOrEmpty(folderPath))
							entry["folder"] = folderPath;
						children.Add(entry);
					}
					else if (isAction)
					{
						string actionImpl = implementation?.Trim() ?? "";
						string actionLang = DetectLanguage(actionImpl);
						var entry = new Dictionary<string, object?>
						{
							["name"] = childName,
							["declaration"] = $"ACTION {childName}",
							["language"] = actionLang,
						};
						if (actionLang != "ST")
							entry["implementation"] = "(graphical language — not visible or editable as text)";
						else if (!string.IsNullOrEmpty(actionImpl))
							entry["implementation"] = actionImpl;
						if (!string.IsNullOrEmpty(folderPath))
							entry["folder"] = folderPath;
						children.Add(entry);
					}
					else if (isProperty)
					{
						var entry = new Dictionary<string, object?>
						{
							["name"] = childName,
							["declaration"] = declaration.Trim(),
						};

						if (isInterfaceProperty)
						{
							// Interface properties: check which accessors exist
							// (no implementation code — just empty strings to signal presence)
							try
							{
								int propChildCount = child.ChildCount;
								for (int j = 1; j <= propChildCount; j++)
								{
									try
									{
										dynamic accessor = child.Child[j];
										string accName = ((string)accessor.Name).ToLowerInvariant();
										if (accName == "get") entry["getterCode"] = "";
										else if (accName == "set") entry["setterCode"] = "";
									}
									catch { /* skip inaccessible accessor */ }
								}
							}
							catch (Exception ex)
							{
								Log.Warn($"[Get] Warning: failed to enumerate accessors for interface property '{childName}': {ex.Message}");
							}
						}
						else
						{
							// POU properties: read accessor children
							try
							{
								int propChildCount = child.ChildCount;
								for (int j = 1; j <= propChildCount; j++)
								{
									try
									{
										dynamic accessor = child.Child[j];
										string accName = ((string)accessor.Name).ToLowerInvariant();
										if (accName == "get" || accName == "set")
										{
											string accImpl = BeckhoffConnection.ReadImplementation(accessor);
											string implKey = accName == "get" ? "getterCode" : "setterCode";
											entry[implKey] = accImpl?.Trim() ?? "";

											// Read accessor declaration (VAR blocks)
											// Skip empty VAR blocks (TwinCAT default: "VAR\nEND_VAR")
											try
											{
												string accDecl = BeckhoffConnection.ReadDeclaration(accessor)?.Trim() ?? "";
												if (!string.IsNullOrEmpty(accDecl) && !IsEmptyVarBlock(accDecl))
												{
													string declKey = accName == "get" ? "getterDeclaration" : "setterDeclaration";
													entry[declKey] = accDecl;
												}
											}
											catch { /* COM may not support DeclarationText on some accessor types */ }
										}
									}
									catch { /* skip inaccessible accessor */ }
								}
							}
							catch { /* no accessor children */ }
						}

						if (!string.IsNullOrEmpty(folderPath))
							entry["folder"] = folderPath;
						children.Add(entry);
					}
				}
				catch { /* skip inaccessible children */ }
			}
		}
		catch { /* ignore */ }
	}

	private static string DetectLanguage(string impl) => LanguageDetector.Detect(impl);

	/// <summary>
	/// Check if a declaration is just an empty VAR block (TwinCAT default for accessors).
	/// Matches "VAR\nEND_VAR" with optional whitespace — no actual variables declared.
	/// </summary>
	private static bool IsEmptyVarBlock(string decl)
	{
		// Strip all whitespace and check if it's just VAREND_VAR
		var stripped = System.Text.RegularExpressions.Regex.Replace(decl, @"\s+", "");
		return string.Equals(stripped, "VAREND_VAR", StringComparison.OrdinalIgnoreCase);
	}
}
