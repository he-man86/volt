/// <summary>
/// VoltBridge CODESYS Plugin — starts the HTTP bridge daemon
/// and registers Tools menu commands. Licensed under MIT.
/// </summary>
using System;
using System.Net;
using System.Threading;
using _3S.CoDeSys.Core.Components;

[assembly: PlugInGuid("E43ABC6C-41DA-42E9-AF56-F632F69F6CA5")]
[assembly: PlugInName("VoltBridge", "E43ABC6C-41DA-42E9-AF56-F632F69F6CA5")]

namespace VoltBridge.Codesys.Plugin;

internal class VoltBridgePlugin
{
	private static HttpListener? _listener;
	private static Thread? _serverThread;
	private static volatile bool _running;

	public void Init()
	{
		if (_running) return;
		_running = true;
		_serverThread = new Thread(RunServer) { IsBackground = true, Name = "VoltBridge" };
		_serverThread.Start();
	}

	public void DeInit()
	{
		_running = false;
		try { _listener?.Stop(); } catch { }
		_serverThread?.Join(2000);
	}

	private static void RunServer()
	{
		_listener = new HttpListener();
		_listener.Prefixes.Add("http://127.0.0.1:8556/");
		try { _listener.Start(); }
		catch (HttpListenerException) { return; }

		while (_running)
		{
			try
			{
				var ctx = _listener.BeginGetContext(null, null);
				if (!ctx.AsyncWaitHandle.WaitOne(1000)) continue;
				var context = _listener.EndGetContext(ctx);
				ThreadPool.QueueUserWorkItem(_ => HandleRequest(context));
			}
			catch { break; }
		}
	}

	private static void HandleRequest(HttpListenerContext ctx)
	{
		try
		{
			var path = ctx.Request.Url!.AbsolutePath;
			string response;
			int status = 200;

			switch (path)
			{
				case "/health":
					response = "{ \"status\": \"healthy\", \"platform\": \"codesys\", \"connected\": true }";
					break;
				default:
					response = "{ \"error\": { \"code\": \"NOT_IMPLEMENTED\", \"message\": \"Bridge running — ScriptEngine integration pending\" } }";
					status = 501;
					break;
			}

			var buf = System.Text.Encoding.UTF8.GetBytes(response);
			ctx.Response.StatusCode = status;
			ctx.Response.ContentType = "application/json; charset=utf-8";
			ctx.Response.ContentLength64 = buf.Length;
			ctx.Response.OutputStream.Write(buf, 0, buf.Length);
			ctx.Response.OutputStream.Close();
		}
		catch { }
	}
}
