
PROGRAM MACH_SUB_CleanCycle
VAR
	bPulseStepCounter		: BOOL;
	bWait					: BOOL;
	bTableToSafeCleanPos	: BOOL;
	bCleanWithScraper		: BOOL;
	bCleanWithWater			: BOOL;
	rSafePosX				: REAL;
	tWatchDogTimer			: TON;
	tStepTimer				: TOF;
END_VAR

(*************************************************************************
 *
 * Application name				: Snijmachine Quintens
 * Module name					: MACH_Sub_CleanCycle
 * Version number module		: 0.10
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
 * Update 	: 0.10																			  
 * Author 	: K. Kole																			  
 *************************************************************************)

(* Force C_NOT_ACTIVE state *)
IF	  NOT 	g_bSUB_CleanKnifeStart
THEN
			g_sMACH.SUBClean.nStepCounter := C_NOT_ACTIVE;
END_IF;


IF			g_sMACH.SUBClean.nStepCounter <> C_NOT_ACTIVE
THEN
	(* -------------------------------------------------------------------------
	 * Prestep Code
	 * ------------------------------------------------------------------------- *)
				  ;
END_IF;


(* detect change of state *)
bPulseStepCounter			  := g_sMACH.SUBClean.nStepCounter <> g_sMACH.SUBClean.nOldStepCounter;
g_sMACH.SUBClean.nOldStepCounter := g_sMACH.SUBClean.nStepCounter;

(* Steptimer *)
tStepTimer (IN:= bPulseStepCounter, PT:= REAL_TO_TIME(g_sMACH.SUBClean.rStepTime));
bWait := tStepTimer.Q;

(* Watchdogtimer *)
tWatchDogTimer (IN:= 	NOT	bPulseStepCounter
						AND		g_bSUB_CleanKnifeStart
						AND NOT	g_HMI_MachCommand.CMD.bResetErrorPulse
						AND		g_sMACH.SUBClean.rWatchdogTime <> 0,
					PT:= REAL_TO_TIME(g_sMACH.SUBClean.rWatchdogTime));
g_sMACH.SUBClean.bAlmError := tWatchDogTimer.Q;

g_sMACH.SUBClean.bSubProcessBusy1	:= bTableToSafeCleanPos;
rSafePosX	:= 2.1;

CASE g_sMACH.SUBClean.nStepCounter OF
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
				g_sMACH.SUBClean.rWatchdogTime	:= 0;
				g_sMACH.SUBClean.bSubReady		:= FALSE;
				g_sMACH.SUBClean.bSubBusy		:= FALSE;

				g_bSUB_CleanKnifeDone			:= FALSE;

				g_sMACH.SUBClean.bPreventAction	:= FALSE;

				//g_uControl_X_Axis.bEnableDrive				:= FALSE;
				g_uControl_X_Axis.bPosABSPosition			:= FALSE;

				//g_uControl_Y_Axis.bEnableDrive				:= FALSE;
				g_uControl_Y_Axis.bPosABSPosition			:= FALSE;

				//g_uControl_Z_Axis.bEnableDrive				:= FALSE;
				g_uControl_Z_Axis.bStartHoming				:= FALSE;
				g_uControl_Z_Axis.bPosABSPosition			:= FALSE;	(* Used only after axis has first been homed to its sensor *)

				//g_uControl_R_Axis.bEnableDrive				:= FALSE;
				g_uControl_R_Axis.bPosABSPosition			:= FALSE;

				g_sMACH.sCleaningContainerControl.bPosExecute := FALSE;
				g_bDQ_CleaningWaterValve					:= FALSE;
				g_bDQ_CleaningAirValve := FALSE;
				//g_bCMD_US_Start1 							:= FALSE;
				g_bUS_EnableCleaning						:= FALSE;

				bTableToSafeCleanPos						:= FALSE;		(* Move table to safe position only, thus no cleaning of knife *)
		END_IF

		(* Continuous actions *)
		bCleanWithScraper	:=		(g_HMI_RCP_Parameters.nCleanWithScraper <= 1)		// Recipe value only valid at beginning of cycle
								OR	g_sMACH.MCL.bActCleaning;							// In cleaning mode scraper always in use
		bCleanWithWater		:=		(g_HMI_RCP_Parameters.nCleanWithScraper <> 1) 
								OR  g_sMACH.MCL.bActCleaning;		
								
		(* Transitions *)
		IF		g_bSUB_CleanKnifeStart
		THEN
				g_uControl_X_Axis.bEnableDrive		:= TRUE;
				g_uControl_Y_Axis.bEnableDrive		:= TRUE;
				g_uControl_Front_Axis.bEnableDrive	:= TRUE;
				g_uControl_Rear_Axis.bEnableDrive	:= TRUE;
				g_uControl_Z_Axis.bEnableDrive		:= TRUE;
				g_uControl_R_Axis.bEnableDrive		:= TRUE;
				IF		g_sMACH.MCL.bActCleaning
					AND	g_HMI_MachCommand.CMD.bTableToCleanPos
				THEN
					bTableToSafeCleanPos	:= TRUE;		(* Move table to safe position only, thus no cleaning of knife *)
				END_IF
				g_sMACH.SUBClean.nStepCounter		:= C_INITIAL;
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
					g_sMACH.SUBClean.rWatchdogTime		:= 10 * 1000;
					g_sMACH.SUBClean.bSubReady			:= FALSE;
					g_sMACH.SUBClean.bSubBusy			:= TRUE;
		END_IF

		(* Continuous actions *)
		IF g_sMACH.SUBClean.bAlmError THEN
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
			g_sMACH.SUBClean.nStepCounter	:= 005;
		END_IF

	(* --------------------------------------------------------------------------
	 * S005 Move Z to safe position
	 * T010 Z axis busy
	 * -------------------------------------------------------------------------- *)
	005:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 0;
				g_uControl_Z_Axis.lrPosition		:= g_sCalculated.rAboveProductPos;
				g_uControl_Z_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		g_uStatus_Z_Axis.bMoveAbsDone
		THEN
				g_sMACH.SUBClean.nStepCounter				:= 010;
		END_IF

	(* --------------------------------------------------------------------------
	 * S010 Wait Z positioning to safe pos done
	 * T015 Z axis positioning done
	 * -------------------------------------------------------------------------- *)
	010:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 0;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			g_uStatus_Z_Axis.bMoveAbsDone
		THEN
					g_uControl_Z_Axis.bPosABSPosition	:= FALSE;
					g_sMACH.SUBClean.nStepCounter		:= 015;
		END_IF

	(* --------------------------------------------------------------------------
	 * S015 Move cleaning cylinder down. 
	 * T020 Cleaning cylinder busy
	 * -------------------------------------------------------------------------- *)
	015:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 100;
				g_sMACH.sCleaningContainerControl.rTargetPosition := 0;
				g_sMACH.sCleaningContainerControl.bPosExecute := gMachConfig.bCleaningUnit;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF	NOT bWait
		THEN
					g_sMACH.SUBClean.nStepCounter		:= 020;
		END_IF

	(* --------------------------------------------------------------------------
	 * S020 Wait for R positioning to 90 dgrees done
	 * T025 R-axis positioning done AND NOT bTableToCleanPos
	 * T040 R-axis positioning done AND bTableToCleanPos
	 * -------------------------------------------------------------------------- *)
	020:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 0;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF	(g_sMACH.sCleaningContainerStatus.rActualPosition = 0 OR NOT gMachConfig.bCleaningUnit)
		THEN
				g_sMACH.sCleaningContainerControl.bPosExecute	:= FALSE;
				g_sMACH.SUBClean.nStepCounter			:= 025;
		END_IF

	(* --------------------------------------------------------------------------
	 * S025 Move X to start position or to Safe pos X (2.1)
	 *		Move Y to start cleaning position OR End cleaning position when TableToSafePos or Not UseScraper
	 *		Move R to 90 degrees and cleaning cylinder down. 
	 * T030 X, Y and R axis ready
	 * -------------------------------------------------------------------------- *)
	025:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 0;
				IF	bTableToSafeCleanPos THEN
					g_uControl_X_Axis.lrPosition		:= rSafePosX;
					g_uControl_Y_Axis.lrPosition		:= g_HMI_MCH_Parameters.rCleanYPosStop;
				ELSIF NOT bCleanWithScraper THEN
					g_uControl_X_Axis.lrPosition		:= rSafePosX;			
					g_uControl_Y_Axis.lrPosition		:= g_HMI_MCH_Parameters.rCleanYPosStop;
				ELSE
					g_uControl_X_Axis.lrPosition		:= g_HMI_MCH_Parameters.rCleanXPosStart; 
					g_uControl_Y_Axis.lrPosition		:= g_HMI_MCH_Parameters.rCleanYPosStart;
				END_IF
				g_uControl_X_Axis.bPosABSPosition	:= TRUE;
				g_uControl_Y_Axis.bPosABSPosition	:= TRUE;
				g_uControl_R_Axis.lrPosition		:= 90;
				g_uControl_R_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			g_uStatus_R_Axis.bMoveAbsDone
			AND		g_uStatus_Y_Axis.bMoveAbsDone
			AND		g_uStatus_X_Axis.bMoveAbsDone
			AND		(g_uStatus_X_Axis.lrActPosition < g_HMI_MCH_Parameters.rCleanXPosStart + 1)		// "Dubbele" controle...
		THEN
					g_uControl_X_Axis.bPosABSPosition	:= FALSE;
					g_uControl_Y_Axis.bPosABSPosition	:= FALSE;
					g_uControl_R_Axis.bPosABSPosition	:= FALSE;
					IF	bTableToSafeCleanPos THEN
						g_sMACH.SUBClean.nStepCounter		:= C_READY;
					ELSIF NOT bCleanWithScraper THEN
						g_sMACH.SUBClean.nStepCounter		:= 045;			
					ELSE
						g_sMACH.SUBClean.nStepCounter		:= 030;
					END_IF
		END_IF

	(* --------------------------------------------------------------------------
	 * S030 Move Z t cleaning position
	 * T035 Z axis ready and clean with scraper
	 * T040 Z axis ready and clean without scraper
	 * -------------------------------------------------------------------------- *)
	030:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 0;
				g_uControl_Z_Axis.lrPosition		:= g_HMI_MCH_Parameters.rCleanZPosFlap;
				g_uControl_Z_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			g_uStatus_Z_Axis.bMoveAbsDone
		THEN
					g_uControl_Z_Axis.bPosABSPosition	:= FALSE;
					g_sMACH.SUBClean.nStepCounter		:= 035;
		END_IF

	(* --------------------------------------------------------------------------
	 * S035 Start positioning Y to end position
	 * T040 Y axis ready
	 * -------------------------------------------------------------------------- *)
	035:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 0;
				g_uControl_Y_Axis.lrPosition		:= g_HMI_MCH_Parameters.rCleanYPosStop;
				g_uControl_Y_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			g_uStatus_Y_Axis.bMoveAbsDone
		THEN
					g_uControl_Y_Axis.bPosABSPosition	:= FALSE;
					g_sMACH.SUBClean.nStepCounter		:= 040;
		END_IF
		
	(* --------------------------------------------------------------------------
	 * S040 Start positioning X to safe position
	 * T045 X axis ready
	 * -------------------------------------------------------------------------- *)
	040:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 0;
				g_uControl_X_Axis.lrPosition		:= rSafePosX;		(* Fixed position!! *)
				g_uControl_X_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		g_uStatus_X_Axis.bMoveAbsDone
		THEN
				g_uControl_X_Axis.bPosABSPosition	:= FALSE;
				IF bCleanWithWater THEN
					g_sMACH.SUBClean.nStepCounter		:= 45;
				ELSE
					g_sMACH.SUBClean.nStepCounter		:= 065;
				END_IF
		END_IF

	(* --------------------------------------------------------------------------
	 * S045 Move Cleaning unit up and move Z-axis to spray water position
	 * T050 Cleaning unit up
	 * -------------------------------------------------------------------------- *)
	045:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 0;
				g_sMACH.sCleaningContainerControl.rTargetPosition := 1;
				g_sMACH.sCleaningContainerControl.bPosExecute := gMachConfig.bCleaningUnit;
				g_uControl_Z_Axis.lrPosition		:= g_HMI_MCH_Parameters.rCleanZPosWaterContainer;
				g_uControl_Z_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			g_sMACH.sCleaningContainerStatus.rActualPosition = 1
				AND	g_uStatus_Z_Axis.bMoveAbsDone
		THEN
					g_uControl_Z_Axis.bPosABSPosition	:= FALSE;
					g_sMACH.sCleaningContainerControl.bPosExecute	:= FALSE;
					g_sMACH.SUBClean.nStepCounter		:= 050;
		END_IF

	(* --------------------------------------------------------------------------
	 * S050 Start spraying water
	 * T055 Water spraying ready
	 * -------------------------------------------------------------------------- *)
	050:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= g_HMI_RCP_Parameters.rCleaningTimeWater * 1000;
				g_bDQ_CleaningWaterValve			:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		NOT bWait
		THEN
				g_bDQ_CleaningWaterValve			:= FALSE;
				g_sMACH.SUBClean.nStepCounter		:= 052;
		END_IF
		
	(* --------------------------------------------------------------------------
	 * S052 Activate ultrasonic
	 * T053 Ultrasonic ready
	 * -------------------------------------------------------------------------- *)
	052:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= g_HMI_RCP_Parameters.rCleaningTimeUltrasonic * 1000;
				//g_bCMD_US_Start1 					:= TRUE;
				g_bUS_EnableCleaning				:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		NOT bWait
		THEN
				//g_bCMD_US_Start1 					:= FALSE;
				g_bUS_EnableCleaning				:= FALSE;
				g_sMACH.SUBClean.nStepCounter		:= 053;
		END_IF
		
		
	(* --------------------------------------------------------------------------
	 * S053 Start spraying air
	 * T055 Air spraying done
	 * -------------------------------------------------------------------------- *)
	053:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= g_HMI_RCP_Parameters.rCleaningTimeAir * 1000;
				g_bDQ_CleaningAirValve			:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		NOT bWait
		THEN
				g_sMACH.SUBClean.nStepCounter		:= 055;
		END_IF

	(* --------------------------------------------------------------------------
	 * S055 Move Cleaning unit down (safe position)
	 * T060 X axis ready
	 * -------------------------------------------------------------------------- *)
	055:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 0;
				g_sMACH.sCleaningContainerControl.rTargetPosition := 0;
				g_sMACH.sCleaningContainerControl.bPosExecute := gMachConfig.bCleaningUnit;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			g_sMACH.sCleaningContainerStatus.rActualPosition = 0 OR NOT gMachConfig.bCleaningUnit
		THEN
					g_bDQ_CleaningAirValve := FALSE;
					g_sMACH.sCleaningContainerControl.bPosExecute	:= FALSE;
					g_sMACH.SUBClean.nStepCounter		:= 065;
		END_IF


	(* --------------------------------------------------------------------------
	 * S065 Move Z to safe position
	 * READY Z axis done and automatic
	 * -------------------------------------------------------------------------- *)
	065:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime			:= 0;
				g_sMACH.SUBClean.rStepTime				:= 0;
				g_uControl_Z_Axis.lrPosition			:= g_sCalculated.rAboveProductPos;
				g_uControl_Z_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		g_uStatus_Z_Axis.bMoveAbsDone
		THEN
				g_uControl_Z_Axis.bPosABSPosition	:= FALSE;
				IF g_sMACH.MCL.bActAutomatic THEN
					g_sMACH.SUBClean.nStepCounter		:= C_READY;
				ELSE
					g_sMACH.SUBClean.nStepCounter		:= 070;
				END_IF
		END_IF

	(* --------------------------------------------------------------------------
	 * S070 Start positioning Y to pre infeed position (+ 30)
	 * T075 Y axis ready
	 * -------------------------------------------------------------------------- *)
	070:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 0;
				g_uControl_Y_Axis.lrPosition		:= g_HMI_MCH_Parameters.rInfeedPosition_Y + 30;
				g_uControl_Y_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			g_uStatus_Y_Axis.bMoveAbsDone
		THEN
					g_uControl_Y_Axis.bPosABSPosition	:= FALSE;
					g_sMACH.SUBClean.nStepCounter		:= 075;
		END_IF

	(* --------------------------------------------------------------------------
	 * S075 Start homing X, R to zero
	 * T080 X axis ready
	 * -------------------------------------------------------------------------- *)
	075:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 0;
				g_uControl_X_Axis.lrPosition		:= g_HMI_MCH_Parameters.rInfeedPosition_X;
				g_uControl_X_Axis.bPosABSPosition	:= TRUE;
				g_uControl_R_Axis.lrPosition		:= 0;
				g_uControl_R_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			g_uStatus_X_Axis.bMoveAbsDone
			AND		g_uStatus_R_Axis.bMoveAbsDone
		THEN
					g_uControl_X_Axis.bPosABSPosition	:= FALSE;
					g_uControl_R_Axis.bPosABSPosition	:= FALSE;
					//IF g_sMACH.MCL.bActAutomatic THEN
					//	g_sMACH.SUBClean.nStepCounter		:= 80;
					//ELSE
						g_sMACH.SUBClean.nStepCounter		:= C_READY;
					//END_IF
		END_IF

	(* --------------------------------------------------------------------------
	 * S080 Start homing Y
	 * Ready Y axis ready
	 * -------------------------------------------------------------------------- *)
	080:

		(* On Entry *)
		IF		 bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime		:= 0;
				g_sMACH.SUBClean.rStepTime			:= 0;
				g_uControl_Y_Axis.lrPosition		:= g_HMI_MCH_Parameters.rInfeedPosition_Y;
				g_uControl_Y_Axis.bPosABSPosition	:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		g_uStatus_Y_Axis.bMoveAbsDone
		THEN
				g_uControl_Y_Axis.bPosABSPosition	:= FALSE;
				g_sMACH.SUBClean.nStepCounter		:= C_READY;
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
		IF		bPulseStepCounter
		THEN
				g_sMACH.SUBClean.rWatchdogTime	:= 0;
				g_sMACH.SUBClean.bSubReady		:= TRUE;
				g_sMACH.SUBClean.bSubBusy		:= FALSE;
		END_IF

		(* Continuous actions *)
		g_bSUB_CleanKnifeDone							:= TRUE;

		(* Transitions *)
		IF			FALSE
		THEN
					g_sMACH.SUBClean.nStepCounter		:= C_INITIAL;
		END_IF

(* --------------------------------------------------------------------------
 * Illegal state
 * -------------------------------------------------------------------------- *)
ELSE
	(* Programming error: Illegal state *)
	g_sMACH.SUBClean.rWatchdogTime := 10;
END_CASE;


IF			g_sMACH.SUBClean.nStepCounter <> C_NOT_ACTIVE
THEN
	(* -------------------------------------------------------------------------
	 * Poststep Code
	 * ------------------------------------------------------------------------- *)
	;
END_IF

END_PROGRAM
