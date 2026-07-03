FUNCTION RuntimeGuard_V5_1_100 : BOOL
VAR_IN_OUT
	AlarmDB			: scAlarmsDB;
END_VAR
VAR_INPUT
	iForward			: BOOL;
	iReverse			: BOOL;
	iActivateGuard		: BOOL;
	iMaxRuntime			: TIME;
	iReset				: BOOL;
	
END_VAR
VAR_IN_OUT
	iAlm				: BOOL;	
	ioAction			: BOOL;
	ioAccRuntime		: TON;
END_VAR
VAR
	BaseAdress	: POINTER TO BOOL;
	AlmAdress	: POINTER TO BOOL;
	AcknAdress	: POINTER TO BOOL;
	CountAdress	: POINTER TO WORD;
	TimeAdress	: POINTER TO WORD;
	AlarmNr: DWORD;
	tEnableTON : BOOL;
	tAlmCondition : BOOL;
	
END_VAR

VAR_OUTPUT
	oForwardUnguarded	:	BOOL;
	oForwardGuarded		:	BOOL;
	oReverseUnguarded	:	BOOL;
	oReverseGuarded		:	BOOL;
	
END_VAR

BaseAdress:=	ADR(AlarmDB);								//start address of AlarmDB
AlarmNr:=		ADR(iAlm)-BaseAdress;					//determine number of bytes between start of DB and current Alm (Type Bool is stored as 1 byte)

AlmAdress:= 	BaseAdress+AlarmNr;						// 
AcknAdress:= 	BaseAdress+100+ AlarmNr;
CountAdress:= 	BaseAdress+204+ (AlarmNr*2);
TimeAdress:= 	BaseAdress+406+ (AlarmNr*2);


tEnableTON:=(iForward OR iReverse) AND iActivateGuard AND NOT AlmAdress^;

ioAccRuntime(IN:=tEnableTON , PT:= iMaxRunTime, Q=> tAlmCondition, ET=> );

IF tAlmCondition AND NOT AlmAdress^ THEN
	CountAdress^:=CountAdress^+1;
END_IF

IF tAlmCondition THEN
	AlmAdress^:=TRUE;
END_IF

IF AlmAdress^ AND LST_General.Imp1s THEN
	TimeAdress^:=TimeAdress^+1;
END_IF

IF iReset AND NOT tAlmCondition THEN
	AlmAdress^:=FALSE;
END_IF

IF AlmAdress^ THEN
	ioAction:=TRUE;
END_IF

IF AlmAdress^ AND LST_General.Imp1s THEN
	TimeAdress^:=TimeAdress^+1;
END_IF

IF AlmAdress^ THEN
	ioAction:=TRUE;
END_IF

//Alarms_V5_1_100 :=AlmAdress^;
RuntimeGuard_V5_1_100 :=AlmAdress^;



oForwardUnguarded := iForward;
oForwardGuarded := oForwardUnguarded AND NOT AlmAdress^;

oReverseUnguarded:= iReverse;
oReverseGuarded:=oReverseUnguarded AND NOT AlmAdress^;

//AcknAdress^:= 	Cond;

//ackn:=AcknAdress^;
//count:=CountAdress^;

END_FUNCTION
