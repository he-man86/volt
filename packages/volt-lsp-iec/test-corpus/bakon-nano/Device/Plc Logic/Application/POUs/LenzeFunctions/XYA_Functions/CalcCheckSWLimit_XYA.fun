(***********************************************************************************
Creation: LENL 		Datum: march 2008		Version: 1.0.0
 ***********************************************************************************
 FUNCTION:					

check SW limits for XYA

 ***********************************************************************************
Name							Datum				Changes
Kling 							24.03.2009		Implementation

************************************************************************************
NOTE:	

***********************************************************************************)


FUNCTION CalcCheckSWLimit_XYA : BOOL
VAR_INPUT
	Point :XYA_Target;
	AxisX :REFERENCE TO AXIS_REF;
	AxisY :REFERENCE TO AXIS_REF;
	AxisA :REFERENCE TO AXIS_REF;
END_VAR
VAR
END_VAR

CalcCheckSWLimit_XYA:=FALSE;
IF (Point.X_Target < AxisX.lrSWLimitNeg) OR  (Point.X_Target >  AxisX.lrSWLimitPos) OR (Point.Y_Target < AxisY.lrSWLimitNeg) OR 	(Point.Y_Target >  AxisY.lrSWLimitPos) OR (Point.A_Target < AxisA.lrSWLimitNeg) OR  (Point.A_Target >  AxisA.lrSWLimitPos)  THEN
	CalcCheckSWLimit_XYA:=TRUE;
END_IF

END_FUNCTION
