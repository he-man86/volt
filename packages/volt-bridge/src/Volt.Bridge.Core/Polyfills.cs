using System.ComponentModel;

namespace System.Runtime.CompilerServices;

// netstandard2.0 has no IsExternalInit, which record `init` setters require. This shim enables
// records/init across the net48 (CODESYS) and net8 (TwinCAT/test) hosts that load this assembly.
[EditorBrowsable(EditorBrowsableState.Never)]
internal static class IsExternalInit { }
