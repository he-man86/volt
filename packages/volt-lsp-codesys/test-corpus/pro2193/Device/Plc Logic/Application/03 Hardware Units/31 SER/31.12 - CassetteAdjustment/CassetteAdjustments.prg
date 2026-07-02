{attribute 'symbol' := 'none'}
PROGRAM CassetteAdjustments
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF CassetteAdjustmentFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
		)
	];
END_VAR
VAR
	i							: USINT;
	selectedInstance			: USINT(1..usiNumberOfUnits);	// Index of instance shown in CODESYS Visu
END_VAR
VAR RETAIN PERSISTENT
	Data						: ARRAY[1..CassetteAdjustments.usiNumberOfUnits] OF ARRAY[enumDrawer.Upper..enumDrawer.Lower, 1..GVL_Constants_Magazine.MaxCassettes]		OF CassettePosition;
	SwitchCountEnable			: ARRAY[1..CassetteAdjustments.usiNumberOfUnits] OF ARRAY[enumDrawer.Upper..enumDrawer.Lower, 1..GVL_Constants_Magazine.MaxEnableValves]	OF UDINT;
	SwitchCountAdjust			: ARRAY[1..CassetteAdjustments.usiNumberOfUnits] OF ARRAY[enumDrawer.Upper..enumDrawer.Lower, 1..GVL_Constants_Magazine.MaxAdjustValves]	OF UDINT;
	SwitchCountCassette			: ARRAY[1..CassetteAdjustments.usiNumberOfUnits] OF ARRAY[enumDrawer.Upper..enumDrawer.Lower, 1..GVL_Constants_Magazine.MaxCassettes]		OF ARRAY[enumMotorsType.X1..enumMotorsType.Y] OF UDINT;
	ActualCassettePosition		: ARRAY[1..CassetteAdjustments.usiNumberOfUnits] OF ARRAY[enumDrawer.Upper..enumDrawer.Lower, 1..GVL_Constants_Magazine.MaxCassettes]		OF CassettePosition;
	TargetCassettePosition		: ARRAY[1..CassetteAdjustments.usiNumberOfUnits] OF ARRAY[enumDrawer.Upper..enumDrawer.Lower, 1..GVL_Constants_Magazine.MaxCassettes]		OF CassettePosition;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		activeDrawer			:= LabelSuppliers.Unit[i].activeDrawerForMonitoring,
		airPressureOk			:= SER.DigIn.xAirPressureOK,
		Data					:= Data[i],
		SwitchCountEnable		:= SwitchCountEnable[i],
		SwitchCountAdjust		:= SwitchCountAdjust[i],
		SwitchCountCassette		:= SwitchCountCassette[i],
		ActualCassettePosition	:= ActualCassettePosition[i],
		TargetCassettePosition	:= TargetCassettePosition[i],
	);
END_FOR

END_PROGRAM
