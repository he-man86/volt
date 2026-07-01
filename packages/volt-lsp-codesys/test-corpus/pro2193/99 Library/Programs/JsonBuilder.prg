{attribute 'symbol' := 'none'}
PROGRAM JsonBuilder
VAR_INPUT
	executeStatJson					: BOOL;
	executeCavityAliasJson			: BOOL;
	executeRejectReasonAliasJson	: BOOL;
	executeBoxFillingJson			: BOOL;
	executeCassetteJson				: ARRAY[1..CassetteAdjustments.usiNumberOfUnits] OF BOOL;
END_VAR
VAR//Visu
	{attribute 'symbol' := 'read'}		statsJson					: STRING(25000);
	{attribute 'symbol' := 'read'}		cavityAliasesJson			: STRING(2000);
	{attribute 'symbol' := 'read'}		rejectReasonAliasesJson		: STRING(2000);
	{attribute 'symbol' := 'read'}		boxFillingJson				: STRING(14000);
	{attribute 'symbol' := 'read'}		cassetteJson				: ARRAY[1..CassetteAdjustments.usiNumberOfUnits] OF STRING(25000);
END_VAR
VAR
	StatJsonBuilder					: StatsToJsonFB;
	CavityAliasJsonBuilder			: CavityAliasesToJsonFB;
	RejectReasonAliasJsonBuilder	: RejectReasonAliasesToJsonFB;
	CassetteJsonBuilder				: CassetteToJsonFB;
	BoxFillingJsonBuilder			: BoxFillingJsonFB;

	chunk							: USINT;
	magazineUnit					: USINT := 1;

	taskInfo						: CmpIecTask.Task_Info2;
END_VAR

taskInfo	:= TaskGetInfo();

CASE chunk OF
	0:
		StatJsonBuilder(
			execute		:= executeStatJson,
			stats		:= SER.Statistics.SelectedStat,
			JSON		:= statsJson,
			busy		=> ,
			done		=> ,
		);

		executeStatJson	R= StatJsonBuilder.done;
		IF NOT executeStatJson THEN
			chunk := chunk + 1;
		END_IF

	1:
		CavityAliasJsonBuilder(
			execute		:= executeCavityAliasJson,
			aliases		:= PersistentVars.cavityAliases,
			JSON		:= cavityAliasesJson,
			busy		=> ,
			done		=> ,
		);

		executeCavityAliasJson R= CavityAliasJsonBuilder.done;
		IF NOT executeCavityAliasJson THEN
			chunk := chunk + 1;
		END_IF

	2:
		RejectReasonAliasJsonBuilder(
			execute		:= executeRejectReasonAliasJson,
			aliases		:= PersistentVars.rejectReasonDescriptions,
			JSON		:= rejectReasonAliasesJson,
			busy		=> ,
			done		=> ,
		);

		executeRejectReasonAliasJson R= RejectReasonAliasJsonBuilder.done;
		IF NOT executeRejectReasonAliasJson THEN
			chunk := chunk + 1;
		END_IF

	3:
		BoxFillingJsonBuilder(
			execute					:= executeBoxFillingJson,
			stacks					:= Fanucs.Data[1].StackPosition,
			boxSettings				:= Fanucs.Data[1].BoxSettings,
			teachPosition			:= Fanucs.Data[1].Place.Teach,
			JSON					:= boxFillingJson,
			busy					=> ,
			done					=> ,
		);

		executeBoxFillingJson R= BoxFillingJsonBuilder.done;
		IF NOT executeBoxFillingJson THEN
			chunk := chunk + 1;
		END_IF

	4:
		magazineUnit := 1;
		chunk := chunk + 1;

	5:
		IF CassetteAdjustments.Unit[magazineUnit].Visu.SelectedDrawer >= enumDrawer.Upper AND CassetteAdjustments.Unit[magazineUnit].Visu.SelectedDrawer <= enumDrawer.Lower THEN
			CassetteJsonBuilder(
				execute					:= executeCassetteJson[magazineUnit],
				CurrentDrawer			:= CassetteAdjustments.Unit[magazineUnit].Visu.SelectedDrawer,
				CassetteDefinition		:= CassetteAdjustments.Unit[magazineUnit].DrawerPlate[CassetteAdjustments.Unit[magazineUnit].Visu.SelectedDrawer].CassetteDefinition,
				TargetCassettePosition	:= CassetteAdjustments.TargetCassettePosition[magazineUnit],
				ActualCassettePosition	:= CassetteAdjustments.ActualCassettePosition[magazineUnit],
				DataCassettePosition	:= CassetteAdjustments.Data[magazineUnit],
				JSON					:= cassetteJson[magazineUnit],
				busy					=> ,
				done					=> );
		END_IF

		executeCassetteJson[magazineUnit]		R= CassetteJsonBuilder.done OR CassetteAdjustments.Unit[magazineUnit].Visu.SelectedDrawer = enumDrawer.NoDrawer;
		IF NOT executeCassetteJson[magazineUnit] THEN
			magazineUnit := magazineUnit + 1;
			CassetteJsonBuilder.Reset();
			IF magazineUnit > CassetteAdjustments.usiNumberOfUnits THEN
				chunk := chunk + 1;
			END_IF
		END_IF

	6:
		chunk := 0;
END_CASE

END_PROGRAM
