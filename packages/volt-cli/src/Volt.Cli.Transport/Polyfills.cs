using System.ComponentModel;

namespace System.Runtime.CompilerServices;

// netstandard2.0 has no IsExternalInit, which record `init` setters require. This shim enables
// records/init across the net48 (CODESYS) and net8 (TwinCAT/CLI/test) hosts that load this assembly.
// Volt.Engine carries its own copy for the same reason; both are internal, so neither is ambiguous
// from the other's compilation.
[EditorBrowsable(EditorBrowsableState.Never)]
internal static class IsExternalInit { }
