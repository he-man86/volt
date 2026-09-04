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

NETWORK 0 FBD
  L_RecipeManager1(xEnable := TRUE, sDatabaseName := 'Recipes', sRecipeName := sRecipeName, xRecipe_Delete := xDelete, xRecipe_Load := xLoad, xRecipe_Save := xSave, xRecipe_SaveAs := xSaveAs, sActiveRecipe := sActiveRecipe);
END_NETWORK

END_PROGRAM
