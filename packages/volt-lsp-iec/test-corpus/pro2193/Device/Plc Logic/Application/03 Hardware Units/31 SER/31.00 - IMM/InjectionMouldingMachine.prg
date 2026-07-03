// Control an Injection Moulding Machine through the EUROMAP 67 standard.
{attribute 'symbol' := 'none'}
PROGRAM InjectionMouldingMachine
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	Unit						: IMM_Spies
	(
		instanceNo		:= 1,
		moduleManager	:= GlobalVars.fbModuleManager,
		moduleParent	:= 0,
		resetCondition1	:= 0,
		resetCondition2	:= 0,
	);
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}	Data						: IMM_Data;
END_VAR

Unit(
	Data	:= Data);

// Config
Unit.EnableDetectMovementIMMInput	:= TRUE;

END_PROGRAM
