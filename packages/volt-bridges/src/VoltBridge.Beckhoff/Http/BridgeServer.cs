using System.Net.Sockets;
using System.Runtime.InteropServices;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using VoltBridge.Core;
using VoltBridge.Core.Errors;
using VoltBridge.Core.Handlers;
using VoltBridge.Core.Models;

namespace VoltBridge.Beckhoff.Http;

public static class BridgeServer
{
    public static void Run<T>(T adapter, string title, int port) where T : IAdapter
    {
        var builder = WebApplication.CreateBuilder([]);
        builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSwaggerGen(c =>
        {
            c.SwaggerDoc("v1", new() { Title = title, Version = "v1" });
            c.SchemaFilter<PolymorphicSchemaFilter>();
        });
        var app = builder.Build();

        app.UseSwagger();
        app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", $"{title} v1"));

        app.MapGet("/health", () =>
        {
            var result = adapter.BuildHealthResponse();
            var jsonOpts = new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase };
            return Results.Json(result, jsonOpts);
        });

        app.MapGet("/refs", () =>
        {
            var gate = DegradedGate(adapter, "/refs");
            if (gate != null) return gate;
            try
            {
                var result = adapter.RunOnStaThread(() => RefsHandler.Handle(adapter));
                return Results.Json(result);
            }
            catch (BridgeException ex) { MarkDegradedOnRpc(adapter, ex.Cause ?? ex, "/refs"); return ErrorJson(ex); }
            catch (Exception ex) { MarkDegradedOnRpc(adapter, ex, "/refs"); return InternalErrorJson(ex); }
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
            catch (BridgeException ex) { MarkDegradedOnRpc(adapter, ex.Cause ?? ex, "/fetch"); return ErrorJson(ex); }
            catch (Exception ex) { MarkDegradedOnRpc(adapter, ex, "/fetch"); return InternalErrorJson(ex); }
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
            catch (BridgeException ex) { MarkDegradedOnRpc(adapter, ex.Cause ?? ex, "/push"); return ErrorJson(ex); }
            catch (Exception ex) { MarkDegradedOnRpc(adapter, ex, "/push"); return InternalErrorJson(ex); }
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
            catch (BridgeException ex) { MarkDegradedOnRpc(adapter, ex.Cause ?? ex, "/build"); return ErrorJson(ex); }
            catch (Exception ex) { MarkDegradedOnRpc(adapter, ex, "/build"); return InternalErrorJson(ex); }
        });

        Console.WriteLine($"{title} v{adapter.Version} listening on http://127.0.0.1:{port}");
        try { app.Run(); }
        catch (IOException ex) when (ex.InnerException is SocketException)
        {
            Console.Error.WriteLine($"Port {port} already in use — is another bridge instance running?");
        }
    }

    private static IResult DegradedGate(IAdapter adapter, string path)
    {
        if (!adapter.IsDegraded) return null!;
        return Results.Json(
            new { error = new { code = "PLC_DEGRADED", message = adapter.DegradedReason ?? "COM channel degraded — retry" } },
            statusCode: 503);
    }

    private static void MarkDegradedOnRpc(IAdapter adapter, Exception ex, string path)
    {
        if (IsRpcFailure(ex)) adapter.MarkDegraded($"{path}: {ex.Message}");
    }

    private static bool IsRpcFailure(Exception? ex)
    {
        for (var e = ex; e != null; e = e.InnerException)
        {
            if (e is COMException com)
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

    private static IResult ErrorJson(BridgeException ex) =>
        Results.Json(new { error = new { code = ex.ErrorCode, message = ex.Message } }, statusCode: ex.StatusCode);

    private static IResult InternalErrorJson(Exception ex) =>
        Results.Json(new { error = new { code = "INTERNAL_ERROR", message = ex.Message } }, statusCode: 500);
}

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
                d => $"#/components/schemas/{d.DerivedType.Name}")
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
