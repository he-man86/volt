FUNCTION STRCASEFINDA : INT
VAR_INPUT
	PST1 : POINTER TO STRING(255);
	PST2 : POINTER TO STRING(255);
	UISEARCHSTART : UINT;
END_VAR
VAR
	i : DINT;
	j : DINT;
	n1 : DINT;
	n2 : DINT;
END_VAR
(* where PST2 first occurs in PST1, ignoring case (ASCII), searching from UISEARCHSTART (counted from 1; 0 counts as 1)
   — the position counted from 1, or 0 when it does not occur. An empty PST2 occurs nowhere. *)
IF PST1 = 0 OR PST2 = 0 THEN
	RETURN;
END_IF
WHILE PST1^[n1] <> 0 DO
	n1 := n1 + 1;
END_WHILE
WHILE PST2^[n2] <> 0 DO
	n2 := n2 + 1;
END_WHILE
IF n2 = 0 THEN
	RETURN;
END_IF
FOR i := UINT_TO_DINT(MAX(UISEARCHSTART, 1)) - 1 TO n1 - n2 DO
	j := 0;
	WHILE j < n2 AND_THEN CHARTOUPPER(PST1^[i + j]) = CHARTOUPPER(PST2^[j]) DO
		j := j + 1;
	END_WHILE
	IF j = n2 THEN
		STRCASEFINDA := DINT_TO_INT(i + 1);
		RETURN;
	END_IF
END_FOR
END_FUNCTION