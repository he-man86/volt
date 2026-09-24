using System;
using System.IO;
using System.Net.Http;
using System.Text.Json;

namespace Volt.Relay
{
    /// <summary>
    /// Turn a one-time setup code into a real sidecar, once, on first run.
    /// </summary>
    /// <remarks>
    /// <para>A download cannot ship a credential. It ships a <c>setup.json</c> holding a SETUP CODE — single-use,
    /// server-side, and meaningless to anyone who does not also own the account — which this exchanges for the
    /// real token and writes out as <c>volt-relay.json</c>. From then on <see cref="RelaySidecar"/> takes over and
    /// this never runs again.</para>
    ///
    /// <para>This is the mechanism the previous bridges used and it is kept deliberately: the code rode in the
    /// exe FILENAME (Beckhoff) or was injected into the script text (CODESYS), and both exchanged it at
    /// <c>/api/bridge/setup/{code}</c>. A zip cannot use its filename — users extract it — so the code travels in
    /// a file beside the bridge. Same principle, same endpoint, same one-time code; only the carrier changed.</para>
    ///
    /// <para>The exchange also tells the server the bridge was really RUN, which is the difference between
    /// "downloaded" and "connected" in the onboarding funnel. That signal is why the code is exchanged on first
    /// run rather than baked in at download time.</para>
    /// </remarks>
    public static class RelayEnrollment
    {
        public const string FileName = "setup.json";

        /// <summary>
        /// Make sure <paramref name="directory"/> has a usable <c>volt-relay.json</c>, enrolling if it does not.
        /// </summary>
        /// <returns>True when a sidecar now exists because THIS call created it.</returns>
        /// <remarks>
        /// Every failure is swallowed and reported through <paramref name="log"/>. A machine that cannot reach
        /// the internet must still get a working LOCAL bridge — the tunnel is an addition, and trading a working
        /// local install for a broken one over a failed HTTP call is the exact bargain
        /// <see cref="PipeHostTunnel"/> refuses to make.
        /// </remarks>
        public static bool EnsureSidecar(string? directory, Action<string> log)
        {
            if (string.IsNullOrEmpty(directory)) return false;
            // Already enrolled. Not an error and not worth a log line — this is the steady state.
            if (File.Exists(Path.Combine(directory, RelaySidecar.FileName))) return false;

            var setupPath = Path.Combine(directory, FileName);
            // No setup.json either: a dev build, or a bridge configured by hand. Silent by design.
            if (!File.Exists(setupPath)) return false;

            string code, appUrl;
            try
            {
                using (var doc = JsonDocument.Parse(File.ReadAllText(setupPath)))
                {
                    var root = doc.RootElement;
                    code = root.TryGetProperty("code", out var c) ? c.GetString() ?? "" : "";
                    // The app to ask, carried in the file rather than compiled in, so a bridge downloaded from a
                    // staging deploy enrolls against THAT deploy instead of silently phoning production.
                    appUrl = root.TryGetProperty("app", out var a) ? a.GetString() ?? "" : "";
                }
            }
            catch (Exception ex)
            {
                log("relay: " + FileName + " is not readable: " + ex.Message);
                return false;
            }

            if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(appUrl))
            {
                log("relay: " + FileName + " has no `code`/`app` — cannot enrol");
                return false;
            }

            try
            {
                // `volt=1` asks for a Volt bridge_token rather than the legacy per-user relay token. The
                // endpoint is public and unversioned and still serves bridges in the field, so the NEW shape is
                // the one behind a flag — an old bridge that started receiving a new credential would simply
                // stop connecting, with nothing to roll back.
                var url = appUrl.TrimEnd('/') + "/api/bridge/setup/" + Uri.EscapeDataString(code) + "?volt=1";
                using (var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) })
                {
                    var response = client.GetAsync(url).GetAwaiter().GetResult();
                    if (!response.IsSuccessStatusCode)
                    {
                        log("relay: setup code rejected (HTTP " + (int)response.StatusCode + ")");
                        return false;
                    }
                    var json = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    using (var doc = JsonDocument.Parse(json))
                    {
                        var root = doc.RootElement;
                        var token = root.TryGetProperty("token", out var t) ? t.GetString() : null;
                        var wss = root.TryGetProperty("url", out var u) ? u.GetString() : null;
                        if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(wss))
                        {
                            log("relay: setup response carried no token/url");
                            return false;
                        }
                        // Written through a temp file and moved into place: a half-written sidecar is
                        // indistinguishable from a corrupt one, and RelaySidecar treats corrupt as FATAL.
                        var target = Path.Combine(directory, RelaySidecar.FileName);
                        var tmp = target + ".tmp";
                        File.WriteAllText(tmp, JsonSerializer.Serialize(new { url = wss, token }));
                        if (File.Exists(target)) File.Delete(target);
                        File.Move(tmp, target);
                        log("relay: enrolled; wrote " + RelaySidecar.FileName);
                        return true;
                    }
                }
            }
            catch (Exception ex)
            {
                log("relay: could not enrol: " + ex.Message);
                return false;
            }
        }
    }
}
