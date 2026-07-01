// Helper functions for module axes
{attribute 'no_explicit_call' := 'Static helper class for modulo functions'}
{attribute 'hide_all_locals'}
PROGRAM ModuloTools
VAR
END_VAR

END_PROGRAM

// Calculate distance of a product on a chain. Rollover is corrected.
METHOD PUBLIC GetDistance : REAL
VAR_INPUT
	productPos		: REAL;		// Position of product on conveyor or chain (mm)
	rollover		: LREAL;	// Rollover (mm)
	actPos			: REAL;		// Current position (mm)
END_VAR
VAR
	delta			: REAL;
END_VAR
// Difference of the 2 positions is how far the product has moved on the conveyor
delta		:= actPos - productPos;

// Correct distance for the rollover
GetDistance	:= SetPosition(delta, rollover);
END_METHOD

// Check if a position lies within a window. Rollover is corrected.
METHOD PUBLIC PositionInWindow : BOOL
VAR_INPUT
	position		: REAL;			// Position to check
	rollover		: LREAL;		// Rollover (mm)
	windowMin		: REAL;			// Position must be >= windowMin
	windowMax		: REAL;			// Position must be <= windowMax
END_VAR

(* Use like this to check camera position on chain:
result := ModuloTools.PositionInWindow(
			position	:= actPos,
			rollover	:= CycleLength,
			windowMin	:= ModuloTools.SetPosition(
								setPos		:= targetPos - adjustTriggerPosition,
								rollover	:= CycleLength),
			windowMax	:= ModuloTools.SetPosition(
								setPos		:= targetPos + 1,
								rollover	:= CycleLength));
*)
// There is no rollover in the window
IF windowMin <= windowMax THEN
	PositionInWindow	:= position >= windowMin AND position <= windowMax;

// Position to check is in the first half of the module cycle length
ELSIF position < TO_REAL(rollover) / 2 THEN
	PositionInWindow	:= position < windowMax;

ELSE
	PositionInWindow	:= position > windowMin;
END_IF
END_METHOD

// Check if position is on a step somewhere on the chain
METHOD PUBLIC PositionOnStep : BOOL
VAR_INPUT
	position		: REAL;			// Position to check
	stepDistance	: REAL;
	hysteresis		: REAL	:= 1;	// Max allowed difference
END_VAR
VAR
	delta			: REAL;
END_VAR
// Get the remainder of position / stepDistance. This is how much the position is different.
delta := TO_REAL( TO_DINT(position * 10) MOD TO_DINT(stepDistance * 10) ) / 10;

// Delta goes from 0 to stepDistance. Change this so it is the shortest distance to a step.
delta := SEL(	delta < stepDistance - delta,
				stepDistance - delta,
				delta);

// delta goes from - half-stepDistance to + half-stepDistance

PositionOnStep := delta <= hysteresis;
END_METHOD

// Check if position is on a step with offset somewhere on the chain.
// Use this to check a sensor on a chain during movement.
METHOD PUBLIC PositionOnStepWithOffset : BOOL
VAR_INPUT
	position		: REAL;			// Position to check
	stepDistance	: REAL;
	hysteresisStart	: REAL;			// Max allowed difference
	hysteresisEnd	: REAL;			// Max allowed difference
END_VAR
VAR
	delta			: REAL;
END_VAR

(* Example how to use:
rejectSensorValid	:= Data.rejectSensorOffset = 0
				OR_ELSE ModuloTools.PositionOnStepWithOffset(
							position		:= Drive.rActPosition,
							stepDistance	:= Data.Step.rPos,
							hysteresisStart	:= Data.rejectSensorOffset[1],
							hysteresisEnd	:= Data.rejectSensorOffset[1] + 10);

alarmActive			:= rejectSensorValid AND NOT sensorRowIsEmpty;
*)
// Get the remainder of position / stepDistance. This is how much the position is different.
delta := TO_REAL( TO_DINT(position * 10) MOD TO_DINT(stepDistance * 10) ) / 10;

// Delta goes from 0 to stepDistance.

PositionOnStepWithOffset := PositionInWindow(
								position		:= delta,
								rollover		:= stepDistance,
								windowMin		:= SetPosition(
														position	:= hysteresisStart,
														rollOver	:= stepDistance),
								windowMax		:= SetPosition(
														position	:= hysteresisEnd,
														rollOver	:= stepDistance),);
END_METHOD

// Check if two positions match for a Modulo axis (within rHysteresis mm).
METHOD PUBLIC PositionReached : BOOL
VAR_INPUT
	actPos			: REAL;			// Actual encoder position
	setPos			: REAL;			// Set position of drive
	rollover		: LREAL;		// Rollover (mm)
	hysteresis		: REAL	:= 1;	// Max allowed difference
END_VAR
PositionReached	:= PositionInWindow(
						actPos,
						rollover,
						SetPosition(setPos - hysteresis, rollover),
						SetPosition(setPos + hysteresis, rollover));
END_METHOD

// Make sure that the set position is always between 0 and rollover.
METHOD PUBLIC SetPosition : REAL
VAR_INPUT
	position		: REAL;			// Position where to move the chain to
	rollover		: LREAL;		// Rollover (mm)
END_VAR
VAR
	correctedPos	: REAL;
END_VAR
IF rollover < 0.001 THEN	// Exception happens when rollover is zero
	SetPosition		:= 0.0;
	RETURN;
END_IF

correctedPos		:= position;

WHILE correctedPos > TO_REAL(rollover) DO
	correctedPos	:= correctedPos - TO_REAL(rollover);
END_WHILE

WHILE correctedPos < 0.0 DO
	correctedPos	:= correctedPos + TO_REAL(rollover);
END_WHILE

SetPosition			:= correctedPos;
END_METHOD
