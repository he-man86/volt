using System.Text.Json;
using System.Text.Json.Serialization;
using Volt.Cli.Core.Wire;

namespace Volt.Cli.Sync;

/// <summary>CLI progress reporter — streamed ProgressFrames → stderr (stdout stays clean for --json). A GUI host
/// sets VOLT_PROGRESS_JSON=1 to get structured frames it parses; humans/AI get throttled text. C# port of
/// the original TypeScript implementation</summary>
public static class Reporter
{
    private const string ProgressJsonPrefix = "VOLT_PROGRESS ";
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static Action<ProgressFrame> Create()
    {
        if (Environment.GetEnvironmentVariable("VOLT_PROGRESS_JSON") == "1")
            return p => Console.Error.Write(ProgressJsonPrefix + JsonSerializer.Serialize(p, Json) + "\n");

        var lastBucket = -1;
        var lastLabel = "";
        return p =>
        {
            int? pct = p.Total is > 0 ? (int)Math.Floor((double)p.Done / p.Total.Value * 100) : null;
            var label = p.Phase ?? p.Operation;
            var line = pct is not null ? $"{label}: {p.Done}/{p.Total} ({pct}%)" : $"{label}…";
            var bucket = pct ?? -1;
            if (bucket / 10 != lastBucket / 10 || label != lastLabel)
            {
                Console.Error.WriteLine(line);
                lastBucket = bucket;
                lastLabel = label;
            }
        };
    }
}
