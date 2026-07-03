PROGRAM Recipes
VAR
	L_RecipeManager1: L_RecipeManager;
	{attribute 'symbol':='readwrite'}
	sRecipeName: STRING;	
	{attribute 'symbol':='readwrite'}
	xDelete: BOOL;
	{attribute 'symbol':='readwrite'}	
	xLoad: BOOL;
	{attribute 'symbol':='readwrite'}
	xSave: BOOL;
	{attribute 'symbol':='readwrite'}
	xSaveAs: BOOL;
	{attribute 'symbol':='readwrite'}
	dwReturnValue: DWORD;
	{attribute 'symbol':='readwrite'}
	sRecipeNames: STRING(5000);	
	{attribute 'symbol':='readwrite'}
	sActiveRecipe: STRING;				// Recommended to make Retain
END_VAR

NETWORK 1 FBD
  L_RecipeManager1(xEnable := TRUE, sDatabaseName := 'Recipes', sRecipeName := sRecipeName);
  sRecipeNames := L_RecipeManager1.sRecipeNames;
  dwReturnValue := L_RecipeManager1.dwReturnValue;
END_NETWORK

END_PROGRAM
