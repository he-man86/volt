{attribute 'symbol' := 'none'}
PROGRAM Magazines
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF Magazine_DoubleM_WithFlipFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= XiUnits.Unit[1],
			resetCondition2	:= 0,
		)
	];
	{attribute 'symbol' := 'readwrite'}	UnitMotors					: ARRAY[1..usiNumberOfUnits] OF MagazineMotors_DrawerFB
	[
		(
			instanceNo		:= 11,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= Unit[1].ModuleHandler,
		)
	];
END_VAR
VAR
	i							: USINT;
	selectedInstance			: USINT(1..usiNumberOfUnits);	// Index of instance shown in CODESYS Visu
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..Magazines.usiNumberOfUnits] OF Magazine_Data;
	{attribute 'symbol' := 'readwrite'}	DataMotors					: ARRAY[1..Magazines.usiNumberOfUnits] OF MagazineMotors_Drawer_Data;
	{attribute 'symbol' := 'readwrite'}	DataBrink					: ARRAY[1..Magazines.usiNumberOfUnits] OF MagazineMotors_Drawer_BrinkData;
	coveredDistance				: ARRAY[1..Magazines.usiNumberOfUnits] OF ARRAY[PickPlaceAxesNames.A1..PickPlaceAxesNames.A2] OF UDINT;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		Data				:= Data[i],
		motors				:= UnitMotors[1]);

	UnitMotors[i](
		xEnableDrive		:= GlobalVars.EnableServoDrives,
		xQuickStop			:= NOT SER.DigIn.quickStopOk_MUnit,
		usiGlobalSERSpeed	:= PersistentVars.usiGlobalSERSpeed,
		xGlobalReset		:= GlobalVars.Reset,
		A1Axis				:= M1Drive,
		A2Axis				:= M2Drive,
		XAxis				:= Axis_X,
		ZAxis				:= Axis_Z,
		Data				:= DataMotors[i],
		MAxesGroup			:= MagazineAxes,
		DataBrink			:= DataBrink[i],
		coveredDistance		:= coveredDistance[i],
	);
END_FOR

END_PROGRAM
