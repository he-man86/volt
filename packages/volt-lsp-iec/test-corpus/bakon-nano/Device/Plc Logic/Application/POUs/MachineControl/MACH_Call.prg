PROGRAM MACH_Call
VAR
END_VAR

(*************************************************************************
 *
 * Application name			: Snijmachine
 * Module name				: MACH_Call
 * Version number module	: 0.00
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

	(* -------------------------------------------------------------------------
	* Execution Control functions
	* ------------------------------------------------------------------------- *)
	MACH_HMI_Control();

	(* -------------------------------------------------------------------------
	* Execution Control functions
	* ------------------------------------------------------------------------- *)
	MACH_INI_Initialise();
(*    MACH_AUT_Automatic(); *)
	MACH_MAN_Manual();
	MACH_ERH_ErrorHandler();
	MACH_MCL_ModeControl();
	MACH_CLN_Cleaning();

	(* -------------------------------------------------------------------------
	* Drivers and calculations
	* ------------------------------------------------------------------------- *)
	MACH_DRV_DriverCall();
	Calc_Main();	(* Calculations *)

	(* -------------------------------------------------------------------------
	* Miscellaneous
	* ------------------------------------------------------------------------- *)
	MACH_MIS_Miscellaneous();
	MACH_ParameterHandler();
	RCP_RecipeHandler();
	HMI_ResetSignals();
	{warning 'Disabled for compatibility - SVE'}
	//g_Logger(directoryName := '/USBStorage/IPC/PLC/KC_Logs');

END_PROGRAM
