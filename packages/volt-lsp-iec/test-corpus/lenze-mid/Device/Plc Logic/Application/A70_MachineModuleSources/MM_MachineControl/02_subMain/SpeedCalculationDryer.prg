PROGRAM SpeedCalculationDryer
VAR_INPUT
END_VAR
VAR
	TempI: INT;
	cor_DenumI: INT:=1;
	cor_NumI: INT:=1;
	cor_DenumDI: DINT:=1;
	cor_NumDI: DINT:=1;
	Speed01rpm: INT;
	tSetHighSpeedCycles : BOOL;
	cor_Const: INT;
	R_TRIG_0: R_TRIG;
	MainDrive_AutoSpeed01rpm: INT;
	Mach_ActSpeed_Rpm01:INT;
	devAngle: INT;
	
	
END_VAR
(* @volt-implementation *)
(* @volt-graphical: an assign below the top level *)

END_PROGRAM
