(************************************************************************************************
*
* Program  : 	MachineStateSetting
*
* Summary : 	This program is used as the interface between the application machine program 
*				and the OEE & Downtime tracking machine/production mode assignement
*                  
* History :
*
*   Date        Author          Version    Changes
*  ------------------------------------------------------------------------------------------------------------------------------------------------------------
*   2023-12-20  Michael May    			1.0		Release of Verion V3.26.4.21
*)

PROGRAM MachineStateSetting
VAR
END_VAR

//*******************************PackML Sample****************************************************************************************
//************************************************************************************************************************************
// Here the machine plc based state and mode handling (operation mode) has to be used; the below code is an sample how to control 
// the bits xDownTimeActive, xOrgDownTimeActive and xScheduledDownTimeActive which are highly relevant for the OEE calculation
//As well the actual machine state of iProductionMode has to be assigned e.g. "Execute=6...Abort=9" set in the structure scProductionMode

//************************************************************************************************************************************
// Assignement of current production mode and state (Modes are not used insite the OEE Library)
//************************************************************************************************************************************
GVL_OEE_Var.eStatus_States := eStates.Execute;		// Here the right machine program state as to be assigned
GVL_OEE_Var.eStatus_Modes := eModes.Production;		// Here the right machine program mode as to be assigned

//*************************************************************************************************
// !! Assign the current production mode of the machine as integer value, example Execute = 6 !! //
//-------------------------------------------------------------------------------------------------
MachineStateOEE();
GVL_OEE_Var.iProductionMode := GVL_OEE_Var.eStatus_States;  // PackML eStatus_States

//*******************************Technical Availability losses************************************************************************
//************************************************************************************************************************************
// Availability losses include Unplanned Stops such as equipment failures
IF  GVL_OEE_Var.eStatus_Modes = eModes.Production AND GVL_OEE_Var.eStatus_States = eStates.Aborted THEN
	// Time will be counted as downtime and Availability losses
	GVL_OEE_Var.scMachineData.xDownTimeActive := TRUE;
ELSE
	GVL_OEE_Var.scMachineData.xDownTimeActive := FALSE;
END_IF

//*******************************Non Technical Availability losses********************************************************************
//************************************************************************************************************************************
// Performance losses include Unplanned Stops such as material shortages and Planned Stops (such as changeover time)
IF  GVL_OEE_Var.eStatus_Modes = eModes.Production AND (GVL_OEE_Var.eStatus_States = eStates.Suspended
													OR 	GVL_OEE_Var.eStatus_States = eStates.Suspending
													OR 	GVL_OEE_Var.eStatus_States = eStates.Stopped
													OR 	GVL_OEE_Var.eStatus_States = eStates.Stopping
													OR  GVL_OEE_Var.eStatus_States = eStates.Idle
													OR	GVL_OEE_Var.scPerformance.scAP.xChangeOverTimeExceeded)
											 		THEN
	// Time will be counted as organisational downtime and Performance losses
	GVL_OEE_Var.scMachineData.xOrgDownTimeActive := TRUE;
ELSE
	GVL_OEE_Var.scMachineData.xOrgDownTimeActive := FALSE;
END_IF


//*******************************Scheduled losses e.g. Change Over***************************************************************
//************************************************************************************************************************************
// Could be used if  Machine is in State "Holding" and time should be count as planned scheduled losses instead of performance losses
IF (((GVL_OEE_Var.eStatus_States = eStates.Holding) OR (GVL_OEE_Var.eStatus_States = eStates.Held)) AND
		NOT GVL_OEE_Var.scPerformance.scAP.xChangeOverTimeExceeded) THEN
	GVL_OEE_Var.scMachineData.xScheduledDownTimeActive := TRUE;
ELSE
	GVL_OEE_Var.scMachineData.xScheduledDownTimeActive := FALSE;
END_IF;

END_PROGRAM
