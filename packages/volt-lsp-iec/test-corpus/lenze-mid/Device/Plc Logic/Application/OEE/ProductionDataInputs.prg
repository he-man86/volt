(************************************************************************************************
*
* Program  : 	ProductionDataInputs
*
* Summary : 	This program is used as the interface between the application machine program 
*				and the OEE & Downtime tracking libraries and FB's
*                  
* History :
*
*   Date        Author          Version    Changes
*  ------------------------------------------------------------------------------------------------------------------------------------------------------------
* 	2023-12-20  Michael May    			1.7		Take away act_MachineStateSetting
*	2023-06-01  Michael May    			1.6		Add action act_Assign_OEE_Properties and move property calls to that action
*	2023-05-21  Michael May    			1.5		Call property xLaterShiftStartEnableDisable and add variable xLaterShiftStartEnabled
*	2023-05-15  Michael May    			1.4		Call property xTriggerManualShiftReset and add variable xManualShiftReset
*	2023-03-17  Michael May    			1.3		Call property xTriggerUpdateJsonOEEKPI and add variable xUpdateJsonOEEKPI
* 	2023-02-20  Michael May    			1.2		Take away the First Error Capture action and assignment as it has been moved to the program FirstErrorCapture
*
* 	2023-02-15  Michael May    			1.1		Added FAST Error handling and seperated actions, added Libr. CAA Memory 
*												change structure name ePackMLModes to eModes and  ePackMLMStates to eStates for better understanding
*   2023-01-08  Michael May    			1.0		Release of Verion V3.26.3
*)

PROGRAM ProductionDataInputs
VAR
	//*********************************************************************************************************	
	// Declaration of OEE FB's
	//*********************************************************************************************************		
	fbOEE_Input_IF: L_OEE_Input_IF ;											//OEE and Downtime FB

	//*********************************************************************************************************		
	// Here are all OEE application based Input variable not assigned globally
	//
	//*********************************************************************************************************
	xSimultionEnabled   : BOOL := FALSE; 				// IF TRUE OEE and Downtime data will be simulated
	eShiftMode			: L_OEEA_Lib.enumShiftMode;		// Possible Shift Modes shift := 0; hours24	:= 1; noSchedule := 2 (use Production scheduler); Shift7Days := 3; Hours24_7Days:= 4
	eSetWeekday 		: L_OEEA_Lib.RTCLK.WEEKDAY :=  L_OEEA_Lib.RTCLK.WEEKDAY.SUNDAY;		// Weekenday sunday to saturday	if eSchedulerMode Shift7Days or Hours24_7Days has been used

	xUseReasonCodeString	: BOOL := FALSE; 			// FALSE = Production log send TextRef ID and Reasoncode, TRUE = Production log send Reasoncode string
	
	xUpdateJsonOEEKPI : BOOL;				// IF True update json OEE Shift KPI's
	xManualShiftReset : BOOL;				// IF True perform a shift reset
	xLaterShiftStartEnabled : BOOL;			// Shift calculation of planned production time starts with xShiftProductionActive = TRUE
	
	//*********************************************************************************************************************************************
	//Internal Variable
	//*********************************************************************************************************************************************	
	scCutReal : L_OEEA_Lib.scCutAverageReal; 	// used for a RealCut function 
	rLastMachineCycleTime 	: REAL;				// Placeholder variable for Last Machine Cycle Time
	scFirstErrorData		:  L_OEEA_Lib.scErrorData;
	xStructError			: BOOL;
	
	scAxisPosCountOK, scAxisPosCountNOK : L_OEEA_Lib.scAxisPosCount;  // If using function lrAxisPosCount(lrAxisPos:=MM_PD.lrCountOK[1], scAxisPosCount:=scAxisPosCountOK)

	wCount: WORD;
END_VAR

//*********************************************************************************************************	
//Assignments of user program structure to internal library structures
//*********************************************************************************************************	
//Assignment of scFirstErrorData := GVL_FirstErrCapture.scFirstErrorData;
xStructError := L_OEEA_Customizable_CopyStruct(pbySource:= ADR(GVL_FirstErrCapture.scFirstErrorData),pbyTarget:=ADR(scFirstErrorData),
				uiSizeSource:=SIZEOF(GVL_FirstErrCapture.scFirstErrorData),uiSizeTarget:=SIZEOF(scFirstErrorData));

act_Assign_Errors_01_09();
act_Assign_Errors_10_19();
act_Assign_Errors_20_29();
act_Assign_Errors_30_39();
act_Assign_Errors_40_49();
act_Assign_Errors_50_59();
act_Assign_Errors_60_69();
act_Assign_Errors_70_79();
act_Assign_Errors_80_89();
act_Assign_Errors_90_100();
		
//*********************************************************************************************************					
// Call action for OEE FB's
//*********************************************************************************************************	
act_Assign_OEE_Inputs_Constants();
act_Assign_OEE_Properties();
act_Assign_OEE_Inputs_Production_Data();
call_OEE_Input_IF();

END_PROGRAM

ACTION act_Assign_Errors_01_09
wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm001;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Emergency stop';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm002;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Safety doors opened';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm003;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Thermal overload MID-S';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm004;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Low air pressure';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm005;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Thermal failure trayfiller';

wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm006;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm007;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm008;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm009;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Error in safety system';
END_ACTION

ACTION act_Assign_Errors_10_19
wCount:=10;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm010;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Fault FQI bobbin';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm011;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Network fault';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm012;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='-';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm013;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='-';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm014;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Fault inverter Elevator ATF';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm015;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Fault inverter feed forward ADS';

wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm016;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Fault inverter feed forward ATF';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm017;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Fault inverter fan';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=FALSE;//Mach1_Alarms.Alm018;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Selector Manual/Auto MID-S';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=FALSE;//Mach1_Alarms.Alm019;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Selector Manual/Auto ATF';
END_ACTION

ACTION act_Assign_Errors_20_29
wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm020;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Servo Main drive: not ready';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm021;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Servo Main drive: Overload';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm022;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Servo Main Drive: Not homed';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm023;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Servo Wrapping device: not ready';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm024;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Servo Wrapping device: Overload';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm025;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Servo Wrapping device: Not homed';

wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm026;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Servo Side correction: not ready';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm027;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Servo Side correction: Overload';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm028;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Servo Side correction: Not homed';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm029;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';
END_ACTION

ACTION act_Assign_Errors_30_39
wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm030;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm031;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm032;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=FALSE;//Mach1_Alarms.Alm033;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Service-screen active: manual homing enabled';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm034;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Fan not at full speed';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm035;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm036;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Bunch magazine empty';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm037;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Stop position cleaning';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm038;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Stopped because of emptying mode ';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm039;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';
END_ACTION

ACTION act_Assign_Errors_40_49
wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm040;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Main drive blocked';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm041;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='No bunch';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm042;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Photocell bunch fault';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm043;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='No wrapper';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm044;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm045;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Fault photocell wrapper';

wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm046;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='No cigar';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm047;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Photocell cigar fault';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm048;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Runtime error feed forward dryer';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm049;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Dryer opened';
END_ACTION

ACTION act_Assign_Errors_50_59
wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm050;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Runtime error inpusher tray filler';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm051;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Runtime error feed forward tray filler';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm052;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Runtime error elevator tray filler';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm053;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Jam dryer';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm054;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Stop position leaf carrier';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm055;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Water receptacle full';

wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm056;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Fault drive vacuum conveyor';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm057;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='WSM: Side limit reached';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm058;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Dryer switched off';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm059;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Inpusher trayfiller blocked';
END_ACTION

ACTION act_Assign_Errors_60_69
wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm060;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Position fault tray';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm061;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Light curtain interrupted';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm062;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Outfeed conveyor full';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm063;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Tray fault outfeeding';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm064;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Light curtain elevator interrupted';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm065;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Runtime error Infeed conveyor tray filler';

wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm066;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Runtime error outfeed conveyor tray filler';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm067;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Runtime error greasing system';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm068;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm069;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';
END_ACTION

ACTION act_Assign_Errors_70_79
wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm070;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 11';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm071;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 12';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm072;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 13';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm073;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Warning bunch magazine almost empty';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm074;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='WSM: Warning Side limit reached';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm075;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Change tray';

wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm076;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Waiting for wrapper';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm077;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Referencing requesterd';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm078;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Greasing system empty';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm079;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';
END_ACTION

ACTION act_Assign_Errors_80_89
wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm080;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Emergency stop 1';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm081;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Emergency stop 2';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm082;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Emergency stop ATF';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm083;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 1';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm084;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 2';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm085;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 3';

wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm086;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 4';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm087;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 5';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm088;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 6';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm089;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 7';
END_ACTION

ACTION act_Assign_Errors_90_100
wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm090;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 8';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm091;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 9';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm092;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='Door 10';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm093;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='ATF Door 1';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm094;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='ATF Door 2';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm095;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='ATF Door 3';

wCount:=1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm096;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm097;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm098;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm099;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';

wCount:=wCount+1;
GVL_FirstErrCapture.ascErrorInfo[wCount].xError:=Mach1_Alarms.Alm100;
GVL_FirstErrCapture.ascErrorInfo[wCount].wErrorId:=wCount;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].dwErrorCategory:=0;
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sCategoryDesc:='General Error';
GVL_FirstErrCapture.ascAddErrorInfo[wCount].sErrDesc:='_';
END_ACTION

ACTION act_Assign_OEE_Inputs_Constants
//*********************************************************************************************************		
// In this action all OEE application based Input variable has to be assign from the machine program
//
//*********************************************************************************************************

// With the bit xSimultionEnabled = TRUE, OEE Data will be simulated ; This is just for testing or Demo Mode
//--------------------------------------------------------------------------------------------------------------
//xSimultionEnabled:=FALSE;

//--------------------------------------------------------------------------------------------------------------
// The Unique Station or Machine ID can be set
//--------------------------------------------------------------------------------------------------------------
GVL_OEE_VAR.scMachineData.StationID :=1;

//**********************************************************************************************************************************************************
//*************************************Shift/Production Scheduler Settings/Assignments**********************************************************************

// If TRUE then Shift data comes from the HMI via setting page, If FALSE Shift data coming from the PLC structure scShiftBreakSchedule
//-------------------------------------------------------------------------------------------------------------------------------------
GVL_OEE_Var.xHMIDataActive:=TRUE;

//*************************************************************************************************************************************	
// Select between  L_OEEA.enumShiftMode.shift and L_OEEA.enumShiftMode.hours24 day production
// IF L_OEEA.enumShiftMode.noSchedule is selected then the Production scheduler is used instead of the Shift scheduler
// // Possible Shift Modes shift := 0; hours24	:= 1; noSchedule := 2 (use Production scheduler); Shift7Days := 3; Hours24_7Days:= 4
//-------------------------------------------------------------------------------------------------------------------------------------
eShiftMode := L_OEEA_Lib.enumShiftMode.shift;


//*************************************Mode constant definition********************************************************************************************
// Mode constant definition when Machine is in Automatic and Execution, according to the scProductionModePackML
//-------------------------------------------------------------------------------------------------------------	
GVL_OEE_Var.scMachineData.iModeProduction := 6;		// Production Mode for Automatic and Execution
GVL_OEE_Var.scMachineData.iModeBreak := 20;			// Production Mode for shift Breaks; Note: category Break has to have the same index


//*************************************OEE Calculation Mode setting *******************************************************************************************
//	standard := 0,		// Standard calculation: Perfromance = ((Ideal Cycle Time × Total Count) / actual Run Time) *100% , Based in the time the machine is in production
//	part_summery :=1	// Performance calculated per part = (Part summery * 100% / actual Run Time) - shift based - 
//							used if run different part type with different Technical/Planned Machine cycle times
//						// Part Summery = ((PartOK 1 * Techn.CycleTime sec) + (PartOK 2 * Techn.CycleTime sec) + …. 
//							+ (PartOK n * Techn.CycleTime sec))
//							((PartNOK 1 * Techn.CycleTime sec) + (PartNOK 2 * Techn.CycleTime sec) + …. 
//							+ (PartNOK n * Techn.CycleTime sec))
//-------------------------------------------------------------------------------------------------------------	--------------------------
GVL_OEE_Var.scMachinedata.scProduction.eOEECalcMode := L_OEEA_Lib.enumOEECalculationMode.part_summery;

//*************************************Part Target setting *******************************************************************************************
//	ShiftPartTarget := 0,	// Using actual Shift Product Targets from the HMI Application
//	ProductPartTarget :=1	// Using actual Product Targets from Active Product recipie
//---------------------------------------------------------------------------------------------------------------------------------------
GVL_OEE_Var.scMachinedata.scProduction.eOEEPartTargetMode := L_OEEA_Lib.enumOEEPartTargetMode.ProductPartTarget;
END_ACTION

ACTION act_Assign_OEE_Inputs_Production_Data
//*********************************************************************************************************		
// In this action all OEE application based Input variable has to be assign from the machine program
//
//*********************************************************************************************************


//**********************************************************************************************************************************************************
// The Bits xProductionActive and xProductionHold are only relevant if L_OEEA.enumShiftMode.noSchedule is selected,
//	 means Production scheduler is used instead of ShiftScheduler
//
// If xProductionActive TRUE then Production is active and planned to run, all OEE and Downtime KPI's will be calculated 
//----------------------------------------------------------------------------------------------------------------------
//GVL_OEE_Var.scMachineData.scProduction.xProductionActive:= GVL_OEE_Var.xProductionActive;

// If xProductionHold TRUE then Hold/Pause/Stop production because of planned downtime
//---------------------------------------------------------------------------------------------------------
//GVL_OEE_Var.scMachineData.scProduction.xProductionHold := GVL_OEE_Var.xProductionHold;


//*************************************************************************************************
// !! Assign the current production mode of the machine as integer value, example Execute = 6 !! //
//-------------------------------------------------------------------------------------------------
GVL_OEE_Var.scMachineData.iProductionMode := GVL_OEE_Var.iProductionMode;  	// Has to be set in an Task before the FB FirstErrorCapture	

//*************************************Production Part/Product Count Assignment****************************************************************************

// Actual Partcounter, should be persistant	; no need to reset this counter within the plc program
//---------------------------------------------------------------------------------------------------------	
GVL_OEE_Var.scMachineData.scPartData.lrCountOK 	:= MM_PD.lrCountOK;		// This counter variablen has to be inc. with every new production Part
GVL_OEE_Var.scMachineData.scPartData.lrCountNOK := MM_PD.lrCountNOK;	// This counter variable has to be inc. with every new scap production Part


//*************************************Production Speed Settings********************************************************************************************
// Last Machine cycle in seconds
// Function CutRealValue cut the number of decimal values after the dot here cut all values after 2 decimal points, 
// and can provide an avaerage value of up to 99 Lastcycle times, here in this sample avarage value of the last 10 cycles
// The purpose of this function is to reduce the number of stored machine cycle times by small cycle time changes
//-------------------------------------------------------------------------------------------------------------------------	

GVL_OEE_Var.scMachineData.scPartData.rLastCycleTime :=  L_OEEA_Lib.CutRealValue(scCutReal,GVL_OEE_Var.rLastMachineCycleTime,2,10);  

// SET speed of the Machine/Line (not actual value)
//---------------------------------------------------------------------------------------------------------
GVL_OEE_Var.scMachineData.scProduction.rSetSpeedValue := GVL_OEE_Var.rSetSpeedValue;

// SET Machine overwrite 0-100%  
//---------------------------------------------------------------------------------------------------------
GVL_OEE_Var.scMachineData.scProduction.rSetSpeedPercent:=GVL_OEE_Var.rSetSpeedPercent;


//**********************************************************************************************************************************************************
// Assigned the variable below if Production Setting values e.g. Recipe Data, Shift Targets coming from the PLC and not HMI
//
//**********************************************************************************************************************************************************
//*************************************Production OEE Target Settings*******************************************************************************************
// Planned OEE Target value, needs to be provided !!!!
//---------------------------------------------------------------------------------------------------------
GVL_OEE_Var.scMachineData.scShiftTargets.rOEETarget:= GVL_OEE_Var.scShiftOEETargets.rOEETarget;

// Optional - values for the OEE Target can be provides for visualisation purposes
GVL_OEE_Var.scMachineData.scShiftTargets.rOEELowerLimit := GVL_OEE_Var.scShiftOEETargets.rOEELowerLimit;
GVL_OEE_Var.scMachineData.scShiftTargets.rOEECrucial := GVL_OEE_Var.scShiftOEETargets.rOEECrucial;


//**********************************************************************************************************************************************************
// Planned Machine Cycle time for that product in seconds, needs to be provided !!!!
// Please assign here the real planned machine cycle time as constant
// rTechnicalCycleTime is part of the Active Recipe structure
//---------------------------------------------------------------------------------------------------------
GVL_OEE_Var.scMachineData.scProductData.rTechnicalCycleTime := MM_PD.scActiveProductRecipe.rTechnicalCycleTime ;	// e.g. 60 Picks/Min.

//****************************************************************************************************************************************************************
// Shift Target value can be set here, is used mainly for an target visualisation.  
// Shift Traget is only used if scMachinedata.scProduction.eOEEPartTargetMode = 0 (ShiftPartTarget)otherwise the recipe product target is used (Setting see above) 
// If the target is reached a output bit ..scAP.xProductionTargetReached is set TRUE, this Bit can be used to Stop the production or Execute an part type change
// rProductTarget is part of the Active Recipe structure
//****************************************************************************************************************************************************************
// Example of Shift Targets calculation if there is no fix Target value given	
// eShiftMode = L_OEEA.enumShiftMode.shift > Scheduled donwntime = 50 min., Planned production time is 430 min., Machine cycle time is 1.5 sec. and OEE Target is 90%
//								(60/GVL_Visu_Var.scMachineData.scShiftTargets.rTechnicalCycleTime) * 430 * (GVL_Visu_Var.scMachineData.scShiftTargets.rOEETarget/100)
//
// 24 hour production, no scheduled downtime, Machine cycle time is 1.5 sec. and OEE Target is 90%
// eShiftMode = L_OEEA.enumShiftMode.hours24 > (60/GVL_Visu_Var.scMachineData.scShiftTargets.rTechnicalCycleTime) * 1440 * (GVL_Visu_Var.scMachineData.scShiftTargets.rOEETarget/100);

GVL_OEE_Var.scMachineData.scProductData.rProductTarget := MM_PD.scActiveProductRecipe.rProductTarget; 


//*************************************Product/Part Settings*****************************************************************************************************
// Current Part type in production using the persistant recipe structure  MM_PD.scActiveProductRecipe
// This structure has to be filled from the PLC Machine Program if not the HMI Recipe Management is used
//---------------------------------------------------------------------------------------------------------	
GVL_OEE_Var.scMachineData.scProductData.diTypeID:=MM_PD.scActiveProductRecipe.diTypeID;		// Running Parttype ID has to be asigned here

// Current Part type in production e.g. 'Biscuit Box'
//---------------------------------------------------------------------------------------------------------	
GVL_OEE_Var.scMachineData.scProductData.sTypeName :=MM_PD.scActiveProductRecipe.sTypeName; // Running Parttype Name has to be asigned here

// Unit as integer of product such as 1 = "parts"  oe 2 = "Box"
//---------------------------------------------------------------------------------------------------------
GVL_OEE_Var.scMachineData.scProductData.iUnitProductID := MM_PD.scActiveProductRecipe.iUnitProductID;

// Unit of product such as "parts" or "boxes"
//---------------------------------------------------------------------------------------------------------
GVL_OEE_Var.scMachineData.scProductData.sUnitProduct := MM_PD.scActiveProductRecipe.sUnitProduct;

// Unit as integer of machine speed such as "parts/min." or "box/min."
//---------------------------------------------------------------------------------------------------------
GVL_OEE_Var.scMachineData.scProductData.iUnitSpeedID := MM_PD.scActiveProductRecipe.iUnitSpeedID;

// Unit of machine speed such as "parts/min." or "box/min."
//---------------------------------------------------------------------------------------------------------
GVL_OEE_Var.scMachineData.scProductData.sUnitSpeed := MM_PD.scActiveProductRecipe.sUnitSpeed;

// Product/Part type machine changeover time in seconds
//---------------------------------------------------------------------------------------------------------
GVL_OEE_Var.scMachineData.scProductData.rChangeOverTime := MM_PD.scActiveProductRecipe.rChangeOverTime;

// Optional - If a uniqe PART ID per Part is needed, it can be assigne here - not used inside the standard  
GVL_OEE_Var.scMachineData.scProductData.diPartID := GVL_OEE_Var.diUniquePartID;
END_ACTION

ACTION act_Assign_OEE_Properties
//***********************************************************************************************************
// Set / Reset Properties ; 
//***********************************************************************************************************

//Update trigger for OEE Shift and Product KPI jsons string
fbOEE_Input_IF.xTriggerUpdateJsonOEEKPI:= xUpdateJsonOEEKPI;

//Reset trigger for Shift reset if required
fbOEE_Input_IF.xTriggerManualShiftReset:= xManualShiftReset;

//Enable (TRUE) or disable (FALSE) Shift calculation of planned production time starts with GVL_OEE_Var.xProductionActive = TRUE
fbOEE_Input_IF.xLaterShiftStartEnableDisable := xLaterShiftStartEnabled;
END_ACTION

ACTION call_OEE_Input_IF
NETWORK 1 FBD
  // //**********************************************************************************************************************************************************
  // // Call up L_OEE_Input_IF for OEE KPI calculation, Downtime & Production state Tracking
  // // With the Bit xSimultionEnabled the FB will go in simulation mode and generate Part count, state changes and donwtimes
  // // With the Bit xHMIShiftDataActive the FB will take the Shift data from the HMI datastructure if TRUE 
  // //**********************************************************************************************************************************************************
  fbOEE_Input_IF(xEnabled := TRUE, xResetActualData := GVL_OEE_Var.xResetActualOEEData, xResetHistoryData := GVL_OEE_Var.xResetHistoryOEEData, xProdSimultionEnabled := xSimultionEnabled, xHMIActive := GVL_OEE_Var.xHMIDataActive, eSchedulerMode := eShiftMode, eSetWeekday := eSetWeekday, xUseReasonCodeString := xUseReasonCodeString);
END_NETWORK
END_ACTION
