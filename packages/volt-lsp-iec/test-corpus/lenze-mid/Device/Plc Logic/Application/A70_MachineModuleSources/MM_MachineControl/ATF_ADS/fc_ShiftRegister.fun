FUNCTION fc_ShiftRegister : bool
VAR_INPUT
END_VAR
VAR
	i: INT;
END_VAR
VAR_IN_OUT
	//ioPositie			: ARRAY[0..CTE.ct_ArraySizeCheckRegister] OF cUDT_ShiftRegister_Positie;
	ioPositie			: ARRAY[0..CTE.ct_ArraySizeCheckRegister] OF cUDT_ShiftRegister_Positie;
END_VAR

(*
    Shift register
*)
FOR i := CTE.ct_ArraySizeCheckRegister TO 2 BY -1 DO
    ioPositie[i] := ioPositie[i - 1];
END_FOR;

//Eerste register leegmaken
ioPositie[1] := db_CheckRegister.EmptyCheckRegister;

END_FUNCTION
