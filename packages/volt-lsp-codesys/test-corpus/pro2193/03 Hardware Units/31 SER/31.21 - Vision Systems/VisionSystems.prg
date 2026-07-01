{attribute 'symbol' := 'none'}
PROGRAM VisionSystems
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF VisionSystem_MeviscoFB
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
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..VisionSystems.usiNumberOfUnits] OF VisionSystem_Base_Data;
	{attribute 'symbol' := 'readwrite'}	DataProject					: ARRAY[1..VisionSystems.usiNumberOfUnits] OF VisionSystem_Mevisco_Data;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		Data				:= Data[i],
		DataMevisco			:= DataProject[i]);
END_FOR

// By customer request. They set bypassMode on Mevisco in case they produce without cameras
Data[1].overrideRejectStatus		:= FALSE;
Data[1].overrideRunmodeReject		:= FALSE;

END_PROGRAM
