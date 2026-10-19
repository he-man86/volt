using System;
using System.IO;

namespace Volt.Relay
{
    /// <summary>
    /// Start the relay tunnel for a bridge, if this install is configured for one.
    /// </summary>
    /// <remarks>
    /// <para>Shared by BOTH vendors, and that is the point. This logic lived inside the CODESYS
    /// <c>PipeHost</c> alone, so a downloaded TwinCAT worker served its pipe perfectly and was simply ABSENT from
    /// the relay — the bridge worked on the machine it ran on and the web app could never reach it. A per-vendor
    /// copy of a connection path is how the two drift; Core owns it, the way the op guards and the connect
    /// post-condition already do.</para>
    ///
    /// <para><b>Every failure here is logged and swallowed on purpose.</b> The tunnel is an addition to a bridge
    /// that already works locally. Taking the whole bridge down because a relay is unreachable, or because
    /// someone mistyped a URL, trades a working local install for a broken one. A malformed sidecar is still
    /// loud — it is named in the log — but it is never fatal.</para>
    /// </remarks>
    public static class PipeHostTunnel
    {
        /// <summary>Enrol if needed, then dial.</summary>
        /// <param name="directory">Where the sidecar lives — beside the bridge assembly.</param>
        /// <param name="version">The bridge release (<c>BridgePipeHost.Release</c>, the value <c>health.bridgeVersion</c>
        /// carries); null when the bridge cannot read its own file, sent as an empty <c>hello.volt</c>.</param>
        /// <param name="state">The relay's state at start, for a start line: <c>relay dialing &lt;host&gt;</c>,
        /// <c>relay not configured</c>, or <c>relay not started: &lt;reason&gt;</c>.</param>
        /// <returns>The running tunnel, or null when this install has no relay configured or it did not start.</returns>
        public static RelayTunnel? StartIfConfigured(
            string? directory,
            string pipeName,
            string vendor,
            string? version,
            Action<string> logInfo,
            Action<string> logError,
            out string state)
        {
            try
            {
                // First run of a downloaded bridge: turn the one-time setup code into a real sidecar.
                RelayEnrollment.EnsureSidecar(directory, logInfo);

                var sidecar = RelaySidecar.Load(directory);
                if (sidecar is null)
                {
                    // A setup code that did not enrol was named by EnsureSidecar; with neither, there is no relay.
                    if (string.IsNullOrEmpty(directory) || !File.Exists(Path.Combine(directory, RelayEnrollment.FileName)))
                    {
                        logInfo("relay: not configured");
                        state = "relay not configured";
                    }
                    else state = "relay not started: the setup code did not enrol (the log says why)";
                    return null;
                }

                var tunnel = new RelayTunnel(sidecar, pipeName, vendor, version);
                tunnel.Start();   // logs `relay: tunnel starting -> <host>` itself
                state = "relay dialing " + sidecar.SafeDescription;
                return tunnel;
            }
            catch (Exception ex)
            {
                logError("relay: tunnel did not start: " + ex.Message);
                state = "relay not started: " + ex.Message;
                return null;
            }
        }

        /// <summary>The directory a type's code was loaded from — where its sidecar sits (the exe's own folder when the
        /// worker is single-file: <see cref="Volt.Wire.AssemblyFile"/>).</summary>
        public static string? DirectoryOf(Type anchor)
        {
            try { return Path.GetDirectoryName(Volt.Wire.AssemblyFile.Of(anchor)); }
            catch { return null; }
        }
    }
}
