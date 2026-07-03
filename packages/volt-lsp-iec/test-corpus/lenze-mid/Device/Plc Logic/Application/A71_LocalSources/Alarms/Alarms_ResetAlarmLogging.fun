FUNCTION Alarms_ResetAlarmLogging : BOOL
VAR_IN_OUT
	AlarmDB			: scAlarmsDB;
END_VAR

VAR
	BaseAdress	: POINTER TO BOOL;
	CountAdress	: POINTER TO WORD;
	TimeAdress	: POINTER TO WORD;
	AlarmNr: DWORD;
END_VAR

BaseAdress:=	ADR(AlarmDB);								//start address of AlarmDB


FOR AlarmNr := 0 TO 100 DO
CountAdress:= 	BaseAdress+204+ (AlarmNr*2);			//offset: 0..100 x bool = 101 x bool for ack (bool = 1 byte)
TimeAdress:= 	BaseAdress+406+ (AlarmNr*2); //400		//offset: 0..100 x word = 

CountAdress^:=0;
TimeAdress^:=0;
END_FOR;

END_FUNCTION
