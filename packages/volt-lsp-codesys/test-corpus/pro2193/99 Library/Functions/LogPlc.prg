// Helper functions to log messages to the PLC log
{attribute 'no_explicit_call' := 'Static helper class to log different messages to the PLC log'}
{attribute 'hide_all_locals'}
PROGRAM LogPlc
VAR
	throwFatalMessages		: BOOL;
END_VAR

END_PROGRAM

// Only log when a global option is enabled.
METHOD PUBLIC Debug
VAR_INPUT
	message : STRING(80);
END_VAR
IF GlobalVars.EnableDebugLogging THEN
	LogPlc.Info(message);
END_IF
END_METHOD

METHOD PUBLIC Error
VAR_INPUT
	message : STRING(80);
END_VAR
L_LA.L_AddLog2(
	eSeverity		:= L_TSeverity.L_LogError,	// Severity = 'Trouble log'
	udiComponendID	:= 16#3F03,		// Component ID, reserved range 0x2800 .... 0x3fff
	sLogPayLoad		:= message,
	dwErrorID		:= 0,
	strLanguageTable:= '');
END_METHOD

METHOD PUBLIC Fatal
VAR_INPUT
	message : STRING(80);
END_VAR
L_LA.L_AddLog2(
	eSeverity		:= L_TSeverity.L_LogFatalError,
	udiComponendID	:= 16#3F04,		// Component ID, reserved range 0x2800 .... 0x3fff
	sLogPayLoad		:= message,
	dwErrorID		:= 0,
	strLanguageTable:= '');

IF throwFatalMessages THEN
	Throw();
END_IF
END_METHOD

METHOD PUBLIC Info
VAR_INPUT
	message : STRING(80);
END_VAR
L_LA.L_AddLog2(
	eSeverity		:= L_TSeverity.L_LogInformation,
	udiComponendID	:= 16#3F01,		// Component ID, reserved range 0x2800 .... 0x3fff
	sLogPayLoad		:= message,
	dwErrorID		:= 0,
	strLanguageTable:= '');
END_METHOD

METHOD INTERNAL Throw
VAR
	pApp			: POINTER TO CmpApp.APPLICATION;
	iecResult		: SysTypes.RTS_IEC_RESULT;
END_VAR
// Get handle to current PLC application
pApp := CmpApp.AppGetCurrent(pResult := ADR(iecResult));
IF pApp <> 0 THEN
	// Throw exception in current app
	CmpApp.AppGenerateException(pApp := pApp, ulException := 16#10);	// Throw exception of type: RtsExceptions.RTSEXCPT_WATCHDOG
END_IF

// Note: RTSEXCPT_WATCHDOG exceptions are the only type still working in C5x0 PLCs!
// Other types of exceptions are not working. The PLC does not stop.
// See email from Lenze on 2024-08-20
END_METHOD

METHOD PUBLIC Warn
VAR_INPUT
	message : STRING(80);
END_VAR
L_LA.L_AddLog2(
	eSeverity		:= L_TSeverity.L_LogWarning,
	udiComponendID	:= 16#3F02,		// Component ID, reserved range 0x2800 .... 0x3fff
	sLogPayLoad		:= message,
	dwErrorID		:= 0,
	strLanguageTable:= '');
END_METHOD
