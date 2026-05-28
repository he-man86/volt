using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using BeckhoffBridge.Helpers;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// POST /tree — Recursive dump of the TwinCAT tree for type-code discovery.
///
/// Diagnostic / documentation-only. Not part of volt-agent's sync surface
/// (which is PLC source code in <see cref="RefsHandler"/>). Lets a human
/// (or BlockTypeMapper.cs maintainer) see every ItemType code in the
/// project across PLC + I/O + Motion + Safety + ... — so undocumented
/// type codes can be discovered and mapped.
///
/// Request:  { "path": "TIID", "maxDepth": 4 }  // both optional
///   path     = LookupTreeItem path to start from. Omit / empty string
///              to walk ALL known TwinCAT subtrees (TIPC, TIID, TINC,
///              TICC, TISC, TIRC, TIRT, TIRR, TIAC, TIAE) — whichever
///              are present in the installed license.
///   maxDepth = recursion limit (default 3). Items deeper than this are
///              reported as <c>truncated:true</c> with their child count.
///
/// Response shape (always an object, never a bare array):
///   {
///     "roots": [
///       { "name": "TIPC", "itemType": 605, "nodeType": "...", "children": [...] },
///       { "name": "TIID", ... },
///       ...
///     ],
///     "nodeCount": 1234,    // total nodes walked
///     "unmappedCodes": [42, 67]  // any ItemType codes not in BlockTypeMapper
///   }
///
/// Skips recursion into properties (their Get/Set children crash COM on
/// interface properties — same gate as <see cref="BeckhoffConnection.FindItemByName"/>).
/// </summary>
internal sealed class TreeHandler
{
	private readonly BeckhoffConnection _connection;

	public TreeHandler(BeckhoffConnection connection)
	{
		_connection = connection;
	}

	public object Handle(JsonObject body)
	{
		if (!_connection.IsConnected) throw BridgeException.NotConnected();

		var path = body["path"]?.GetValue<string>();
		var maxDepth = body["maxDepth"]?.GetValue<int>() ?? 3;
		if (maxDepth < 0) maxDepth = 0;
		if (maxDepth > 10) maxDepth = 10; // sanity cap — TwinCAT trees can be deep

		var ctx = new WalkContext();

		var roots = new List<object>();
		if (!string.IsNullOrEmpty(path))
		{
			// Explicit starting point.
			dynamic node;
			try { node = _connection.LookupTreeItem(path); }
			catch (Exception ex) { throw BridgeException.BadRequest($"path '{path}' not found: {ex.Message}"); }
			roots.Add(WalkNode(node, maxDepth, 0, ctx));
		}
		else
		{
			// Walk all well-known top-level subtrees that are present.
			foreach (var node in _connection.GetSystemRoots())
			{
				roots.Add(WalkNode(node, maxDepth, 0, ctx));
			}
		}

		return new Dictionary<string, object?>
		{
			["roots"] = roots,
			["nodeCount"] = ctx.NodeCount,
			["unmappedCodes"] = ctx.UnmappedCodes,
		};
	}

	private object WalkNode(dynamic node, int maxDepth, int depth, WalkContext ctx)
	{
		ctx.NodeCount++;

		string name;
		try { name = (string)node.Name; }
		catch (Exception ex) { return new { error = $"Name read failed: {ex.Message}" }; }

		int itemType = -1;
		try { itemType = BeckhoffConnection.GetItemType(node); }
		catch { /* leave -1 */ }

		string nodeType = BlockTypeMapper.ToNodeType(itemType);
		if (nodeType == "unknown" && itemType >= 0 && !ctx.UnmappedCodes.Contains(itemType))
		{
			ctx.UnmappedCodes.Add(itemType);
		}

		var result = new Dictionary<string, object?>
		{
			["name"] = name,
			["itemType"] = itemType,
			["nodeType"] = nodeType,
		};

		// Properties get a SHALLOW probe instead of full recursion. Their
		// children (Get/Set accessors) are well-known leaves that don't
		// have meaningful sub-trees themselves, AND recursing into
		// interface property accessors historically crashed COM. The
		// shallow probe lists accessor name + ItemType per child without
		// reading bodies — gives us the codes (613/614/654/655) for
		// documentation purposes without risk.
		if (itemType == BlockTypeMapper.PropertySubType || itemType == BlockTypeMapper.InterfacePropertySubType)
		{
			var accessors = new List<object>();
			try
			{
				int accCount = (int)node.ChildCount;
				for (int i = 1; i <= accCount; i++)
				{
					try
					{
						dynamic acc = node.Child[i];
						int accType = -1;
						try { accType = BeckhoffConnection.GetItemType(acc); } catch { }
						string accName = "<unknown>";
						try { accName = (string)acc.Name; } catch { }
						string accNodeType = BlockTypeMapper.ToNodeType(accType);
						if (accNodeType == "unknown" && accType >= 0 && !ctx.UnmappedCodes.Contains(accType))
							ctx.UnmappedCodes.Add(accType);
						accessors.Add(new { name = accName, itemType = accType, nodeType = accNodeType });
						ctx.NodeCount++;
					}
					catch (Exception ex)
					{
						accessors.Add(new { index = i, error = ex.Message });
					}
				}
			}
			catch (Exception ex)
			{
				result["accessorEnumError"] = ex.Message;
			}
			if (accessors.Count > 0) result["accessors"] = accessors;
			return result;
		}

		int childCount = 0;
		try { childCount = (int)node.ChildCount; }
		catch { /* leaf */ }

		if (childCount == 0) return result;

		if (depth >= maxDepth)
		{
			result["truncated"] = true;
			result["childCount"] = childCount;
			return result;
		}

		var children = new List<object>(childCount);
		for (int i = 1; i <= childCount; i++)
		{
			try
			{
				dynamic child = node.Child[i];
				children.Add(WalkNode(child, maxDepth, depth + 1, ctx));
			}
			catch (Exception ex)
			{
				children.Add(new { index = i, error = ex.Message });
			}
		}
		result["children"] = children;
		return result;
	}

	private sealed class WalkContext
	{
		public int NodeCount;
		public readonly List<int> UnmappedCodes = new();
	}
}
