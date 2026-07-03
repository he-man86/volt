PROGRAM MACH_AUT_Automatic
VAR
	tWatchDogTimer					: TON;
	tStepTimer						: TOF;
	bwait                  			: BOOL;
	bPulseStepCounter      			: BOOL;
	bHoldPointOnReq        			: BOOL;
	bHoldPointOnErr3       			: BOOL;
	bStopPointAutomatic    			: BOOL;

	bOnePiece						: BOOL;
	bStartButtonPressed				: BOOL;
	nOldProductType					: INT;
	nOldNumberRoundParts			: INT;
	nDebugLastStep					: INT;
	bStartedOnce						: BOOL := FALSE;
	rt_PressStartToInit: R_TRIG;
	tofRecipeLoad					: TOF;
	bStartPressedWhileLoadeing	: BOOL := FALSE;
	sOldRecipeName					: STRING;
	tMachineInSafePosition			: TOF;
	bFirstTimeWaitForExec: BOOL;
	nScanCount : INT;
	bStartPressedWhileError : BOOL;
END_VAR

(*************************************************************************
 *
 * Application name			: Snijmachine
 * Module name				: MACH_AUT_automatic
 * Version number module	: 1.00
 *
 *
 *                  Copyright (c) Bakon 2009
 *                  Goes, The Netherlands
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

(****************************************************************************************************************************)
bHoldPointOnReq		:= FALSE;
bHoldPointOnErr3		:= FALSE;
bStopPointAutomatic		:= FALSE;

g_sMACH.aut.bActAutomatic     := g_sMACH.MCL.bActAutomatic;

(* Force C_NOT_ACTIVE state *)
IF     NOT g_sMACH.aut.bActAutomatic
THEN
		IF g_sMACH.aut.nStepCounter <> C_NOT_ACTIVE THEN
			nDebugLastStep := g_sMACH.aut.nStepCounter;
		END_IF
		g_sMACH.aut.nStepCounter := C_NOT_ACTIVE;
END_IF;

IF         g_sMACH.aut.nStepCounter <> C_NOT_ACTIVE
THEN
   (* -------------------------------------------------------------------------
    * Prestep Code
    * ------------------------------------------------------------------------- *)
	tofRecipeLoad(IN:=g_HMI_sRecipeName <> sOldRecipeName, PT:=T#3s);
	sOldRecipeName := g_HMI_sRecipeName;
	bStartPressedWhileLoadeing := bStartPressedWhileLoadeing OR (tofRecipeLoad.Q AND g_bDI_StartButton);
	
	IF NOT gMachConfig.bCleaningUnit THEN		// Voor de veiligheid...
		g_bCleanRequest := FALSE;	
	END_IF
	
END_IF

(* Product not finished reset when new recipe or when in Testmode *)
IF		g_HMI_RCP_Parameters.nProductType <> nOldProductType
	OR	g_HMI_RCP_Parameters.nPartsRound <> nOldNumberRoundParts
	OR	g_HMI_MachCommand.bTestMode
	OR 	g_HMI_MachCommand.bScanMode
	OR	g_sMACH.ERR.bCalcVerError	
	OR	g_sMACH.ERR.bCalcHorError	
	OR	g_sMACH.ERR.bCalcDia1Error
	OR	g_sMACH.ERR.bCalcDia2Error
	OR	g_sMACH.ERR.bErrorPosNotPossible
	OR	g_sMACH.ERR.bPieceTooLarge
	OR	g_sMACH.ERR.bTrayTooSmall
THEN
	g_bProductNotFinished := FALSE;
END_IF
nOldProductType := g_HMI_RCP_Parameters.nProductType;
nOldNumberRoundParts := g_HMI_RCP_Parameters.nPartsRound;

(* Offdelay g_bDI_MachineInSafePosition tbv veilig starten cyclus*)
tMachineInSafePosition(IN := g_bDI_MachineInSafePosition, PT := t#800ms);

(* detect change of state *)
bPulseStepCounter     := g_sMACH.aut.nStepCounter <> g_sMACH.aut.nOldStepCounter;
g_sMACH.aut.nOldStepCounter := g_sMACH.aut.nStepCounter;

(* Steptimer *)
tStepTimer (IN:=bPulseStepCounter, PT:= REAL_TO_TIME(g_sMACH.AUT.rStepTime));
bWait := tStepTimer.Q;

(* Watchdogtimer *)
tWatchdogTimer(	IN:=		NOT	bPulseStepCounter
							AND 		g_sMACH.AUT.bActAutomatic
							AND NOT 	g_sMACH.AUT.bAutomatichold
							AND NOT 	g_HMI_MachCommand.CMD.bResetErrorPulse
							AND 		g_sMACH.AUT.rWatchdogTime<> 0,
					PT:= 	REAL_TO_TIME(g_sMACH.AUT.rWatchdogTime));
g_sMACH.AUT.bAlmError := tWatchdogTimer.Q;

(* Melding op scherm om startknop in te drukken *)
rt_PressStartToInit(CLK := (g_sMACH.Aut.nStepCounter = C_INITIAL));
IF	rt_PressStartToInit.Q THEN
	g_sMACH.ERR.bPressStartToInit	:= TRUE;
END_IF
IF		g_bSUB_InitStart
	OR	(g_sMACH.Aut.nStepCounter = C_NOT_ACTIVE)
THEN
	g_sMACH.ERR.bPressStartToInit	:= FALSE;
END_IF
g_sMACH.ERR.bPressStartToCut	:= g_sMACH.Aut.nStepCounter = C_WAIT_EXEC;

CASE g_sMACH.Aut.nStepCounter OF
	(* --------------------------------------------------------------------------
	 * S-1  C_NOT_ACTIVE
	 *      OnEntry: Ready  := FALSE
	 *      OnEntry: Busy   := FALSE
	 *      OnEntry: Hold   := FALSE
	 *      OnEntry: Reset all non-stored commands
	 * T000 Activate signal
	 * -------------------------------------------------------------------------- *)
	C_NOT_ACTIVE:

		(* On Entry *)
		IF	bPulseStepCounter
		THEN
			g_sMACH.AUT.rWatchdogTime  			:= 0;
			g_sMACH.AUT.rStepTime				:= 0;

			g_sMACH.AUT.bAutomaticReady			:= FALSE;
			g_sMACH.AUT.bAutomaticBusy			:= FALSE;
			g_sMACH.AUT.bAutomaticHold			:= FALSE;
			g_sMACH.AUT.bAutomaticStop			:= FALSE;
			g_sMACH.AUT.bProcessBusy			:= FALSE;
			g_sMACH.AUT.bProcessReady			:= FALSE;
			g_sMACH.AUT.bAutomaticWaitingForTrig	:= FALSE;

			g_bCalculationStart					:= FALSE;
			g_bSUB_InitStart					:= FALSE;
			g_bSUB_CleanKnifeStart				:= FALSE;

			g_bCMD_US_Start1					:= FALSE;

			ModusRV.bEnable					:= FALSE;
			ModusRV.bStartXYA					:= FALSE;
			ModusRV.bStartZ						:= FALSE;

			g_sHMI_Mach_UnitStatus.bProcessAgain	:= FALSE;
			bStartButtonPressed							:= FALSE;

			g_bSaveMachPar								:= bStartedOnce;

			g_HMI_MachCommand.CMD.bDeny			:= FALSE;
			g_HMI_MachCommand.CMD.bConfirm		:= FALSE;

			bStartPressedWhileLoadeing := FALSE;
			g_sMACH.ERR.bMessagePosNotPossible := FALSE;
			
			g_HMI_MachCommand.CMD.bCleanKnifeRequest	:= FALSE;
			g_sHMI_Mach_UnitStatus.bPopupRemoveProduct := FALSE;
		END_IF

		(* Continuous actions *)
		IF NOT g_HMI_MachCommand.bScanMode THEN
			nScanCount := 0;
		END_IF

		(* Transitions *)
		IF	g_sMACH.aut.bActAutomatic
		THEN
			g_sMACH.aut.nStepCounter         := C_INITIAL;
			bStartedOnce := TRUE;
		END_IF;

	(* --------------------------------------------------------------------------
	 * S000 Sub init before starting auto cycle
	 * T995 C_WAIT_EXEC, Pre init done
	 * -------------------------------------------------------------------------- *)
	C_INITIAL:

	      (* On Entry *)
	      IF	bPulseStepCounter
		THEN
			g_sMACH.AUT.rWatchdogTime  			:= 0;
			g_sMACH.AUT.rStepTime				:= 0;
			MACH_SUB_Initialise.I_rX_InfeedPosition		:= g_HMI_MCH_Parameters.rInfeedPosition_X;
			IF 		g_HMI_MachCommand.bTestMode 
				OR 	g_HMI_MachCommand.bScanMode
			THEN
				MACH_SUB_Initialise.I_rY_InfeedPosition		:= g_HMI_MCH_Parameters.rInfeedPosition_Y + 30;
			ELSE
				MACH_SUB_Initialise.I_rY_InfeedPosition		:= g_HMI_MCH_Parameters.rInfeedPosition_Y;
			END_IF
			MACH_SUB_Initialise.I_rY_InfeedPrePosition	:= g_HMI_MCH_Parameters.rInfeedPosition_Y + 30;
		END_IF;

		(* Continuous actions *)
		IF	g_bDI_StartButton OR g_HMI_MachCommand.bScanMode
		THEN
			g_bSUB_InitStart							:= TRUE;
		END_IF

		(* Transitions *)
		IF		g_bSUB_InitDone
		THEN
				g_bSUB_InitStart				:= FALSE;
				g_sMACH.aut.nStepCounter	:= C_WAIT_EXEC;
				bStartPressedWhileLoadeing := FALSE;
		END_IF;

	(* --------------------------------------------------------------------------
	 * S995 C_WAIT_EXEC
	 *      AutomaticWaitingForTrig := NOT AutomaticStop
	 * T996 C_INITIALISE
	 *              Execution Trigger
	 *      AND NOT Hold On Request
	 *      AND NOT Hold On Error Category 3
	 *      AND NOT Stop end of cycle selected
	 *      AND NOT Stop at error category 2
	 * T997 C_STOPPED
	 *         "Stop end of cycle" selected
	 *      OR "Stop on error category 2"
	 * -------------------------------------------------------------------------- *)
	C_WAIT_EXEC:

	      (* Actions on state entry *)
		IF	bPulseStepCounter
		THEN
			g_sMACH.AUT.rWatchdogTime  			:= 0;
			g_sMACH.AUT.rStepTime				:= 0;
			g_sMACH.ERR.bMessagePosNotPossible := FALSE;
			g_sMACH.AUT.rWatchdogTime  			:= 0;
			IF	g_HMI_MachCommand.bScanMode AND NOT bFirstTimeWaitForExec THEN
				g_sMACH.AUT.rStepTime			:= 2000;
			ELSE
				g_sMACH.AUT.rStepTime				:= 0;
			END_IF
			IF g_sMACH.ERR.bCrashDetected THEN
				g_bProductNotFinished	:= FALSE;
				g_sHMI_Mach_UnitStatus.bPopupRemoveProduct	:= TRUE;	// Popup
			END_IF
			bStartPressedWhileError := FALSE;			
		END_IF

		bStartPressedWhileError := bStartPressedWhileError OR (g_sMACH.ERR.bCrashDetected AND g_bDI_StartButton);
		
		(* Continuous actions *)
		bHoldPointOnReq     := TRUE;
		bHoldPointOnErr3    := TRUE;
		bStopPointAutomatic := TRUE;
		IF	g_HMI_MachCommand.CMD.bConfirm THEN
			g_sHMI_Mach_UnitStatus.bPopupRemoveProduct	:= FALSE;	// Popup
			g_HMI_MachCommand.CMD.bConfirm	:= FALSE;
			g_sMACH.ERR.bCrashDetected	:= FALSE;
		END_IF

		(* Transitions *)
		IF				g_sMACH.MCL.bStopEndOfCycle
				OR		g_sMACH.MCL.bStopOnErrorCat2
				OR 		(g_HMI_MachCommand.bScanMode AND nScanCount >= 10)
		THEN
			g_sMACH.aut.nStepCounter     		:= C_STOPPED;
			IF g_HMI_MachCommand.bScanMode THEN
				g_sHMI_Mach_UnitStatus.bScanFinished := TRUE;
				g_bScanDataPending := TRUE;
			END_IF
		ELSIF	((g_bDI_StartButton 
			AND tMachineInSafePosition.Q) 
			OR g_HMI_MachCommand.bTestMode 
			OR	(g_HMI_MachCommand.bScanMode 
			AND NOT bwait AND nScanCount < 10) 
			OR (bStartPressedWhileLoadeing 
			AND tMachineInSafePosition.Q) 
			OR bStartPressedWhileError)
			AND g_bDI_LightCurtainOK 
			AND NOT tofRecipeLoad.Q 
			AND NOT g_sMACH.ERR.bCrashDetected
		THEN
			g_uControl_X_Axis.bEnableDrive		:= TRUE;
			g_uControl_Y_Axis.bEnableDrive		:= TRUE;
			g_uControl_Front_Axis.bEnableDrive	:= TRUE;
			g_uControl_Rear_Axis.bEnableDrive	:= TRUE;
			g_uControl_Z_Axis.bEnableDrive		:= TRUE;
			g_uControl_R_Axis.bEnableDrive		:= TRUE;

			bStartButtonPressed 				:= FALSE;
			bStartPressedWhileLoadeing	:= FALSE;
			g_sMACH.aut.nStepCounter		:= C_INITIALISE;
		END_IF

	(* --------------------------------------------------------------------------
	 * S996 C_INITIALISE
	 *      OnEntry: bProcessBusy  := TRUE
	 *      OnEntry: ProcessReady := FALSE
	 * T005 Always
	 * -------------------------------------------------------------------------- *)
	C_INITIALISE:

	      (* On entry *)
		IF	bPulseStepCounter
		THEN
			g_sMACH.aut.bProcessReady		:= FALSE;
			g_sMACH.aut.bProcessBusy		:= TRUE;
			g_sMACH.AUT.rWatchdogTime  		:= 10 * 1000;
			g_sMACH.AUT.rStepTime			:= 0;
	      END_IF

		(* Continuous actions *)
		IF g_sMACH.AUT.bAlmError THEN
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
		IF	g_HMI_MachCommand.CMD.bConfirm THEN
			g_sHMI_Mach_UnitStatus.bPopupRemoveProduct	:= FALSE;	// Popup
			g_HMI_MachCommand.CMD.bConfirm	:= FALSE;
			g_sMACH.ERR.bCrashDetected	:= FALSE;
		END_IF
		
		(* Transitions *)
		IF		g_uStatus_Z_Axis.bDriveEnabled
			AND	g_uStatus_R_Axis.bDriveEnabled
			AND	g_uStatus_X_Axis.bDriveEnabled
			AND	g_uStatus_Y_Axis.bDriveEnabled
			AND	g_uStatus_Rear_Axis.bDriveEnabled
			AND	g_uStatus_Front_Axis.bDriveEnabled
			AND NOT g_sMACH.ERR.bCrashDetected
		THEN
			g_sMACH.aut.nStepCounter	:= 010;
		END_IF

	(*--------------------------------------------------------------------------
	 * S010 Enable Modus RondVierkant
	 *		 Check if product has been cut completely
	 * T015 Always
	 * -------------------------------------------------------------------------- *)
	010:

	      (* On entry *)
		IF	bPulseStepCounter
		THEN
			g_sMACH.AUT.rWatchdogTime  				:= 0;
			g_sMACH.AUT.rStepTime					:= 0;
			ModusRV.bEnable 							:= TRUE;
			IF g_bProductNotFinished AND NOT g_HMI_MachCommand.bTestMode AND NOT g_HMI_MachCommand.bScanMode
			THEN
				g_sHMI_Mach_UnitStatus.bProcessAgain	:= TRUE;	(* Open popup in screen *)
			END_IF
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			(g_bProductNotFinished AND g_HMI_MachCommand.CMD.bDeny)
			OR		g_HMI_MachCommand.bTestMode
			OR 		g_HMI_MachCommand.bScanMode
			OR	NOT	g_bProductNotFinished
		THEN
			g_sHMI_Mach_UnitStatus.bProcessAgain	:= FALSE;	(* Popup in screen *)
			g_HMI_MachCommand.CMD.bDeny			:= FALSE;
			g_HMI_MachCommand.CMD.bConfirm		:= FALSE;
			g_sMACH.aut.nStepCounter	:= 015;
		ELSIF	(g_bProductNotFinished AND g_HMI_MachCommand.CMD.bConfirm)
		THEN
			g_sHMI_Mach_UnitStatus.bProcessAgain	:= FALSE;	(* Popup in screen *)
			g_HMI_MachCommand.CMD.bDeny			:= FALSE;
			g_HMI_MachCommand.CMD.bConfirm		:= FALSE;
			g_sMACH.aut.nStepCounter	:= 020;
		END_IF

	(*--------------------------------------------------------------------------
	 * S015 Calculate cutting positions
	 * T020 Calculations done
	 * -------------------------------------------------------------------------- *)
	015:

	      (* On entry *)
		IF	bPulseStepCounter
		THEN
			g_sMACH.AUT.rWatchdogTime  				:= 0;
			g_sMACH.AUT.rStepTime					:= 0;
			g_bCalculationStart							:= TRUE;
			
		END_IF

		(* Continuous actions *)
		bOnePiece	:= 		g_HMI_RCP_Parameters.rSizeTrimRight = 0 												(* No cuts when one piece and no trims *)
					AND	g_HMI_RCP_Parameters.rSizeTrimLeft = 0
					AND	g_HMI_RCP_Parameters.rSizeTrimRear = 0
					AND	g_HMI_RCP_Parameters.rSizeTrimFront = 0
					AND	g_HMI_RCP_Parameters.nPartsX = 1
					AND	g_HMI_RCP_Parameters.nPartsY = 1;

		(* Transitions *)
		IF			g_bCalculationDone
		THEN
			g_bCalculationStart				:= FALSE;
			g_sMACH.aut.nStepCounter		:= 020;
		END_IF

	(*--------------------------------------------------------------------------
	 * S020 Start cutting
	 * T025 Always
	 * -------------------------------------------------------------------------- *)
	020:

	      (* On entry *)
		IF	bPulseStepCounter
		THEN
			g_sMACH.AUT.rWatchdogTime  				:= 0;
			g_sMACH.AUT.rStepTime					:= 0;
			IF	NOT bOnePiece
			THEN
				ModusRV.bStartXYA	:= TRUE;
				ModusRV.bStartZ		:= TRUE;
				g_bProductNotFinished	:= TRUE;
				g_bCMD_US_Start1	:= TRUE;
			END_IF
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF	TRUE
		THEN
			g_sMACH.aut.nStepCounter	:= 025;
		END_IF

	(*--------------------------------------------------------------------------
	 * S025 Wait for cutting ready
	 * T030 Cutting ready
	 * -------------------------------------------------------------------------- *)
	025:

	    (* On entry *)
		IF	bPulseStepCounter
		THEN
			g_sMACH.AUT.rWatchdogTime  				:= 0;
			g_sMACH.AUT.rStepTime					:= 0;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		ModusRV.bLastCutReadyZOutOfProduct
			OR	ModusRV.bReady									(* @TODO, tekst bijzetten waarom, vermoedelijk voor als een product geen enkele keer gesneden moet worden *)
		THEN
			ModusRV.bStartXYA		:= FALSE;
			ModusRV.bStartZ			:= FALSE;
			g_bProductNotFinished	:= FALSE;
			g_sHMI_CountersInfinite.dnProductCountTotal	:= g_sHMI_CountersInfinite.dnProductCountTotal + 1;
			g_sHMI_CountersDay.dnProductCountTotal	:= g_sHMI_CountersDay.dnProductCountTotal + 1;
			g_bCMD_US_Start1	:= FALSE;
			
			IF NOT g_HMI_MachCommand.bScanMode AND NOT g_sMACH.ERR.bCrashDetected THEN
				CASE g_HMI_RCP_Parameters.nProductType OF
						Prod_Slab_Rectangle_1x1, Prod_Slab_Rectangle_1x1_Clamp:	(* ProductType = 0 = Slab Square *)
							g_sHMI_CountersInfinite.dnProductCountSlabSquare	:= 	g_sHMI_CountersInfinite.dnProductCountSlabSquare	+1;
							g_sHMI_CountersDay.dnProductCountSlabSquare		:= 	g_sHMI_CountersDay.dnProductCountSlabSquare	+1;
						Prod_Slab_Triangle_1x1:	(* ProductType = 1 = Slab triangle *)
							g_sHMI_CountersInfinite.dnProductCountSlabTriangle	:= 	g_sHMI_CountersInfinite.dnProductCountSlabTriangle	+1;
							g_sHMI_CountersDay.dnProductCountSlabTriangle	:= 	g_sHMI_CountersDay.dnProductCountSlabTriangle	+1;
						Prod_Slab_Diagonal_1x1:	(* ProductType = 2 = Slab diagonal *)
							g_sHMI_CountersInfinite.dnProductCountSlabDiagonal	:= 	g_sHMI_CountersInfinite.dnProductCountSlabDiagonal	+1;
							g_sHMI_CountersDay.dnProductCountSlabDiagonal		:= 	g_sHMI_CountersDay.dnProductCountSlabDiagonal	+1;
						Prod_Round_POC_2x1:	(* ProductType = 4 = Round Cake *)
							g_sHMI_CountersInfinite.dnProductCountRound		:= 	g_sHMI_CountersInfinite.dnProductCountRound + 2;
							g_sHMI_CountersDay.dnProductCountRound			:= 	g_sHMI_CountersDay.dnProductCountRound + 2;
						Prod_Tray_Rectangle_1x2, Prod_Tray_Rectangle_2x1:	(* ProductType = 4 = Tray Square Small *)
							g_sHMI_CountersInfinite.dnProductCountTraySmall		:= 	g_sHMI_CountersInfinite.dnProductCountTraySmall + 2;
							g_sHMI_CountersDay.dnProductCountTraySmall			:= 	g_sHMI_CountersDay.dnProductCountTraySmall + 2;
						Prod_Tray_Rectangle_1x1:	(* ProductType = 5 = Tray Square Large *)
							g_sHMI_CountersInfinite.dnProductCountTrayLarge		:= 	g_sHMI_CountersInfinite.dnProductCountTrayLarge +1;
							g_sHMI_CountersDay.dnProductCountTrayLarge			:= 	g_sHMI_CountersDay.dnProductCountTrayLarge +1;
						Prod_Tray_Rectangle_1x4:	(* ProductType =6 = Tray Square Triple *)
							g_sHMI_CountersInfinite.dnProductCountTrayTriple		:= 	g_sHMI_CountersInfinite.dnProductCountTrayTriple + 4;
							g_sHMI_CountersDay.dnProductCountTrayTriple			:= 	g_sHMI_CountersDay.dnProductCountTrayTriple + 4;
				END_CASE
			END_IF
			g_sMACH.aut.nStepCounter	:= 030;
		ELSIF	bOnepiece
		THEN
			ModusRV.bStartXYA			:= FALSE;
			ModusRV.bStartZ				:= FALSE;
			g_bProductNotFinished		:= FALSE;
			g_bCMD_US_Start1			:= FALSE;
			g_sMACH.aut.nStepCounter	:= 030;
		END_IF

	(*--------------------------------------------------------------------------
	 * S030 Wait for Modus ready
	 * T040 Cleaning
	 * T998 Modus ready
	 * -------------------------------------------------------------------------- *)
	030:

	      (* On entry *)
		IF	bPulseStepCounter
		THEN
			g_sMACH.AUT.rWatchdogTime  				:= 0;
			g_sMACH.AUT.rStepTime					:= 0;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			ModusRV.bReady
				OR	bOnePiece
		THEN
(*			g_uControl_Front_Axis.bEnableDrive	:= FALSE;
			g_uControl_Rear_Axis.bEnableDrive	:= FALSE;
			g_uControl_Z_Axis.bEnableDrive		:= FALSE;
			g_uControl_R_Axis.bEnableDrive		:= FALSE;*)
			(*IF	g_bCleanRequest
			THEN
				g_bCleanRequest	:= FALSE;
				g_HMI_MachCommand.CMD.bCleanKnifeRequest	:= FALSE;
				g_sMACH.aut.nStepCounter	:= 40;				
			ELSE *)
			g_uControl_X_Axis.bEnableDrive := FALSE;
			g_uControl_Y_Axis.bEnableDrive := FALSE;
			//g_HMI_MachCommand.CMD.bCleanKnifeRequest	:= FALSE;
			nScanCount := nScanCount + 1;
			g_sMACH.aut.nStepCounter	:= C_READY;				
			//END_IF
		END_IF

	(*--------------------------------------------------------------------------
	 * S040 Cleaning
	 * T998 Modus ready
	 * -------------------------------------------------------------------------- *)
	040:

	      (* On entry *)
		IF	bPulseStepCounter
		THEN
			g_sMACH.AUT.rWatchdogTime  			:= 0;
			g_sMACH.AUT.rStepTime				:= 0;
			g_bSUB_CleanKnifeStart				:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF	g_bSUB_CleanKnifeDone
		THEN
(*			g_uControl_Front_Axis.bEnableDrive	:= FALSE;
			g_uControl_Rear_Axis.bEnableDrive	:= FALSE;
			g_uControl_Z_Axis.bEnableDrive		:= FALSE;
			g_uControl_R_Axis.bEnableDrive		:= FALSE;*)
			g_uControl_X_Axis.bEnableDrive	:= FALSE;
			g_uControl_Y_Axis.bEnableDrive	:= FALSE;
			g_bSUB_CleanKnifeStart			:= FALSE;
			g_sMACH.aut.nStepCounter		:= C_READY;				
		END_IF
		
	(* --------------------------------------------------------------------------
	 * S998 C_READY
	 *      OnEntry: bProcessBusy  := FALSE
	 *      OnEntry: ProcessReady := TRUE
	 * T999 Always
	 * -------------------------------------------------------------------------- *)
	C_READY:

	      (* On Entry *)
		IF	bPulseStepCounter
		THEN
			g_sMACH.aut.bProcessBusy		:= FALSE;
			g_sMACH.aut.bProcessReady	:= TRUE;
			g_sMACH.aut.rWatchdogTime	:= 0;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF	TRUE
		THEN
			g_sMACH.AUT.rStepTime	:= 0;
			g_sMACH.aut.nStepCounter	:= C_LAST;
		END_IF

	(* --------------------------------------------------------------------------
	 * S997 C_STOPPED
	 *      OnEntry: AutomaticReady := TRUE
	 * T999     NOT "Stop end of cycle" selected
	 *      AND NOT "Stop on error category 2"
	 * -------------------------------------------------------------------------- *)
	C_STOPPED:

		(* On entry *)
		IF	bPulseStepCounter
		THEN
			g_sMACH.aut.rWatchdogTime     := 0;
		END_IF

		(* Continuous actions *)
		(*g_uControl_X_Axis.bEnableDrive	:=	FALSE; //g_uStatus_X_Axis.bAutomaticEnabled;
		g_uControl_Y_Axis.bEnableDrive	:=	FALSE; //g_uStatus_Y_Axis.bAutomaticEnabled;
		g_uControl_Front_Axis.bEnableDrive := FALSE; //g_uStatus_Front_Axis.bAutomaticEnabled;
		g_uControl_Rear_Axis.bEnableDrive := FALSE; //g_uStatus_Rear_Axis.bAutomaticEnabled;
		g_uControl_Z_Axis.bEnableDrive	:=	FALSE; //g_uStatus_Z_Axis.bAutomaticEnabled;
		g_uControl_R_Axis.bEnableDrive	:=	FALSE; //g_uStatus_R_Axis.bAutomaticEnabled;*)
		bStopPointAutomatic				:= TRUE;

		g_sMACH.Aut.bAutomaticReady    := TRUE;(*NOT (
													g_uStatus_X_Axis.bDriveEnabled
												OR	g_uStatus_Y_Axis.bDriveEnabled
												OR	g_uStatus_Front_Axis.bDriveEnabled
												OR	g_uStatus_Rear_Axis.bDriveEnabled
												OR	g_uStatus_Z_Axis.bDriveEnabled);*)

		(* Transitions *)
		IF		NOT g_sMACH.MCL.bStopEndOfCycle
			AND NOT g_sMACH.MCL.bStopOnErrorCat2
			AND NOT g_sHMI_Mach_UnitStatus.bScanFinished
		THEN
			g_sMACH.Aut.bAutomaticReady   := FALSE;
			g_sMACH.aut.nStepCounter      := C_LAST;
		END_IF

	(* --------------------------------------------------------------------------
	 * S999 C_LAST
	 * T000 Always
	 * -------------------------------------------------------------------------- *)
	C_LAST:

		(* On entry *)
		IF	bPulseStepCounter
		THEN
			g_sMACH.aut.rWatchdogTime     := 0;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF	TRUE THEN
			g_sMACH.aut.nStepCounter      := C_WAIT_EXEC;
		END_IF

	(* --------------------------------------------------------------------------
	 * Illegal state
	 * -------------------------------------------------------------------------- *)
ELSE
	g_sMACH.aut.rWatchdogTime     := 10;
END_CASE

IF      g_sMACH.Aut.nStepCounter <> C_NOT_ACTIVE
THEN
	(* --------------------------------------------------------------------------
	 * Poststep code
	 * -------------------------------------------------------------------------- *)
	g_sMACH.Aut.bAutomaticHold  :=	(	g_sMACH.MCL.bHoldOnRequest
									AND	bHoldPointOnReq)
									OR  (    g_sMACH.MCL.bHoldOnErrorCat3
									AND bHoldPointOnErr3);

	g_sMACH.Aut.bAutomaticStop  :=			bStopPointAutomatic
									AND	g_sMACH.MCL.bStopOnErrorCat2;

	g_sMACH.Aut.bAutomaticBusy  :=		NOT	g_sMACH.Aut.bAutomaticHold
										AND NOT	g_sMACH.Aut.bAutomaticStop;

	g_sMACH.Aut.bAutomaticWaitingForTrig :=        (g_sMACH.aut.nStepCounter = C_WAIT_EXEC)
												AND NOT g_sMACH.Aut.bAutomaticStop
												AND NOT g_sMACH.Aut.bAutomaticHold;
	g_sHMI_Mach_UnitStatus.nScanProgress := nScanCount;	
END_IF

END_PROGRAM
