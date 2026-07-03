PROGRAM MACH_MAN_Manual
VAR
	bPulseStepCounter	: BOOL;
	bHoldPointOnReq	: BOOL;
	bHoldPointOnErr3	: BOOL;
END_VAR

(*************************************************************************
 *
 * Application name				: Snijmachine
 * Module name					: MACH_MAN_Manual
 * Version number module		: 0.00
 *
 *
 *						Copyright (c) Bakon 2009
 *						Goes, The Netherlands
 *
 *
 * All rights are reserved. Reproduction in whole or in part is prohibited 
 * without the written consent of the copyright owner.
 *
 *************************************************************************)

(*************************************************************************
 * HISTORY																					 
 *************************************************************************
 * Update  :																				  
 * Author  :																				  
 * Changes :																				  
 *************************************************************************)

	bHoldPointOnReq		:= FALSE;
	bHoldPointOnErr3		:= FALSE;

	(* Force C_NOT_ACTIVE state *)
	IF	  NOT g_sMACH.MCL.bActManual
	THEN
				  g_sMACH.MAN.nStepCounter := C_NOT_ACTIVE;
	END_IF

	g_sMACH.ERR.bPressStartForManual	:= (g_sMACH.MAN.nStepCounter = C_INITIAL) AND g_bDI_MachineInSafePosition;

	IF			g_sMACH.MAN.nStepCounter <> C_NOT_ACTIVE
	THEN
	(* -------------------------------------------------------------------------
	 * Prestep Code
	 * ------------------------------------------------------------------------- *)
				;
	END_IF

	(* detect change of state *)
	bPulseStepCounter					:= g_sMACH.MAN.nStepCounter <> g_sMACH.MAN.nOldStepCounter;
	g_sMACH.MAN.nOldStepCounter	:= g_sMACH.MAN.nStepCounter;

	(* Steptimer *)

	(* Watchdogtimer *)

	CASE g_sMACH.MAN.nStepCounter OF
	(* --------------------------------------------------------------------------
	 *  S-1  C_NOT_ACTIVE
	 *		 OnEntry: Ready  := FALSE
	 *		 OnEntry: Busy	:= FALSE
	 *		 OnEntry: InHold := FALSE
	 *		 OnEntry: Reset all non-stored commands
	 *  T000 Activate signal
	 * -------------------------------------------------------------------------- *)
	C_NOT_ACTIVE:

		(* On Entry *)
		IF			bPulseStepCounter
		THEN
					g_sMACH.MAN.bManualReady					:= FALSE;
					g_sMACH.MAN.bManualBusy					:= FALSE;
					g_sMACH.MAN.bManualHold						:= FALSE;
					(*g_uControl_X_Axis.bStartManualMode			:= FALSE;
					g_uControl_Y_Axis.bStartManualMode			:= FALSE;
					g_uControl_Front_Axis.bStartManualMode		:= FALSE;
					g_uControl_Rear_Axis.bStartManualMode		:= FALSE;
					g_uControl_Front_Axis.bAutomatic				:= FALSE;
					g_uControl_Rear_Axis.bStartManualMode		:= FALSE;
					g_uControl_Rear_Axis.bAutomatic				:= FALSE;
					g_uControl_Z_Axis.bStartManualMode			:= FALSE;
					g_uControl_R_Axis.bStartManualMode			:= FALSE;*)
					g_uControl_X_Axis.bManualJogPos				:= FALSE;
					g_uControl_X_Axis.bManualJogNeg				:= FALSE;
					g_uControl_Y_Axis.bManualJogPos				:= FALSE;
					g_uControl_Y_Axis.bManualJogNeg				:= FALSE;
					g_uControl_Front_Axis.bManualJogPos			:= FALSE;
					g_uControl_Front_Axis.bManualJogNeg			:= FALSE;
					g_uControl_Rear_Axis.bManualJogPos			:= FALSE;
					g_uControl_Rear_Axis.bManualJogNeg			:= FALSE;
					g_uControl_Z_Axis.bManualJogPos				:= FALSE;
					g_uControl_Z_Axis.bManualJogNeg				:= FALSE;
					g_uControl_R_Axis.bManualJogPos				:= FALSE;
					g_uControl_R_Axis.bManualJogNeg				:= FALSE;
					g_bCMD_US_Test1								:= FALSE;
					g_HMI_MachCommand.bSetOffsetR				:= FALSE;
					g_HMI_MachCommand.bSetOffsetFront			:= FALSE;
					g_HMI_MachCommand.bSetOffsetRear			:= FALSE;
					g_sMACH.sCleaningContainerControl.bManual	:= FALSE;
					g_sMACH.sCleaningContainerControl.bManualNeg	:= FALSE;
					g_sMACH.sCleaningContainerControl.bManualPos	:= FALSE;
					g_bDQ_CleaningWaterValve		:= 		FALSE;
		END_IF

		(* Continuous actions *)
		(* Reset manual functions active/selectable bits *)

		(* Transitions *)
		IF			g_sMACH.MCL.bActManual
		THEN
					g_sMACH.MAN.nStepCounter			:= C_INITIAL;
		END_IF

	(*--------------------------------------------------------------------------
	 *  S000 C_INITIAL
	 *		 OnEntry: Ready := FALSE
	 		Wait for start button
	 *  T001 Startbutton pressed
	 * -------------------------------------------------------------------------- *)
	C_INITIAL:

		(* On Entry *)
		IF			bPulseStepCounter
		THEN
					g_sMACH.MAN.bManualReady  := FALSE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		g_sMACH.MCL.bStopEndOfCycle
		THEN
				g_sMACH.MAN.nStepCounter			:= C_READY;
		ELSIF				g_bDI_StartButton
				OR NOT	g_bDI_MachineInSafePosition
		THEN
				g_sMACH.MAN.nStepCounter			:= 001;
		END_IF

	(*--------------------------------------------------------------------------
	 *  S001 Enable drives
	 *  T002 Status Manual mode of the drives
	 * -------------------------------------------------------------------------- *)
	001:

		(* On Entry *)
		IF			bPulseStepCounter
		THEN
					g_uControl_X_Axis.bEnableDrive	:= TRUE;
					g_uControl_Y_Axis.bEnableDrive	:= TRUE;
					g_uControl_Front_Axis.bEnableDrive	:= TRUE;
					g_uControl_Rear_Axis.bEnableDrive	:= TRUE;
					g_uControl_Z_Axis.bEnableDrive	:= TRUE;
					g_uControl_R_Axis.bEnableDrive	:= TRUE;
					g_sMACH.sCleaningContainerControl.bManual	:= TRUE;
					
					g_uControl_X_Axis.lrDeceleration	:=X_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
					g_uControl_Y_Axis.lrDeceleration	:=Y_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
					g_uControl_Front_Axis.lrDeceleration	:=Front_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
					g_uControl_Rear_Axis.lrDeceleration	:=Rear_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
					g_uControl_Z_Axis.lrDeceleration	:=Z_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
					g_uControl_R_Axis.lrDeceleration	:=R_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion

					(*g_uControl_X_Axis.bStartManualMode	:= TRUE;
					g_uControl_Y_Axis.bStartManualMode	:= TRUE;
					g_uControl_Front_Axis.bAutomatic		:= TRUE;
					g_uControl_Rear_Axis.bAutomatic		:= TRUE;
					g_uControl_Z_Axis.bStartManualMode	:= TRUE;
					g_uControl_R_Axis.bStartManualMode	:= TRUE;*)

		END_IF

		(* Continuous actions *)
		Calc_BottomPos();

		(* Transitions *)
		IF		g_sMACH.MCL.bStopEndOfCycle
		THEN
				g_sMACH.MAN.nStepCounter			:= C_READY;
		ELSIF		g_uStatus_X_Axis.bDriveEnabled
			AND	g_uStatus_Y_Axis.bDriveEnabled
			AND	g_uStatus_Front_Axis.bDriveEnabled
			AND	g_uStatus_Rear_Axis.bDriveEnabled
			AND	g_uStatus_Z_Axis.bDriveEnabled
			AND	g_uStatus_R_Axis.bDriveEnabled
		THEN
					  g_sMACH.MAN.nStepCounter			:= 002;
		END_IF

	(* --------------------------------------------------------------------------
	 *  S002 All movements
	 *  T998 Never
	 * -------------------------------------------------------------------------- *)
	002:

		(* On Entry *)
		IF			bPulseStepCounter
		THEN
			;
		END_IF

		(* Continuous actions *)
		g_uControl_X_Axis.bManualJogPos			:= g_HMI_MachCommand.bMan_XaxisPos;
		g_uControl_X_Axis.bManualJogNeg			:= g_HMI_MachCommand.bMan_XaxisNeg;
		g_uControl_Y_Axis.bManualJogPos			:= g_HMI_MachCommand.bMan_YaxisPos;
		g_uControl_Y_Axis.bManualJogNeg			:= g_HMI_MachCommand.bMan_YaxisNeg;
		g_uControl_Front_Axis.bManualJogPos		:= g_HMI_MachCommand.bMan_FrontaxisPos;
		g_uControl_Front_Axis.bManualJogNeg		:= g_HMI_MachCommand.bMan_FrontaxisNeg;
		g_uControl_Rear_Axis.bManualJogPos		:= g_HMI_MachCommand.bMan_RearaxisPos;
		g_uControl_Rear_Axis.bManualJogNeg		:= g_HMI_MachCommand.bMan_RearaxisNeg;
		g_uControl_Z_Axis.bManualJogPos			:= g_HMI_MachCommand.bMan_ZaxisPos;
		g_uControl_Z_Axis.bManualJogNeg			:= g_HMI_MachCommand.bMan_ZaxisNeg;
		g_uControl_R_Axis.bManualJogPos			:= g_HMI_MachCommand.bMan_RaxisPos;
		g_uControl_R_Axis.bManualJogNeg			:= g_HMI_MachCommand.bMan_RaxisNeg;
		g_bCMD_US_Test1							:= g_HMI_MachCommand.bTestUltrasonic1;

		(* Cleaning container *)
		g_sMACH.sCleaningContainerControl.bManualPos		:= g_HMI_MachCommand.bMan_CleaningContPos;
		g_sMACH.sCleaningContainerControl.bManualNeg		:= g_HMI_MachCommand.bMan_CleaningContNeg;
		
		(* Water valve *)
		g_bDQ_CleaningWaterValve		:= g_HMI_MachCommand.bMan_CleaningWaterPos;
		
		(* Transitions *)
		IF			g_sMACH.MCL.bStopEndOfCycle
		THEN
					g_sMACH.MAN.nStepCounter			:= C_READY;
		END_IF

	(* --------------------------------------------------------------------------
	 *  S998 C_READY
	 *  T000 Always
	 * -------------------------------------------------------------------------- *)
	C_READY:

		(* On Entry *)
		IF			bPulseStepCounter
		THEN
					g_sMACH.MAN.rWatchdogTime	  := 0;
		END_IF

		(* Continuous actions *)
		g_sMACH.MAN.bManualReady	:= TRUE;

		(* Transitions *)
		IF			TRUE
		THEN
					g_sMACH.MAN.nStepCounter			:= C_INITIAL;
		END_IF

	(* --------------------------------------------------------------------------
	 * Illegal state
	 * -------------------------------------------------------------------------- *)
	ELSE
		(* Programming error: Illegal state *)
		g_sMACH.MAN.rWatchdogTime := 10;
	END_CASE;


	IF		 g_sMACH.MAN.nStepCounter <> C_NOT_ACTIVE
	THEN
	(* -------------------------------------------------------------------------
	 * Poststep Code
	 * ------------------------------------------------------------------------- *)

				g_sMACH.MAN.bManualHold := FALSE;

				g_sMACH.MAN.bManualBusy :=			g_sMACH.MCL.bActManual
											  AND NOT g_sMACH.MAN.bManualHold;

	END_IF

END_PROGRAM
