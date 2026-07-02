// This function rounds a real down to n digits behind the comma.
FUNCTION Round : REAL
VAR_INPUT
	in	: REAL;
	N	: USINT(0..4);
END_VAR
VAR
	X	: REAL;
END_VAR


(*
version 1.5	25. oct. 2008
programmer	hugo
tested by	tobias

this function rounds a real down to n digits behind the comma.


*)

CASE N OF
	0:	X := 1.0;
	1:	X := 10.0;
	2:	X := 100.0;
	3:	X := 1000.0;
	4:	X := 10000.0;
END_CASE

Round := TO_REAL(TO_DINT(in * X)) / X;



(* revision history
hm	1. sep 2006	rev 1.0
	original version

hm	2. dec 2007	rev 1.1
	changed code for better performance

hm	8. jan 2008	rev 1.2
	further improvement in performance

hm 11. mar. 2008	rev 1.3
	corrected an error with negative numbers
	use real_to_dint instead of trunc

hm	16. mar 2008	rev 1.4
	added type conversion to avoid warning under codesys 3.0

hm	25. oct. 2008	rev 1.5
	new code using global constants decades
*)

END_FUNCTION
