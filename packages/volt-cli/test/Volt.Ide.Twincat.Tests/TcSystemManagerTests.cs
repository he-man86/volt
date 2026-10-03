using System.Runtime.InteropServices;
using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// TELLING A TWINCAT PROJECT FROM ANYTHING ELSE IN THE SOLUTION.
///
/// <para><b>The loop had no way to.</b> <c>FindTwinCatProject</c> adopted <c>proj.Object</c> with
/// <c>try { _sysManager = obj; } catch { _sysManager = null; }</c> — and a dynamic-to-dynamic assignment is an
/// identity conversion the compiler emits as a bare field write, with NO runtime-binder call site. So the catch
/// could never fire, the field was never null, and both branches behind it were dead: the full-VS
/// <c>obj.SystemManager</c> fallback, and the <c>continue</c> that is the loop's only "not a TwinCAT project,
/// keep looking" exit. A solution whose first project is a C# ADS client or a TcHmi bound THAT project —
/// <c>connect</c> ok, health row GREEN — and every content op died later at
/// <c>LookupTreeItem("TIPC")</c>.</para>
///
/// <para><b>The replacement asks by capability, and the capability was measured, not assumed</b>
/// — DIALECT D35 (<c>probe-tc-project-object.ps1</c> (deleted; <c>git show b2496efb4b:packages/volt-cli/scripts/probe-tc-project-object.ps1</c>), TcXaeShell 15.0 against `TwinCAT Project14`): a real
/// <c>ITcSysManager</c> answers an unresolvable path with <c>COMException 0x98510001 "Item '…' not found"</c>,
/// immediately, with no dialog and without entering the project tree. So "can answer <c>LookupTreeItem</c>" is
/// the test — the one member the driver ever calls on a system manager, which also means it cannot rot into
/// checking something the code does not rely on.</para>
///
/// <para>These doubles are plain C# objects reached through <c>dynamic</c>, which is exactly how the driver
/// reaches the COM ones — the binder does the same work either way.</para>
/// </summary>
public class TcSystemManagerTests
{
    /// <summary>What TcXaeShell hands over: the project's <c>.Object</c> IS the system manager.</summary>
    public sealed class SysManager
    {
        public object LookupTreeItem(string path) =>
            throw new COMException($"Item '{path}' not found", unchecked((int)0x98510001));
    }

    /// <summary>Any other project in the solution — a C# client, a TcHmi. No <c>LookupTreeItem</c> at all,
    /// which is the whole difference.</summary>
    public sealed class OtherProject
    {
        public string Name => "AdsClient";
    }

    /// <summary>The full-VS shape the dead fallback was written for: the manager hangs off the project.</summary>
    public sealed class VsProject
    {
        public object SystemManager { get; } = new SysManager();
    }

    [Fact]
    public void A_system_manager_is_recognised()
    {
        Assert.True(TcSystemManager.Is(new SysManager()));
    }

    /// <summary>THE REGRESSION. Before the fix this object was adopted whole and served as the project.</summary>
    [Fact]
    public void A_project_that_is_not_a_system_manager_is_rejected()
    {
        Assert.False(TcSystemManager.Is(new OtherProject()));
    }

    /// <summary>Null is not a manager — a COM object hands back NULL for a member it does not have (measured in
    /// the same probe), so an absent <c>SystemManager</c> arrives here rather than as an exception.</summary>
    [Fact]
    public void Null_is_not_a_system_manager()
    {
        Assert.False(TcSystemManager.Is(null));
    }

    /// <summary>A manager that RESOLVES the probe path is still a manager. The probe is about the member
    /// answering, not about the answer — a tree that somehow held that path must not read as "not TwinCAT".</summary>
    [Fact]
    public void A_manager_that_answers_the_probe_path_is_still_a_manager()
    {
        Assert.True(TcSystemManager.Is(new Resolves()));
    }

    public sealed class Resolves
    {
        public object LookupTreeItem(string path) => new object();
    }

    /// <summary>And the verdict does not hang on the measured HRESULT. A vendor that changes its not-found code
    /// still HAS the member, so it still reads as a manager — the fix degrades to the old behaviour on a version
    /// bump rather than to a refusal to connect.</summary>
    [Fact]
    public void A_different_COM_failure_still_means_the_member_is_there()
    {
        Assert.True(TcSystemManager.Is(new OtherHResult()));
    }

    public sealed class OtherHResult
    {
        public object LookupTreeItem(string path) =>
            throw new COMException("something else entirely", unchecked((int)0x80004005));
    }
    /// <summary>THE FULL-VS SHAPE, reachable at last. The project object is not a manager itself but hangs one
    /// off <c>SystemManager</c> — the case the dead fallback was written for and never reached.</summary>
    [Fact]
    public void A_nested_system_manager_is_found()
    {
        Assert.False(TcSystemManager.Is(new VsProject()));
        Assert.NotNull(TcSystemManager.Nested(new VsProject()));
    }

    /// <summary>But not on anything that merely HAS the member: presence proves nothing, because a COM object
    /// answers null for a member it does not have, and a non-manager value must not be adopted.</summary>
    [Fact]
    public void A_SystemManager_that_is_not_one_is_not_adopted()
    {
        Assert.Null(TcSystemManager.Nested(new OtherProject()));
        Assert.Null(TcSystemManager.Nested(new FakeManagerHolder()));
    }

    public sealed class FakeManagerHolder
    {
        public object SystemManager { get; } = new OtherProject();
    }
}
