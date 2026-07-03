FUNCTION Calc_Dia2_Compact : bool
VAR
	rSizeOfWerkgebiedHor: REAL;
	rSizeOfWerkgebiedVer: REAL;
	rDeltaX: REAL;
	rDeltaY: REAL;
	nPartsY: INT;
	nPartsX: INT;
	rDistanceBetweenCutsX: REAL;
	rDistanceBetweenCutsY: REAL;
	nNrOfLinesDia: INT;
	rLengthOfKnifeHor: REAL;
	rLengthOfKnifeVer: REAL;
	i: INT;
	c: INT;
	nPosOpLijn: INT;

	//CorrectOvershootDia2SlabTriangleA		: CorrectOvershootDia2SlabV1;
	//CorrectOvershootDia2SlabTriangleB		: CorrectOvershootDia2SlabV1;
	//CorrectOvershootDia2TrayTriangleA		: CorrectOvershootDia2TrayV1;
	//CorrectOvershootDia2TrayTriangleB		: CorrectOvershootDia2TrayV1;
	//CorrectOvershootDia2TrayTriangleC		: CorrectOvershootDia2TrayV1;
	//CorrectOvershootDia2TrayTriangleD		: CorrectOvershootDia2TrayV1;
	//CorrectOvershootDia2TrayTriangleE		: CorrectOvershootDia2TrayV1;
	//CorrectOvershootDia2TrayTriangleF		: CorrectOvershootDia2TrayV1;
	//CorrectOvershootDia2TrayTriangleG		: CorrectOvershootDia2TrayV1;

	bToggle: BOOL;

	rCenterPointKnifeInverted: REAL;
	rSizeOfKnife: REAL;
	rCenterPointKnifeHor: REAL;
	rCenterPointKnifeVer: REAL;
	rCenterPointKnifeHorInverted: REAL;
	rCenterPointKnifeVerInverted: REAL;
	rProdLength_InX: REAL;
	rProdLength_InY: REAL;
	rSizeTrimRear: REAL;
	rSizeTrimFront: REAL;
	rSizeTrimLeft: REAL;
	rSizeTrimRight: REAL;
	rWasteExtra: REAL;
	nNrOfLines: INT;
	rNrOfLines: REAL;
	rCutsPerLine: REAL;
	nCutsPerLine: INT;
	rLengthOfLine: REAL;
	rStepDistX: REAL;
	rStepDistY: REAL;
	rStartPointLineX	: REAL;
	rStartPointLineY: REAL;
	rEndPointLineX: REAL;
	rEndPointLineY: REAL;
	rLength_X: REAL;
	rLength_Y: REAL;
	rCenterPointKnife: REAL;
	//rStartPointTray_Y: REAL;
	//rStartPointTray_X: REAL;
	rMinimumTrayTrimSize: REAL;
	//nFirstPosSecTray: INT;
	//nCnt_SecTrayPos: INT;
	//nFirstPos: INT;
	//nCnt_pos: INT;
	//nFirstPosThirdTray : INT;
	//nFirstPosFourthTray: INT;
	rTrayLength_InY	:REAL;
	rTrayLength_InX	:REAL;

	FirstPoint					: Gonio_Point;
	CopyPoint					: Gonio_Point;
	overshootSettings 			: Gonio_Settings;
	nFirstPosFirstTray 		: INT;
	nLastPosFirstTray		: INT;
	nLastWastePosFirstTray	: int;
END_VAR

Calc_Dia2_Compact				:= FALSE;
bToggle							:= FALSE;
rSizeOfKnife					:= g_HMI_MCH_Parameters.rSizeOfKnife;
rCenterPointKnife				:= rSizeOfKnife/2;
rCenterPointKnifeInverted		:= rSizeOfKnife/2;
overshootSettings.knifeAxis		:= rCenterPointKnife;
overshootSettings.knifeLength	:= rSizeOfKnife;
overshootSettings.precision		:= 0.1;
nFirstPosFirstTray				:= g_sCuttingPositionsInfo.index;;
(**********************************************************************************************************************************)
(* Slab triangle *)
(**********************************************************************************************************************************)
IF		g_HMI_RCP_Parameters.nProductType = Prod_Slab_Triangle_1x1   (* ProductType = 1 = Slab triangle *)
        AND (NOT g_HMI_RCP_Parameters.bUseRectanglesForTriangles OR g_HMI_RCP_Parameters.bMirrorDiagonals)
THEN

	(* Offset of slab *)
	FirstPoint.X	:= g_HMI_MCH_Parameters.rStartPointSlab_X;
	FirstPoint.Y	:= g_HMI_MCH_Parameters.rStartPointSlab_Y;

	rProdLength_InX	:= g_HMI_RCP_Parameters.rProdLength_InX - MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) - MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft);
	rProdLength_InY	:= g_HMI_RCP_Parameters.rProdLength_InY - MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear) - MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront);

	IF ( g_HMI_RCP_Parameters.bUseRectanglesForTriangles)
	THEN
		g_rDistanceBetweenCuts_InX  := g_HMI_RCP_Parameters.rPartSizeX;
		g_rDistanceBetweenCuts_InY  := g_HMI_RCP_Parameters.rPartSizeY;
		(* Determine number of lines *)
		rNrOfLines         :=            (rProdLength_InX / g_rDistanceBetweenCuts_InX) - 1;
		nNrOfLines        :=            TRUNC_INT(rNrOfLines);
		nPartsX := nNrOfLines + 1;
		IF            nNrOfLines < rNrOfLines             (* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
		THEN
			rWasteExtra := (rProdLength_InX - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InX))/2;
			rSizeTrimRight := MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) + rWasteExtra;
			rSizeTrimLeft     := MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft) + rWasteExtra;
			WHILE (rSizeTrimRight < C_rMinimumTrimSlab) DO (*Extra beveiliging op afvalranden*)
				rSizeTrimRight := rSizeTrimRight +  g_HMI_RCP_Parameters.rPartSizeX/2;
				rSizeTrimLeft := rSizeTrimLeft +  g_HMI_RCP_Parameters.rPartSizeX/2;
				nPartsX := nPartsX -1;
			END_WHILE
			WHILE (rSizeTrimLeft < C_rMinimumTrimSlab) DO
				rSizeTrimRight := rSizeTrimRight + g_HMI_RCP_Parameters.rPartSizeX/2;
				rSizeTrimLeft := rSizeTrimLeft + g_HMI_RCP_Parameters.rPartSizeX/2;
				nPartsX := nPartsX -1;
			END_WHILE
		ELSE
			rSizeTrimRight := MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) ;
			rSizeTrimLeft     := MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft);
		END_IF
		(* Uitrekenen left en right afvalrand *)
		rNrOfLines         := (rProdLength_InY / g_rDistanceBetweenCuts_InY) - 1;
		nNrOfLines        := TRUNC_INT(rNrOfLines);
		nPartsY := (nNrOfLines + 1) * 2;
		IF            nNrOfLines < rNrOfLines             (* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
		THEN
			rWasteExtra := (rProdLength_InY - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InY))/2;
			rSizeTrimRear                  := MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront) + rWasteExtra;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
			rSizeTrimFront := MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear) + rWasteExtra;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
			WHILE (rSizeTrimRear < C_rMinimumTrimSlab) DO (*Extra beveiliging minimale afvalranden*)
				rSizeTrimRear := rSizeTrimRear + g_rDistanceBetweenCuts_InY/2;
				rSizeTrimFront := rSizeTrimFront + g_rDistanceBetweenCuts_InY/2;
				nPartsY := nPartsY -2;
			END_WHILE
			WHILE (rSizeTrimFront < C_rMinimumTrimSlab) DO
				rSizeTrimRear := rSizeTrimRear + g_rDistanceBetweenCuts_InY/2;
				rSizeTrimFront := rSizeTrimFront + g_rDistanceBetweenCuts_InY/2;
				nPartsY := nPartsY -2;
			END_WHILE
		ELSE
			rSizeTrimRear                   := MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront) ;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
			rSizeTrimFront := MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		END_IF
		rSizeOfWerkgebiedHor := g_HMI_RCP_Parameters.rProdLength_InX - MAX(0,rSizeTrimLeft) - MAX(0,rSizeTrimRight);
		rSizeOfWerkgebiedVer := g_HMI_RCP_Parameters.rProdLength_InY - MAX(0,rSizeTrimRear) - MAX(0,rSizeTrimFront);
		rDeltaX := FirstPoint.X + rSizeTrimRight;                                  (* Standard V02.08 *)
		rDeltaY := FirstPoint.Y + rSizeTrimRear;
		
		g_rDistanceBetweenCuts_InX  := g_HMI_RCP_Parameters.rPartSizeX;
		g_rDistanceBetweenCuts_InY  := g_HMI_RCP_Parameters.rPartSizeY;
		
		rDistanceBetweenCutsX             := g_HMI_RCP_Parameters.rPartSizeX;
		rDistanceBetweenCutsY              := g_HMI_RCP_Parameters.rPartSizeY;
	
		IF (TRUNC_INT(rSizeOfWerkgebiedVer / g_rDistanceBetweenCuts_InY) MOD 2) = 1 THEN       (* oneven aantal stukken *)
			nNrOfLinesDia  := TRUNC_INT((rProdLength_InY / g_rDistanceBetweenCuts_InY)) +                TRUNC_INT(rProdLength_InX / g_rDistanceBetweenCuts_InX) -1;
		ELSE
			nNrOfLinesDia  := TRUNC_INT((rProdLength_InY / g_rDistanceBetweenCuts_InY)) +                TRUNC_INT(rProdLength_InX / g_rDistanceBetweenCuts_InX)  -1;
		END_IF
		g_rHoekInRad :=  ATAN(rDistanceBetweenCutsY /  (rDistanceBetweenCutsX)); (* hoek berekend *)
		g_rHoekInRad2 := C_rPi - ATAN(rDistanceBetweenCutsY /  (rDistanceBetweenCutsX)); (* hoek berekend *)
	ELSE
		g_rDistanceBetweenCuts_InX  := g_HMI_RCP_Parameters.rPartSizeX;
		g_rDistanceBetweenCuts_InY  := g_HMI_RCP_Parameters.rPartSizeY;
		(* Determine number of lines *)
		rNrOfLines         :=            (rProdLength_InX / g_rDistanceBetweenCuts_InX) - 1;
		nNrOfLines        :=            TRUNC_INT(rNrOfLines);
		nPartsX := nNrOfLines + 1;
		IF            nNrOfLines < rNrOfLines             (* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
		THEN
			rWasteExtra := (rProdLength_InX - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InX))/2;
			rSizeTrimRight := MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) + rWasteExtra;
			rSizeTrimLeft     := MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft) + rWasteExtra;
		ELSE
			rSizeTrimRight := MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) ;
			rSizeTrimLeft     := MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft);
		END_IF
		(* Uitrekenen front en rear afvalrand *)
		rNrOfLines         := (rProdLength_InY / g_rDistanceBetweenCuts_InY) - 1;
		nNrOfLines        := TRUNC_INT(rNrOfLines);
		nPartsY := nNrOfLines + 1;
		IF            nNrOfLines < rNrOfLines             (* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
		THEN
			rWasteExtra := (rProdLength_InY - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InY))/2;
			rSizeTrimRear                  := MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront) + rWasteExtra;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
			rSizeTrimFront := MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear) + rWasteExtra;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		ELSE
			rSizeTrimRear   := MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
			rSizeTrimFront := MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		END_IF
	
		rSizeOfWerkgebiedHor := g_HMI_RCP_Parameters.rProdLength_InX - MAX(0,rSizeTrimLeft) - MAX(0,rSizeTrimRight);
		rSizeOfWerkgebiedVer := g_HMI_RCP_Parameters.rProdLength_InY - MAX(0,rSizeTrimRear) - MAX(0,rSizeTrimFront);
		rDeltaX := FirstPoint.X + rSizeTrimRight;                                  (* Standard V02.08 *)
		rDeltaY := FirstPoint.Y + rSizeTrimRear;
		
		rDistanceBetweenCutsX := g_HMI_RCP_Parameters.rPartSizeX ;
		rDistanceBetweenCutsY := g_HMI_RCP_Parameters.rPartSizeY * 2;                     (* In Y richting dubbele afstand voor de diagonaal! *)
		
		(* Determine number of lines *)
		IF (nPartsY MOD 2) = 0 THEN
			nNrOfLinesDia:= nPartsX + (nPartsY / 2) - 1;
		ELSE
			nNrOfLinesDia:= nPartsX + (nPartsY / 2);
		END_IF
		
		g_rHoekInRad :=  ATAN(rDistanceBetweenCutsY /  rDistanceBetweenCutsX); (* hoek berekend *)
	END_IF 

	(* General calculation part*)
	rLengthOfKnifeHor			:= rSizeOfKnife * COS(g_rHoekInRad);
	rLengthOfKnifeVer 			:= rSizeOfKnife * SIN(g_rHoekInRad);
	rCenterPointKnifeHor		:= rCenterPointKnife * COS(g_rHoekInRad);
	rCenterPointKnifeVer		:= rCenterPointKnife * SIN(g_rHoekInRad);
	rCenterPointKnifeHorInverted := rLengthOfKnifeHor - rCenterPointKnifeHor;
	rCenterPointKnifeVerInverted := rLengthOfKnifeVer - rCenterPointKnifeVer;

	FOR i :=1 TO nNrOfLinesDia DO
		nPosOpLijn := 0;(*		nPosOpLijn := 1;*)

		(* Startpunt van de lijn bepalen *)
		IF	i <= nPartsX THEN
			rStartPointLineX := (nPartsX - i) * rDistanceBetweenCutsX;
			rStartPointLineY := 0;
		ELSE
			rStartPointLineX := 0;
			rStartPointLineY := (i - nPartsX) * rDistanceBetweenCutsY;
		END_IF
		(* Eindpunt van de lijn bepalen *)
		IF	(nPartsY MOD 2) = 0 THEN
			IF	i <= (nPartsY/2) THEN
				rEndPointLineX := nPartsX * rDistanceBetweenCutsX;
				rEndPointLineY := i * rDistanceBetweenCutsY;
			ELSE
				rEndPointLineX := (nPartsX - i + (nPartsY / 2)) * rDistanceBetweenCutsX;
				rEndPointLineY := (nPartsY / 2) * rDistanceBetweenCutsY;
			END_IF
		ELSE
			IF	i <= (nPartsY/2) THEN
				rEndPointLineX := nPartsX * rDistanceBetweenCutsX;
				rEndPointLineY := i * rDistanceBetweenCutsY;
			ELSE
				rEndPointLineX := (nPartsX - i + (nPartsY / 2)) * rDistanceBetweenCutsX + (rDistanceBetweenCutsX / 2);;
				rEndPointLineY := (nPartsY / 2) * rDistanceBetweenCutsY + (rDistanceBetweenCutsY / 2);
			END_IF
		END_IF
		(*Calculate length of diagonal line*)
		rLength_X := (rEndPointLineX - rStartPointLineX);
		rLength_Y := (rEndPointLineY - rStartPointLineY);
		rLengthOfLine	:= SQRT((rLength_X * rLength_X) + (rLength_Y * rLength_Y));

		(*Calculate number of cuts*)
		rCutsPerLine := rLengthOfLine / rSizeOfKnife;
		nCutsPerLine := TRUNC_INT(rCutsPerLine);
		IF rCutsPerLine > nCutsPerLine THEN
			nCutsPerLine := nCutsPerLine + 1;
		END_IF

		(*Verplaatsingen bepalen*)
		IF nCutsPerLine = 1 THEN
			rStepDistX := rLengthOfLine/2 * COS(g_rHoekInRad);
			rStepDistY := rLengthOfLine/2 * SIN(g_rHoekInRad);
		ELSE
			rStepDistX := (rLengthOfLine - rSizeOfKnife)/(nCutsPerLine-1)* COS(g_rHoekInRad);
			rStepDistY := (rLengthOfLine - rSizeOfKnife)/(nCutsPerLine-1) * SIN(g_rHoekInRad);
		END_IF

		
		
		overshootSettings.MarginXMin :=  FirstPoint.X ; // zo komt het mes niet bij de schraper, was  C_rMinOvershootX;                                                      
		overshootSettings.MarginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);
		overshootSettings.MarginYMin := C_rMinOvershootY;                                        
		overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);
		overshootSettings.adjustXMin := FALSE; //NANO DUO SPECIAL  zo komt het mes niet bij de schraper, was origineel TRUE
		overshootSettings.adjustXMax := TRUE;
		overshootSettings.adjustYMin := True;
		overshootSettings.adjustYMax := True;
		
		
		
		IF NOT bToggle THEN (* mes van MaxX/MinY naar MinX/MaxY*)
			FOR c := 0 TO nCutsPerLine-1 DO
				IF nCutsPerLine = 1 THEN
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rStartPointLineX - rStepDistX + rDeltaX,           
									I_rY:=							rStartPointLineY + rStepDistY + rDeltaY,
									I_rA:=							((g_rHoekInRad2 / C_rPi) * 180),
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
						RETURN;
					END_IF  
					
					
				ELSE
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rStartPointLineX - rCenterPointKnifeHor - (c * rStepDistX) + rDeltaX,           
									I_rY:=							rStartPointLineY + rCenterPointKnifeVer + (c * rStepDistY) + rDeltaY,
									I_rA:=							((g_rHoekInRad2 / C_rPi) * 180),
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
						RETURN;
					END_IF  
				END_IF
				nPosOpLijn := nPosOpLijn + 1;
			END_FOR
		ELSE (* toggle, mes van linksonder naar rechtsboven *)
			FOR c := 0 TO nCutsPerLine-1 DO
				IF nCutsPerLine = 1 THEN
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rEndPointLineX + rStepDistX + rDeltaX,           
									I_rY:=							rEndPointLineY - rStepDistY + rDeltaY,
									I_rA:=							((g_rHoekInRad2 / C_rPi) * 180),
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
						RETURN;
					END_IF  
					
					
				ELSE
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rEndPointLineX + rCenterPointKnifeHor + (c * rStepDistX) + rDeltaX,           
									I_rY:=							rEndPointLineY - rCenterPointKnifeVer - (c * rStepDistY) + rDeltaY,
									I_rA:=							((g_rHoekInRad2 / C_rPi) * 180),
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
						RETURN;
					END_IF  
				END_IF
				nPosOpLijn := nPosOpLijn + 1;
			END_FOR
		END_IF
		bToggle := NOT bToggle;
	END_FOR

(**********************************************************************************************************************************)
(* Triangles in tray *)
(**********************************************************************************************************************************)

ELSIF (g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x1
	OR	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2
	OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4
	OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1)
	AND g_HMI_RCP_Parameters.bTrianglesInTray AND NOT g_HMI_RCP_Parameters.bUseRectanglesForTriangles (*AC 4-7-2013 uitbreiding 8 driehoeken uit stuk*)
THEN
	(* Determine type of tray *)
	IF g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x1
	THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayLarge_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayLarge_InX;
		rTrayLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayLarge_InY;
		rTrayLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayLarge_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTrayLarge;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTrayLarge_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayLarge_Y;
	ELSIF g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2
	THEN
		rProdLength_InY := g_HMI_MCH_Parameters.rProdLengthTraySmall_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTraySmall_InX;
		rTrayLength_InY := g_HMI_MCH_Parameters.rProdLengthTraySmall_InY;
		rTrayLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTraySmall_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTraySmall;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTraySmall_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTraySmall1_Y;	(* Startpoint for first small tray *)
	ELSIF	(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4)
	THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayTriple_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayTriple_InX;
		rTrayLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayTriple_InY;
		rTrayLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayTriple_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTrayTriple;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTrayTriple_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple1_Y;	(* Startpoint for first small tray *)
	ELSIF	(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1)
	THEN
		rProdLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayDouble_InY;
		rProdLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayDouble_InX;
		rTrayLength_InY	:= g_HMI_MCH_Parameters.rProdLengthTrayDouble_InY;
		rTrayLength_InX	:= g_HMI_MCH_Parameters.rProdLengthTrayDouble_InX;
		rMinimumTrayTrimSize :=	g_HMI_MCH_Parameters.rMinimumTrimSizeTrayDouble;
		FirstPoint.X := g_HMI_MCH_Parameters.rStartPointTrayDouble1_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayDouble_Y;	(* Startpoint for first small tray *)
	END_IF


	rSizeTrimRear 	:= SEL(g_HMI_RCP_Parameters.rSizeTrimFront > 0,0,MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimFront));(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)//12-05-2017
	rSizeTrimFront 	:= SEL(g_HMI_RCP_Parameters.rSizeTrimRear > 0,0,MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimRear));(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)//12-05-2017
	rSizeTrimRight 	:= SEL(g_HMI_RCP_Parameters.rSizeTrimRight > 0,0,MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimRight));
	rSizeTrimLeft 	:= SEL(g_HMI_RCP_Parameters.rSizeTrimLeft > 0,0,MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimLeft));

	rProdLength_InX	:= rProdLength_InX - rSizeTrimRight - rSizeTrimLeft;
	rProdLength_InY	:= rProdLength_InY - rSizeTrimRear - rSizeTrimFront;

	IF ( g_HMI_RCP_Parameters.bUseRectanglesInEight) (*AC 04-07-2013 Hierin wijzigingen voor 8 driehoeken uit stuk*)
	THEN
		(* Determine number of lines *)
		(*rNrOfLines	:=	(rProdLength_InX / rDistanceBetweenCutsX) - 1;
		nNrOfLines	:=	TRUNC_INT(rNrOfLines);
		nPartsX := nNrOfLines + 1; *)
		nPartsX := g_HMI_RCP_Parameters.nPartsX;			(* Standard V02.08 *)

		(*rNrOfLines	:= (rProdLength_InY / rDistanceBetweenCutsY) - 1;
		nNrOfLines	:= TRUNC_INT(rNrOfLines);
		nPartsY := nNrOfLines + 1; *)
		nPartsY := g_HMI_RCP_Parameters.nPartsY * 2;			(* Standard V02.08 *)

		rDistanceBetweenCutsX:=	(rProdLength_InX) / INT_TO_REAL(g_HMI_RCP_Parameters.nPartsX);
		rDistanceBetweenCutsY:=	(rProdLength_InY) / INT_TO_REAL(g_HMI_RCP_Parameters.nPartsY);


		rSizeOfWerkgebiedHor := rProdLength_InX;
		rSizeOfWerkgebiedVer := rProdLength_InY;
		rDeltaX := FirstPoint.X + rSizeTrimRight;			(* Standard V02.08 *)
		rDeltaY := FirstPoint.Y + rSizeTrimRear;

	(*	IF (TRUNC_INT(rSizeOfWerkgebiedVer / rDistanceBetweenCutsY) MOD 2) = 1 THEN	(* oneven aantal stukken *)
			nNrOfLinesDia	:= TRUNC_INT((rProdLength_InY / rDistanceBetweenCutsY)) +	TRUNC_INT(rProdLength_InX / rDistanceBetweenCutsX) -1;
		ELSE
			nNrOfLinesDia	:= TRUNC_INT((rProdLength_InY / rDistanceBetweenCutsY)) +	TRUNC_INT(rProdLength_InX / rDistanceBetweenCutsX)  -1;
		END_IF *)

		nNrOfLinesDia	:= g_HMI_RCP_Parameters.nPartsY + g_HMI_RCP_Parameters.nPartsX - 1;			(* Standard V02.08 *)
		g_rHoekInRad :=  ATAN(rDistanceBetweenCutsY /  (rDistanceBetweenCutsX)); (* hoek berekend *)
		g_rHoekInRad2 := C_rPi - ATAN(rDistanceBetweenCutsY /  (rDistanceBetweenCutsX)); (* hoek berekend *)

	ELSE(* NOT bUseRectanglesInEight *)

		rDistanceBetweenCutsX:=	(rProdLength_InX) / INT_TO_REAL(g_HMI_RCP_Parameters.nPartsX);
		rDistanceBetweenCutsY:=	(rProdLength_InY) / INT_TO_REAL(g_HMI_RCP_Parameters.nPartsY);
	
		(* Determine number of lines *)
		(*rNrOfLines	:=	(rProdLength_InX / rDistanceBetweenCutsX) - 1;
		nNrOfLines	:=	TRUNC_INT(rNrOfLines);
		nPartsX := nNrOfLines + 1; *)
		nPartsX := g_HMI_RCP_Parameters.nPartsX;			(* Standard V02.08 *)
	
		(*rNrOfLines	:= (rProdLength_InY / rDistanceBetweenCutsY) - 1;
		nNrOfLines	:= TRUNC_INT(rNrOfLines);
		nPartsY := nNrOfLines + 1; *)
		nPartsY := g_HMI_RCP_Parameters.nPartsY;			(* Standard V02.08 *)
	
		rSizeOfWerkgebiedHor := rProdLength_InX;
		rSizeOfWerkgebiedVer := rProdLength_InY;
	
		rDeltaX := FirstPoint.X + rSizeTrimRight;			(* Standard V02.08 *)
		rDeltaY := FirstPoint.Y + rSizeTrimRear;
	
		rDistanceBetweenCutsX := rDistanceBetweenCutsX;
		rDistanceBetweenCutsY := rDistanceBetweenCutsY * 2;		(* In Y richting dubbele afstand voor de diagonaal! *)
	
		(* Determine number of lines diagonal *)
		IF (nPartsY MOD 2) = 0 THEN
			nNrOfLinesDia:= nPartsX + (nPartsY / 2) - 1;
		ELSE
			nNrOfLinesDia:= nPartsX + (nPartsY / 2);
		END_IF
	
		g_rHoekInRad :=  ATAN(rDistanceBetweenCutsY /  rDistanceBetweenCutsX); (* hoek berekend *)
		g_rHoekInRad2 := C_rPi - ATAN(rDistanceBetweenCutsY /  rDistanceBetweenCutsX); (* hoek berekend *)
	END_IF
	(* General calculation part*)
	rLengthOfKnifeHor			:= rSizeOfKnife * COS(g_rHoekInRad);
	rLengthOfKnifeVer 			:= rSizeOfKnife * SIN(g_rHoekInRad);
	rCenterPointKnifeHor			:= rCenterPointKnife * COS(g_rHoekInRad);
	rCenterPointKnifeVer			:= rCenterPointKnife * SIN(g_rHoekInRad);
	rCenterPointKnifeHorInverted := rLengthOfKnifeHor - rCenterPointKnifeHor;
	rCenterPointKnifeVerInverted := rLengthOfKnifeVer - rCenterPointKnifeVer;

	FOR i :=1 TO nNrOfLinesDia DO
		nPosOpLijn := 0;(*		nPosOpLijn := 1;*)

		(* Startpunt van de lijn bepalen *)
		IF	i <= nPartsX THEN
			rStartPointLineX := (nPartsX - i) * rDistanceBetweenCutsX;
			rStartPointLineY := 0;
		ELSE
			rStartPointLineX := 0;
			rStartPointLineY := (i - nPartsX) * rDistanceBetweenCutsY;
		END_IF
		(* Eindpunt van de lijn bepalen *)
		IF	(nPartsY MOD 2) = 0 THEN
			IF	i <= (nPartsY/2) THEN
				rEndPointLineX := nPartsX * rDistanceBetweenCutsX;
				rEndPointLineY := i * rDistanceBetweenCutsY;
			ELSE
				rEndPointLineX := (nPartsX - i + (nPartsY / 2)) * rDistanceBetweenCutsX;
				rEndPointLineY := (nPartsY / 2) * rDistanceBetweenCutsY;
			END_IF
		ELSE
			IF	i <= (nPartsY/2) THEN
				rEndPointLineX := nPartsX * rDistanceBetweenCutsX;
				rEndPointLineY := i * rDistanceBetweenCutsY;
			ELSE
				rEndPointLineX := (nPartsX - i + (nPartsY / 2)) * rDistanceBetweenCutsX + (rDistanceBetweenCutsX / 2);;
				rEndPointLineY := (nPartsY / 2) * rDistanceBetweenCutsY + (rDistanceBetweenCutsY / 2);
			END_IF
		END_IF
		(*Calculate length of diagonal line*)
		rLength_X := (rEndPointLineX - rStartPointLineX);
		rLength_Y := (rEndPointLineY - rStartPointLineY);
		rLengthOfLine	:= SQRT((rLength_X * rLength_X) + (rLength_Y * rLength_Y));

		(*Calculate number of cuts*)
		rCutsPerLine := rLengthOfLine / rSizeOfKnife;
		nCutsPerLine := TRUNC_INT(rCutsPerLine);
		IF rCutsPerLine > nCutsPerLine THEN
			nCutsPerLine := nCutsPerLine + 1;
		END_IF

		(*Verplaatsingen bepalen*)
		IF nCutsPerLine = 1 THEN
			rStepDistX := rLengthOfLine/2 * COS(g_rHoekInRad);
			rStepDistY := rLengthOfLine/2 * SIN(g_rHoekInRad);
		ELSE
			rStepDistX := (rLengthOfLine - rSizeOfKnife)/(nCutsPerLine-1)* COS(g_rHoekInRad);
			rStepDistY := (rLengthOfLine - rSizeOfKnife)/(nCutsPerLine-1) * SIN(g_rHoekInRad);
		END_IF
		
		
		overshootSettings.MarginXMin := FirstPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);
		overshootSettings.MarginXMax := FirstPoint.X + rTrayLength_InX - MAX(rMinimumTrayTrimSize-0.1,1);  
		overshootSettings.MarginYMin := FirstPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);                    
		overshootSettings.MarginYMax := FirstPoint.Y + rTrayLength_InY - MAX(rMinimumTrayTrimSize-0.1,1);  
		overshootSettings.adjustXMin := FALSE;
		overshootSettings.adjustXMax := FALSE;
		overshootSettings.adjustYMin := FALSE;
		overshootSettings.adjustYMax := FALSE;

		IF NOT bToggle THEN (* mes van MaxX/MinY naar MinX/MaxY*)
			FOR c := 0 TO nCutsPerLine-1 DO
				IF nCutsPerLine = 1 THEN
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rStartPointLineX - rStepDistX + rDeltaX,           
									I_rY:=							rStartPointLineY + rStepDistY + rDeltaY,
									I_rA:=							((g_rHoekInRad2 / C_rPi) * 180),
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
						RETURN;
					END_IF  
					
					
				ELSE
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rStartPointLineX - rCenterPointKnifeHor - (c * rStepDistX) + rDeltaX,           
									I_rY:=							rStartPointLineY + rCenterPointKnifeVer + (c * rStepDistY) + rDeltaY,
									I_rA:=							((g_rHoekInRad2 / C_rPi) * 180),
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
						RETURN;
					END_IF  
					
					
				END_IF
				nPosOpLijn := nPosOpLijn + 1;
			END_FOR
		ELSE (* toggle, mes van linksonder naar rechtsboven *)
			FOR c := 0 TO nCutsPerLine-1 DO
				IF nCutsPerLine = 1 THEN
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rEndPointLineX + rStepDistX + rDeltaX,           
									I_rY:=							rEndPointLineY - rStepDistY + rDeltaY,
									I_rA:=							((g_rHoekInRad2 / C_rPi) * 180),
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
						RETURN;
					END_IF  
					
					
				ELSE
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rEndPointLineX + rCenterPointKnifeHor + (c * rStepDistX) + rDeltaX,           
									I_rY:=							rEndPointLineY - rCenterPointKnifeVer - (c * rStepDistY) + rDeltaY,
									I_rA:=							((g_rHoekInRad2 / C_rPi) * 180),
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
						RETURN;
					END_IF  
				END_IF
				nPosOpLijn := nPosOpLijn + 1;
			END_FOR
		END_IF
		bToggle := NOT bToggle;
	END_FOR

	(* Double the positions for the second tray if small trays is selected *)
	nLastPosFirstTray		:= g_sCuttingPositionsInfo.index-1;
	nLastWastePosFirstTray	:= g_sWastePositionsInfo.index-1;
	IF	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2
	THEN
	
		CopyPoint.X := FirstPoint.X;
		CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTraySmall2_Y;
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);(*C_rMinOvershootX*)       
		overshootSettings.MarginXMax := CopyPoint.X + rTrayLength_InX - MAX(rMinimumTrayTrimSize-0.1,1);  
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);                    
		overshootSettings.MarginYMax := CopyPoint.Y + rTrayLength_InY - MAX(rMinimumTrayTrimSize-0.1,1);  
		overshootSettings.adjustXMin := FALSE;
		overshootSettings.adjustXMax := false;
		overshootSettings.adjustYMin := false;
		overshootSettings.adjustYMax := false;
	
	
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

	(* Triple the positions for the second and third tray if triple trays is selected *)
	IF	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4
	THEN
	
	
		CopyPoint.X := FirstPoint.X;
		CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple2_Y;
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);(*C_rMinOvershootX*)       
		overshootSettings.MarginXMax := CopyPoint.X + rTrayLength_InX - MAX(rMinimumTrayTrimSize-0.1,1);  
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);                    
		overshootSettings.MarginYMax := CopyPoint.Y + rTrayLength_InY - MAX(rMinimumTrayTrimSize-0.1,1);  
		overshootSettings.adjustXMin := FALSE;
		overshootSettings.adjustXMax := false;
		overshootSettings.adjustYMin := false;
		overshootSettings.adjustYMax := false;
	
	
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
		CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple4_Y;
	
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);(*C_rMinOvershootX*)       
		overshootSettings.MarginXMax := CopyPoint.X + rTrayLength_InX - MAX(rMinimumTrayTrimSize-0.1,1);  
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);                    
		overshootSettings.MarginYMax := CopyPoint.Y + rTrayLength_InY - MAX(rMinimumTrayTrimSize-0.1,1);  
		overshootSettings.adjustXMin := FALSE;
		overshootSettings.adjustXMax := false;
		overshootSettings.adjustYMin := false;
		overshootSettings.adjustYMax := false;
	
	
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

	(* 2x positions the positions for the second tray if double trays side by side *)
	IF	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1
	THEN
	
		CopyPoint.X := g_HMI_MCH_Parameters.rStartPointTrayDouble2_X;
		CopyPoint.Y := FirstPoint.Y;
		
		overshootSettings.MarginXMin := CopyPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);(*C_rMinOvershootX*)       
		overshootSettings.MarginXMax := CopyPoint.X + rTrayLength_InX - MAX(rMinimumTrayTrimSize-0.1,1);  
		overshootSettings.MarginYMin := CopyPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);                    
		overshootSettings.MarginYMax := CopyPoint.Y + rTrayLength_InY - MAX(rMinimumTrayTrimSize-0.1,1);  
		overshootSettings.adjustXMin := FALSE;
		overshootSettings.adjustXMax := false;
		overshootSettings.adjustYMin := false;
		overshootSettings.adjustYMax := false;
	
	
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
Calc_Dia2_Compact				:= TRUE;

END_FUNCTION
