{attribute 'global_init_slot' := '50002'}
{attribute 'symbol' := 'none'}
PROGRAM HardwareButtons
VAR_INPUT
	StartCycle			: PushButtonWithObserverFB;
	EndCycle			: PushButtonWithObserverFB;
	Stop				: PushButtonWithObserverFB;
	Reset				: PushButtonWithObserverFB;
	Homing				: PushButtonWithObserverFB;
	F1					: PushButtonFunctionKeyFB;
	F2					: PushButtonFunctionKeyFB;
	{attribute 'symbol' := 'readwrite'}	EnableIML			: PushButtonLedWithHmiFB;
END_VAR
VAR
	startLedTest		: BOOL;
	F1OldObserverCount	: UINT;
	F2OldObserverCount	: UINT;
	speedFooterShow		: BOOL;
	SpeedFooterTimeout	: BTON;
	testestse	: BTON;
	leds				: ARRAY[1..6] OF ILed :=
	[
		StartCycle,
		EndCycle,
		Homing,
		Reset,
		F1,
		F2
	];
	leds2				: ARRAY[1..6] OF ILed :=
	[
		SER.Stacklight.Red,
		SER.Stacklight.Amber,
		SER.Stacklight.Green,
		SER.GateZAxis.ButtonUnLock,
		SER.GateZAxis.ButtonLock,
		ProcessModules.ConveyorControl.ButtonStartNewStack
	];
END_VAR
VAR CONSTANT
	speedFooterShowTime	: REAL	:= 5;	// Show footer for 5 seconds
END_VAR

Initialize();

StartCycle(		buttonType		:= enumHWButtons.Start);
EndCycle(		buttonType		:= enumHWButtons.EndCycle);
Stop(			buttonType		:= enumHWButtons.Stop);
Reset(			buttonType		:= enumHWButtons.Reset);
Homing(			buttonType		:= enumHWButtons.Homing);
F1(				buttonType		:= enumHWButtons.F1);
F2(				buttonType		:= enumHWButtons.F2);
EnableIML();
LedTest();

// Switch IML on/off when hardware/software button is pushed
IF EnableIML.ButtonPushed THEN
	PersistentVars.RecipeVars.EnableIML	:= NOT PersistentVars.RecipeVars.EnableIML;
END_IF
IF NOT PersistentVars.RecipeVars.EnableIML THEN
	EnableIML.Off();
ELSIF InjectionMouldingMachine.Data.usiFirstShotsWithoutIML = 0
   OR InjectionMouldingMachine.Unit.ShotCounter > InjectionMouldingMachine.Data.usiFirstShotsWithoutIML
THEN
	EnableIML.SetColors(enumColorList.Lime);
	EnableIML.Solid();
ELSIF SER.OperationMode = SER_OperationModeType.SemiAuto THEN
	EnableIML.SetColors(enumColorList.Lime);
	EnableIML.Solid();
ELSE
	EnableIML.SetColors(enumColorList.Yellow);	// IML temporary disabled during cycle startup
	EnableIML.Solid();
END_IF


IF ErrorHandling.errorActive THEN
	Reset.Flash();
ELSE
	Reset.Off();
END_IF

GlobalVars.Reset S= Reset.ButtonPushed;
GlobalVars.Reset R= Reset.ButtonReleased;

IF F1.ObserverCount <> F1OldObserverCount THEN
	IF F1.ObserverCount > 0 THEN
		F1.Solid();
	ELSE
		F1.Off();
	END_IF
	F1OldObserverCount := F1.ObserverCount;
END_IF

IF F2.ObserverCount <> F2OldObserverCount THEN
	IF F2.ObserverCount > 0 THEN
		F2.Solid();
	ELSE
		F2.Off();
	END_IF
	F2OldObserverCount := F2.ObserverCount;
END_IF

IF SER.InAutomaticOperation
AND SER.OperationMode <> SER_OperationModeType.SemiAuto
THEN
	IF F1.ButtonPushed THEN
		PersistentVars.usiGlobalSERSpeed	:= MAX(5,	PersistentVars.usiGlobalSERSpeed - 5);
		speedFooterShow						:= TRUE;
		HMI.FooterName						:= enumFooterNames.GlobalSpeed;
		SpeedFooterTimeout.Reset();
	END_IF
	IF F2.ButtonPushed THEN
		PersistentVars.usiGlobalSERSpeed	:= MIN(100,	PersistentVars.usiGlobalSERSpeed + 5);
		speedFooterShow						:= TRUE;
		HMI.FooterName						:= enumFooterNames.GlobalSpeed;
		SpeedFooterTimeout.Reset();
	END_IF
END_IF

IF SpeedFooterTimeout.Set(In := speedFooterShow, Pt := speedFooterShowTime) THEN
	speedFooterShow		:= FALSE;
	HMI.FooterName		:= enumFooterNames.None;
END_IF

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
	FOR i := 1 TO 6 DO
		leds[i].LedTestStop();
		leds2[i].LedTestStop();
	END_FOR
END_IF

IF ledTestStep.Set(In := startLedTest, Pt := 0.3) THEN
	leds[SEL(position = 1, position - 1, 6)].LedTestOff();
	leds[position].LedTestOn();
	leds[SEL(position = 6, position + 1, 1)].LedTestOn();

	leds2[SEL(position = 1, position - 1, 6)].LedTestOff();
	leds2[position].LedTestOn();

	ledTestStep.Reset();
	Increment.Rollover(input := position, rollover := 6, incrementBy := 1, zeroValue := 1);
END_IF
END_METHOD
