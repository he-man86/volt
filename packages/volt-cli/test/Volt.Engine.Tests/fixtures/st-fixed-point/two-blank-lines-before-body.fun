// This function rounds a real down to n digits behind the comma.
FUNCTION Round : REAL
VAR_INPUT
	in	: REAL;
END_VAR
VAR
	X	: REAL;
END_VAR
(* @volt-implementation *)

(*
version 1.5	25. oct. 2008
*)
X := in;
Round := X;

END_FUNCTION
