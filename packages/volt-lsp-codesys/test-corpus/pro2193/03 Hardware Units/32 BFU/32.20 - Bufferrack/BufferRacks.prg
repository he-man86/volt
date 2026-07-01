PROGRAM BufferRacks
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF BufferRack_DefaultFB
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
	{attribute 'symbol' := 'readwrite'}	Data					: ARRAY[1..BufferRacks.usiNumberOfUnits] OF BufferRack_Data;
										BufferStackStatus		: ARRAY[1..BufferRacks.usiNumberOfUnits] OF StackStatusType;
										BufferStackIndex		: USINT;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		fanucInBufferArea			:= Fanucs.Unit[1].FanucInBufferArea,
		Data						:= Data[i],
		BufferStackStatus			:= BufferStackStatus[i],
		BufferStackIndex			:= BufferStackIndex);
END_FOR

END_PROGRAM
