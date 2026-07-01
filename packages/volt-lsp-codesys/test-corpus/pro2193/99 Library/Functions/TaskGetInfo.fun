// Returns task interval value (in ms) of current task
// Do not call function each PLC cycle. Calling it once is enough.
FUNCTION TaskGetInfo : CmpIecTask.Task_Info2
VAR
	iecResult		: SysTypes.RTS_IEC_RESULT;
	handle			: SysTypes.RTS_IEC_HANDLE;
	pIecTaskInfo	: POINTER TO CmpIecTask.Task_Info2;
END_VAR

handle				:= CmpIecTask.IecTaskGetCurrent(ADR(iecResult));			// Function to get own task handle

IF handle = SysTypes.RTS_INVALID_HANDLE THEN RETURN; END_IF
IF iecResult <> CmpErrors.Errors.ERR_OK THEN RETURN; END_IF

pIecTaskInfo		:= CmpIecTask.IecTaskGetInfo3(hIecTask := handle, pResult := ADR(iecResult));	// Function returns the task information of the specified task

IF pIecTaskInfo = 0 THEN RETURN; END_IF

TaskGetInfo			:= pIecTaskInfo^;

END_FUNCTION
