// Program to control some air valves on the mould (in case the IMM can not do this)
{attribute 'symbol' := 'none'}
PROGRAM MouldAirValves
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}		AirValve	: ARRAY[1..maxAirValves] OF ActuatorWithManualControlFB;
END_VAR
VAR RETAIN PERSISTENT
	{attribute 'symbol' := 'readwrite'}		enable		: ARRAY[1..MouldAirValves.maxAirValves] OF BOOL;
	{attribute 'symbol' := 'readwrite'}		delay		: ARRAY[1..MouldAirValves.maxAirValves] OF REAL;
	{attribute 'symbol' := 'readwrite'}		length		: ARRAY[1..MouldAirValves.maxAirValves] OF REAL;
END_VAR
VAR
	i					: USINT;
	start				: ARRAY[1..maxAirValves] OF BOOL;
	DelayTimer			: ARRAY[1..maxAirValves] OF BTON;
	LengthTimer			: ARRAY[1..maxAirValves] OF BTON;
	EjectorsTrigger		: RisingTriggerFB;
END_VAR
VAR CONSTANT
	maxAirValves		: USINT := 5;
END_VAR

FOR i := 1 TO maxAirValves DO
	start[i]	S= EjectorsTrigger.Rising(CLK := InjectionMouldingMachine.Unit.Ejectors.MapEnableForward() OR InjectionMouldingMachine.Unit.CorePullers.MapEnableForward());
	start[i]	S= NOT SER.InAutomaticOperation AND InjectionMouldingMachine.Unit.MouldIsOpen;
	start[i]	R= NOT enable[i];

	IF DelayTimer[i].Set(In := start[i], Pt := delay[i]) THEN
		start[i] := FALSE;
		DelayTimer[i].Reset();
		AirValve[i].Set();
	END_IF
	IF LengthTimer[i].Set(In := AirValve[i].Map(), Pt := LIMIT(0.05, length[i], 5)) OR NOT InjectionMouldingMachine.Unit.xMouldOpen THEN
		LengthTimer[i].Reset();
		AirValve[i].Reset();
	END_IF
END_FOR

END_PROGRAM
