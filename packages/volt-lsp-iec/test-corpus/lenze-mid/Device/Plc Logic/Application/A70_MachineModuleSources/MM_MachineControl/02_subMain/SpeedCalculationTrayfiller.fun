FUNCTION SpeedCalculationTrayfiller
VAR_INPUT
END_VAR
VAR
	tInt: INT;
	tBool: BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK TITLE: "NETWORK 1: Write setpoint speed in DB"
  // The speed of the trayfiller has to be higher then the speed of the dryer. In this way there is always an empty space at the startpostition of the trayfiller.
  MOVE(EN := ADD(EN := , Mach1_Data.Drives.FeedForwardADS.Control.AutoSpeed, 30, => tInt).ENO, tInt, => Mach1_Data.Drives.FeedForwardATF.Control.AutoSpeed);
END_NETWORK
NETWORK TITLE: "NETWORK 2: Activation + Runtime guard feed forward dryer/trayfiller"
  // Runtime calculation:
  // 1 cycle = 60s/rpm
  // speed = in 0.1 rpm -> 60s = 600 1/10s
  //
  // -> 1 cycle = 600/speed01
  // DINT cannot calculate this 600/1000 = 0.1 -> DINT=0
  // First multiply by 1000 (s -> ms)
  // 1cycle = (600*1000)/speed1
  // To give a little margin: add 500ms
  Mach1.GenFlags.StopDriveDirect S= RuntimeGuard_V5_1_100(AlarmDB := Mach1_Alarms, iForward := (Mach1_AuxData.TrayfillerActive AND Mach1_MIDS.IDB_TrayFiller.oFeedForwardMotor AND Mach1.Genflags.DelayAfterSTO AND (Mach1_AuxData.AllDrivesHomed OR NOT Mach1_AuxData.TrayfillerActive)), iReverse := LST_General.AlwaysOff, iActivateGuard := GE(EN := (Mach1.Genflags.DelayAfterSTO AND Mach1_Data.Drives.FeedForwardATF.Control.StartAuto AND NOT LST_InputsOutputs.I133_3_PROX_zero_position_transport_ATF), Mach1_Data.Drives.FeedForwardATF.Control.AutoSpeed, 10), iMaxRuntime := T#10S, iReset := Mach1.GenFlags.StartFlag, iAlm := Mach1_Alarms.Alm051, ioAction := Mach1.GenFlags.MinorAlarm, ioAccRuntime := Mach1_AuxData.IEC_TIMERS.RuntimeGuardFeedforwardTrayfiller, oForwardGuarded => Mach1_Data.Drives.FeedForwardATF.Control.StartAuto);
END_NETWORK

END_FUNCTION
