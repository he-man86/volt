{attribute 'symbol' := 'none'}
PROGRAM ZUnits
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF ZUnit_ForChainWithServoRotateFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= XuUnits.Unit[1],
			resetCondition2	:= 0,
		)
	];

END_VAR
VAR
	i							: USINT;
	selectedInstance			: USINT(1..usiNumberOfUnits);	// Index of instance shown in CODESYS Visu
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..ZUnits.usiNumberOfUnits] OF ZUnit_Base_Data;
	{attribute 'symbol' := 'readwrite'}	DataProject					: ARRAY[1..ZUnits.usiNumberOfUnits] OF ZUnit_ForChainWithServoRotate_Data;
	{attribute 'symbol' := 'readwrite'}	DataBrink					: ARRAY[1..ZUnits.usiNumberOfUnits] OF DataBrinkType;
	coveredDistance				: ARRAY[1..ZUnits.usiNumberOfUnits] OF UDINT;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
	MaxSides					: USINT	:= 2;
	MaxVacuums					: USINT	:= GVL_Constants.ChainProductsForZUnit;
	NumberOfTakeoverPositions	: USINT	:= 4;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		xEnableServoDrive	:= GlobalVars.EnableServoDrives,
		xQuickStop			:= NOT SER.DigIn.quickStopOk,
		rotateMotor			:= ZRUnits.Unit[1],
		axisRef				:= ZDrive,
		Data				:= Data[i],
		DataProject			:= DataProject[i],
		dataBrink			:= DataBrink[i],
		coveredDistance		:= coveredDistance[i],
	);
END_FOR

END_PROGRAM
