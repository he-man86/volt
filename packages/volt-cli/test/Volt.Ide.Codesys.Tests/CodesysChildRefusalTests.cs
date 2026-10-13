using System;
using System.Reflection;
using Volt.Ide.Codesys;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>THE DRIVER, NOT THE ENGINE, TELLS CODESYS'S REFUSAL OF A CHILD FROM A FAULT (openspec
    /// <c>push-without-header-check</c> 5Qa review). The push words a refused member as a fact about the POU's
    /// declaration (DIALECT C2k); it used to word every failed create that way. Only CODESYS's own measured answer is a
    /// refusal — from wherever it sits in the chain a reflective call builds.</summary>
    public class CodesysChildRefusalTests
    {
        private const string Measured =
            "Object 'Method' is not accepted by parent object, or invalid (e. g. missing plugin or device description).";

        [Fact]
        public void The_measured_not_accepted_answer_is_a_refusal_with_the_vendors_words()
        {
            Assert.Equal(Measured, CodesysDriver.ChildRefusal(new InvalidOperationException(Measured)));
            Assert.Equal(Measured, CodesysDriver.ChildRefusal(new TargetInvocationException(new InvalidOperationException(Measured))));
        }

        /// <summary>openspec <c>push-keeps-what-landed</c> gate step 1: the live PLCAssist repro (CODESYS SP21, 2026-10-03,
        /// tasks.md 1.1) — a METHOD named <c>Log</c> under a function block is refused with this message, and it reached
        /// the client as <c>INTERNAL_ERROR</c> because this classifier did not know it. It is the vendor refusing a child
        /// by its NAME, as "not accepted" is by its kind: a refusal, not a fault.</summary>
        [Fact]
        public void The_measured_name_not_valid_answer_is_a_refusal_with_the_vendors_words()
        {
            const string log = "The name 'Log' is not valid for this object.";
            Assert.Equal(log, CodesysDriver.ChildRefusal(new InvalidOperationException(log)));
            Assert.Equal(log, CodesysDriver.ChildRefusal(new TargetInvocationException(new InvalidOperationException(log))));
        }

        /// <summary>…and the driver says WHICH refusal it is, so the push words a name refusal as one and never sends the
        /// engineer to the declaration (openspec <c>push-keeps-what-landed</c> design D2).</summary>
        [Fact]
        public void The_driver_says_whether_the_kind_or_the_name_is_refused()
        {
            Assert.Equal(Volt.Engine.Ide.ChildRefusalCause.Kind, CodesysDriver.Refusal(new InvalidOperationException(Measured))!.Value.Cause);
            Assert.Equal(Volt.Engine.Ide.ChildRefusalCause.Name,
                CodesysDriver.Refusal(new InvalidOperationException("The name 'Log' is not valid for this object."))!.Value.Cause);
        }

        /// <summary>openspec <c>push-keeps-what-landed</c> gate step 2, round 2 (finding 2): CODESYS has no scripting call to
        /// add a property's missing GET or SET. That is raised INSIDE the apply loop (the accessor reconcile), so it can
        /// reach a conflict on an accepted push — where no reason may carry a client command ("… then pull"), and the class
        /// is a vendor "cannot" (UNSUPPORTED), not an unclassified fault (INTERNAL_ERROR).</summary>
        [Fact]
        public void A_missing_accessor_create_is_a_vendor_cannot_that_names_no_client_command()
        {
            var ex = CodesysDriver.NoAccessorCreate("Set", "create_method, create_action");
            Assert.IsType<NotSupportedException>(ex);
            Assert.Contains("'Set'", ex.Message);
            Assert.DoesNotContain("pull", ex.Message, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>A LOCALIZED CODESYS REFUSES IN ITS OWN LANGUAGE (environment-dependency-audit 2.6, measured live
        /// 2026-10-13 on the German 32-bit CODESYS 3.5.21.60: a METHOD named <c>Vlt__Log</c> was refused with "Der Name
        /// 'Vlt__Log' ist für dieses Objekt nicht gültig." and reached the client as INTERNAL_ERROR, because this
        /// classifier knew only the English words). The other languages are CODESYS's own resource strings
        /// (<c>ObjectNameInvalidException</c> in Core/Objects, <c>ObjectInvalidOrNotAcceptedByParent</c> in
        /// ScriptDriverProjects), identical on 3.5.18.30 / 3.5.21.40 / 3.5.21.60 / 3.5.22.40 (DIALECT V9).</summary>
        [Theory]
        [InlineData("Der Name 'Vlt__Log' ist für dieses Objekt nicht gültig.")]                         // measured live
        [InlineData("Имя 'Log' не подходит для этого объекта.")]
        [InlineData("Имя 'Log' недопустимо для этого объекта.")]
        [InlineData("Le nom « Log » n’est pas valide pour cet objet.")]
        [InlineData("'Log' adı bu nesne için geçerli değil.")]
        [InlineData("名前「Log」はこのオブジェクトには有効ではありません。")]
        [InlineData("名称'Log'对此对象无效.")]
        public void A_localized_name_refusal_is_a_name_refusal(string message)
        {
            var why = CodesysDriver.Refusal(new TargetInvocationException(new InvalidOperationException(message)));
            Assert.Equal((message, Volt.Engine.Ide.ChildRefusalCause.Name), why);
        }

        [Theory]
        [InlineData("Objekt 'Method' wird vom Vaterobjekt nicht akzeptiert oder ist nicht gültig z.B, fehlendes PlugIn oder Gerätebeschreinung).")]
        [InlineData("Объект 'Method' не принят родительским объектом или некорректен (например, отсутствует плагин или описание устройства)")]
        [InlineData("'Method' nesnesi ana nesne tarafından kabul edilmiyor veya geçersiz (örneğin eksik eklenti veya aygıt açıklaması).")]
        public void A_localized_kind_refusal_is_a_kind_refusal(string message) =>
            Assert.Equal((message, Volt.Engine.Ide.ChildRefusalCause.Kind), CodesysDriver.Refusal(new InvalidOperationException(message)));

        [Theory]
        [InlineData("Unbound tree item")]
        [InlineData("Der Name ist zu lang.")]
        [InlineData("Gültigkeitsbereich ist nicht gültig für dieses Objekt.")]   // another "not valid for this object"
        [InlineData("Scope is not valid for this object.")]                      // (VarDeclObject's InvalidScope)
        [InlineData("Object reference not set to an instance of an object.")]
        [InlineData("CODESYS: no create for item kind 9999 ('M')")]
        public void Any_other_failure_is_not_a_refusal(string message) =>
            Assert.Null(CodesysDriver.ChildRefusal(new InvalidOperationException(message)));
    }
}
