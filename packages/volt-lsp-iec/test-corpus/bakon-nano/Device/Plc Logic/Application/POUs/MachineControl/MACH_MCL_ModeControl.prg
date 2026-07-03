PROGRAM MACH_MCL_ModeControl
VAR
	(* Temporary Variables *)
	bPulseStepCounter	: BOOL;
	bRecipeLoaded		: BOOL;
	tDisableDrives		: TON;
	tonStartButton		: TON;
END_VAR

(*************************************************************************
 *
 * Application name				: Snijmachine
 * Module name					: MACH_MCL_ModeControl
 * Version number module		: 0.30
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

(*****************************************************************************
 * HISTORY																						 
 *****************************************************************************
 * Update		: 0.20					 
 * Author		: K.Kole (KOOLE CONTROLS)										  
 * Changes	: 0.10:	Force to state WaitForInit changed
 *						Condition "bEnableMachine" added in state "WaitForConditioning"
 *				  0.20:	Blockingcounter implemented
 *				  0.30:  Ondelay added for bit g_HMI_bRecipeLoaded in order to avoid
 *						a error in state Wait_For_Automatic
 *****************************************************************************)

	(****************************************************************)
	(*  Mode Control is the central control part of the machines.	*)
	(*  It receives and sends signals from and to the HMI and		 *)
	(*  Handles the signals to and from the machine					  *)
	(****************************************************************)

	(* Hold automatic when ErrorCategory3 *)
	IF			g_sMACH.ERH.bErrorCategory3
	THEN
				g_sMACH.MCL.bHoldOnErrorCat3 := TRUE;
	END_IF
	IF	  	NOT g_sMACH.ERH.bErrorCategory3
		AND	g_HMI_MachCommand.CMD.bStartCycle
	THEN
				 g_sMACH.MCL.bHoldOnErrorCat3 := FALSE;
	END_IF

	(* Stop at end of cycle when ErrorCategory2 *)
	IF				g_sMACH.ERH.bErrorCategory2
	THEN
					g_sMACH.MCL.bStopOnErrorCat2 := TRUE;
	END_IF
	IF	  	NOT	g_sMACH.ERH.bErrorCategory2
		AND NOT	g_sMACH.MCL.bActAutomatic
	THEN
					g_sMACH.MCL.bStopOnErrorCat2 := FALSE;
	END_IF

	(* Stop at end of cycle *)
	IF 	g_HMI_MachCommand.CMD.bStopCycle
	THEN
		g_sMACH.MCL.bStopEndOfCycle := TRUE;
	END_IF
	IF NOT g_sMACH.MCL.bActAutomatic
	THEN
		g_sMACH.MCL.bStopEndOfCycle := FALSE;
	END_IF

	bRecipeLoaded := (g_HMI_sRecipeName <> 'new recipe') AND (g_HMI_sRecipeName <> '');

	(* Recipe downloaded. *)
(*	IF			bRecipeLoaded
		AND (	MACH.MCL.bStateMainSwitchedOn
			OR MACH.MCL.bStateWaitForInit
			OR MACH.MCL.bStateInit
			OR MACH.MCL.bStateWaitForRecipe)
	THEN
		MACH.MCL.bRecipeExecuted := TRUE;
	END_IF
*)
	(* Force StateWaitForAutomatic *)
	IF		  		g_bFirstCycle
		OR NOT 	g_bDI_ES_DirectOK
		OR		g_sMACH.ERR.bTableMovementNotAllowed		// Severe error, chance of damaging the knife
		OR		g_sMACH.ERR.bRAxisMovementNotAllowed		// Severe error, chance of damaging the knife
		OR		g_sMACH.ERR.bZAxisMovementNotAllowed		// Severe error, chance of damaging the knife
		OR		(g_sMACH.ERH.bErrorCategory4
		AND NOT	g_sMACH.MCL.bActManual
		//AND (NOT g_sMACH.MCL.bActAutomatic OR g_bSUB_CleanKnifeStart)
		AND		g_sMACH.MCL.nStepCounter <> StateWaitForAutomatic)
	THEN
				 g_sMACH.MCL.nStepCounter := StateWaitForAutomatic;
	//ELSIF		g_sMACH.ERH.bErrorCategory4			(* Force StateWaitForAuto *)
	//	AND 	g_sMACH.MCL.bActAutomatic
	//	AND NOT	g_bSUB_CleanKnifeStart
	//THEN
	//			 g_sMACH.MCL.nStepCounter := StateWaitForAutomatic;
	END_IF

	(* detect change of state *)
	bPulseStepCounter				:= g_sMACH.MCL.nStepCounter <> g_sMACH.MCL.nOldStepCounter;
	g_sMACH.MCL.nOldStepCounter	:= g_sMACH.MCL.nStepCounter;

	
IF bPulseStepCounter THEN
	{warning 'Disabled for compatibility SVE'}
	//g_Logger.Write(0, CONCAT('Modecontrol changed to state ', INT_TO_STRING(g_sMACH.MCL.nStepCounter)), 'MACH_MCL_ModeControl');
END_IF

tonStartButton(IN:= g_bDI_StartButton, PT:= T#500MS, Q=> , ET=> );
	
CASE g_sMACH.MCL.nStepCounter OF
	(* ------------------------------------------------------------------------------
	 * S000 StateMainSwitchedOn												  
	 *		Reset all Mode Control variables								 
	 * ------------------------------------------------------------------------------ *)
	StateMainSwitchedOn:

		(* On Entry *)
		IF bPulseStepCounter
		THEN
			g_sMACH.MCL.bActInitialise				:= FALSE;
			g_sMACH.MCL.bActConditioning			:= FALSE;
			g_sMACH.MCL.bActAutomatic			:= FALSE;
			g_sMACH.MCL.bActManual				:= FALSE;
			g_sMACH.MCL.bActCleaning				:= FALSE;
			g_sMACH.MCL.bHoldOnRequest		:= FALSE;
			g_sMACH.MCL.bStopEndOfCycle		:= FALSE;

			(*g_sMACH.MCL.bInitExecuted				:= FALSE; *)
			g_sMACH.MCL.bRecipeExecuted		:= FALSE;
			g_HMI_MachCommand.CMD.bStartManual					:= FALSE;
			g_HMI_MachCommand.CMD.bStartCleaning				:= FALSE;
		  	g_HMI_MachCommand.CMD.bStartCycle				:= FALSE;
		END_IF

		(* Continous actions *)

		(* Transitions *)
		IF				g_bDI_ES_DirectOK
			AND NOT	g_sMACH.ERH.bErrorCategory4
		THEN
			g_sMACH.MCL.nStepCounter := StateWaitForAutomatic;(* StateWaitForInit; *)
			(* On Exit *)
		ELSIF			g_bDI_ES_DirectOK
			AND		g_HMI_MachCommand.CMD.bStartManual
		THEN
			g_sMACH.MCL.nStepCounter := StateManual;
		END_IF

	(* ------------------------------------------------------------------------------
	 * S001 StateWaitForInit												  
	 *		Wait for init button (No error present )								 
	 * ------------------------------------------------------------------------------ *)
	StateWaitForInit:

		(* On Entry *)
		IF bPulseStepCounter
		THEN
			(*g_sMACH.MCL.bInitExecuted		:= FALSE; *)
			g_sMACH.MCL.bActInitialise		:= FALSE;
			g_sMACH.MCL.bActConditioning := FALSE;
			g_sMACH.MCL.bActAutomatic	:= FALSE;
			g_sMACH.MCL.bActManual		:= FALSE;
			g_sMACH.MCL.bActCleaning		:= FALSE;
			g_HMI_MachCommand.CMD.bStartManual			:= FALSE;
			g_HMI_MachCommand.CMD.bStartCleaning		:= FALSE;
			g_HMI_MachCommand.CMD.bStartCycle		:= FALSE;

			g_sMACH.MCL.bHoldOnRequest		:= FALSE;
			g_sMACH.MCL.bStopEndOfCycle		:= FALSE;

			tDisableDrives(IN:=FALSE);
			(*g_sMACH.MCL.bRecipeExecuted		:= FALSE; Storing weggelaten dd 1 juni 2011 *)
		END_IF

		(* Continous actions *)
		tDisableDrives(IN:=TRUE, PT:= t#1500ms);
		IF tDisableDrives.Q THEN								(* In AUT, MAN, INI cycles g_uControl_xxx.bAutomatic etc. is reset *)
			g_uControl_X_Axis.bEnableDrive	:= FALSE;			(* Resetting the bEnableDrive bit must be delayed *)
			g_uControl_Y_Axis.bEnableDrive	:= FALSE;
			{warning 'SVE - Check this change}
			//g_uControl_Front_Axis.bEnableDrive	:= g_uStatus_Front_Axis.nStateAxis = 3 OR g_uStatus_Front_Axis.nStateAxis <= 1;			(* Resetting the bEnableDrive bit must be delayed *)
			//g_uControl_Rear_Axis.bEnableDrive	:= g_uStatus_Rear_Axis.nStateAxis = 3 OR g_uStatus_Rear_Axis.nStateAxis <= 1;
			g_uControl_Front_Axis.bEnableDrive := g_uStatus_Front_Axis.eStateAxis <= L_MC1P_AXIS_STATE.StandStill;		//Standstill, Disabled or Errorstop
			g_uControl_Rear_Axis.bEnableDrive := g_uStatus_Rear_Axis.eStateAxis <= L_MC1P_AXIS_STATE.StandStill;		//Standstill, Disabled or Errorstop
			g_uControl_Z_Axis.bEnableDrive	:= FALSE;
			g_uControl_R_Axis.bEnableDrive	:= FALSE;
		END_IF
		(*g_sMACH.ERR.bMoldWarningMold := (NOT FUN_CHECK_MOLD(g_bDI_MoldLeftPresent, g_bDI_MoldRightPresent,(g_HMI_RCP_Parameters.nProductType = Prod_Round),
																			g_bDI_MoldDetection1_1, g_bDI_MoldDetection1_2, g_bDI_MoldDetection1_3,
																			g_bDI_MoldDetection2_1, g_bDI_MoldDetection2_2, g_bDI_MoldDetection2_3,
																			g_HMI_RCP_Parameters.nMaxMoldParts) ) AND (bRecipeLoaded); *)

		(* Transitions *)
		IF 	NOT		g_sMACH.ERH.bError234Active
			AND NOT g_uStatus_X_Axis.bDriveEnabled
			AND NOT g_uStatus_Y_Axis.bDriveEnabled
			AND NOT g_uStatus_Front_Axis.bDriveEnabled
			AND NOT g_uStatus_Rear_Axis.bDriveEnabled
			AND NOT g_uStatus_Z_Axis.bDriveEnabled
			AND NOT g_uStatus_R_Axis.bDriveEnabled
			AND	g_uStatus_R_Axis.bHomePositionAvailable
			AND	(g_HMI_MachCommand.CMD.bStartCycle OR (tonStartButton.Q AND g_HMI_MachCommand.bScanMode)) 
		THEN
			g_sMACH.MCL.nStepCounter := StateInit;
			(* On Exit *)
		ELSIF g_HMI_MachCommand.CMD.bStartManual						(* Manual *)
		THEN
			g_sMACH.MCL.nStepCounter := StateManual;
		END_IF

	(* ------------------------------------------------------------------------------
	 * S002 StateInit												  
	 *		Initialising busy								 
	 * ------------------------------------------------------------------------------ *)
	StateInit:

		(* On Entry *)
		IF bPulseStepCounter
		THEN
			;(*g_sMACH.MCL.bInitExecuted := FALSE; *)
		END_IF

		(* Continous actions *)
		g_sMACH.MCL.bActInitialise := TRUE;

		(* Transitions *)
		IF g_sMACH.uINI.bInitialiseReady
		THEN
			g_sMACH.MCL.nStepCounter := StateWaitForRecipe;
			(* On Exit *)
			g_sMACH.MCL.bActInitialise := FALSE;
			(*g_sMACH.MCL.bInitExecuted  := TRUE; *)
		END_IF

	(* ------------------------------------------------------------------------------
	 * S003 StateWaitForRecipe												  
	 *		Wait for recipe download
	 * ------------------------------------------------------------------------------ *)
	StateWaitForRecipe:

		(* On Entry *)

		(* Continous actions *)

		(* Transitions *)
		IF bRecipeLoaded						(* Recipe loaded *)
		THEN
			g_sMACH.MCL.nStepCounter := StateWaitForAutomatic;
		ELSIF g_HMI_MachCommand.CMD.bStartManual						(* Manual *)
		THEN
			g_sMACH.MCL.nStepCounter := StateManual;
		ELSIF g_HMI_MachCommand.CMD.bStartCleaning					(* Cleaning *)
		THEN
			g_sMACH.MCL.nStepCounter := StateCleaning;
		END_IF

	(* ------------------------------------------------------------------------------
	 * S004 StateWaitForConditioning												  
	 *		Wait for start button
	 * ------------------------------------------------------------------------------ *)
(*	StateWaitForConditioning:

		(* On Entry *)
		IF bPulseStepCounter
		THEN
			g_sMACH.MCL.bConditioningExecuted := FALSE;
		END_IF

		(* Continous actions *)

		(* Transitions *)
		IF	g_HMI_MachCommand.CMD.bStartCycle THEN
			g_sMACH.MCL.nStepCounter := StateWaitForAutomatic;
		ELSIF g_HMI_MachCommand.CMD.bStartCycle				  (* Conditioning *)
		THEN
			g_sMACH.MCL.nStepCounter := StateConditioning;
		ELSIF g_sMACH.MCL.bStartInitialise		(* Initialise *)
		THEN
			g_sMACH.MCL.nStepCounter := StateInit;
		ELSIF g_sMACH.MCL.bStartManual			 (* Manual *)
		THEN
			g_sMACH.MCL.nStepCounter := StateManual;
		ELSIF g_sMACH.MCL.bStartCleaning						(* Cleaning *)
		THEN
			g_sMACH.MCL.nStepCounter := StateCleaning;
		END_IF

	(* ------------------------------------------------------------------------------
	 * S005 StateConditioning												  
	 *		Conditioning busy
	 * ------------------------------------------------------------------------------ *)
	StateConditioning:

		(* On Entry *)
		IF bPulseStepCounter
		THEN
			g_sMACH.MCL.bConditioningExecuted := FALSE;
		END_IF

		(* Continous actions *)
		g_sMACH.MCL.bActConditioning := TRUE;

		(* Transitions *)
		IF (*g_sMACH.CON.BCONDITIONINGREADY*) TRUE
		THEN
			g_sMACH.MCL.nStepCounter := StateWaitForAutomatic;
			(* On Exit *)
			g_sMACH.MCL.bActConditioning		:= FALSE;
			g_sMACH.MCL.bConditioningExecuted := TRUE;
		END_IF
*)
	(* ------------------------------------------------------------------------------
	 * S006 StateWaitForAutomatic												  
	 *		Wait for start button 
	 * ------------------------------------------------------------------------------ *)
	StateWaitForAutomatic:

		(* On Entry *)
		IF bPulseStepCounter
		THEN
			g_sMACH.MCL.bActInitialise		:= FALSE;
			g_sMACH.MCL.bActConditioning := FALSE;
			g_sMACH.MCL.bActAutomatic	:= FALSE;
			g_sMACH.MCL.bActManual		:= FALSE;
			g_sMACH.MCL.bActCleaning		:= FALSE;
			g_HMI_MachCommand.CMD.bStartManual			:= FALSE;
			g_HMI_MachCommand.CMD.bStartCleaning		:= FALSE;
			g_HMI_MachCommand.CMD.bStartCycle		:= FALSE;

			g_sMACH.MCL.bHoldOnRequest		:= FALSE;
			g_sMACH.MCL.bStopEndOfCycle		:= FALSE;

			tDisableDrives(IN:=FALSE);
		END_IF

		(* Continous actions *)
		tDisableDrives(IN:=TRUE, PT:= t#1500ms);
		IF tDisableDrives.Q THEN									(* In AUT, MAN, INI cycles g_uControl_xxx.bAutomatic etc. is reset *)
			g_uControl_X_Axis.bEnableDrive	:= FALSE;			(* Resetting the bEnableDrive bit must be delayed *)
			g_uControl_Y_Axis.bEnableDrive	:= FALSE;
			{warning 'SVE - Check this change}
			//g_uControl_Front_Axis.bEnableDrive	:= g_uStatus_Front_Axis.nStateAxis <> 3 AND g_uStatus_Front_Axis.nStateAxis >= 2;			(* Resetting the bEnableDrive bit must be delayed *)
			//g_uControl_Rear_Axis.bEnableDrive	:= g_uStatus_Rear_Axis.nStateAxis <> 3 AND g_uStatus_Rear_Axis.nStateAxis >= 2;
			g_uControl_Front_Axis.bEnableDrive := g_uStatus_Front_Axis.eStateAxis > L_MC1P_AXIS_STATE.StandStill;	//XX_Motion
			g_uControl_Rear_Axis.bEnableDrive := g_uStatus_Rear_Axis.eStateAxis > L_MC1P_AXIS_STATE.StandStill;	//XX_Motion
			g_uControl_Z_Axis.bEnableDrive	:= FALSE;
			g_uControl_R_Axis.bEnableDrive	:= FALSE;
		END_IF;

		(* Transitions *)
		IF				(g_HMI_MachCommand.CMD.bStartCycle  OR (tonStartButton.Q AND g_HMI_MachCommand.bScanMode))					(* Start auto cycle *)
			AND NOT	g_sMACH.MCL.bStopOnErrorCat2
			AND NOT	g_sMACH.MCL.bHoldOnErrorCat3
			AND		g_bAxis_FrontSet								(* Axis referenced to zero (in manual page) *)
			AND		g_bAxis_RearSet								(* Axis referenced to zero (in manual page) *)
			AND		g_bAxis_RSet									(* Axis referenced to zero (in manual page) *)
			AND		((g_sHMI_CountersInfinite.dnHourCount <= g_HMI_MCH_dnBlockCounter) OR (g_HMI_MCH_dnBlockCounter = 0))
		THEN
			g_sMACH.MCL.nStepCounter := StateAutomatic;
		ELSIF g_HMI_MachCommand.CMD.bStartManual								(* Manual *)
		THEN
			g_sMACH.MCL.nStepCounter := StateManual;
		ELSIF g_HMI_MachCommand.CMD.bStartCleaning							(* Cleaning *)
		THEN
			g_sMACH.MCL.nStepCounter := StateCleaning;
		END_IF

	(* ------------------------------------------------------------------------------
	 * S007 StateAutomatic												  
	 *		Automatic busy
	 * ------------------------------------------------------------------------------ *)
	StateAutomatic:

		(* On Entry *)

		(* Continous actions *)
		g_sMACH.MCL.bActAutomatic := TRUE;
		IF	g_HMI_MachCommand.CMD.bPauseCycle
		THEN
			g_sMACH.MCL.bHoldOnRequest := TRUE;
		END_IF
		IF	g_HMI_MachCommand.CMD.bStartCycle
		THEN
			g_sMACH.MCL.bHoldOnRequest := FALSE;
		END_IF

		(* Transitions *)
		IF g_sMACH.AUT.bAutomaticReady
		THEN
			g_sMACH.MCL.nStepCounter := StateWaitForAutomatic;
			(* On Exit *)
			g_sMACH.MCL.bActAutomatic			:= FALSE;
			g_sMACH.MCL.bHoldOnRequest		:= FALSE;
		END_IF

	(* ------------------------------------------------------------------------------
	 * S008 StateManual												  
	 *		Manual mode busy 
	 * ------------------------------------------------------------------------------ *)
	StateManual:

		(* On Entry *)
		IF bPulseStepCounter
		THEN
			g_sMACH.MCL.bActManual := TRUE;
		END_IF

		(* Continous actions *)
		g_HMI_MachCommand.CMD.bStartManual	:= FALSE;
		IF 	g_HMI_MachCommand.CMD.bStopManual
		THEN
			g_sMACH.MCL.bStopEndOfCycle := TRUE;
		END_IF

		(* Transitions *)
		IF g_sMACH.MAN.bManualReady
		THEN
			g_sMACH.MCL.bActManual := FALSE;
			g_sMACH.MCL.nStepCounter := StateWaitForAutomatic;	(* StateWaitForInit; *)
		END_IF

	(* ------------------------------------------------------------------------------
	 * S009 StateCleaning												  
	 *		Cleaning mode busy 
	 * ------------------------------------------------------------------------------ *)
	StateCleaning:

		(* On Entry *)
		IF bPulseStepCounter
		THEN
			g_sMACH.MCL.bActCleaning := TRUE;
			g_HMI_MachCommand.CMD.bStopCleaning	:= FALSE;
		END_IF

		(* Continous actions *)
		IF	g_HMI_MachCommand.CMD.bStopCleaning
		THEN
			g_sMACH.MCL.bStopEndOfCycle := TRUE;
		END_IF

		(* Transitions *)
		IF	g_sMACH.CLN.bCleaningReady
		THEN
			g_sMACH.MCL.bActCleaning := FALSE;
			g_HMI_MachCommand.CMD.bStopCleaning	:= FALSE;
			g_sMACH.MCL.nStepCounter := StateWaitForAutomatic;	(*StateWaitForInit; *)
		END_IF

	END_CASE

END_PROGRAM
