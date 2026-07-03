PROGRAM CyclicTask
VAR
	TON1: TON;
	Cnt_pos: INT;
	(*SMC_GetAxisGroupState1: SMC_GetAxisGroupState;	(*TODO: Ethercat bus controle + ethercat bus reset*)
	SMC_ResetAxisGroup1: SMC_ResetAxisGroup;*)
	dtRealDateAndTime : DATE_AND_TIME;
	dtDiff : TIME;
	Result	: UDINT;
END_VAR

TON1(IN:=(EtherCAT_Master.wState = L_ETC.L_ETC_STATE.ETC_STATE_OPERATIONAL), Pt:=T#12s);
g_bOnDelayed:=TON1.Q;





(* Calling of the programm for CAN-configuration*)
//L_SCB_CanStatus(tPdoTimeOut:=T#1000ms , xAutomaticReset:=TRUE , tResetTime:=T#10s );
//L_SCB_SetOptional(byNodeNumber:=21, byMasterNumber:=1);(*Komt in 2014 voor Ethercat, nu alleen met vinkje in HW-config*)

(* Fixed machine configuration due to fault in VisWinNet !? *)
//g_HMI_dwMachineConfig		:= 16#0000;	(* 0000.0000 *)

(* Machine configuration bits *)
//gMachConfig.bPneumaticRaxis		:= g_HMI_dwMachineConfig.0;		//Not used anymore!!
gMachConfig.bCleaningUnit		:= g_HMI_dwMachineConfig.1;
//gMachConfig.bNano				:= g_HMI_dwMachineConfig.2;		//Not used anymore!!
gMachConfig.bXL					:= g_HMI_dwMachineConfig.3;
gMachConfig.bRedCase			:= g_HMI_dwMachineConfig.4;
gMachConfig.bCrashDetection		:= g_HMI_dwMachineConfig.5;


(* Product configuration bits *)
gProductOption.Prod_SlabSquare			:= g_HMI_dwProductOptions.0;
gProductOption.Prod_SlabTriangle		:= g_HMI_dwProductOptions.1;
gProductOption.Prod_SlabDiagonal		:= g_HMI_dwProductOptions.2;
gProductOption.Prod_Round				:= g_HMI_dwProductOptions.3;
gProductOption.Prod_TraySquareSmall		:= g_HMI_dwProductOptions.4;
gProductOption.Prod_TraySquareLarge		:= g_HMI_dwProductOptions.5;
gProductOption.Prod_TraySquareTriple	:= g_HMI_dwProductOptions.6;	
gProductOption.Prod_SlabSquareClamp		:= g_HMI_dwProductOptions.7;	
gProductOption.Prod_TraySquareDouble	:= g_HMI_dwProductOptions.8;	
gProductOption.Prod_RoundQuatro			:= g_HMI_dwProductOptions.9;	
gProductOption.Prod_SlabDouble			:= g_HMI_dwProductOptions.10;	
gProductOption.TrianglesInTray			:= g_HMI_dwProductOptions.15;	

IF	(EtherCAT_Master.wState = L_ETC.L_ETC_STATE.ETC_STATE_OPERATIONAL) AND g_bOnDelayed  THEN
		AxisControlLogic();
(*	InputControl;*)(*Moved to motiontask*)
//	ControlStatusAGMs(); //Moved to the CAN BRIDGE PLC!!
	CanBridgeAGM(); //CAN BRIDGE PLC
	MACH_Call();
(*	OutputControl;*) (*Moved to motiontask*)
	g_bFirstCycle := FALSE;
ELSE
	g_bFirstCycle := TRUE;
	(* During start fill the positioningtable with blancs *)
	FOR Cnt_pos := 1 TO (C_wNumberOfMotionObjects)  BY 1 DO
		g_aCuttingPositions[Cnt_pos].X_Target:=-50;
		g_aCuttingPositions[Cnt_pos].Y_Target:=-50;
		g_aCuttingPositions[Cnt_pos].A_Target:=-50;
		g_aCuttingPositions[Cnt_pos].bPushAwayProduct := FALSE;
		g_aCuttingPositions[Cnt_pos].rPushAwayDistance := 0;
	END_FOR
	g_bDQ_Servo_Power_Reset := TRUE;
END_IF

Ecat_ReadStatus();
ECAT_MasterHandling();

//Redcase timers;
IF gMachConfig.bRedCase THEN
	dtRealDateAndTime := DWORD_TO_DT(SysTimeRtcGet(pResult := Result));
	dtDiff := dtRealDateAndTime - g_nRedCaseLastTime;
	IF (dtDiff >= DINT_TO_TIME(3600*1000) AND g_bScanDataPending) OR (dtDiff > DINT_TO_TIME(3600*24000)) THEN
		g_bContactRedCase := TRUE; 
	END_IF
	IF g_bRedCaseTried THEN
		g_nRedCaseLastTime := dtRealDateAndTime;
		g_bRedCaseTried := FALSE;
		g_bContactRedCase := FALSE;
		g_sHMI_Mach_UnitStatus.bScanFinished := FALSE; 
	END_IF
END_IF

END_PROGRAM
