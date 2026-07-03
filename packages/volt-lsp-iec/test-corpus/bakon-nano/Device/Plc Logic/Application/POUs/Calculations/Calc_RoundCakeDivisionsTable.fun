FUNCTION Calc_RoundCakeDivisionsTable : INT
VAR_INPUT
	I_Divisions		: INT;
	I_InSequence	: BOOL;
END_VAR
VAR_IN_OUT
	IQ_Table		: ARRAY[*] OF REAL;
END_VAR
VAR
	i				: INT;
	lower			: DINT;
	upper 			: DINT;
END_VAR

(*
	Fills the array IQ_Table table with the rotations in degrees in order to cut in I_Divisions pieces.
	Returns an integer representing how many cuts to place. 
	Returns -1 if an error occured.
*)

lower := LOWER_BOUND(IQ_Table,1); 
upper := UPPER_BOUND(IQ_Table,1); 

IF (I_Divisions > 70 OR I_Divisions < 2) THEN	
	//Hardcoded limit to make sure we dont cut the cake to pulp or dont cut at all.
	Calc_RoundCakeDivisionsTable := -1;
	RETURN;								
END_IF

IF (I_Divisions MOD 2) > 0 THEN
	//Uneven number of cuts.
	Calc_RoundCakeDivisionsTable := -1;	
	RETURN;
END_IF

IF (I_Divisions / 2) > (upper - lower) THEN
	//We cant store this many cuts in the table.
	Calc_RoundCakeDivisionsTable := -1;	
	RETURN;
END_IF

IF I_InSequence THEN
	FOR i := 0 TO (I_Divisions/2) DO
		IQ_Table[i + lower] := i * (360.0/INT_TO_REAL(I_Divisions));
	END_FOR
ELSE

	CASE I_Divisions OF
		2:
			IQ_Table[ lower + 0] := 0; 
	
		4:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 90; 
	
		6:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 60; 
			IQ_Table[ lower + 2] := 120; 
	
		8:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 90; 
			IQ_Table[ lower + 2] := 45; 
			IQ_Table[ lower + 3] := 135; 
				
	
		10:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 108; 
			IQ_Table[ lower + 2] := 36; 
			IQ_Table[ lower + 3] := 144; 
			IQ_Table[ lower + 4] := 72; 
	
		12:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 90; 
			IQ_Table[ lower + 2] := 120; 
			IQ_Table[ lower + 3] := 60; 
			IQ_Table[ lower + 4] := 30; 
			IQ_Table[ lower + 5] := 150; 
			
		14:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 102.86; 
			IQ_Table[ lower + 2] := 51.43; 
			IQ_Table[ lower + 3] := 128.57; 
			IQ_Table[ lower + 4] := 77.14; 
			IQ_Table[ lower + 5] := 25.71; 
			IQ_Table[ lower + 6] := 154.29; 
	
		(* Nieuw voor Smaak & Co *)
		16:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 90; 
			IQ_Table[ lower + 2] := 45; 
			IQ_Table[ lower + 3] := 135; 
			IQ_Table[ lower + 4] := 22.5; 
			IQ_Table[ lower + 5] := 112.5; 
			IQ_Table[ lower + 6] := 67.5; 
			IQ_Table[ lower + 7] := 157.5; 
	
		18:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 80; 
			IQ_Table[ lower + 2] := 40; 
			IQ_Table[ lower + 3] := 120; 
			IQ_Table[ lower + 4] := 20; 
			IQ_Table[ lower + 5] := 100; 
			IQ_Table[ lower + 6] := 60; 
			IQ_Table[ lower + 7] := 160; 
			IQ_Table[ lower + 8] := 140; 
	
		20:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 90; 
			IQ_Table[ lower + 2] := 36; 
			IQ_Table[ lower + 3] := 126; 
			IQ_Table[ lower + 4] := 72; 
			IQ_Table[ lower + 5] := 144; 
			IQ_Table[ lower + 6] := 54; 
			IQ_Table[ lower + 7] := 162; 
			IQ_Table[ lower + 8] := 18; 
			IQ_Table[ lower + 9] := 108; 
	
		22:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 81.82; 
			IQ_Table[ lower + 2] := 130.91; 
			IQ_Table[ lower + 3] := 49.09; 
			IQ_Table[ lower + 4] := 147.27; 
			IQ_Table[ lower + 5] := 65.45; 
			IQ_Table[ lower + 6] := 32.73; 
			IQ_Table[ lower + 7] := 98.18; 
			IQ_Table[ lower + 8] := 163.64; 
			IQ_Table[ lower + 9] := 114.55; 
			IQ_Table[ lower + 10] := 16.36; 
	
		24:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 90; 
			IQ_Table[ lower + 2] := 45; 
			IQ_Table[ lower + 3] := 135; 
			IQ_Table[ lower + 4] := 165; 
			IQ_Table[ lower + 5] := 75; 
			IQ_Table[ lower + 6] := 120; 
			IQ_Table[ lower + 7] := 30; 
			IQ_Table[ lower + 8] := 60; 
			IQ_Table[ lower + 9] := 150; 
			IQ_Table[ lower + 10] := 105; 
			IQ_Table[ lower + 11] := 15; 
	
		26:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 96.92; 
			IQ_Table[ lower + 2] := 41.54; 
			IQ_Table[ lower + 3] := 138.46; 
			IQ_Table[ lower + 4] := 69.23; 
			IQ_Table[ lower + 5] := 166.15; 
			IQ_Table[ lower + 6] := 27.69; 
			IQ_Table[ lower + 7] := 110.77; 
			IQ_Table[ lower + 8] := 55.38; 
			IQ_Table[ lower + 9] := 124.62; 
			IQ_Table[ lower + 10] := 83.08; 
			IQ_Table[ lower + 11] := 152.31; 
			IQ_Table[ lower + 12] := 13.85; 
	
		28:
			IQ_Table[ lower + 0] := 0; 
			IQ_Table[ lower + 1] := 90; 
			IQ_Table[ lower + 2] := 128.57; 
			IQ_Table[ lower + 3] := 38.57; 
			IQ_Table[ lower + 4] := 167.14; 
			IQ_Table[ lower + 5] := 64.29; 
			IQ_Table[ lower + 6] := 25.71; 
			IQ_Table[ lower + 7] := 141.43; 
			IQ_Table[ lower + 8] := 102.86; 
			IQ_Table[ lower + 9] := 77.14; 
			IQ_Table[ lower + 10] := 154.29; 
			IQ_Table[ lower + 11] := 51.43; 
			IQ_Table[ lower + 12] := 115.71; 
			IQ_Table[ lower + 13] := 12.86; 
	
		30:
			IQ_Table[ lower + 0] := 0.00; 
			IQ_Table[ lower + 1] := 84.00; 
			IQ_Table[ lower + 2] := 48.00; 
			IQ_Table[ lower + 3] := 132.00; 
			IQ_Table[ lower + 4] := 24.00; 
			IQ_Table[ lower + 5] := 108.00; 
			IQ_Table[ lower + 6] := 60.00; 
			IQ_Table[ lower + 7] := 144.00; 
			IQ_Table[ lower + 8] := 12.00; 
			IQ_Table[ lower + 9] := 72.00; 
			IQ_Table[ lower + 10] := 120.00; 
			IQ_Table[ lower + 11] := 36.00; 
			IQ_Table[ lower + 12] := 156.00; 
			IQ_Table[ lower + 13] := 96.00; 
			IQ_Table[ lower + 14] := 168.00; 
	
		32:
			IQ_Table[ lower + 0] := 0.00; 
			IQ_Table[ lower + 1] := 90.00; 
			IQ_Table[ lower + 2] := 45.00; 
			IQ_Table[ lower + 3] := 135.00; 
			IQ_Table[ lower + 4] := 22.50; 
			IQ_Table[ lower + 5] := 67.50; 
			IQ_Table[ lower + 6] := 112.50; 
			IQ_Table[ lower + 7] := 157.50; 
			IQ_Table[ lower + 8] := 33.75; 
			IQ_Table[ lower + 9] := 78.75; 
			IQ_Table[ lower + 10] := 123.75; 
			IQ_Table[ lower + 11] := 168.75; 
			IQ_Table[ lower + 12] := 11.25; 
			IQ_Table[ lower + 13] := 56.25; 
			IQ_Table[ lower + 14] := 101.25; 
			IQ_Table[ lower + 15] := 146.25; 
	
		34:
			IQ_Table[ lower + 0] := 0.00; 
			IQ_Table[ lower + 1] := 84.71; 
			IQ_Table[ lower + 2] := 42.35; 
			IQ_Table[ lower + 3] := 137.65; 
			IQ_Table[ lower + 4] := 21.18; 
			IQ_Table[ lower + 5] := 63.53; 
			IQ_Table[ lower + 6] := 116.47; 
			IQ_Table[ lower + 7] := 158.82; 
			IQ_Table[ lower + 8] := 31.76; 
			IQ_Table[ lower + 9] := 105.88; 
			IQ_Table[ lower + 10] := 74.12; 
			IQ_Table[ lower + 11] := 148.24; 
			IQ_Table[ lower + 12] := 10.59; 
			IQ_Table[ lower + 13] := 52.94; 
			IQ_Table[ lower + 14] := 95.29; 
			IQ_Table[ lower + 15] := 127.06; 
			IQ_Table[ lower + 16] := 169.41; 
			
		36:
			IQ_Table[ lower + 0] := 0.00; 
			IQ_Table[ lower + 1] := 90.00; 
			IQ_Table[ lower + 2] := 40.00; 
			IQ_Table[ lower + 3] := 130.00; 
			IQ_Table[ lower + 4] := 20.00; 
			IQ_Table[ lower + 5] := 110.00; 
			IQ_Table[ lower + 6] := 60.00; 
			IQ_Table[ lower + 7] := 150.00; 
			IQ_Table[ lower + 8] := 30.00; 
			IQ_Table[ lower + 9] := 120.00; 
			IQ_Table[ lower + 10] := 70.00; 
			IQ_Table[ lower + 11] := 160.00; 
			IQ_Table[ lower + 12] := 10.00; 
			IQ_Table[ lower + 13] := 100.00; 
			IQ_Table[ lower + 14] := 50.00; 
			IQ_Table[ lower + 15] := 140.00; 
			IQ_Table[ lower + 16] := 80.00; 
			IQ_Table[ lower + 17] := 170.00; 
	
		38:
			IQ_Table[ lower + 0] := 0.00; 
			IQ_Table[ lower + 1] := 85.26; 
			IQ_Table[ lower + 2] := 47.37; 
			IQ_Table[ lower + 3] := 132.63; 
			IQ_Table[ lower + 4] := 28.42; 
			IQ_Table[ lower + 5] := 113.68; 
			IQ_Table[ lower + 6] := 66.32; 
			IQ_Table[ lower + 7] := 161.05; 
			IQ_Table[ lower + 8] := 9.47; 
			IQ_Table[ lower + 9] := 104.21; 
			IQ_Table[ lower + 10] := 56.84; 
			IQ_Table[ lower + 11] := 142.11; 
			IQ_Table[ lower + 12] := 75.79; 
			IQ_Table[ lower + 13] := 170.53; 
			IQ_Table[ lower + 14] := 18.95; 
			IQ_Table[ lower + 15] := 123.16; 
			IQ_Table[ lower + 16] := 37.89; 
			IQ_Table[ lower + 17] := 94.74; 
			IQ_Table[ lower + 18] := 151.58; 
	
		40:
			IQ_Table[ lower + 0]  := 0; 
			IQ_Table[ lower + 1]  := 90.00; 
			IQ_Table[ lower + 2]  := 45.00; 
			IQ_Table[ lower + 3]  := 135.00; 
			IQ_Table[ lower + 4]  := 27.00; 
			IQ_Table[ lower + 5]  := 117.00; 
			IQ_Table[ lower + 6]  := 72.00; 
			IQ_Table[ lower + 7]  := 162.00; 
			IQ_Table[ lower + 8]  := 36.00; 
			IQ_Table[ lower + 9] := 126.00; 
			IQ_Table[ lower + 10] := 63.00; 
			IQ_Table[ lower + 11] := 153.00; 
			IQ_Table[ lower + 12] := 18.00; 
			IQ_Table[ lower + 13] := 108.00; 
			IQ_Table[ lower + 14] := 54.00; 
			IQ_Table[ lower + 15] := 144.00; 
			IQ_Table[ lower + 16] := 9.00; 
			IQ_Table[ lower + 17] := 99.00; 
			IQ_Table[ lower + 18] := 81.00; 
			IQ_Table[ lower + 19] := 171.00; 
	
		42:
			IQ_Table[ lower + 0]  := 0; 
			IQ_Table[ lower + 1]  := 85.71; 
			IQ_Table[ lower + 2]  := 42.86; 
			IQ_Table[ lower + 3]  := 137.14; 
			IQ_Table[ lower + 4]  := 25.71; 
			IQ_Table[ lower + 5]  := 111.43; 
			IQ_Table[ lower + 6]  := 68.57; 
			IQ_Table[ lower + 7]  := 162.86; 
			IQ_Table[ lower + 8]  := 17.14; 
			IQ_Table[ lower + 9] := 102.86; 
			IQ_Table[ lower + 10] := 51.43; 
			IQ_Table[ lower + 11] := 145.71; 
			IQ_Table[ lower + 12] := 34.29; 
			IQ_Table[ lower + 13] := 120.00; 
			IQ_Table[ lower + 14] := 60.00; 
			IQ_Table[ lower + 15] := 154.29; 
			IQ_Table[ lower + 16] := 77.14; 
			IQ_Table[ lower + 17] := 128.57; 
			IQ_Table[ lower + 18] := 8.57; 
			IQ_Table[ lower + 19] := 94.29; 
			IQ_Table[ lower + 20] := 171.43; 
	
		44:
			IQ_Table[ lower + 0]  := 0; 
			IQ_Table[ lower + 1]  := 90.00; 
			IQ_Table[ lower + 2]  := 40.91; 
			IQ_Table[ lower + 3]  := 130.91; 
			IQ_Table[ lower + 4]  := 65.45; 
			IQ_Table[ lower + 5]  := 155.45; 
			IQ_Table[ lower + 6]  := 24.55; 
			IQ_Table[ lower + 7]  := 114.55; 
			IQ_Table[ lower + 8]  := 49.09; 
			IQ_Table[ lower + 9] := 139.09; 
			IQ_Table[ lower + 10] := 16.36; 
			IQ_Table[ lower + 11] := 106.36; 
			IQ_Table[ lower + 12] := 57.27; 
			IQ_Table[ lower + 13] := 147.27; 
			IQ_Table[ lower + 14] := 8.18; 
			IQ_Table[ lower + 15] := 98.18; 
			IQ_Table[ lower + 16] := 73.64; 
			IQ_Table[ lower + 17] := 163.64; 
			IQ_Table[ lower + 18] := 32.73; 
			IQ_Table[ lower + 19] := 122.73; 
			IQ_Table[ lower + 20] := 81.82; 
			IQ_Table[ lower + 21] := 171.82; 
	
		46:
			IQ_Table[ lower + 0]  := 0; 
			IQ_Table[ lower + 1]  := 93.91; 
			IQ_Table[ lower + 2]  := 46.96; 
			IQ_Table[ lower + 3]  := 133.04; 
			IQ_Table[ lower + 4]  := 23.48; 
			IQ_Table[ lower + 5]  := 117.39; 
			IQ_Table[ lower + 6]  := 70.43; 
			IQ_Table[ lower + 7]  := 156.52; 
			IQ_Table[ lower + 8]  := 31.30; 
			IQ_Table[ lower + 9] := 125.22; 
			IQ_Table[ lower + 10] := 62.61; 
			IQ_Table[ lower + 11] := 148.70; 
			IQ_Table[ lower + 12] := 15.65; 
			IQ_Table[ lower + 13] := 109.57; 
			IQ_Table[ lower + 14] := 54.78; 
			IQ_Table[ lower + 15] := 140.87; 
			IQ_Table[ lower + 16] := 86.09; 
			IQ_Table[ lower + 17] := 172.17; 
			IQ_Table[ lower + 18] := 39.13; 
			IQ_Table[ lower + 19] := 101.74; 
			IQ_Table[ lower + 20] := 7.83; 
			IQ_Table[ lower + 21] := 78.26; 
			IQ_Table[ lower + 22] := 164.35; 
	
		48:
			IQ_Table[ lower + 0]  := 0; 
			IQ_Table[ lower + 1]  := 90.00; 
			IQ_Table[ lower + 2]  := 45.00; 
			IQ_Table[ lower + 3]  := 135.00; 
			IQ_Table[ lower + 4]  := 22.50; 
			IQ_Table[ lower + 5]  := 112.50; 
			IQ_Table[ lower + 6]  := 67.50; 
			IQ_Table[ lower + 7]  := 157.50; 
			IQ_Table[ lower + 8]  := 15.00; 
			IQ_Table[ lower + 9] := 105.00; 
			IQ_Table[ lower + 10] := 52.50; 
			IQ_Table[ lower + 11] := 142.50; 
			IQ_Table[ lower + 12] := 30.00; 
			IQ_Table[ lower + 13] := 120.00; 
			IQ_Table[ lower + 14] := 82.50; 
			IQ_Table[ lower + 15] := 172.50; 
			IQ_Table[ lower + 16] := 37.50; 
			IQ_Table[ lower + 17] := 127.50; 
			IQ_Table[ lower + 18] := 60.00; 
			IQ_Table[ lower + 19] := 150.00; 
			IQ_Table[ lower + 20] := 7.50; 
			IQ_Table[ lower + 21] := 97.50; 
			IQ_Table[ lower + 22] := 75.00; 
			IQ_Table[ lower + 23] := 165.00; 
	
		50:
			IQ_Table[ lower + 0]  := 0.00; 
			IQ_Table[ lower + 1]  := 93.60; 
			IQ_Table[ lower + 2]  := 43.20; 
			IQ_Table[ lower + 3]  := 136.80; 
			IQ_Table[ lower + 4]  := 21.60; 
			IQ_Table[ lower + 5]  := 72.00; 
			IQ_Table[ lower + 6]  := 115.20; 
			IQ_Table[ lower + 7]  := 158.40; 
			IQ_Table[ lower + 8]  := 7.20; 
			IQ_Table[ lower + 9]  := 100.80; 
			IQ_Table[ lower + 10]  := 57.60; 
			IQ_Table[ lower + 11]  := 151.20; 
			IQ_Table[ lower + 12]  := 36.00; 
			IQ_Table[ lower + 13]  := 122.40; 
			IQ_Table[ lower + 14]  := 64.80; 
			IQ_Table[ lower + 15]  := 165.60; 
			IQ_Table[ lower + 16]  := 14.40; 
			IQ_Table[ lower + 17]  := 86.40; 
			IQ_Table[ lower + 18]  := 50.40; 
			IQ_Table[ lower + 19]  := 144.00; 
			IQ_Table[ lower + 20]  := 79.20; 
			IQ_Table[ lower + 21]  := 108.00; 
			IQ_Table[ lower + 22]  := 172.80; 
			IQ_Table[ lower + 23]  := 28.80; 
			IQ_Table[ lower + 24]  := 129.60; 
	
		52:
			IQ_Table[ lower + 0]  := 0.00; 
			IQ_Table[ lower + 1]  := 90.00; 
			IQ_Table[ lower + 2]  := 48.46; 
			IQ_Table[ lower + 3]  := 138.46; 
			IQ_Table[ lower + 4]  := 27.69; 
			IQ_Table[ lower + 5]  := 117.69; 
			IQ_Table[ lower + 6]  := 69.23; 
			IQ_Table[ lower + 7]  := 159.23; 
			IQ_Table[ lower + 8]  := 13.85; 
			IQ_Table[ lower + 9]  := 103.85; 
			IQ_Table[ lower + 10]  := 55.38; 
			IQ_Table[ lower + 11]  := 145.38; 
			IQ_Table[ lower + 12]  := 20.77; 
			IQ_Table[ lower + 13]  := 110.77; 
			IQ_Table[ lower + 14]  := 76.15; 
			IQ_Table[ lower + 15]  := 166.15; 
			IQ_Table[ lower + 16]  := 6.92; 
			IQ_Table[ lower + 17]  := 96.92; 
			IQ_Table[ lower + 18]  := 41.54; 
			IQ_Table[ lower + 19]  := 131.54; 
			IQ_Table[ lower + 20]  := 62.31; 
			IQ_Table[ lower + 21]  := 152.31; 
			IQ_Table[ lower + 22]  := 34.62; 
			IQ_Table[ lower + 23]  := 124.62; 
			IQ_Table[ lower + 24]  := 83.08; 
			IQ_Table[ lower + 25]  := 173.08; 
	
		54:
			IQ_Table[ lower + 0]  := 0.00; 
			IQ_Table[ lower + 1]  := 86.67; 
			IQ_Table[ lower + 2]  := 46.67; 
			IQ_Table[ lower + 3]  := 133.33; 
			IQ_Table[ lower + 4]  := 26.67; 
			IQ_Table[ lower + 5]  := 113.33; 
			IQ_Table[ lower + 6]  := 66.67; 
			IQ_Table[ lower + 7]  := 153.33; 
			IQ_Table[ lower + 8]  := 13.33; 
			IQ_Table[ lower + 9]  := 100.00; 
			IQ_Table[ lower + 10]  := 53.33; 
			IQ_Table[ lower + 11]  := 146.67; 
			IQ_Table[ lower + 12]  := 33.33; 
			IQ_Table[ lower + 13]  := 120.00; 
			IQ_Table[ lower + 14]  := 60.00; 
			IQ_Table[ lower + 15]  := 160.00; 
			IQ_Table[ lower + 16]  := 6.67; 
			IQ_Table[ lower + 17]  := 93.33; 
			IQ_Table[ lower + 18]  := 40.00; 
			IQ_Table[ lower + 19]  := 140.00; 
			IQ_Table[ lower + 20]  := 20.00; 
			IQ_Table[ lower + 21]  := 80.00; 
			IQ_Table[ lower + 22]  := 166.67; 
			IQ_Table[ lower + 23]  := 73.33; 
			IQ_Table[ lower + 24]  := 106.67; 
			IQ_Table[ lower + 25]  := 173.33; 
			IQ_Table[ lower + 26]  := 126.67; 
	
		56:
			IQ_Table[ lower + 0]  := 0.00; 
			IQ_Table[ lower + 1]  := 90.00; 
			IQ_Table[ lower + 2]  := 45.00; 
			IQ_Table[ lower + 3]  := 135.00; 
			IQ_Table[ lower + 4]  := 25.71; 
			IQ_Table[ lower + 5]  := 115.71; 
			IQ_Table[ lower + 6]  := 70.71; 
			IQ_Table[ lower + 7]  := 160.71; 
			IQ_Table[ lower + 8]  := 12.86; 
			IQ_Table[ lower + 9]  := 102.86; 
			IQ_Table[ lower + 10]  := 57.86; 
			IQ_Table[ lower + 11]  := 147.86; 
			IQ_Table[ lower + 12]  := 38.57; 
			IQ_Table[ lower + 13]  := 128.57; 
			IQ_Table[ lower + 14]  := 83.57; 
			IQ_Table[ lower + 15]  := 173.57; 
			IQ_Table[ lower + 16]  := 6.43; 
			IQ_Table[ lower + 17]  := 96.43; 
			IQ_Table[ lower + 18]  := 51.43; 
			IQ_Table[ lower + 19]  := 141.43; 
			IQ_Table[ lower + 20]  := 32.14; 
			IQ_Table[ lower + 21]  := 122.14; 
			IQ_Table[ lower + 22]  := 64.29; 
			IQ_Table[ lower + 23]  := 154.29; 
			IQ_Table[ lower + 24]  := 19.29; 
			IQ_Table[ lower + 25]  := 109.29; 
			IQ_Table[ lower + 26]  := 77.14; 
			IQ_Table[ lower + 27]  := 167.14; 
	
		58:
			IQ_Table[ lower + 0]  := 0.00; 
			IQ_Table[ lower + 1]  := 93.10; 
			IQ_Table[ lower + 2]  := 43.45; 
			IQ_Table[ lower + 3]  := 136.55; 
			IQ_Table[ lower + 4]  := 24.83; 
			IQ_Table[ lower + 5]  := 117.93; 
			IQ_Table[ lower + 6]  := 68.28; 
			IQ_Table[ lower + 7]  := 161.38; 
			IQ_Table[ lower + 8]  := 37.24; 
			IQ_Table[ lower + 9]  := 130.34; 
			IQ_Table[ lower + 10]  := 55.86; 
			IQ_Table[ lower + 11]  := 148.97; 
			IQ_Table[ lower + 12]  := 12.41; 
			IQ_Table[ lower + 13]  := 105.52; 
			IQ_Table[ lower + 14]  := 31.03; 
			IQ_Table[ lower + 15]  := 124.14; 
			IQ_Table[ lower + 16]  := 49.66; 
			IQ_Table[ lower + 17]  := 142.76; 
			IQ_Table[ lower + 18]  := 6.21; 
			IQ_Table[ lower + 19]  := 99.31; 
			IQ_Table[ lower + 20]  := 62.07; 
			IQ_Table[ lower + 21]  := 155.17; 
			IQ_Table[ lower + 22]  := 74.48; 
			IQ_Table[ lower + 23]  := 111.72; 
			IQ_Table[ lower + 24]  := 173.79; 
			IQ_Table[ lower + 25]  := 86.90; 
			IQ_Table[ lower + 26]  := 18.62; 
			IQ_Table[ lower + 27]  := 167.59; 
			IQ_Table[ lower + 28]  := 80.69; 
	
		60:
			IQ_Table[ lower + 0]  := 0.00; 
			IQ_Table[ lower + 1]  := 90.00; 
			IQ_Table[ lower + 2]  := 48.00; 
			IQ_Table[ lower + 3]  := 138.00; 
			IQ_Table[ lower + 4]  := 24.00; 
			IQ_Table[ lower + 5]  := 114.00; 
			IQ_Table[ lower + 6]  := 66.00; 
			IQ_Table[ lower + 7]  := 156.00; 
			IQ_Table[ lower + 8]  := 36.00; 
			IQ_Table[ lower + 9]  := 126.00; 
			IQ_Table[ lower + 10]  := 78.00; 
			IQ_Table[ lower + 11]  := 168.00; 
			IQ_Table[ lower + 12]  := 12.00; 
			IQ_Table[ lower + 13]  := 102.00; 
			IQ_Table[ lower + 14]  := 60.00; 
			IQ_Table[ lower + 15]  := 150.00; 
			IQ_Table[ lower + 16]  := 30.00; 
			IQ_Table[ lower + 17]  := 120.00; 
			IQ_Table[ lower + 18]  := 72.00; 
			IQ_Table[ lower + 19]  := 162.00; 
			IQ_Table[ lower + 20]  := 6.00; 
			IQ_Table[ lower + 21]  := 96.00; 
			IQ_Table[ lower + 22]  := 42.00; 
			IQ_Table[ lower + 23]  := 132.00; 
			IQ_Table[ lower + 24]  := 18.00; 
			IQ_Table[ lower + 25]  := 108.00; 
			IQ_Table[ lower + 26]  := 54.00; 
			IQ_Table[ lower + 27]  := 144.00; 
			IQ_Table[ lower + 28]  := 84.00; 
			IQ_Table[ lower + 29]  := 174.00; 
	
		62:
			IQ_Table[ lower + 0]  := 0.00; 
			IQ_Table[ lower + 1]  := 92.90; 
			IQ_Table[ lower + 2]  := 46.45; 
			IQ_Table[ lower + 3]  := 139.35; 
			IQ_Table[ lower + 4]  := 29.03; 
			IQ_Table[ lower + 5]  := 116.13; 
			IQ_Table[ lower + 6]  := 69.68; 
			IQ_Table[ lower + 7]  := 156.77; 
			IQ_Table[ lower + 8]  := 11.61; 
			IQ_Table[ lower + 9]  := 104.52; 
			IQ_Table[ lower + 10]  := 52.26; 
			IQ_Table[ lower + 11]  := 145.16; 
			IQ_Table[ lower + 12]  := 23.23; 
			IQ_Table[ lower + 13]  := 110.32; 
			IQ_Table[ lower + 14]  := 40.65; 
			IQ_Table[ lower + 15]  := 133.55; 
			IQ_Table[ lower + 16]  := 5.81; 
			IQ_Table[ lower + 17]  := 87.10; 
			IQ_Table[ lower + 18]  := 58.06; 
			IQ_Table[ lower + 19]  := 162.58; 
			IQ_Table[ lower + 20]  := 34.84; 
			IQ_Table[ lower + 21]  := 127.74; 
			IQ_Table[ lower + 22]  := 75.48; 
			IQ_Table[ lower + 23]  := 168.39; 
			IQ_Table[ lower + 24]  := 17.42; 
			IQ_Table[ lower + 25]  := 98.71; 
			IQ_Table[ lower + 26]  := 63.87; 
			IQ_Table[ lower + 27]  := 150.97; 
			IQ_Table[ lower + 28]  := 121.94; 
			IQ_Table[ lower + 29]  := 174.19; 
			IQ_Table[ lower + 30]  := 81.29; 
	
		64:
			IQ_Table[ lower + 0]  := 0; 
			IQ_Table[ lower + 1]  := 90; 
			IQ_Table[ lower + 2]  := 45; 
			IQ_Table[ lower + 3]  := 135; 
			IQ_Table[ lower + 4]  := 22.5; 
			IQ_Table[ lower + 5]  := 112.5; 
			IQ_Table[ lower + 6]  := 67.5; 
			IQ_Table[ lower + 7]  := 157.5; 
			IQ_Table[ lower + 8]  := 11.25; 
			IQ_Table[ lower + 9]  := 101.25; 
			IQ_Table[ lower + 10]  := 56.25; 
			IQ_Table[ lower + 11]  := 146.25; 
			IQ_Table[ lower + 12]  := 78.75; 
			IQ_Table[ lower + 13]  := 168.75; 
			IQ_Table[ lower + 14]  := 33.75; 
			IQ_Table[ lower + 15]  := 123.75; 
			IQ_Table[ lower + 16]  := 61.875; 
			IQ_Table[ lower + 17]  := 151.875; 
			IQ_Table[ lower + 18]  := 28.125; 
			IQ_Table[ lower + 19]  := 118.125; 
			IQ_Table[ lower + 20]  := 50.625; 
			IQ_Table[ lower + 21]  := 140.625; 
			IQ_Table[ lower + 22]  := 5.625; 
			IQ_Table[ lower + 23]  := 95.625; 
			IQ_Table[ lower + 24]  := 39.375; 
			IQ_Table[ lower + 25]  := 129.375; 
			IQ_Table[ lower + 26]  := 16.875; 
			IQ_Table[ lower + 27]  := 106.875; 
			IQ_Table[ lower + 28]  := 73.125; 
			IQ_Table[ lower + 29]  := 163.125; 
			IQ_Table[ lower + 30]  := 84.375; 
			IQ_Table[ lower + 31]  := 174.375; 
	
		66:
			IQ_Table[ lower + 0]  := 0.00; 
			IQ_Table[ lower + 1]  := 87.27; 
			IQ_Table[ lower + 2]  := 43.64; 
			IQ_Table[ lower + 3]  := 136.36; 
			IQ_Table[ lower + 4]  := 16.36; 
			IQ_Table[ lower + 5]  := 109.09; 
			IQ_Table[ lower + 6]  := 65.45; 
			IQ_Table[ lower + 7]  := 158.18; 
			IQ_Table[ lower + 8]  := 32.73; 
			IQ_Table[ lower + 9]  := 125.45; 
			IQ_Table[ lower + 10]  := 76.36; 
			IQ_Table[ lower + 11]  := 169.09; 
			IQ_Table[ lower + 12]  := 21.82; 
			IQ_Table[ lower + 13]  := 114.55; 
			IQ_Table[ lower + 14]  := 54.55; 
			IQ_Table[ lower + 15]  := 147.27; 
			IQ_Table[ lower + 16]  := 5.45; 
			IQ_Table[ lower + 17]  := 98.18; 
			IQ_Table[ lower + 18]  := 49.09; 
			IQ_Table[ lower + 19]  := 141.82; 
			IQ_Table[ lower + 20]  := 27.27; 
			IQ_Table[ lower + 21]  := 120.00; 
			IQ_Table[ lower + 22]  := 70.91; 
			IQ_Table[ lower + 23]  := 163.64; 
			IQ_Table[ lower + 24]  := 10.91; 
			IQ_Table[ lower + 25]  := 103.64; 
			IQ_Table[ lower + 26]  := 60.00; 
			IQ_Table[ lower + 27]  := 152.73; 
			IQ_Table[ lower + 28]  := 174.55; 
			IQ_Table[ lower + 29]  := 92.73; 
			IQ_Table[ lower + 30]  := 130.91; 
			IQ_Table[ lower + 31]  := 81.82; 
			IQ_Table[ lower + 32]  := 38.18; 
	
		68:
			IQ_Table[ lower + 0]  := 0.00; 
			IQ_Table[ lower + 1]  := 90.00; 
			IQ_Table[ lower + 2]  := 47.65; 
			IQ_Table[ lower + 3]  := 137.65; 
			IQ_Table[ lower + 4]  := 21.18; 
			IQ_Table[ lower + 5]  := 116.47; 
			IQ_Table[ lower + 6]  := 68.82; 
			IQ_Table[ lower + 7]  := 158.82; 
			IQ_Table[ lower + 8]  := 37.06; 
			IQ_Table[ lower + 9]  := 127.06; 
			IQ_Table[ lower + 10]  := 58.24; 
			IQ_Table[ lower + 11]  := 148.24; 
			IQ_Table[ lower + 12]  := 10.59; 
			IQ_Table[ lower + 13]  := 105.88; 
			IQ_Table[ lower + 14]  := 42.35; 
			IQ_Table[ lower + 15]  := 132.35; 
			IQ_Table[ lower + 16]  := 26.47; 
			IQ_Table[ lower + 17]  := 111.18; 
			IQ_Table[ lower + 18]  := 52.94; 
			IQ_Table[ lower + 19]  := 142.94; 
			IQ_Table[ lower + 20]  := 5.29; 
			IQ_Table[ lower + 21]  := 95.29; 
			IQ_Table[ lower + 22]  := 63.53; 
			IQ_Table[ lower + 23]  := 153.53; 
			IQ_Table[ lower + 24]  := 31.76; 
			IQ_Table[ lower + 25]  := 121.76; 
			IQ_Table[ lower + 26]  := 79.41; 
			IQ_Table[ lower + 27]  := 169.41; 
			IQ_Table[ lower + 28]  := 15.88; 
			IQ_Table[ lower + 29]  := 100.59; 
			IQ_Table[ lower + 30]  := 174.71; 
			IQ_Table[ lower + 31]  := 74.12; 
			IQ_Table[ lower + 32]  := 164.12; 
			IQ_Table[ lower + 33]  := 84.71; 
	
		70:
			IQ_Table[ lower + 0]  := 0.00; 
			IQ_Table[ lower + 1]  := 92.57; 
			IQ_Table[ lower + 2]  := 46.29; 
			IQ_Table[ lower + 3]  := 133.71; 
			IQ_Table[ lower + 4]  := 25.71; 
			IQ_Table[ lower + 5]  := 113.14; 
			IQ_Table[ lower + 6]  := 72.00; 
			IQ_Table[ lower + 7]  := 159.43; 
			IQ_Table[ lower + 8]  := 36.00; 
			IQ_Table[ lower + 9]  := 123.43; 
			IQ_Table[ lower + 10]  := 82.29; 
			IQ_Table[ lower + 11]  := 169.71; 
			IQ_Table[ lower + 12]  := 10.29; 
			IQ_Table[ lower + 13]  := 102.86; 
			IQ_Table[ lower + 14]  := 56.57; 
			IQ_Table[ lower + 15]  := 144.00; 
			IQ_Table[ lower + 16]  := 30.86; 
			IQ_Table[ lower + 17]  := 118.29; 
			IQ_Table[ lower + 18]  := 61.71; 
			IQ_Table[ lower + 19]  := 149.14; 
			IQ_Table[ lower + 20]  := 5.14; 
			IQ_Table[ lower + 21]  := 97.71; 
			IQ_Table[ lower + 22]  := 51.43; 
			IQ_Table[ lower + 23]  := 154.29; 
			IQ_Table[ lower + 24]  := 20.57; 
			IQ_Table[ lower + 25]  := 108.00; 
			IQ_Table[ lower + 26]  := 41.14; 
			IQ_Table[ lower + 27]  := 128.57; 
			IQ_Table[ lower + 28]  := 77.14; 
			IQ_Table[ lower + 29]  := 164.57; 
			IQ_Table[ lower + 30]  := 15.43; 
			IQ_Table[ lower + 31]  := 138.86; 
			IQ_Table[ lower + 32]  := 87.43; 
			IQ_Table[ lower + 33]  := 174.86; 
			IQ_Table[ lower + 34]  := 66.86; 
		ELSE
			Calc_RoundCakeDivisionsTable := -1;
			RETURN;
	END_CASE
END_IF


IF g_bCurrentTableUniversal10 THEN
	IQ_Table[1] := IQ_Table[1] +5; 
	IQ_Table[2] := IQ_Table[2] +5; 
	IQ_Table[3] := IQ_Table[3] +5; 
	IQ_Table[4] := IQ_Table[4] +5; 
	IQ_Table[5] := IQ_Table[5] +5; 
END_IF




Calc_RoundCakeDivisionsTable := I_Divisions / 2;
RETURN;

END_FUNCTION
