FUNCTION SpeedCalculationTrayfiller
VAR_INPUT
END_VAR
VAR
	tInt: INT;
	tBool: BOOL;
END_VAR

NETWORK 0 LD TITLE: "NETWORK 1: Write setpoint speed in DB"
  // The speed of the trayfiller has to be higher then the speed of the dryer. In this way there is always an empty space at the startpostition of the trayfiller.
  LET en1 := (Mach1_Data.Drives.FeedForwardADS.Control.AutoSpeed + 30);
  IF en1 THEN MOVE(tInt); END_IF
END_NETWORK
NETWORK 1 LD TITLE: "NETWORK 2: Activation + Runtime guard feed forward dryer/trayfiller"
  // Runtime calculation:
  // 1 cycle = 60s/rpm
  // speed = in 0.1 rpm -> 60s = 600 1/10s
  // 
  // -> 1 cycle = 600/speed01
  // DINT cannot calculate this 600/1000 = 0.1 -> DINT=0
  // First multiply by 1000 (s -> ms)
  // 1cycle = (600*1000)/speed1
  // To give a little margin: add 500ms
  Mach1.GenFlags.StopDriveDirect S= RuntimeGuard_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND Mach1_MIDS.IDB_TrayFiller.oFeedForwardMotor AND Mach1.Genflags.DelayAfterSTO AND (Mach1_AuxData.AllDrivesHomed OR NOT Mach1_AuxData.TrayfillerActive)), LST_General.AlwaysOff, (Mach1_Data.Drives.FeedForwardATF.Control.AutoSpeed >= 10), T#10S, Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm051, Mach1.GenFlags.MinorAlarm, Mach1_AuxData.IEC_TIMERS.RuntimeGuardFeedforwardTrayfiller);
END_NETWORK

END_FUNCTION
