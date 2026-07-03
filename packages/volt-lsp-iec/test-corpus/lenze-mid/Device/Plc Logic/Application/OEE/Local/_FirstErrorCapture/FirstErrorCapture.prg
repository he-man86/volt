(************************************************************************************************
*
* Program  : 	 FirstErrorCapture
*
* Summary : 	This program is used for the first error capture 
*				
*                  
* History :
*
*   Date        Author          Version    Changes
*  ------------------------------------------------------------------------------------------------------------------------------------------------------------
*
*   2023-12-21  Michael May    			1.3		Add Timer fbTonEnableDelay
*   2023-09-15  Michael May    			1.2		Insert FB L_OverwriteFirstErrCapture
*   2023-08-29  Michael May    			1.1		Use FB L_FECA.L_GetErrorTextFromFileReadArray - only
*   2023-02-24  Michael May    			1.0		Inital Version
*)

PROGRAM FirstErrorCapture
VAR
	
	fbFirstErrCaptureSetErrorSingle : L_FECA.L_FirstErrCaptureSetErrorSingle;		//Root cause failure detection
	
	fbFirstErrCapture: L_FirstFASTErrCapture;							//Root cause failure detection LEM
	fbFirstErrCaptureErrorAccess	: L_FirstErrCaptureErrorAccess;		//Root cause failure detection previous AT

	fbOverwriteFirstErrCapture: L_FECA.L_OverwriteFirstErrCapture;	
	
	fbGetErrorTextFromFileArray :	L_GetErrorTextFromFileReadArray; 	//FB Reading Error text from file array 
	xEnabledGetErrorTextfromFileArray: BOOL := TRUE;

	fbGetErrorTextFromFun : L_GetErrorTextFromFunction;					// FB Getting Error text from PLC function 
	xEnabledGetErrorTextfromFun: BOOL := TRUE;
	
	xActivateFastErrorInput	: BOOL	:= TRUE;		// If TRUE the FAST Error Inputs are used aswell for First Error capture as second priority
	xCaptureAllReason		: BOOL	:= TRUE;		// If TRUE all active reason/error will be capture; if FALSE only severity Fault till Warning_Lock will be captured, not Warning and Information
	xCaptureOnlyFastError	: BOOL  :=TRUE;			// IF TRUE only FAST Fault severities will be captures, Warning_Lock/Warning and Information will be ignored (if FAST Warning/Information flooding the logbook)
	xCaptureStoreWarning_lock : BOOL	:= FALSE;	// If TRUE  Warning_lock priority will be stored capture like a error, If FALSE it will be handeld like a Warining or Information and can be overwritten through and error
	xPrioFromError			: BOOL	:= TRUE;		// If True Priority is taken from Error, if False Priority is taken from Category (Error or Warning/Information)
	
	asErrorCategoryLib 		: L_FECA.scCategoryStruct;					// 	Category strings
	xStructError	: BOOL;
	
	
	trig_NewGoodProductDetected: R_TRIG;		//TRUE if new Product/Part has been producued
	lrLastGoodPartCounter	: LREAL;			// Last Good Part Counter value
	ctuGoodPartTriggerCount	: CTU;
	xEnabledOverwrite: BOOL :=TRUE;				//Enable FirstErrCaptureOverwrite
	fbTonEnableDelay		: TON  := (PT:=T#10S);
END_VAR


VAR CONSTANT
	uiMaxError : UINT := 99;		// Max. Numbers of L_SetErrorSingleInfo fb or errors withing the whole PLC Project
END_VAR

//Assignment of scFirstErrorData := GVL_FirstErrCapture.scFirstErrorData;
xStructError := L_OEEA_Customizable_CopyStruct(pbySource:= ADR(GVL_FirstErrCapture.asErrorCategory),pbyTarget:=ADR(asErrorCategoryLib),
				uiSizeSource:=SIZEOF(GVL_FirstErrCapture.asErrorCategory),uiSizeTarget:=SIZEOF(asErrorCategoryLib));

call_FirstErrorCapture_FB();

END_PROGRAM

ACTION call_FirstErrorCapture_FB
NETWORK 1 FBD
  // // Example of Create an Trigger; if new good product is created then reset the stored First Error Capture
  // //
  trig_NewGoodProductDetected(CLK := (GVL_OEE_Var.scMachineData.scPartData.lrCountOK[1] = lrLastGoodPartCounter));
  ctuGoodPartTriggerCount(CU := trig_NewGoodProductDetected.Q, RESET := , PV := );
END_NETWORK
NETWORK 2 FBD
  lrLastGoodPartCounter := MOVE(GVL_OEE_Var.scMachineData.scPartData.lrCountOK[1]);
END_NETWORK
NETWORK 3 FBD
  // //*****************************************************************************************************************
  // // Call up L_FirstFastErrCapture for Root cause failure detection
  // // This funtion block is called once per PLC program, all input structure variable a global variable
  // // Logic for xResetFirstErrCapture has to be programmed/adapt, ussaly this BIT is True when the machine is back 
  // // in automatic and execution and good parts has be produced
  // //******************************************************************************************************************
  fbTonEnableDelay(IN := TRUE, PT := );
  fbFirstErrCapture(xEnable := fbTonEnableDelay.Q, scFastErrorInfo := GVL_FirstErrCapture.scFastErrorInfo, scFastAddErrorInfo := GVL_FirstErrCapture.scFastAddErrorInfo, xActivateFastErrorInput := xActivateFastErrorInput, xCaptureAllReason := xCaptureAllReason, xCaptureOnlyFastError := xCaptureOnlyFastError, xCaptureStoreWarning_lock := xCaptureStoreWarning_lock, xPrioFromError := xPrioFromError, xResetFirstErrCapture := ((GVL_FirstErrCapture.xResetFirstError OR (trig_NewGoodProductDetected.Q AND fbFirstErrCapture.xErrorActive AND NOT fbFirstErrCapture.xIsWarningInfo)) AND (GVL_OEE_Var.eStatus_States = eStates.Execute) AND (GVL_OEE_Var.eStatus_Modes = eModes.Production)), uiMaxError := uiMaxError, iProductionMode := GVL_OEE_Var.iProductionMode);
  GVL_FirstErrCapture.xFirstErrorBit := fbFirstErrCapture.xErrorActive;
END_NETWORK
NETWORK 4 FBD
  fbOverwriteFirstErrCapture(xEnable := (xEnabledOverwrite AND fbTonEnableDelay.Q), scFirstErrorData := fbFirstErrCapture.scFirstErrorData, scErrorInfo := GVL_FirstErrCapture.scOverwriteErrorInfo, scAddErrorInfo := GVL_FirstErrCapture.scOverwriteAddErrorInfo, iProductionMode := GVL_OEE_Var.iProductionMode);
  GVL_FirstErrCapture.scFirstErrorData := fbOverwriteFirstErrCapture.scOutFirstErrorData;
END_NETWORK
NETWORK 5 FBD
  // //****************************************************************************************************************************************************
  // // Mainly used if Lenze FAST Error management (LEM)
  // // Call up L_GetErrorTextFromFileArray for getting the Error/Reasoncode Text of the active error/reason message
  // // Before using this FB the FB L_ReadErrorFromFile must be used to read the error/reson code text from the error text file into the assigned array
  // //*****************************************************************************************************************************************************
  fbGetErrorTextFromFileArray(xEnabled := (xEnabledGetErrorTextfromFileArray AND fbTonEnableDelay.Q), xErrorActive := fbFirstErrCapture.xErrorActive, xUpdateError := (fbFirstErrCapture.xUpdateError OR fbOverwriteFirstErrCapture.xUpdateError), xOnlyUserAppErrorFromFile := TRUE, scFirstErrorData := fbOverwriteFirstErrCapture.scOutFirstErrorData, iMaxNoOfSearchLoops := );
  GVL_FirstErrCapture.scFirstErrorData := fbGetErrorTextFromFileArray.scFirstErrorDataOut;
END_NETWORK
END_ACTION
