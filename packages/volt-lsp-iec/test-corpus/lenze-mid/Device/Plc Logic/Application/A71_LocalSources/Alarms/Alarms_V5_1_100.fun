FUNCTION Alarms_V5_1_100 : BOOL
VAR_IN_OUT
	AlarmDB			: scAlarmsDB;
END_VAR
VAR_INPUT
	iCond		: BOOL;
	iReset		: BOOL;
	
END_VAR
VAR_IN_OUT
	iAlm			: BOOL;	
	ioAction	:  BOOL;

END_VAR
VAR
	BaseAdress	: POINTER TO BOOL;
	AlmAdress	: POINTER TO BOOL;
	AcknAdress	: POINTER TO BOOL;
	CountAdress	: POINTER TO WORD;
	TimeAdress	: POINTER TO WORD;
	AlarmNr: DWORD;
END_VAR

BaseAdress:=	ADR(AlarmDB);								//start address of AlarmDB
AlarmNr:=		ADR(iAlm)-BaseAdress;					//determine number of bytes between start of DB and current Alm (Type Bool is stored as 1 byte)

AlmAdress:= 	BaseAdress+AlarmNr;						// 
AcknAdress:= 	BaseAdress+100+ AlarmNr;				//offset: 100 x bool for Alm (bool = 1 byte)
CountAdress:= 	BaseAdress+204+ (AlarmNr*2);			//offset: 0..100 x bool = 101 x bool for ack (bool = 1 byte)
TimeAdress:= 	BaseAdress+406+ (AlarmNr*2); //400		//offset: 0..100 x word = 

IF iCond AND NOT AlmAdress^ THEN
	CountAdress^:=CountAdress^+1;
END_IF

IF iCond THEN
	AlmAdress^:=TRUE;
END_IF

IF AlmAdress^ AND LST_General.Imp1s THEN
	TimeAdress^:=TimeAdress^+1;
	//IF TimeAdress^>1000 THEN
		//TimeAdress^:=0;
	
	//END_IF
END_IF

IF iReset AND NOT iCond THEN
	AlmAdress^:=FALSE;
END_IF

IF AlmAdress^ THEN
	ioAction:=TRUE;
END_IF

//Alarms_V5_1_100 :=AlmAdress^;
Alarms_V5_1_100 :=AlmAdress^;

//AcknAdress^:= 	Cond;

//ackn:=AcknAdress^;
//count:=CountAdress^;

END_FUNCTION
