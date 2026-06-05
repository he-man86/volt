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
	/// Build a result dictionary for a single project item — internal
	/// shape with separate {declaration, implementation, children}
	/// fields that FetchHandler then runs through StAssembler to
	/// produce the unified `sourceText` on the wire.
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
		string language = DetectLanguage(implementation);
		// Walk children with the connection so the graphical-children
		// branch can call `ExportItemBodyAsXml` for canonical body XML
		// (TwinCAT's `PlcOpenExport` is the authoritative source for a
		// member's body language — same role `plcopen_xml.extract_self_
		// member_body` plays for CODESYS). Returns BOTH textual children
		// (folded into sourceText via StAssembler) and graphical
		// children (emitted separately on the wire as read-only).
		// `item` is dynamic → BuildChildrenList call is late-bound,
		// return value behaves as dynamic at runtime. Record properties
		// work over dynamic dispatch; named-tuple labels would NOT
		// (DLR sees through to Item1/Item2). See ChildrenSplit.
		var childResult = BuildChildrenList(connection, item);
		var textualChildren = childResult.Textual;
		var graphicalChildren = childResult.Graphical;

		var result = new Dictionary<string, object?>
		{
			["name"] = name,
			["declaration"] = declaration.Trim(),
			["language"] = language,
		};
		AttachParentPath(connection, result, name);
		// Top-level POU body: ST gets folded into sourceText as today.
		// Graphical bodies leave `implementation` empty here — the wire
		// payload carries the body separately via `implementationXml`
		// (FetchHandler attaches it via `ExportItemBodyAsXml`). No
		// placeholder text — the agent owns rendering the workspace
		// file from the XML.
		if (language == "ST" && !string.IsNullOrEmpty(implementation))
			result["implementation"] = implementation;
		if (textualChildren != null) result["children"] = textualChildren;
		if (graphicalChildren != null) result["graphicalChildren"] = graphicalChildren;

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
		// Build flat children list — flag interface to skip property child enumeration.
		// `item` is dynamic → call is late-bound; record property access works through
		// dynamic dispatch (named-tuple labels would not). Interfaces never carry
		// graphical children — discard that bucket.
		var childResult = BuildChildrenList(connection, item, parentIsInterface: true);
		var children = childResult.Textual;

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
	/// Return value of <see cref="BuildChildrenList"/>. A record (not a
	/// named ValueTuple) because callers pass <c>dynamic</c> arguments —
	/// the resulting call site is late-bound, so the named tuple
	/// labels disappear at runtime (the DLR sees only Item1/Item2). A
	/// record exposes real CLR properties that work over dynamic
	/// dispatch.
	/// </summary>
	private sealed record ChildrenSplit(
		List<Dictionary<string, object?>>? Textual,
		List<Dictionary<string, object?>>? Graphical);

	/// <summary>
	/// Build two flat children lists from a parent POU/interface:
	///
	/// <list type="bullet">
	///   <item><description><b>textual</b> — ST methods/actions and properties.
	///   Get folded into the parent's assembled sourceText by StAssembler.</description></item>
	///   <item><description><b>graphical</b> — FBD/LD/SFC/CFC methods/actions.
	///   Surfaced separately on the wire via `graphicalChildren` so the
	///   agent can materialize each as a read-only sibling file
	///   (`&lt;parent_name&gt;/&lt;child_name&gt;.&lt;lang_ext&gt;`).
	///   The body XML comes from `PlcOpenExport` (canonical TwinCAT
	///   format) via <see cref="BeckhoffConnection.ExportItemBodyAsXml"/>.</description></item>
	/// </list>
	///
	/// Recurses into folder children so organizational folders inside a POU
	/// flatten transparently. Returns (null, null) when there are no
	/// children at all; null on either side individually when that bucket
	/// is empty.
	/// </summary>
	private static ChildrenSplit BuildChildrenList(
		BeckhoffConnection connection, dynamic parent, bool parentIsInterface = false)
	{
		var textual = new List<Dictionary<string, object?>>();
		var graphical = new List<Dictionary<string, object?>>();
		CollectChildren(connection, parent, textual, graphical, parentIsInterface, "");
		return new ChildrenSplit(
			textual.Count > 0 ? textual : null,
			graphical.Count > 0 ? graphical : null
		);
	}

	private static void CollectChildren(BeckhoffConnection connection, dynamic parent, List<Dictionary<string, object?>> children, List<Dictionary<string, object?>> graphicalChildren, bool parentIsInterface, string folderPath)
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
						CollectChildren(connection, child, children, graphicalChildren, parentIsInterface, subPath);
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
						if (methodLang == "FBD" || methodLang == "LD" || methodLang == "SFC" || methodLang == "CFC")
						{
							// Graphical method — export canonical body XML via
							// TC's `PlcOpenExport` and surface separately.
							// Wire schema is strict; only the fields the agent's
							// `GraphicalChildSchema` accepts go on this entry.
							var bodyXml = connection.ExportItemBodyAsXml(child, childName);
							if (string.IsNullOrEmpty(bodyXml))
							{
								Log.Warn($"[Get] graphical method '{childName}' under parent: PlcOpenExport returned empty; skipping");
								continue;
							}
							graphicalChildren.Add(new Dictionary<string, object?>
							{
								["name"] = childName,
								["kind"] = "method",
								["language"] = methodLang,
								["declaration"] = declaration.Trim(),
								["implementationXml"] = bodyXml,
							});
						}
						else
						{
							// Textual (ST) method — fold into parent sourceText.
							var entry = new Dictionary<string, object?>
							{
								["name"] = childName,
								["kind"] = "method",
								["declaration"] = declaration.Trim(),
								["language"] = methodLang,
							};
							if (!string.IsNullOrEmpty(methodImpl))
								entry["implementation"] = methodImpl;
							if (!string.IsNullOrEmpty(folderPath))
								entry["folder"] = folderPath;
							children.Add(entry);
						}
					}
					else if (isAction)
					{
						string actionImpl = implementation?.Trim() ?? "";
						string actionLang = DetectLanguage(actionImpl);
						if (actionLang == "FBD" || actionLang == "LD" || actionLang == "SFC" || actionLang == "CFC")
						{
							var bodyXml = connection.ExportItemBodyAsXml(child, childName);
							if (string.IsNullOrEmpty(bodyXml))
							{
								Log.Warn($"[Get] graphical action '{childName}' under parent: PlcOpenExport returned empty; skipping");
								continue;
							}
							graphicalChildren.Add(new Dictionary<string, object?>
							{
								["name"] = childName,
								["kind"] = "action",
								["language"] = actionLang,
								["declaration"] = $"ACTION {childName}",
								["implementationXml"] = bodyXml,
							});
						}
						else
						{
							var entry = new Dictionary<string, object?>
							{
								["name"] = childName,
								["kind"] = "action",
								["declaration"] = $"ACTION {childName}",
								["language"] = actionLang,
							};
							if (!string.IsNullOrEmpty(actionImpl))
								entry["implementation"] = actionImpl;
							if (!string.IsNullOrEmpty(folderPath))
								entry["folder"] = folderPath;
							children.Add(entry);
						}
					}
					else if (isProperty)
					{
						var entry = new Dictionary<string, object?>
						{
							["name"] = childName,
							["kind"] = "property",
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
