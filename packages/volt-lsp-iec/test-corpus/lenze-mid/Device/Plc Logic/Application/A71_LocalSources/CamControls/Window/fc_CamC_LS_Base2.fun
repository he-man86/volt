FUNCTION fc_CamC_LS_Base2 : bool
VAR_INPUT
	i_xEnable				: BOOL; 
	i_intActualSpeed		: INT; 
	i_intVLowSpeed			: INT;
	i_intVHighSpeed			: INT; 
	i_intPosLowSpeedStart	: INT; 
	i_intPosLowSpeedStop	: INT; 
	i_intPosHighSpeedStart	: INT; 
	i_intPosHighSpeedStop	: INT; 
	i_lrActualMachPos	 	: LREAL;
END_VAR

VAR
	t_intPosLowSpeedStart	: INT; 
	t_lrDY_Start			: LREAL; 
	t_lrDX_Start			: LREAL; 
	t_lrGain_Start			: LREAL; 
	t_intToPosStart			: INT; 
	t_intPosLowSpeedStop	: INT; 
	t_lrDY_Stop				: LREAL; 
	t_lrDX_Stop				: LREAL; 
	t_lrGain_Stop			: LREAL; 
	t_intToPosStop			: INT;
	xMemOutput				: BOOL; 
	EdgeStart				: R_TRIG;
	EdgeStop				: R_TRIG; 
	t_xStart				: BOOL; 
	t_xStop					: BOOL; 
	intMemStartPosition		: INT; 
	intMemStopPosition		: INT; 
END_VAR
VAR_IN_OUT
	OSP_START: BOOL;
	OSP_STOP: BOOL;
	FF_Started: BOOL;

	

END_VAR

//START point: If HighSpeedPos>Lowspeed pos = zero is crossed, add 360
t_intPosLowSpeedStart := i_intPosLowSpeedStart; 

IF i_intPosHighSpeedStart > t_intPosLowSpeedStart THEN 
	t_intPosLowSpeedStart := (t_intPosLowSpeedStart + 360);
END_IF

//START point: Calculate angle (Gain) of interpolation
t_lrDY_Start := i_intPosHighSpeedStart - t_intPosLowSpeedStart; 
t_lrDX_Start := i_intVHighSpeed - i_intVLowSpeed; 
t_lrGain_Start := (t_lrDY_Start/t_lrDX_Start); 

//START point: Calculate Startingpoint depending on actual speed 
t_intToPosStart := LREAL_TO_INT(t_intPosLowSpeedStart + (t_lrGain_Start * (i_intActualSpeed - i_intVLowSpeed)));

IF t_intToPosStart >= 360 THEN 
	t_intToPosStart := t_intToPosStart - 360; 
ELSIF t_intToPosStart < 0 THEN 
	t_intToPosStart := t_intToPosStart + 360; 
END_IF

//STOP point: If HighSpeedPos>Lowspeed pos = zero is crossed, add 360
t_intPosLowSpeedStop := i_intPosLowSpeedStop; 

IF i_intPosHighSpeedStop > t_intPosLowSpeedStop THEN 
	t_intPosLowSpeedStop := (t_intPosLowSpeedStop + 360);
END_IF

//STOP point: Calculate angle (Gain) of interpolation
t_lrDY_Stop := i_intPosHighSpeedStop - t_intPosLowSpeedStop; 
t_lrDX_Stop := i_intVHighSpeed - i_intVLowSpeed; 
t_lrGain_Stop := (t_lrDY_Stop/t_lrDX_Stop); 

//STOP point: Calculate stoppingpoint depending on actual speed
t_intToPosStop := LREAL_TO_INT(t_intPosLowSpeedStop + (t_lrGain_Stop * (i_intActualSpeed - i_intVLowSpeed)));

IF t_intToPosStop >= 360 THEN 
	t_intToPosStop := t_intToPosStop - 360; 
ELSIF t_intToPosStop < 0 THEN 
	t_intToPosStop := t_intToPosStop + 360; 
END_IF

//Actual position > START point -> set output
IF i_lrActualMachPos >= t_intToPosStart THEN
	t_xStart := TRUE; 
ELSE 
	t_xStart := FALSE; 
END_IF

IF t_xStart <> OSP_START THEN
	FF_Started S= t_xStart;
	OSP_START:=t_xStart;
	IF FF_Started=TRUE THEN
		intMemStartPosition := t_intToPosStart;
	END_IF
END_IF





//Actual position > STOP point -> reset ouput
IF i_lrActualMachPos >= t_intToPosStop THEN
	t_xStop := TRUE; 
ELSE 
	t_xStop := FALSE; 
END_IF


IF t_xStop <> OSP_STop THEN
	FF_Started R= t_xStop;
	OSP_STop:=t_xStop;
	IF FF_Started=FALSE THEN
		intMemStartPosition := t_intToPosStop;
	END_IF
END_IF


//Return 1 when in window
fc_CamC_LS_Base2 := FF_Started AND i_xEnable;

END_FUNCTION
