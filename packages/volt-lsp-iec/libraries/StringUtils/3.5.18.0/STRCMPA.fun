FUNCTION STRCMPA : INT
VAR_INPUT
	PBY1 : POINTER TO BYTE;
	PBY2 : POINTER TO BYTE;
END_VAR
VAR
	i : DINT;
END_VAR
(* the difference of the first bytes that differ — negative when PBY1 orders first, 0 when equal *)
IF PBY1 = 0 OR PBY2 = 0 THEN
	RETURN;
END_IF
WHILE PBY1[i] <> 0 AND_THEN PBY1[i] = PBY2[i] DO
	i := i + 1;
END_WHILE
STRCMPA := BYTE_TO_INT(PBY1[i]) - BYTE_TO_INT(PBY2[i]);
END_FUNCTION