FUNCTION SidecorrectionCalculation
VAR_INPUT
	iAnalogInputValue						: INT;
	iSetpoint								: INT;
	iCorrectionScale						: REAL;
	iLightValue								: INT;
	iDarkValue								: INT;
	iNoWrapperOffsetPercentage01Perc		: INT; //test5

END_VAR
VAR_OUTPUT
	oIntPercentage							: INT;
	oRealPercentage							: REAL;
	oCorrectionValue						: REAL;
	oDeviationNoWrapper						: REAL;
END_VAR
VAR

	tRealMeasuredValue						: REAL;
	tRealPercentage							: REAL;
	tRealSetpoint							: REAL;
	tWhiteValue								: DINT;
	tBrownValue								: DINT;
	tWidthLight_Dark						: DINT;
	tRealWidthLight_Dark					: REAL;
	tMeasuredWithOffset						: REAL;
	tRealBrownValue							: REAL;
	tRealNoWrapperOffsetPercentage			: REAL;


END_VAR

//Read out values for light and dark
tWhiteValue:=MOVE(iLightValue);
tBrownValue:=MOVE(iDarkValue);

//Calculate difference between light and dark value (light will be higher than dark)
tRealWidthLight_Dark:=TO_REAL(tWhiteValue-tBrownValue);
tRealBrownValue:=TO_REAL(tBrownValue);


//Measured value compensated with offset
tRealMeasuredValue:=TO_REAL(iAnalogInputValue);
tMeasuredWithOffset:=tRealMeasuredValue-tRealBrownValue;


//Calculation of the percentage
//"Measured value"/ Bandwidth
IF tRealWidthLight_Dark=0 THEN
	tRealWidthLight_Dark:=10;
	
END_IF
oRealPercentage:=(tMeasuredWithOffset/tRealWidthLight_Dark)*100;
oIntPercentage:=TO_INT(oRealPercentage);


//Calculation of the fault 
//(act - set) * "correction scale"
tRealSetpoint:=TO_REAL(iSetpoint);
oCorrectionValue:=(oRealPercentage-tRealSetpoint)*iCorrectionScale;


//No wrapper detection
tRealNoWrapperOffsetPercentage:=TO_REAL(iNoWrapperOffsetPercentage01Perc);
oDeviationNoWrapper:=TO_INT(tRealNoWrapperOffsetPercentage*(tRealWidthLight_Dark/1000));

END_FUNCTION
