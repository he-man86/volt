(************************************************************************************************
*
* Program  : 	GetCategoryfromModuleName
*
* Summary : 	This function can be used to provide a category string based on a module name provided by the module handler
*				and has to be extended by the application engineer programming the application program
*				This function will be called in conjunction with the FB L_SetFastErrorSingleAddInfo
*                  
* History :
*
*   Date        Author          Version    Changes
*  ---------------------------------------------------------------------------------------------------------------------------------------
*   2023-01-31  Michael May    			1.0		Initially created
*)
FUNCTION GetCategoryfromModuleName : DWORD
VAR_INPUT
		sErrorCategory :  STRING(55);		// Module name from the module handler
END_VAR
VAR
END_VAR

// User Program has to add here all FAST Categories links like Machine module name or axes name which make sense for an operator
IF sErrorCategory = 'MM_Demo_0' THEN
	GetCategoryfromModuleName := 15;
	(* e.g.
ELSIF	sErrorCategory = 'MM_Winder_0' THEN
	GetCategoryfromModuleName := 16;
ELSIF	sErrorCategory = 'MM_Infeed_0' THEN
	GetCategoryfromModuleName := 17;	
	*)
ELSIF	sErrorCategory = '' THEN
	GetCategoryfromModuleName := 0;
END_IF

END_FUNCTION
