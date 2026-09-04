{attribute 'symbol' := 'none'}
PROGRAM pgRecipeHandler
VAR	
	{attribute 'symbol' := 'readwrite'}
	RecipeManager				: fbRecipeManager;
	{attribute 'symbol' := 'readwrite'}	
	MachineParManager				: fbMachineParManager;
END_VAR
VAR_OUTPUT
	iNumberOfMachinePar  		: INT;   	//Counted recipes in database
	iNumberOfRecipes  		: INT;   	//Counted recipes in database
	ActiveRecipe        	: dutRecipe; 
	xLoadedNewRecipe       	: BOOL; 
	xRcpVisuPlcAreEqual		: BOOL;
END_VAR
VAR
	dwRecipeReturnValue		: DWORD;	//Return value of recipe manager
	// Return value of machine par manager
	dwMachineParReturnValue: DWORD;
END_VAR

NETWORK 0 FBD
  RecipeManager(EN := TRUE, sDatabaseName := 'Recipes');
END_NETWORK
NETWORK 1 FBD
  MachineParManager(EN := TRUE, sDatabaseName := 'MachinePar');
END_NETWORK

END_PROGRAM
