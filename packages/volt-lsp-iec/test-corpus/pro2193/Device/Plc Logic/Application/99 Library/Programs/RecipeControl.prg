{attribute 'symbol' := 'none'}
PROGRAM RecipeControl
VAR//Visu
	{attribute 'symbol' := 'readwrite'}	selectedRecipeDefinition: STRING(40);	// Currently selected definition
	{attribute 'symbol' := 'readwrite'}	selectedRecipeName		: STRING(80);	// Currently selected recipe (name)
	{attribute 'symbol' := 'readwrite'}	newRecipeName			: STRING(80);	// Name for new recipe (used by: Rename and Save as)
	{attribute 'symbol' := 'readwrite'}	newDescription			: STRING(255);	// Decription for new recipe (used by: Rename and Save as)
	{attribute 'symbol' := 'readwrite'}	recipeCommand			: WORD;			// Bitwise commands:	bit 0: Load recipe (LoadAndWriteRecipe)
											//						bit 1: Save current recipe (ReadAndSaveRecipe)
											//						bit 2: Save current recipe as (Creates a new recipe)
											//						bit 3: Delete recipe (Removes a recipe from the recipe definition)
											//						bit 4: Rename recipe
											//						bit 5:
											//						bit 6:
	{attribute 'symbol' := 'readwrite'}	recipeCommandResult		: enumRecipeCommandResult;
	{attribute 'symbol' := 'read'}		recipeListForSelectedDefinition		: STRING(MaxSizeRecipesJson);	// Use this as long as handling of recipesJson variable is not implemented in HMI
	{attribute 'symbol' := 'read'}		selectedRecipeMetaData				: RecipeMetaDataType;
	{attribute 'symbol' := 'read'}		activeRecipeForSelectedDefinition	: STRING(80);					// Current recipe name that is active for selected definition
	{attribute 'symbol' := 'read'}		recipeSelected						: BOOL;							// Indicates if a recipe is selected in the visu for the selected definition
	{attribute 'symbol' := 'read'}		recipeActive						: BOOL;							// Indicates if a recipe is active (loaded)
END_VAR

VAR
	RecipeHandler			: Recipe_Management.RecipeManCommands;	// Function to access PLC recipes
	Recipes					: ARRAY[1..MaxNumberOfRecipes] OF RecipeInfoType;
//	variableCount			: ARRAY[1..GVL_Constants.RecipeDefinitionsCount] OF DINT;	// Number of variables in each recipe definition
	CommandTrigger			: TriggerFB;
	SelectedRecipeTrigger	: TriggerFB;
	AutoSaveTimer			: BTON;
	ResetResultTimer		: BTON;
	recipeCount				: INT;
	testAutoSave			: BOOL;
	RenameFileFB			: FILE.Rename;
	awaitRenameResult		: BOOL;

	visuRowSelector			: INT;
	visuRowSelectorOld		: INT;
	visuRowSelectorValid	: BOOL;
	i						: INT;
	selectedRecipeDefinitionId			: INT := -1;
	selectedRecipeDefinitionIdOld		: INT := -1;
	recipeListForSelectedDefinitionOld	: STRING(MaxSizeRecipesJson);
	selectedRecipeNameOld	: STRING(80);	// Previously selected recipe (name)
	RefreshDataTime			: ARRAY[0..9] OF UDINT;
	sw:StopwatchFB;
	taskInfo				: CmpIecTask.Task_Info2;
END_VAR

VAR RETAIN PERSISTENT
	activeRecipe			: ARRAY[1..GVL_Constants.RecipeDefinitionsCount] OF STRING(80);			// Current recipe name that is active for each definition
	MetaData				: ARRAY[1..GVL_Constants.RecipeDefinitionsCount] OF RecipeMetaDataType;	// Metadata of all active recipes that is saved together with the recipe
END_VAR

VAR CONSTANT
	MaxSizeRecipesJson		: INT := 5000;				// Max number of characters in JSON message
	MaxNumberOfRecipes		: INT := 30;				// Max number of recipes that are red from the sd card
	AutoSaveInterval		: INT := 10;				// Auto-save interval in minutes
	AutoSaveRecipeName		: STRING(10) := 'Autosave';	// Auto-save filename prefix
	MetaDataSaveDateVar		: STRING(25) := 'metadata_saveDate';
	MetaDataSaveUserVar		: STRING(25) := 'metadata_savedByUser';
	MetaDataDescVar			: STRING(25) := 'metadata_description';
END_VAR

sw.Start();
__TRY
taskInfo	:= TaskGetInfo();

RefreshData();

IF CommandTrigger.Rising(CLK := recipeCommand > 0) THEN
	IF recipeCommand.0 THEN			LoadRecipe();
	ELSIF recipeCommand.1 THEN		SaveRecipe();
	ELSIF recipeCommand.2 THEN		SaveRecipeAs();
	ELSIF recipeCommand.3 THEN		DeleteRecipe();
	ELSIF recipeCommand.4 THEN		RenameRecipe();
	END_IF
END_IF

// Reset the recipeCommand variable after 5 seconds (in case recipe operation fails)
IF ResetResultTimer.Set(In := recipeCommand <> 0 OR recipeCommandResult <> 0, Pt := 5) THEN
	recipeCommand		:= 0;
	recipeCommandResult := enumRecipeCommandResult.Ok;
END_IF
{info 'Temporary disabled to test PLC. Todo: schedule saving recipes'}
//IF AutoSaveTimer.Set(In := TRUE, Pt := AutoSaveInterval * 60) OR testAutoSave THEN	// Auto save the recipe every x minutes
//	AutoSaveTimer.Reset();
//	AutoSaveRecipes();
//	testAutoSave := FALSE;
//END_IF

// Get the currently selected recipe definition id from the definition name
selectedRecipeDefinitionId := -1;
activeRecipeForSelectedDefinition := '';
FOR i := 1 TO GVL_Constants.RecipeDefinitionsCount DO
	IF GVL_Constants.AllRecipeDefinitions[i] = selectedRecipeDefinition THEN
		selectedRecipeDefinitionId			:= i;
		activeRecipeForSelectedDefinition	:= activeRecipe[i];
		EXIT;
	END_IF
END_FOR

// Create recipe list for currently selected recipe definition
recipeListForSelectedDefinition := '';
FOR i := 1 TO MaxNumberOfRecipes DO
	IF Recipes[i].definitionId = selectedRecipeDefinitionId THEN
		IF NOT SAFECONCAT3(ADR(recipeListForSelectedDefinition), Recipes[i].name, ';', MaxSizeRecipesJson) THEN
			EXIT;
		END_IF
	END_IF
END_FOR
IF recipeListForSelectedDefinition <> recipeListForSelectedDefinitionOld THEN
	selectedRecipeName					:= '';
	recipeListForSelectedDefinitionOld	:= recipeListForSelectedDefinition;
END_IF

// Clear selected recipe when recipe definition changes (will cause a little trouble in CODESYS visu??
IF selectedRecipeDefinitionId <> selectedRecipeDefinitionIdOld THEN
	selectedRecipeName					:= '';
	newRecipeName						:= '';
	selectedRecipeDefinitionIdOld		:= selectedRecipeDefinitionId;
END_IF

// Read metadata for selected recipe from the recipe file
IF NOT Stu.StrIsNullOrEmptyA(ADR(selectedRecipeName))
AND_THEN selectedRecipeName <> selectedRecipeNameOld
THEN
	GetMetaDataForRecipe(selectedRecipeName);
	selectedRecipeNameOld		:= selectedRecipeName;
END_IF

// Wait for the Rename FB to finish.
IF awaitRenameResult THEN
	IF RenameFileFB.xDone OR RenameFileFB.xError THEN
		IF RenameFileFB.xError THEN
			recipeCommandResult	:= enumRecipeCommandResult.Failed;
			LogPlc.Error(CONCAT('Recipe rename failed: ', selectedRecipeName));
		ELSE
			recipeCommandResult	:= enumRecipeCommandResult.RecipeRenamed;
			LogPlc.Info(CONCAT('Recipe renamed: ', selectedRecipeName));
		END_IF
		RenameFileFB(xExecute := FALSE);
		visuRowSelector			:= -32767;	// Deselect row in table
		selectedRecipeName		:= '';
		newRecipeName			:= '';
		awaitRenameResult		:= FALSE;
	ELSE
		RenameFileFB();
	END_IF
END_IF

// Update selected recipe variables when selection changes in CODESYS Visu.
IF NOT visuRowSelectorValid THEN					// No row selected in table
	IF visuRowSelector <> visuRowSelectorOld THEN
		selectedRecipeDefinition:= '';
		selectedRecipeName		:= '';
	END_IF
	visuRowSelectorOld			:= visuRowSelector;
ELSIF visuRowSelector <> visuRowSelectorOld THEN
	IF visuRowSelector < 1 OR visuRowSelector > MaxNumberOfRecipes THEN		// Can happen when you manually change visuRowSelector value
		selectedRecipeDefinition:= '';
		selectedRecipeName		:= '';
	ELSIF Recipes[visuRowSelector].definitionId < 1 OR Recipes[visuRowSelector].definitionId > GVL_Constants.RecipeDefinitionsCount THEN
		selectedRecipeDefinition:= '';
		selectedRecipeName		:= '';
	ELSE
		selectedRecipeDefinition:= GVL_Constants.AllRecipeDefinitions[Recipes[visuRowSelector].definitionId];
		selectedRecipeName		:= Recipes[visuRowSelector].name;
	END_IF
	visuRowSelectorOld			:= visuRowSelector;
END_IF

recipeSelected	:= selectedRecipeName <> '';
recipeActive	:= activeRecipeForSelectedDefinition <> '';

__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.RecipeTask])
	GVL_Exceptions.xException := TRUE;
	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;
__ENDTRY
sw.End();

END_PROGRAM

METHOD PRIVATE AutoSaveRecipes
VAR
	i						: INT;
	tempFileName			: STRING(80);
END_VAR
FOR i := 1 TO GVL_Constants.RecipeDefinitionsCount DO
	tempFileName := CONCAT4(AutoSaveRecipeName, ' (', GVL_Constants.AllRecipeDefinitions[i], ')');
	RecipeHandler.ReadAndSaveAs(
			RecipeDefinitionName	:= GVL_Constants.AllRecipeDefinitions[i],
			FileName				:= tempFileName);
END_FOR

// This reads the actual values from the PLC and saves it to a file. The file does not have the standard recipe format, so it will not show up as a recipe to load.
END_METHOD

METHOD PRIVATE DeleteRecipe
VAR

END_VAR
IF Stu.StrIsNullOrEmptyA(ADR(selectedRecipeDefinition)) THEN
	recipeCommandResult := enumRecipeCommandResult.SelectADefinition;
	RETURN;
END_IF

IF selectedRecipeDefinitionId <= 0 THEN
	recipeCommandResult := enumRecipeCommandResult.InvalidDefinition;
	RETURN;
END_IF

Stu.StrTrimA(ADR(selectedRecipeName));	// Remove leading and trailing whitespaces

IF Stu.StrIsNullOrEmptyA(ADR(selectedRecipeName)) THEN
	recipeCommandResult := enumRecipeCommandResult.InvalidRecipeName;
	RETURN;
END_IF

IF Stu.StrCaseCmpA(ADR(selectedRecipeName), ADR(activeRecipe[selectedRecipeDefinitionId])) = 0 THEN
	recipeCommandResult := enumRecipeCommandResult.NotAllowedForActive;	// Do not delete currently active recipe.
	RETURN;
END_IF

// Removes a recipe from the recipe definition
recipeCommandResult := RecipeHandler.DeleteRecipe(
							RecipeDefinitionName	:= selectedRecipeDefinition,
							RecipeName				:= selectedRecipeName);

IF recipeCommandResult = enumRecipeCommandResult.Ok THEN
	recipeCommandResult := enumRecipeCommandResult.RecipeDeleted;
	LogPlc.Info(CONCAT('Recipe deleted: ', selectedRecipeName));
	visuRowSelector			:= -32767;	// Deselect row in table
	selectedRecipeName		:= '';
	recipeCommand			:= 0;
END_IF
END_METHOD

METHOD PRIVATE GetMetaDataForRecipe
VAR_INPUT
	selectedRecipe			: STRING(80);
END_VAR
VAR
	saveDateString			: STRING(40);
END_VAR
%FOLDER Refresh recipe data
// Returns the recipe values from the corresponding recipe
RecipeHandler.GetRecipeValues(
	RecipeDefinitionName	:= selectedRecipeDefinition,
	RecipeName				:= selectedRecipe,
	pStrings				:= ADR(saveDateString),
	iSize					:= 1,
	iStartIndex				:= 0,		// Read first entry in the recipe file. We assume this is the save date
	iStringLength			:= 40
);

selectedRecipeMetaData.saveDate := TO_DT(saveDateString);

// Returns the recipe values from the corresponding recipe
RecipeHandler.GetRecipeValues(
	RecipeDefinitionName	:= selectedRecipeDefinition,
	RecipeName				:= selectedRecipe,
	pStrings				:= ADR(selectedRecipeMetaData.savedByUser),
	iSize					:= 1,
	iStartIndex				:= 1,		// Read second entry in the recipe file. We assume this is the username
	iStringLength			:= 80
);

// Returns the recipe values from the corresponding recipe
RecipeHandler.GetRecipeValues(
	RecipeDefinitionName	:= selectedRecipeDefinition,
	RecipeName				:= selectedRecipe,
	pStrings				:= ADR(selectedRecipeMetaData.description),
	iSize					:= 1,
	iStartIndex				:= 2,		// Read third entry in the recipe file. We assume this is the description
	iStringLength			:= 255
);
END_METHOD

METHOD PRIVATE LoadRecipe
VAR

END_VAR
IF Stu.StrIsNullOrEmptyA(ADR(selectedRecipeDefinition)) THEN
	recipeCommandResult := enumRecipeCommandResult.SelectADefinition;
	RETURN;
END_IF

IF selectedRecipeDefinitionId <= 0 THEN
	recipeCommandResult := enumRecipeCommandResult.InvalidDefinition;
	RETURN;
END_IF

// Loads a recipe from the standard recipe file and afterwards writes the recipe into the PLC variables
recipeCommandResult := RecipeHandler.LoadAndWriteRecipe(
							RecipeDefinitionName	:= selectedRecipeDefinition,
							RecipeName				:= selectedRecipeName);

IF recipeCommandResult = enumRecipeCommandResult.Ok THEN
	recipeCommandResult := enumRecipeCommandResult.RecipeLoaded;
	activeRecipe[selectedRecipeDefinitionId] := selectedRecipeName;
	LogPlc.Info(CONCAT('Recipe loaded: ', selectedRecipeName));
	recipeCommand := 0;
END_IF
END_METHOD

METHOD PRIVATE RefreshData
VAR_INST
	Timer					: BTON;
	i, j, k					: INT;
	returnValue				: enumRecipeCommandResult;
	recipeCountperDefinition: ARRAY[1..GVL_Constants.RecipeDefinitionsCount] OF INT;

	currentDefinitionName	: STRING;
	currentDefinition		: IRecipeDefinition2;	// current recipe definition

	variableName			: STRING;
	onmogelijk:INT;
	sw	: StopwatchFB;
END_VAR
VAR
	pRecipeName				: POINTER TO STRING;
	saveDateString			: STRING(40);
END_VAR
%FOLDER Refresh recipe data
// Refresh recipes from files every second
IF NOT Timer.Set(In := TRUE, Pt := 5) THEN
	RETURN;
END_IF

sw.Start();

Timer.Reset();

recipeCount := 0;

FOR i := 1 TO GVL_Constants.RecipeDefinitionsCount DO

	currentDefinitionName	:= GVL_Constants.AllRecipeDefinitions[i];

	// Reloads the list of recipes from the file system
	returnValue := RecipeHandler.ReloadRecipes(RecipeDefinitionName := currentDefinitionName);
	IF returnValue <> enumRecipeCommandResult.Ok THEN
		RETURN;
	END_IF

	// Returns the recipe count of the corresponding recipe definition
	recipeCountperDefinition[i]	:= RecipeHandler.GetRecipeCount(RecipeDefinitionName := currentDefinitionName);

//	// Return the number of recipe variables in the current recipe definition
//	IF __QUERYINTERFACE(RecipeHandler._RecipeDefinition, currentDefinition) THEN
//		{analysis -46} // currentDefinition is definitly initialized
//		variableCount[i] := currentDefinition.GetRecipeVariableCount();
//		{analysis +46}
//	ELSE
//		variableCount[i] := -1;
//	END_IF


	FOR j := 0 TO recipeCountperDefinition[i] - 1 DO

		Increment.AnyInt(recipeCount);

		IF recipeCount < 1 THEN
			Increment.AnyInt(onmogelijk);
			RETURN;
		END_IF

		IF recipeCount > MaxNumberOfRecipes THEN
			returnValue := enumRecipeCommandResult.MaxRecipesReached;
			RETURN;
		END_IF

		Recipes[recipeCount].definitionId	:= 0;
		Recipes[recipeCount].name			:= '';

		pRecipeName := ADR(Recipes[recipeCount].name);

		// Returns the recipe names from the corresponding recipe definition
		returnValue := RecipeHandler.GetRecipeNames(
			RecipeDefinitionName	:= currentDefinitionName,
			pStrings				:= pRecipeName,
			iSize					:= 1,
			iStartIndex				:= j);

		IF returnValue <> enumRecipeCommandResult.Ok THEN
			RETURN;
		END_IF

		Recipes[recipeCount].definitionId	:= i;
	END_FOR
END_FOR

IF recipeCount < MaxNumberOfRecipes THEN
	FOR i := recipeCount + 1 TO MaxNumberOfRecipes DO
		IF Recipes[i].definitionId = 0 THEN
			EXIT;
		END_IF
		Recipes[i].definitionId	:= 0;
		Recipes[i].name			:= '';
	END_FOR
END_IF

FOR i := 9 TO 1 BY -1 DO
	RefreshDataTime[i] := RefreshDataTime[i-1];
END_FOR
RefreshDataTime[0] := sw.End();
END_METHOD

METHOD PRIVATE RenameRecipe
VAR
	searchChar			: STRING(1) := '.';
END_VAR
IF Stu.StrIsNullOrEmptyA(ADR(selectedRecipeDefinition)) THEN
	recipeCommandResult := enumRecipeCommandResult.SelectADefinition;
	RETURN;
END_IF

IF selectedRecipeDefinitionId <= 0 THEN
	recipeCommandResult := enumRecipeCommandResult.InvalidDefinition;
	RETURN;
END_IF

Stu.StrTrimA(ADR(selectedRecipeName));	// Remove leading and trailing whitespaces
Stu.StrTrimA(ADR(newRecipeName));

IF Stu.StrIsNullOrEmptyA(ADR(selectedRecipeName)) THEN
	recipeCommandResult := enumRecipeCommandResult.InvalidRecipeName;
	RETURN;
END_IF

IF Stu.StrIsNullOrEmptyA(ADR(newRecipeName)) THEN
	recipeCommandResult := enumRecipeCommandResult.InvalidRecipeName;
	RETURN;
END_IF

IF Stu.StrFindA(
		pst1			:= ADR(newRecipeName),
		pst2			:= ADR(searchChar),
		uiSearchStart	:= 0) <> 0
THEN
	recipeCommandResult := enumRecipeCommandResult.DotNotAllowed;
	RETURN;
END_IF

IF Stu.StrCaseCmpA(ADR(selectedRecipeName), ADR(activeRecipe[selectedRecipeDefinitionId])) = 0 THEN
	recipeCommandResult := enumRecipeCommandResult.NotAllowedForActive;	// Do not rename currently active recipe.
	RETURN;
END_IF

RenameFileFB(
	xExecute	:= TRUE,
	sFileNameOld:= CONCAT5('/sdcard/plc/recipes/', selectedRecipeName,	'.', selectedRecipeDefinition, '.txtrecipe'),
	sFileNameNew:= CONCAT5('/sdcard/plc/recipes/', newRecipeName,		'.', selectedRecipeDefinition, '.txtrecipe'));

awaitRenameResult	:= TRUE;						// Await the result of RenameFileFB
END_METHOD

METHOD PRIVATE SaveRecipe
VAR

END_VAR
IF Stu.StrIsNullOrEmptyA(ADR(selectedRecipeDefinition)) THEN
	recipeCommandResult := enumRecipeCommandResult.SelectADefinition;
	RETURN;
END_IF

IF selectedRecipeDefinitionId <= 0 THEN
	recipeCommandResult := enumRecipeCommandResult.InvalidDefinition;
	RETURN;
END_IF

IF Stu.StrIsNullOrEmptyA(ADR(activeRecipe[selectedRecipeDefinitionId])) THEN
	recipeCommandResult := enumRecipeCommandResult.NoRecipeActive;
	RETURN;
END_IF

// When saving the cassettedata, first copy the actual positions to the data position.
IF selectedRecipeDefinitionId = 3 THEN
	CassetteAdjustments.Unit[1].CopyActualPositionsToData();
END_IF

MetaData[selectedRecipeDefinitionId].saveDate		:= TimeSettings.dtNow;
MetaData[selectedRecipeDefinitionId].description	:= newDescription;
MetaData[selectedRecipeDefinitionId].savedByUser	:= HMI.currentUser;

// Reads the current PLC values into the recipe and afterwards stores the recipe into the standard recipe file
recipeCommandResult := RecipeHandler.ReadAndSaveRecipe(
							RecipeDefinitionName	:= selectedRecipeDefinition,
							RecipeName				:= activeRecipe[selectedRecipeDefinitionId]);

IF recipeCommandResult = enumRecipeCommandResult.Ok THEN
	recipeCommandResult := enumRecipeCommandResult.RecipeSaved;
	LogPlc.Info(CONCAT('Recipe saved: ', activeRecipe[selectedRecipeDefinitionId]));
	recipeCommand := 0;
ELSE
	MetaData[selectedRecipeDefinitionId].saveDate := GVL_Constants.DateTimeEarliest;
END_IF
END_METHOD

METHOD PRIVATE SaveRecipeAs
VAR
	searchChar			: STRING(1) := '.';
END_VAR
IF Stu.StrIsNullOrEmptyA(ADR(selectedRecipeDefinition)) THEN
	recipeCommandResult := enumRecipeCommandResult.SelectADefinition;
	RETURN;
END_IF

IF selectedRecipeDefinitionId <= 0 THEN
	recipeCommandResult := enumRecipeCommandResult.InvalidDefinition;
	RETURN;
END_IF

Stu.StrTrimA(ADR(newRecipeName));	// Remove leading and trailing whitespaces

IF Stu.StrIsNullOrEmptyA(ADR(newRecipeName)) THEN
	recipeCommandResult := enumRecipeCommandResult.InvalidRecipeName;
	RETURN;
END_IF

IF Stu.StrFindA(
		pst1			:= ADR(newRecipeName),
		pst2			:= ADR(searchChar),
		uiSearchStart	:= 0) <> 0
THEN
	recipeCommandResult := enumRecipeCommandResult.DotNotAllowed;
	RETURN;
END_IF

// When saving the cassettedata, first copy the actual positions to the data position.
IF selectedRecipeDefinitionId = 3 THEN
	CassetteAdjustments.Unit[1].CopyActualPositionsToData();
END_IF

MetaData[selectedRecipeDefinitionId].saveDate		:= TimeSettings.dtNow;
MetaData[selectedRecipeDefinitionId].description	:= newDescription;
MetaData[selectedRecipeDefinitionId].savedByUser	:= HMI.currentUser;

// Creates a new recipe in the given recipe definition
recipeCommandResult := RecipeHandler.CreateRecipe(
							RecipeDefinitionName	:= selectedRecipeDefinition,
							RecipeName				:= newRecipeName);

IF recipeCommandResult = enumRecipeCommandResult.Ok THEN
	recipeCommandResult := enumRecipeCommandResult.RecipeSaved;
	LogPlc.Info(CONCAT('Recipe saved as: ', newRecipeName));
	activeRecipe[selectedRecipeDefinitionId]		:= newRecipeName;
	recipeCommand									:= 0;
END_IF
END_METHOD
