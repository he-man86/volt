FUNCTION fc_MeanValue
VAR_INPUT
	iLength						: INT;
	iAcquireNewValue			: BOOL;
	iNewValue					: INT;

END_VAR

VAR_OUTPUT
	oMeanValue					: INT;
END_VAR

VAR
	tIndex						: INT;
	tMean						: DINT;
	tCountToIndexNumber			: INT;

END_VAR

VAR_IN_OUT
	ioValues					: ARRAY[0..50] OF INT;	
END_VAR

oMeanValue := 0;
tMean := 0;
tCountToIndexNumber := iLength - 2; //count from 0 to length -1, but shift is 1 index less -> -2



FOR tIndex:=tCountToIndexNumber TO 0 BY -1 DO
    ioValues[tIndex + 1] := ioValues[tIndex];
    tMean := tMean + ioValues[tIndex];
    
    IF tIndex= 0 THEN
        ioValues[0] := iNewValue;
        tMean := tMean + ioValues[tIndex];
    END_IF;
  
END_FOR;
oMeanValue := DINT_TO_INT(tMean / iLength);

END_FUNCTION
