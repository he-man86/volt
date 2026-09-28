namespace Volt.Engine.Format.Body
{
    /// <summary>
    /// A BODY THE READER CANNOT REPRESENT — thrown by a vendor reader or the network-text writer, and answered with a
    /// READ-ONLY body: <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c> (<c>ImplementationMarker.Unsupported</c>), its
    /// <see cref="Reason"/> carried to the pull message.
    ///
    /// <para>The distinction this type exists to keep is the difference between an engineer seeing their POU
    /// and an engineer losing it. A refusal raised deep in a node walk reaches <c>Versioning.SafeVersion</c>,
    /// which isolates it by stamping the item UNREADABLE — and <c>FetchService</c> then drops that item from
    /// <c>changed</c>, <c>items</c> AND <c>folders</c>, so the POU disappears from the workspace and from git
    /// on every pull, with nothing but a count in an "N unreadable" tally. A body Volt cannot represent is
    /// exactly what the read-only line is for: the POU appears, says its body is read-only, and is refused on PUSH
    /// only if code is written under that line.</para>
    ///
    /// <para><b>Why a type and not a message match.</b> Both vendor readers already refused an Execute box
    /// whose ST cannot be read, with near-identical wording, and only the TwinCAT DRIVER pre-empted the throw
    /// (an archive pre-scan, <c>TcArchive.HasUnreadableExecuteBox</c>). CODESYS reads LIVE objects and has no
    /// equivalent pre-scan to run, so the same body that gave a TwinCAT engineer a read-only body removed the whole
    /// CODESYS POU — declaration, body and every sibling method. Catching a MESSAGE would close that hole and
    /// re-open it the first time somebody rephrased the sentence.</para>
    ///
    /// <para>Not sealed for one reason: network text v2's writer throws a subtype that also says WHERE it met the
    /// fact (<c>NetworkUnrepresentableException</c>), so a push can report it at its span. Every catch stays on this type.</para>
    ///
    /// <para><b>Level 0.</b> The vendor readers, the network model and the writer all raise it, and none of them may
    /// depend on another to do so.</para>
    /// </summary>
    public class UnrepresentableBodyException : System.NotSupportedException
    {
        /// <summary>The fact network text has no spelling for, in a few words — e.g. <c>a vendor split point</c>. It is
        /// what the pull message names for the body (it used to be written into the file, as
        /// the old marker comment); the <see cref="System.Exception.Message"/> is the long
        /// explanation.</summary>
        public string Reason { get; }

        public UnrepresentableBodyException(string reason, string message) : base(message) => Reason = reason;
    }
}
