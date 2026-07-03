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

NETWORK 1 FBD
  LET en1 := TRUE;
  IF en1 THEN LET g1 := EXECUTE(); END_IF
END_NETWORK
NETWORK 2 FBD
  L_RecipeManager1(xEnable := TRUE, sDatabaseName := 'Recipes');
  sRecipeNames := L_RecipeManager1.sRecipeNames;
  dwReturnValue := L_RecipeManager1.dwReturnValue;
END_NETWORK
NETWORK 3 FBD
  // Generate machinepar name based on system time.
  GetDateAndTime(xExecute := g_HMI_MachCommand.CMD.bSaveMachPar);
  dtDateAndTIme := GetDateAndTime.dtDateAndTime;
END_NETWORK
NETWORK 4 FBD
  sDateAndTIme := TO_STRING(dtDateAndTIme);
END_NETWORK
NETWORK 5 FBD
  sDateAndTIme1 := DELETE(sDateAndTIme, 4, 0);
END_NETWORK
NETWORK 6 FBD
  sDateAndTIme2 := REPLACE(sDateAndTIme1, 'h', 1, 14);
END_NETWORK
NETWORK 7 FBD
  sRecipeNamePar := REPLACE(sDateAndTIme2, 'm', 1, 17);
END_NETWORK
NETWORK 8 FBD
  LET en1 := TRUE;
  IF en1 THEN LET g1 := EXECUTE(); END_IF
END_NETWORK
NETWORK 10 FBD
  L_MachParManager1(xEnable := TRUE, sDatabaseName := 'MachPar', sRecipeName := sMachParName);
  sMachParNames := L_MachParManager1.sRecipeNames;
  dwMachParReturnValue := L_MachParManager1.dwReturnValue;
END_NETWORK

END_PROGRAM
