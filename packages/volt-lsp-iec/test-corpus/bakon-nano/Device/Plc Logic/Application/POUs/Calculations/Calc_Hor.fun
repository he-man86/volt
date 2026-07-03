function Calc_Hor : bool
VAR
	nNrOfLines: INT;
	rLengthOfLine: REAL;
	nNumberOfCutsPerLine: INT;
	nCnt_pos: INT;
	nCnt_line: INT;
	nCnt_Push: INT;
	bToggle: BOOL;
	//nFirstPos: INT;
	//nFirstWastePos: INT;
	rLast_Y_Pos	:REAL;
	rSizeTrimRear	:REAL;
	rSizeTrimFront	:REAL;
	rSizeTrimRight	:REAL;
	rSizeTrimLeft	:REAL;

	//CorrectOvershootHor1a	: CorrectOvershootHor;
	//CorrectOvershootHor1b	: CorrectOvershootHor;
	//CorrectOvershootHor2	: CorrectOvershootHor;
	//CorrectOvershootHor3	: CorrectOvershootHor;
	//CorrectOvershootHor4	: CorrectOvershootHor;
	//CorrectOvershootHor5	: CorrectOvershootHor;
	//CorrectOvershootHor6	: CorrectOvershootHor;
	//CorrectOvershootHor7	: CorrectOvershootHor;
	rMaxTraySize: REAL;
	rMinTraySize: REAL;
	rProdLength_InY: REAL;
	rProdLength_InX: REAL;
	rMmPerCut :REAL;
	rCenterPointKnifeInverted: REAL;
	rSizeOfKnife: REAL;
	//rStartPointTray_Y: REAL;
	rMinimumTrayTrimSize: REAL;
	rNrOfLines 	:REAL;
	rWasteExtra	:REAL;
	rIcedOffset	:REAL;

	rCenterPointKnife: REAL;
	rMinimumSlabTrimSize: REAL;
	nPartsY: INT;
	
	FirstPoint					: Gonio_Point;
	CopyPoint					: Gonio_Point;
	
	rFirstYPosition : REAL;
	overshootSettings 			: Gonio_Settings;
	nFirstPosFirstTray 		:INT;
	nFirstWastePosFirstTray :INT;
	nLastPosFirstTray		: INT;
	nLastWastePosFirstTray	: int;
END_VAR

(* Calc_Hor, (mes 0 graden *)

(************************************************************************************************************************************
 * HISTORY																					 
 ************************************************************************************************************************************
 * Update 		: 0.1																			  
 * Author 		: K. Kole																			  
 * Changes	: Tray square, 	calculation for rSizeTrimRight and rSizeTrimLeft changed
 * Update 		: 0.2
 * Author 		: K. Kole																			  
 * Changes	: Tray square, 	calculation for rSizeTrimRear and rSizeTrimFront changed
 ************************************************************************************************************************************)
Calc_Hor := FALSE;
bToggle	:= FALSE;
//nFirstPos := g_sCuttingPositionsInfo.index;
//nFirstWastePos := g_sWastePositionsInfo.index ;

nFirstPosFirstTray 				:= g_sCuttingPositionsInfo.index;
nFirstWastePosFirstTray 		:= g_sWastePositionsInfo.index;

rSizeOfKnife					:= g_HMI_MCH_Parameters.rSizeOfKnife;
rCenterPointKnife				:= rSizeOfKnife/2;
rCenterPointKnifeInverted	:= rSizeOfKnife/2;

overshootSettings.knifeAxis		:= rCenterPointKnife;
overshootSettings.knifeLength	:= rSizeOfKnife;
overshootSettings.precision		:= 0.1;

(**********************************************************************************************************************************)
(* Tray square *)(*AC 23-10-2012 Also Tray Triangle*)
(**********************************************************************************************************************************)
IF		((g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x1)
	OR	(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2)
	OR	(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4)
	OR 	(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1))
THEN

	(* Determine type of tray *)
	IF  (g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x1) THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayLarge_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayLarge_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTrayLarge;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTrayLarge_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayLarge_Y;
	ELSIF	(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2)
	THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTraySmall_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTraySmall_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTraySmall;
		FirstPoint.X  := g_HMI_MCH_Parameters.rStartPointTraySmall_X;
		FirstPoint.Y  := g_HMI_MCH_Parameters.rStartPointTraySmall1_Y;	(* Startpoint for first small tray *)
	ELSIF	(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4)
	THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayTriple_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayTriple_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTrayTriple;
		FirstPoint.X  := g_HMI_MCH_Parameters.rStartPointTrayTriple_X;
		FirstPoint.Y  := g_HMI_MCH_Parameters.rStartPointTrayTriple1_Y;	(* Startpoint for first small tray *)
	ELSIF	(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1)
	THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayDouble_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayDouble_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTrayDouble;
		FirstPoint.X  := g_HMI_MCH_Parameters.rStartPointTrayDouble1_X;
		FirstPoint.Y  := g_HMI_MCH_Parameters.rStartPointTrayDouble_Y;	(* Startpoint for first small tray *)
	END_IF

	IF g_HMI_RCP_Parameters.bTrianglesInTray AND g_HMI_RCP_Parameters.bUseRectanglesInEight THEN (*AC 04-07-2013: Uitbreiding 8 driehoeken uit stuk*)
		nPartsY := g_HMI_RCP_Parameters.nPartsY * 2;
	ELSE
		nPartsY := g_HMI_RCP_Parameters.nPartsY;
	END_IF

	IF g_HMI_RCP_Parameters.rSizeTrimFront <= 0			(* Wijziging 16 juli 2010 *)(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	THEN
		rSizeTrimRear	:= 0;
	ELSE
		rSizeTrimRear 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimFront); (*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	END_IF
	IF g_HMI_RCP_Parameters.rSizeTrimRear<= 0			(* Wijziging 16 juli 2010 *)(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	THEN
		rSizeTrimFront	:= 0;
	ELSE
		rSizeTrimFront 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimRear);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	END_IF
	rSizeTrimRight 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimRight);
	rSizeTrimLeft 		:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimLeft);

	(*Additional safety checks for trays*)
	rMaxTraySize := rProdLength_InX - (rMinimumTrayTrimSize * 2);
	IF			rMaxTraySize >= (g_HMI_MCH_Parameters.rSizeOfKnife)											(* Fixed mes past in het blik *)
	THEN
		rSizeOfKnife					:= g_HMI_MCH_Parameters.rSizeOfKnife;
		rCenterPointKnife				:= rSizeOfKnife/2;
		rCenterPointKnifeInverted	:= rSizeOfKnife/2;
		rMinTraySize					:= rProdLength_InX - (rSizeTrimRight + rSizeTrimLeft);
		IF rMinTraySize < rSizeOfKnife THEN
			rSizeTrimRight	:= rSizeTrimRight - (rSizeOfKnife - rMinTraySize);
			rSizeTrimRight 	:= MAX(rMinimumTrayTrimSize, rSizeTrimRight);								(* Check if new calculated trim is >= MinimumTrim *)
			rSizeTrimLeft	:= rProdLength_InX - rSizeOfKnife - rSizeTrimRight;
		END_IF
	ELSE																											(* Fixed mes past NIET in het blik *)
		g_sMACH.ERR.bTrayTooSmall := TRUE;
		RETURN;
	END_IF

	g_rDistanceBetweenCuts_InY:=	(rProdLength_InY - rSizeTrimRear - rSizeTrimFront) / INT_TO_REAL(nPartsY);(*g_HMI_RCP_Parameters.nPartsY);*)

	(* Determine number of lines *)
	IF g_bTrimRear AND g_bTrimFront
	THEN
		nNrOfLines	:= 1 + nPartsY;(*g_HMI_RCP_Parameters.nPartsY);*)(*AC 04-07-2013*)
	ELSIF g_bTrimRear AND NOT g_bTrimFront
	THEN
		nNrOfLines	:= nPartsY;(*g_HMI_RCP_Parameters.nPartsY);*)(*AC 04-07-2013*)
	ELSIF NOT g_bTrimRear AND g_bTrimFront
	THEN
		nNrOfLines	:= nPartsY;(*g_HMI_RCP_Parameters.nPartsY);*)(*AC 04-07-2013*)
	ELSIF NOT g_bTrimRear AND NOT g_bTrimFront
	THEN
		nNrOfLines	:=nPartsY - 1;(*g_HMI_RCP_Parameters.nPartsY);*)(*AC 04-07-2013*)
	END_IF

	(* Calculate number of cuts on the line *)
	rLengthOfLine := rProdLength_InX - rSizeTrimRight - rSizeTrimLeft;
	IF rLengthOfLine > rSizeOfKnife
	THEN
		nNumberOfCutsPerLine := TRUNC_INT(rLengthOfLine / rSizeOfKnife);
		IF nNumberOfCutsPerLine < (rLengthOfLine / rSizeOfKnife)
		THEN
			nNumberOfCutsPerLine := nNumberOfCutsPerLine + 1;
		END_IF
	ELSE
		nNumberOfCutsPerLine := 1;
	END_IF
	(*Calculation of covered distance per cut*)
	rMmPerCut := (rLengthOfLine - rSizeOfKnife)/(nNumberOfCutsPerLine -1);

	(* Calculate positions on first line *)
	overshootSettings.MarginXMin := FirstPoint.x + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
	overshootSettings.MarginXMax := FirstPoint.x + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);	(* Mechanical boundary *)
	overshootSettings.MarginYMin := FirstPoint.y + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
	overshootSettings.MarginYMax := FirstPoint.y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
	
	overshootSettings.adjustXMax := FALSE;
	overshootSettings.adjustXMin := FALSE;
	overshootSettings.adjustYMax := FALSE;
	overshootSettings.adjustYMin := FALSE;
	
	IF g_bTrimRear
	THEN
		IF nNumberOfCutsPerLine = 1
		THEN
			IF NOT StorePos(I_rX:= 							Firstpoint.X + rSizeTrimRight + rCenterPointKnife,           
							I_rY:=							(rFirstYPosition := Firstpoint.Y + rSizeTrimRear),
							I_rA:=							0,
							I_rK:=							0,
							I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
							I_sOvershootSettings := 		overshootSettings)
			THEN 
								RETURN;
			END_IF  
		ELSE
			FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + (nCnt_pos - 1) * rMmPerCut
																			 + rCenterPointKnife,           
								I_rY:=							(rFirstYPosition := FirstPoint.Y + rSizeTrimRear),
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			END_FOR
			(* Last position on the line *)
			IF NOT StorePos(I_rX:= 							Firstpoint.X + rProdLength_InX - rSizeTrimLeft - rCenterPointKnifeInverted,           
							I_rY:=							Firstpoint.Y + rSizeTrimRear,
							I_rA:=							0,
							I_rK:=							0,
							I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
							I_sOvershootSettings := 		overshootSettings)
			THEN 
								RETURN;
			END_IF  
			
			
		END_IF
	ELSE (* No waste strip at the left *)
		IF nNrOfLines > 0	(* New 8 feb 2010: when only one piece and no trims *)
		THEN
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							Firstpoint.X + rSizeTrimRight + rCenterPointKnife,           
								I_rY:=							(rFirstYPosition := Firstpoint.Y + rSizeTrimRear + g_rDistanceBetweenCuts_InY),
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					FALSE,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			ELSE
				FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							Firstpoint.X + rSizeTrimRight + (nCnt_pos - 1) * rMmPerCut
																					 + rCenterPointKnife,           
									I_rY:=							(rFirstYPosition := Firstpoint.Y + rSizeTrimRear + g_rDistanceBetweenCuts_InY),
									I_rA:=							0,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
					
					
				END_FOR
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							Firstpoint.X + rProdLength_InX - rSizeTrimLeft - rCenterPointKnifeInverted,           
								I_rY:=							Firstpoint.Y + rSizeTrimRear + g_rDistanceBetweenCuts_InY,
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					FALSE,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			END_IF
		END_IF
	END_IF

	(* Fill in all other positions on the rest of the lines *)

	FOR nCnt_line := 2 TO (nNrOfLines) BY 1 DO
		IF nNumberOfCutsPerLine = 1
		THEN
			IF NOT StorePos(I_rX:= 							Firstpoint.X + rSizeTrimRight + rCenterPointKnife,           
							I_rY:=							rFirstYPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InY,
							I_rA:=							0,
							I_rK:=							0,
							I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
							I_sOvershootSettings := 		overshootSettings)
			THEN 
								RETURN;
			END_IF  
			
			
		ELSE
			IF bToggle (* from front to rear *)
			THEN
				FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							Firstpoint.X + rSizeTrimRight + rCenterPointKnife
														                                                   + (nCnt_pos - 1) * rMmPerCut ,           
									I_rY:=							rFirstYPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InY,
									I_rA:=							0,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
					
					
				END_FOR
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							Firstpoint.X + rProdLength_InX - rSizeTrimLeft - rCenterPointKnifeInverted,           
								I_rY:=							rFirstYPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InY,
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			ELSE (* toggle, ie from rear to front *)
				FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							Firstpoint.X + rProdLength_InX - rSizeTrimLeft - rCenterPointKnifeInverted
																					- (nCnt_pos -1) * rMmPerCut,           
									I_rY:=							rFirstYPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InY,
									I_rA:=							0,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
					
					
				END_FOR
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + rCenterPointKnife,           
								I_rY:=							rFirstYPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InY,
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			END_IF
			bToggle := NOT bToggle;
		END_IF
	END_FOR

	nLastPosFirstTray		:= g_sCuttingPositionsInfo.index-1;
	nLastWastePosFirstTray	:= g_sWastePositionsInfo.index-1;

	(* Double the positions for the second tray if small trays is selected *)
	IF	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2
	THEN
	
	
		CopyPoint.X := FirstPoint.X;
		CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTraySmall2_Y;
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
		overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);	(* Mechanical boundary *)
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
		overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)

		
		IF nFirstPosFirstTray <= nLastPosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstPosFirstTray,
				I_lastIndex					:= nLastPosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aCuttingPositions),
				I_bReverseOrder				:= (nNrOfLines MOD 2)>0,
				IQ_dataArrayInfo 			:= g_sCuttingPositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
		
		IF nFirstWastePosFirstTray <= nLastWastePosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstWastePosFirstTray,
				I_lastIndex					:= nLastWastePosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aWastePositions),
				I_bReverseOrder				:= (nNrOfLines MOD 2)>0,
				IQ_dataArrayInfo 			:= g_sWastePositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
	END_IF

	(* Triple the positions for the second and third tray if triple trays is selected *)
	IF	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4
	THEN
	
		CopyPoint.X := FirstPoint.X;
		CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple2_Y;
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
		overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);	(* Mechanical boundary *)
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
		overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)

		
		IF nFirstPosFirstTray <= nLastPosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstPosFirstTray,
				I_lastIndex					:= nLastPosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aCuttingPositions),
				I_bReverseOrder				:= (nNrOfLines MOD 2)>0,
				IQ_dataArrayInfo 			:= g_sCuttingPositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
		
		IF nFirstWastePosFirstTray <= nLastWastePosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstWastePosFirstTray,
				I_lastIndex					:= nLastWastePosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aWastePositions),
				I_bReverseOrder				:= (nNrOfLines MOD 2)>0,
				IQ_dataArrayInfo 			:= g_sWastePositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
	
	
	

		(*Third tray*)
		CopyPoint.X := FirstPoint.X;
		CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple3_Y;
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
		overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);	(* Mechanical boundary *)
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
		overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)

		IF nFirstPosFirstTray <= nLastPosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstPosFirstTray,
				I_lastIndex					:= nLastPosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aCuttingPositions),
				I_bReverseOrder				:= FALSE,
				IQ_dataArrayInfo 			:= g_sCuttingPositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
		
		IF nFirstWastePosFirstTray <= nLastWastePosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstWastePosFirstTray,
				I_lastIndex					:= nLastWastePosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aWastePositions),
				I_bReverseOrder				:= FALSE,
				IQ_dataArrayInfo 			:= g_sWastePositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
		
		

		(*Fourth Tray*)
		CopyPoint.X := FirstPoint.X;
		CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple4_Y;
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
		overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);	(* Mechanical boundary *)
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
		overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)

		IF nFirstPosFirstTray <= nLastPosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstPosFirstTray,
				I_lastIndex					:= nLastPosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aCuttingPositions),
				I_bReverseOrder				:= (nNrOfLines MOD 2)>0,
				IQ_dataArrayInfo 			:= g_sCuttingPositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
		
		IF nFirstWastePosFirstTray <= nLastWastePosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstWastePosFirstTray,
				I_lastIndex					:= nLastWastePosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aWastePositions),
				I_bReverseOrder				:= (nNrOfLines MOD 2)>0,
				IQ_dataArrayInfo 			:= g_sWastePositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
	END_IF

	(* 2x positions the positions for the second tray if double trays side by side *)
	IF	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1
	THEN
		CopyPoint.X := g_HMI_MCH_Parameters.rStartPointTrayDouble2_X; // FirstPoint.X;
		CopyPoint.Y := FirstPoint.Y;// g_HMI_MCH_Parameters.rStartPointTrayDouble2_X;
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
		overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);	(* Mechanical boundary *)
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
		overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)

		IF nFirstPosFirstTray <= nLastPosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstPosFirstTray,
				I_lastIndex					:= nLastPosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aCuttingPositions),
				I_bReverseOrder				:= true,
				IQ_dataArrayInfo 			:= g_sCuttingPositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
		
		IF nFirstWastePosFirstTray <= nLastWastePosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstWastePosFirstTray,
				I_lastIndex					:= nLastWastePosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aWastePositions),
				I_bReverseOrder				:= true,
				IQ_dataArrayInfo 			:= g_sWastePositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
	END_IF

(**********************************************************************************************************************************)
(* If slab (square or diagonal) *)
(**********************************************************************************************************************************)
ELSIF 		(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1)
		OR	(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Diagonal_1x1)
		OR	(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1_Clamp)		(* V04.01 *)
THEN
	IF g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1 THEN
		rIcedOffset 				:= g_HMI_RCP_Parameters.rShiftCompensation;
		rMinimumSlabTrimSize	:= 0;
	ELSE
		rIcedOffset := 0;
		IF	(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1_Clamp) THEN
			rIcedOffset 				:= g_HMI_RCP_Parameters.rShiftCompensation;
			rMinimumSlabTrimSize	:= g_HMI_MCH_Parameters.rMinimumTrimSizeSlab;
		ELSE
			rMinimumSlabTrimSize	:= 0;
		END_IF
	END_IF

	rSizeOfKnife					:= g_HMI_MCH_Parameters.rSizeOfKnife;
	rCenterPointKnife				:= rSizeOfKnife/2;
	rCenterPointKnifeInverted	:= rSizeOfKnife/2;

	(* Offset of slab *)
	FirstPoint.X	:= g_HMI_MCH_Parameters.rStartPointSlab_X;
	FirstPoint.Y	:= g_HMI_MCH_Parameters.rStartPointSlab_Y;

	rProdLength_InX	:= g_HMI_RCP_Parameters.rProdLength_InX + (rIcedOffset * g_HMI_RCP_Parameters.nPartsX);
	rProdLength_InY 	:= g_HMI_RCP_Parameters.rProdLength_InY;

	IF	(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1_Clamp)		(* V04.01 *)
	THEN
		IF g_HMI_RCP_Parameters.rSizeTrimFront <= 0
		THEN
			rSizeTrimRear 	:= 0;
			//rSizeTrimRear 	:= MAX(rMinimumSlabTrimSize, g_HMI_RCP_Parameters.rSizeTrimFront); sept 2016
		ELSE
			rSizeTrimRear 	:= MAX(rMinimumSlabTrimSize, g_HMI_RCP_Parameters.rSizeTrimFront);
		END_IF
		IF g_HMI_RCP_Parameters.rSizeTrimRear<= 0			(* Omgedraaid vanaf HMI Instellingen*)
		THEN
			rSizeTrimFront	:= 0;
		ELSE
			rSizeTrimFront 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimRear);(*Omgedraaid vanaf HMI INstellingen*)
		END_IF
		rSizeTrimRight 	:= MAX(rMinimumSlabTrimSize, g_HMI_RCP_Parameters.rSizeTrimRight);
		rSizeTrimLeft 	:= MAX(rMinimumSlabTrimSize, g_HMI_RCP_Parameters.rSizeTrimLeft);
		//rSizeTrimLeft 		:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimLeft); sept 2016

		(*Additional safety checks for slab with fingers *)
		(*rMaxSlabSize := rProdLength_InX - (rMinimumSlabTrimSize);
		IF			rMaxSlabSize >= (g_HMI_MCH_Parameters.rSizeOfKnife)											(* Fixed mes past in de slab tussen de vingers *)
		THEN
			rMinSlabSize					:= rProdLength_InX - (rSizeTrimRight + rSizeTrimLeft);
			IF rMinSlabSize < rSizeOfKnife THEN
				rSizeTrimRight	:= rSizeTrimRight - (rSizeOfKnife - rMinSlabSize);
				rSizeTrimRight 	:= MAX(rMinimumSlabTrimSize, rSizeTrimRight);								(* Check if new calculated trim is >= MinimumTrim *)
				rSizeTrimLeft		:= rProdLength_InX - rSizeOfKnife - rSizeTrimRight;
			END_IF
		ELSE																											(* Fixed mes past NIET in het blik *)
			g_sMACH.ERR.bSlabTooSmall := TRUE;
			RETURN;
		END_IF*)
	ELSE
		rSizeTrimRear 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimFront);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		rSizeTrimFront 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimRear); (*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		rSizeTrimRight 	:= g_HMI_RCP_Parameters.rSizeTrimRight;
		rSizeTrimLeft 	:= g_HMI_RCP_Parameters.rSizeTrimLeft;
	END_IF

	g_rDistanceBetweenCuts_InY:=	(rProdLength_InY - rSizeTrimRear - rSizeTrimFront) / INT_TO_REAL(g_HMI_RCP_Parameters.nPartsY);

	(* Determine number of lines *)
	IF g_bTrimRear AND g_bTrimFront
	THEN
		nNrOfLines	:= g_HMI_RCP_Parameters.nPartsY + 1;
	ELSIF g_bTrimRear AND NOT g_bTrimFront
	THEN
		nNrOfLines	:= g_HMI_RCP_Parameters.nPartsY;
	ELSIF NOT g_bTrimRear AND g_bTrimFront
	THEN
		nNrOfLines	:= g_HMI_RCP_Parameters.nPartsY;
	ELSIF NOT g_bTrimRear AND NOT g_bTrimFront
	THEN
		nNrOfLines	:= g_HMI_RCP_Parameters.nPartsY - 1;
	END_IF
	
	IF	(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1_Clamp)		(* V04.01 *)
	THEN	
		overshootSettings.MarginXMin := FirstPoint.X + rSizeTrimRight;
		overshootSettings.MarginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);
		overshootSettings.MarginYMin := FirstPoint.Y + rSizeTrimRear;
		overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);
	ELSE
		overshootSettings.MarginXMin := C_rMinOvershootX;
		overshootSettings.MarginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);
		overshootSettings.MarginYMin := C_rMinOvershootY;
		overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);
	END_IF

	overshootSettings.adjustXMax := TRUE;
	overshootSettings.adjustXMin := NOT (g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1_Clamp);
	overshootSettings.adjustYMax := TRUE;	
	overshootSettings.adjustYMin := NOT (g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1_Clamp);
	

	IF nNrOfLines > 0 THEN
		(* Calculate number of cuts on the line *)
		(*rLengthOfLine := g_HMI_RCP_Parameters.rProdLength_InX - rSizeTrimRight - rSizeTrimLeft;*)
		rLengthOfLine := g_HMI_RCP_Parameters.rProdLength_InX - rSizeTrimRight - rSizeTrimLeft + (g_HMI_RCP_Parameters.nPartsX * rIcedOffset); (*AC 28-11-12: Deze richting wordt als tweede gesneden en de plak langer geworden.*)
		IF rLengthOfLine > rSizeOfKnife
		THEN
			nNumberOfCutsPerLine := TRUNC_INT(rLengthOfLine / rSizeOfKnife);
			IF nNumberOfCutsPerLine < (rLengthOfLine / rSizeOfKnife)
			THEN
				nNumberOfCutsPerLine := nNumberOfCutsPerLine + 1;
			END_IF
			rMmPerCut := (rLengthOfLine - rSizeOfKnife)/(nNumberOfCutsPerLine -1);
		ELSE
			nNumberOfCutsPerLine := 1;
		END_IF

		(* Calculate positions on first line *)
		IF g_bTrimRear
		THEN
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + rCenterPointKnife,           
								I_rY:=							(rFirstYPosition := FirstPoint.Y + rSizeTrimRear),
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			ELSE
				FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + (nCnt_pos - 1) * rMmPerCut
																					 + rCenterPointKnife,           
									I_rY:=							(rFirstYPosition := FirstPoint.Y + rSizeTrimRear),
									I_rA:=							0,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
					
					
				END_FOR
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rProdLength_InX - rSizeTrimLeft - rCenterPointKnifeInverted,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear,
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			END_IF
		ELSE (* No waste strip at the left *)
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + rCenterPointKnife,           
								I_rY:=							(rFirstYPosition := FirstPoint.Y + rSizeTrimRear + g_rDistanceBetweenCuts_InY),
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					FALSE,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			ELSE
				FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + (nCnt_pos - 1) * rMmPerCut
																					 + rCenterPointKnife,           
									I_rY:=							(rFirstYPosition := FirstPoint.Y + rSizeTrimRear + g_rDistanceBetweenCuts_InY),
									I_rA:=							0,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
					
					
				END_FOR
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rProdLength_InX - rSizeTrimLeft - rCenterPointKnifeInverted,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + g_rDistanceBetweenCuts_InY,
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					FALSE,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			END_IF
		END_IF

		(* Fill in all other positions on the rest of the lines *)

		FOR nCnt_line := 2 TO (nNrOfLines) BY 1 DO
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + rCenterPointKnife,           
								I_rY:=							rFirstYPosition + (nCnt_line-1) * (g_rDistanceBetweenCuts_InY + rIcedOffset),
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			ELSE
				IF bToggle (* from front to rear *)
				THEN
					FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
						IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + rCenterPointKnife
																                                                   + (nCnt_pos - 1) * rMmPerCut ,           
										I_rY:=							rFirstYPosition + (nCnt_line-1) * (g_rDistanceBetweenCuts_InY + rIcedOffset),
										I_rA:=							0,
										I_rK:=							0,
										I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
										I_sOvershootSettings := 		overshootSettings)
						THEN 
														RETURN;
						END_IF  
						
						
					END_FOR
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rProdLength_InX - rSizeTrimLeft - rCenterPointKnifeInverted,           
									I_rY:=							rFirstYPosition + (nCnt_line-1) * (g_rDistanceBetweenCuts_InY + rIcedOffset),
									I_rA:=							0,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
					
					
				ELSE (* toggle, ie from rear to front *)
					FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
						IF NOT StorePos(I_rX:= 							FirstPoint.X + rProdLength_InX - rSizeTrimLeft - rCenterPointKnifeInverted
																							- (nCnt_pos -1) * rMmPerCut,           
										I_rY:=							rFirstYPosition + (nCnt_line-1) * (g_rDistanceBetweenCuts_InY + rIcedOffset),
										I_rA:=							0,
										I_rK:=							0,
										I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
										I_sOvershootSettings := 		overshootSettings)
						THEN 
														RETURN;
						END_IF  
						
						
					END_FOR
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + rCenterPointKnife,           
									I_rY:=							rFirstYPosition + (nCnt_line-1) * (g_rDistanceBetweenCuts_InY + rIcedOffset),
									I_rA:=							0,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
					
					
				END_IF
				bToggle := NOT bToggle;
			END_IF
		END_FOR

		(* Schuiven Uitbreiding AC *)
		(*Alle ingevulde posities controleren of Y gelijk is aan uiterste Y*)
		(*Indien ja: set bPushAwayProduct en corresponderende distance.*)
		IF g_bTrimFront THEN
			rLast_Y_Pos := rFirstYPosition + (nNrOfLines-1) * g_rDistanceBetweenCuts_InY;

			FOR nCnt_Push := nFirstPosFirstTray TO g_sCuttingPositionsInfo.index -1 DO
				IF rLast_Y_Pos = g_aCuttingPositions[nCnt_Push].Y_Target THEN
					g_aCuttingPositions[nCnt_Push].bPushAwayProduct := FALSE;
					g_aCuttingPositions[nCnt_Push].rPushAwayDistance := 0;
				END_IF
			END_FOR
		END_IF
	END_IF

(**********************************************************************************************************************************
* Slab Triangle
**********************************************************************************************************************************)
ELSIF 	(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Triangle_1x1) (*Horizontale component van nieuwe driehoeken*)
THEN

	rSizeOfKnife				:= g_HMI_MCH_Parameters.rSizeOfKnife;
	rCenterPointKnife			:= rSizeOfKnife/2;;
	rCenterPointKnifeInverted	:= rSizeOfKnife/2;;

	rProdLength_InY	:= g_HMI_RCP_Parameters.rProdLength_InY - MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear) - MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront);
	rProdLength_InX	:= g_HMI_RCP_Parameters.rProdLength_InX - MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) - MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft);

	(* Offset of slab *)
	FirstPoint.X	:= g_HMI_MCH_Parameters.rStartPointSlab_X;
	FirstPoint.Y	:= g_HMI_MCH_Parameters.rStartPointSlab_Y;

	rSizeTrimRear 	:= 	g_HMI_RCP_Parameters.rSizeTrimFront; (*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	rSizeTrimFront 	:= g_HMI_RCP_Parameters.rSizeTrimRear;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	rSizeTrimRight 	:= g_HMI_RCP_Parameters.rSizeTrimRight;
	rSizeTrimLeft 	:= g_HMI_RCP_Parameters.rSizeTrimLeft;

	(*g_rDistanceBetweenCuts_InY:=	(g_HMI_RCP_Parameters.rProdLength_InY - rSizeTrimRear - rSizeTrimFront) / INT_TO_REAL(g_HMI_RCP_Parameters.nPartsY);*)
	g_rDistanceBetweenCuts_InY	:= g_HMI_RCP_Parameters.rPartSizeY;
	g_sMACH.ERR.bPieceTooLarge := (rProdLength_InY < g_rDistanceBetweenCuts_InY) OR (rProdLength_InX < g_HMI_RCP_Parameters.rPartSizeX);

	(* Determine number of lines *)
	rNrOfLines	:=	(rProdLength_InY / g_rDistanceBetweenCuts_InY) - 1;
	nNrOfLines	:=	TRUNC_INT(rNrOfLines);
	IF	nNrOfLines < rNrOfLines	(* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
	THEN
		rWasteExtra := (rProdLength_InY - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InY))/2;
		rSizeTrimRear	 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront) + rWasteExtra;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		rSizeTrimFront 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear) + rWasteExtra;
		g_bTrimRear		:= TRUE;
		g_bTrimFront		:= TRUE;
		nNrOfLines		:= nNrOfLines + 2;
	ELSE
		rSizeTrimRear	 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimFront);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		rSizeTrimFront 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimRear);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	END_IF
	(* Uitrekenen front en rear afvalrand *)
	rNrOfLines	:= (rProdLength_InX / g_rDistanceBetweenCuts_InX) - 1;
	nNrOfLines	:= TRUNC_INT(rNrOfLines);
	IF	nNrOfLines < rNrOfLines	(* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
	THEN
		rWasteExtra := (rProdLength_InX - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InX))/2;
		rSizeTrimRight 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) + rWasteExtra;
		rSizeTrimLeft 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft) + rWasteExtra;
	ELSE
		rSizeTrimRight 	:= g_HMI_RCP_Parameters.rSizeTrimRight ;
		rSizeTrimLeft 	:= g_HMI_RCP_Parameters.rSizeTrimLeft;
	END_IF
	(* Determine number of lines *)
	rNrOfLines	:= (rProdLength_InY / g_rDistanceBetweenCuts_InY) - 1;
	nNrOfLines	:=	TRUNC_INT(rNrOfLines) + BOOL_TO_INT(rSizeTrimRear > 0) + BOOL_TO_INT(rSizeTrimFront > 0);

	overshootSettings.MarginXMin	:= C_rMinOvershootX;		(* Mechanical boundary *)
	overshootSettings.MarginXMax	:= SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);	(* Mechanical boundary *)
	overshootSettings.MarginYMin	:= C_rMinOvershootY;		(* Mechanical boundary *)
	overshootSettings.MarginYMax	:= SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);		(* Mechanical boundary *)
	
	overshootSettings.adjustXMax := TRUE;
	overshootSettings.adjustXMin := TRUE;
	overshootSettings.adjustYMax := TRUE;
	overshootSettings.adjustYMin := TRUE;
	 
	(* Determine number of lines *)
	IF nNrOfLines > 0 THEN
		(* Calculate number of cuts on the line *)
		rLengthOfLine := g_HMI_RCP_Parameters.rProdLength_InX - rSizeTrimRight - rSizeTrimLeft;
		IF rLengthOfLine > rSizeOfKnife
		THEN
			nNumberOfCutsPerLine := TRUNC_INT(rLengthOfLine / rSizeOfKnife);
			IF nNumberOfCutsPerLine < (rLengthOfLine / rSizeOfKnife)
			THEN
				nNumberOfCutsPerLine := nNumberOfCutsPerLine + 1;
			END_IF
			rMmPerCut := (rLengthOfLine - rSizeOfKnife)/(nNumberOfCutsPerLine -1);
		ELSE
			nNumberOfCutsPerLine := 1;
		END_IF

		(* Calculate positions on first line *)
		IF g_bTrimRear
		THEN
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + rCenterPointKnife,           
								I_rY:=							(rFirstYPosition := FirstPoint.Y + rSizeTrimRear),
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			ELSE
				FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + (nCnt_pos - 1) * rMmPerCut
																					 + rCenterPointKnife,           
									I_rY:=							(rFirstYPosition := FirstPoint.Y + rSizeTrimRear),
									I_rA:=							0,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
					
					
				END_FOR
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rProdLength_InX - rSizeTrimLeft - rCenterPointKnifeInverted,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear,
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				

			END_IF
		ELSE (* No waste strip at the left *)
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + rCenterPointKnife,           
								I_rY:=							(rFirstYPosition := FirstPoint.Y + rSizeTrimRear + g_rDistanceBetweenCuts_InY),
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					FALSE,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			ELSE
				FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + (nCnt_pos - 1) * rMmPerCut
																					 + rCenterPointKnife,           
									I_rY:=							(rFirstYPosition := FirstPoint.Y + rSizeTrimRear + g_rDistanceBetweenCuts_InY),
									I_rA:=							0,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
					
					
				END_FOR
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rProdLength_InX - rSizeTrimLeft - rCenterPointKnifeInverted,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + g_rDistanceBetweenCuts_InY,
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					FALSE,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			END_IF
		END_IF

		(* Fill in all other positions on the rest of the lines *)

		FOR nCnt_line := 2 TO (nNrOfLines) BY 1 DO
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + rCenterPointKnife,           
								I_rY:=							rFirstYPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InY,
								I_rA:=							0,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			ELSE
				IF bToggle (* from front to rear *)
				THEN
					FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
						IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + rCenterPointKnife
																                                                   + (nCnt_pos - 1) * rMmPerCut ,           
										I_rY:=							rFirstYPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InY,
										I_rA:=							0,
										I_rK:=							0,
										I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
										I_sOvershootSettings := 		overshootSettings)
						THEN 
														RETURN;
						END_IF  
						
						
					END_FOR
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rProdLength_InX - rSizeTrimLeft - rCenterPointKnifeInverted,           
									I_rY:=							rFirstYPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InY,
									I_rA:=							0,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
					
					
				ELSE (* toggle, ie from rear to front *)
					FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
						IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rProdLength_InX - rSizeTrimLeft - rCenterPointKnifeInverted
																							- (nCnt_pos -1) * rMmPerCut,           
										I_rY:=							rFirstYPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InY,
										I_rA:=							0,
										I_rK:=							0,
										I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
										I_sOvershootSettings := 		overshootSettings)
						THEN 
														RETURN;
						END_IF  
						
						
					END_FOR
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + rCenterPointKnife,           
									I_rY:=							rFirstYPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InY,
									I_rA:=							0,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimFront AND nCnt_Line = nNrOfLines) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
					
					
				END_IF
				bToggle := NOT bToggle;
			END_IF
		END_FOR

		(* Schuiven Uitbreiding AC *)
		(*Alle ingevulde posities controleren of Y gelijk is aan uiterste Y*)
		(*Indien ja: set bPushAwayProduct en corresponderende distance.*)
		IF g_bTrimFront THEN
			rLast_Y_Pos := rFirstYPosition + (nNrOfLines-1) * g_rDistanceBetweenCuts_InY;

			FOR nCnt_Push := nFirstPosFirstTray TO g_sCuttingPositionsInfo.index -1 DO
				IF rLast_Y_Pos = g_aCuttingPositions[nCnt_Push].Y_Target THEN
					g_aCuttingPositions[nCnt_Push].bPushAwayProduct := FALSE;
					g_aCuttingPositions[nCnt_Push].rPushAwayDistance := 0;
				END_IF
			END_FOR
		END_IF
	END_IF
(************************************************************************************************************
* Trays in triangle AC: 23-10-2012 -> EQUALS NORMAL SQUARE TRAY
****************************************************************************************************************)
END_IF

Calc_Hor := TRUE;

END_FUNCTION
