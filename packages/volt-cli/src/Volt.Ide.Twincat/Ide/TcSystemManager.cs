using System.Runtime.InteropServices;

namespace Volt.Ide.Twincat;

/// <summary>
/// IS THIS SOLUTION PROJECT A TWINCAT ONE? The question <c>FindTwinCatProject</c> could not ask.
///
/// <para>That loop adopted <c>proj.Object</c> with <c>try { _sysManager = obj; } catch { _sysManager = null; }</c>
/// — and a dynamic-to-dynamic assignment is an identity conversion the compiler emits as a bare field write,
/// with NO runtime-binder call site. The catch could never fire, the field was never null, and both branches
/// behind it were dead: the full-VS <c>obj.SystemManager</c> fallback, and the <c>continue</c> that is the
/// loop's only "not a TwinCAT project, keep looking" exit. So a solution whose first project is a C# ADS client
/// or a TcHmi bound THAT project — <c>connect</c> ok, a GREEN health row — and every content op died later at
/// <c>LookupTreeItem("TIPC")</c> with an opaque "Cannot find PLC project under TIPC".</para>
///
/// <para><b>Asked by CAPABILITY, not by type name or project GUID.</b> <c>LookupTreeItem</c> is the only member
/// the driver ever calls on a system manager, so "can answer that" is exactly the property being relied on —
/// and it survives a TwinCAT version bump that renames a project kind.</para>
///
/// <para><b>Measured, not assumed</b> — DIALECT D35 (<c>probe-tc-project-object.ps1</c> (deleted; <c>git show b2496efb4b:packages/volt-cli/scripts/probe-tc-project-object.ps1</c>), TcXaeShell
/// 15.0 against `TwinCAT Project14`): a real <c>ITcSysManager</c> answers an unresolvable path immediately with
/// <c>COMException 0x98510001 "Item '…' not found"</c> — the same HRESULT D29a records — with no dialog, no
/// tree walk and the empty string behaving the same; and a COM object hands back NULL for a member it does not
/// have, rather than throwing, which is why presence alone proves nothing.</para>
/// </summary>
internal static class TcSystemManager
{
    /// <summary>A path no tree can hold, so the probe asks whether the object can ANSWER without entering any
    /// project. select/health must stay out of the PLC tree; this does.</summary>
    private const string ProbePath = "VOLT^PROBE^NO^SUCH^PATH";

    /// <summary>Is <paramref name="obj"/> a TwinCAT system manager?
    ///
    /// <para>The split is between the member being ABSENT and the member REFUSING: a binder failure means this
    /// object has no <c>LookupTreeItem</c> at all — not a system manager — while a COM fault means it has one
    /// and turned down the path, which is the answer. Deliberately NOT keyed on the measured HRESULT, so a
    /// vendor that changes its not-found code degrades to the old adopt-anyway behaviour rather than to a
    /// refusal to connect.</para></summary>
    public static bool Is(dynamic? obj)
    {
        if (obj is null) return false;
        try { obj.LookupTreeItem(ProbePath); return true; }   // resolving it would still make it a manager
        catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { return false; }
        catch (COMException) { return true; }
        catch { return false; }
    }

    /// <summary>The full-VS shape: the project object is not the manager but hangs one off
    /// <c>SystemManager</c>. Null unless that member is there AND answers as a manager — its mere presence
    /// proves nothing, because a COM object returns null for a member it does not have.</summary>
    public static dynamic? Nested(dynamic obj)
    {
        dynamic? nested;
        try { nested = obj.SystemManager; } catch { return null; }
        return Is(nested) ? nested : null;
    }
}
