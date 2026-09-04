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
  IF en1 THEN EXECUTE(); END_IF
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
  IF en1 THEN EXECUTE(); END_IF
END_NETWORK
NETWORK 8 FBD
END_NETWORK
NETWORK 9 FBD
  L_MachParManager1(xEnable := TRUE, sDatabaseName := 'MachPar', sRecipeName := sMachParName, xRecipe_Delete := g_HMI_MachCommand.CMD.bDeleteMachPar, xRecipe_Load := g_HMI_MachCommand.CMD.bLoadMachPar, xRecipe_Save := bSaveParAs, xRecipe_SaveAs := bSavePars, sActiveRecipe := sActiveMachPar, sRecipeNames => sMachParNames, dwReturnValue => dwMachParReturnValue);
END_NETWORK

END_PROGRAM
