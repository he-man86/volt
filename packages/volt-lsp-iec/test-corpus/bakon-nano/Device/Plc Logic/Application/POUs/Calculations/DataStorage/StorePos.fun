//Stores a cutting position to eather the cutting or waste table depending on the waste input bit.
FUNCTION StorePos : BOOL 						//Returns wether the position was sucessfully stored.

VAR CONSTANT
	defaultXYA 					: XYA_Target;	//A constant default XYA target
END_VAR
VAR_INPUT
	I_rX 						: REAL;			// X-pos
    I_rY 						: REAL;			// Y-pos
    I_rA 						: REAL;			// Rotation
    I_rK 						: REAL;			// 
	I_bIsWaste					: BOOL;
	I_sOvershootSettings		: Gonio_Settings;
END_VAR
VAR
	sTempPosition		: XYA_Target;
END_VAR

sTempPosition 			:= defaultXYA;
sTempPosition.X_Target 	:= I_rX;
sTempPosition.Y_Target 	:= I_rY;
sTempPosition.A_Target 	:= I_rA;
sTempPosition.K_Target 	:= I_rK;


IF NOT Gonio_CorrectOvershoot(xya:=sTempPosition, settings:= I_sOvershootSettings) THEN
	g_sMACH.ERR.bOvershootCorrectionImpossible := TRUE;
	StorePos := g_HMI_MCH_Parameters.bSkipImpossiblePositions AND NOT g_sMACH.ERR.bMarginsInOvershootCorrectionInvalid AND NOT g_sMACH.ERR.bKnifeSettingsIncorrect AND NOT g_sMACH.ERR.bIntersectionNotFound; 
	RETURN;
END_IF


StorePos := SEL(I_bIsWaste,	Stack_Push_CuttingPos(I_dataArray := ADR(g_aCuttingPositions), 	IQ_dataArrayInfo := g_sCuttingPositionsInfo,	IQ_item := sTempPosition),
							Stack_Push_CuttingPos(I_dataArray := ADR(g_aWastePositions), 	IQ_dataArrayInfo := g_sWastePositionsInfo, 		IQ_item := sTempPosition));

RETURN;

END_FUNCTION
