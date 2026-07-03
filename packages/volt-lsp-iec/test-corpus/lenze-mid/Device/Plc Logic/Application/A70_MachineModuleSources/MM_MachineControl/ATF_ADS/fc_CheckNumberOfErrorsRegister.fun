FUNCTION fc_CheckNumberOfErrorsRegister : bool
VAR_INPUT
	iPositie			: ARRAY[0..CTE.ct_ArraySizeCheckRegister] OF cUDT_ShiftRegister_Positie;
	iPositionToCheck : INT;
	iAmountOfErrors : INT;
	
END_VAR
VAR
	tAmountError : INT;
	tLastPositionToCheck : INT;
	tIndex : INT;

END_VAR
VAR_IN_OUT
	//ioPositie			: ARRAY[0..CTE.ct_ArraySizeCheckRegister] OF cUDT_ShiftRegister_Positie;
	
END_VAR
VAR_OUTPUT
	oError	: BOOL;
END_VAR

//Init 
oError := FALSE;
tLastPositionToCheck := 0;
tAmountError := 0;


tLastPositionToCheck := iPositionToCheck + iAmountOfErrors;

FOR tIndex := iPositionToCheck TO tLastPositionToCheck DO 
    
    IF iPositie[tIndex].Infeed.Cigar_Present_Infeed  THEN
        IF iPositie[tIndex].Outfeed.Cigar_Present_Outfeed = 0 THEN
            tAmountError := tAmountError + 1; 
        END_IF;
    END_IF;
    
    IF tAmountError >= iAmountOfErrors THEN
        oError := TRUE;
        EXIT; //Exit for loop
    END_IF;
    
END_FOR;

END_FUNCTION
