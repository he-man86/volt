FUNCTION STRTRIMA
VAR_INPUT
	PSTRING : POINTER TO BYTE;
END_VAR
VAR
	i : DINT;
	first : DINT;
	last : DINT;
END_VAR
(* PSTRING without its leading and trailing spaces (ISSPACECHARACTER), in place *)
IF PSTRING = 0 THEN
	RETURN;
END_IF
last := STRLENA(PSTRING) - 1;
WHILE first <= last AND_THEN ISSPACECHARACTER(PSTRING[first]) DO
	first := first + 1;
END_WHILE
WHILE last >= first AND_THEN ISSPACECHARACTER(PSTRING[last]) DO
	last := last - 1;
END_WHILE
FOR i := 0 TO last - first DO
	PSTRING[i] := PSTRING[first + i];
END_FOR
PSTRING[MAX(last - first + 1, 0)] := 0;
END_FUNCTION