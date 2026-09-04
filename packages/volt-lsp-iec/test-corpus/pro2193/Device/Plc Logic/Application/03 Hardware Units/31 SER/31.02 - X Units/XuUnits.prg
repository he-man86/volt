{attribute 'symbol' := 'none'}
PROGRAM XuUnits
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF XuUnit_ForChainFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= InjectionMouldingMachine.Unit,
			resetCondition2	:= 0,
		)
	];

END_VAR
VAR_OUTPUT
	itfXuUnits					: ARRAY[1..usiNumberOfUnits] OF IModuleHasTakeoutPos := [Unit[1]];
END_VAR
VAR
	i							: USINT;
	selectedInstance			: USINT(1..usiNumberOfUnits);	// Index of instance shown in CODESYS Visu
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..XuUnits.usiNumberOfUnits] OF XuUnit_Default_Data;
	{attribute 'symbol' := 'readwrite'}	DataProject					: ARRAY[1..XuUnits.usiNumberOfUnits] OF XuUnit_ForChain_Data;
	{attribute 'symbol' := 'readwrite'}	DataBrink					: ARRAY[1..XuUnits.usiNumberOfUnits] OF DataBrinkType;
	coveredDistance				: ARRAY[1..XuUnits.usiNumberOfUnits] OF UDINT;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
	MaxVacuums					: USINT	:= 3;
	NumberOfTakeoverPositions	: USINT	:= 2;	// 1 = Takeover pos;
												// 2 = Reject in shute pos
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		xEnableServoDrive	:= GlobalVars.EnableServoDrives,
		xQuickStop			:= NOT SER.DigIn.quickStopOk,
		axisRef				:= XuDrive,
		Data				:= Data[i],
		DataProject			:= DataProject[i],
		dataBrink			:= DataBrink[i],
		coveredDistance		:= coveredDistance[i],
	);
END_FOR

CASE PersistentVars.RecipeVars.ActiveExchangeSet OF
//	enumExchangeSets.SingleCavSingleTakeover:
//		Unit[1].EnableVacuums	:= 2#0010;
//	enumExchangeSets.SingleCavDualTakeover:
//		Unit[1].EnableVacuums	:= 2#0010;
//	enumExchangeSets.FourCavDualTakeover:
//		Unit[1].EnableVacuums	:= 2#0000;
//	enumExchangeSets.TwoCavSingleTakeover:
//		Unit[1].EnableVacuums	:= 2#0000;
	ELSE
		Unit[1].EnableVacuums	:= 2#1110;
END_CASE

END_PROGRAM

{attribute 'monitoring':='call'}
PROPERTY PUBLIC AllUnitsAreOnTakeoutPos : BOOL
GET
VAR
	i	: INT;
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

{attribute 'monitoring':='call'}
PROPERTY PUBLIC AllXuUnitsHaveAllProducts : BOOL
GET
VAR
	i	: INT;
END_VAR
AllXuUnitsHaveAllProducts := TRUE;

FOR i := 1 TO usiNumberOfUnits DO
	IF Unit[i].HasPayload <> enumPayload._All THEN
		AllXuUnitsHaveAllProducts := FALSE;
		EXIT;	// Exit the loop on the first match
	END_IF
END_FOR
END_GET
END_PROPERTY
