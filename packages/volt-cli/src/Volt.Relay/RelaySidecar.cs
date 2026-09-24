using System;
using System.IO;
using System.Text.Json;

namespace Volt.Relay
{
    /// <summary>The tunnel's configuration: <c>volt-relay.json</c>, beside the host.
    ///
    /// <para>A FILE rather than argv or an environment variable, for two reasons that are not style. The
    /// standalone TwinCAT bridge is double-clicked, so there is no argv to read. And a token on a command line
    /// is readable by every process on the machine — this one is a remote-write credential for a live PLC
    /// project.</para></summary>
    public sealed class RelaySidecar
    {
        public const string FileName = "volt-relay.json";

        public string Url { get; }
        public string Token { get; }

        private RelaySidecar(string url, string token)
        {
            Url = url;
            Token = token;
        }

        /// <summary>The host's own log line for a started tunnel. The URL's HOST only — never the token, and
        /// never the whole sidecar. This is the one formatter, so there is no second place that gets it wrong.
        /// </summary>
        public string SafeDescription
        {
            get
            {
                try { return new Uri(Url).Host; }
                catch { return "(unparseable url)"; }
            }
        }

        /// <summary>Look for the sidecar beside <paramref name="directory"/>.</summary>
        /// <returns>The config, or null when the file does not exist.</returns>
        /// <exception cref="RelaySidecarException">The file exists and is not usable.</exception>
        /// <remarks>
        /// <para><b>Absent is not an error.</b> A bridge with no sidecar is exactly the bridge that exists
        /// today: no tunnel, no socket, no behaviour change at all.</para>
        ///
        /// <para><b>Malformed IS an error, and a loud one.</b> The tempting alternative — warn and carry on
        /// locally — produces a bridge that looks healthy from the machine it runs on and is simply absent from
        /// the far end, which is indistinguishable from "the relay is down" and has a completely different fix.
        /// Every message below names the file, because the first question is always which copy was read.</para>
        /// </remarks>
        public static RelaySidecar? Load(string? directory)
        {
            if (string.IsNullOrEmpty(directory)) return null;
            var path = Path.Combine(directory, FileName);
            if (!File.Exists(path)) return null;
            return Parse(File.ReadAllText(path), path);
        }

        /// <summary>The parse, split out so it is testable without a filesystem. <paramref name="path"/> is only
        /// ever used to name the file in an error.</summary>
        public static RelaySidecar Parse(string json, string path)
        {
            string url, token;
            try
            {
                using (var doc = JsonDocument.Parse(json))
                {
                    var root = doc.RootElement;
                    if (root.ValueKind != JsonValueKind.Object)
                        throw new RelaySidecarException(path, "the file is not a JSON object");
                    url = ReadString(root, "url", path);
                    token = ReadString(root, "token", path);
                }
            }
            catch (JsonException ex)
            {
                throw new RelaySidecarException(path, "the file is not valid JSON: " + ex.Message);
            }

            // A URL that is not absolute, or is not a WebSocket scheme, cannot be dialed. Refusing here beats
            // failing inside ConnectAsync, where the exception says nothing about which file is wrong.
            Uri parsed;
            if (!Uri.TryCreate(url, UriKind.Absolute, out parsed))
                throw new RelaySidecarException(path, "`url` is not an absolute URL: " + Describe(url));
            if (parsed.Scheme != "ws" && parsed.Scheme != "wss")
                throw new RelaySidecarException(path,
                    "`url` must be ws:// or wss://, not " + parsed.Scheme + "://");

            return new RelaySidecar(url, token);
        }

        private static string ReadString(JsonElement root, string name, string path)
        {
            JsonElement value;
            if (!root.TryGetProperty(name, out value))
                throw new RelaySidecarException(path, "`" + name + "` is missing");
            if (value.ValueKind != JsonValueKind.String)
                throw new RelaySidecarException(path, "`" + name + "` must be a string");
            var text = value.GetString();
            if (string.IsNullOrEmpty(text))
                throw new RelaySidecarException(path, "`" + name + "` is empty");
            return text!;
        }

        /// <summary>Quote a bad value for an error message. The URL is safe to echo; this exists so a caller
        /// cannot accidentally reach for a formatter that also handles the token.</summary>
        private static string Describe(string? value) =>
            value == null ? "(null)" : "'" + value + "'";
    }

    /// <summary>A sidecar that exists and cannot be used. Carries the path, because "which copy did it read" is
    /// the first question — the CODESYS staging step copies every `.json` beside the script into %TEMP%.
    /// </summary>
    public sealed class RelaySidecarException : Exception
    {
        public string Path { get; }

        public RelaySidecarException(string path, string reason)
            : base(RelaySidecar.FileName + " at '" + path + "' cannot be used: " + reason)
        {
            Path = path;
        }
    }
}
