(* @volt-exclude-from-build *)
// Sticker units (or label dispencers) attach a printed label or sticker to the products
{attribute 'symbol' := 'none'}
PROGRAM StickerUnits
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF StickerUnit_KreuwelFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= 0,
			resetCondition2	:= 0,
			axisRef			:= SDrive,
			dataBrink		:= DataBrink[1],
		)
	];

END_VAR
VAR
	i							: USINT;
	selectedInstance			: USINT(1..usiNumberOfUnits);	// Index of instance shown in CODESYS Visu
	debuggingActive				: BOOL;
	debuggingStart				: BOOL;
	debuggingResult				: BOOL;
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..StickerUnits.usiNumberOfUnits] OF StickerUnit_Kreuwel_Data;
	{attribute 'symbol' := 'readwrite'}	DataBrink					: ARRAY[1..StickerUnits.usiNumberOfUnits] OF DataBrinkType;
	coveredDistance				: ARRAY[1..StickerUnits.usiNumberOfUnits] OF UDINT;
	stickerPresentRegister		: WORD;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		xEnableServoDrive			:= GlobalVars.EnableServoDrives,
		xQuickStop					:= NOT SER.DigIn.quickStopOk,
		Data						:= Data[i],
		stickerPresentRegister		:= stickerPresentRegister);
END_FOR


IF debuggingActive THEN
	IF debuggingStart THEN
		IF debuggingResult := Unit[1].ApplySticker() THEN
			debuggingStart	:= FALSE;
		END_IF
	END_IF
END_IF

END_PROGRAM
