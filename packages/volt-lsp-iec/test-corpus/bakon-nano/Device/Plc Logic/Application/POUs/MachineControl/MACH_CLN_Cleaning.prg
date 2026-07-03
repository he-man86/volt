PROGRAM MACH_CLN_Cleaning
VAR
	bPulseStepCounter	: BOOL;
	bWait				: BOOL;
	tWatchDogTimer		: TON;
	tStepTimer			: TOF;
	rt_PressStartToInit	: R_TRIG;
END_VAR

(*************************************************************************
 *
 * Application name				: Snijmachine
 * Module name					: MACH_CLN_Cleaning
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

(* Force C_NOT_ACTIVE state *)
IF	NOT g_sMACH.MCL.bActCleaning
THEN
	g_sMACH.CLN.nStepCounter := C_NOT_ACTIVE;
END_IF;


IF		g_sMACH.CLN.nStepCounter <> C_NOT_ACTIVE
THEN
	(* -------------------------------------------------------------------------
	 * Prestep Code
	 * ------------------------------------------------------------------------- *)
				  ;
END_IF;


(* detect change of state *)
bPulseStepCounter	  := g_sMACH.CLN.nStepCounter <> g_sMACH.CLN.nOldStepCounter;
g_sMACH.CLN.nOldStepCounter := g_sMACH.CLN.nStepCounter;

(* Steptimer *)
tStepTimer (IN:= bPulseStepCounter, PT:= REAL_TO_TIME(g_sMACH.CLN.rStepTime));
bWait := tStepTimer.Q;

(* Watchdogtimer *)
tWatchDogTimer (IN:= 	NOT	bPulseStepCounter
					AND		g_sMACH.MCL.bActCleaning
					AND NOT	g_HMI_MachCommand.CMD.bResetErrorPulse
					AND		g_sMACH.CLN.rWatchdogTime <> 0,
				PT:= REAL_TO_TIME(g_sMACH.CLN.rWatchdogTime));
g_sMACH.CLN.bAlmError := tWatchDogTimer.Q;

(* Melding op scherm om startknop in te drukken *)
rt_PressStartToInit(CLK := (g_sMACH.CLN.nStepCounter = C_INITIAL));
IF	rt_PressStartToInit.Q THEN
	g_sMACH.ERR.bPressStartToCleanInit	:= TRUE;
END_IF
IF		g_bSUB_InitStart
	OR	(g_sMACH.CLN.nStepCounter = C_NOT_ACTIVE)
THEN
	g_sMACH.ERR.bPressStartToCleanInit	:= FALSE;
END_IF

CASE g_sMACH.CLN.nStepCounter OF
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
				g_sMACH.CLN.rWatchdogTime					:= 0;
				g_sMACH.CLN.bCleaningReady					:= FALSE;
				g_sMACH.CLN.bCleaningBusy					:= FALSE;

				g_bSUB_InitStart							:= FALSE;

				g_HMI_MachCommand.CMD.bCleanKnifeRequest		:= FALSE;
				g_bSUB_CleanKnifeStart							:= FALSE;
				g_sHMI_Mach_UnitStatus.bKnifeCleaningBusy		:= FALSE;

				g_bCMD_US_Start1 							:= FALSE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		g_sMACH.MCL.bActCleaning
		THEN
				g_sMACH.CLN.nStepCounter			:= C_INITIAL;
		END_IF

	(* --------------------------------------------------------------------------
	 * S000 C_INITIAL
	 *		OnEntry: Ready := FALSE
	 *		OnEntry: Busy  := TRUE
	 *		Enable drives
	 * T001 Drives enabled
	 * -------------------------------------------------------------------------- *)
	C_INITIAL:

		(* On Entry *)
		IF		bPulseStepCounter
		THEN
				g_sMACH.CLN.rWatchdogTime					:= 0;
				g_sMACH.CLN.bCleaningReady					:= FALSE;
				g_sMACH.CLN.bCleaningBusy					:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		g_sMACH.MCL.bStopEndOfCycle
		THEN
				g_sMACH.CLN.nStepCounter			:= C_READY;
		ELSIF			g_bDI_StartButton
				OR NOT	g_bDI_MachineInSafePosition
		THEN
				g_sMACH.CLN.nStepCounter			:= 005;
		END_IF

	(* --------------------------------------------------------------------------
	 * S005 Sub init before starting cleaning
	 * T010 Cleaning
	 * -------------------------------------------------------------------------- *)
	
	005:
		(* On Entry *)
	    IF	bPulseStepCounter
		THEN
			g_sMACH.CLN.rWatchdogTime  			:= 0;
			g_sMACH.CLN.rStepTime				:= 0;
			MACH_SUB_Initialise.I_rX_InfeedPosition		:= g_HMI_MCH_Parameters.rInfeedPosition_X;
			MACH_SUB_Initialise.I_rY_InfeedPosition		:= g_HMI_MCH_Parameters.rInfeedPosition_Y + 30;
			MACH_SUB_Initialise.I_rY_InfeedPrePosition	:= g_HMI_MCH_Parameters.rInfeedPosition_Y + 30;
		END_IF
		
		g_bSUB_InitStart						:= TRUE;

		(* Transitions *)
		IF	g_bSUB_InitDone
		THEN
			g_sMACH.CLN.nStepCounter			:= 010;
			g_bSUB_InitStart := FALSE;
		END_IF
			
	(* --------------------------------------------------------------------------
	 * S010 Enable drives
	 * T015 Drives enabled
	 * -------------------------------------------------------------------------- *)
	010:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.CLN.rWatchdogTime			:= 10*1000;
				g_sMACH.CLN.rStepTime				:= 0;
				g_uControl_X_Axis.bEnableDrive		:= TRUE;
				g_uControl_Y_Axis.bEnableDrive		:= TRUE;
				g_uControl_Front_Axis.bEnableDrive	:= TRUE;
				g_uControl_Rear_Axis.bEnableDrive	:= TRUE;
				g_uControl_Z_Axis.bEnableDrive		:= TRUE;
				g_uControl_R_Axis.bEnableDrive		:= TRUE;
		END_IF

		(* Continuous actions *)
		IF g_sMACH.CLN.bAlmError THEN
			IF NOT g_uStatus_X_Axis.bDriveEnabled
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
		IF		g_uStatus_Z_Axis.bDriveEnabled// AND g_uStatus_Z_Axis.bAutomaticEnabled
			AND	g_uStatus_R_Axis.bDriveEnabled //AND g_uStatus_R_Axis.bAutomaticEnabled
			AND	g_uStatus_X_Axis.bDriveEnabled //AND g_uStatus_X_Axis.bAutomaticEnabled
			AND	g_uStatus_Y_Axis.bDriveEnabled //AND g_uStatus_Y_Axis.bAutomaticEnabled
			AND	g_uStatus_Rear_Axis.bDriveEnabled //AND g_uStatus_Rear_Axis.bAutomaticEnabled
			AND	g_uStatus_Front_Axis.bDriveEnabled //AND g_uStatus_Front_Axis.bAutomaticEnabled
		THEN
				  g_sMACH.CLN.nStepCounter				:= 15;
		END_IF

	(* --------------------------------------------------------------------------
	 * S015 Wait for request from HMI
	 * T020	Start cleaning
	 * T998 Never
	 * -------------------------------------------------------------------------- *)
	015:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.CLN.rWatchdogTime			:= 0;
				g_sMACH.CLN.rStepTime				:= 0;
				//g_uControl_X_Axis.bEnableDrive		:= TRUE;
				//g_uControl_Y_Axis.bEnableDrive		:= TRUE;
				//g_uControl_Front_Axis.bEnableDrive	:= TRUE;
				//g_uControl_Rear_Axis.bEnableDrive	:= TRUE;
				//g_uControl_Z_Axis.bEnableDrive		:= TRUE;
				//g_uControl_R_Axis.bEnableDrive		:= TRUE;
				g_bCMD_US_Start1 						:= TRUE;
		END_IF

		(* Continuous actions *)
		IF		g_HMI_MachCommand.CMD.bCleanKnifeRequest
			OR	g_HMI_MachCommand.CMD.bTableToCleanPos
		THEN
			g_bSUB_CleanKnifeStart	:= TRUE;
		END_IF
		g_sHMI_Mach_UnitStatus.bKnifeCleaningBusy	:= g_bSUB_CleanKnifeStart AND NOT g_sMACH.SUBClean.bSubProcessBusy1;
		g_sHMI_Mach_UnitStatus.bCleaningTableBusy	:= g_bSUB_CleanKnifeStart AND g_sMACH.SUBClean.bSubProcessBusy1;

		IF	g_bSUB_CleanKnifeDone
		THEN
			g_HMI_MachCommand.CMD.bCleanKnifeRequest	:= FALSE;
			g_sHMI_Mach_UnitStatus.bCleaningTableBusy	:= FALSE;
			g_bSUB_CleanKnifeStart			:= FALSE;
		END_IF
			
		(* Transitions *)
		IF		NOT	g_bSUB_CleanKnifeStart
			AND	g_sMACH.MCL.bStopEndOfCycle
		THEN
				  g_sMACH.CLN.nStepCounter				:= C_READY;
		END_IF

	(* --------------------------------------------------------------------------
	 * S020	Start cleaning
	 * T15	Cleaning done
	 * -------------------------------------------------------------------------- *)
	020:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.CLN.rWatchdogTime			:= 0;
				g_sMACH.CLN.rStepTime				:= 0;
				g_uControl_X_Axis.bEnableDrive		:= TRUE;
				g_uControl_Y_Axis.bEnableDrive		:= TRUE;
				g_uControl_Front_Axis.bEnableDrive	:= TRUE;
				g_uControl_Rear_Axis.bEnableDrive	:= TRUE;
				g_uControl_Z_Axis.bEnableDrive		:= TRUE;
				g_uControl_R_Axis.bEnableDrive		:= TRUE;
		END_IF

		IF		g_HMI_MachCommand.CMD.bCleanKnifeRequest
		THEN
			g_bSUB_CleanKnifeStart	:= TRUE;
		END_IF
		g_sHMI_Mach_UnitStatus.bKnifeCleaningBusy	:= g_bSUB_CleanKnifeStart;

		(* Transitions *)
		IF	g_bSUB_CleanKnifeDone
		THEN
			g_HMI_MachCommand.CMD.bCleanKnifeRequest:= FALSE;
			g_sHMI_Mach_UnitStatus.bKnifeCleaningBusy	:= FALSE;
			g_bSUB_CleanKnifeStart			:= FALSE;
			g_sMACH.CLN.nStepCounter		:= 15;
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
					  g_sMACH.CLN.rWatchdogTime	:= 0;
					  g_sMACH.CLN.bCleaningReady	:= TRUE;
					  g_sMACH.CLN.bCleaningBusy		:= FALSE;
					g_bCMD_US_Start1 				:= FALSE;
		END_IF

		(* Continuous actions *)
		g_sMACH.CLN.bCleaningReady					:= TRUE;

		(* Transitions *)
		IF			FALSE
		THEN
					  g_sMACH.CLN.nStepCounter				:= C_INITIAL;
		END_IF

(* --------------------------------------------------------------------------
 * Illegal state
 * -------------------------------------------------------------------------- *)
ELSE
	(* Programming error: Illegal state *)
	g_sMACH.CLN.rWatchdogTime := 10;
END_CASE;


IF			g_sMACH.CLN.nStepCounter <> C_NOT_ACTIVE
THEN
	(* -------------------------------------------------------------------------
	 * Poststep Code
	 * ------------------------------------------------------------------------- *)
	;
END_IF

END_PROGRAM
