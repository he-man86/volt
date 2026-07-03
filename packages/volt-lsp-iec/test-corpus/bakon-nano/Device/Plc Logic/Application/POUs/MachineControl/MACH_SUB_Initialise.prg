PROGRAM MACH_SUB_Initialise
VAR
	bPulseStepCounter		: BOOL;
	bWait					: BOOL;
	tWatchDogTimer			: TON;
	tStepTimer				: TOF;
	tDelayStep5				: TON;
END_VAR
VAR_INPUT
	I_rX_InfeedPosition		: REAL;
	I_rY_InfeedPosition		: REAL;
	I_rY_InfeedPrePosition	: REAL;
END_VAR

(*************************************************************************
 *
 * Application name				: Snijmachine
 * Module name					: MACH_SUB_Initialise
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
 * Update  : 0.00																				  
 * Author  :	 K. Kole																		  
 * Changes : 
 *************************************************************************)

(* Force C_NOT_ACTIVE state *)
IF	  NOT g_bSUB_InitStart
THEN
		  g_sMACH.SUBInit.nStepCounter := C_NOT_ACTIVE;
END_IF

IF		g_sMACH.SUBInit.nStepCounter <> C_NOT_ACTIVE
THEN
	(* -------------------------------------------------------------------------
	 * Prestep Code
	 * ------------------------------------------------------------------------- *)
				  ;
END_IF

(* detect change of state *)
bPulseStepCounter	  := g_sMACH.SUBInit.nStepCounter <> g_sMACH.SUBInit.nOldStepCounter;
g_sMACH.SUBInit.nOldStepCounter := g_sMACH.SUBInit.nStepCounter;

(* Steptimer *)
tStepTimer (IN:= bPulseStepCounter, PT:= REAL_TO_TIME(g_sMACH.SUBInit.rStepTime));
bWait := tStepTimer.Q;

(* Watchdogtimer *)
tWatchDogTimer (IN:= 	NOT	bPulseStepCounter
						AND		g_bSUB_InitStart
						AND NOT	g_HMI_MachCommand.CMD.bResetErrorPulse
						AND		g_sMACH.SUBInit.rWatchdogTime <> 0,
					PT:= REAL_TO_TIME(g_sMACH.SUBInit.rWatchdogTime));
g_sMACH.SUBInit.bAlmError := tWatchDogTimer.Q;

tDelayStep5(IN:= , PT:= T#200MS, Q=> , ET=> );

CASE g_sMACH.SUBInit.nStepCounter OF
	(* --------------------------------------------------------------------------
	 * S-1  C_NOT_ACTIVE
	 *		OnEntry: Ready  := FALSE
	 *		OnEntry: Busy	:= FALSE
	 *		OnEntry: Reset all non-stored commands
	 * T000 Activate signal
	 * -------------------------------------------------------------------------- *)
	C_NOT_ACTIVE:

		(* On Entry *)
		IF		bPulseStepCounter
		THEN
				g_sMACH.SUBInit.rWatchdogTime				:= 0;
				g_sMACH.SUBInit.bSubReady					:= FALSE;
				g_sMACH.SUBInit.bSubBusy					:= FALSE;

				g_bSUB_InitDone								:= FALSE;

				g_uControl_X_Axis.bEnableDrive				:= FALSE;
				g_uControl_X_Axis.bPosABSPosition			:= FALSE;
				//g_uControl_X_Axis.bStartManualMode		:= FALSE;

				g_uControl_Y_Axis.bEnableDrive				:= FALSE;
				g_uControl_Y_Axis.bPosABSPosition			:= FALSE;
				//g_uControl_Y_Axis.bStartManualMode		:= FALSE;

				//g_uControl_Front_Axis.bEnableDrive		:= FALSE;
				//g_uControl_Front_Axis.bAutomatic			:= FALSE;

				//g_uControl_Rear_Axis.bEnableDrive			:= FALSE;
				//g_uControl_Rear_Axis.bAutomatic			:= FALSE;

				g_uControl_Z_Axis.bEnableDrive				:= FALSE;
				//g_uControl_Z_Axis.bStartManualMode		:= FALSE;
				g_uControl_Z_Axis.bStartHoming				:= FALSE;
				g_uControl_Z_Axis.bPosABSPosition			:= FALSE;	(* Used only after axis has first been homed to its sensor *)

				g_uControl_R_Axis.bEnableDrive				:= FALSE;
				g_uControl_R_Axis.bPosABSPosition			:= FALSE;
				//g_uControl_R_Axis.bStartManualMode		:= FALSE;
				
				g_sMACH.sCleaningContainerControl.bPosExecute := FALSE;

		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		g_bSUB_InitStart
		THEN
				g_sMACH.SUBInit.nStepCounter			:= C_INITIAL;
		END_IF

	(* --------------------------------------------------------------------------
	 * S000 C_INITIAL
	 *		OnEntry: Ready := FALSE
	 *		OnEntry: Busy  := TRUE
	 * T001 Always
	 * -------------------------------------------------------------------------- *)
	C_INITIAL:

		(* On Entry *)
		IF			bPulseStepCounter
		THEN
					g_sMACH.SUBInit.rWatchdogTime			:= 10 * 1000;
					g_sMACH.SUBInit.bSUBReady				:= FALSE;
					g_sMACH.SUBInit.bSUBBusy				:= TRUE;
					
					tDelayStep5.IN := FALSE;

					g_uControl_X_Axis.bEnableDrive		:= TRUE;
					g_uControl_Y_Axis.bEnableDrive		:= TRUE;
					g_uControl_Front_Axis.bEnableDrive	:= TRUE;
					g_uControl_Rear_Axis.bEnableDrive	:= TRUE;
					g_uControl_Z_Axis.bEnableDrive		:= TRUE;
					g_uControl_R_Axis.bEnableDrive		:= TRUE;

		END_IF

		(* Continuous actions *)
		Calc_BottomPos();	// Calculate Z bottom pos and pos above product
	
		IF g_sMACH.SUBInit.bAlmError THEN
			IF 	NOT g_uStatus_X_Axis.bDriveEnabled
				OR NOT g_uStatus_Y_Axis.bDriveEnabled
				OR NOT g_uStatus_Front_Axis.bDriveEnabled
				OR NOT g_uStatus_Rear_Axis.bDriveEnabled
			THEN
				g_sMACH.ERR.bXYNotEnabled := TRUE;	
			END_IF
			IF NOT g_uStatus_Z_Axis.bDriveEnabled THEN
				g_sMACH.ERR.bZNotEnabled := TRUE;
			END_IF
			IF NOT g_uStatus_R_Axis.bDriveEnabled THEN
				g_sMACH.ERR.bRNotEnabled := TRUE;
			END_IF
		END_IF
		
		(* Transitions *)
		IF		g_uStatus_X_Axis.bDriveEnabled
			AND	g_uStatus_Y_Axis.bDriveEnabled
			AND	g_uStatus_Front_Axis.bDriveEnabled //bAutomaticEnabled
			AND	g_uStatus_Rear_Axis.bDriveEnabled //bAutomaticEnabled
			AND	g_uStatus_Z_Axis.bDriveEnabled
			AND	g_uStatus_R_Axis.bDriveEnabled
		THEN
					tDelayStep5.IN := TRUE;
					IF tDelayStep5.Q THEN
						tDelayStep5.IN := FALSE;
						g_sMACH.SUBInit.nStepCounter			:= 005;
					END_IF
		END_IF

	(* --------------------------------------------------------------------------
	 * S005 Start homing Z
	 * T010 Z axis busy
	 * -------------------------------------------------------------------------- *)
	005:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBInit.rWatchdogTime			:= 0;
				g_sMACH.SUBInit.rStepTime				:= 0;
				IF g_uStatus_Z_Axis.bHomePositionAvailable THEN
					g_uControl_Z_Axis.lrPosition			:= 0;
					g_uControl_Z_Axis.bPosABSPosition	:= TRUE;
				ELSE
					g_uControl_Z_Axis.bStartHoming	:= TRUE;
				END_IF
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			g_uStatus_Z_Axis.bHomingBusy
				OR	g_uStatus_Z_Axis.bMoveAbsDone
		THEN
					g_sMACH.SUBInit.nStepCounter				:= 010;
		END_IF

	(* --------------------------------------------------------------------------
	 * S010 Wait Z homing done
	 * T015 Z axis Homing done
	 * -------------------------------------------------------------------------- *)
	010:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBInit.rWatchdogTime		:= 0;
				g_sMACH.SUBInit.rStepTime				:= 0;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			(g_uStatus_Z_Axis.bHomingDone OR g_uStatus_Z_Axis.bMoveAbsDone)
		THEN
					g_uControl_Z_Axis.bStartHoming		:= FALSE;
					g_uControl_Z_Axis.bPosABSPosition	:= FALSE;
					g_sMACH.SUBInit.nStepCounter			:= 015;
		END_IF

	(* --------------------------------------------------------------------------
	 * S015 Start homing R and cleaning cylinder down
	 * T020 R axis busy
	 * -------------------------------------------------------------------------- *)
	015:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBInit.rWatchdogTime		:= 0;
				g_sMACH.SUBInit.rStepTime			:= 500;
				g_uControl_R_Axis.lrPosition		:= 0;
				g_uControl_R_Axis.bPosABSPosition	:= TRUE;
				g_sMACH.sCleaningContainerControl.rTargetPosition := 0;
				g_sMACH.sCleaningContainerControl.bPosExecute := gMachConfig.bCleaningUnit;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF	NOT bWait
		THEN
					g_sMACH.SUBInit.nStepCounter				:= 020;
		END_IF

	(* --------------------------------------------------------------------------
	 * S020 Wait for R homing done
	 * T025 R-axis homing done
	 * -------------------------------------------------------------------------- *)
	020:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBInit.rWatchdogTime		:= 0;
				g_sMACH.SUBInit.rStepTime			:= 0;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		g_uStatus_R_Axis.bMoveAbsDone
			AND (g_sMACH.sCleaningContainerStatus.rActualPosition = 0 OR NOT gMachConfig.bCleaningUnit)
		THEN
				g_uControl_R_Axis.bPosABSPosition	:= FALSE;
				g_sMACH.sCleaningContainerControl.bPosExecute	:= FALSE;
				g_sMACH.SUBInit.nStepCounter			:= 025;
		END_IF

	(* --------------------------------------------------------------------------
	 * S025 Start positioning Y to pre infeed position
	 * T030 Y axis ready
	 * -------------------------------------------------------------------------- *)
	025:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBInit.rWatchdogTime		:= 0;
				g_sMACH.SUBInit.rStepTime			:= 0;
				g_uControl_Y_Axis.lrPosition		:= I_rY_InfeedPrePosition;
				g_uControl_Y_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			g_uStatus_Y_Axis.bMoveAbsDone
		THEN
					g_uControl_Y_Axis.bPosABSPosition	:= FALSE;
					g_sMACH.SUBInit.nStepCounter		:= 030;
		END_IF

	(* --------------------------------------------------------------------------
	 * S030 Start homing X
	 * T035 X axis ready
	 * -------------------------------------------------------------------------- *)
	030:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBInit.rWatchdogTime		:= 0;
				g_sMACH.SUBInit.rStepTime				:= 0;
				g_uControl_X_Axis.lrPosition			:= I_rX_InfeedPosition;
				g_uControl_X_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			g_uStatus_X_Axis.bMoveAbsDone
		THEN
					g_uControl_X_Axis.bPosABSPosition	:= FALSE;
					g_sMACH.SUBInit.nStepCounter			:= 035;
		END_IF

	(* --------------------------------------------------------------------------
	 * S035 Start homing Y
	 * T040 Y axis ready
	 * -------------------------------------------------------------------------- *)
	035:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBInit.rWatchdogTime		:= 0;
				g_sMACH.SUBInit.rStepTime			:= 0;
				g_uControl_Y_Axis.lrPosition		:= I_rY_InfeedPosition;
				g_uControl_Y_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			g_uStatus_Y_Axis.bMoveAbsDone
		THEN
					g_uControl_Y_Axis.bPosABSPosition	:= FALSE;
					g_sMACH.SUBInit.nStepCounter			:= 040;
		END_IF

	(* --------------------------------------------------------------------------
	 * S040 Stop manual mode of drives
	 * C_READY All axis out of manual mode
	 * -------------------------------------------------------------------------- *)
	040:

		(* On Entry *)
		IF		bPulseStepCounter
		THEN
				g_sMACH.SUBInit.rWatchdogTime		:= 0;
				g_sMACH.SUBInit.rStepTime				:= 400;
		END_IF

		(* Continuous actions *)
		IF NOT	bWait
		THEN
				(*g_uControl_X_Axis.bStartManualMode		:= FALSE;
				g_uControl_Y_Axis.bStartManualMode		:= FALSE;
				g_uControl_Front_Axis.bAutomatic			:= FALSE;
				g_uControl_Rear_Axis.bAutomatic			:= FALSE;
				g_uControl_Z_Axis.bStartManualMode		:= FALSE;
				g_uControl_R_Axis.bStartManualMode		:= FALSE;*)
		END_IF

		(* Transitions *)
		IF			g_uStatus_X_Axis.eStateAxis = L_MC1P_AXIS_STATE.StandStill
			AND 	g_uStatus_Y_Axis.eStateAxis = L_MC1P_AXIS_STATE.StandStill
			(*AND 	g_uStatus_Front_Axis.eStateAxis = L_MC1P_AXIS_STATE.StandStill
			AND 	g_uStatus_Rear_Axis.eStateAxis = L_MC1P_AXIS_STATE.StandStill*)
			AND 	g_uStatus_Z_Axis.eStateAxis = L_MC1P_AXIS_STATE.StandStill
			AND 	g_uStatus_R_Axis.eStateAxis = L_MC1P_AXIS_STATE.StandStill
		THEN
					g_uControl_X_Axis.bEnableDrive		:= FALSE;
					g_uControl_Y_Axis.bEnableDrive		:= FALSE;
					//g_uControl_Front_Axis.bEnableDrive	:= FALSE;
					//g_uControl_Rear_Axis.bEnableDrive	:= FALSE;
					g_uControl_Z_Axis.bEnableDrive		:= FALSE;
					g_uControl_R_Axis.bEnableDrive		:= FALSE;

					g_sMACH.SUBInit.nStepCounter				:= C_READY;
		END_IF

	(* --------------------------------------------------------------------------
	 * S998 C_READY
	 *		OnEntry: Ready		:= TRUE
	 *		OnEntry: Busy		 := FALSE
	 *		Always : Activate errorhandler
	 * T000 Never
	 * -------------------------------------------------------------------------- *)
	C_READY:

		(* On Entry *)
		IF			bPulseStepCounter
		THEN
					g_sMACH.SUBInit.rWatchdogTime	:= 0;
					g_sMACH.SUBInit.bSUBReady		:= TRUE;
					g_sMACH.SUBInit.bSUBBusy		:= FALSE;
		END_IF

		(* Continuous actions *)
		g_bSUB_InitDone		:= TRUE;

		(* Transitions *)
		IF			FALSE
		THEN
					g_sMACH.SUBInit.nStepCounter				:= C_INITIAL;
		END_IF

(* --------------------------------------------------------------------------
 * Illegal state
 * -------------------------------------------------------------------------- *)
ELSE
	(* Programming error: Illegal state *)
	g_sMACH.SUBInit.rWatchdogTime := 10;
END_CASE;


IF			g_sMACH.SUBInit.nStepCounter <> C_NOT_ACTIVE
THEN
	(* -------------------------------------------------------------------------
	 * Poststep Code
	 * ------------------------------------------------------------------------- *)
	;
END_IF

END_PROGRAM
