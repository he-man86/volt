PROGRAM Recipes
VAR
	bSaveParAs	: BOOL;
	dtDateTime : DT;
	//Recipe Vars
	L_RecipeManager1: L_RecipeManager_Rcp;
	{attribute 'symbol':='readwrite'}
	sSelectedRecipeName: STRING;	
	{attribute 'symbol':='readwrite'}
	dwReturnValue: DWORD;
	{attribute 'symbol':='readwrite'}
	sRecipeNames: STRING(5000);	
	{attribute 'symbol':='readwrite'}
	sActiveRecipe: STRING;				// Recommended to make Retain
	//
	//MachPar Vars
	L_MachParManager1: L_RecipeManager;
	{attribute 'symbol':='readwrite'}
	sMachParName: STRING;	
	{attribute 'symbol':='readwrite'}
	sMachParNames: STRING(5000);	
	{attribute 'symbol':='readwrite'}
	sActiveMachPar: STRING;				// Recommended to make Retain
	{attribute 'symbol':='readwrite'}
	dwMachParReturnValue: DWORD;
	bSavePars	: BOOL;
	sParGeneratedName	: STRING;
	GetDateAndTime: rtclk.GetDateAndTime;

	dtDateAndTIme: DATE_AND_TIME;
	sDateAndTIme: STRING;
	sDateAndTIme1: STRING(255);
	sDateAndTIme2: STRING(255);
	sRecipeNamePar: STRING(255);
END_VAR

NETWORK 0 FBD
  LET en1 := TRUE;
  IF en1 THEN
  EXECUTE
IF g_HMI_MachCommand.CMD.bNewRecipe THEN
	g_HMI_RCP_Parameters_Visu.nProductType:=0;			(* ProductType = 0 = Slab Square *)
															(* ProductType = 1 = Slab triangle *)
															(* ProductType = 2 = Slab diagonal *)
															(* ProductType = 3 = Round Cake *)
															(* ProductType = 4 = Tray Square Small *)
															(* ProductType = 5 = Tray Square Large *)

	g_HMI_RCP_Parameters_Visu.rStartHeightKnife := 60;		(* Starthoogte, gemeten vanaf onderzijde mes tot aan de tafel *)
	g_HMI_RCP_Parameters_Visu.rStopHeightKnife:= 0;		(* Stophoogte, gemeten vanaf onderzijde mes tot aan de tafel *)
	g_HMI_RCP_Parameters_Visu.nPartsRound	:= 12;			(*aantal stukken ronde taart *)
	g_HMI_RCP_Parameters_Visu.nPartsRoundRight:= 12;			(*aantal stukken ronde taart op rechter positie*)
	g_HMI_RCP_Parameters_Visu.nPartsX	:= 5;			(*aantal stukken in X richting*)
	g_HMI_RCP_Parameters_Visu.nPartsY:= 5;			(*aantal stukken in Y richting*)
	g_HMI_RCP_Parameters_Visu.rAngleInDegrees	 := 40;		(* Angle in degrees when producttype is diagonal *)
	g_HMI_RCP_Parameters_Visu.rProdLength_InX	:=600;
	g_HMI_RCP_Parameters_Visu.rProdLength_InY	:=400;
	g_HMI_RCP_Parameters_Visu.rUSHeightStart:= 60;		(* Start height ultrasonic generator (position Z-axis) *)
	g_HMI_RCP_Parameters_Visu.rUSHeightStop:= 60;		(* Stop height ultrasonic generator (position Z-axis) *)
	g_HMI_RCP_Parameters_Visu.dwUltrasonicPower1:=50;
	g_HMI_RCP_Parameters_Visu.rCutSpeedZ_Down1:=50;			(* neergaande snelheid boven product in %*)
	g_HMI_RCP_Parameters_Visu.rCutSpeedZ_Down2:=50;			(* neergaande snelheid in het product in %*)
	g_HMI_RCP_Parameters_Visu.rCutSpeedZ_Up1:=50;			(* opgaande snelheid in het product in %*)
	g_HMI_RCP_Parameters_Visu.rSizeTrimRight:=60;		(*grootte van de afvalrand in de X richting aan de voorzijde*)
	g_HMI_RCP_Parameters_Visu.rSizeTrimLeft:=60;		(*grootte van de afvalrand in de X richting aan de achterzijde*)
	g_HMI_RCP_Parameters_Visu.rSizeTrimRear:=60;		(*grootte van de afvalrand in de Y richting aan de linkerzijde*)
	g_HMI_RCP_Parameters_Visu.rSizeTrimFront:=60;		(*grootte van de afvalrand in de Y richting aan de rechterzijde*)
	g_HMI_RCP_Parameters_Visu.rDiameterRound:=24;
	g_HMI_RCP_Parameters_Visu.rMidPosOffsetRound1X:= 0;		(* For round products *)
	g_HMI_RCP_Parameters_Visu.rMidPosOffsetRound1Y:= 0;		(* For round products *)
	g_HMI_RCP_Parameters_Visu.rMidPosOffsetRound2Y:= 0;		(* For round products *)
	g_HMI_RCP_Parameters_Visu.bTrianglesInTray:= FALSE;	(* For tray product *)
	g_HMI_RCP_Parameters_Visu.bUseRectanglesForTriangles:= FALSE;	(* For triangles only*)
	g_HMI_RCP_Parameters_Visu.bUseRectanglesInEight:= FALSE;	(* For triangles in tray only*)
	g_HMI_RCP_Parameters_Visu.bCutRoundInSequence	:=TRUE;
	g_HMI_RCP_Parameters_Visu.rPartSizeX	:= 50;	(* For triangles only *)
	g_HMI_RCP_Parameters_Visu.rPartSizeY := 50;	(* For triangles only *)
	g_HMI_RCP_Parameters_Visu.rShiftCompensation := 0;		(* For slab square only, compensation due to product shoved away during cutting (e.g. when product is slippery or frozen) *)
	g_HMI_RCP_Parameters_Visu.rSpeedTableXY := 100;	(* in % *)
	g_HMI_RCP_Parameters_Visu.rCleaningTimeUltrasonic	:= 5;		(* in sec *)
	g_HMI_RCP_Parameters_Visu.rCleaningTimeWater:= 5;		(* in sec *)
	g_HMI_RCP_Parameters_Visu.rCleaningTimeAir:= 5;		(* in sec *)
	g_HMI_RCP_Parameters_Visu.nCleanAfterNProd := 1;
	g_HMI_RCP_Parameters_Visu.nCleanProdOrCuts :=0;			(* Cleaning after number of products or after number of cuts. 0 = product, 1 = cuts *)
	g_HMI_RCP_Parameters_Visu.nCleanWithScraper:=1;			(* V10.01 Cleaning cycle with the use of *)
														(*        0 = Water and scraper *)
														(*        1 = Scraper only *)
														(*        2 = Water only *)
														
	g_HMI_RCP_Parameters_Visu.bMirrorDiagonals := FALSE;
END_IF
  END_EXECUTE
  END_IF
END_NETWORK
NETWORK 1 FBD
  L_RecipeManager1(xEnable := TRUE, sDatabaseName := 'Recipes', sSelectedRecipeName := sSelectedRecipeName, xRecipe_Load := g_HMI_MachCommand.CMD.bLoadRecipe, xRecipe_New := g_HMI_MachCommand.CMD.bNewRecipe, xRecipe_Edit := g_HMI_MachCommand.CMD.bEditRecipe, xRecipe_Save := g_HMI_MachCommand.CMD.bSaveRecipe, xRecipe_Copy := g_HMI_MachCommand.CMD.bCopyRecipe, xRecipe_Delete := g_HMI_MachCommand.CMD.bDeleteRecipe, xRecipe_Update := g_HMI_MachCommand.CMD.bUpdateRecipe, scRecipeVisu := g_HMI_RCP_Parameters_Visu, scRecipePLC := g_HMI_RCP_Parameters, sRecipeNames => sRecipeNames, dwReturnValue => dwReturnValue);
END_NETWORK
NETWORK 2 FBD
  // Generate machinepar name based on system time.
  GetDateAndTime(xExecute := g_HMI_MachCommand.CMD.bSaveMachPar, dtDateAndTime => dtDateAndTIme);
END_NETWORK
NETWORK 3 FBD
  sDateAndTIme := TO_STRING(dtDateAndTIme);
END_NETWORK
NETWORK 4 FBD
  sDateAndTIme1 := DELETE(sDateAndTIme, 4, 0);
END_NETWORK
NETWORK 5 FBD
  sDateAndTIme2 := REPLACE(sDateAndTIme1, 'h', 1, 14);
END_NETWORK
NETWORK 6 FBD
  sRecipeNamePar := REPLACE(sDateAndTIme2, 'm', 1, 17);
END_NETWORK
NETWORK 7 FBD
  LET en1 := TRUE;
  IF en1 THEN
  EXECUTE
IF g_HMI_MachCommand.CMD.bSaveMachPar AND GetDateAndTime.xDone THEN
	sMachParName := sRecipeNamePar;
	bSavePars := TRUE;
	g_HMI_MachCommand.CMD.bSaveMachPar := FALSE;
END_IF
  END_EXECUTE
  END_IF
END_NETWORK
NETWORK 8 FBD
END_NETWORK
NETWORK 9 FBD
  L_MachParManager1(xEnable := TRUE, sDatabaseName := 'MachPar', sRecipeName := sMachParName, xRecipe_Delete := g_HMI_MachCommand.CMD.bDeleteMachPar, xRecipe_Load := g_HMI_MachCommand.CMD.bLoadMachPar, xRecipe_Save := bSaveParAs, xRecipe_SaveAs := bSavePars, sActiveRecipe := sActiveMachPar, sRecipeNames => sMachParNames, dwReturnValue => dwMachParReturnValue);
END_NETWORK

END_PROGRAM
