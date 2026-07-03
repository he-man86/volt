// Concatenates 8 strings
FUNCTION CONCAT8 : STRING(255)
VAR_INPUT
	s1	: STRING(255);
	s2	: STRING(255);
	s3	: STRING(255);
	s4	: STRING(255);
	s5	: STRING(255);
	s6	: STRING(255);
	s7	: STRING(255);
	s8	: STRING(255);
END_VAR

Stu.StrCpyA(
	pBuffer		:= ADR(CONCAT8),
	iBufferSize	:= 255,
	pStr		:= ADR(s1));

IF						Stu.StrConcatA(pstFrom := ADR(s2), pstTo := ADR(CONCAT8), iBufferSize := 255) THEN
	IF					Stu.StrConcatA(pstFrom := ADR(s3), pstTo := ADR(CONCAT8), iBufferSize := 255) THEN
		IF				Stu.StrConcatA(pstFrom := ADR(s4), pstTo := ADR(CONCAT8), iBufferSize := 255) THEN
			IF			Stu.StrConcatA(pstFrom := ADR(s5), pstTo := ADR(CONCAT8), iBufferSize := 255) THEN
				IF		Stu.StrConcatA(pstFrom := ADR(s6), pstTo := ADR(CONCAT8), iBufferSize := 255) THEN
					IF	Stu.StrConcatA(pstFrom := ADR(s7), pstTo := ADR(CONCAT8), iBufferSize := 255) THEN
						Stu.StrConcatA(pstFrom := ADR(s8), pstTo := ADR(CONCAT8), iBufferSize := 255);
					END_IF
				END_IF
			END_IF
		END_IF
	END_IF
END_IF

END_FUNCTION
