(************************************************************************************************
*
* Program  : 	GetApplicationtErrorString
*
* Summary : 	This function can be used to provide error/warning messages from a application text list
*				and has to be extended by the application engineer programming the application program
*				This function will be called from the FB L_GetErrorTextFromFunc
*                  
* History :
*
*   Date        Author          Version    Changes
*  ---------------------------------------------------------------------------------------------------------------------------------------
*   2023-01-31  Michael May    			1.0		Initially created
*)

FUNCTION GetApplicationtErrorString : String(255)
VAR_INPUT
	wTextRefId	: WORD;			// Text Ref id e.g. 16#3C00 = 15360 decimal
	wErrorID	: WORD;			// Error id from text ref id
	dwErrorNumber : DWORD;		// Error number
END_VAR
VAR
	sErrorText 		: STRING(255);	// Error text from the Text list
END_VAR

CASE wTextRefId OF

15360:	// User Application TextRef ID

	CASE wErrorID OF	// User Application Error7warning/Information ID
		 0: sErrorText := 'No Error';
		 1: sErrorText := 'Stopping for long';
		 2: sErrorText := 'Drive-24V Supply';
		 3: sErrorText := 'Main Power Shut';
		 4: sErrorText := 'Emergency Stop';
		 5: sErrorText := 'Line Speed 0';
		 6: sErrorText := 'Line Speed < 100 %';
		 7: sErrorText := 'Safety door open';
		 8: sErrorText := 'Power supply error';
		 9: sErrorText := 'Positioning Error';
		 10: sErrorText := 'Rotation limit detected';
		 11: sErrorText := 'No Material';
		 12: sErrorText := 'No Parts';
		 13: sErrorText := 'Drive over-temperature';
		 14: sErrorText := 'Recipe change';
		 15: sErrorText := 'Time exceeded';
		 16: sErrorText := 'Test';
	ELSE
		// If no Error text is found the error id will be assigned to the error text string
		sErrorText := DWORD_TO_STRING(dwErrorNumber);	
	END_CASE
	
ELSE
		// If no Test Ref is found the error id will be assigned to the error text string
		sErrorText := DWORD_TO_STRING(dwErrorNumber);	
END_CASE

GetApplicationtErrorString := sErrorText;

END_FUNCTION
