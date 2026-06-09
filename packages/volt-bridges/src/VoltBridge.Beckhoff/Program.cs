using VoltBridge.Beckhoff;
using VoltBridge.Beckhoff.Adapters;
using VoltBridge.Core;

var adapter = new BeckhoffAdapter();
var staCts = new CancellationTokenSource();
var connectDone = new ManualResetEventSlim(false);
string? connectError = null;

var staThread = new Thread(() =>
{
    ComMessageFilter.Register();
    try
    {
        adapter.TriggerAsyncProbe();
        Console.Error.WriteLine("[STA] Looking for TwinCAT XAE...");
        adapter.Connect();
        Console.Error.WriteLine($"[STA] Attached to {adapter.IdeName} {adapter.IdeVersion}");
    }
    catch (Exception ex)
    {
        connectError = ex.Message;
        Console.Error.WriteLine($"[STA] TwinCAT not running: {ex.Message}");
    }
    finally { connectDone.Set(); }

    adapter.RunStaMessageLoop(staCts.Token);
})
{
    Name = "STA-MessagePump",
    IsBackground = true
};
staThread.SetApartmentState(ApartmentState.STA);
staThread.Start();

// Wait for initial connect attempt (with timeout)
connectDone.Wait(TimeSpan.FromSeconds(10));
if (connectError != null)
    Console.WriteLine($"TwinCAT not running: {connectError}");
else if (adapter.IsConnected)
    Console.WriteLine($"Attached to {adapter.IdeName} {adapter.IdeVersion}");

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:8555");
var app = builder.Build();

app.MapGet("/health", () =>
{
    var result = adapter.BuildHealthResponse();
    return Results.Json(result, new System.Text.Json.JsonSerializerOptions
    {
        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase
    });
});

app.MapGet("/refs", () =>
{
    try
    {
        var result = adapter.RunOnStaThread(() => RefsHandler.Handle(adapter));
        return Results.Json(result);
    }
    catch (BridgeException ex) { return Results.Json(new { error = new { code = ex.ErrorCode, message = ex.Message } }, statusCode: ex.StatusCode); }
    catch (Exception ex) { return Results.Json(new { error = new { code = "INTERNAL_ERROR", message = ex.Message } }, statusCode: 500); }
});

app.MapPost("/fetch", async (HttpContext ctx) =>
{
    try
    {
        var request = await ctx.Request.ReadFromJsonAsync<VoltBridge.Core.Models.FetchRequest>();
        var result = adapter.RunOnStaThread(() => FetchHandler.Handle(adapter, request!));
        return Results.Json(result);
    }
    catch (BridgeException ex) { return Results.Json(new { error = new { code = ex.ErrorCode, message = ex.Message } }, statusCode: ex.StatusCode); }
    catch (Exception ex) { return Results.Json(new { error = new { code = "INTERNAL_ERROR", message = ex.Message } }, statusCode: 500); }
});

app.MapPost("/push", async (HttpContext ctx) =>
{
    try
    {
        var request = await ctx.Request.ReadFromJsonAsync<VoltBridge.Core.Models.PushRequest>();
        var result = adapter.RunOnStaThread(() => PushHandler.Handle(adapter, request!));
        return Results.Json(result);
    }
    catch (BridgeException ex) { return Results.Json(new { error = new { code = ex.ErrorCode, message = ex.Message } }, statusCode: ex.StatusCode); }
    catch (Exception ex) { return Results.Json(new { error = new { code = "INTERNAL_ERROR", message = ex.Message } }, statusCode: 500); }
});

app.MapPost("/build", async (HttpContext ctx) =>
{
    try
    {
        var request = await ctx.Request.ReadFromJsonAsync<VoltBridge.Core.Models.BuildRequest>();
        var result = adapter.RunOnStaThread(() => BuildHandler.Handle(adapter, request!));
        return Results.Json(result);
    }
    catch (BridgeException ex) { return Results.Json(new { error = new { code = ex.ErrorCode, message = ex.Message } }, statusCode: ex.StatusCode); }
    catch (Exception ex) { return Results.Json(new { error = new { code = "INTERNAL_ERROR", message = ex.Message } }, statusCode: 500); }
});

Console.WriteLine($"VoltBridge.Beckhoff v{adapter.Version} listening on http://127.0.0.1:8555");
app.Run();

staCts.Cancel();
staThread.Join(1000);
