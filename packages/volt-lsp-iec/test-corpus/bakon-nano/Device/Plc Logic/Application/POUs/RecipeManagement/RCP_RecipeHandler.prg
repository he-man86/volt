PROGRAM RCP_RecipeHandler
VAR
	{warning 'Disabled for compatibility SVE'}
	//DiffLogger								: DifferenceLogger;
	bOldRect : BOOL;
	bOldEight : BOOL;
END_VAR

(*Reset recipe*)
IF		g_HMI_MachCommand.CMD.bResetRecipe
THEN

		g_HMI_RCP_Parameters.nProductType				:= Prod_Tray_Rectangle_1x1;
		g_HMI_RCP_Parameters.rStartHeightKnife			:= 60;		(* Starthoogte, gemeten vanaf onderzijde mes tot aan de tafel *)
		g_HMI_RCP_Parameters.rStopHeightKnife			:= 0;		(* Stophoogte, gemeten vanaf onderzijde mes tot aan de tafel *)
		g_HMI_RCP_Parameters.nPartsRound				:= 12;			(*aantal stukken ronde taart *)
		g_HMI_RCP_Parameters.nPartsX					:= 5;			(*aantal stukken in X richting*)
		g_HMI_RCP_Parameters.nPartsY					:= 5;			(*aantal stukken in Y richting*)
		g_HMI_RCP_Parameters.rAngleInDegrees			:= 55;		(* Angle in degrees when producttype is diagonal *)
		g_HMI_RCP_Parameters.rProdLength_InX			:= 500;		(* Size of slab in line with the belt*)
		g_HMI_RCP_Parameters.rProdLength_InY			:= 300;		(* Size of slab perpendicular to the belt*)
		g_HMI_RCP_Parameters.rUSHeightStart			:= 60;		(* Start height ultrasonic generator (position Z-axis) *)
		g_HMI_RCP_Parameters.rUSHeightStop			:= 60;		(* Stop height ultrasonic generator (position Z-axis) *)
		g_HMI_RCP_Parameters.dwUltrasonicPower1		:= 50;
		g_HMI_RCP_Parameters.rCutSpeedZ_Down1		:= 50;			(* neergaande snelheid boven product in %*)
		g_HMI_RCP_Parameters.rCutSpeedZ_Down2		:= 50;			(* neergaande snelheid in het product in %*)
		g_HMI_RCP_Parameters.rCutSpeedZ_Up1			:= 50;			(* opgaande snelheid in het product in %*)
		g_HMI_RCP_Parameters.rSizeTrimRight			:= 8;		(*grootte van de afvalrand in de X richting aan de rechterzijde*)
		g_HMI_RCP_Parameters.rSizeTrimLeft			:= 8;		(*grootte van de afvalrand in de X richting aan de linkerzijde*)
		g_HMI_RCP_Parameters.rSizeTrimRear				:= 8;		(*grootte van de afvalrand in de Y richting aan de achterzijde*)
		g_HMI_RCP_Parameters.rSizeTrimFront			:= 8;		(*grootte van de afvalrand in de Y richting aan de voorzijde*)
		g_HMI_RCP_Parameters.rMidPosOffsetRound1X	:= 0;		(* For round products *)
		g_HMI_RCP_Parameters.rMidPosOffsetRound1Y	:= 0;		(* For round products *)
		g_HMI_RCP_Parameters.rMidPosOffsetRound2X	:= 0;		(* For round products *)
		g_HMI_RCP_Parameters.rMidPosOffsetRound2Y	:= 0;		(* For round products *)
		g_HMI_RCP_Parameters.bUseRectanglesForTriangles	:= FALSE;	(* For triangles only *)
		g_HMI_RCP_Parameters.rPartSizeX					:= 50;		(* For triangles only *)
		g_HMI_RCP_Parameters.rPartSizeY					:= 50;		(* For triangles only *)
		g_HMI_RCP_Parameters.rShiftCompensation		:= 0;

		g_HMI_MachCommand.CMD.bResetRecipe		:= FALSE;
		g_HMI_bRecipeIsReset								:= TRUE;

END_IF

(* Recept variabele driehoek in tray resetten indien deze keuze niet gemaakt is in de product optie pagina *)
IF NOT g_HMI_dwProductOptions.15 THEN
	g_HMI_RCP_Parameters.bTrianglesInTray := FALSE;
END_IF

(*Afvalrand limieten bepalen*) (*Minimaal een stuk van 10mm overhouden, maximale afvalrand van 500*)
CASE G_HMI_RCP_Parameters.nProductType OF
	Prod_Slab_Rectangle_1x1, Prod_Slab_Triangle_1x1, Prod_Slab_Diagonal_1x1, Prod_Slab_Rectangle_1x1_Clamp:	(*Slab products*)
	g_sHMI_Mach_UnitStatus.rWasteFrontMax 	:= MIN(500,(g_HMI_RCP_Parameters.rProdLength_InY - 10 - g_HMI_RCP_Parameters.rSizeTrimRear));
	g_sHMI_Mach_UnitStatus.rWasteRearMax 	:= MIN(500,(g_HMI_RCP_Parameters.rProdLength_InY - 10 - g_HMI_RCP_Parameters.rSizeTrimFront));
	g_sHMI_Mach_UnitStatus.rWasteRightMax 	:= MIN(500,(g_HMI_RCP_Parameters.rProdLength_InX - 10 - g_HMI_RCP_Parameters.rSizeTrimLeft));
	g_sHMI_Mach_UnitStatus.rWasteLeftMax 	:= MIN(500,(g_HMI_RCP_Parameters.rProdLength_InX - 10 - g_HMI_RCP_Parameters.rSizeTrimRight));

	Prod_Tray_Rectangle_1x2		:		(* ProductType = 4 = Tray Square Small *)
	g_sHMI_Mach_UnitStatus.rWasteFrontMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTraySmall_InY - 10 - g_HMI_RCP_Parameters.rSizeTrimRear));
	g_sHMI_Mach_UnitStatus.rWasteRearMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTraySmall_InY - 10 - g_HMI_RCP_Parameters.rSizeTrimFront));
	g_sHMI_Mach_UnitStatus.rWasteRightMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTraySmall_InX - 10 - g_HMI_RCP_Parameters.rSizeTrimLeft));
	g_sHMI_Mach_UnitStatus.rWasteLeftMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTraySmall_InX - 10 - g_HMI_RCP_Parameters.rSizeTrimRight));

	Prod_Tray_Rectangle_1x1		:		(* ProductType = 5 = Tray Square Large *)
	g_sHMI_Mach_UnitStatus.rWasteFrontMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTrayLarge_InY - 10 - g_HMI_RCP_Parameters.rSizeTrimRear));
	g_sHMI_Mach_UnitStatus.rWasteRearMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTrayLarge_InY - 10 - g_HMI_RCP_Parameters.rSizeTrimFront));
	g_sHMI_Mach_UnitStatus.rWasteRightMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTrayLarge_InX - 10 - g_HMI_RCP_Parameters.rSizeTrimLeft));
	g_sHMI_Mach_UnitStatus.rWasteLeftMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTrayLarge_InX - 10 - g_HMI_RCP_Parameters.rSizeTrimRight));

	Prod_Tray_Rectangle_1x4		:		(* ProductType = 6 = Tray Square 4 on a table *)
	g_sHMI_Mach_UnitStatus.rWasteFrontMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTrayTriple_InY - 10 - g_HMI_RCP_Parameters.rSizeTrimRear));
	g_sHMI_Mach_UnitStatus.rWasteRearMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTrayTriple_InY - 10 - g_HMI_RCP_Parameters.rSizeTrimFront));
	g_sHMI_Mach_UnitStatus.rWasteRightMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTrayTriple_InX - 10 - g_HMI_RCP_Parameters.rSizeTrimLeft));
	g_sHMI_Mach_UnitStatus.rWasteLeftMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTrayTriple_InX - 10 - g_HMI_RCP_Parameters.rSizeTrimRight));

	Prod_Tray_Rectangle_2x1		:		(* ProductType = 8 = Tray square 2 side by side*)
	g_sHMI_Mach_UnitStatus.rWasteFrontMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTrayDouble_InY - 10 - g_HMI_RCP_Parameters.rSizeTrimRear));
	g_sHMI_Mach_UnitStatus.rWasteRearMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTrayDouble_InY - 10 - g_HMI_RCP_Parameters.rSizeTrimFront));
	g_sHMI_Mach_UnitStatus.rWasteRightMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTrayDouble_InX - 10 - g_HMI_RCP_Parameters.rSizeTrimLeft));
	g_sHMI_Mach_UnitStatus.rWasteLeftMax 	:= MIN(500,(g_HMI_MCH_Parameters.rProdLengthTrayDouble_InX - 10 - g_HMI_RCP_Parameters.rSizeTrimRight));

END_CASE

(*Minimale Afvalrand limieten bepalen*) 
CASE G_HMI_RCP_Parameters.nProductType OF
	Prod_Slab_Rectangle_1x1, Prod_Slab_Triangle_1x1, Prod_Slab_Diagonal_1x1, Prod_Slab_Rectangle_1x1_Clamp:	(*Slab products*)
	g_sHMI_Mach_UnitStatus.rWasteFrontMin 	:= 0; // was -50;
	g_sHMI_Mach_UnitStatus.rWasteRearMin 	:= 0; // was -50;
	g_sHMI_Mach_UnitStatus.rWasteRightMin 	:= 0; // was -50;
	g_sHMI_Mach_UnitStatus.rWasteLeftMin 	:= 0; // was -50;

	Prod_Tray_Rectangle_1x2, Prod_Tray_Rectangle_1x1, Prod_Tray_Rectangle_1x4, Prod_Tray_Rectangle_2x1 :	(* Tray products *)
	g_sHMI_Mach_UnitStatus.rWasteFrontMin 	:= 0;
	g_sHMI_Mach_UnitStatus.rWasteRearMin 	:= 0;
	g_sHMI_Mach_UnitStatus.rWasteRightMin 	:= 0;
	g_sHMI_Mach_UnitStatus.rWasteLeftMin 	:= 0;
END_CASE


(* Recept variabele driehoek in tray resetten indien deze keuze niet gemaakt is in de product optie pagina *)
IF NOT g_HMI_dwProductOptions.15 THEN
	g_HMI_RCP_Parameters.bTrianglesInTray := FALSE;
END_IF

(*Functioneren van checkboxes als radioboxes*)
IF g_HMI_RCP_Parameters.bUseRectanglesForTriangles AND bOldEight THEN
	g_HMI_RCP_Parameters.bUseRectanglesInEight := FALSE;
END_IF

IF g_HMI_RCP_Parameters.bUseRectanglesInEight AND bOldRect THEN
	g_HMI_RCP_Parameters.bUseRectanglesForTriangles := FALSE;
END_IF

bOldEight := g_HMI_RCP_Parameters.bUseRectanglesInEight;
bOldRect := g_HMI_RCP_Parameters.bUseRectanglesForTriangles;





IF NOT g_sRCPCopyMade THEN
	g_sRCPParCopy := g_HMI_RCP_Parameters;
	g_sRCPCopyMade	:= TRUE;
END_IF



(*DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.nProductType); DiffLogger.copy := __VARINFO(               g_sRCPParCopy.nProductType); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(               g_sRCPParCopy.nProductType), origStr := TO_STRING(g_HMI_RCP_Parameters.nProductType));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rStartHeightKnife); DiffLogger.copy := __VARINFO(          g_sRCPParCopy.rStartHeightKnife); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(          g_sRCPParCopy.rStartHeightKnife), origStr := TO_STRING(g_HMI_RCP_Parameters.rStartHeightKnife));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rStopHeightKnife); DiffLogger.copy := __VARINFO(           g_sRCPParCopy.rStopHeightKnife); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(           g_sRCPParCopy.rStopHeightKnife), origStr := TO_STRING(g_HMI_RCP_Parameters.rStopHeightKnife));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.nPartsRound); DiffLogger.copy := __VARINFO(                g_sRCPParCopy.nPartsRound); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(                g_sRCPParCopy.nPartsRound), origStr := TO_STRING(g_HMI_RCP_Parameters.nPartsRound));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.nPartsRoundRight); DiffLogger.copy := __VARINFO(           g_sRCPParCopy.nPartsRoundRight); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(           g_sRCPParCopy.nPartsRoundRight), origStr := TO_STRING(g_HMI_RCP_Parameters.nPartsRoundRight));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.nPartsX); DiffLogger.copy := __VARINFO(                    g_sRCPParCopy.nPartsX); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(                    g_sRCPParCopy.nPartsX), origStr := TO_STRING(g_HMI_RCP_Parameters.nPartsX));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.nPartsY); DiffLogger.copy := __VARINFO(                    g_sRCPParCopy.nPartsY); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(                    g_sRCPParCopy.nPartsY), origStr := TO_STRING(g_HMI_RCP_Parameters.nPartsY));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rAngleInDegrees); DiffLogger.copy := __VARINFO(            g_sRCPParCopy.rAngleInDegrees); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(            g_sRCPParCopy.rAngleInDegrees), origStr := TO_STRING(g_HMI_RCP_Parameters.rAngleInDegrees));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rProdLength_InX); DiffLogger.copy := __VARINFO(            g_sRCPParCopy.rProdLength_InX); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(            g_sRCPParCopy.rProdLength_InX), origStr := TO_STRING(g_HMI_RCP_Parameters.rProdLength_InX));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rProdLength_InY); DiffLogger.copy := __VARINFO(            g_sRCPParCopy.rProdLength_InY); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(            g_sRCPParCopy.rProdLength_InY), origStr := TO_STRING(g_HMI_RCP_Parameters.rProdLength_InY));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rUSHeightStart); DiffLogger.copy := __VARINFO(             g_sRCPParCopy.rUSHeightStart); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(             g_sRCPParCopy.rUSHeightStart), origStr := TO_STRING(g_HMI_RCP_Parameters.rUSHeightStart));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rUSHeightStop); DiffLogger.copy := __VARINFO(              g_sRCPParCopy.rUSHeightStop); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(              g_sRCPParCopy.rUSHeightStop), origStr := TO_STRING(g_HMI_RCP_Parameters.rUSHeightStop));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.dwUltrasonicPower1); DiffLogger.copy := __VARINFO(         g_sRCPParCopy.dwUltrasonicPower1); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(         g_sRCPParCopy.dwUltrasonicPower1), origStr := TO_STRING(g_HMI_RCP_Parameters.dwUltrasonicPower1));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rCutSpeedZ_Down1); DiffLogger.copy := __VARINFO(           g_sRCPParCopy.rCutSpeedZ_Down1); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(           g_sRCPParCopy.rCutSpeedZ_Down1), origStr := TO_STRING(g_HMI_RCP_Parameters.rCutSpeedZ_Down1));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rCutSpeedZ_Down2); DiffLogger.copy := __VARINFO(           g_sRCPParCopy.rCutSpeedZ_Down2); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(           g_sRCPParCopy.rCutSpeedZ_Down2), origStr := TO_STRING(g_HMI_RCP_Parameters.rCutSpeedZ_Down2));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rCutSpeedZ_Up1); DiffLogger.copy := __VARINFO(             g_sRCPParCopy.rCutSpeedZ_Up1); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(             g_sRCPParCopy.rCutSpeedZ_Up1), origStr := TO_STRING(g_HMI_RCP_Parameters.rCutSpeedZ_Up1));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rSizeTrimRight); DiffLogger.copy := __VARINFO(             g_sRCPParCopy.rSizeTrimRight); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(             g_sRCPParCopy.rSizeTrimRight), origStr := TO_STRING(g_HMI_RCP_Parameters.rSizeTrimRight));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rSizeTrimLeft); DiffLogger.copy := __VARINFO(              g_sRCPParCopy.rSizeTrimLeft); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(              g_sRCPParCopy.rSizeTrimLeft), origStr := TO_STRING(g_HMI_RCP_Parameters.rSizeTrimLeft));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rSizeTrimRear); DiffLogger.copy := __VARINFO(              g_sRCPParCopy.rSizeTrimRear); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(              g_sRCPParCopy.rSizeTrimRear), origStr := TO_STRING(g_HMI_RCP_Parameters.rSizeTrimRear));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rSizeTrimFront); DiffLogger.copy := __VARINFO(             g_sRCPParCopy.rSizeTrimFront); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(             g_sRCPParCopy.rSizeTrimFront), origStr := TO_STRING(g_HMI_RCP_Parameters.rSizeTrimFront));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rDiameterRound); DiffLogger.copy := __VARINFO(             g_sRCPParCopy.rDiameterRound); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(             g_sRCPParCopy.rDiameterRound), origStr := TO_STRING(g_HMI_RCP_Parameters.rDiameterRound));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rMidPosOffsetRound1X); DiffLogger.copy := __VARINFO(       g_sRCPParCopy.rMidPosOffsetRound1X); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(       g_sRCPParCopy.rMidPosOffsetRound1X), origStr := TO_STRING(g_HMI_RCP_Parameters.rMidPosOffsetRound1X));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rMidPosOffsetRound1Y); DiffLogger.copy := __VARINFO(       g_sRCPParCopy.rMidPosOffsetRound1Y); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(       g_sRCPParCopy.rMidPosOffsetRound1Y), origStr := TO_STRING(g_HMI_RCP_Parameters.rMidPosOffsetRound1Y));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rMidPosOffsetRound2X); DiffLogger.copy := __VARINFO(       g_sRCPParCopy.rMidPosOffsetRound2X); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(       g_sRCPParCopy.rMidPosOffsetRound2X), origStr := TO_STRING(g_HMI_RCP_Parameters.rMidPosOffsetRound2X));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rMidPosOffsetRound2Y); DiffLogger.copy := __VARINFO(       g_sRCPParCopy.rMidPosOffsetRound2Y); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(       g_sRCPParCopy.rMidPosOffsetRound2Y), origStr := TO_STRING(g_HMI_RCP_Parameters.rMidPosOffsetRound2Y));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.bTrianglesInTray); DiffLogger.copy := __VARINFO(           g_sRCPParCopy.bTrianglesInTray); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(           g_sRCPParCopy.bTrianglesInTray), origStr := TO_STRING(g_HMI_RCP_Parameters.bTrianglesInTray));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.bUseRectanglesForTriangles); DiffLogger.copy := __VARINFO( g_sRCPParCopy.bUseRectanglesForTriangles); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING( g_sRCPParCopy.bUseRectanglesForTriangles), origStr := TO_STRING(g_HMI_RCP_Parameters.bUseRectanglesForTriangles));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.bUseRectanglesInEight); DiffLogger.copy := __VARINFO(      g_sRCPParCopy.bUseRectanglesInEight); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(      g_sRCPParCopy.bUseRectanglesInEight), origStr := TO_STRING(g_HMI_RCP_Parameters.bUseRectanglesInEight));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.bCutRoundInSequence); DiffLogger.copy := __VARINFO(        g_sRCPParCopy.bCutRoundInSequence); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(        g_sRCPParCopy.bCutRoundInSequence), origStr := TO_STRING(g_HMI_RCP_Parameters.bCutRoundInSequence));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.bCutWasteFirst); DiffLogger.copy := __VARINFO(             g_sRCPParCopy.bCutWasteFirst); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(             g_sRCPParCopy.bCutWasteFirst), origStr := TO_STRING(g_HMI_RCP_Parameters.bCutWasteFirst));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rPartSizeX); DiffLogger.copy := __VARINFO(                 g_sRCPParCopy.rPartSizeX); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(                 g_sRCPParCopy.rPartSizeX), origStr := TO_STRING(g_HMI_RCP_Parameters.rPartSizeX));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rPartSizeY); DiffLogger.copy := __VARINFO(                 g_sRCPParCopy.rPartSizeY); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(                 g_sRCPParCopy.rPartSizeY), origStr := TO_STRING(g_HMI_RCP_Parameters.rPartSizeY));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rShiftCompensation); DiffLogger.copy := __VARINFO(         g_sRCPParCopy.rShiftCompensation); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(         g_sRCPParCopy.rShiftCompensation), origStr := TO_STRING(g_HMI_RCP_Parameters.rShiftCompensation));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rSpeedTableXY); DiffLogger.copy := __VARINFO(              g_sRCPParCopy.rSpeedTableXY); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(              g_sRCPParCopy.rSpeedTableXY), origStr := TO_STRING(g_HMI_RCP_Parameters.rSpeedTableXY));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rCleaningTimeUltrasonic); DiffLogger.copy := __VARINFO(    g_sRCPParCopy.rCleaningTimeUltrasonic); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(    g_sRCPParCopy.rCleaningTimeUltrasonic), origStr := TO_STRING(g_HMI_RCP_Parameters.rCleaningTimeUltrasonic));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rCleaningTimeWater); DiffLogger.copy := __VARINFO(         g_sRCPParCopy.rCleaningTimeWater); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(         g_sRCPParCopy.rCleaningTimeWater), origStr := TO_STRING(g_HMI_RCP_Parameters.rCleaningTimeWater));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.rCleaningTimeAir); DiffLogger.copy := __VARINFO(           g_sRCPParCopy.rCleaningTimeAir); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(           g_sRCPParCopy.rCleaningTimeAir), origStr := TO_STRING(g_HMI_RCP_Parameters.rCleaningTimeAir));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.nCleanAfterNProd); DiffLogger.copy := __VARINFO(           g_sRCPParCopy.nCleanAfterNProd); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(           g_sRCPParCopy.nCleanAfterNProd), origStr := TO_STRING(g_HMI_RCP_Parameters.nCleanAfterNProd));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.nCleanProdOrCuts); DiffLogger.copy := __VARINFO(           g_sRCPParCopy.nCleanProdOrCuts); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(           g_sRCPParCopy.nCleanProdOrCuts), origStr := TO_STRING(g_HMI_RCP_Parameters.nCleanProdOrCuts));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.nCleanWithScraper); DiffLogger.copy := __VARINFO(          g_sRCPParCopy.nCleanWithScraper); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(          g_sRCPParCopy.nCleanWithScraper), origStr := TO_STRING(g_HMI_RCP_Parameters.nCleanWithScraper));
DiffLogger.orig := __VARINFO(g_HMI_RCP_Parameters.bMirrorDiagonals); DiffLogger.copy := __VARINFO(           g_sRCPParCopy.bMirrorDiagonals); DiffLogger(	Logger := ADR(g_Logger), copyStr := TO_STRING(           g_sRCPParCopy.bMirrorDiagonals), origStr := TO_STRING(g_HMI_RCP_Parameters.bMirrorDiagonals));
*)

END_PROGRAM
