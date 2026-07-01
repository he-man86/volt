{attribute 'symbol' := 'none'}
PROGRAM BoxOutfeeds
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF BoxOutfeed_DefaultFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars_BFU.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= 0,
			resetCondition2	:= 0,
		)
	];

END_VAR
VAR
	i							: USINT;
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..BoxOutfeeds.usiNumberOfUnits] OF BoxOutfeed_Default_DataType;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		Data						:= Data[i]);
END_FOR

END_PROGRAM
