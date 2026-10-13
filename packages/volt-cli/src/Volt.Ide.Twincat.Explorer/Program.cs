using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace Volt.Ide.Twincat;

/// <summary>
/// The x86 reader of a 32-bit XAE's Solution Explorer (DIALECT C2t). Two modes; the worker's side of both is
/// <c>TcHierarchy</c>, which owns the contract.
/// <list type="bullet">
/// <item><c>--serve --ide-dir &lt;dir&gt; --xae-pid &lt;pid&gt;</c>: lives as long as its stdin. Each line in is a PLC project
/// name; each line out answers it: <c>0 &lt;json&gt;</c> (that project's node, <c>null</c> when the hierarchy has none),
/// <c>2 &lt;message&gt;</c> (no proxy for this reader: XAE ships no manifest, or its proxy cannot be loaded), or
/// <c>1 &lt;message&gt;</c> (the read failed). Long-lived because a process per read cost ~450 ms where the read is
/// ~100 ms (the e2e latency gate caught it: an empty push 972 ms).</item>
/// <item><c>--check --ide-dir &lt;dir&gt;</c>: whether this process can unmarshal the hierarchy interfaces, with no call into
/// XAE. Exit 0 / 2 / 1 as above, the message on stderr.</item>
/// </list>
/// </summary>
internal static class ExplorerProgram
{
    private const int Ok = 0, Failed = 1, ProxyMissing = 2;
    private const string Usage = "usage: VoltTwincatExplorer --serve --ide-dir <dir> --xae-pid <pid> | --check --ide-dir <dir>";

    [STAThread]
    private static int Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        if (Arg(args, "--ide-dir") is not { } ideDir) { Console.Error.Write(Usage); return Failed; }
        if (Array.IndexOf(args, "--check") >= 0)
        {
            try
            {
                var (hr, what) = TcSolutionExplorer.ProxyCheck(ideDir);
                if (hr == 0) return Ok;
                Console.Error.Write($"{what} failed (0x{hr:X8})");
                return TcSolutionExplorer.IsProxyMissing(hr) ? ProxyMissing : Failed;
            }
            catch (Exception ex) { Console.Error.Write(ex.Message); return CodeOf(ex); }
        }
        if (Array.IndexOf(args, "--serve") < 0 || !int.TryParse(Arg(args, "--xae-pid"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var pid))
        { Console.Error.Write(Usage); return Failed; }

        ComMessageFilter.Register();
        object? dte = null;
        for (string? plcProject; (plcProject = Console.In.ReadLine()) != null;)
        {
            string answer;
            try
            {
                // Bound once and kept: the ROT walk is most of a fresh read's cost. Dropped on any failure, so the next
                // request binds again (TcXaeShell re-registers its DTE mid-session).
                dte ??= RotInstances.BindByPid(pid)
                        ?? throw new InvalidOperationException($"no running TwinCAT XAE with pid {pid} in the Running Object Table");
                var json = new StringBuilder();
                Write(json, TcSolutionExplorer.ReadPlcProject(dte, plcProject, ideDir));
                answer = $"{Ok} {json}";
            }
            catch (Exception ex)
            {
                if (dte is not null) { try { Marshal.ReleaseComObject(dte); } catch { /* already gone */ } }
                dte = null;
                answer = $"{CodeOf(ex)} {ex.Message.Replace('\r', ' ').Replace('\n', ' ')}";
            }
            Console.Out.WriteLine(answer);
            Console.Out.Flush();
        }
        return Ok;
    }

    private static int CodeOf(Exception ex) =>
        ex is TcSolutionExplorer.ProxyManifestMissingException
        || (ex is COMException com && TcSolutionExplorer.IsProxyMissing(com.HResult)) ? ProxyMissing : Failed;

    private static string? Arg(string[] args, string name)
    {
        var i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    private static void Write(StringBuilder s, ExplorerNode? node)
    {
        if (node is null) { s.Append("null"); return; }
        s.Append("{\"name\":"); Str(s, node.Name);
        s.Append(",\"canonical\":"); Str(s, node.Canonical);
        s.Append(",\"caption\":"); Str(s, node.Caption);
        s.Append(",\"unread\":"); Str(s, node.Unread);
        s.Append(",\"children\":[");
        for (var i = 0; i < node.Children.Count; i++)
        {
            if (i > 0) s.Append(',');
            Write(s, node.Children[i]);
        }
        s.Append("]}");
    }

    private static void Str(StringBuilder s, string? v)
    {
        if (v is null) { s.Append("null"); return; }
        s.Append('"');
        foreach (var c in v)
            switch (c)
            {
                case '"': s.Append("\\\""); break;
                case '\\': s.Append("\\\\"); break;
                default:
                    if (c < 0x20) s.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else s.Append(c);
                    break;
            }
        s.Append('"');
    }
}
