PROGRAM EdgePcPrg
VAR
	client							: EdgePcLogging.EdgePcClient;
	taskInterval					: BYTE;
	logCache						: EdgePcLogging.LogCache;		// INTERNAL use only! Please use 'client' to log data!
	stringLogCache					: EdgePcLogging.StringLogCache;	// INTERNAL use only! Please use 'client' to log data!
	ConnectDelay					: BTON;
	connectToEdgePcClient			: BOOL := TRUE;
	{attribute 'init_on_onlchange' }
	forceReconnectOnOnlineChange	: BOOL := TRUE;

	ProductionStatisticListener		: ProductionStatisticListenerFB;

	taskInfo				: CmpIecTask.Task_Info2;

END_VAR

__TRY
taskInfo	:= TaskGetInfo();

IF NOT Initialize() THEN
	RETURN;
END_IF

client(
	connect			:= ConnectDelay.Set(connectToEdgePcClient AND NOT forceReconnectOnOnlineChange, 2),
	ipv4Address		:= HMI.ipAddressEdgePC,
	port			:= HMI.communicationPortEdgePC,
	serSerialNo		:= HMI.robotSerial,
	logCache		:= logCache,
	stringLogCache	:= stringLogCache,
	connSpeed		:= ConnectionSpeed.S100Mbps,
	cycleMs			:= taskInterval // Verify that this value is the cycle interval of the EdgePcTask!
);

forceReconnectOnOnlineChange R= forceReconnectOnOnlineChange;

ProductionStatisticListener(
		subject			:= SER.Statistics,
		edgePcClient	:= client,
);


__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.EdgePcTask])
	GVL_Exceptions.xException := TRUE;
	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;
__ENDTRY

END_PROGRAM

METHOD PRIVATE Initialize : BOOL
VAR_INST
	{attribute 'init_on_onlchange'}
	initialized	: BOOL;
END_VAR
IF initialized THEN
	Initialize		:= TRUE;
	RETURN;
END_IF

taskInterval		:= TO_BYTE(TaskGetInterval());

IF NOT Stu.StrIsNullOrEmptyA(ADR(HMI.robotSerial))
AND taskInterval <> 0
THEN
	initialized		:= TRUE;
	Initialize		:= TRUE;
END_IF
END_METHOD
