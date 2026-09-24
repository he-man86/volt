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
        /// <returns>The running tunnel, or null when this install has no relay configured.</returns>
        public static RelayTunnel? StartIfConfigured(
            string? directory,
            string pipeName,
            string vendor,
            string version,
            Action<string> logInfo,
            Action<string> logError)
        {
            try
            {
                // First run of a downloaded bridge: turn the one-time setup code into a real sidecar.
                RelayEnrollment.EnsureSidecar(directory, logInfo);

                var sidecar = RelaySidecar.Load(directory);
                if (sidecar is null) return null;

                var tunnel = new RelayTunnel(sidecar, pipeName, vendor, version);
                tunnel.Start();
                logInfo("relay: tunnel starting to " + sidecar.SafeDescription);
                return tunnel;
            }
            catch (Exception ex)
            {
                logError("relay: tunnel did not start: " + ex.Message);
                return null;
            }
        }

        /// <summary>The directory a type's assembly was loaded from — where its sidecar sits.</summary>
        public static string? DirectoryOf(Type anchor)
        {
            try { return Path.GetDirectoryName(anchor.Assembly.Location); }
            catch { return null; }
        }
    }
}
