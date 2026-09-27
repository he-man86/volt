PROGRAM POUexecute
VAR
	iCount:INT;
	
	t1: TON;
	output: BOOL;
	e1: TIME;
	in1: BOOL;
	a: BOOL;
	b: BOOL;
	c: BOOL;
	out1: BOOL;
	t2: TON;
	out2: INT;
END_VAR
(* @volt-implementation LD *)
NETWORK
  EXECUTE(EN := TRUE)
iCount:=icount+1;

  END_EXECUTE;
END_NETWORK
NETWORK
  output := t1(IN := in1, PT := e1);
END_NETWORK
NETWORK
  VAR_TEMP g1 : BOOL; END_VAR
  g1 := b;
  out1 := ((a OR g1) AND c);
  out2 := g1;
END_NETWORK
NETWORK
  output := t2(IN := , PT := e1);
END_NETWORK

END_PROGRAM
