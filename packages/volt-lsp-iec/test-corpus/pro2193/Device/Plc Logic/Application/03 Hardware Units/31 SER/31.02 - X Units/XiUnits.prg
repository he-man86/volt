{attribute 'symbol' := 'none'}
PROGRAM XiUnits
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF XiUnitFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= InjectionMouldingMachine.Unit,
			resetCondition2	:= 0,
		)
	];

END_VAR
VAR
	i							: USINT;
	selectedInstance			: USINT(1..usiNumberOfUnits);	// Index of instance shown in CODESYS Visu
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..XiUnits.usiNumberOfUnits] OF XiUnit_Default_Data;
	{attribute 'symbol' := 'readwrite'}	DataProject					: ARRAY[1..XiUnits.usiNumberOfUnits] OF XiUnit_Data;
	{attribute 'symbol' := 'readwrite'}	DataBrink					: ARRAY[1..XiUnits.usiNumberOfUnits] OF DataBrinkType;
	coveredDistance				: ARRAY[1..XiUnits.usiNumberOfUnits] OF UDINT;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
	MaxVacuums					: USINT	:= 12;
	MaxChargers					: USINT	:= 2;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		xEnableServoDrive	:= GlobalVars.EnableServoDrives,
		xQuickStop			:= NOT SER.DigIn.quickStopOk,
		axisRef				:= XiDrive,
		Data				:= Data[i],
		DataProject			:= DataProject[i],
		dataBrink			:= DataBrink[i],
		coveredDistance		:= coveredDistance[i],
	);
END_FOR

END_PROGRAM
