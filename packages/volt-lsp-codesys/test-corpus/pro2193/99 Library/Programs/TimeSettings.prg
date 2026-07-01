{attribute 'global_init_slot' := '100'}
{attribute 'symbol' := 'none'}
PROGRAM TimeSettings
VAR_OUTPUT
	{attribute 'symbol' := 'read'}	dtNow		: DATE_AND_TIME;	// Seconds since Thursday, 1.1.1970 00:00:00, managed in a 32 Bit data type like UDINT
	todNow		: TIME_OF_DAY;		// Milliseconds since 00:00:00.000, managed in a 32 Bit data type like UDINT
//	{attribute 'symbol' := 'read'}	dtUtcNow	: DATE_AND_TIME;
//	{attribute 'symbol' := 'read'}	datNow		: DATE;				// Seconds since Thursday, 1.1.1970 00:00:00, managed in a 32 Bit data type like UDINT (although only the date is displayed)
END_VAR
VAR
	ParameterRead			: L_IPAP.L_IPAP_ParameterRead;		// The L_IPAP_ParameterRead function block serves to read the device and PLC parameters of the Lenze Controller by the PLC application
	TimeZoneWrite			: L_IPAP.L_IPAP_ParameterWrite;		// The L_IPAP_ParameterWrite function block serves to write the device and PLC parameters of the Lenze Controller from the PLC application
	TimeZoneRead			: L_IPAP.L_IPAP_ParameterRead;		// The L_IPAP_ParameterRead function block serves to read the device and PLC parameters of the Lenze Controller by the PLC application

	abReadBuffer			: ARRAY[1..8] OF BYTE;				// Read buffer of 8 bytes. Enough for 64bits datatypes.

	{attribute 'symbol' := 'readwrite'}	uiTimeZone				: UINT;		// PLC Parameter 0x245C:001 | Setting of the time zone of the device. (Default CET = 52)
	{attribute 'symbol' := 'readwrite'}	sTimeServer				: STRING(80);		// PLC Parameter 0x245A:002 | NTP server address 1

	GetDateTime				: DTU.GetDateAndTime;
	SetDateTime				: DTU.SetDateAndTime;
	SetTimeZone				: DTU.SetTimeZoneInformation;

	Trig_Blink			: TriggerFB;
	applicationCredits	: UINT;	// ???? DIT HOORT NIET HIER
	timeZoneOld			: UINT;
END_VAR

//HandleInput();
//StateMachine();

//GetSetDateTime();

// Get current local time from realtime clock

Trig_Blink.Call(GlobalVars.BlinkerNormal);

GetDateTime(
	xExecute		:= Trig_Blink.Q_Rising OR Trig_Blink.Q_Falling,
	xDone			=> ,
	xBusy			=> ,
	xError			=> ,
	eError			=> ,
	dtDateAndTime	=> ,
	ePeriode		=> );

IF GetDateTime.xDone THEN
	dtNow		:= GetDateTime.dtDateAndTime;
	todNow		:= TO_TOD(dtNow);
END_IF

ParameterRead(
	xExecute		:= Trig_Blink.Q_Rising OR Trig_Blink.Q_Falling,
	xAbort			:= ,
	wIndex			:= 16#2012,	// Device information: Application Credit available
	bySubIndex		:= 16#2,
	udiTimeOut		:= UDINT#500,
	pDataBuffer		:= ADR(abReadBuffer),
	udiBufferSize	:= SIZEOF(abReadBuffer),
	xDone			=> ,
	xBusy			=> ,
	xAborted		=> ,
	xError			=> ,
	eErrorId		=> ,
	udiDataRead		=> ,
	eDataType		=> );

IF ParameterRead.xDone
AND NOT ParameterRead.xError
THEN
	applicationCredits := abReadBuffer[1];
END_IF

TimeZoneRead(
	xExecute		:= uiTimeZone = 0,
	xAbort			:= ,
	wIndex			:= 16#245C,
	bySubIndex		:= 16#1,
	udiTimeOut		:= UDINT#500,
	pDataBuffer		:= ADR(uiTimeZone),
	udiBufferSize	:= SIZEOF(uiTimeZone),
	xDone			=> ,
	xBusy			=> ,
	xAborted		=> ,
	xError			=> ,
	eErrorId		=> ,
	udiDataRead		=> ,
	eDataType		=> );

TimeZoneWrite(
	xExecute		:= timeZoneOld <> uiTimeZone AND uiTimezone <> 0,
	xAbort			:= ,
	wIndex			:= 16#245C,
	bySubIndex		:= 16#1,
	udiTimeOut		:= UDINT#500,
	pDataBuffer		:= ADR(uiTimeZone),
	udiDataSize		:= SIZEOF(uiTimeZone),
	xDone			=> ,
	xBusy			=> ,
	xAborted		=> ,
	xError			=> ,
	eErrorId		=>
);

IF (TimeZoneWrite.xDone AND NOT TimeZoneWrite.xError)
OR (TimeZoneRead.xDone AND NOT TimeZoneRead.xError)
THEN
	timeZoneOld := uiTimeZone;
END_IF

END_PROGRAM

METHOD PRIVATE Read : BOOL
VAR_INPUT
	wIndex		: WORD;
	bSubIndex	: BYTE;
END_VAR
VAR_OUTPUT
	xDataValid	: BOOL;
END_VAR
%FOLDER Read Write parameter
ParameterRead.xExecute			:= TRUE;
ParameterRead.wIndex			:= wIndex;
ParameterRead.bySubIndex		:= bSubIndex;

IF ParameterRead.xDone OR ParameterRead.xError OR ParameterRead.xAborted THEN
	ParameterRead.xExecute		:= FALSE;
	ParameterRead.wIndex		:= 0;
	ParameterRead.bySubIndex	:= 0;
	xDataValid					:= ParameterRead.xDone
								AND ParameterRead.eErrorId = L_IPAP.L_IPAP_ERRORID.ERR_NoError
								AND ParameterRead.eDataType = L_IPAP.L_IPAP_DATATYPE.DT_UNSIGNED_64
								AND ParameterRead.udiDataRead = 8;
	Read						:= TRUE;
END_IF
END_METHOD

METHOD PRIVATE Write : BOOL
VAR_INPUT
	wIndex		: WORD;
	bSubIndex	: BYTE;
	pData		: POINTER TO BYTE;
	udiDataSize	: UDINT;
END_VAR
VAR_OUTPUT
	xSuccess	: BOOL;
END_VAR
%FOLDER Read Write parameter
TimeZoneWrite.xExecute			:= TRUE;
TimeZoneWrite.wIndex			:= wIndex;
TimeZoneWrite.bySubIndex		:= bSubIndex;
TimeZoneWrite.pDataBuffer		:= pData;
TimeZoneWrite.udiDataSize		:= udiDataSize;

IF TimeZoneWrite.xDone OR TimeZoneWrite.xError OR TimeZoneWrite.xAborted THEN
	TimeZoneWrite.xExecute		:= FALSE;
	TimeZoneWrite.wIndex		:= 0;
	TimeZoneWrite.bySubIndex	:= 0;
	xSuccess					:= TimeZoneWrite.xDone;
	Write						:= TRUE;
END_IF
END_METHOD
