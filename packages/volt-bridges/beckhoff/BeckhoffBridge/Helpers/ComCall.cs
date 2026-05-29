using System;
using System.Linq;

namespace BeckhoffBridge.Helpers;

/// <summary>
/// Wraps a single TwinCAT COM dispatch so that the resulting BridgeException
/// names the call site and the inputs that produced it.
///
/// Bare <c>dynamic</c> calls into TwinCAT COM (CreateChild, DeleteChild,
/// DeclarationText/ImplementationText assignment, item.Name = ...) surface
/// raw .NET messages with zero context — e.g. "Value was either too large
/// or too small for a UInt32." with no hint about which item, which method,
/// or which parameter. That's the kind of report that's impossible to
/// reproduce or fix.
///
/// Wrap each dispatch with <see cref="Invoke{T}"/> / <see cref="Invoke"/>
/// and pass the call site name + the relevant inputs. The wrapper rethrows
/// as a 500 BridgeException whose message is "{site}: {original} | k=v k=v".
/// </summary>
internal static class ComCall
{
	public static T Invoke<T>(string site, Func<T> call, params (string Key, object? Value)[] context)
	{
		try { return call(); }
		catch (BridgeException) { throw; }
		catch (Exception ex)
		{
			throw new BridgeException(500, "COM_CALL_FAILED", FormatMessage(site, ex, context), ex);
		}
	}

	public static void Invoke(string site, Action call, params (string Key, object? Value)[] context)
	{
		try { call(); }
		catch (BridgeException) { throw; }
		catch (Exception ex)
		{
			throw new BridgeException(500, "COM_CALL_FAILED", FormatMessage(site, ex, context), ex);
		}
	}

	private static string FormatMessage(string site, Exception ex, (string Key, object? Value)[] context)
	{
		var ctx = context.Length == 0
			? ""
			: " | " + string.Join(" ", context.Select(p => $"{p.Key}={Format(p.Value)}"));
		return $"{site}: {ex.Message}{ctx}";
	}

	private static string Format(object? v) => v switch
	{
		null => "<null>",
		string s => s.Length == 0 ? "''" : s,
		_ => v.ToString() ?? "<null>",
	};
}
