{attribute 'global_init_slot' := '50002'}
{attribute 'symbol' := 'none'}
PROGRAM BfuButtons
VAR_INPUT
	{attribute 'symbol' := 'readwrite'}	StartCycle			: PushButtonLedWithHmiFB;
	{attribute 'symbol' := 'readwrite'}	EndCycle			: PushButtonLedWithHmiFB;
	{attribute 'symbol' := 'readwrite'}	Stop				: PushButtonLedWithHmiFB;
	{attribute 'symbol' := 'readwrite'}	Reset				: PushButtonLedWithHmiFB;
	{attribute 'symbol' := 'readwrite'}	Step				: PushButtonLedWithHmiFB;
	{attribute 'symbol' := 'readwrite'}	EmptyBFU			: PushButtonLedWithHmiFB;
END_VAR
VAR
	startLedTest		: BOOL;
	leds				: ARRAY[1..5] OF ILed :=
	[
		BFU.Stacklight.Red,
		BFU.Stacklight.Amber,
		BFU.Stacklight.Green,
		BFU.GateBFU.ButtonUnLock,
		BFU.GateBFU.ButtonLock
	];
END_VAR

Initialize();

StartCycle();
EndCycle();
Stop();
Reset();
Step();
EmptyBFU();

LedTest();

IF BFU.errorActive THEN
	Reset.Flash();
ELSE
	Reset.Off();
END_IF

GlobalVars_BFU.Reset S= Reset.ButtonPushed;
GlobalVars_BFU.Reset R= Reset.ButtonReleased;

END_PROGRAM

METHOD PRIVATE Initialize
VAR_INPUT
END_VAR
VAR_INST
	{attribute 'init_on_onlchange'}
	xInitialized	: BOOL;
END_VAR
IF xInitialized THEN
	RETURN;
END_IF

// Set the button colors
StartCycle.SetColors(	colorOn := enumColorList.Green);
EndCycle.SetColors(		colorOn := enumColorList.Red);
Stop.SetColors(			colorOn := enumColorList.Red);
Reset.SetColors(		colorOn := enumColorList.Blue);
Step.SetColors(			colorOn := enumColorList.Maroon);

startLedTest := TRUE;

xInitialized := TRUE;
END_METHOD

// Do little animation with the leds during startup :)
METHOD PRIVATE LedTest
VAR_INST
	ledTestDuration		: BTON;
	ledTestStep			: BTON;
	i					: INT;
	position			: INT := 1;
END_VAR
IF ledTestDuration.Set(In := startLedTest, Pt := 8) THEN
	startLedTest := FALSE;
	position := 1;
	FOR i := 1 TO 5 DO
		leds[i].LedTestStop();
	END_FOR
END_IF

IF ledTestStep.Set(In := startLedTest, Pt := 0.3) THEN
	leds[SEL(position = 1, position - 1, 5)].LedTestOff();
	leds[position].LedTestOn();

	ledTestStep.Reset();
	Increment.Rollover(input := position, rollover := 5, incrementBy := 1, zeroValue := 1);
END_IF
END_METHOD
