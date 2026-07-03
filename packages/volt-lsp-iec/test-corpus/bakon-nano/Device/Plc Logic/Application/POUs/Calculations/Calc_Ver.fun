FUNCTION Calc_Ver : BOOL
VAR
	bToggle	: BOOL;
	nNrOfLines: INT;
	rLengthOfLine: REAL;
	nNumberOfCutsPerLine: INT;
	nCnt_line: INT;
	nCnt_pos: INT;
	//nFirstPos: INT;
	//nFirstWastePos : INT;
	
	nFirstPosFirstTray 		:INT;
	nFirstWastePosFirstTray :int;
	
	rSizeTrimRear	:REAL;
	rSizeTrimFront	:REAL;
	rSizeTrimRight	:REAL;
	rSizeTrimLeft	:REAL;
	rMaxTraySize		:REAL;
	rMinTraySize		:REAL;
	//CorrectOvershootVer1a	:CorrectOvershootVer;
	//CorrectOvershootVer1b	:CorrectOvershootVer;
	//CorrectOvershootVer2	:CorrectOvershootVer;
	//CorrectOvershootVer3	:CorrectOvershootVer;
	//CorrectOvershootVer4	:CorrectOvershootVer;
	//CorrectOvershootVer5	:CorrectOvershootVer;
	//CorrectOvershootVer6	:CorrectOvershootVer;
	//CorrectOvershootVer7	:CorrectOvershootVer;
	//CorrectOvershootVer8	:CorrectOvershootVer;
	//CorrectOvershootVer9	:CorrectOvershootVer;
	rProdLength_InY: REAL;
	rProdLength_InX: REAL;
	rMmPerCut: REAL;
	rCenterPointKnifeInverted: REAL;
	rSizeOfKnife: REAL;
	rMinimumTrayTrimSize: REAL;
	//FirstPoint.Y: REAL;
	bCutsAtEdgeFirst: BOOL;
	rNrOfLines : REAL;
	rWasteExtra :REAL;
	rIcedOffset	:REAL;
	nPartsX: INT;
	
	FirstPoint					: Gonio_Point;
	CopyPoint					: Gonio_Point;

	rCenterPointKnife: REAL;
	rMinimumSlabTrimSize: REAL;
	rFirstXPosition : REAL;
	overshootSettings 			: Gonio_Settings;
	nLastPosFirstTray		: INT;
	nLastWastePosFirstTray	: INT;
	
END_VAR

(* Calc_Ver, Positions when knife vertical (= 90 degrees = loodrecht op bediener) *)

(************************************************************************************************************************************
 * HISTORY																					 
 ************************************************************************************************************************************
 * Update 		: 0.1																			  
 * Author 		: K. Kole																			   Prod_Tray_Rectangle_1x2
 * Changes	: Tray square, 	calculation for rSizeTrimRight and rSizeTrimLeft changed
 ************************************************************************************************************************************)
Calc_Ver:=FALSE;

bToggle	:= FALSE;
//nFirstPos := g_nPos;
//nFirstWastePos := g_nWastePos;

nFirstPosFirstTray 				:= g_sCuttingPositionsInfo.index;
nFirstWastePosFirstTray 		:= g_sWastePositionsInfo.index;

rSizeOfKnife					:= g_HMI_MCH_Parameters.rSizeOfKnife;
rCenterPointKnife				:= rSizeOfKnife/2;
rCenterPointKnifeInverted	:= rSizeOfKnife/2;

overshootSettings.knifeAxis		:= rCenterPointKnife;
overshootSettings.knifeLength	:= rSizeOfKnife;
overshootSettings.precision		:= 0.1;

bCutsAtEdgeFirst	:= FALSE;		(* Hard coded, can become a machine or recipe parameter *)

(**********************************************************************************************************************************)
(* If Tray square *)
(**********************************************************************************************************************************)
IF		(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x1
	OR	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2
	OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4
	OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1)
	AND NOT (g_HMI_RCP_Parameters.bTrianglesInTray AND NOT g_HMI_RCP_Parameters.bUseRectanglesForTriangles AND NOT g_HMI_RCP_Parameters.bUseRectanglesInEight) (*Dus wel als er driehoeken uit vierkanten gesneden moeten worden*)
THEN

	(* Determine type of tray *)
	IF g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x1
	THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayLarge_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayLarge_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTrayLarge;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTrayLarge_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayLarge_Y;
	ELSIF g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2
	THEN
		rProdLength_InY := g_HMI_MCH_Parameters.rProdLengthTraySmall_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTraySmall_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTraySmall;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTraySmall_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTraySmall1_Y;	(* Startpoint for first small tray *)
	ELSIF	(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4)
	THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayTriple_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayTriple_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTrayTriple;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTrayTriple_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple1_Y;	(* Startpoint for first small tray *)
	ELSIF	(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1)
	THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayDouble_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayDouble_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTrayDouble;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTrayDouble1_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayDouble_Y;	(* Startpoint for first small tray *)
	END_IF

	
	IF g_HMI_RCP_Parameters.bTrianglesInTray AND g_HMI_RCP_Parameters.bUseRectanglesInEight THEN (*AC 04-07-2013: Uitbreiding 8 driehoeken uit stuk*)
		nPartsX := g_HMI_RCP_Parameters.nPartsX * 2;
	ELSE
		nPartsX := g_HMI_RCP_Parameters.nPartsX;
	END_IF


	rSizeTrimRear 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimFront);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	rSizeTrimFront 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimRear);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	IF g_HMI_RCP_Parameters.rSizeTrimRight <= 0
	THEN
		rSizeTrimRight	:= 0;
	ELSE
		rSizeTrimRight 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimRight);
	END_IF
	IF g_HMI_RCP_Parameters.rSizeTrimLeft <= 0
	THEN
		rSizeTrimLeft	:= 0;
	ELSE
		rSizeTrimLeft 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimLeft);
	END_IF

	(*Additional safety checks for trays*)
	rMaxTraySize := rProdLength_InY - (rMinimumTrayTrimSize * 2);
	IF rMaxTraySize < rSizeOfKnife THEN
		g_sMACH.ERR.bTrayTooSmall := TRUE;
		RETURN;
	END_IF
	rMinTraySize := rProdLength_InY - (rSizeTrimRear + rSizeTrimFront);
	IF rMinTraySize < rSizeOfKnife THEN
		rSizeTrimRear := rSizeTrimRear - (rSizeOfKnife - rMinTraySize);
		rSizeTrimRear := MAX(rMinimumTrayTrimSize, rSizeTrimRear);
		rSizeTrimFront := rProdLength_InY - rSizeOfKnife - rSizeTrimRear;
	END_IF

	g_rDistanceBetweenCuts_InX:=	(rProdLength_InX - rSizeTrimRight - rSizeTrimLeft) / INT_TO_REAL(nPartsX); (*g_HMI_RCP_Parameters.nPartsX);*)(*AC 4-7-2013*)

	(* Determine number of lines *)
	IF g_bTrimRight AND g_bTrimLeft
	THEN
		nNrOfLines	:= 1 + nPartsX; (*g_HMI_RCP_Parameters.nPartsX);*)(*AC 4-7-2013*)
	ELSIF g_bTrimRight AND NOT g_bTrimLeft
	THEN
		nNrOfLines	:= nPartsX; (*g_HMI_RCP_Parameters.nPartsX);*)(*AC 4-7-2013*)
	ELSIF NOT g_bTrimRight AND g_bTrimLeft
	THEN
		nNrOfLines	:= nPartsX; (*g_HMI_RCP_Parameters.nPartsX);*)(*AC 4-7-2013*)
	ELSIF NOT g_bTrimRight AND NOT g_bTrimLeft
	THEN
		nNrOfLines	:= nPartsX - 1; (*g_HMI_RCP_Parameters.nPartsX);*)(*AC 4-7-2013*)
	END_IF

	(* Calculate number of cuts on the line *)
	rLengthOfLine := rProdLength_InY - rSizeTrimRear - rSizeTrimFront;
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
	overshootSettings.MarginXMin := FirstPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
	overshootSettings.MarginXMax := FirstPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
	overshootSettings.MarginYMin := FirstPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
	overshootSettings.MarginYMax := FirstPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);
	overshootSettings.adjustYMax := FALSE;	
	overshootSettings.adjustYMin := false;
	overshootSettings.adjustXMax := false;
	overshootSettings.adjustXMin := false;
	
	IF g_bTrimRight
	THEN
		IF nNumberOfCutsPerLine = 1
		THEN

			IF NOT StorePos(I_rX:= 		(rFirstXPosition := FirstPoint.X + rSizeTrimRight),           
							I_rY:=			FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
							I_rA:=			90,
							I_rK:=			0,
							I_bIsWaste :=	 (g_HMI_RCP_Parameters.bCutWasteFirst),
							I_sOvershootSettings := overshootSettings )
			THEN 
								RETURN;
			END_IF 

		ELSE
			(* First position on the line *)
			
			IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight),           
							I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
							I_rA:=							90,
							I_rK:=							0,
							I_bIsWaste :=	 				(g_HMI_RCP_Parameters.bCutWasteFirst),
							I_sOvershootSettings := 		overshootSettings )
			THEN 
								RETURN;
			END_IF 
			

			IF bCutsAtEdgeFirst		(* If cuts at the edge first *)
			THEN
			
			
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				

				
			END_IF
			FOR nCnt_pos:=2 TO (nNumberOfCutsPerLine - 1) DO
				
			
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife
																	+ (nCnt_pos-1) * rMmPerCut,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
			END_FOR
			IF NOT bCutsAtEdgeFirst		(* If not cuts at the edge first *)
			THEN
				(* Last position on the line *)
				
				
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
				
			END_IF
		END_IF
	ELSE (* No waste strip at the front *)
		IF nNrOfLines > 0	(* New 8 feb 2010: when only one piece and no trims *)
		THEN
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX),           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					FALSE,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  

			ELSE
				(* First position on the line *)
				IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX),           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					FALSE,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				
			
				IF bCutsAtEdgeFirst		(* If cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y - rSizeTrimFront + rProdLength_InY - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_IF 
				FOR nCnt_pos:=2 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + (nCnt_pos -1) * rMmPerCut
																					 + rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_FOR
				IF NOT bCutsAtEdgeFirst		(* If not cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y - rSizeTrimFront + rProdLength_InY - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_IF
			END_IF
		END_IF
	END_IF

	(* Fill in all other positions on the rest of the lines *)
	FOR nCnt_line := 2 TO (nNrOfLines) BY 1 DO
		IF nNumberOfCutsPerLine = 1
		THEN
			IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
							I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
							I_rA:=							90,
							I_rK:=							0,
							I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
							I_sOvershootSettings := 		overshootSettings)
			THEN 
								RETURN;
			END_IF  
		ELSE
			IF bToggle (* from left to right *)
			THEN
				(* First position on the line *)
				IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					(g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst),
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				IF bCutsAtEdgeFirst		(* If cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  			
				END_IF
				FOR nCnt_pos:=2 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear
														                             + (nCnt_pos - 1) * rMmPerCut + rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_FOR
				IF NOT bCutsAtEdgeFirst		(* If not cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
									
				END_IF
			ELSE (* toggle, ie from right to left *)
				(* First position on the line *)
				IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
								I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			
				IF bCutsAtEdgeFirst		(* If cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_IF
				FOR nCnt_pos:=2 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront
																						- (nCnt_pos -1) * rMmPerCut - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
										
				END_FOR
				IF NOT bCutsAtEdgeFirst		(* If not cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  

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
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);

		IF nFirstPosFirstTray <= nLastPosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstPosFirstTray,
				I_lastIndex					:= nLastPosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aCuttingPositions),
				I_bReverseOrder				:= TRUE,
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
				I_bReverseOrder				:= TRUE,
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
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);
	
		IF nFirstPosFirstTray <= nLastPosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstPosFirstTray,
				I_lastIndex					:= nLastPosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aCuttingPositions),
				I_bReverseOrder				:= TRUE,
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
				I_bReverseOrder				:= TRUE,
				IQ_dataArrayInfo 			:= g_sWastePositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
		

		(*Third tray*)
		
		CopyPoint.X := FirstPoint.X;
		CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple3_Y;
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);
		
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
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);
		
		IF nFirstPosFirstTray <= nLastPosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstPosFirstTray,
				I_lastIndex					:= nLastPosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aCuttingPositions),
				I_bReverseOrder				:= TRUE,
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
				I_bReverseOrder				:= TRUE,
				IQ_dataArrayInfo 			:= g_sWastePositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
	END_IF

	(* 2x positions the positions for the second tray if double trays side by side *)
	IF	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1
	THEN
		
		CopyPoint.X := g_HMI_MCH_Parameters.rStartPointTrayDouble2_X;
		CopyPoint.Y :=  FirstPoint.Y;
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);
		
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
	END_IF
(**********************************************************************************************************************************)
(*Slab square quadriple*)
(**********************************************************************************************************************************)
ELSIF		(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_2x1)
THEN

	(* Determine type of tray *)
	rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthSlabDouble_InY;
	rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthSlabDouble_InX;
	rMinimumTrayTrimSize :=	0;
	FirstPoint.X := g_HMI_MCH_Parameters.rStartPointSlabDouble1_X;
	FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointSlabDouble_Y;

	rSizeTrimRear 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimFront);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	rSizeTrimFront 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimRear);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	IF g_HMI_RCP_Parameters.rSizeTrimRight <= 0
	THEN
		rSizeTrimRight	:= 0;
	ELSE
		rSizeTrimRight 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimRight);
	END_IF
	IF g_HMI_RCP_Parameters.rSizeTrimLeft <= 0
	THEN
		rSizeTrimLeft	:= 0;
	ELSE
		rSizeTrimLeft 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimLeft);
	END_IF


	nPartsX := g_HMI_RCP_Parameters.nPartsX;

	(*Additional safety checks for trays*)
	rMaxTraySize := rProdLength_InY - (rMinimumTrayTrimSize * 2);

	g_rDistanceBetweenCuts_InX:=	(rProdLength_InX - rSizeTrimRight - rSizeTrimLeft) / INT_TO_REAL(nPartsX); (*g_HMI_RCP_Parameters.nPartsX);*)(*AC 4-7-2013*)

	(* Determine number of lines *)
	IF g_bTrimRight AND g_bTrimLeft
	THEN
		nNrOfLines	:= 1 + nPartsX; (*g_HMI_RCP_Parameters.nPartsX);*)(*AC 4-7-2013*)
	ELSIF g_bTrimRight AND NOT g_bTrimLeft
	THEN
		nNrOfLines	:= nPartsX; (*g_HMI_RCP_Parameters.nPartsX);*)(*AC 4-7-2013*)
	ELSIF NOT g_bTrimRight AND g_bTrimLeft
	THEN
		nNrOfLines	:= nPartsX; (*g_HMI_RCP_Parameters.nPartsX);*)(*AC 4-7-2013*)
	ELSIF NOT g_bTrimRight AND NOT g_bTrimLeft
	THEN
		nNrOfLines	:= nPartsX - 1; (*g_HMI_RCP_Parameters.nPartsX);*)(*AC 4-7-2013*)
	END_IF

	(* Calculate number of cuts on the line *)
	rLengthOfLine := rProdLength_InY - rSizeTrimRear - rSizeTrimFront;
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

	//this is the right most slab, therefore the max X margin is inbetween the two slabs.
	overshootSettings.MarginXMin := C_rMinOvershootX;
	overshootSettings.MarginXMax := FirstPoint.X + rProdLength_InX  + (g_HMI_MCH_Parameters.rStartPointSlabDouble2_X - g_HMI_MCH_Parameters.rStartPointSlabDouble1_X - rProdLength_InX)/2;
	overshootSettings.MarginYMin := C_rMinOvershootY;
	overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);

	overshootSettings.adjustYMax := TRUE;	
	overshootSettings.adjustYMin := TRUE;
	overshootSettings.adjustXMax := false;
	overshootSettings.adjustXMin := TRUE;

	
	(* Calculate positions on first line *)
	IF g_bTrimRight
	THEN
		IF nNumberOfCutsPerLine = 1
		THEN
			
			IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight),           
							I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
							I_rA:=							90,
							I_rK:=							0,
							I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
							I_sOvershootSettings := 		overshootSettings)
			THEN 
								RETURN;
			END_IF  
		ELSE
			(* First position on the line *)
			
			IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight),           
							I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
							I_rA:=							90,
							I_rK:=							0,
							I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
							I_sOvershootSettings := 		overshootSettings)
			THEN 
								RETURN;
			END_IF  
			
		
			IF bCutsAtEdgeFirst		(* If cuts at the edge first *)
			THEN
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  				
			END_IF
			FOR nCnt_pos:=2 TO (nNumberOfCutsPerLine - 1) DO
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife
																	+ (nCnt_pos-1) * rMmPerCut,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  				
			END_FOR
			IF NOT bCutsAtEdgeFirst		(* If not cuts at the edge first *)
			THEN
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			END_IF
		END_IF
	ELSE (* No waste strip at the front *)
		IF nNrOfLines > 0	(* New 8 feb 2010: when only one piece and no trims *)
		THEN
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX),           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					FALSE,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			ELSE
				(* First position on the line *)
				IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX),           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					FALSE,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				IF bCutsAtEdgeFirst		(* If cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y - rSizeTrimFront + rProdLength_InY - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_IF
				FOR nCnt_pos:=2 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + (nCnt_pos -1) * rMmPerCut
																					 + rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_FOR
				IF NOT bCutsAtEdgeFirst		(* If not cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y - rSizeTrimFront + rProdLength_InY - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_IF
			END_IF
		END_IF
	END_IF

	(* Fill in all other positions on the rest of the lines *)
	FOR nCnt_line := 2 TO (nNrOfLines) BY 1 DO
		IF nNumberOfCutsPerLine = 1
		THEN
			IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
							I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
							I_rA:=							90,
							I_rK:=							0,
							I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
							I_sOvershootSettings := 		overshootSettings)
			THEN 
								RETURN;
			END_IF  			
		ELSE
			IF bToggle (* from left to right *)
			THEN
				(* First position on the line *)
				IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				IF bCutsAtEdgeFirst		(* If cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_IF
				FOR nCnt_pos:=2 TO (nNumberOfCutsPerLine - 1) DO
					
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear
														                             + (nCnt_pos - 1) * rMmPerCut + rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  			
				END_FOR
				IF NOT bCutsAtEdgeFirst		(* If not cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  

				END_IF
			ELSE (* toggle, ie from right to left *)
				(* First position on the line *)
				
				IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
								I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  	
		
				IF bCutsAtEdgeFirst		(* If cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_IF
				FOR nCnt_pos:=2 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront
																						- (nCnt_pos -1) * rMmPerCut - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_FOR
				IF NOT bCutsAtEdgeFirst		(* If not cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_IF
			END_IF
			bToggle := NOT bToggle;
		END_IF
	END_FOR
	
	
	nLastPosFirstTray		:= g_sCuttingPositionsInfo.index-1;
	nLastWastePosFirstTray	:= g_sWastePositionsInfo.index-1;
	
	(* 2x positions the positions for the second Slab if double slabs side by side *)
	IF	g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_2x1
	THEN
		
		CopyPoint.X := g_HMI_MCH_Parameters.rStartPointSlabDouble2_X;
		CopyPoint.Y := FirstPoint.Y;
	
		overshootSettings.MarginXMin := FirstPoint.X + rProdLength_InX  + (g_HMI_MCH_Parameters.rStartPointSlabDouble2_X - g_HMI_MCH_Parameters.rStartPointSlabDouble1_X - rProdLength_InX)/2;
		overshootSettings.MarginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);
		overshootSettings.MarginYMin := C_rMinOvershootY;
		overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);
	
		overshootSettings.adjustXMax := TRUE;
		overshootSettings.adjustXMin := FALSE;
		overshootSettings.adjustYMax := TRUE;	
		overshootSettings.adjustYMin := TRUE;
	
		IF nFirstPosFirstTray <= nLastPosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstPosFirstTray,
				I_lastIndex					:= nLastPosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,
				I_dataArray 				:= ADR(g_aCuttingPositions),
				I_bReverseOrder				:= TRUE,
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
				I_bReverseOrder				:= TRUE,
				IQ_dataArrayInfo 			:= g_sWastePositionsInfo) 
			THEN
								RETURN;
			END_IF
		END_IF
	END_IF
	
(**********************************************************************************************************************************)
(* Slab square *)
(**********************************************************************************************************************************)
ELSIF		(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1)		(* ProductType = 0 = Slab Square *)
		OR	(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1_Clamp)		(* V04.01 *)
THEN

	IF	(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1) THEN			(* V04.01 *)
		rIcedOffset					:= g_HMI_RCP_Parameters.rShiftCompensation;
		rMinimumSlabTrimSize	:= 0;			(* V04.01 *)
	ELSE
		rIcedOffset					:= g_HMI_RCP_Parameters.rShiftCompensation;
		rMinimumSlabTrimSize	:= g_HMI_MCH_Parameters.rMinimumTrimSizeSlab;		(* V04.01 *)
	END_IF
	rProdLength_InX	:= g_HMI_RCP_Parameters.rProdLength_InX;
	rProdLength_InY 	:= g_HMI_RCP_Parameters.rProdLength_InY;

	IF	(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1_Clamp)		(* V04.01 *)
	THEN
		//g_bTrimRight		:= TRUE; sept 2016
		//g_bTrimLeft 		:= TRUE; sept 2016
		//g_bTrimRear 		:= TRUE; sept 2016
		rSizeTrimRear 	:= MAX(rMinimumSlabTrimSize, g_HMI_RCP_Parameters.rSizeTrimFront);
		rSizeTrimFront 	:= MAX(rMinimumSlabTrimSize, g_HMI_RCP_Parameters.rSizeTrimRear);
		//rSizeTrimFront 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimRear);  sept 2016
		IF g_HMI_RCP_Parameters.rSizeTrimRight <= 0
		THEN
			rSizeTrimRight	:= 0;
			//rSizeTrimRight	:= MAX(rMinimumSlabTrimSize, g_HMI_RCP_Parameters.rSizeTrimRight); sept 2016
		ELSE
			rSizeTrimRight 	:= MAX(rMinimumSlabTrimSize, g_HMI_RCP_Parameters.rSizeTrimRight);
			g_bTrimRight		:= TRUE; // sept 2016
		END_IF
		IF g_HMI_RCP_Parameters.rSizeTrimLeft <= 0
		THEN
			rSizeTrimLeft	:= 0;
		ELSE
			rSizeTrimLeft 	:= MAX(rMinimumSlabTrimSize, g_HMI_RCP_Parameters.rSizeTrimLeft);
			g_bTrimLeft		:= TRUE; // sept 2016
			//rSizeTrimLeft 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimLeft);  sept 2016
		END_IF

		(*Additional safety checks for slabs at tabel with fingers*)
	(*	rMaxSlabSize := rProdLength_InY - (rMinimumSlabTrimSize);
		IF rMaxSlabSize < rSizeOfKnife THEN
			g_sMACH.ERR.bSlabTooSmall := TRUE;
			RETURN;
		END_IF
		rMinSlabSize := rProdLength_InY - (rSizeTrimRear + rSizeTrimFront);
		IF rMinSlabSize < rSizeOfKnife THEN
			rSizeTrimRear := rSizeTrimRear - (rSizeOfKnife - rMinSlabSize);
			rSizeTrimRear := MAX(rMinimumSlabTrimSize, rSizeTrimRear);
			rSizeTrimFront := rProdLength_InY - rSizeOfKnife - rSizeTrimRear;
		END_IF *)

	ELSE
		rSizeTrimRear 	:= g_HMI_RCP_Parameters.rSizeTrimFront;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		rSizeTrimFront 	:= g_HMI_RCP_Parameters.rSizeTrimRear;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		rSizeTrimRight 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimRight);
		rSizeTrimLeft 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimLeft);
	END_IF

	g_rDistanceBetweenCuts_InX:=	(rProdLength_InX - rSizeTrimRight - rSizeTrimLeft) / INT_TO_REAL(g_HMI_RCP_Parameters.nPartsX);

	(* Offset of slab *)
	FirstPoint.X	:= g_HMI_MCH_Parameters.rStartPointSlab_X;
	FirstPoint.Y	:= g_HMI_MCH_Parameters.rStartPointSlab_Y;

	(* Determine number of lines *)
	IF g_bTrimRight AND g_bTrimLeft
	THEN
		nNrOfLines	:= g_HMI_RCP_Parameters.nPartsX + 1;
	ELSIF g_bTrimRight AND NOT g_bTrimLeft
	THEN
		nNrOfLines	:= g_HMI_RCP_Parameters.nPartsX;
	ELSIF NOT g_bTrimRight AND g_bTrimLeft
	THEN
		nNrOfLines	:= g_HMI_RCP_Parameters.nPartsX;
	ELSIF NOT g_bTrimRight AND NOT g_bTrimLeft
	THEN
		nNrOfLines	:= g_HMI_RCP_Parameters.nPartsX - 1;
	END_IF

	(* Calculate number of cuts on the line *)
	rLengthOfLine := g_HMI_RCP_Parameters.rProdLength_InY - rSizeTrimRear - rSizeTrimFront;(* + (nNrOfLines * rIcedOffset);*)(*AC 28-11-12: Deze richting wordt als eerste gesneden en de plak heeft dus nog de originele lengte.*)
	(* rLengthOfLine := rLengthOfLine + g_HMI_RCP_Parameters.nPartsY * g_HMI_RCP_Parameters.rShiftCompensation; *)

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
	

	IF nNrOfLines > 0
	THEN
		(* Calculate positions on first line *)
		
		
		IF g_bTrimRight
		THEN
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight),           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + (rLengthOfLine/2),
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  				
			ELSE
				FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
					
					IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight),           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife
																			+ (nCnt_pos-1) * rMmPerCut,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_FOR
				
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  

			END_IF
		ELSE (* No waste strip right *)
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX),           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + (rLengthOfLine/2),
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					FALSE,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			ELSE
				FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX),           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + (nCnt_pos -1) * rMmPerCut
																					 + rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_FOR
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX,           
								I_rY:=							FirstPoint.Y - rSizeTrimFront + rProdLength_InY - rCenterPointKnifeInverted,
								I_rA:=							90,
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
				IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * (g_rDistanceBetweenCuts_InX + rIcedOffset),           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + (rLengthOfLine/2),
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			ELSE
				IF bToggle (* from left to right *)
				THEN
					FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
						IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * (g_rDistanceBetweenCuts_InX + rIcedOffset),           
										I_rY:=							FirstPoint.Y + rSizeTrimRear
																                             + (nCnt_pos - 1) * rMmPerCut + rCenterPointKnife,
										I_rA:=							90,
										I_rK:=							0,
										I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
										I_sOvershootSettings := 		overshootSettings)
						THEN 
														RETURN;
						END_IF  
					END_FOR
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * (g_rDistanceBetweenCuts_InX + rIcedOffset),           
									I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				ELSE (* toggle, ie from right to left *)
					FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
						
						IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * (g_rDistanceBetweenCuts_InX + rIcedOffset),           
										I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront
																								- (nCnt_pos -1) * rMmPerCut - rCenterPointKnifeInverted,
										I_rA:=							90,
										I_rK:=							0,
										I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
										I_sOvershootSettings := 		overshootSettings)
						THEN 
														RETURN;
						END_IF  					
					END_FOR
					(* Last position on the line *)
					
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * (g_rDistanceBetweenCuts_InX + rIcedOffset),           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_bTrimLeft AND nCnt_Line = nNrOfLines AND g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  				
				END_IF
				bToggle := NOT bToggle;
			END_IF
		END_FOR
	END_IF	(* nNrOfLines > 0 *)

(**********************************************************************************************************************************)
(* If slab diagonal  *)
(**********************************************************************************************************************************)
ELSIF	g_HMI_RCP_Parameters.nProductType = Prod_Slab_Diagonal_1x1		(* ProductType = 2 = Slab diagonal *)
THEN

	(* Offset of slab *)
	FirstPoint.X	:= g_HMI_MCH_Parameters.rStartPointSlab_X;
	FirstPoint.Y	:= g_HMI_MCH_Parameters.rStartPointSlab_Y;

	rSizeTrimRear 		:= g_HMI_RCP_Parameters.rSizeTrimFront;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	rSizeTrimFront 	:= g_HMI_RCP_Parameters.rSizeTrimRear;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	rSizeTrimRight 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimRight);
	rSizeTrimLeft 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimLeft); 

	(* Calculate number of cuts on the line *)
	rLengthOfLine := g_HMI_RCP_Parameters.rProdLength_InY - rSizeTrimRear - rSizeTrimFront;

	IF rLengthOfLine > rSizeOfKnife
	THEN
		nNumberOfCutsPerLine := TRUNC_INT(rLengthOfLine / rSizeOfKnife);
		IF nNumberOfCutsPerLine < (rLengthOfLine / rSizeOfKnife)
		THEN
			nNumberOfCutsPerLine := nNumberOfCutsPerLine + 1;
		END_IF;
	ELSE
		nNumberOfCutsPerLine := 1;
	END_IF;

	overshootSettings.MarginXMin := C_rMinOvershootX;
	overshootSettings.MarginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);	(* Mechanical boundary *) 
	overshootSettings.MarginYMin := C_rMinOvershootY;		(* Mechanical boundary *)                                         
	overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);	(* Mechanical boundary *) 

	overshootSettings.adjustXMax := TRUE;
	overshootSettings.adjustXMin := True;
	overshootSettings.adjustYMax := True;
	overshootSettings.adjustYMin := True;
	
	

	(* Wast strip present *)
	IF g_bTrimRight OR g_bTrimLeft
	THEN
		IF nNumberOfCutsPerLine = 1
		THEN
			(* Front waste strip *)
			IF g_bTrimRight
			THEN
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + (rLengthOfLine/2),
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  			
			END_IF
			(* Rear waste strip *)
			IF g_bTrimLeft
			THEN
				IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rProdLength_InX - rSizeTrimLeft,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear  + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  				
			END_IF
		ELSE (* more then 1 cut per line *)
			(* Front waste strip *)
			IF g_bTrimRight
			THEN
				FOR nCnt_pos := 1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + (nCnt_pos - 1) * rSizeOfKnife
																					+ rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  					
				END_FOR
				(* Last position at front waste strip *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X +  rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + g_HMI_RCP_Parameters.rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  				
			END_IF
			(* Rear waste strip *)
			IF g_bTrimLeft
			THEN
				FOR nCnt_pos := 1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rProdLength_InX  - rSizeTrimLeft,           
									I_rY:=							FirstPoint.Y + g_HMI_RCP_Parameters.rProdLength_InY - rSizeTrimFront
												                                                              - (nCnt_pos - 1) * rSizeOfKnife - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  		
				END_FOR
				(* Last position at rear waste strip *)
				
				IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rProdLength_InX -  rSizeTrimLeft,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			END_IF
		END_IF
		
	END_IF

(******************************************************************************
* Driehoek als vierkant diagonaal doorgesneden
******************************************************************)
ELSIF	g_HMI_RCP_Parameters.nProductType = Prod_Slab_Triangle_1x1 AND g_HMI_RCP_Parameters.bUseRectanglesForTriangles		(* ProductType = 1 = Slab triangle *)
THEN
	(* Offset of slab *)
	FirstPoint.X	:= g_HMI_MCH_Parameters.rStartPointSlab_X;
	FirstPoint.Y	:= g_HMI_MCH_Parameters.rStartPointSlab_Y;

	g_rDistanceBetweenCuts_InX	:= g_HMI_RCP_Parameters.rPartSizeX;
	g_rDistanceBetweenCuts_InY		:= g_HMI_RCP_Parameters.rPartSizeY;

	rProdLength_InY	:= g_HMI_RCP_Parameters.rProdLength_InY - MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear) - MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront);
	rProdLength_InX	:= g_HMI_RCP_Parameters.rProdLength_InX - MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) - MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft);

	(* Determine number of lines *)
	rNrOfLines	:=	(rProdLength_InX / g_rDistanceBetweenCuts_InX) - 1;
	nNrOfLines	:=	TRUNC_INT(rNrOfLines);
	IF	nNrOfLines < rNrOfLines	(* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
	THEN
		rWasteExtra := (rProdLength_InX - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InX))/2;
		rSizeTrimRight 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) + rWasteExtra;
		rSizeTrimLeft 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft) + rWasteExtra;
		g_bTrimRight		:= TRUE;
		g_bTrimLeft 		:= TRUE;
		nNrOfLines		:= nNrOfLines + 2;
	ELSE
		rSizeTrimRight 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimRight);
		rSizeTrimLeft 	:= MAX(0, g_HMI_RCP_Parameters.rSizeTrimLeft); 
	END_IF
	(* Uitrekenen left en right afvalrand *)
	rNrOfLines	:= (rProdLength_InY / g_rDistanceBetweenCuts_InY) - 1;
	nNrOfLines	:= TRUNC_INT(rNrOfLines);
	IF	nNrOfLines < rNrOfLines	(* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
	THEN
		rWasteExtra := (rProdLength_InY - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InY))/2;
		rSizeTrimRear	 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront) + rWasteExtra;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		rSizeTrimFront 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear) + rWasteExtra;
	ELSE
		rSizeTrimRear 		:= g_HMI_RCP_Parameters.rSizeTrimFront ;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		rSizeTrimFront 	:= g_HMI_RCP_Parameters.rSizeTrimRear;
	END_IF
	(* Determine number of lines *)
	rNrOfLines	:= (rProdLength_InX / g_rDistanceBetweenCuts_InX) - 1;
	nNrOfLines	:=	TRUNC_INT(rNrOfLines) + BOOL_TO_INT(rSizeTrimRight > 0) + BOOL_TO_INT(rSizeTrimLeft > 0);

	(* Calculate number of cuts on the line *)
	rLengthOfLine := g_HMI_RCP_Parameters.rProdLength_InY - rSizeTrimRear - rSizeTrimFront;

	IF rLengthOfLine > rSizeOfKnife
	THEN
		nNumberOfCutsPerLine := TRUNC_INT(rLengthOfLine / rSizeOfKnife);
		IF nNumberOfCutsPerLine < (rLengthOfLine / rSizeOfKnife)
		THEN
			nNumberOfCutsPerLine := nNumberOfCutsPerLine + 1;
		END_IF;
		(*Calculation of covered distance per cut*)
		rMmPerCut := (rLengthOfLine - rSizeOfKnife)/(nNumberOfCutsPerLine -1);
	ELSE
		nNumberOfCutsPerLine := 1;
	END_IF;

	overshootSettings.MarginXMin := C_rMinOvershootX;		(* Mechanical boundary *)                                         
	overshootSettings.MarginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);	(* Mechanical boundary *) 
	overshootSettings.MarginYMin := C_rMinOvershootY;		(* Mechanical boundary *)                                         
	overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);		(* Mechanical boundary *)

	overshootSettings.adjustXMax := TRUE;
	overshootSettings.adjustXMin := TRUE;
	overshootSettings.adjustYMax := TRUE;
	overshootSettings.adjustYMin := TRUE;
	
	
	IF nNrOfLines > 0
	THEN
		(* Calculate positions on first line *)
		IF g_bTrimRight
		THEN
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight),           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + (rLengthOfLine/2),
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  			
			ELSE
				FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight),           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife
																			+ (nCnt_pos-1) * rMmPerCut,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_FOR
				(* Last position on the line *)				
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + rLengthOfLine + rSizeTrimRear - rCenterPointKnifeInverted,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			END_IF
		ELSE (* No waste strip at the Intake *)
			IF nNumberOfCutsPerLine = 1
			THEN
				IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX),           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + (rLengthOfLine/2),
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					FALSE,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  			
			ELSE
				FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							(rFirstXPosition := FirstPoint.X + rSizeTrimRight+ g_rDistanceBetweenCuts_InX),           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + (nCnt_pos -1) * rMmPerCut
																					 + rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_FOR
				(* Last position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight + g_rDistanceBetweenCuts_InX,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rLengthOfLine - rCenterPointKnifeInverted,
								I_rA:=							90,
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
				IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + (rLengthOfLine/2),
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimLeft AND nCnt_Line = nNrOfLines) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  				
			ELSE
				IF bToggle (* from left to right *)
				THEN
					FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
						IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
										I_rY:=							FirstPoint.Y + rSizeTrimRear
																                             + (nCnt_pos - 1) * rMmPerCut + rCenterPointKnife,
										I_rA:=							90,
										I_rK:=							0,
										I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimLeft AND nCnt_Line = nNrOfLines) ,
										I_sOvershootSettings := 		overshootSettings)
						THEN 
														RETURN;
						END_IF  						
					END_FOR
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + rLengthOfLine - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimLeft AND nCnt_Line = nNrOfLines) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				ELSE (* toggle, ie from right to left *)
					FOR nCnt_pos:=1 TO (nNumberOfCutsPerLine - 1) DO
						IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
										I_rY:=							FirstPoint.Y + rSizeTrimRear + rLengthOfLine
																								- (nCnt_pos -1) * rMmPerCut - rCenterPointKnifeInverted,
										I_rA:=							90,
										I_rK:=							0,
										I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimLeft AND nCnt_Line = nNrOfLines) ,
										I_sOvershootSettings := 		overshootSettings)
						THEN 
														RETURN;
						END_IF  
					END_FOR
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							rFirstXPosition + (nCnt_line-1) * g_rDistanceBetweenCuts_InX,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear +  rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst AND g_bTrimLeft AND nCnt_Line = nNrOfLines) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  				
				END_IF
				bToggle := NOT bToggle;
			END_IF
		END_FOR
	END_IF	(* nNrOfLines > 0 *)

(*************************************************************************************************
* Driehoek in slab met 2 schuine zijden
*************************************************************************************************)
ELSIF	g_HMI_RCP_Parameters.nProductType = Prod_Slab_Triangle_1x1 AND NOT g_HMI_RCP_Parameters.bUseRectanglesForTriangles		(* ProductType = 1 = Slab triangle *)
THEN
	(* Offset of slab *)
	FirstPoint.X	:= g_HMI_MCH_Parameters.rStartPointSlab_X;
	FirstPoint.Y	:= g_HMI_MCH_Parameters.rStartPointSlab_Y;

	g_rDistanceBetweenCuts_InX	:= g_HMI_RCP_Parameters.rPartSizeX;
	g_rDistanceBetweenCuts_InY		:= g_HMI_RCP_Parameters.rPartSizeY;

	rProdLength_InY	:= g_HMI_RCP_Parameters.rProdLength_InY - MAX(g_HMI_RCP_Parameters.rSizeTrimRear, 0) - MAX( g_HMI_RCP_Parameters.rSizeTrimFront, 0);
	rProdLength_InX	:= g_HMI_RCP_Parameters.rProdLength_InX - MAX(g_HMI_RCP_Parameters.rSizeTrimRight, 0) - MAX(g_HMI_RCP_Parameters.rSizeTrimLeft, 0);

	(* Determine number of lines *)
	rNrOfLines	:=	(rProdLength_InX / g_rDistanceBetweenCuts_InX) - 1;
	nNrOfLines	:=	TRUNC_INT(rNrOfLines);
	IF	nNrOfLines < rNrOfLines	(* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
	THEN
		rWasteExtra := (rProdLength_InX - ((nNrOfLines +1)* g_HMI_RCP_Parameters.rPartSizeX))/2;
		rSizeTrimRight 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) + rWasteExtra;
		rSizeTrimLeft 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft) + rWasteExtra;
		g_bTrimRight		:= TRUE;
		g_bTrimLeft 		:= TRUE;
		nNrOfLines		:= nNrOfLines + 2;
	ELSE
		rSizeTrimRight 	:= g_HMI_RCP_Parameters.rSizeTrimRight;
		rSizeTrimLeft 	:= g_HMI_RCP_Parameters.rSizeTrimLeft;
	END_IF
	(* Uitrekenen left en right afvalrand *)
	rNrOfLines	:= (rProdLength_InY / g_rDistanceBetweenCuts_InY) - 1;
	nNrOfLines	:= TRUNC_INT(rNrOfLines);
	IF	nNrOfLines < rNrOfLines	(* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
	THEN
		rWasteExtra := (rProdLength_InY - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InY))/2;
		rSizeTrimRear	 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront) + rWasteExtra;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		rSizeTrimFront 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear) + rWasteExtra;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	ELSE
		rSizeTrimRear 		:= g_HMI_RCP_Parameters.rSizeTrimFront ;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		rSizeTrimFront 	:= g_HMI_RCP_Parameters.rSizeTrimRear;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	END_IF
	(* Determine number of lines *)
	rNrOfLines	:= (rProdLength_InX / g_rDistanceBetweenCuts_InX) - 1;
	nNrOfLines	:=	TRUNC_INT(rNrOfLines) + BOOL_TO_INT(rSizeTrimRight > 0) + BOOL_TO_INT(rSizeTrimLeft > 0);

	(* Calculate number of cuts on the line *)
	rLengthOfLine := g_HMI_RCP_Parameters.rProdLength_InY - rSizeTrimRear - rSizeTrimFront;

	IF rLengthOfLine > rSizeOfKnife
	THEN
		nNumberOfCutsPerLine := TRUNC_INT(rLengthOfLine / rSizeOfKnife);
		IF nNumberOfCutsPerLine < (rLengthOfLine / rSizeOfKnife)
		THEN
			nNumberOfCutsPerLine := nNumberOfCutsPerLine + 1;
		END_IF;
		(*Calculation of covered distance per cut*)
		rMmPerCut := (rLengthOfLine - rSizeOfKnife)/(nNumberOfCutsPerLine -1);
	ELSE
		nNumberOfCutsPerLine := 1;
	END_IF;

	overshootSettings.MarginXMin := C_rMinOvershootX;		(* Mechanical boundary *)                                                                  
	overshootSettings.MarginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);	(* Mechanical boundary *)                          
	overshootSettings.MarginYMin := C_rMinOvershootY;		(* Mechanical boundary *)                                                                  
	overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);		(* Mechanical boundary *)(* Waste strip present *)


	overshootSettings.adjustXMax := TRUE;
	overshootSettings.adjustXMin := TRUE;
	overshootSettings.adjustYMax := TRUE;
	overshootSettings.adjustYMin := TRUE;
	
	
	
	IF g_bTrimRight OR g_bTrimLeft
	THEN
		IF nNumberOfCutsPerLine = 1
		THEN
			(* Front waste strip *)
			IF g_bTrimRight
			THEN
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + (rLengthOfLine/2),
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			END_IF
			(* Rear waste strip *)
			IF g_bTrimLeft
			THEN
				IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rProdLength_InX - rSizeTrimLeft,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear  + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			END_IF
		ELSE (* more then 1 cut per line *)
			(* Front waste strip *)
			IF g_bTrimRight
			THEN
				FOR nCnt_pos := 1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + (nCnt_pos - 1) * rSizeOfKnife
																					+ rCenterPointKnife,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_FOR
				(* Last position at front waste strip *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X +  rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + g_HMI_RCP_Parameters.rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  			
			END_IF
			(* Rear waste strip *)
			IF g_bTrimLeft
			THEN
				FOR nCnt_pos := 1 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rProdLength_InX - rSizeTrimLeft,           
									I_rY:=							FirstPoint.Y + g_HMI_RCP_Parameters.rProdLength_InY - rSizeTrimFront
												                                                              - (nCnt_pos - 1) * rSizeOfKnife - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  				
				END_FOR
				(* Last position at rear waste strip *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + g_HMI_RCP_Parameters.rProdLength_InX - rSizeTrimLeft,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			END_IF
		END_IF
	END_IF

(*************************************************************************************************
* Driehoek in tray met 2 schuine zijden
*************************************************************************************************)
ELSIF		(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x1
	OR	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2
	OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4
	OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1)
	AND (g_HMI_RCP_Parameters.bTrianglesInTray AND NOT g_HMI_RCP_Parameters.bUseRectanglesForTriangles AND NOT g_HMI_RCP_Parameters.bUseRectanglesInEight)
THEN
	(* Determine type of tray *)
	IF g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x1
	THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayLarge_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayLarge_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTrayLarge;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTrayLarge_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayLarge_Y;
	ELSIF g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2
	THEN
		rProdLength_InY := g_HMI_MCH_Parameters.rProdLengthTraySmall_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTraySmall_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTraySmall;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTraySmall_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTraySmall1_Y;	(* Startpoint for first small tray *)
	ELSIF	(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4)
	THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayTriple_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayTriple_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTrayTriple;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTrayTriple_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple1_Y;	(* Startpoint for first small tray *)
	ELSIF	(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1)
	THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayDouble_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayDouble_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTrayDouble;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTrayDouble1_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayDouble_Y;	(* Startpoint for first small tray *)
	END_IF

	rSizeTrimRear 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimFront);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	rSizeTrimFront 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimRear);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
	IF g_HMI_RCP_Parameters.rSizeTrimRight <= 0			(* Wijziging 16 juli 2010 *)
	THEN
		rSizeTrimRight	:= 0;
	ELSE
		rSizeTrimRight 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimRight);
	END_IF
	IF g_HMI_RCP_Parameters.rSizeTrimLeft <= 0			(* Wijziging 16 juli 2010 *)
	THEN
		rSizeTrimLeft	:= 0;
	ELSE
		rSizeTrimLeft 	:= MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimLeft);
	END_IF

	(*Additional safety checks for trays*)
	rMaxTraySize := rProdLength_InY - (rMinimumTrayTrimSize * 2);
	IF rMaxTraySize < rSizeOfKnife THEN
		g_sMACH.ERR.bTrayTooSmall := TRUE; (*Insert error thingie here*)
		RETURN;
	END_IF
	rMinTraySize := rProdLength_InY - (rSizeTrimRear + rSizeTrimFront);
	IF rMinTraySize < rSizeOfKnife THEN
		rSizeTrimRear := rSizeTrimRear - (rSizeOfKnife - rMinTraySize);
		rSizeTrimRear := MAX(rMinimumTrayTrimSize, rSizeTrimRear);
		rSizeTrimFront := rProdLength_InY - rSizeOfKnife - rSizeTrimRear;
	END_IF

	g_rDistanceBetweenCuts_InX:=	(rProdLength_InX - rSizeTrimRight - rSizeTrimLeft) / INT_TO_REAL(g_HMI_RCP_Parameters.nPartsX);

	(* Determine number of lines *)
	IF g_bTrimRight AND g_bTrimLeft
	THEN
		nNrOfLines	:= 2;
	ELSIF g_bTrimRight AND NOT g_bTrimLeft
	THEN
		nNrOfLines	:= 1;
	ELSIF NOT g_bTrimRight AND g_bTrimLeft
	THEN
		nNrOfLines	:= 1;
	ELSIF NOT g_bTrimRight AND NOT g_bTrimLeft
	THEN
		nNrOfLines	:= 0;
	END_IF

	(* Calculate number of cuts on the line *)
	rLengthOfLine := rProdLength_InY - rSizeTrimRear - rSizeTrimFront;
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

	overshootSettings.MarginXMin := FirstPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)                   
	overshootSettings.MarginXMax := FirstPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);	(* Mechanical boundary *) 
	overshootSettings.MarginYMin := FirstPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)                   
	overshootSettings.MarginYMax := FirstPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);		(* Mechanical boundary *)
	
	overshootSettings.adjustXMax := FALSE;
	overshootSettings.adjustXMin := FALSE;
	overshootSettings.adjustYMax := FALSE;
	overshootSettings.adjustYMin := FALSE;
		
	
	(* Waste strip present *)
	IF g_bTrimRight OR g_bTrimLeft
	THEN
		IF nNumberOfCutsPerLine = 1
		THEN
			(* Front waste strip *)
			IF g_bTrimRight
			THEN		
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + (rLengthOfLine/2),
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			END_IF
			(* Rear waste strip *)
			IF g_bTrimLeft
			THEN
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rProdLength_InX - rSizeTrimLeft,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear  + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
			END_IF
		ELSE (* more then 1 cut per line *)
			(* Front waste strip *)
			IF g_bTrimRight
			THEN
				(* First position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				IF bCutsAtEdgeFirst		(* If cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
									I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_IF
				FOR nCnt_pos:=2 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife
																			+ (nCnt_pos-1) * rMmPerCut,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_FOR
				IF NOT bCutsAtEdgeFirst		(* If not cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rSizeTrimRight,           
									I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  	
				END_IF
			END_IF
			(* Rear waste strip *)
			IF g_bTrimLeft
			THEN
				(* First position on the line *)
				IF NOT StorePos(I_rX:= 							FirstPoint.X + rProdLength_InX - rSizeTrimLeft,           
								I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife,
								I_rA:=							90,
								I_rK:=							0,
								I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
								I_sOvershootSettings := 		overshootSettings)
				THEN 
										RETURN;
				END_IF  
				IF bCutsAtEdgeFirst		(* If cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rProdLength_InX - rSizeTrimLeft,           
									I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_IF
				FOR nCnt_pos:=2 TO (nNumberOfCutsPerLine - 1) DO
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rProdLength_InX - rSizeTrimLeft,           
									I_rY:=							FirstPoint.Y + rSizeTrimRear + rCenterPointKnife
																			+ (nCnt_pos-1) * rMmPerCut,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_FOR
				IF NOT bCutsAtEdgeFirst		(* If not cuts at the edge first *)
				THEN
					(* Last position on the line *)
					IF NOT StorePos(I_rX:= 							FirstPoint.X + rProdLength_InX - rSizeTrimLeft,           
									I_rY:=							FirstPoint.Y + rProdLength_InY - rSizeTrimFront - rCenterPointKnifeInverted,
									I_rA:=							90,
									I_rK:=							0,
									I_bIsWaste :=					 (g_HMI_RCP_Parameters.bCutWasteFirst) ,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_IF
			END_IF
		END_IF
	

		(*Mogelijke vervolg blikken*)
		(* Double the positions for the second tray if small trays is selected *)
		nLastPosFirstTray		:= g_sCuttingPositionsInfo.index-1;
		nLastWastePosFirstTray	:= g_sWastePositionsInfo.index-1;
		
		IF	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2
		THEN
			CopyPoint.X := FirstPoint.X;
			CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTraySmall2_Y;
	
			overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
			overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
			overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
			overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);
			
			IF nFirstPosFirstTray <= nLastPosFirstTray THEN
				IF NOT Calc_CopyCutsWithOffset(
					I_firstIndex				:= nFirstPosFirstTray,
					I_lastIndex					:= nLastPosFirstTray,
					I_dX 						:= CopyPoint.X - FirstPoint.X,
					I_dY 						:= CopyPoint.Y - FirstPoint.Y,
					I_overshootSettings 		:= overshootSettings,
					I_dataArray 				:= ADR(g_aCuttingPositions),
					I_bReverseOrder				:= TRUE,
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
					I_bReverseOrder				:= TRUE,
					IQ_dataArrayInfo 			:= g_sWastePositionsInfo) 
				THEN
										RETURN;
				END_IF
			END_IF
		END_IF
		
		(* Triple the positions for the second and third tray if triple trays is selected *)
		IF	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4
		THEN
			IF g_HMI_RCP_Parameters.bCutWasteFirst THEN
				
				CopyPoint.X := FirstPoint.X;
				CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple2_Y;
	
				overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);

				IF nFirstWastePosFirstTray <= nLastWastePosFirstTray THEN
					IF NOT Calc_CopyCutsWithOffset(
						I_firstIndex				:= nFirstWastePosFirstTray,
						I_lastIndex					:= nLastWastePosFirstTray,
						I_dX 						:= CopyPoint.X - FirstPoint.X,
						I_dY 						:= CopyPoint.Y - FirstPoint.Y,
						I_overshootSettings 		:= overshootSettings,
						I_dataArray 				:= ADR(g_aWastePositions),
						I_bReverseOrder				:= TRUE,
						IQ_dataArrayInfo 			:= g_sWastePositionsInfo) 
					THEN
												RETURN;
					END_IF
				END_IF
		

				(*Third tray*)
				CopyPoint.X := FirstPoint.X;
				CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple3_Y;
	
				overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);
								
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
	
				overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);
								
				IF nFirstWastePosFirstTray <= nLastWastePosFirstTray THEN
					IF NOT Calc_CopyCutsWithOffset(
						I_firstIndex				:= nFirstWastePosFirstTray,
						I_lastIndex					:= nLastWastePosFirstTray,
						I_dX 						:= CopyPoint.X - FirstPoint.X,
						I_dY 						:= CopyPoint.Y - FirstPoint.Y,
						I_overshootSettings 		:= overshootSettings,
						I_dataArray 				:= ADR(g_aWastePositions),
						I_bReverseOrder				:= TRUE,
						IQ_dataArrayInfo 			:= g_sWastePositionsInfo) 
					THEN
												RETURN;
					END_IF
				END_IF
				
			ELSE
				
				CopyPoint.X := FirstPoint.X;
				CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple2_Y;
	
				overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);	
			
				IF nFirstPosFirstTray <= nLastPosFirstTray THEN
					IF NOT Calc_CopyCutsWithOffset(
						I_firstIndex				:= nFirstPosFirstTray,
						I_lastIndex					:= nLastPosFirstTray,
						I_dX 						:= CopyPoint.X - FirstPoint.X,
						I_dY 						:= CopyPoint.Y - FirstPoint.Y,
						I_overshootSettings 		:= overshootSettings,
						I_dataArray 				:= ADR(g_aCuttingPositions),
						I_bReverseOrder				:= TRUE,
						IQ_dataArrayInfo 			:= g_sCuttingPositionsInfo) 
					THEN
												RETURN;
					END_IF
				END_IF
				
				(*Third tray*)
				CopyPoint.X := FirstPoint.X;
				CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple3_Y;
	
				overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);	
			
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
				

				(*Fourth Tray*)
				CopyPoint.X := FirstPoint.X;
				CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple4_Y;
	
				overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);	
			
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
			END_IF
		END_IF
	(* 2x positions the positions for the second tray if double trays side by side *)
		IF	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1
		THEN
			IF g_HMI_RCP_Parameters.bCutWasteFirst THEN
				CopyPoint.X := g_HMI_MCH_Parameters.rStartPointTrayDouble2_X;
				CopyPoint.Y := FirstPoint.Y;
	
				overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);	
			
				IF nFirstWastePosFirstTray <= nLastWastePosFirstTray THEN
					IF NOT Calc_CopyCutsWithOffset(
						I_firstIndex				:= nFirstWastePosFirstTray,
						I_lastIndex					:= nLastWastePosFirstTray,
						I_dX 						:= CopyPoint.X - FirstPoint.X,
						I_dY 						:= CopyPoint.Y - FirstPoint.Y,
						I_overshootSettings 		:= overshootSettings,
						I_dataArray 				:= ADR(g_aWastePositions),
						I_bReverseOrder				:= TRUE,
						IQ_dataArrayInfo 			:= g_sWastePositionsInfo) 
					THEN
												RETURN;
					END_IF
				END_IF
			ELSE
				CopyPoint.X := g_HMI_MCH_Parameters.rStartPointTrayDouble2_X;
				CopyPoint.Y := FirstPoint.Y;
	
				overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginXMax := CopyPoint.X + rProdLength_InX  - MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);
				overshootSettings.MarginYMax := CopyPoint.Y + rProdLength_InY -  MAX(rMinimumTrayTrimSize-0.1,1);	

				IF nFirstPosFirstTray <= nLastPosFirstTray THEN
					IF NOT Calc_CopyCutsWithOffset(
						I_firstIndex				:= nFirstPosFirstTray,
						I_lastIndex					:= nLastPosFirstTray,
						I_dX 						:= CopyPoint.X - FirstPoint.X,
						I_dY 						:= CopyPoint.Y - FirstPoint.Y,
						I_overshootSettings 		:= overshootSettings,
						I_dataArray 				:= ADR(g_aCuttingPositions),
						I_bReverseOrder				:= TRUE,
						IQ_dataArrayInfo 			:= g_sCuttingPositionsInfo) 
					THEN
												RETURN;
					END_IF
				END_IF
			END_IF
		END_IF
	END_IF
END_IF

Calc_Ver:=TRUE;

END_FUNCTION
