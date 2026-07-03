FUNCTION Calc_Round : Bool
VAR_INPUT
	bIsLeftCake : BOOL;
	nPartsRound: INT;
	cutsToMake: INT;
	rSizeOfKnife				: REAL;
	rCutsPerLine				: REAL;
	rRotatiehoek: ARRAY[1..35] OF REAL;
	FirstPoint					: Gonio_Point;
	overshootSettings 			: Gonio_Settings;
END_VAR
VAR
	bToggle: BOOL;
	bKC1: BOOL;

	i: INT;
	c: INT;	
	nCutsPerLine				: INT;
	

	rRotatiehoekInRad			: REAL;
	rDiameterTaart				: REAL;
	rKC2						: REAL;
	rStepDistX 					: REAL;
	rStepDistY 					: REAL;
END_VAR

rDiameterTaart	:= g_HMI_RCP_Parameters.rDiameterRound;
	//nFirstPosFirstTray := g_sCuttingPositionsInfo.index;
	
	(*Calculate number of cuts*)
	rCutsPerLine := rDiameterTaart / rSizeOfKnife;
	nCutsPerLine := TRUNC_INT(rCutsPerLine);
	IF rCutsPerLine > nCutsPerLine THEN
		nCutsPerLine := nCutsPerLine + 1;
	END_IF


	IF bIsLeftCake THEN
		cutsToMake := Calc_RoundCakeDivisionsTable(I_Divisions:=g_HMI_RCP_Parameters.nPartsRound, I_InSequence := g_HMI_RCP_Parameters.bCutRoundInSequence, IQ_Table:= rRotatiehoek);
	ELSE
		cutsToMake := Calc_RoundCakeDivisionsTable(I_Divisions:=g_HMI_RCP_Parameters.nPartsRoundRight, I_InSequence := g_HMI_RCP_Parameters.bCutRoundInSequence, IQ_Table:= rRotatiehoek);
	END_IF	
	
	IF (cutsToMake > 0) THEN	
		
		FOR i :=1 TO (nPartsRound / 2) DO
			rRotatiehoekInRad	:=	(rRotatiehoek[i] / 360.0) * 2.0 * C_rPi;

			(*Verplaatsingen bepalen*)
			IF nCutsPerLine = 1 THEN
				rStepDistX := 0;
				rStepDistY := 0;
			ELSE
				rStepDistX := (rDiameterTaart - rSizeOfKnife)/(nCutsPerLine - 1)* COS(rRotatiehoekInRad);
				rStepDistY := (rDiameterTaart - rSizeOfKnife)/(nCutsPerLine - 1) * SIN(rRotatiehoekInRad);
			END_IF
	
			IF NOT bToggle THEN (* mes van MaxX/MinY naar MinX/MaxY*)
				FOR c := 0 TO nCutsPerLine-1 DO
					IF nCutsPerLine = 1 THEN
						IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rMidPosOffsetRound1X,           
										I_rY:=							FirstPoint.Y + g_HMI_RCP_Parameters.rMidPosOffsetRound1Y,
										I_rA:=							rRotatiehoek[i],
										I_rK:=							0,
										I_bIsWaste :=					FALSE,
										I_sOvershootSettings := 		overshootSettings)
						THEN 
										RETURN;
						END_IF  
					ELSE
						IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rMidPosOffsetRound1X
																							+ (((rDiameterTaart - rSizeOfKnife) / 2) * COS(rRotatiehoekInRad))
																							- (c * rStepDistX),           
										I_rY:=							FirstPoint.Y + g_HMI_RCP_Parameters.rMidPosOffsetRound1Y
																							+ (((rDiameterTaart - rSizeOfKnife) / 2) * SIN(rRotatiehoekInRad))
																							- (c * rStepDistY),
										I_rA:=							rRotatiehoek[i],
										I_rK:=							0,
										I_bIsWaste :=					FALSE,
										I_sOvershootSettings := 		overshootSettings)
						THEN 
										RETURN;
						END_IF  
					END_IF
				END_FOR
			ELSE (* toggle, mes van linksonder naar rechtsboven *)
				FOR c := 0 TO nCutsPerLine-1 DO
					IF nCutsPerLine = 1 THEN
						IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rMidPosOffsetRound1X,           
										I_rY:=							FirstPoint.Y + g_HMI_RCP_Parameters.rMidPosOffsetRound1Y,
										I_rA:=							rRotatiehoek[i],
										I_rK:=							0,
										I_bIsWaste :=					FALSE,
										I_sOvershootSettings := 		overshootSettings)
						THEN 
										RETURN;
						END_IF  

					ELSE
						IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rMidPosOffsetRound1X
																								- (((rDiameterTaart - rSizeOfKnife) / 2) * COS(rRotatiehoekInRad))
																								+ (c * rStepDistX),           
										I_rY:=							FirstPoint.Y + g_HMI_RCP_Parameters.rMidPosOffsetRound1Y
																								- (((rDiameterTaart - rSizeOfKnife) / 2) * SIN(rRotatiehoekInRad))
																								+ (c * rStepDistY),
										I_rA:=							rRotatiehoek[i],
										I_rK:=							0,
										I_bIsWaste :=					FALSE,
										I_sOvershootSettings := 		overshootSettings)
						THEN 
										RETURN;
						END_IF  
						IF g_sCuttingPositionsInfo.index = 4 THEN bKC1 := TRUE; rKC2 := COS(90); END_IF
					END_IF
				END_FOR
			END_IF
			bToggle := NOT bToggle;
		END_FOR
	END_IF

END_FUNCTION
