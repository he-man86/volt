FUNCTION STRMIDA
VAR_INPUT
	PST : POINTER TO BYTE;
	UIINPUTBUFFERSIZE : UINT;
	ILENGTH : INT;
	IPOSITION : INT;
	PSTRESULT : POINTER TO BYTE;
	UIRESULTBUFFERSIZE : UINT;
END_VAR
VAR
	i : DINT;
	n : DINT;
END_VAR
(* ILENGTH characters of PST from IPOSITION (counted from 1) into PSTRESULT, cut at the UIRESULTBUFFERSIZE - 1 bytes
   it holds before its terminator — MID over byte buffers. PSTRESULT may be PST itself: each byte is read before it
   is written over. A position before the first character or past the last leaves PSTRESULT as it was (recorded:
   lib_stu_mid); a length of 0 empties it. ponytail: a position just past the end (length + 1) is unasked *)
IF PST = 0 OR PSTRESULT = 0 OR UIRESULTBUFFERSIZE = 0 THEN
	RETURN;
END_IF
n := STRLENA(PST);
IF IPOSITION < 1 OR IPOSITION > n THEN
	RETURN;
END_IF
n := n - (IPOSITION - 1);
n := MIN(n, ILENGTH, UINT_TO_DINT(UIRESULTBUFFERSIZE) - 1);
FOR i := 0 TO n - 1 DO
	PSTRESULT[i] := PST[IPOSITION - 1 + i];
END_FOR
PSTRESULT[MAX(n, 0)] := 0;
END_FUNCTION