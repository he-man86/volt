{attribute 'symbol' := 'none'}
PROGRAM LabelSuppliers
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: ARRAY[1..usiNumberOfUnits] OF DrawerMagazineFB
	[
		(
			instanceNo		:= 1,
			moduleManager	:= GlobalVars.fbModuleManager,
			moduleParent	:= 0,
			resetCondition1	:= Magazines.Unit[1],
			resetCondition2	:= 0,
		)
	];
END_VAR
VAR
	i							: USINT;
	selectedInstance			: USINT(1..usiNumberOfUnits);	// Index of instance shown in CODESYS Visu
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data						: ARRAY[1..LabelSuppliers.usiNumberOfUnits] OF DrawerMagazine_Data;
END_VAR
VAR CONSTANT
	usiNumberOfUnits			: USINT := 1;
END_VAR

FOR i := 1 TO usiNumberOfUnits DO
	Unit[i](
		Data				:= Data[i]
	);
END_FOR

END_PROGRAM
