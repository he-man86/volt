using System;
using System.Linq;
using System.Runtime.InteropServices;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE SOLUTION'S PROJECTS ARE ENUMERATED ONCE PER OPERATION (openspec <c>twincat-large-solution-refs</c>). Each system
/// project's Solution Explorer read enumerated the solution's projects from the start until it met its own, reading each
/// root's name and caption: n/2 roots per read and one read per system project, O(n²) cross-process reads on the
/// customer's 18 system projects. <see cref="TcSolutionExplorer.Roots"/> enumerates on from where the last lookup
/// stopped and remembers every root it met: each root is read once per operation, whatever the order asked.
/// </summary>
public class TcHierarchyRootsTests
{
    private const uint Root = 0xFFFFFFFE;

    private sealed class SystemRoot : TcSolutionExplorer.IVsHierarchy
    {
        private readonly string _name;
        public int Reads;
        public SystemRoot(string name) => _name = name;
        public int GetProperty(uint itemid, int propid, out object? pvar) { Reads++; pvar = itemid == Root ? _name : null; return 0; }
        public int GetCanonicalName(uint itemid, out string? pbstrName) { pbstrName = ""; return 0; }
        public int GetNestedHierarchy(uint itemid, ref Guid iid, out IntPtr nested, out uint nestedId)
        { nested = IntPtr.Zero; nestedId = 0xFFFFFFFF; return unchecked((int)0x80004001); }
        public int SetSite(IntPtr psp) => 0;
        public int GetSite(out IntPtr ppsp) { ppsp = IntPtr.Zero; return 0; }
        public int QueryClose(out int pfCanClose) { pfCanClose = 1; return 0; }
        public int Close() => 0;
        public int GetGuidProperty(uint itemid, int propid, out Guid pguid) { pguid = Guid.Empty; return 0; }
        public int SetGuidProperty(uint itemid, int propid, ref Guid rguid) => 0;
        public int SetProperty(uint itemid, int propid, object var) => 0;
    }

    private sealed class Solution : TcSolutionExplorer.IOleServiceProvider, TcSolutionExplorer.IVsSolution, TcSolutionExplorer.IEnumHierarchies
    {
        public readonly SystemRoot[] Roots;
        public int Enumerations;
        private int _next;
        public Solution(int n) => Roots = Enumerable.Range(1, n).Select(k => new SystemRoot($"PLC-SA{k:00}")).ToArray();

        public int QueryService(ref Guid guidService, ref Guid riid, out IntPtr ppvObject)
        {
            ppvObject = Marshal.GetIUnknownForObject(this);
            return 0;
        }
        public int GetProjectEnum(uint grfEnumFlags, ref Guid rguidEnumOnlyThisType, out TcSolutionExplorer.IEnumHierarchies ppenum)
        {
            Enumerations++;
            _next = 0;
            ppenum = this;
            return 0;
        }
        public int Next(uint celt, TcSolutionExplorer.IVsHierarchy[] rgelt, out uint pceltFetched)
        {
            if (_next >= Roots.Length) { pceltFetched = 0; return 1; }
            rgelt[0] = Roots[_next++];
            pceltFetched = 1;
            return 0;
        }
    }

    [Fact]
    public void Every_system_projects_root_is_read_once_per_operation_in_any_order()
    {
        var solution = new Solution(18);
        var roots = new TcSolutionExplorer.Roots();

        foreach (var k in Enumerable.Range(1, 18).Reverse())
            Assert.Equal($"PLC-SA{k:00}", roots.Find(solution, $"PLC-SA{k:00}")!.Value.Name);
        Assert.Null(roots.Find(solution, "Elsewhere"));

        Assert.Equal(1, solution.Enumerations);
        Assert.All(solution.Roots, r => Assert.Equal(2, r.Reads));   // its name and its caption, once
    }
}
