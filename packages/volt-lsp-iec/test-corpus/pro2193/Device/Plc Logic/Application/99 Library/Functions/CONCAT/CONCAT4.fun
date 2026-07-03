// Concatenates 4 strings
FUNCTION CONCAT4 : STRING(255)
VAR_INPUT
	s1	: STRING(255);
	s2	: STRING(255);
	s3	: STRING(255);
	s4	: STRING(255);
END_VAR

Stu.StrCpyA(
	pBuffer		:= ADR(CONCAT4),
	iBufferSize	:= 255,
	pStr		:= ADR(s1));

IF		Stu.StrConcatA(pstFrom := ADR(s2), pstTo := ADR(CONCAT4), iBufferSize := 255) THEN
	IF	Stu.StrConcatA(pstFrom := ADR(s3), pstTo := ADR(CONCAT4), iBufferSize := 255) THEN
		Stu.StrConcatA(pstFrom := ADR(s4), pstTo := ADR(CONCAT4), iBufferSize := 255);
	END_IF
END_IF

END_FUNCTION
