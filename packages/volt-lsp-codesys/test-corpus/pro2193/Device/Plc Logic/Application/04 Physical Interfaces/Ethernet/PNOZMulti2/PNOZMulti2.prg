PROGRAM PNOZMulti2
VAR
	ModuleHandler				: L_IMHP.L_IMHP_ModuleHandler :=		// Needs to be first in the list of VARs
	(
		CompName			:= 'Safety Controller',
		Layer				:= L_IMHP_Layer.Process_Control,
		CompType			:= L_IMHP_ComponentType.GeneralMachineModule
	);
END_VAR
VAR_INPUT
	ipAddress				: STRING(20);
	xButtonAcknSafetyGates	: BOOL;
	ButtonResetSafetyMat	: PushButtonLedFB;
END_VAR
VAR_OUTPUT
	warningActive			: BOOL;
	errorActive				: BOOL;

	xLedOFault				: BOOL;
	xLedIFault				: BOOL;
	xLedFault				: BOOL;
	xLedDiag				: BOOL;
	xLedRun					: BOOL;

	xOperatorSwitch			: BOOL;
	xHoldToRunButton		: BOOL;
	xServiceSwitch			: BOOL;
	xHmiSwitch				: BOOL;
	xEnableAir				: BOOL;
	xEnableAirBFU			: BOOL;
	xEnableAirDrawer		: ARRAY[1..2] OF BOOL;
	xDrawerHoodWasOpenedM	: ARRAY[1..2] OF BOOL;

	dwSafetyPLCStatus		: ARRAY[0..3] OF  DWORD;
END_VAR
VAR
	TCPClient				: NBS.TCP_Client;
	eErrorTCPClient			: NBS.ERROR;
	T_ReInitClient			: BTON;

	TCPReader				: NBS.TCP_Read;
	xEnableReader			: BOOL;
	eErrorTCPReader			: NBS.ERROR;
	abyReadBuffer			: ARRAY[0..42] OF BYTE;		// the receive array
	byChecksumReader		: BYTE;
	T_ReaderTimeOut			: TON;

	TCPWriter				: NBS.TCP_Write;
	xEnableWriter			: BOOL;
	eErrorWriter			: NBS.ERROR;
	abyWriteBuffer			: ARRAY[0..42] OF BYTE;		// the send array must be 0..42 otherwise the data transfer with Pilz PNOZ dont work.
	byChecksumWriter		: BYTE;
	BlinkWriter				: Blink;
	T_ToggleWriter			: TON;

	i						: INT;
	ipAddressStruct			: NBS.IP_ADDR;
	tTaskInterval			: TIME;

	ReadActualSeverity		: L_IE1P.L_IE1P_ReadActualSeverity;

	GeneralFaultAlarm		: SetErrorFB;
	GeneralIFaultAlarm		: SetErrorFB;
	GeneralOFaultAlarm		: SetErrorFB;
	GeneralDiagAlarm		: SetErrorFB;
	GeneralRunAlarm			: SetErrorFB;

	eStopMainCabinet		: PnozEmergencyStopAlarmsFB;
	eStopControlPanel		: PnozEmergencyStopAlarmsFB;
	eStopZ1					: PnozEmergencyStopAlarmsFB;
//	eStopZ2					: PnozEmergencyStopAlarmsFB;
	eStopM1					: PnozEmergencyStopAlarmsFB;
//	eStopM2					: PnozEmergencyStopAlarmsFB;
//	eStopPortal				: PnozEmergencyStopAlarmsFB;
	eStopConveyor			: PnozEmergencyStopAlarmsFB;
	eStopBFU				: PnozEmergencyStopAlarmsFB;
	eStopIMM				: PnozEmergencyStopAlarmsFB;
	eStopFanuc				: PnozEmergencyStopAlarmsFB;

	holdToRunButton			: PnozEnableSwitchAlarmsFB;
	frontPanelModeSelector	: PnozEnableSwitchAlarmsFB;
	serviceModeSelector		: PnozEnableSwitchAlarmsFB;

	eStopOkIMMOutput		: PnozOutputWithFeedbackLoopAlarmsFB;
	eStopOkOutput			: PnozOutputWithFeedbackLoopAlarmsFB;
	airvalveOutput			: PnozOutputWithFeedbackLoopAlarmsFB;
	airvalveBFUOutput		: PnozOutputWithFeedbackLoopAlarmsFB;
	gatesOkOutput			: PnozOutputWithFeedbackLoopAlarmsFB;
	gatesBFUOkOutput		: PnozOutputWithFeedbackLoopAlarmsFB;

	safetyMat1				: PnozSafetyMatAlarmsFB;
//	safetyMat2				: PnozSafetyMatAlarmsFB;

	gateSER					: PnozSafetyGateAlarmsFB;
//	gateZUR					: PnozSafetyGateAlarmsFB;
	gateIMM					: PnozSafetyGateAlarmsFB;
	gateBFU					: PnozSafetyGateAlarmsFB;
	gateSensorDrawerM1		: PnozSafetyGateAlarmsFB;
	gateDrawerHoodM1		: PnozSafetyGateAlarmsFB;
	gateDrawerM1			: PnozSafetyGateAlarmsFB;
//	gateSensorDrawerM2		: PnozSafetyGateAlarmsFB;
//	gateDrawerHoodM2		: PnozSafetyGateAlarmsFB;
//	gateDrawerM2			: PnozSafetyGateAlarmsFB;

	hmiKeySwitch			: PnozEnableSwitchAlarmsFB;

END_VAR
VAR CONSTANT
	uiCommunicationPort		: UINT	:= 9000;					// Send and Receive port
	udiTimeout				: UDINT	:= 5_000_000;				// time (µs)
END_VAR

IF NOT Initialize() THEN
	RETURN;
END_IF

Alarms();
ButtonResetSafetyMat();

IF safetyMat1.activated THEN		// OR safetyMat2.activated THEN
	ButtonResetSafetyMat.Solid();
ELSIF safetyMat1.readyForReset THEN	// OR safetyMat2.readyForReset THEN
	ButtonResetSafetyMat.Flash();
ELSE
	ButtonResetSafetyMat.Off();
END_IF


TCPClient.xEnable			S= NOT TCPClient.xActive;
TCPClient.xEnable			R= TCPWriter.xError;

IF T_ReInitClient.Set(In := NOT TCPClient.xActive, Pt := 3) THEN
	T_ReInitClient.Reset();
	TCPClient.xEnable		:= FALSE;
	T_ToggleWriter.IN		:= TRUE;
END_IF

CreateTelegram();

T_ToggleWriter(PT := tTaskInterval);
IF T_ToggleWriter.Q THEN
	T_ToggleWriter(IN		:= FALSE);
	T_ToggleWriter.IN		:= TRUE;
	xEnableWriter			:= TRUE;
END_IF
xEnableWriter	R= TCPWriter.xDone OR TCPWriter.xError OR NOT TCPClient.xActive;

FunctionBlocks();

xEnableReader	S= TCPWriter.xDone;
IF TCPReader.xReady THEN
	xEnableReader	:= FALSE;
	IF ValidateMessage() THEN
		MapTheOutputs();
	END_IF
ELSIF T_ReaderTimeOut.Q THEN	// Als de TCPReader niets heeft gelezen alle data leeg schrijven
	xEnableReader	:= FALSE;
	FOR i := 0 TO TO_INT(UPPER_BOUND(abyReadBuffer, 1)) DO
		abyReadBuffer[i]	:= 0;
	END_FOR
	MapTheOutputs();
END_IF
T_ReaderTimeOut(IN:= xEnableReader, PT := tTaskInterval * 5);

END_PROGRAM

METHOD PRIVATE Alarms
VAR_INST
//	GeneralFaultAlarm		: SetErrorFB;			Definition in PNOZMulti2 because this is a PRG (and not a FB)
//	GeneralIFaultAlarm		: SetErrorFB;
//	GeneralOFaultAlarm		: SetErrorFB;
//	GeneralDiagAlarm		: SetErrorFB;
//	GeneralRunAlarm			: SetErrorFB;
END_VAR
eStopMainCabinet(
	elementId			:= 1,
	ModuleParent		:= ModuleHandler,
	eStopOperated		:= ReturnOutputFromNumber(0),		// eth.o0
	contactFailed		:= ReturnOutputFromNumber(1),		// eth.o1
	errorTestPulse		:= ReturnOutputFromNumber(2));		// eth.o2
eStopControlPanel(
	elementId			:= 2,
	ModuleParent		:= ModuleHandler,
	eStopOperated		:= ReturnOutputFromNumber(3),		// eth.o3
	contactFailed		:= ReturnOutputFromNumber(4),		// eth.o4
	errorTestPulse		:= ReturnOutputFromNumber(5));		// eth.o5
eStopZ1(
	elementId			:= 3,
	ModuleParent		:= ModuleHandler,
	eStopOperated		:= ReturnOutputFromNumber(6),		// eth.o6
	contactFailed		:= ReturnOutputFromNumber(7),		// eth.o7
	errorTestPulse		:= ReturnOutputFromNumber(8));		// eth.o8
//eStopZ2(
//	elementId			:= 4,
//	ModuleParent		:= ModuleHandler,
//	eStopOperated		:= ReturnOutputFromNumber(9),		// eth.o9
//	contactFailed		:= ReturnOutputFromNumber(10),		// eth.o10
//	errorTestPulse		:= ReturnOutputFromNumber(11));		// eth.o11
eStopM1(
	elementId			:= 5,
	ModuleParent		:= ModuleHandler,
	eStopOperated		:= ReturnOutputFromNumber(12),		// eth.o12
	contactFailed		:= ReturnOutputFromNumber(13),		// eth.o13
	errorTestPulse		:= ReturnOutputFromNumber(14));		// eth.o14
//eStopM2(
//	elementId			:= 6,
//	ModuleParent		:= ModuleHandler,
//	eStopOperated		:= ReturnOutputFromNumber(15),		// eth.o15
//	contactFailed		:= ReturnOutputFromNumber(16),		// eth.o16
//	errorTestPulse		:= ReturnOutputFromNumber(17));		// eth.o17
//eStopPortal(
//	elementId			:= 7,
//	ModuleParent		:= ModuleHandler,
//	eStopOperated		:= ReturnOutputFromNumber(18),		// eth.o18
//	contactFailed		:= ReturnOutputFromNumber(19),		// eth.o19
//	errorTestPulse		:= ReturnOutputFromNumber(20));		// eth.o20
eStopConveyor(
	elementId			:= 8,
	ModuleParent		:= ModuleHandler,
	eStopOperated		:= ReturnOutputFromNumber(21),		// eth.o21
	contactFailed		:= ReturnOutputFromNumber(22),		// eth.o22
	errorTestPulse		:= ReturnOutputFromNumber(23));		// eth.o23
eStopBFU(
	elementId			:= 9,
	ModuleParent		:= ModuleHandler,
	eStopOperated		:= ReturnOutputFromNumber(24),		// eth.o24
	contactFailed		:= ReturnOutputFromNumber(25),		// eth.o25
	errorTestPulse		:= ReturnOutputFromNumber(26));		// eth.o26
eStopIMM(
	elementId			:= 10,
	ModuleParent		:= ModuleHandler,
	eStopOperated		:= ReturnOutputFromNumber(27),		// eth.o27
	contactFailed		:= ReturnOutputFromNumber(28),		// eth.o28
	errorTestPulse		:= ReturnOutputFromNumber(29));		// eth.o29
eStopFanuc(
	elementId			:= 11,
	ModuleParent		:= ModuleHandler,
	eStopOperated		:= ReturnOutputFromNumber(30),		// eth.o30
	contactFailed		:= ReturnOutputFromNumber(31),		// eth.o31
	errorTestPulse		:= ReturnOutputFromNumber(32));		// eth.o32

holdToRunButton(
	elementId			:= 20,
	ModuleParent		:= ModuleHandler,
	switchEnabled		:= ReturnOutputFromNumber(33),		// eth.o33
	contactFailed		:= ReturnOutputFromNumber(34),		// eth.o34
	errorTestPulse		:= ReturnOutputFromNumber(35),		// eth.o35
	switchEnabledOut	=> xHoldToRunButton);
frontPanelModeSelector(
	elementId			:= 21,
	ModuleParent		:= ModuleHandler,
	switchEnabled		:= ReturnOutputFromNumber(36),		// eth.o36
	contactFailed		:= ReturnOutputFromNumber(37),		// eth.o37
	errorTestPulse		:= ReturnOutputFromNumber(38),		// eth.o38
	switchEnabledOut	=> xOperatorSwitch);
serviceModeSelector(
	elementId			:= 22,
	ModuleParent		:= ModuleHandler,
	switchEnabled		:= ReturnOutputFromNumber(39),		// eth.o39
	contactFailed		:= ReturnOutputFromNumber(40),		// eth.o40
	errorTestPulse		:= ReturnOutputFromNumber(41),		// eth.o41
	switchEnabledOut	=> xServiceSwitch);

eStopOkIMMOutput(
	elementId			:= 30,
	ModuleParent		:= ModuleHandler,
	feedbackLoopError	:= ReturnOutputFromNumber(42));		// eth.o42
eStopOkOutput(
	elementId			:= 31,
	ModuleParent		:= ModuleHandler,
	feedbackLoopError	:= ReturnOutputFromNumber(43));		// eth.o43
airvalveOutput(
	elementId			:= 32,
	ModuleParent		:= ModuleHandler,
	feedbackLoopError	:= ReturnOutputFromNumber(44));		// eth.o44
airvalveBFUOutput(
	elementId			:= 33,
	ModuleParent		:= ModuleHandler,
	feedbackLoopError	:= ReturnOutputFromNumber(46));		// eth.o46;
gatesOkOutput(
	elementId			:= 34,
	ModuleParent		:= ModuleHandler,
	feedbackLoopError	:= ReturnOutputFromNumber(48));		// eth.o48
gatesBFUOkOutput(
	elementId			:= 35,
	ModuleParent		:= ModuleHandler,
	feedbackLoopError	:= ReturnOutputFromNumber(49));		// eth.o49

safetyMat1(
	elementId			:= 40,
	ModuleParent		:= ModuleHandler,
	activated			:= ReturnOutputFromNumber(50),		// eth.o50
	readyForReset		:= ReturnOutputFromNumber(51),		// eth.o51
	error				:= ReturnOutputFromNumber(52));		// eth.o52
//safetyMat2(
//	elementId			:= 41,
//	ModuleParent		:= ModuleHandler,
//	activated			:= ReturnOutputFromNumber(53),		// eth.o53
//	readyForReset		:= ReturnOutputFromNumber(54),		// eth.o54
//	error				:= ReturnOutputFromNumber(55));		// eth.o55

gateSER(
	elementId			:= 50,
	ModuleParent		:= ModuleHandler,
	gateOpened			:= ReturnOutputFromNumber(56),		// eth.o56
	functionTest		:= ReturnOutputFromNumber(57),		// eth.o57
	contactFailed		:= ReturnOutputFromNumber(58),		// eth.o58
	errorTestPulse		:= ReturnOutputFromNumber(59),		// eth.o59
	gateOpenedOut		=> );
//gateZUR(
//	elementId			:= 51,
//	ModuleParent		:= ModuleHandler,
//	gateOpened			:= ,
//	functionTest		:= ReturnOutputFromNumber(59),		// eth.o59
//	contactFailed		:= ReturnOutputFromNumber(60),		// eth.o60
//	errorTestPulse		:= ReturnOutputFromNumber(61),		// eth.o61
//	gateOpenedOut		=> );
gateIMM(
	elementId			:= 52,
	ModuleParent		:= ModuleHandler,
	gateOpened			:= ,
	functionTest		:= ReturnOutputFromNumber(64),		// eth.o64
	contactFailed		:= ReturnOutputFromNumber(65),		// eth.o65
	errorTestPulse		:= ReturnOutputFromNumber(66),		// eth.o66
	gateOpenedOut		=> );
gateBFU(
	elementId			:= 53,
	ModuleParent		:= ModuleHandler,
	gateOpened			:= ReturnOutputFromNumber(67),		// eth.o67
	functionTest		:= ReturnOutputFromNumber(68),		// eth.o68
	contactFailed		:= ReturnOutputFromNumber(69),		// eth.o69
	errorTestPulse		:= ReturnOutputFromNumber(70),		// eth.o70
	gateOpenedOut		=> );
gateSensorDrawerM1(
	elementId			:= 54,
	ModuleParent		:= ModuleHandler,
	gateOpened			:= ReturnOutputFromNumber(71),		// eth.o71
	functionTest		:= ReturnOutputFromNumber(72),		// eth.o72
	contactFailed		:= ReturnOutputFromNumber(73),		// eth.o73
	errorTestPulse		:= ReturnOutputFromNumber(74),		// eth.o74
	gateOpenedOut		=> );
gateDrawerHoodM1(
	elementId			:= 55,
	ModuleParent		:= ModuleHandler,
	gateOpened			:= ReturnOutputFromNumber(75),		// eth.o75
	functionTest		:= ReturnOutputFromNumber(76),		// eth.o76
	contactFailed		:= ReturnOutputFromNumber(77),		// eth.o77
	errorTestPulse		:= ReturnOutputFromNumber(78),		// eth.o78
	gateOpenedOut		=> );
gateDrawerM1(
	elementId			:= 56,
	ModuleParent		:= ModuleHandler,
	gateOpened			:= ReturnOutputFromNumber(79),		// eth.o79
	functionTest		:= ReturnOutputFromNumber(80),		// eth.o80
	contactFailed		:= ReturnOutputFromNumber(81),		// eth.o81
	errorTestPulse		:= ReturnOutputFromNumber(82),		// eth.o82
	gateOpenedOut		=> );
//gateSensorDrawerM2(
//	elementId			:= 57,
//	ModuleParent		:= ModuleHandler,
//	gateOpened			:= ,
//	functionTest		:= ReturnOutputFromNumber(79),		// eth.o79
//	contactFailed		:= ReturnOutputFromNumber(80),		// eth.o80
//	errorTestPulse		:= ReturnOutputFromNumber(81),		// eth.o81
//	gateOpenedOut		=> );
//gateDrawerHoodM2(
//	elementId			:= 58,
//	ModuleParent		:= ModuleHandler,
//	gateOpened			:= ReturnOutputFromNumber(82),		// eth.o82
//	functionTest		:= ReturnOutputFromNumber(83),		// eth.o83
//	contactFailed		:= ReturnOutputFromNumber(84),		// eth.o84
//	errorTestPulse		:= ReturnOutputFromNumber(85),		// eth.o85
//	gateOpenedOut		=> );
//gateDrawerM2(
//	elementId			:= 59,
//	ModuleParent		:= ModuleHandler,
//	gateOpened			:= ,
//	functionTest		:= ReturnOutputFromNumber(86),		// eth.o86
//	contactFailed		:= ReturnOutputFromNumber(87),		// eth.o87
//	errorTestPulse		:= ReturnOutputFromNumber(88),		// eth.o88
//	gateOpenedOut		=> );

hmiKeySwitch(
	elementId			:= 60,
	ModuleParent		:= ModuleHandler,
	switchEnabled		:= ReturnOutputFromNumber(90),		// eth.o90
	contactFailed		:= ReturnOutputFromNumber(91),		// eth.o91
	errorTestPulse		:= ReturnOutputFromNumber(92),		// eth.o92
	switchEnabledOut	=> xHmiSwitch);


GeneralFaultAlarm(
	moduleHandler	:= ModuleHandler,
	textRefId		:= Pnoz_Errors,
	errorId			:= 9,
	alarmCondition	:= xLedFault,
	alarmDelay		:= 5.0,
	severity		:= enumErrorSeverity.Fault,
	reaction		:= enumErrorReaction.No_reaction);

GeneralIFaultAlarm(
	moduleHandler	:= ModuleHandler,
	textRefId		:= Pnoz_Errors,
	errorId			:= 10,
	alarmCondition	:= xLedIFault,
	alarmDelay		:= 5.0,
	severity		:= enumErrorSeverity.Fault,
	reaction		:= enumErrorReaction.No_reaction);

GeneralOFaultAlarm(
	moduleHandler	:= ModuleHandler,
	textRefId		:= Pnoz_Errors,
	errorId			:= 11,
	alarmCondition	:= xLedOFault,
	alarmDelay		:= 5.0,
	severity		:= enumErrorSeverity.Fault,
	reaction		:= enumErrorReaction.No_reaction);

GeneralDiagAlarm(
	moduleHandler	:= ModuleHandler,
	textRefId		:= Pnoz_Errors,
	errorId			:= 12,
	alarmCondition	:= xLedDiag,
	alarmDelay		:= 5.0,
	severity		:= enumErrorSeverity.Warning_Lock,
	reaction		:= enumErrorReaction.No_reaction);

GeneralRunAlarm(
	moduleHandler	:= ModuleHandler,
	textRefId		:= Pnoz_Errors,
	errorId			:= 13,
	alarmCondition	:= NOT xLedRun,
	alarmDelay		:= 5.0,
	severity		:= enumErrorSeverity.Fault,
	reaction		:= enumErrorReaction.No_reaction);
END_METHOD

METHOD PRIVATE Initialize : BOOL
VAR_INST
	{attribute 'init_on_onlchange'}
	initialized	: BOOL;
END_VAR
IF initialized THEN
	Initialize		:= TRUE;
	RETURN;
END_IF

IF ipAddress = '' THEN
	RETURN;
END_IF

ipAddressStruct.sAddr	:= ipAddress;

{IF defined (IsSimulationMode)}
	RETURN;
{END_IF}

tTaskInterval			:= TaskGetInterval();

IF tTaskInterval = T#0MS THEN
	RETURN;
END_IF

T_ToggleWriter.IN		:= TRUE;

initialized				:= TRUE;
Initialize				:= TRUE;
END_METHOD

METHOD PRIVATE ReturnOutputFromNumber : BOOL
VAR_INPUT
	outputNumber	: USINT(0..127);
END_VAR
ReturnOutputFromNumber := BitLogic.Extract(dwSafetyPLCStatus[outputNumber / 32], outputNumber MOD 32);
END_METHOD

METHOD ValidateMessage : BOOL
// Check if the read message is valid
byChecksumReader		:= 0;
FOR i := 4 TO 39 DO
	byChecksumReader	:= byChecksumReader + abyReadBuffer[i];
END_FOR
byChecksumReader		:= 0 - byChecksumReader;

IF  abyReadBuffer[0]	= abyWriteBuffer[0]
AND abyReadBuffer[1]	= abyWriteBuffer[1]
AND abyReadBuffer[2]	= abyWriteBuffer[2]
AND abyReadBuffer[3]	= abyWriteBuffer[3]
AND abyReadBuffer[4]	= abyWriteBuffer[4] + 16#80 // Request number + 0x80 (Bit 7 set)
AND abyReadBuffer[5]	= abyWriteBuffer[5]
//AND abyReadBuffer[6]	= //Reserved
AND abyReadBuffer[7]	= abyWriteBuffer[7]
//AND abyReadBuffer[40]	=		//Reserved
AND abyReadBuffer[41]	= byChecksumReader
AND abyReadBuffer[42]	= 16#10
THEN
	ValidateMessage		:= TRUE;
END_IF
END_METHOD

ACTION CreateTelegram
FOR i := 0 TO TO_INT(UPPER_BOUND(abyWriteBuffer, 1)) DO
	abyWriteBuffer[i] := 0;
END_FOR

//Header:
	abyWriteBuffer[0]	:= 16#05;						// Byte 0: Always 0x05
	abyWriteBuffer[1]	:= 16#15;						// Byte 1: Always 0x15
	abyWriteBuffer[2]	:= 16#00;						// Byte 2: Always 0x00
	abyWriteBuffer[3]	:= 16#26;						// Byte 3: Always 0x26
	abyWriteBuffer[4]	:= 16#5C;						// Byte 4: Request number 0x5C (Sending virtual inputs and requesting the virtual output data from PNOZmulti 2)
	abyWriteBuffer[5]	:= 16#04;						// Byte 5: Control Byte	-> Watchdog 1 Second
	abyWriteBuffer[6]	:= 16#00;						// Byte 6: Always 0x00
	abyWriteBuffer[7]	:= 16#00;						// Byte 7: Always 0x00

//Input Byte 0-15
	abyWriteBuffer[8].0	:= xButtonAcknSafetyGates;					// i0
	abyWriteBuffer[8].1	:= ButtonResetSafetyMat.buttonInput;		// i1
//	abyWriteBuffer[8].2	:= ;							// i2
//	abyWriteBuffer[8].3	:= ;							// i3
//	abyWriteBuffer[8].4	:= ;							// i4
//	abyWriteBuffer[8].5	:= ;							// i5
//	abyWriteBuffer[8].6	:= ;							// i6
//	abyWriteBuffer[8].7	:= ;							// i7
//	abyWriteBuffer[9]	:= ;							// i8-i15
//	abyWriteBuffer[10]	:= ;							// i16-i23
//	abyWriteBuffer[11]	:= ;							// i24-i31
//	abyWriteBuffer[12]	:= ;							// i32-i39
//	abyWriteBuffer[13]	:= ;							// i40-i47
//	abyWriteBuffer[14]	:= ;							// i48-i55
//	abyWriteBuffer[15]	:= ;							// i56-i63
//	abyWriteBuffer[16]	:= ;							// i64-i71
//	abyWriteBuffer[17]	:= ;							// i72-i79
//	abyWriteBuffer[18]	:= ;							// i80-i87
//	abyWriteBuffer[19]	:= ;							// i88-i95
//	abyWriteBuffer[20]	:= ;							// i96-i103
//	abyWriteBuffer[21]	:= ;							// i104-i111
//	abyWriteBuffer[22]	:= ;							// i112-i119
//	abyWriteBuffer[23]	:= ;							// i120-i127

//Blink buttons to be sure there is a rising edge due to fluctuating cycle time on PnozMulti2
	BlinkWriter(ENABLE := TRUE, TIMELOW := tTaskInterval * 4, TIMEHIGH := tTaskInterval * 2);
	IF BlinkWriter.OUT THEN
		abyWriteBuffer[8] := 0;
	END_IF

//Input Byte 16-18
	abyWriteBuffer[24]	:= 16#00;						// Always 0x00
	abyWriteBuffer[25]	:= 16#00;						// Table number
	abyWriteBuffer[26]	:= 16#00;						// Segment number

//Input Byte 19-31 not used

//Footer:
	byChecksumWriter	:= 0;
	FOR i := 4 TO 39 DO
		byChecksumWriter	:= byChecksumWriter + abyWriteBuffer[i];
	END_FOR
	byChecksumWriter	:= 0 - byChecksumWriter;

	abyWriteBuffer[40]	:= 16#00;
	abyWriteBuffer[41]	:= byChecksumWriter;			 // BCC
	abyWriteBuffer[42]	:= 16#10;
END_ACTION

ACTION FunctionBlocks
(* Implements a TCP Client. To connect to a TCP Server at the endpoint defined with ipAddr and uiPort the input xEnable
should set to TRUE. While setup the connection xBusy is TRUE but xActive is FALSE. After the connection is established
xActive and xBusy is TRUE and the hConnection output is valid. After closing the connection from the server side xActive
becomes FALSE hConnection become CAA_gc_hINVALID and xDone becomes TRUE. *)
TCPClient(
	xEnable		:= ,						// TRUE: action running FALSE: action stopped, outputs xDone, xBusy, xError, iError are reset
	ipAddr		:= ipAddressStruct,			// Ip address of server to establish connection
	uiPort		:= uiCommunicationPort,		// Port number of TCP socket to open
	udiTimeOut	:= udiTimeout,				// Defines the time (µs) after which the connection setup aborts with an error message.
	xDone		=> ,						// Action successfully completed
	xBusy		=> ,						// Function block active
	eError		=> ,						// TRUE: error occurred, function block aborts action FALSE: no error
	eError		=> eErrorTCPClient,			// Error id
	xActive		=> ,						// TRUE: Handle valid; FALSE: Handle invalid
	hConnection	=> );						// Handle of the connection

TCPReader(
	xEnable		:= TCPClient.xActive AND xEnableReader,
	hConnection	:= TCPClient.hConnection,	// Handle of the connection
	pData		:= ADR(abyReadBuffer),		// Target address for the first byte to be read; can be retrieved via operator ADR
	szSize		:= SIZEOF(abyReadBuffer),	// Maximum number of bytes to be read; can be retrieved via operator SIZEOF
	xDone		=> ,						// Action successfully completed
	xBusy		=> ,						// Function block active
	xError		=> ,						// TRUE: error occurred, function block aborts action FALSE: no error
	eError		=> eErrorTCPReader,			// Error id
	xReady		=> ,						// TRUE: Data received; FALSE: No data received
	szCount		=> );						// Size of the received data

TCPWriter(
	xExecute	:= TCPClient.xActive AND xEnableWriter,
	hConnection	:= TCPClient.hConnection,	// Handle of the connection
	udiTimeOut	:= udiTimeout,				// This input defines the time (µs) after which an FB (e.g. requiring an external acknowledgement) aborts operation due to a timeout with error message.
	pData		:= ADR(abyWriteBuffer),		// The address from where the data can be fetched; can be retrieved with the help of operator ADR
	szSize		:= SIZEOF(abyWriteBuffer),	// Number of bytes to be written; can be retrieved via operator SIZEOF
	xDone		=> ,						// Action successfully completed
	xBusy		=> ,						// Function block active
	xError		=> ,						// TRUE: error occurred, function block aborts action FALSE: no error
	eError		=> eErrorWriter);			// Error id

// Read alarm severity of Safety controller (sub)modules
ReadActualSeverity(
	xEnable					:= TRUE,
	ModuleHandler			:= ModuleHandler,
	xDisableSubmodules		:= FALSE,
	xBusy					=> ,
	xError					=> ,
	eErrorID				=> ,
	eSeverity				=> ,
	eReaction				=> ,
	sAffectedModuleName		=> ,
	AffectedModuleHandler	=> ,
	xErrorActive			=> errorActive,
	xWarningActive			=> warningActive,
	SeverityStatus			=> ,
	ReactionStatus			=> );
END_ACTION

ACTION MapTheOutputs
dwSafetyPLCStatus[0] := MEM.PackBytesToDword(
							byLLByte	:= abyReadBuffer[ 8],		// eth.o0 - 7
							byLHByte	:= abyReadBuffer[ 9],		// eth.o8 - 15
							byHLByte	:= abyReadBuffer[10],		// eth.o16 - 23
							byHHByte	:= abyReadBuffer[11]);		// eth.o24 - 31
dwSafetyPLCStatus[1] := MEM.PackBytesToDword(
							byLLByte	:= abyReadBuffer[12],		// eth.o32 - 39
							byLHByte	:= abyReadBuffer[13],		// eth.o40 - 47
							byHLByte	:= abyReadBuffer[14],		// eth.o48 - 55
							byHHByte	:= abyReadBuffer[15]);		// eth.o56 - 63
dwSafetyPLCStatus[2] := MEM.PackBytesToDword(
							byLLByte	:= abyReadBuffer[16],		// eth.o64 - 71
							byLHByte	:= abyReadBuffer[17],		// eth.o72 - 79
							byHLByte	:= abyReadBuffer[18],		// eth.o80 - 87
							byHHByte	:= abyReadBuffer[19]);		// eth.o88 - 95
dwSafetyPLCStatus[3] := MEM.PackBytesToDword(
							byLLByte	:= abyReadBuffer[20],		// eth.o96 - 103
							byLHByte	:= abyReadBuffer[21],		// eth.o104 - 111
							byHLByte	:= abyReadBuffer[22],		// eth.o112 - 119
							byHHByte	:= abyReadBuffer[23]);		// eth.o120 - 127

// LEDs on Pnoz m B0
xLedOFault				:= abyReadBuffer[24].0;
xLedIFault				:= abyReadBuffer[24].1;
xLedFault				:= abyReadBuffer[24].2;
xLedDiag				:= abyReadBuffer[24].3;
xLedRun					:= abyReadBuffer[24].4;

xEnableAir				:= ReturnOutputFromNumber(45);	// eth.o45
xEnableAirBFU			:= ReturnOutputFromNumber(47);	// eth.o47
xEnableAirDrawer[1]		:= ReturnOutputFromNumber(83);	// eth.o83
//xEnableAirDrawer[2]		:= ReturnOutputFromNumber(96);	// eth.o96
END_ACTION
