using VoltBridge.Codesys;
using VoltBridge.Codesys.Adapters;
using VoltBridge.Core;
using VoltBridge.Core.Models;

var adapter = new CodesysAdapter();

Console.WriteLine($"[CODESYS] Connecting...");
adapter.Connect();
Console.WriteLine($"[CODESYS] Connected to {adapter.IdeName} {adapter.IdeVersion}");

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:8556");
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "VoltBridge CODESYS", Version = "v1" });
    c.SchemaFilter<PolymorphicSchemaFilter>();
});
var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "VoltBridge CODESYS v1"));

app.MapGet("/health", () =>
{
    var result = adapter.BuildHealthResponse();
    return Results.Json(result, new System.Text.Json.JsonSerializerOptions
    {
        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase
    });
});

// ── Non-/health gate ──────────────────────────────────────────────

static Microsoft.AspNetCore.Http.IResult DegradedGate(CodesysAdapter adapter, string path)
{
    if (!adapter.IsDegraded) return null!;
    return Results.Json(
        new { error = new { code = "PLC_DEGRADED", message = adapter.DegradedReason ?? "COM channel degraded" } },
        statusCode: 503);
}

static void MarkDegradedOnRpc(CodesysAdapter adapter, Exception ex, string path)
{
    if (IsRpcFailure(ex))
        adapter.MarkDegraded($"{path}: {ex.Message}");
}

static bool IsRpcFailure(Exception? ex)
{
    for (var e = ex; e != null; e = e.InnerException)
    {
        if (e is System.Runtime.InteropServices.COMException com)
        {
            var hr = unchecked((uint)com.HResult);
            if (hr == 0x800706BAu) return true;
            if (hr == 0x800706BEu || hr == 0x800706BFu) return true;
            if ((hr & 0xFFFFFF00u) == 0x80010100u) return true;
            if (hr == 0x80010001u || hr == 0x80010108u || hr == 0x8001010Au) return true;
        }
    }
    return false;
}

app.MapGet("/refs", () =>
{
    var gate = DegradedGate(adapter, "/refs");
    if (gate != null) return gate;
    try
    {
        var result = adapter.RunOnStaThread(() => RefsHandler.Handle(adapter));
        return Results.Json(result);
    }
    catch (BridgeException ex) { MarkDegradedOnRpc(adapter, ex.Cause ?? ex, "/refs"); return Results.Json(new { error = new { code = ex.ErrorCode, message = ex.Message } }, statusCode: ex.StatusCode); }
    catch (Exception ex) { MarkDegradedOnRpc(adapter, ex, "/refs"); return Results.Json(new { error = new { code = "INTERNAL_ERROR", message = ex.Message } }, statusCode: 500); }
});

app.MapPost("/fetch", (FetchRequest request) =>
{
    var gate = DegradedGate(adapter, "/fetch");
    if (gate != null) return gate;
    try
    {
        var result = adapter.RunOnStaThread(() => FetchHandler.Handle(adapter, request));
        return Results.Json(result);
    }
    catch (BridgeException ex) { MarkDegradedOnRpc(adapter, ex.Cause ?? ex, "/fetch"); return Results.Json(new { error = new { code = ex.ErrorCode, message = ex.Message } }, statusCode: ex.StatusCode); }
    catch (Exception ex) { MarkDegradedOnRpc(adapter, ex, "/fetch"); return Results.Json(new { error = new { code = "INTERNAL_ERROR", message = ex.Message } }, statusCode: 500); }
});

app.MapPost("/push", (PushRequest request) =>
{
    var gate = DegradedGate(adapter, "/push");
    if (gate != null) return gate;
    try
    {
        var result = adapter.RunOnStaThread(() => PushHandler.Handle(adapter, request));
        return Results.Json(result);
    }
    catch (BridgeException ex) { MarkDegradedOnRpc(adapter, ex.Cause ?? ex, "/push"); return Results.Json(new { error = new { code = ex.ErrorCode, message = ex.Message } }, statusCode: ex.StatusCode); }
    catch (Exception ex) { MarkDegradedOnRpc(adapter, ex, "/push"); return Results.Json(new { error = new { code = "INTERNAL_ERROR", message = ex.Message } }, statusCode: 500); }
});

app.MapPost("/build", (BuildRequest request) =>
{
    var gate = DegradedGate(adapter, "/build");
    if (gate != null) return gate;
    try
    {
        var result = adapter.RunOnStaThread(() => BuildHandler.Handle(adapter, request));
        return Results.Json(result);
    }
    catch (BridgeException ex) { MarkDegradedOnRpc(adapter, ex.Cause ?? ex, "/build"); return Results.Json(new { error = new { code = ex.ErrorCode, message = ex.Message } }, statusCode: ex.StatusCode); }
    catch (Exception ex) { MarkDegradedOnRpc(adapter, ex, "/build"); return Results.Json(new { error = new { code = "INTERNAL_ERROR", message = ex.Message } }, statusCode: 500); }
});

Console.WriteLine($"VoltBridge.Codesys v{adapter.Version} listening on http://127.0.0.1:8556");
try { app.Run(); }
catch (IOException ex) when (ex.InnerException is System.Net.Sockets.SocketException)
{
    Console.Error.WriteLine($"Port 8556 already in use — is another bridge instance running?");
}

// ── Swagger Schema Filter ─────────────────────────────────────────

class PolymorphicSchemaFilter : Swashbuckle.AspNetCore.SwaggerGen.ISchemaFilter
{
    public void Apply(Microsoft.OpenApi.Models.OpenApiSchema schema, Swashbuckle.AspNetCore.SwaggerGen.SchemaFilterContext context)
    {
        var poly = (System.Text.Json.Serialization.JsonPolymorphicAttribute?)
            Attribute.GetCustomAttribute(context.Type, typeof(System.Text.Json.Serialization.JsonPolymorphicAttribute));
        if (poly == null) return;

        var derived = Attribute.GetCustomAttributes(context.Type, typeof(System.Text.Json.Serialization.JsonDerivedTypeAttribute))
            .Cast<System.Text.Json.Serialization.JsonDerivedTypeAttribute>()
            .ToList();
        if (derived.Count == 0) return;

        schema.Discriminator = new Microsoft.OpenApi.Models.OpenApiDiscriminator
        {
            PropertyName = poly.TypeDiscriminatorPropertyName ?? "$type",
            Mapping = derived.ToDictionary(
                d => d.TypeDiscriminator?.ToString() ?? d.DerivedType.Name,
                d => $"#/components/schemas/{d.DerivedType.Name}"
            )
        };

        schema.OneOf = derived.ConvertAll(d =>
        {
            context.SchemaGenerator.GenerateSchema(d.DerivedType, context.SchemaRepository);
            return new Microsoft.OpenApi.Models.OpenApiSchema
            {
                Reference = new Microsoft.OpenApi.Models.OpenApiReference
                {
                    Type = Microsoft.OpenApi.Models.ReferenceType.Schema,
                    Id = d.DerivedType.Name
                }
            };
        });
    }
}
