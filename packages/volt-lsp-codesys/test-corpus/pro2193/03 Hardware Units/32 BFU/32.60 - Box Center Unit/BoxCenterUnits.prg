{attribute 'symbol' := 'none'}
PROGRAM BoxCenterUnits
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF BoxCenterUnit_WithPneumaticFB
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
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..BoxCenterUnits.usiNumberOfUnits] OF BoxCenterUnit_WithPneumatic_DataType;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		Data						:= Data[i],
		fanucAboveBoxArea			:= Fanucs.Unit[1].FanucAboveBoxArea);
END_FOR

END_PROGRAM
