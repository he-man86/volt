(************************************************************************************************
*
* Program  : 	FileHandlerErrorText
*
* Summary : 	This program call the FB L_ReadErrorFromFile to read error text from the file SoftPlcParameter.lxd
*				It can read application errors from user text list and in addition all error from the internal text list L_IE1P_ApplicationEror 16#2C000
*				which provides FB error text from L_MC1P, L_MC2P and L_MC4P FB Libraries
*                  
* History :
*
*   Date        Author          Version    Changes
*  ---------------------------------------------------------------------------------------------------------------------------------------
*   2023-08-29  Michael May    			1.1		Update FB L_FECA.L_ReadErrorFromFile Read only User Application Errors
*   2023-01-24  Michael May    			1.0		Initially created
*)
PROGRAM FileHandlerErrorText

VAR	
// Sequencer
xReadCyclic : BOOL;
xStopReadCyclic : BOOL;
xRestart	: BOOL;
iStep: INT;
iReadLoopAfterError : INT := 2;


//-----F B  I N P U T S ---------------------------------------------------------------------------------

 fbReadErrorFromFile : L_FECA.L_ReadErrorFromFile;
 xEnable			: BOOL;								// Enable the Function Block
 xExecute 			: BOOL;								// Execute the Function Block
 xStoreAllErrorText	: BOOL;								// Store all error text strings in string array till given textref id and error code; Note: string array has to be correct size
 														// by given textref id and error code 0 all erros rows will be stored
 xStoreTexRefIDErrorText : BOOL;						// Store all error text of textref id in string array Note; string array has to be correct size
 xStoreAllAppTexRefIDErrorText : BOOL;					// Store only all application error text of textref id in string array Note; string array has to be correct size (Range setup in scIN)
 xStopIfErrorFound	: BOOL;								// Stop if specific error found
 xContinuousRead 	: BOOL;								// If TRUE continious read row by row, if FALSE stop reading after a row
 xRepeat 			: BOOL;								// Repeat the file read procedure
 xClearErrorArrays	: BOOL;								// Clear Error text and code array
 xInit	 			: BOOL;								// Restart the file read procedure
 scIN				:	L_FECA.scReadErrorFromFileIN;
//-----F B  O U T P U T S ---------------------------------------------------------------------------------

xFindError			: BOOL;								// IF TRUE the assign error text has been found based on the texref id and error code
xError				: BOOL;							    // IF TRUE a error has been occurse during file reading
xBusy				: BOOL;						   		// IF TRUE the file read procedure is ongoing
xDone				: BOOL;					   			// IF TRUE the file read procedure has been ended
scOUT				: L_FECA.scReadErrorfromFileOUT;



//-----I N T E R N A L--------------------------------------------------------------------------------------

i : INT;

FirstScanCycle	: BOOL;
tWaitBeforeRead, tWaitAfterDone	: TON;
rtReadAfterStartUp	: R_TRIG;
iReadLoop : INT;
END_VAR

// Call action sequences
actSequencer();
actReadFromFile();

FirstScanCycle:= TRUE;

END_PROGRAM

ACTION actReadFromFile
NETWORK 0 FBD
  fbReadErrorFromFile(asErrorText := L_FECA.GVL_ReadErrorFromFile.asErrorText, adwErrorID := L_FECA.GVL_ReadErrorFromFile.adwErrorID, xEnable := xEnable, xExecute := xExecute, xStoreAllErrorText := xStoreAllErrorText, xStoreTexRefIDErrorText := xStoreTexRefIDErrorText, xStoreAllAppTexRefIDErrorText := xStoreAllAppTexRefIDErrorText, xStopIfErrorFound := xStopIfErrorFound, xContinuousRead := xContinuousRead, xRepeat := xRepeat, xInit := xInit, xClearErrorArrays := xClearErrorArrays, scIN := scIN, xError => xError, xBusy => xBusy, xDone => xDone, scOUT => scOUT);
END_NETWORK
NETWORK 1 FBD
  xRepeat := FALSE;
END_NETWORK
NETWORK 2 FBD
  xInit := FALSE;
END_NETWORK
NETWORK 3 FBD
  xRestart := FALSE;
END_NETWORK
NETWORK 4 FBD
  xClearErrorArrays := FALSE;
END_NETWORK
END_ACTION

ACTION actSequencer
tWaitBeforeRead(IN:=FirstScanCycle, PT:=T#3S);
tWaitAfterDone(IN:=(xDone OR xError) AND NOT xInit AND NOT tWaitAfterDone.Q, PT:=T#3S);

rtReadAfterStartUp(CLK:=tWaitBeforeRead.Q);

// Stop ReadCyclic
IF xStopReadCyclic THEN
	iStep := 99;
END_IF

IF rtReadAfterStartUp.Q THEN
	xReadCyclic:= TRUE;
	iReadLoop :=0;
END_IF


CASE iStep OF
	
0: 	IF xReadCyclic THEN
		iStep := iStep +1;
	END_IF
1: 
	// Set default inputs (can be changed if required)
	xEnable:= TRUE;
	xExecute := TRUE;
	xStoreAllErrorText := FALSE;
	xStoreTexRefIDErrorText := FALSE;
	xStoreAllAppTexRefIDErrorText := TRUE;
	xStopIfErrorFound := FALSE;
	xContinuousRead := TRUE;
	
	IF xDone OR xError THEN
		iStep := iStep +1;
	END_IF; 
	
2:	//Wait on done
	IF NOT xReadCyclic OR (tWaitAfterDone.Q AND xDone) THEN
		iStep := 99;
	END_IF
	
	IF (tWaitAfterDone.Q AND xError) THEN
		IF iReadLoop <= iReadLoopAfterError THEN
			xInit := TRUE;
			iStep := 0;
			iReadLoop := iReadLoop +1;
		ELSE
			iStep := 99;
		END_IF;	
	END_IF
	
99: // Stop Read Cyclic 
	IF xRestart THEN
		iStep := 0;
		iReadLoop :=0;
		xReadCyclic := TRUE;
		IF xError THEN
			xInit	:= TRUE;
		ELSE
			xRepeat	:= TRUE;	
		END_IF;	
	ELSE
		xExecute := FALSE;
		xStoreAllErrorText := FALSE;
		xStoreTexRefIDErrorText := FALSE;
		xStopIfErrorFound := FALSE;
		xContinuousRead := FALSE;
		xReadCyclic:= FALSE;
	END_IF;
END_CASE
END_ACTION
