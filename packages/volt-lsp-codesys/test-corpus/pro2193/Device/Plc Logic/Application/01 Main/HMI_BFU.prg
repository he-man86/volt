// By default every variable here has read/write access from the HMI
{attribute 'symbol' := 'readwrite'}
// Handle the BFU specific buttons
PROGRAM HMI_BFU
VAR_INPUT
	OperationMode				: SER_OperationModeType;	// Unit mode change request from HMI
END_VAR
VAR_OUTPUT
	UUIDActiveScreen			: STRING(40);
END_VAR
VAR
	ButtonEnableDrives			: PushButtonLedWithHmiFB;
	ButtonEnableMainvalve		: PushButtonLedWithHmiFB;
	ButtonEnableVacuumPumps		: PushButtonLedWithHmiFB;

	{attribute 'symbol' := 'read'}	BFU_State					: PACK_ML.State;
END_VAR

Initialize();

ButtonEnableDrives();
ButtonEnableMainvalve();
ButtonEnableVacuumPumps();

IF BFU.xServoDrivesEnabled THEN
	ButtonEnableDrives.SetColors(enumColorList.Lime);
	ButtonEnableDrives.Solid();
ELSIF GlobalVars_BFU.EnableServoDrives THEN
	ButtonEnableDrives.SetColors(enumColorList.Blue);
	ButtonEnableDrives.Solid();
ELSE
	ButtonEnableDrives.Off();
END_IF

IF BFU.DigIn.xAirPressureOK THEN
	ButtonEnableMainvalve.SetColors(enumColorList.Lime);
	ButtonEnableMainvalve.Solid();
ELSIF GlobalVars_BFU.EnableMainvalve THEN
	ButtonEnableMainvalve.SetColors(enumColorList.Blue);
	ButtonEnableMainvalve.Solid();
ELSE
	ButtonEnableMainvalve.Off();
END_IF

BFU_State			:= BFU.ActState;

END_PROGRAM

METHOD PRIVATE Initialize
VAR_INPUT
END_VAR
VAR_INST
	xInitialized	: BOOL;
END_VAR
IF xInitialized THEN
	RETURN;
END_IF

xInitialized := TRUE;
END_METHOD
