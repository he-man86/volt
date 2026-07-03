{attribute 'symbol' := 'none'}
PROGRAM RejectStations
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF RejectStation_WithBlowOffFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= 0,
			resetCondition2	:= 0,
		)
	];

END_VAR
VAR
	i							: USINT;
	selectedInstance			: USINT(1..usiNumberOfUnits);	// Index of instance shown in CODESYS Visu
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data					: ARRAY[1..RejectStations.usiNumberOfUnits] OF RejectStation_Base_Data;
	{attribute 'symbol' := 'readwrite'}	DataProject				: ARRAY[1..RejectStations.usiNumberOfUnits] OF RejectStation_WithBlowOff_Data;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		Data						:= Data[i],
		DataWithBlowOff				:= DataProject[i]);
END_FOR

END_PROGRAM
