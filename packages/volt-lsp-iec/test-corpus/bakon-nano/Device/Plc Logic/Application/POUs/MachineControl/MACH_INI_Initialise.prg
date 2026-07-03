PROGRAM MACH_INI_Initialise
VAR
	bPulseStepCounter		: BOOL;
	bWait						: BOOL;
	tWatchDogTimer			: TON;
	tStepTimer				: TOF;
END_VAR

(*************************************************************************
 *
 * Application name				: Snijmachine
 * Module name					: MACH_INI_Initialise
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
IF	  NOT g_sMACH.MCL.bActInitialise
THEN
		  g_sMACH.uINI.nStepCounter := C_NOT_ACTIVE;
END_IF


IF		g_sMACH.uINI.nStepCounter <> C_NOT_ACTIVE
THEN
	(* -------------------------------------------------------------------------
	 * Prestep Code
	 * ------------------------------------------------------------------------- *)
				  ;
END_IF;

(* detect change of state *)
bPulseStepCounter	  := g_sMACH.uINI.nStepCounter <> g_sMACH.uINI.nOldStepCounter;
g_sMACH.uINI.nOldStepCounter := g_sMACH.uINI.nStepCounter;

(* Steptimer *)
tStepTimer (IN:= bPulseStepCounter, PT:= REAL_TO_TIME(g_sMACH.uINI.rStepTime));
bWait := tStepTimer.Q;

(* Watchdogtimer *)
tWatchDogTimer (IN:= 	NOT	bPulseStepCounter
						AND		g_sMACH.MCL.bActInitialise
						AND NOT	g_HMI_MachCommand.CMD.bResetErrorPulse
						AND		g_sMACH.uINI.rWatchdogTime <> 0,
					PT:= REAL_TO_TIME(g_sMACH.uINI.rWatchdogTime));
g_sMACH.uINI.bAlmError := tWatchDogTimer.Q;


CASE g_sMACH.uINI.nStepCounter OF
	(* --------------------------------------------------------------------------
	 * S-1  C_NOT_ACTIVE
	 *		OnEntry: Ready  := FALSE
	 *		OnEntry: Busy	:= FALSE
	 *		OnEntry: Reset all non-stored commands
	 * T000 Activate signal
	 * -------------------------------------------------------------------------- *)
	C_NOT_ACTIVE:

		(* On Entry *)
		IF			bPulseStepCounter
		THEN
					g_sMACH.uINI.rWatchdogTime		:= 0;
					g_sMACH.uINI.bInitialiseReady		:= FALSE;
					g_sMACH.uINI.bInitialiseBusy		:= FALSE;
					MACH_SUB_Initialise.I_rX_InfeedPosition		:= g_HMI_MCH_Parameters.rInfeedPosition_X;
					MACH_SUB_Initialise.I_rY_InfeedPosition		:= g_HMI_MCH_Parameters.rInfeedPosition_Y;
					MACH_SUB_Initialise.I_rY_InfeedPrePosition	:= g_HMI_MCH_Parameters.rInfeedPosition_Y + 30;
					g_bSUB_InitStart						:= FALSE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		g_sMACH.MCL.bActInitialise
		THEN
				g_sMACH.uINI.nStepCounter			:= C_INITIAL;
		END_IF

	(* --------------------------------------------------------------------------
	 * S000 C_INITIAL
	 *		OnEntry: Ready := FALSE
	 *		OnEntry: Busy  := TRUE
	 *		Start SUB Init
	 * T001 Always
	 * -------------------------------------------------------------------------- *)
	C_INITIAL:

		(* On Entry *)
		IF		bPulseStepCounter
		THEN
				g_sMACH.uINI.rWatchdogTime			:= 0;
				g_sMACH.uINI.bInitialiseReady			:= FALSE;
				g_sMACH.uINI.bInitialiseBusy			:= TRUE;

				g_bSUB_InitStart							:= TRUE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF		g_bSUB_InitDone
		THEN
				g_bSUB_InitStart					:= FALSE;
				g_sMACH.uINI.nStepCounter		:= C_READY;
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
					g_sMACH.uINI.rWatchdogTime	:= 0;
					g_sMACH.uINI.bInitialiseReady		:= TRUE;
					g_sMACH.uINI.bInitialiseBusy		:= FALSE;
		END_IF

		(* Continuous actions *)

		(* Transitions *)
		IF			FALSE
		THEN
					g_sMACH.uINI.nStepCounter				:= C_INITIAL;
		END_IF

(* --------------------------------------------------------------------------
 * Illegal state
 * -------------------------------------------------------------------------- *)
ELSE
	(* Programming error: Illegal state *)
	g_sMACH.uINI.rWatchdogTime := 10;
END_CASE;


IF			g_sMACH.uINI.nStepCounter <> C_NOT_ACTIVE
THEN
	(* -------------------------------------------------------------------------
	 * Poststep Code
	 * ------------------------------------------------------------------------- *)
	;
END_IF

END_PROGRAM
