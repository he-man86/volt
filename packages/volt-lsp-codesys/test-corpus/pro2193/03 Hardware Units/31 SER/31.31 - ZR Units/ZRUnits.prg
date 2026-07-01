{attribute 'symbol' := 'none'}
PROGRAM ZRUnits
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF ZRUnit_DefaultFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= ZUnits.Unit[1],
			resetCondition2	:= 0,
		)
	];

END_VAR
VAR
	i							: USINT;
	selectedInstance			: USINT(1..usiNumberOfUnits);	// Index of instance shown in CODESYS Visu
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..ZRUnits.usiNumberOfUnits] OF ZRUnit_Default_Data;
	{attribute 'symbol' := 'readwrite'}	DataBrink					: ARRAY[1..ZRUnits.usiNumberOfUnits] OF DataBrinkType;
	coveredDistance				: ARRAY[1..ZRUnits.usiNumberOfUnits] OF UDINT;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		xEnableServoDrive	:= GlobalVars.EnableServoDrives,
		xQuickStop			:= NOT SER.DigIn.quickStopOk,
		axisRef				:= ZRDrive,
		Data				:= Data[i],
		dataBrink			:= DataBrink[i],
		coveredDistance		:= coveredDistance[i],
	);
END_FOR

END_PROGRAM
