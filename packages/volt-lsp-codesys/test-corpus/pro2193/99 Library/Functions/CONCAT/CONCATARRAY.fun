// Concatenates any array of strings with optional separator between the strings
FUNCTION CONCATARRAY : STRING(255)
VAR_IN_OUT
	str					: ARRAY[*] OF STRING(255);
END_VAR
VAR_INPUT
	separator			: STRING(10)	:= '';	// Optional separator character between the string parts
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR

lower		:= LOWER_BOUND(str, 1);
upper		:= UPPER_BOUND(str, 1);

CONCATARRAY	:= str[lower];

IF upper = lower THEN
	RETURN;
END_IF

FOR di := lower + 1 TO upper DO
	IF NOT Stu.StrConcatA(				// Add separator char
				pstFrom		:= ADR(separator),
				pstTo		:= ADR(CONCATARRAY),
				iBufferSize	:= 255)
	THEN
		RETURN;		// Stop concatenating the string when StrConcatA fails
	END_IF

	IF NOT Stu.StrConcatA(
				pstFrom		:= ADR(str[di]),
				pstTo		:= ADR(CONCATARRAY),
				iBufferSize	:= 255)
	THEN
		RETURN;		// Stop concatenating the string when StrConcatA fails
	END_IF
END_FOR

END_FUNCTION
