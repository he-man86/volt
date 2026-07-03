PROGRAM Ecat_ReadStatus
(************************************************************)
(* Test EtherCAT libs - get  slave state  	 *)
(************************************************************)
(* Lenze  LAAS-PO 	*)
(************************************************************)
(*   *)
(************************************************************)
(* 1.00	FA				generated  *)

VAR
	emd							: L_ETC_DIAGNOSTIC;
	xEcatResetNotifications		: BOOL;
	dwNoOfConfigSlaves			: DWORD;
	dwNoOfConnectedSlaves		: DWORD;
	
	(* fb instances *)
	ECatMaster					: L_ETC_GetMasterDiagnostic;
	ECatGetSlaveState			: L_ETC_GetSlaveState;


	(* sequence *)
	nSeq							: INT;
	bCyclic							: BOOL:=TRUE;	
	wActSlaveAdr					: WORD:=1001;

	(* slave states *)
	wStateTemp					: L_ETC_STATE;
	wStateTemp1					: L_ETC_STATE;
	aEssCur						: ARRAY [1..10] OF L_ETC_STATE ;
	aEssSet						: ARRAY [1..10] OF L_ETC_STATE ;
END_VAR

ECatMaster(
		xReset:= xEcatResetNotifications, 
		xDone=> , 
		xBusy=> , 
		xError=> , 
		eErrorCode=> , 
		oDiagnostic=> emd);

	dwNoOfConfigSlaves := emd.uiNumberOfSlavesConfigured;
	dwNoOfConnectedSlaves := emd.uiNumberOfSlavesFound;
		
	IF dwNoOfConfigSlaves > 10 THEN
		dwNoOfConfigSlaves := 10;
	END_IF;



	CASE nSeq	OF
	0:
		ECatGetSlaveState(
			xExecute:= TRUE, 
			uiDevice:= wActSlaveAdr, 
			udiTimeout:= 1000, 
			xDone=> , 
			xBusy=> , 
			xError=> , 
			eErrorCode=> , 
			wState=> wStateTemp);
	
		IF ECatGetSlaveState.xDone OR ECatGetSlaveState.xError THEN
			IF 	NOT ECatGetSlaveState.xError THEN
				(* Uebernahme mit Done, da Zwischenzustaender in der busy-Phase *)
				aEssCur[wActSlaveAdr-1000] := wStateTemp;
				aEssSet[wActSlaveAdr-1000]:= wStateTemp1;
			ELSE
				aEssCur[wActSlaveAdr-1000] := 1;
			END_IF;
			nSeq := 1;
			ECatGetSlaveState(xExecute:= FALSE);
		END_IF;

	1:
		IF wActSlaveAdr >= 1000 + dwNoOfConfigSlaves THEN
			wActSlaveAdr := 1001;
		ELSE
			wActSlaveAdr := wActSlaveAdr +1;
		END_IF;
		nSeq := 2;

	2:
		IF bCyclic THEN
			nSeq := 0;
		END_IF	
	END_CASE;

	IF aEssCur[3] = 1 THEN
		g_sMACH.ERR.bErrorComIOStation := TRUE;
	END_IF


	g_bResetMaster := FALSE;
	//FOR i := 1 TO DWORD_TO_INT(dwNoOfConfigSlaves) DO
		IF NOT Front_Axis.xCommunicationOK
			OR NOT Rear_Axis.xCommunicationOK 
			OR NOT Z_Axis.xCommunicationOK
			OR NOT R_Axis.xCommunicationOK
			OR g_sMACH.ERR.bErrorComIOStation
			THEN
			g_bResetMaster := TRUE;
		END_IF 
	//END_FOR

END_PROGRAM
