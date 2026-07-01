{attribute 'symbol' := 'none'}
PROGRAM Conveyors
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF Conveyor_ServoFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= ZUnits.Unit[1],
			resetCondition2	:= 0,
		)
	];
	{attribute 'symbol' := 'readwrite'}	UnitReject					: ARRAY[1..usiNumberOfUnits] OF Conveyor_RejectFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= Unit[1],
			resetCondition2	:= 0,
		)
	];

END_VAR
VAR
	i							: USINT;
	selectedInstance			: USINT(1..usiNumberOfUnits);	// Index of instance shown in CODESYS Visu
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..Conveyors.usiNumberOfUnits] OF Conveyor_Servo_Data;
	{attribute 'symbol' := 'readwrite'}	DataBrink					: ARRAY[1..Conveyors.usiNumberOfUnits] OF DataBrinkType;
	{attribute 'symbol' := 'readwrite'}	DataReject					: ARRAY[1..Conveyors.usiNumberOfUnits] OF Conveyor_Reject_Data;
	coveredDistance				: ARRAY[1..Conveyors.usiNumberOfUnits] OF UDINT;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
	iNumberOfAlternatingStacks	: INT	:= 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		xEnableServoDrive	:= GlobalVars.EnableServoDrives,
		xQuickStop			:= NOT SER.DigIn.quickStopOk,
		axisRef				:= ConveyorDrive,
		Data				:= Data[i],
		dataBrink			:= DataBrink[i],
		coveredDistance		:= coveredDistance[i],
	);

	UnitReject[i](
		Data				:= DataReject[i]);
END_FOR

END_PROGRAM
