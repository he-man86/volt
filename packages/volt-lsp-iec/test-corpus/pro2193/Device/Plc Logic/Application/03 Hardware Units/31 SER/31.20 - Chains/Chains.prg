{attribute 'global_init_slot' := '50002'}		// Is needed because RejectStations.Unit[1] needs to be initialized first (??)
{attribute 'symbol' := 'none'}
PROGRAM Chains
VAR_INPUT
	safetyModulesForChain		: ARRAY[1..5] OF IModuleHasSafePosForChain :=
	[
		0,
		ZUnits.Unit[1],
		XuUnits.Unit[1],
		0,
		0
	];

	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF Chain_WithCarrierPlatesFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= ZUnits.Unit[1],
			resetCondition2	:= RejectStations.Unit[1],
		)
	];

END_VAR
VAR
	i							: USINT;
	selectedInstance			: USINT(1..usiNumberOfUnits);	// Index of instance shown in CODESYS Visu
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..Chains.usiNumberOfUnits] OF ChainBase_Data;
	{attribute 'symbol' := 'readwrite'}	DataProject					: ARRAY[1..Chains.usiNumberOfUnits] OF Chain_WithCarrierPlates_Data;
	{attribute 'symbol' := 'readwrite'}	DataBrink					: ARRAY[1..Chains.usiNumberOfUnits] OF DataBrinkType;
	coveredDistance				: ARRAY[1..Chains.usiNumberOfUnits] OF UDINT;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		xEnableServoDrive			:= GlobalVars.EnableServoDrives,
		xQuickStop					:= NOT SER.DigIn.quickStopOk,
		safetyModules				:= safetyModulesForChain,
		axisRef						:= C1Drive,
		Data						:= Data[i],
		DataProject					:= DataProject[i],
		dataBrink					:= DataBrink[i],
		coveredDistance				:= coveredDistance[i],
	);
END_FOR

END_PROGRAM
