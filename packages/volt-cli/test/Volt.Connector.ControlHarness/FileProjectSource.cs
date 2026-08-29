using System.Text.Json;
using Volt.Connector;
using Volt.Wire;
using Volt.Contracts;

/// <summary>
/// A fake <see cref="IProjectSource"/> for the e2e harness: the DATA is scripted, the DECISION is not. It re-reads
/// the scenario file on EVERY <see cref="ScanAsync"/> (so an e2e can change the scenario — single → multi-instance —
/// by rewriting the file), returns the rows for its own vendor, and keeps its own in-memory serving state that
/// <see cref="BindAsync"/>/<see cref="UnbindAsync"/> flip. That is exactly what a real source does against a live
/// bridge, minus the pipe.
///
/// <para>It replaced an inline interest→serving reconcile in <c>Program.cs</c> that was level-triggered in BOTH
/// directions ("serve iff wanted") — the OPPOSITE of the product, whose <see cref="Reconciler"/> is level-triggered
/// on bind and EDGE-triggered on unbind (a project no session ever wanted is left serving; only a wanted→unwanted
/// edge or a tray force-off gates one). Faking the data and driving the REAL <see cref="ConnectionManager"/> is the
/// only way the e2e observes the shipped decision instead of a second, divergent one.</para>
/// </summary>
sealed class FileProjectSource : IProjectSource
{
    private static readonly JsonSerializerOptions Json =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    private readonly string _viewPath;
    private readonly object _gate = new();

    // id → what THIS source was last told to serve. Absent = never bound/unbound, so the scenario file's own
    // `status` still stands (a row can be scripted as already-serving, which is how a bridge that serves by
    // default looks to the reconciler).
    private readonly Dictionary<string, bool> _serving = new(StringComparer.Ordinal);

    public FileProjectSource(string vendor, string displayName, string viewPath)
    {
        Vendor = vendor;
        DisplayName = displayName;
        _viewPath = viewPath;
    }

    public string Vendor { get; }

    public string DisplayName { get; }

    public Task<SourceScan> ScanAsync()
    {
        var rows = JsonSerializer.Deserialize<List<ProjectView>>(File.ReadAllText(_viewPath), Json) ?? new();
        lock (_gate)
        {
            var mine = rows
                .Where(r => r.Vendor == Vendor)
                .Select(r => new DetectedProject(
                    r.Id, r.DisplayName, r.Vendor, r.Dirty, new ProjectRef(r.ProjectName), r.Pipe, r.IdeVersion,
                    Status(r)))
                .ToList();
            // Always reachable: the "bridge" is a file. Zero rows here means the scenario has none, not a down pipe.
            return Task.FromResult(new SourceScan(mine, Reachable: true));
        }
    }

    private string Status(ProjectView r) =>
        !_serving.TryGetValue(r.Id, out var serving) ? r.Status
        : !serving ? HealthStatus.Idle
        // A bound row keeps a scripted `degraded` — serving with recent errors is still serving.
        : r.Status == HealthStatus.Degraded ? HealthStatus.Degraded
        : HealthStatus.Healthy;

    public Task BindAsync(DetectedProject project)
    {
        lock (_gate) _serving[project.Id] = true;
        return Task.CompletedTask;
    }

    public Task UnbindAsync(DetectedProject project)
    {
        lock (_gate) _serving[project.Id] = false;
        return Task.CompletedTask;
    }
}
