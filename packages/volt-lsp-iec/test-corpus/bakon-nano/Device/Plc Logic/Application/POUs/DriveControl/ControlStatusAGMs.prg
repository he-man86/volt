PROGRAM ControlStatusAGMs
VAR
	bEnableParAGM1: BOOL;
	//bReadyReadParaAGM1: BOOL;
	dwOldUltrasonicPower1: DWORD;
	//ReadParametersFromAGM1	: ReadParametersFromAGM;
	StatusAGM1: StatusAGM;
	//WriteParametersToAGM1	: WriteParametersToAGM;
	//WriteControlRegAGM1: WriteControlRegAGM;
	TON_AGM1_Comm: TON;
	//dwAGM1_PowerLoss: DWORD;
	dwAGM1_Frequency: REAL;
	dwAGM1_ID: DWORD;
	dwUltrasonicPower1: DWORD;
END_VAR

(*****************************************************************************************************************************************************************)
(* Generator 1                                      *)
(*****************************************************************************************************************************************************************)

(*enable het schrijven van de amplitude naar de generatoren*)
bEnableParAGM1:=SEL(g_HMI_MachCommand.bScanMode, g_HMI_RCP_Parameters.dwUltrasonicPower1,100) <> dwOldUltrasonicPower1;

(****************************************************************************************************************************)
(*The parameters of the ultrasonic generator is read every 30 seconds, including the status*)
(****************************************************************************************************************************)
(*read parameters from AGM1*)
//ReadParametersFromAGM1(
//	I_bEnable:=				g_bOnDelayed  
//					AND NOT WriteParametersToAGM1.bStartWrite,
//	I_byNodeID:= 21,
//	bReady=> bReadyReadParaAGM1,
//	Q_dwAGM_Status:= g_dwAGM1_Status,
//	Q_dwAGM_PowerLoss:=dwAGM1_PowerLoss,
//	Q_dwAGM_Frequency:=dwAGM1_Frequency,
//	Q_dwAGM_ID			:= dwAGM1_ID);
//
//g_dwAGM1_PowerLoss := dwAGM1_PowerLoss AND 16#FFFF;	(* 0000FFFF *)
//g_dwAGM1_PowerLoss := g_iAI_UltrasonicPower;
//g_rAGM1_Frequency :=(dwAGM1_Frequency);

TON_AGM1_Comm(IN:=(dwAGM1_ID = 0 AND NOT g_bDQ_Ultrasonic1), PT:= t#25s);
g_sMACH.ERR.bAGM1_CommFailure := FALSE;//TON_AGM1_Comm.Q;

//Digital interfacing with ultrasonic generator
IF g_bDI_UltraSonic_Error THEN
	//Error Generator
	IF g_bDI_UltraSonic_ErrorCode_1
	AND NOT g_bDI_UltraSonic_ErrorCode_2 THEN
		g_dwAGM1_Status := 1073741824;	//Bit 30
	//Error Oscillator
	ELSIF NOT g_bDI_UltraSonic_ErrorCode_1
	AND g_bDI_UltraSonic_ErrorCode_2 THEN
		g_dwAGM1_Status := 1073741824;	//Bit 30
	//Error limit
	ELSIF g_bDI_UltraSonic_ErrorCode_1
	AND g_bDI_UltraSonic_ErrorCode_2 THEN
		g_dwAGM1_Status := 2097152;		//Bit 21
	ELSE
		g_dwAGM1_Status := 2147483648; 	//Bit 31
	END_IF
END_IF

StatusAGM1(
	I_dwAGM_Status:=g_dwAGM1_Status);

g_sHMI_Mach_UnitStatus.dwErrorDetailsAGM1 := StatusAGM1.Q_dwErrorDetailsAGM;

IF StatusAGM1.Q_bError
	AND g_HMI_MCH_Parameters.bUltrasonicEnable1
THEN
	g_sMACH.ERR.bUltrasonic1:= TRUE;
END_IF

(*****************************************************************************************************************************************************************)
(*write parameters to AGM1*)
(* Uitsturing [%] = 40 - 4/6*(MaxFactor-40)+((MaxFactor-40)/60) * Receptwaarde [%]; *)
dwUltrasonicPower1	:= REAL_TO_DWORD(40 - ((4.0 / 6.0) * (C_rMaxPowerUS1 - 40)) + (((C_rMaxPowerUS1 - 40.0) / 60.0) * DWORD_TO_REAL(SEL(g_HMI_MachCommand.bScanMode, g_HMI_RCP_Parameters.dwUltrasonicPower1,100))));

//WriteParametersToAGM1(I_bEnable:= bEnableParAGM1 ,// g_aCanMasterState[1] =CanMaster_Operational,
//							I_byNodeId:= 21,
//							I_dwAGM_Amplitude:= dwUltrasonicPower1);
//
//(*Test the AGM generator*)
//WriteControlRegAGM1(byNodeID:=21,
//							bStartAGM:= FALSE, (*bStartAGM1 AND g_aCanMasterState[1] =CanMaster_Operational, *)
//							bStopAGM:=FALSE, (*bStopAGM1 AND g_aCanMasterState[1] =CanMaster_Operational, *)
//							bTestAGM:=g_bTestAGM1 );(*AND AGM.bSlaveAvailable*)// g_aCanMasterState[1] =CanMaster_Operational );

g_iAQ_UltrasonicPower := TO_INT(dwUltrasonicPower1);

(*****************************************************************************************************************************************************************)
(* Copy the change of the amplitude*)
dwOldUltrasonicPower1:=SEL(g_HMI_MachCommand.bScanMode, g_HMI_RCP_Parameters.dwUltrasonicPower1,100);

END_PROGRAM
