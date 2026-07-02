// Disable watchdog for the current task
// The watchdog is disabled only for the current cycle! At the next cycle, the watchod is automatically enabled!
FUNCTION TaskDisableWatchdog : BOOL
VAR
	iecResult		: SysTypes.RTS_IEC_RESULT;
	handle			: SysTypes.RTS_IEC_HANDLE;
END_VAR

handle				:= CmpIecTask.IecTaskGetCurrent(ADR(iecResult));			// Function to get own task handle

IF handle = SysTypes.RTS_INVALID_HANDLE THEN RETURN; END_IF
IF iecResult <> CmpErrors.Errors.ERR_OK THEN RETURN; END_IF

iecResult			:= CmpIecTask.IecTaskDisableWatchdog(hIecTask := handle);

IF iecResult <> CmpErrors.Errors.ERR_OK THEN RETURN; END_IF

TaskDisableWatchdog	:= TRUE;

END_FUNCTION
