FUNCTION Calc_Dia1_Compact : bool
VAR
	rSizeOfWerkgebiedHor: REAL;
	rSizeOfWerkgebiedVer: REAL;
	rDeltaX: REAL;
	rDeltaY: REAL;
	rDistanceBetweenCutsX: REAL;
	rDistanceBetweenCutsY: REAL;
	nNrOfLinesDia: INT;
	rLengthOfKnifeHor: REAL;
	rLengthOfKnifeVer: REAL;
	rCenterPointKnifeHor: REAL;
	rCenterPointKnifeVer: REAL;
	rCenterPointKnifeHorInverted: REAL;
	rCenterPointKnifeVerInverted: REAL;
	i: INT;
	c: INT;
	nPosOpLijn: INT;

	//CorrectOvershootDia1SlabTriangleA		: CorrectOvershootDia1SlabV1;
	//CorrectOvershootDia1SlabTriangleB	: CorrectOvershootDia1SlabV1;
	//CorrectOvershootDia1SlabDiagonalA	: CorrectOvershootDia1SlabV1;
	//CorrectOvershootDia1SlabDiagonalB	: CorrectOvershootDia1SlabV1;
    //
	//CorrectOvershootDia1RoundCakeA		: CorrectOvershootDia1RoundV1;
	//CorrectOvershootDia1RoundCakeB		: CorrectOvershootDia1RoundV1;
	//CorrectOvershootDia1RoundCakeC		: CorrectOvershootDia1RoundV1;
	//CorrectOvershootDia1RoundCakeD		: CorrectOvershootDia1RoundV1;
	//CorrectOvershootDia1RoundCakeE		: CorrectOvershootDia1RoundV1;
	//CorrectOvershootDia1RoundCakeF		: CorrectOvershootDia1RoundV1;
    //
	//CorrectOvershootDia1TrayTriangleA		: CorrectOvershootDia1TrayV1;
	//CorrectOvershootDia1TrayTriangleB		: CorrectOvershootDia1TrayV1;
	//CorrectOvershootDia1TrayTriangleC		: CorrectOvershootDia1TrayV1;
	//CorrectOvershootDia1TrayTriangleD		: CorrectOvershootDia1TrayV1;
	//CorrectOvershootDia1TrayTriangleE		: CorrectOvershootDia1TrayV1;
	//CorrectOvershootDia1TrayTriangleF		: CorrectOvershootDia1TrayV1;
	//CorrectOvershootDia1TrayTriangleG		: CorrectOvershootDia1TrayV1;

	rSizeTrimRear	:REAL;
	rSizeTrimFront	:REAL;
	rSizeTrimRight	:REAL;
	rSizeTrimLeft	:REAL;

	bToggle: BOOL;
	rBeen1: REAL;
	rBeen2: REAL;
	rDistanceBetweenCutsDia: REAL;
	rNrOfLinesDia: REAL;
	rSizeOfKnife: REAL;
	rCenterPointKnifeInverted: REAL;
	rProdLength_InY :REAL;
	rProdLength_InX :REAL;
	rNrOfLines	: REAL;
	nNrOfLines	: INT;
	nPartsX	: INT;
	nPartsY	: INT;
	rWasteExtra : REAL;
	nCutsPerLine: INT;
	rCutsPerLine: REAL;
	rLengthOfLine: REAL;

	rStepDistX :REAL;
	rStepDistY :REAL;

	//rStartPointSlab_X: REAL;
	//rStartPointSlab_Y: REAL;
	rStartPointLineX: REAL;
	rStartPointLineY: REAL;

	rEndPointLineX: REAL;
	rEndPointLineY: REAL;
	rLength_Y: REAL;
	rLength_X: REAL;
	nPartsRound: INT;
	rPartsRound: REAL;
	nPartsRoundRight: INT;
	rPartsRoundRight: REAL;	
	rDiameterTaart: REAL;
	rRotatiehoek: ARRAY[1..35] OF REAL;
	//nFirstPos: INT;
	//nLastPos: INT;
	rCenterPointKnife: REAL;
	rMinimumTrayTrimSize: REAL;
	rTrayLength_InY	:REAL;
	rTrayLength_InX	:REAL;

	FirstPoint					: Gonio_Point;
	CopyPoint					: Gonio_Point;
	overshootSettings 			: Gonio_Settings;
	nFirstPosFirstTray 		:INT;
	nLastPosFirstTray		: INT;
	nLastWastePosFirstTray	: INT;
	cutsToMake				: INT;
	rDistBetweenCakeBordersX	: REAL;
	rDistBetweenCakeBordersY	: REAL;

	rCenterBetweenCakeX			: REAL;
	rCenterBetweenCakeY			: REAL;
	
	// 2 different numbers of parts ( left and right )
	bCalcRoundF : BOOL ;

END_VAR

(* If slab diagonal or triangle *)
Calc_Dia1_Compact := FALSE;
bToggle	:= FALSE;
rSizeOfKnife					:= g_HMI_MCH_Parameters.rSizeOfKnife;
rCenterPointKnife				:= rSizeOfKnife/2;
rCenterPointKnifeInverted		:= rSizeOfKnife/2;
overshootSettings.knifeAxis		:= rCenterPointKnife;
overshootSettings.knifeLength	:= rSizeOfKnife;
overshootSettings.precision		:= 0.1;

nFirstPosFirstTray := g_sCuttingPositionsInfo.index;

(**********************************************************************************************************************************)
(* Slab triangle *)
(**********************************************************************************************************************************)
IF            g_HMI_RCP_Parameters.nProductType = Prod_Slab_Triangle_1x1
                AND NOT (g_HMI_RCP_Parameters.bUseRectanglesForTriangles AND g_HMI_RCP_Parameters.bMirrorDiagonals)
THEN

	(* Offset of slab *)
	FirstPoint.X	:= g_HMI_MCH_Parameters.rStartPointSlab_X;
	FirstPoint.Y	:= g_HMI_MCH_Parameters.rStartPointSlab_Y;

	rProdLength_InX	:= g_HMI_RCP_Parameters.rProdLength_InX - MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) - MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft);
	rProdLength_InY	:= g_HMI_RCP_Parameters.rProdLength_InY - MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear) - MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront);

	IF (g_HMI_RCP_Parameters.nProductType = Prod_Slab_Diagonal_1x1) THEN
		rDeltaX := FirstPoint.X + g_HMI_RCP_Parameters.rSizeTrimRear;
		rDeltaY := FirstPoint.Y + g_HMI_RCP_Parameters.rSizeTrimLeft;(*KK 04-12-12: Omgedraaid vanaf HMI INstellingen*)

		(* berekenen aantal diagonale lijnen*)
		g_rHoekInRad := (g_HMI_RCP_Parameters.rAngleInDegrees / 180.0) * C_rPi; (* hoek in graden opgegeven op HMI *)
		rSizeOfWerkgebiedHor := g_HMI_RCP_Parameters.rProdLength_InX - g_HMI_RCP_Parameters.rSizeTrimRight - g_HMI_RCP_Parameters.rSizeTrimLeft;
		rSizeOfWerkgebiedVer := g_HMI_RCP_Parameters.rProdLength_InY - g_HMI_RCP_Parameters.rSizeTrimFront - g_HMI_RCP_Parameters.rSizeTrimRear;	
		
		rBeen1 := rSizeOfWerkgebiedHor * SIN(g_rHoekInRad);
		rBeen2 := rSizeOfWerkgebiedVer * COS(g_rHoekInRad);
		rDistanceBetweenCutsX := rSizeOfWerkgebiedHor / g_HMI_RCP_Parameters.nPartsX;
		rDistanceBetweenCutsY := TAN(g_rHoekInRad) * rSizeOfWerkgebiedHor / g_HMI_RCP_Parameters.nPartsX;
	
		rDistanceBetweenCutsDia := rBeen1 / g_HMI_RCP_Parameters.nPartsX;
		rNrOfLinesDia:= (rBeen1 + rBeen2) / rDistanceBetweenCutsDia;
		nNrOfLinesDia := REAL_TO_INT(rNrOfLinesDia);
		IF nNrOfLinesDia > rNrOfLinesDia THEN
			nNrOfLinesDia := nNrOfLinesDia -1;		(* alles achter de komma afronden naar beneden *)
		END_IF
		
		nPartsX := g_HMI_RCP_Parameters.nPartsX;
		nPartsY := TRUNC_INT(rProdLength_InY/rDistanceBetweenCutsY)*2;
		
	ELSIF ( g_HMI_RCP_Parameters.bUseRectanglesForTriangles)
	THEN
		g_rDistanceBetweenCuts_InX	:= g_HMI_RCP_Parameters.rPartSizeX;
		g_rDistanceBetweenCuts_InY	:= g_HMI_RCP_Parameters.rPartSizeY;
		(* Determine number of lines *)
		rNrOfLines	:=	(rProdLength_InX / g_rDistanceBetweenCuts_InX) - 1;
		nNrOfLines	:=	TRUNC_INT(rNrOfLines);
		nPartsX := nNrOfLines + 1;
		IF	nNrOfLines < rNrOfLines	(* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
		THEN
			rWasteExtra := (rProdLength_InX - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InX))/2;
			rSizeTrimRight 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) + rWasteExtra;
			rSizeTrimLeft 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft) + rWasteExtra;
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
			rSizeTrimRight 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) ;
			rSizeTrimLeft 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft);
		END_IF
		(* Uitrekenen left en right afvalrand *)
		rNrOfLines	:= (rProdLength_InY / g_rDistanceBetweenCuts_InY) - 1;
		nNrOfLines	:= TRUNC_INT(rNrOfLines);
		nPartsY := (nNrOfLines + 1) * 2;
		IF	nNrOfLines < rNrOfLines	(* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
		THEN
			rWasteExtra := (rProdLength_InY - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InY))/2;
			rSizeTrimRear	 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront) + rWasteExtra;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
			rSizeTrimFront 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear) + rWasteExtra;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
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
			rSizeTrimRear 		:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront) ;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
			rSizeTrimFront 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		END_IF
		rSizeOfWerkgebiedHor := g_HMI_RCP_Parameters.rProdLength_InX - MAX(0,rSizeTrimLeft) - MAX(0,rSizeTrimRight);
		rSizeOfWerkgebiedVer := g_HMI_RCP_Parameters.rProdLength_InY - MAX(0,rSizeTrimRear) - MAX(0,rSizeTrimFront);
		rDeltaX :=FirstPoint.X + rSizeTrimRight;			(* Standard V02.08 *)
		rDeltaY :=FirstPoint.Y + rSizeTrimRear;

		g_rDistanceBetweenCuts_InX	:= g_HMI_RCP_Parameters.rPartSizeX;
		g_rDistanceBetweenCuts_InY	:= g_HMI_RCP_Parameters.rPartSizeY;

		rDistanceBetweenCutsX	:= g_HMI_RCP_Parameters.rPartSizeX;
		rDistanceBetweenCutsY	:= g_HMI_RCP_Parameters.rPartSizeY;

		IF (TRUNC_INT(rSizeOfWerkgebiedVer / g_rDistanceBetweenCuts_InY) MOD 2) = 1 THEN	(* oneven aantal stukken *)
			nNrOfLinesDia	:= TRUNC_INT((rProdLength_InY / g_rDistanceBetweenCuts_InY)) +	TRUNC_INT(rProdLength_InX / g_rDistanceBetweenCuts_InX) -1;
		ELSE
			nNrOfLinesDia	:= TRUNC_INT((rProdLength_InY / g_rDistanceBetweenCuts_InY)) +	TRUNC_INT(rProdLength_InX / g_rDistanceBetweenCuts_InX)  -1;
		END_IF
		g_rHoekInRad :=  ATAN(rDistanceBetweenCutsY /  (rDistanceBetweenCutsX)); (* hoek berekend *)
		g_rHoekInRad2 := C_rPi - ATAN(rDistanceBetweenCutsY /  (rDistanceBetweenCutsX)); (* hoek berekend *)

	ELSE	(* NOT bUseRectanglesForTriangles *)

		g_rDistanceBetweenCuts_InX	:= g_HMI_RCP_Parameters.rPartSizeX;
		g_rDistanceBetweenCuts_InY	:= g_HMI_RCP_Parameters.rPartSizeY;
		(* Determine number of lines *)
		rNrOfLines	:=	(rProdLength_InX / g_rDistanceBetweenCuts_InX) - 1;
		nNrOfLines	:=	TRUNC_INT(rNrOfLines);
		nPartsX := nNrOfLines + 1;
		IF	nNrOfLines < rNrOfLines	(* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
		THEN
			rWasteExtra := (rProdLength_InX - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InX))/2;
			rSizeTrimRight 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) + rWasteExtra;
			rSizeTrimLeft 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft) + rWasteExtra;
		ELSE
			rSizeTrimRight 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight) ;
			rSizeTrimLeft 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft);
		END_IF
		(* Uitrekenen front en rear afvalrand *)
		rNrOfLines	:= (rProdLength_InY / g_rDistanceBetweenCuts_InY) - 1;
		nNrOfLines	:= TRUNC_INT(rNrOfLines);
		nPartsY := nNrOfLines + 1;
		IF	nNrOfLines < rNrOfLines	(* indien er nog product over is (afvalrand, dan aan weerszijden een afvalrand snijden *)
		THEN
			rWasteExtra := (rProdLength_InY - ((nNrOfLines +1)* g_rDistanceBetweenCuts_InY))/2;
			rSizeTrimRear	 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront) + rWasteExtra;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
			rSizeTrimFront 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear) + rWasteExtra;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		ELSE
			rSizeTrimRear 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
			rSizeTrimFront 	:= MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear);(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
		END_IF

		rSizeOfWerkgebiedHor := g_HMI_RCP_Parameters.rProdLength_InX - rSizeTrimLeft - rSizeTrimRight;
		rSizeOfWerkgebiedVer := g_HMI_RCP_Parameters.rProdLength_InY - rSizeTrimRear - rSizeTrimFront;
		rDeltaX := FirstPoint.X + rSizeTrimRight;			(* Standard V02.08 *)
		rDeltaY := FirstPoint.Y + rSizeTrimRear;

		rDistanceBetweenCutsX := g_HMI_RCP_Parameters.rPartSizeX ;
		rDistanceBetweenCutsY := g_HMI_RCP_Parameters.rPartSizeY * 2;		(* In Y richting dubbele afstand voor de diagonaal! *)

		(* Determine number of lines *)
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
			rStartPointLineX := i * rDistanceBetweenCutsX;
			rStartPointLineY := 0;
		ELSE
			rStartPointLineX := nPartsX * rDistanceBetweenCutsX;
			rStartPointLineY := (i - nPartsX) * rDistanceBetweenCutsY;
		END_IF
		(* Eindpunt van de lijn bepalen *)
		IF	(nPartsY MOD 2) = 0 THEN
			IF	i <= (nPartsY/2) OR (g_HMI_RCP_Parameters.nProductType = Prod_Slab_Diagonal_1x1) THEN	// MPreis V00.08
				rEndPointLineX := 0;
				rEndPointLineY := i * rDistanceBetweenCutsY;
				IF (g_HMI_RCP_Parameters.nProductType = Prod_Slab_Diagonal_1x1) AND rEndPointLineY > rSizeOfWerkgebiedVer THEN	// MPreis V00.08
					rEndPointLineX := (rEndPointLineY - rSizeOfWerkgebiedVer) / TAN(g_rHoekInRad);
					rEndPointLineY := rSizeOfWerkgebiedVer;					
				END_IF
			ELSE
				rEndPointLineX := (i - nPartsY / 2) * rDistanceBetweenCutsX;
				rEndPointLineY := (nPartsY / 2) * rDistanceBetweenCutsY;
			END_IF
		ELSE
			IF	i <= (nPartsY/2)OR (g_HMI_RCP_Parameters.nProductType = Prod_Slab_Diagonal_1x1) THEN	// MPreis V00.08
				rEndPointLineX := 0;
				rEndPointLineY := i * rDistanceBetweenCutsY;
				IF (g_HMI_RCP_Parameters.nProductType = Prod_Slab_Diagonal_1x1) AND rEndPointLineY > rSizeOfWerkgebiedVer THEN	// MPreis V00.08
					rEndPointLineX := (rEndPointLineY - rSizeOfWerkgebiedVer) / TAN(g_rHoekInRad);
					rEndPointLineY := rSizeOfWerkgebiedVer;					
				END_IF
			ELSE
				rEndPointLineX := (i - nPartsY / 2) * rDistanceBetweenCutsX - (rDistanceBetweenCutsX / 2);
				rEndPointLineY := (nPartsY / 2) * rDistanceBetweenCutsY + (rDistanceBetweenCutsY / 2);
			END_IF
		END_IF
		(*Calculate length of diagonal line*)
		rLength_X := (rStartPointLineX - rEndPointLineX);
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
		
		overshootSettings.MarginXMin := FirstPoint.X ; // zo komt het mes niet bij de schraper, was  C_rMinOvershootX;                                        
		overshootSettings.MarginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);
		overshootSettings.MarginYMin := C_rMinOvershootY;                                     
		overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL); 

		overshootSettings.adjustXMax := TRUE;
		overshootSettings.adjustXMin := FALSE; //zo komt het mes niet bij de schraper, was origineel TRUE
		overshootSettings.adjustYMax := TRUE;
		overshootSettings.adjustYMin := TRUE;
		

		IF NOT bToggle THEN (* mes van MaxX/MinY naar MinX/MaxY*)
			FOR c := 0 TO nCutsPerLine-1 DO
				IF NOT StorePos(I_rX:= 		SEL(nCutsPerLine = 1,
												rSizeOfWerkgebiedHor - rStartPointLineX + rCenterPointKnifeHor + (c * rStepDistX) + rDeltaX,
												rSizeOfWerkgebiedHor - rStartPointLineX + rStepDistX + rDeltaX),           
								I_rY:=			SEL(nCutsPerLine = 1,
												rStartPointLineY + rCenterPointKnifeVer + (c * rStepDistY) + rDeltaY,
												rStartPointLineY + rStepDistY + rDeltaY),  
								I_rA:=			((g_rHoekInRad / C_rPi) * 180),
								I_rK:=			0,
								I_bIsWaste :=	FALSE,
								I_sOvershootSettings := overshootSettings )
				THEN 
										RETURN;
				END_IF 
				
				nPosOpLijn := nPosOpLijn + 1;
			END_FOR
		ELSE (* toggle, mes van linksonder naar rechtsboven *)
			FOR c := 0 TO nCutsPerLine-1 DO
				IF NOT StorePos(I_rX:= 		SEL(nCutsPerLine = 1,
												rSizeOfWerkgebiedHor - rEndPointLineX - rCenterPointKnifeHor - (c * rStepDistX) + rDeltaX,
												rSizeOfWerkgebiedHor - rEndPointLineX - rStepDistX + rDeltaX),                     
								I_rY:=			SEL(nCutsPerLine = 1,
												rEndPointLineY - rCenterPointKnifeVer - (c * rStepDistY) + rDeltaY,
												rEndPointLineY - rStepDistY + rDeltaY),  
								I_rA:=			((g_rHoekInRad / C_rPi) * 180),
								I_rK:=			0,
								I_bIsWaste :=	FALSE,
								I_sOvershootSettings := overshootSettings )
				THEN 
										RETURN;
				END_IF 
				nPosOpLijn := nPosOpLijn + 1;
			END_FOR
		END_IF
		bToggle := NOT bToggle;
	END_FOR

(**********************************************************************************************************************************)
(* Slab diagonal *)
(**********************************************************************************************************************************)
ELSIF g_HMI_RCP_Parameters.nProductType = Prod_Slab_Diagonal_1x1		(* ProductType = 2 = Slab diagonal *)
THEN

	(* Offset of slab *)
	FirstPoint.X	:= g_HMI_MCH_Parameters.rStartPointSlab_X;
	FirstPoint.Y	:= g_HMI_MCH_Parameters.rStartPointSlab_Y;

	rSizeOfWerkgebiedHor := g_HMI_RCP_Parameters.rProdLength_InX - MAX(0,g_HMI_RCP_Parameters.rSizeTrimLeft) - MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight);
	rSizeOfWerkgebiedVer := g_HMI_RCP_Parameters.rProdLength_InY - MAX(0,g_HMI_RCP_Parameters.rSizeTrimRear) - MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront);
	rDeltaX := FirstPoint.X + MAX(0,g_HMI_RCP_Parameters.rSizeTrimRight);
	rDeltaY := FirstPoint.Y + MAX(0,g_HMI_RCP_Parameters.rSizeTrimFront);(*KK 04-12-12: Omgedraaid vanaf HMI INstellingen*)

	(* berekenen aantal diagonale lijnen*)
	g_rHoekInRad := (g_HMI_RCP_Parameters.rAngleInDegrees / 180.0) * C_rPi; (* hoek in graden opgegeven op HMI *)
	rBeen1 := rSizeOfWerkgebiedHor * SIN(g_rHoekInRad);
	rBeen2 := rSizeOfWerkgebiedVer * COS(g_rHoekInRad);
	rDistanceBetweenCutsX := rSizeOfWerkgebiedHor / g_HMI_RCP_Parameters.nPartsX;
	rDistanceBetweenCutsY := TAN(g_rHoekInRad) * rSizeOfWerkgebiedHor / g_HMI_RCP_Parameters.nPartsX;

	rDistanceBetweenCutsDia := rBeen1 / g_HMI_RCP_Parameters.nPartsX;
	rNrOfLinesDia:= (rBeen1 + rBeen2) / rDistanceBetweenCutsDia;
	nNrOfLinesDia := REAL_TO_INT(rNrOfLinesDia);
	IF nNrOfLinesDia > rNrOfLinesDia THEN
		nNrOfLinesDia := nNrOfLinesDia -1;		(* alles achter de komma afronden naar beneden *)
	END_IF
	rLengthOfKnifeHor := rSizeOfKnife * COS(g_rHoekInRad);
	rLengthOfKnifeVer := rSizeOfKnife * SIN(g_rHoekInRad);
	rCenterPointKnifeHor := rCenterPointKnife * COS(g_rHoekInRad);
	rCenterPointKnifeVer := rCenterPointKnife * SIN(g_rHoekInRad);
	rCenterPointKnifeHorInverted := rLengthOfKnifeHor - rCenterPointKnifeHor;
	rCenterPointKnifeVerInverted := rLengthOfKnifeVer - rCenterPointKnifeVer;
	
	overshootSettings.MarginXMin := FirstPoint.X ; // zo komt het mes niet bij de schraper, was  C_rMinOvershootX;                                        
	overshootSettings.MarginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);
	overshootSettings.MarginYMin := C_rMinOvershootY;                                     
	overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL); 

	overshootSettings.adjustXMax := TRUE;
	overshootSettings.adjustXMin := FALSE; //zo komt het mes niet bij de schraper, was origineel TRUE
	overshootSettings.adjustYMax := TRUE;
	overshootSettings.adjustYMin := TRUE;

	FOR i:=1 TO nNrOfLinesDia DO
		nPosOpLijn := 1;
		IF NOT bToggle THEN (* mes van rechtsboven naar linksonder *)
			REPEAT
				IF i <= (rSizeOfWerkgebiedVer / rDistanceBetweenCutsY) THEN
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rCenterPointKnifeHorInverted -
																							((nPosOpLijn-1) * rLengthOfKnifeHor) + rDeltaX,           
									I_rY:=							rDistanceBetweenCutsY * i - rCenterPointKnifeVerInverted -
																							((nPosOpLijn-1) * rLengthOfKnifeVer) + rDeltaY,
									I_rA:=							g_HMI_RCP_Parameters.rAngleInDegrees,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  

				ELSE
					IF NOT StorePos(I_rX:= 							((rSizeOfWerkgebiedVer - rDistanceBetweenCutsY *
																							((i - g_HMI_RCP_Parameters.nPartsX))) / TAN(g_rHoekInRad)) -
																						 	rCenterPointKnifeHorInverted - ((nPosOpLijn - 1) * rLengthOfKnifeHor) + rDeltaX,           
									I_rY:=							(rSizeOfWerkgebiedVer) - rCenterPointKnifeVerInverted -
																							((nPosOpLijn-1) * rLengthOfKnifeVer) + rDeltaY,
									I_rA:=							g_HMI_RCP_Parameters.rAngleInDegrees,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  

				END_IF

				nPosOpLijn := nPosOpLijn + 1;
			UNTIL (((g_aCuttingPositions[g_sCuttingPositionsInfo.index-1].X_Target) <= FirstPoint.X + rCenterPointKnifeHor) OR
					((g_aCuttingPositions[g_sCuttingPositionsInfo.index-1].Y_Target) <= FirstPoint.Y + rCenterPointKnifeVer))
			END_REPEAT
		ELSE (* toggle, mes van linksonder naar rechtsboven *)
			REPEAT
				IF i <= (g_HMI_RCP_Parameters.nPartsX) THEN
					IF NOT StorePos(I_rX:= 							(rSizeOfWerkgebiedHor) - (i * rDistanceBetweenCutsX) +
																								((nPosOpLijn-1) * rLengthOfKnifeHor) + rCenterPointKnifeHor + rDeltaX,           
									I_rY:=							((nPosOpLijn-1) * rLengthOfKnifeVer) + rCenterPointKnifeVer + rDeltaY,
									I_rA:=							g_HMI_RCP_Parameters.rAngleInDegrees,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  

				ELSE
					IF NOT StorePos(I_rX:= 							((nPosOpLijn-1) * rLengthOfKnifeHor) + rCenterPointKnifeHor + rDeltaX,           
									I_rY:=							((i - g_HMI_RCP_Parameters.nPartsX) * rDistanceBetweenCutsY) + rCenterPointKnifeVer +
																							 ((nPosOpLijn-1) * rLengthOfKnifeVer) + rDeltaY,
									I_rA:=							g_HMI_RCP_Parameters.rAngleInDegrees,
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
												RETURN;
					END_IF  
				END_IF
				nPosOpLijn := nPosOpLijn + 1;
			UNTIL ((g_aCuttingPositions[g_sCuttingPositionsInfo.index-1].X_Target >= (FirstPoint.X + g_HMI_RCP_Parameters.rProdLength_InX - rCenterPointKnifeHorInverted)) OR
					 (g_aCuttingPositions[g_sCuttingPositionsInfo.index-1].Y_Target >= (FirstPoint.Y + g_HMI_RCP_Parameters.rProdLength_InY - rCenterPointKnifeVerInverted)) )
			END_REPEAT
		END_IF
		bToggle := NOT bToggle;
	END_FOR

(**********************************************************************************************************************************)
(* Round cake *)
(**********************************************************************************************************************************)
ELSIF		g_HMI_RCP_Parameters.nProductType = Prod_Round_POC_2x1	(* ProductType = 4 = Round Cake  *)
			OR g_HMI_RCP_Parameters.nProductType = Prod_Round_POC_2x2
THEN

	(* Nieuwe berekening, nodig als mes kleiner is dan diameter taart. Dan moet een taart meerdere snijposities krijgen op de lijn.
		Recept parameter: Afmeting ronde taart (diameter).

		rCutsPerLine := Diameter taart / meslengte;
		nCutsPerLine := Naar boven afronden (rCutsPerLine);

		Als nCutsPerLine <= 1 dan snijden op middelpunt
		Als nCutsPerLine > 1 dan eerste positie op de lijn is MidPos + ((DiameterTaart - Mes lengte) / 2)
		De volgende positie op de lijn wordt + (Diameter taart / nCutsPerLine)
	*)

	nPartsRound			:= g_HMI_RCP_Parameters.nPartsRound;
	rPartsRound			:= nPartsRound;
	nPartsRoundRight	:= g_HMI_RCP_Parameters.nPartsRoundRight;
	rPartsRoundRight	:= nPartsRoundRight;
	
	rDiameterTaart	:= g_HMI_RCP_Parameters.rDiameterRound;
	
	(*Calculate number of cuts*)
	rCutsPerLine := rDiameterTaart / rSizeOfKnife;
	nCutsPerLine := TRUNC_INT(rCutsPerLine);
	IF rCutsPerLine > nCutsPerLine THEN
		nCutsPerLine := nCutsPerLine + 1;
	END_IF

	//Determain the XY position of the first cake, (Top left)
	//At the same time, determain the overshoot boundaries
	
	IF G_HMI_RCP_Parameters.nProductType = Prod_Round_POC_2x1 THEN
		FirstPoint.X := g_HMI_MCH_Parameters.rMidPosRoundCake1_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rMidPosRoundCake1_Y;
		
		//There are 2 cakes next to eachother, cutting the left cake
		rDistBetweenCakeBordersX := ABS(g_HMI_MCH_Parameters.rMidPosRoundCake1_X - g_HMI_MCH_Parameters.rMidPosRoundCake2_X) - g_HMI_RCP_Parameters.rDiameterRound; //Both cakes have the same diameter!
		IF rDistBetweenCakeBordersX < 0 THEN
			g_sMACH.ERR.bRoundProductsOverlap := TRUE;
		END_IF

		rCenterBetweenCakeX := ABS(g_HMI_MCH_Parameters.rMidPosRoundCake1_X - g_HMI_MCH_Parameters.rMidPosRoundCake2_X)/2; 
		
		overshootSettings.MarginXMin := FirstPoint.X - rCenterBetweenCakeX;		                              
		overshootSettings.MarginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);
		overshootSettings.MarginYMin := C_rMinOvershootY;                                        
		overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);;   
   
		overshootSettings.adjustXMin := FALSE; 	//There is another cake to the right, so dont adjust this.                        
		overshootSettings.adjustXMax := TRUE;
		overshootSettings.adjustYMin := TRUE;
		overshootSettings.adjustYMax := TRUE;
		
	ELSE // G_HMI_RCP_Parameters.nProductType = Prod_Round_POC_2x2
		
		FirstPoint.X := g_HMI_MCH_Parameters.rMidPosRoundCake13_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rMidPosRoundCake12_Y;
		
		//There are 2 cakes next to eachother, cutting the top left cake
		rDistBetweenCakeBordersX := ABS(g_HMI_MCH_Parameters.rMidPosRoundCake13_X - g_HMI_MCH_Parameters.rMidPosRoundCake24_X) - g_HMI_RCP_Parameters.rDiameterRound; //Both cakes have the same diameter!
		rDistBetweenCakeBordersY := ABS(g_HMI_MCH_Parameters.rMidPosRoundCake12_Y  - g_HMI_MCH_Parameters.rMidPosRoundCake34_Y) - g_HMI_RCP_Parameters.rDiameterRound; //Both cakes have the same diameter!
		IF rDistBetweenCakeBordersX < 0 OR rDistBetweenCakeBordersY < 0 THEN
			g_sMACH.ERR.bRoundProductsOverlap := TRUE;
		END_IF
		
		rCenterBetweenCakeX := ABS(g_HMI_MCH_Parameters.rMidPosRoundCake13_X - g_HMI_MCH_Parameters.rMidPosRoundCake24_X)/2; 
		rCenterBetweenCakeY := ABS(g_HMI_MCH_Parameters.rMidPosRoundCake12_Y - g_HMI_MCH_Parameters.rMidPosRoundCake34_y)/2;

		overshootSettings.MarginXMin := FirstPoint.X - rCenterBetweenCakeX;//rDistBetweenCakeBordersX / 2;		                              
		overshootSettings.MarginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);
		overshootSettings.MarginYMin := C_rMinOvershootY;                                        
		overshootSettings.MarginYMax := FirstPoint.Y + rCenterBetweenCakeY;//rDistBetweenCakeBordersY / 2;
   
		overshootSettings.adjustXMin := FALSE; 	//There is another cake to the right, so dont adjust this.                        
		overshootSettings.adjustXMax := TRUE;
		overshootSettings.adjustYMin := TRUE;
		overshootSettings.adjustYMax := FALSE; 	//There is another cake beneath this one, dont adjust this
		
	END_IF

	// Calculate 1st cake left (top) and ( if recipe is 2x2, left bottom )
	bCalcRoundF := Calc_Round(bIsLeftCake 		:= TRUE,
								//bRcp4Cakes 		:= G_HMI_RCP_Parameters.nProductType = Prod_Round_POC_2x2,
								nPartsRound 	:= nPartsRound,
								cutsToMake 		:= cutsToMake,
								rSizeOfKnife 	:= rSizeOfKnife,
								rCutsPerLine	:= rCutsPerLine,
								rRotatiehoek 	:= rRotatiehoek,
								FirstPoint		:= FirstPoint,
								overshootSettings := overshootSettings,
								//overshootSettings2 :=  overshootSettings2,
								);
								
	nLastPosFirstTray		:= g_sCuttingPositionsInfo.index-1;
	nLastWastePosFirstTray	:= g_sWastePositionsInfo.index-1;
	
	IF  G_HMI_RCP_Parameters.nProductType = Prod_Round_POC_2x2 THEN
		// determine the copy points for left bottom cake
		CopyPoint.X := g_HMI_MCH_Parameters.rMidPosRoundCake13_X;
		CopyPoint.Y := g_HMI_MCH_Parameters.rMidPosRoundCake34_Y;
		
		overshootSettings.MarginXMin := CopyPoint.X - rCenterBetweenCakeX;//rDistBetweenCakeBordersX / 2;	                              
		overshootSettings.MarginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);	 
		overshootSettings.MarginYMin := CopyPoint.Y - rCenterBetweenCakeY;//rDistBetweenCakeBordersY / 2;                                        
		overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);
		
		overshootSettings.adjustXMin := FALSE; 	
		overshootSettings.adjustXMax := TRUE;
		overshootSettings.adjustYMin := FALSE;
		overshootSettings.adjustYMax := TRUE; 
		
		//Copy the first to the second.
		IF nFirstPosFirstTray <= nLastPosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstPosFirstTray,
				I_lastIndex					:= nLastPosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,      // load overshootsettings for the 2nd cake!
				I_dataArray 				:= ADR(g_aCuttingPositions),
				I_bReverseOrder				:= FALSE,
				IQ_dataArrayInfo 			:= g_sCuttingPositionsInfo) 
			THEN
				RETURN;
			END_IF
		END_IF
	END_IF
	

	nFirstPosFirstTray := g_sCuttingPositionsInfo.index;
	
	//3rd cake (Right top)
	IF G_HMI_RCP_Parameters.nProductType = Prod_Round_POC_2x1 THEN
		FirstPoint.X := g_HMI_MCH_Parameters.rMidPosRoundCake2_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rMidPosRoundCake2_Y;

		overshootSettings.MarginXMin := C_rMinOvershootX;                            
		overshootSettings.MarginXMax := FirstPoint.X + rCenterBetweenCakeX;//rDistBetweenCakeBordersX / 2;
		overshootSettings.MarginYMin := C_rMinOvershootY;                                        
		overshootSettings.MarginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);;   
   
		overshootSettings.adjustXMin := TRUE; 	
		overshootSettings.adjustXMax := FALSE;
		overshootSettings.adjustYMin := TRUE;
		overshootSettings.adjustYMax := TRUE;
		
	ELSE // G_HMI_RCP_Parameters.nProductType = Prod_Round_POC_2x2
		
		FirstPoint.X := g_HMI_MCH_Parameters.rMidPosRoundCake24_X;
		FirstPoint.Y := g_HMI_MCH_Parameters.rMidPosRoundCake12_Y;

		overshootSettings.MarginXMin := C_rMinOvershootX;	                              
		overshootSettings.MarginXMax := FirstPoint.X + rCenterBetweenCakeX;//rDistBetweenCakeBordersX / 2;	
		overshootSettings.MarginYMin := C_rMinOvershootY;                                        
		overshootSettings.MarginYMax := FirstPoint.Y + rCenterBetweenCakeY ;//rDistBetweenCakeBordersY / 2;
   
		overshootSettings.adjustXMin := TRUE; 	
		overshootSettings.adjustXMax := FALSE;
		overshootSettings.adjustYMin := TRUE;
		overshootSettings.adjustYMax := FALSE; 
	END_IF
		
	bCalcRoundF := Calc_Round(bIsLeftCake 		:= FALSE,
								nPartsRound 	:= nPartsRoundRight,
								cutsToMake 		:= cutsToMake,
								rSizeOfKnife 	:= rSizeOfKnife,
								rCutsPerLine	:= rCutsPerLine,
								rRotatiehoek 	:= rRotatiehoek,
								FirstPoint		:= FirstPoint,
								overshootSettings := overshootSettings,
								);
								
	nLastPosFirstTray		:= g_sCuttingPositionsInfo.index-1;
	nLastWastePosFirstTray	:= g_sWastePositionsInfo.index-1;
	
	
	// 4th cake right bottom
	IF  G_HMI_RCP_Parameters.nProductType = Prod_Round_POC_2x2 THEN
		// determine the copy points
		CopyPoint.X := g_HMI_MCH_Parameters.rMidPosRoundCake24_X;
		CopyPoint.Y := g_HMI_MCH_Parameters.rMidPosRoundCake34_Y;
		
		overshootSettings.MarginXMin :=C_rMinOvershootX;	                                                  
		overshootSettings.MarginXMax :=CopyPoint.X + rCenterBetweenCakeX;//rDistBetweenCakeBordersX / 2;                         
		overshootSettings.MarginYMin :=CopyPoint.Y - rCenterBetweenCakeY;//rDistBetweenCakeBordersY / 2;                         
		overshootSettings.MarginYMax :=SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);           
                                                                                                           
		overshootSettings.adjustXMin :=TRUE; 	                                                                 
		overshootSettings.adjustXMax :=FALSE;                                                              
		overshootSettings.adjustYMin :=FALSE;                                                              
		overshootSettings.adjustYMax :=TRUE;                                                               
		
		//Copy the first to the second.
		IF nFirstPosFirstTray <= nLastPosFirstTray THEN
			IF NOT Calc_CopyCutsWithOffset(
				I_firstIndex				:= nFirstPosFirstTray,
				I_lastIndex					:= nLastPosFirstTray,
				I_dX 						:= CopyPoint.X - FirstPoint.X,
				I_dY 						:= CopyPoint.Y - FirstPoint.Y,
				I_overshootSettings 		:= overshootSettings,      // load overshootsettings for the 2nd cake!
				I_dataArray 				:= ADR(g_aCuttingPositions),
				I_bReverseOrder				:= FALSE,
				IQ_dataArrayInfo 			:= g_sCuttingPositionsInfo) 
			THEN
				RETURN;
			END_IF
		END_IF
	END_IF

(**********************************************************************************************************************************)
(* Triangles in tray *)
(**********************************************************************************************************************************)
ELSIF		(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x1
	OR	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2
	OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4
	OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1)
	AND g_HMI_RCP_Parameters.bTrianglesInTray
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

	(* Determine Trims *)
	rSizeTrimRear 	:= SEL(g_HMI_RCP_Parameters.rSizeTrimFront > 0,0,MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimFront));(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)//12-05-2017
	rSizeTrimFront 	:= SEL(g_HMI_RCP_Parameters.rSizeTrimRear > 0,0,MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimRear));(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)//12-05-2017
	rSizeTrimRight 	:= SEL(g_HMI_RCP_Parameters.rSizeTrimRight > 0,0,MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimRight));
	rSizeTrimLeft 	:= SEL(g_HMI_RCP_Parameters.rSizeTrimLeft > 0,0,MAX(rMinimumTrayTrimSize, g_HMI_RCP_Parameters.rSizeTrimLeft));

	rProdLength_InX	:= rProdLength_InX - rSizeTrimRight - rSizeTrimLeft;
	rProdLength_InY	:= rProdLength_InY - rSizeTrimRear - rSizeTrimFront;

	IF ( g_HMI_RCP_Parameters.bUseRectanglesInEight OR g_HMI_RCP_Parameters.bUseRectanglesForTriangles) (*AC 04-07-2013 Hierin wijzigingen voor 8 driehoeken uit stuk*)
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

	ELSE	(* NOT bUseRectanglesForTriangles *)

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

		rDistanceBetweenCutsX := rDistanceBetweenCutsX ;
		rDistanceBetweenCutsY := rDistanceBetweenCutsY * 2;		(* In Y richting dubbele afstand voor de diagonaal! *)

		(* Determine number of lines *)
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
			rStartPointLineX := i * rDistanceBetweenCutsX;
			rStartPointLineY := 0;
		ELSE
			rStartPointLineX := nPartsX * rDistanceBetweenCutsX;
			rStartPointLineY := (i - nPartsX) * rDistanceBetweenCutsY;
		END_IF
		(* Eindpunt van de lijn bepalen *)
		IF	(nPartsY MOD 2) = 0 THEN
			IF	i <= (nPartsY/2) THEN
				rEndPointLineX := 0;
				rEndPointLineY := i * rDistanceBetweenCutsY;
			ELSE
				rEndPointLineX := (i - nPartsY / 2) * rDistanceBetweenCutsX;
				rEndPointLineY := (nPartsY / 2) * rDistanceBetweenCutsY;
			END_IF
		ELSE
			IF	i <= (nPartsY/2) THEN
				rEndPointLineX := 0;
				rEndPointLineY := i * rDistanceBetweenCutsY;
			ELSE
				rEndPointLineX := (i - nPartsY / 2) * rDistanceBetweenCutsX - (rDistanceBetweenCutsX / 2);
				rEndPointLineY := (nPartsY / 2) * rDistanceBetweenCutsY + (rDistanceBetweenCutsY / 2);
			END_IF
		END_IF
		(*Calculate length of diagonal line*)
		rLength_X := (rStartPointLineX - rEndPointLineX);
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
		
		overshootSettings.MarginXMin := FirstPoint.X + MAX(rMinimumTrayTrimSize-0.1,1);(*C_rMinOvershootX*)       
		overshootSettings.MarginXMax := FirstPoint.X + rTrayLength_InX - MAX(rMinimumTrayTrimSize-0.1,1);  
		overshootSettings.MarginYMin := FirstPoint.Y + MAX(rMinimumTrayTrimSize-0.1,1);                    
		overshootSettings.MarginYMax := FirstPoint.Y + rTrayLength_InY - MAX(rMinimumTrayTrimSize-0.1,1);  
		overshootSettings.adjustXMin := FALSE;
		overshootSettings.adjustXMax := false;
		overshootSettings.adjustYMin := false;
		overshootSettings.adjustYMax := false;

		IF NOT bToggle THEN (* mes van MaxX/MinY naar MinX/MaxY*)
			FOR c := 0 TO nCutsPerLine-1 DO
				IF nCutsPerLine = 1 THEN
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rStartPointLineX + rStepDistX + rDeltaX,           
									I_rY:=							rStartPointLineY + rStepDistY + rDeltaY,
									I_rA:=							((g_rHoekInRad / C_rPi) * 180),
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
						RETURN;
					END_IF  
				ELSE
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rStartPointLineX + rCenterPointKnifeHor + (c * rStepDistX) + rDeltaX,           
									I_rY:=							rStartPointLineY + rCenterPointKnifeVer + (c * rStepDistY) + rDeltaY,
									I_rA:=							((g_rHoekInRad / C_rPi) * 180),
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
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rEndPointLineX - rStepDistX + rDeltaX,           
									I_rY:=							rEndPointLineY - rStepDistY + rDeltaY,
									I_rA:=							((g_rHoekInRad / C_rPi) * 180),
									I_rK:=							0,
									I_bIsWaste :=					FALSE,
									I_sOvershootSettings := 		overshootSettings)
					THEN 
						RETURN;
					END_IF  
					
					
				ELSE
					IF NOT StorePos(I_rX:= 							rSizeOfWerkgebiedHor - rEndPointLineX - rCenterPointKnifeHor - (c * rStepDistX) + rDeltaX,           
									I_rY:=							rEndPointLineY - rCenterPointKnifeVer - (c * rStepDistY) + rDeltaY,
									I_rA:=							((g_rHoekInRad / C_rPi) * 180),
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
		CopyPoint.Y := g_HMI_MCH_Parameters.rStartPointTrayTriple3_Y;
	
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

		(*Fourth Tray*)
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
				I_bReverseOrder				:= TRUE,
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
				I_bReverseOrder				:= TRUE,
				IQ_dataArrayInfo 			:= g_sCuttingPositionsInfo) 
			THEN
				RETURN;
			END_IF
		END_IF
	END_IF
END_IF
Calc_Dia1_Compact := true;

END_FUNCTION
