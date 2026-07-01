{attribute 'monitoring_display' := 'active'}
FUNCTION_BLOCK PUBLIC SetErrorFB
VAR_INPUT
	moduleHandler	: L_IMHP.L_IMHP_IModuleHandler;
	textRefId		: WORD;				// Id of error-textlist
	errorId			: WORD;				// Id of error in the error-textlist
	alarmCondition	: BOOL;				// Condition to set the alarm.
	alarmDelay		: REAL;				// Time after which the alarm trips (in sec.)
	severity		: enumErrorSeverity := enumErrorSeverity.Fault;
	reaction		: enumErrorReaction := enumErrorReaction.No_reaction;
	testAlarm		: BOOL;
END_VAR
VAR_OUTPUT
	active			: BOOL;				// Alarm is active.
END_VAR
VAR
	SetErrorSingle	: L_IE1P.L_IE1P_SetErrorSingle;
	AlarmTimeout	: BTON;


	KeepShittyAlarmHigh : Standard.TOF;	// todo: test if this is still needed!!
END_VAR

END_FUNCTION_BLOCK

{attribute 'monitoring_display' := 'active'}
FUNCTION_BLOCK PUBLIC SetErrorFB
VAR_INPUT
	moduleHandler	: L_IMHP.L_IMHP_IModuleHandler;
	textRefId		: WORD;				// Id of error-textlist
	errorId			: WORD;				// Id of error in the error-textlist
	alarmCondition	: BOOL;				// Condition to set the alarm.
	alarmDelay		: REAL;				// Time after which the alarm trips (in sec.)
	severity		: enumErrorSeverity := enumErrorSeverity.Fault;
	reaction		: enumErrorReaction := enumErrorReaction.No_reaction;
	testAlarm		: BOOL;
END_VAR
VAR_OUTPUT
	active			: BOOL;				// Alarm is active.
END_VAR
VAR
	SetErrorSingle	: L_IE1P.L_IE1P_SetErrorSingle;
	AlarmTimeout	: BTON;


	KeepShittyAlarmHigh : Standard.TOF;	// todo: test if this is still needed!!
END_VAR
END_METHOD

{attribute 'monitoring_display' := 'active'}
FUNCTION_BLOCK PUBLIC SetErrorFB
VAR_INPUT
	moduleHandler	: L_IMHP.L_IMHP_IModuleHandler;
	textRefId		: WORD;				// Id of error-textlist
	errorId			: WORD;				// Id of error in the error-textlist
	alarmCondition	: BOOL;				// Condition to set the alarm.
	alarmDelay		: REAL;				// Time after which the alarm trips (in sec.)
	severity		: enumErrorSeverity := enumErrorSeverity.Fault;
	reaction		: enumErrorReaction := enumErrorReaction.No_reaction;
	testAlarm		: BOOL;
END_VAR
VAR_OUTPUT
	active			: BOOL;				// Alarm is active.
END_VAR
VAR
	SetErrorSingle	: L_IE1P.L_IE1P_SetErrorSingle;
	AlarmTimeout	: BTON;


	KeepShittyAlarmHigh : Standard.TOF;	// todo: test if this is still needed!!
END_VAR
END_METHOD

// Get the elapsed time of the alarm timer.
{attribute 'monitoring':='call'}
PROPERTY PUBLIC ElapsedTime : REAL
GET
IF AlarmTimeout.TON1.IN THEN
	ElapsedTime := TO_REAL(AlarmTimeout.TON1.ET) / 1000;
END_IF
END_GET
END_PROPERTY
