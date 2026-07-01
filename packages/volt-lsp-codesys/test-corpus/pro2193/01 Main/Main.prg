PROGRAM Main
VAR
	StartupTimer	: BTON;
	taskInfo				: CmpIecTask.Task_Info2;
END_VAR

__TRY
taskInfo	:= TaskGetInfo();
IF NOT StartupTimer.Set(TRUE, 1) THEN	// Delay before starting program. The first PLC cycle the I/Q is not updated yet.
	IQ_Handling();
	RETURN;
END_IF

__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.MainTask])
	GVL_Exceptions.xException := TRUE;
	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;
__ENDTRY

__TRY TimeSettings();		__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.TimeSettings])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY		// Get or set the current date / time
__TRY EtherCAT_Diag();		__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.EtherCAT_Diag])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY	// Get diagnostics about the EtherCAT connection
__TRY ErrorHandling();		__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.ErrorHandling])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY HardwareButtons();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.HardwareButtons])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY BfuButtons();			__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.BfuButtons])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY HMI();				__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.HMI])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY		// Setup communication with HMI panel
__TRY HMI_BFU();			__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.HMI_BFU])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY HardwareUnits();		__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.HardwareUnits])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY	// First initialize hardware units (lowest level)
__TRY ProcessModules();		__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.ProcessModules])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY	// Then initialize process units
__TRY SER();				__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.SER])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY		// SER need to be last in the list, so all in_out variables are connected
__TRY BFU();				__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.BFU])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY		// BFU need to be last in the list, so all in_out variables are connected
__TRY IQ_Handling();		__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.IQ_Handling])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY		// Read and write all I/Q slices

END_PROGRAM
