{attribute 'symbol' := 'none'}
PROGRAM YUnits
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF YUnit_DefaultFB//<NumberOfTakeoverPositions>
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= XiUnits.Unit[1],
			resetCondition2	:= XuUnits.Unit[1],
		)
	];

END_VAR
VAR_OUTPUT
	itfYUnitsSafe				: ARRAY[1..usiNumberOfUnits] OF IModuleHasSafePos		:= [Unit[1]];
	itfYUnitsTakeout			: ARRAY[1..usiNumberOfUnits] OF IModuleHasTakeoutPos	:= [Unit[1]];
END_VAR
VAR
	i							: USINT;
	selectedInstance			: USINT(1..usiNumberOfUnits);	// Index of instance shown in CODESYS Visu
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..YUnits.usiNumberOfUnits] OF YUnit_Default_Data;
	{attribute 'symbol' := 'readwrite'}	DataBrink					: ARRAY[1..YUnits.usiNumberOfUnits] OF DataBrinkType;
	coveredDistance				: ARRAY[1..YUnits.usiNumberOfUnits] OF UDINT;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
	NumberOfTakeoverPositions	: USINT	:= 6;	// 1 = transfer 1
												// 2 = transfer 2
												// 3 = transfer 3
												// 4 = reject in shute 1
												// 5 = reject in shute 2
												// 6 = reject in shute 3
END_VAR

// The itfSafePos array is needed because it's not possible to cast an array of fbs to another type.
// More info here: https://stackoverflow.com/questions/69319659/how-do-i-pass-an-array-of-an-extended-type-in-codesys-twincat3

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		xEnableServoDrive			:= GlobalVars.EnableServoDrives,
		xQuickStop					:= NOT SER.DigIn.quickStopOk,
		axisRef						:= YDrive,
		Data						:= Data[i],
		DataBrink					:= DataBrink[i],
		coveredDistance				:= coveredDistance[i],
	);
END_FOR

END_PROGRAM

{attribute 'monitoring':='call'}
PROPERTY PUBLIC AllUnitsAreOnTakeoutPos : BOOL
GET
VAR
	i	: USINT;
END_VAR
AllUnitsAreOnTakeoutPos := TRUE;

FOR i := 1 TO usiNumberOfUnits DO
	IF NOT Unit[i].IsOnTakeoutPos THEN
		AllUnitsAreOnTakeoutPos := FALSE;
		EXIT;	// Exit the loop on the first match
	END_IF
END_FOR
END_GET
END_PROPERTY
