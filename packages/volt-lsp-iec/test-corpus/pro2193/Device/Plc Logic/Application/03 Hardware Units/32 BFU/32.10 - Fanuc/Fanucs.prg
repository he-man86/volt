{attribute 'symbol' := 'none'}
PROGRAM Fanucs
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF FanucUnitFB
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
	selectedStackPosition		: UINT(1..GVL_Constants_BFU.MaxNumberOfStacksInBox);	// Index of instance shown in CODESYS Visu
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data					: ARRAY[1..Fanucs.usiNumberOfUnits] OF FanucUnitBase_Data;
	{attribute 'symbol' := 'readwrite'}	DataProject				: ARRAY[1..Fanucs.usiNumberOfUnits] OF FanucUnit_Data;
										GripperStatus			: ARRAY[1..Fanucs.usiNumberOfUnits] OF StackStatusType;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		Data						:= Data[i],
		DataProject					:= DataProject[i],
		GripperStatus				:= GripperStatus[i],
		boxFillAreaIsClear			:= BoxCenterUnits.Unit[1].BoxAreaFreeForFanuc,
		conveyorStandstill			:= Conveyors.Unit[1].Standstill,
	);

	Unit[i].ExternalManualControlEnabled := BFU.ManualControlEnabled;
END_FOR

END_PROGRAM
