PROGRAM Ecat_SetState
(************************************************************)
(* Test EtherCAT libs - set  slave / master state  	 *)
(************************************************************)
(* Lenze  LAAS-PO 	*)
(************************************************************)
(*   *)
(************************************************************)
(* 1.00	FA				generated  *)
	
VAR
	nSeq				: INT;
	dndummy				: DINT;

	bSetInit			: BOOL;
	bSetPreOP			: BOOL;
	bSetSafeOP			: BOOL;
	bSetOP				: BOOL;

	(* Neuen Status anfordern *)
	wStationAdress		: WORD:=1001;
	esReqState			: L_ETC_STATE :=8;
	bEsSetExec			: BOOL;
	xSetStateDone		: BOOL;
	xSetStateError		: BOOL;
	

	EcatSetSlaveState	: L_ETC_SetSlaveState;
	sETCerror			: STRING;
	diSetState: INT;
END_VAR

(* check if master is configured *)
IF TRUE THEN

	IF bEsSetExec THEN
		CASE diSetState OF
			0: esReqState :=1;
			1: esReqState :=2;
			2: esReqState :=4;
			3: esReqState :=8;
			ELSE
			esReqState :=8;
		END_CASE
			EcatSetSlaveState(
					xExecute:= TRUE, 
					uiDevice:= wStationAdress, 
					wState:= esReqState, 
					udiTimeout:= 1000, 
					xDone=> xSetStateDone, 
					xBusy=> , 
					xError=> xSetStateError, 
					eErrorCode=> );
			IF EcatSetSlaveState.xError THEN
				sETCerror := L_ETC_GetErrorString( EcatSetSlaveState.eErrorCode, 1);
			END_IF
	ELSE
			sETCerror :=' ';
			IF EcatSetSlaveState.xDone OR EcatSetSlaveState.xError THEN
				EcatSetSlaveState(
					xExecute:= FALSE, 
					uiDevice:= wStationAdress, 
					wState:= esReqState, 
					udiTimeout:= 1000, 
					xDone=> xSetStateDone, 
					xBusy=> , 
					xError=> xSetStateError, 
					eErrorCode=> );
			END_IF;	
	END_IF;

END_IF;

END_PROGRAM
