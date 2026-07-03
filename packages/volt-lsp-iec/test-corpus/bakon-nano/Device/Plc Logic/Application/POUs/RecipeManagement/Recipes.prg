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

(* @volt-graphical: FBD *)

END_PROGRAM
