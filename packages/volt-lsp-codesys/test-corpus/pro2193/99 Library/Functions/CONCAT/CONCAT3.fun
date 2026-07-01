// Concatenates 3 strings
FUNCTION CONCAT3 : STRING(255)
VAR_INPUT
	s1	: STRING(255);
	s2	: STRING(255);
	s3	: STRING(255);
END_VAR

Stu.StrCpyA(
	pBuffer		:= ADR(CONCAT3),
	iBufferSize	:= 255,
	pStr		:= ADR(s1));

IF	Stu.StrConcatA(pstFrom := ADR(s2), pstTo := ADR(CONCAT3), iBufferSize := 255) THEN
	Stu.StrConcatA(pstFrom := ADR(s3), pstTo := ADR(CONCAT3), iBufferSize := 255);
END_IF

END_FUNCTION
