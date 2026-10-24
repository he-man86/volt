using System;
using System.Globalization;
using Volt.Contracts;

namespace Volt.Ide.Codesys
{
    /// <summary>CODESYS's declared severity table: a build message's <c>IMessage.Severity</c> → the wire's word.
    ///
    /// <para>Keyed on the NUMERIC value of <c>_3S.CoDeSys.Core.Messages.Severity</c> (<c>MessageStorage.dll</c>), not on its
    /// <c>ToString()</c>: the enum is <c>[Flags]</c>, so a combined value prints <c>Warning, SuppressedWarning</c> and an
    /// undefined bit prints a number. One row per single declared bit, read from the metadata of every installed version
    /// (wire-final-shape 2.7): <c>FatalError</c>=1, <c>Error</c>=2, <c>Warning</c>=4, <c>Information</c>=8, <c>Text</c>=16.
    /// 3.5.22.40 adds <c>SuppressedWarning</c>=32 and <c>SuppressedInformation</c>=64, which are no rows. Measured live on
    /// 3.5.22.40 (wire-final-shape 3.6, 2026-10-24): a warning silenced by <c>{warning disable C0196}</c> puts NO message
    /// into the build's categories at all (the same POU without the pragma gives one C0196 warning), and three builds
    /// (warning; suppressed warning; warning + suppressed warning + two errors) gave only single declared bits — every
    /// message classified, no combined value. Should a suppressed message ever arrive it carries no severity (and counts
    /// as no warning).</para>
    ///
    /// <para>THE ERROR BITS DECIDE. The enum is <c>[Flags]</c>, so a value carrying <c>FatalError</c> or <c>Error</c> IS an
    /// error by the IDE's own declaration, whatever else it carries (<c>Error | SuppressedWarning</c> included). Any other
    /// value that is not exactly one row is NOT classified: the diagnostic carries no severity, and the value is logged so
    /// the next measurement can name it. Nothing is substring-matched and nothing defaults.</para>
    ///
    /// <para>AN UNKNOWN FACT IS NEVER A CLEAN BUILD (<see cref="MayBeError"/>): a value that is not a number, or carries a
    /// bit no installed version declares, cannot be ruled out as an error, so the build that gave it does not answer
    /// success. A value made only of declared non-error bits (a suppressed warning) can be, and fails no build.</para></summary>
    internal static class CodesysSeverity
    {
        private const long FatalError = 1, Error = 2, Warning = 4, Information = 8, Text = 16;
        /// <summary>Every bit some installed version declares (3.5.22.40's two suppressed ones included).</summary>
        private const long Declared = 127;

        /// <summary>The wire word for a raw severity, or null when the value carries no error bit and is not one row.</summary>
        public static string? Of(object? raw)
        {
            if (Number(raw) is not { } value)
            {
                VoltLog.Warn($"codesys: a build message's Severity '{raw}' ({raw?.GetType().FullName ?? "none"}) is not a number — not classified");
                return null;
            }
            if ((value & (FatalError | Error)) != 0) return Severity.Error;
            var word = value switch
            {
                Warning => Severity.Warning,
                Information => Severity.Info,
                Text => Severity.Info,
                _ => null,
            };
            if (word is null)
                VoltLog.Warn($"codesys: a build message's Severity {value} ('{raw}') is no single declared row — not classified");
            return word;
        }

        /// <summary>True when the raw severity cannot be ruled out as an error: an error bit, a value that is no number,
        /// or a bit no installed version declares. A build with such a message is not a clean build.</summary>
        public static bool MayBeError(object? raw) =>
            Number(raw) is not { } value || (value & (FatalError | Error)) != 0 || (value & ~Declared) != 0;

        private static long? Number(object? raw)
        {
            if (raw is null) return null;
            try { return Convert.ToInt64(raw, CultureInfo.InvariantCulture); }
            catch (Exception ex) when (ex is FormatException or InvalidCastException or OverflowException) { return null; }
        }
    }
}
