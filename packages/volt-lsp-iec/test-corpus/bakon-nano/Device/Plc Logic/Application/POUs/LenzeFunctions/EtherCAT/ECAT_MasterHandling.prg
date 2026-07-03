PROGRAM ECAT_MasterHandling
(************************************************************)
(* Test EtherCAT libs - ECAT_MasterHandling  	 *)
(************************************************************)
(* Lenze  LAAS-PO 	*)
(************************************************************)
(*   *)
(************************************************************)
(* 1.00	MD				generated  *)

VAR
	xECATRestart			: BOOL;
	SMC3_ReinitAxis_1: L_MC1P_ReinitNode;
	SMC3_ReinitAxis_2: L_MC1P_ReinitNode;
	SMC3_ReinitAxis_3: L_MC1P_ReinitNode;
	SMC3_ReinitAxis_4: L_MC1P_ReinitNode;
	TonRestart : TON;
END_VAR

TonRestart(IN:= g_bResetMaster AND g_HMI_MachCommand.CMD.bResetErrorPulse,PT:=T#0S);
IF TonRestart.Q THEN
	xECATRestart := TRUE;
END_IF

EtherCAT_Master(
	xRestart:= xECATRestart, 
	xStopBus:= , 
	xDone=> , 
	xBusy=> , 
	xError=> , 
	eErrorCode=> , 
	wState=> , 
	xDistributedClockInSync=> );
	
	//EtherCAT_Master.xRestart := xECATRestart;
	
	SMC3_ReinitAxis_1(
	xExecute:= IoConfig_Globals.EtherCAT_Master.xDone, 
	Axis:= IoConfig_Globals.Front_Axis, 
	xDone=> , 
	xBusy=> , 
	xError=> , 
	eErrorID=> );
	
	SMC3_ReinitAxis_2(
	xExecute:= SMC3_ReinitAxis_1.xDone, 
	Axis:= IoConfig_Globals.Rear_Axis, 
	xDone=> , 
	xBusy=> , 
	xError=> , 
	eErrorID=> );
	
	SMC3_ReinitAxis_3(
	xExecute:= SMC3_ReinitAxis_2.xDone, 
	Axis:= IoConfig_Globals.Z_Axis, 
	xDone=> , 
	xBusy=> , 
	xError=> , 
	eErrorID=> );

	SMC3_ReinitAxis_4(
	xExecute:= SMC3_ReinitAxis_3.xDone, 
	Axis:= IoConfig_Globals.R_Axis, 
	xDone=> , 
	xBusy=> , 
	xError=> , 
	eErrorID=> );


	IF SMC3_ReinitAxis_4.xDone THEN
		xECATRestart := FALSE;
	END_IF

END_PROGRAM
