PROGRAM AxisControlLogic
VAR
	//LenzeDrive_ECSE_Supply1	: L_SCS_SupplyModule;(*TODO: Lenze supply module is enkel nog een I/O puntje*)
END_VAR

(*****************************************************************************************************************************************************************)
(* Supply module*)
(*LenzeDrive_ECSE_Supply1(
	scDriveControl	:= ,
	xOptional			:= ,
	byNodeNumber	:= 20 ,
	byMasterNumber	:= 0 ,
	scDriveStatus		=> );

g_sHMI_Mach_UnitStatus.dwErrorDetailsDriveSupply	:= LenzeDrive_ECSE_Supply1.scDriveStatus.eErrorCode;
g_sMACH.ERR.bDriveSupplyCommNotOk := NOT LenzeDrive_ECSE_Supply1.scDriveStatus.xCommunicationOK;*)
(*****************************************************************************************************************************************************************)
(*read and write parameters to the different drives, IO station*)
(*TODO??*)
(*ReadWriteParameter(
	bExecuteReadPara:= g_HMI_CAN_bReceive,
	bExecuteWritePara:=g_HMI_CAN_bSend ,
	wCode:=g_HMI_CAN_nCode ,
	bySubIndex:=INT_TO_BYTE(g_HMI_CAN_nSubCode ),
	nStationNumber:=g_HMI_CAN_nStation,
	rCodeValue:=g_HMI_CAN_rValue ,
	bDone=> ,
	bError=> );

g_HMI_CAN_bReady := ReadWriteParameter.bDone;
g_HMI_CAN_bError	:= ReadWriteParameter.bError;*)

END_PROGRAM
