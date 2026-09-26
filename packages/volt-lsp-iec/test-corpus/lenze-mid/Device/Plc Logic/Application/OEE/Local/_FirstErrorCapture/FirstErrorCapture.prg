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
(* @volt-implementation *)

//Assignment of scFirstErrorData := GVL_FirstErrCapture.scFirstErrorData;
xStructError := L_OEEA_Customizable_CopyStruct(pbySource:= ADR(GVL_FirstErrCapture.asErrorCategory),pbyTarget:=ADR(asErrorCategoryLib),
				uiSizeSource:=SIZEOF(GVL_FirstErrCapture.asErrorCategory),uiSizeTarget:=SIZEOF(asErrorCategoryLib));

call_FirstErrorCapture_FB();

END_PROGRAM

ACTION call_FirstErrorCapture_FB
(* @volt-implementation *)
(* @volt-graphical: a flag on a box input pin *)
END_ACTION
