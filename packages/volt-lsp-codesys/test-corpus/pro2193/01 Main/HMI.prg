// By default every variable here has read/write access from the HMI
{attribute 'symbol' := 'readwrite'}
PROGRAM HMI
VAR_INPUT
	xMuteHorn					: BOOL;
	OperationMode				: SER_OperationModeType;	// Unit mode change request from HMI
	FooterName					: enumFooterNames;			// Select active footer type
END_VAR
VAR_OUTPUT
	servoJogMode				: BOOL;						// False: Move to position; True: Servo jogging to sw limit.
	servoJogSpeed				: BOOL;						// False: Slow speed; True: High speed
	UUIDActiveScreen			: STRING(40);
	SemiAutoMode				: enumSemiAutoModeType;		// Choose mode when SER runs in operation mode: Semi-auto
	testMachineWithoutConveyors	: BOOL;						// Disable sensors to testrun the machine without conveyors
	currentUser					: STRING(80);				// Current user
END_VAR
VAR
	ButtonEnableDrives			: PushButtonLedWithHmiFB;
	ButtonEnableMainvalve		: PushButtonLedWithHmiFB;
	ButtonEnableVacuumPumps		: PushButtonLedWithHmiFB;
	ButtonEnableSticker			: PushButtonLedWithHmiFB;
	ButtonEnableCamera			: PushButtonLedWithHmiFB;

	{attribute 'symbol' := 'read'}	SER_State					: PACK_ML.State;
	{attribute 'symbol' := 'read'}	heartbeatToHMI				: UDINT;
	{attribute 'symbol' := 'read'}	ProjectInfo					: ProjectInfoType;
	{attribute 'symbol' := 'read'}	textMessage					: STRING(80);		// Show a custom text message as a popup on the HMI panel.
	{attribute 'symbol' := 'read'}	ipAddressController			: STRING(20);
	{attribute 'symbol' := 'read'}	ipAddressPilz				: STRING(20);
	{attribute 'symbol' := 'read'}	robotSerial					: STRING(7);		// The Serial number of the robot.

	ipAddressEdgePC				: STRING(20)	:= '10.195.0.8';
	communicationPortEdgePC		: UINT			:= 48000;
	heartbeatToPLC				: UDINT;
	logMessageParameterChange	: STRING(255);
	
	autoLogoffMinutes			: UINT; // Minutes of inactivity after which the current user is being logged off.

	{attribute 'init_on_onlchange'}		// Reset initialized with every online change.
	{attribute 'symbol' := 'none'}	initialized					: BOOL;
	{attribute 'symbol' := 'none'}	startGetControllerIp		: BOOL;
	{attribute 'symbol' := 'none'}	startGetRobotSerial			: BOOL;
	{attribute 'symbol' := 'none'}	heartbeatMissingAlarm		: SetErrorFB();
	{attribute 'symbol' := 'none'}	serialNumberRead			: RobotSerialNumberFB;
END_VAR
VAR CONSTANT
	{attribute 'symbol' := 'none'}	PilzAddToLastOctetOfIp		: BYTE := 2;		// IP address of Pilz PnozMulti will be 2 higher than controller IP. So controller is: 10.100.xxx.10, then Pilz is: : 10.100.xxx.12
END_VAR

initialized := initialized OR_ELSE Initialize();

MonitorHeartbeat();

Cyclic();


// Get robot serial number from SD card
serialNumberRead(
	execute				:= startGetRobotSerial,
	controller			:= enumControllerType.C5xxSeries,
	busy				=> ,
	done				=> ,
	errorActive			=> ,
	errorDescription	=> ,
	robotSerial			=> );

IF serialNumberRead.done THEN
	robotSerial				:= serialNumberRead.robotSerial;
	startGetRobotSerial		:= FALSE;
END_IF

END_PROGRAM

// Get the final octet (digit) of an IP address, then increase this digit with another number
METHOD PRIVATE ChangeLastOctetOfIp : STRING(20)
VAR_INPUT
	ipAddress		: STRING(20);
	addTolastOctet	: BYTE;		// number to add to last octet
END_VAR
VAR
	index			: INT;
	lastOctet		: BYTE;
END_VAR
index	:= LEN(ipAddress) - 1;	// Get index of last character in string

// Get last index of '.' (ascii: 46)
WHILE ipAddress[index] <> enumASCII.DOT AND index > 0 DO
	index := index - 1;
END_WHILE

IF index > 0 THEN
	lastOctet			:= TO_BYTE(MID(ipAddress, LEN(ipAddress) - 1 - index, index + 2)) + addTolastOctet;
	ChangeLastOctetOfIp := CONCAT(LEFT(ipAddress, index + 1), TO_STRING(lastOctet));
END_IF
END_METHOD

METHOD PRIVATE Cyclic
VAR_INST
	getControllerIp				: GetIPAddressFB;
	UUIDActiveScreenHistory		: ARRAY[0..4] OF STRING(80);
END_VAR
VAR
	i							: USINT;
END_VAR
ButtonEnableDrives();
ButtonEnableMainvalve();
ButtonEnableVacuumPumps();
ButtonEnableSticker();
ButtonEnableCamera();

IF SER.xServoDrivesEnabled THEN
	ButtonEnableDrives.SetColors(enumColorList.Lime);
	ButtonEnableDrives.Solid();
ELSIF GlobalVars.EnableServoDrives THEN
	ButtonEnableDrives.SetColors(enumColorList.Blue);
	ButtonEnableDrives.Solid();
ELSE
	ButtonEnableDrives.Off();
END_IF

IF SER.DigIn.xAirPressureOK THEN
	ButtonEnableMainvalve.SetColors(enumColorList.Lime);
	ButtonEnableMainvalve.Solid();
ELSIF GlobalVars.EnableMainvalve THEN
	ButtonEnableMainvalve.SetColors(enumColorList.Blue);
	ButtonEnableMainvalve.Solid();
ELSE
	ButtonEnableMainvalve.Off();
END_IF

IF  SER.VacuumPumps.xVacuumpumpRunning
AND SER.VacuumPumps.xHighVacuumtankFull
AND (SER.VacuumPumps.xLowVacuumtankFull OR SER.VacuumPumps.xOptionDisableVacuumPump2)
THEN
	ButtonEnableVacuumPumps.SetColors(enumColorList.Lime);
	ButtonEnableVacuumPumps.Solid();
ELSIF SER.VacuumPumps.xVacuumpumpRunning THEN
	ButtonEnableVacuumPumps.SetColors(enumColorList.Blue);
	ButtonEnableVacuumPumps.Solid();
ELSE
	ButtonEnableVacuumPumps.SetColors(enumColorList.Gray);
	ButtonEnableVacuumPumps.Off();
END_IF

// Switch IML on/off when software button is pushed
IF ButtonEnableSticker.ButtonPushed AND NOT SER.InAutomaticOperation THEN
	PersistentVars.RecipeVars.EnableSticker	:= NOT PersistentVars.RecipeVars.EnableSticker;
END_IF

ButtonEnableSticker.SetColors(enumColorList.Lime);
IF PersistentVars.RecipeVars.EnableSticker THEN
	ButtonEnableSticker.Solid();
ELSE
	ButtonEnableSticker.Off();
END_IF

// Switch vision system on / off
IF ButtonEnableCamera.ButtonPushed AND NOT SER.InAutomaticOperation THEN			// by customer request only onable/disable camera when machine is off
	PersistentVars.RecipeVars.EnableVision	:= NOT PersistentVars.RecipeVars.EnableVision;
END_IF
ButtonEnableCamera.SetColors(colorOn := enumColorList.Lime);
IF PersistentVars.RecipeVars.EnableVision THEN
	ButtonEnableCamera.Solid();
ELSE
	ButtonEnableCamera.Off();
END_IF


SER_State			:= SER.ActState;


//Get ip addresses of the controller and the Pilz PnozMulti
IF startGetControllerIp THEN
	getControllerIp();
	IF getControllerIp.resultValid THEN
		ipAddressController		:= getControllerIp.currentIp;
		ipAddressPilz			:= ChangeLastOctetOfIp(ipAddressController, PilzAddToLastOctetOfIp);
		startGetControllerIp	:= FALSE;
	END_IF
END_IF


// Debugging: keep a short history of uuids
IF UUIDActiveScreen <> UUIDActiveScreenHistory[0] THEN
	FOR i := 4 TO 1 BY -1 DO
		UUIDActiveScreenHistory[i] := UUIDActiveScreenHistory[i-1];
	END_FOR
	UUIDActiveScreenHistory[0] := UUIDActiveScreen;
END_IF
END_METHOD

// Initializes the FB in the first cycle
METHOD PRIVATE Initialize : BOOL
ProjectInfo				:= GetProjectInfo();
startGetControllerIp	:= TRUE;
startGetRobotSerial		:= TRUE;
Initialize				:= TRUE;
END_METHOD

METHOD PRIVATE MonitorHeartbeat
VAR_INST
	heartbeatTimer				: BTON;
	previousHeartbeat			: UDINT;
END_VAR
// Send a heartbeat to the HMI every 0,5 sec. (currently not in use)
IF heartbeatTimer.Set(In := TRUE, Pt := 0.5) THEN
	heartbeatTimer.Reset();
	Increment.AnyInt(heartbeatToHMI);
END_IF

// Monitor heartbeat signal from HMI
heartbeatMissingAlarm(
	moduleHandler	:= ErrorHandling.ModuleHandler,
	textRefId		:= General_Unit_Errors,
	errorId			:= 4,		// Missing heartbeat from HMI
	alarmCondition	:= FALSE, //heartbeatToPLC = previousHeartbeat,  // Panel cannot write variables in JS loops..!
	alarmDelay		:= 5.0,
	severity		:= enumErrorSeverity.Warning,
	reaction		:= enumErrorReaction.No_reaction,
	active			=> );

previousHeartbeat := heartbeatToPLC;

// In case of a HMI crash, detach the F1 and F2 buttons from all observers by invalidating the UUID
IF heartbeatMissingAlarm.active THEN
	UUIDActiveScreen := '';
END_IF
END_METHOD
