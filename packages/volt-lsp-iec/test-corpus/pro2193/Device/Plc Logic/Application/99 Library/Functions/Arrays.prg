// Helper functions for arrays
{attribute 'no_explicit_call' := 'Static helper class to do stuff with all kinds of arrays'}
{attribute 'hide_all_locals'}
PROGRAM Arrays

// Because arrays are value-type, it's not possible to cast an array of fbs to another type.
// More info here:
// https://stackoverflow.com/questions/69319659/how-do-i-pass-an-array-of-an-extended-type-in-codesys-twincat3

// The function Vacuum_ResetAll should not be needed !!!
// The interface IVacuum extends IActuator,
// so you should be able to use ActuatorResetAll for vacuums too
// However, this does not work with dynamic arrays
// You get error message: Cannot convert type 'ARRAY[1..3] of IVacuum' to type 'ARRAY[*] of IActuator
// Hopefully CODESYS fixes this in the future.

END_PROGRAM

// Returns true if all elements in the actuator array are equal to condition.
METHOD PUBLIC Actuator_All : BOOL
VAR_IN_OUT
	actuatorArray		: ARRAY[*] OF IActuator;
END_VAR
VAR_INPUT
	condition			: BOOL;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Tests
lower	:= LOWER_BOUND(actuatorArray, 1);
upper	:= UPPER_BOUND(actuatorArray, 1);

Actuator_All := TRUE;

FOR di := lower TO upper DO
	IF actuatorArray[di] = 0 THEN
		LogPlc.Fatal('Actuator_All: Element in array of interfaces is NULL!');
		Actuator_All := FALSE;
		EXIT;
	ELSIF actuatorArray[di].Map() <> condition THEN
		Actuator_All := FALSE;
		EXIT;	// Exit the loop on the first match
	END_IF
END_FOR
END_METHOD

// Returns true if any element in the actuator array is equal to condition.
METHOD PUBLIC Actuator_Any : BOOL
VAR_IN_OUT
	actuatorArray		: ARRAY[*] OF IActuator;
END_VAR
VAR_INPUT
	condition			: BOOL;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Tests
lower	:= LOWER_BOUND(actuatorArray, 1);
upper	:= UPPER_BOUND(actuatorArray, 1);

FOR di := lower TO upper DO
	IF actuatorArray[di] = 0 THEN
		LogPlc.Fatal('Actuator_Any: Element in array of interfaces is NULL!');
	ELSIF actuatorArray[di].Map() = condition THEN
		Actuator_Any := TRUE;
		EXIT;	// Exit the loop on the first match
	END_IF
END_FOR
END_METHOD

// Fires the Reset method on the actuator array
METHOD PUBLIC Actuator_ResetAll
VAR_IN_OUT
	actuatorArray		: ARRAY[*] OF IActuator;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Execute methods
lower	:= LOWER_BOUND(actuatorArray, 1);
upper	:= UPPER_BOUND(actuatorArray, 1);

FOR di := lower TO upper DO
	IF actuatorArray[di] = 0 THEN
		LogPlc.Fatal('Actuator_ResetAll: Element in array of interfaces is NULL!');
	ELSE
		actuatorArray[di].Reset();
	END_IF
END_FOR
END_METHOD

// Returns true if all the modules (Xi, Xu, or Y unit) are in a safe position
METHOD PUBLIC AllUnitsAreInSafePosition : BOOL
VAR_IN_OUT
	safeModules			: ARRAY[*] OF IModuleHasSafePos;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Tests
lower	:= LOWER_BOUND(safeModules, 1);
upper	:= UPPER_BOUND(safeModules, 1);

AllUnitsAreInSafePosition := TRUE;

FOR di := lower TO upper DO
	IF safeModules[di] = 0 THEN
		ThrowException('AllUnitsAreInSafePosition: Element in array of interfaces is NULL!');
	ELSIF NOT safeModules[di].InSafePos THEN
		AllUnitsAreInSafePosition := FALSE;
		EXIT;	// Exit the loop on the first match
	END_IF
END_FOR
END_METHOD

// Returns true if all elements in the bool array are equal to condition
METHOD PUBLIC Bool_All : BOOL
VAR_IN_OUT
	boolArray			: ARRAY[*] OF BOOL;
END_VAR
VAR_INPUT
	condition			: BOOL;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Tests
lower	:= LOWER_BOUND(boolArray, 1);
upper	:= UPPER_BOUND(boolArray, 1);

Bool_All := TRUE;

FOR di := lower TO upper DO
	IF boolArray[di] <> condition THEN
		Bool_All := FALSE;
		EXIT;						// Exit the loop on the first match
	END_IF
END_FOR
END_METHOD

// Returns true if any element in the bool array is equal to condition
METHOD PUBLIC Bool_Any : BOOL
VAR_IN_OUT
	boolArray			: ARRAY[*] OF BOOL;
END_VAR
VAR_INPUT
	condition			: BOOL;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Tests
lower	:= LOWER_BOUND(boolArray, 1);
upper	:= UPPER_BOUND(boolArray, 1);

FOR di := lower TO upper DO
	IF boolArray[di] = condition THEN
		Bool_Any := TRUE;
		EXIT;						// Exit the loop on the first match
	END_IF
END_FOR
END_METHOD

// Resets all booleans in an array
METHOD PUBLIC Bool_Reset
VAR_IN_OUT
	boolArray		: ARRAY[*] OF BOOL;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Execute methods
lower	:= LOWER_BOUND(boolArray, 1);
upper	:= UPPER_BOUND(boolArray, 1);

FOR di := lower TO upper DO
	boolArray[di] := FALSE;
END_FOR
END_METHOD

// Sets all booleans in an array
METHOD PUBLIC Bool_Set
VAR_IN_OUT
	boolArray		: ARRAY[*] OF BOOL;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Execute methods
lower	:= LOWER_BOUND(boolArray, 1);
upper	:= UPPER_BOUND(boolArray, 1);

FOR di := lower TO upper DO
	boolArray[di] := TRUE;
END_FOR
END_METHOD

// Returns true if all digital sensors in the array are equal to condition
METHOD PUBLIC DigitalSensor_All : BOOL
VAR_IN_OUT
	sensorArray			: ARRAY[*] OF DigitalSensorFB;
END_VAR
VAR_INPUT
	condition			: BOOL;		// TRUE = IsActive, FALSE = IsInactive
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Digital Sensors
lower	:= LOWER_BOUND(sensorArray, 1);
upper	:= UPPER_BOUND(sensorArray, 1);

DigitalSensor_All := TRUE;

FOR di := lower TO upper DO
	IF (condition AND NOT sensorArray[di].IsActive)
	OR (NOT condition AND NOT sensorArray[di].IsInactive)
	THEN
		DigitalSensor_All := FALSE;
		EXIT;						// Exit the loop on the first match
	END_IF
END_FOR
END_METHOD

// Returns true if any element in the bool array is equal to condition
METHOD PUBLIC DigitalSensor_Any : BOOL
VAR_IN_OUT
	sensorArray			: ARRAY[*] OF DigitalSensorFB;
END_VAR
VAR_INPUT
	condition			: BOOL;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Digital Sensors
lower	:= LOWER_BOUND(sensorArray, 1);
upper	:= UPPER_BOUND(sensorArray, 1);

FOR di := lower TO upper DO
	IF (condition AND sensorArray[di].IsActive)
	OR (NOT condition AND sensorArray[di].IsInactive)
	THEN
		DigitalSensor_Any := TRUE;
		EXIT;						// Exit the loop on the first match
	END_IF
END_FOR
END_METHOD

// Returns true if all digital sensors (that are enabled) in the array are equal to condition
METHOD PUBLIC DigitalSensor_Enabled_All : BOOL
VAR_IN_OUT
	sensorArray			: ARRAY[*] OF DigitalSensorWithEnableFB;
END_VAR
VAR_INPUT
	bitMask				: DWORD;	// Only test sensors when corresponding bitnumber is high.
	condition			: BOOL;
END_VAR
VAR
	upper, lower, di	: DINT;
	counter				: USINT := 0;
END_VAR
%FOLDER Digital Sensors
lower	:= LOWER_BOUND(sensorArray, 1);
upper	:= UPPER_BOUND(sensorArray, 1);

DigitalSensor_Enabled_All := TRUE;

FOR di := lower TO upper DO

	IF NOT BitLogic.Extract(bitMask, counter) THEN	// not cavity disabled
		IF (condition AND NOT sensorArray[di].IsActive)
		OR (NOT condition AND NOT sensorArray[di].IsInactive)
		THEN
			IF sensorArray[di].IsEnabled THEN		//Only reset when sensor is enabled
				DigitalSensor_Enabled_All := FALSE;
				EXIT;						// Exit the loop on the first match
			END_IF
		END_IF
	END_IF

	Increment.AnyInt(counter);
END_FOR
END_METHOD

// Returns true if any element (that is enabled) in the bool array is equal to condition
METHOD PUBLIC DigitalSensor_Enabled_Any : BOOL
VAR_IN_OUT
	sensorArray			: ARRAY[*] OF DigitalSensorWithEnableFB;
END_VAR
VAR_INPUT
	bitMask				: DWORD;	// Only test sensors when corresponding bitnumber is high.
	condition			: BOOL;
END_VAR
VAR
	upper, lower, di	: DINT;
	counter				: USINT := 0;
END_VAR
%FOLDER Digital Sensors
lower	:= LOWER_BOUND(sensorArray, 1);
upper	:= UPPER_BOUND(sensorArray, 1);

FOR di := lower TO upper DO

	IF NOT BitLogic.Extract(bitMask, counter) THEN	// not cavity disabled
		IF (condition AND sensorArray[di].IsActive)
		OR (NOT condition AND sensorArray[di].IsInactive)
		THEN
			IF sensorArray[di].IsEnabled THEN		// Only set when sensor is enabled
				DigitalSensor_Enabled_Any := TRUE;
				EXIT;						// Exit the loop on the first match
			END_IF
		END_IF
	END_IF

	Increment.AnyInt(counter);
END_FOR
END_METHOD

// Returns the largest position in an array
METHOD PUBLIC Position_Largest : REAL
VAR_IN_OUT
	positionArray		: ARRAY[*] OF PositionWithProfileType;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Positions
lower					:= LOWER_BOUND(positionArray, 1);
upper					:= UPPER_BOUND(positionArray, 1);
Position_Largest		:= GVL_Constants.RealSmallest;

FOR di := lower TO upper DO
	Position_Largest	:= MAX(positionArray[di].Pos.value, Position_Largest);
END_FOR
END_METHOD

// Returns the smallest position in an array
METHOD PUBLIC Position_Smallest : REAL
VAR_IN_OUT
	positionArray		: ARRAY[*] OF PositionWithProfileType;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Positions
lower					:= LOWER_BOUND(positionArray, 1);
upper					:= UPPER_BOUND(positionArray, 1);
Position_Smallest		:= GVL_Constants.RealLargest;

FOR di := lower TO upper DO
	Position_Smallest	:= MIN(positionArray[di].Pos.value, Position_Smallest);
END_FOR
END_METHOD

// Returns true if all elements in the vacuum array are equal to condition. Option to test either vacuum high input, or vacuum set output.
METHOD PUBLIC Vacuum_All : BOOL
VAR_IN_OUT
	vacuumArray			: ARRAY[*] OF IVacuum;
END_VAR
VAR_INPUT
	condition			: BOOL;
	channel				: enumSelectIQ := enumSelectIQ.Output;	// Optional: Select to check the vacuum high input, the set output, or both
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Tests
lower	:= LOWER_BOUND(vacuumArray, 1);
upper	:= UPPER_BOUND(vacuumArray, 1);

Vacuum_All := TRUE;

FOR di := lower TO upper DO
	IF vacuumArray[di] = 0 THEN
		LogPlc.Fatal('Vacuum_All: Element in array of interfaces is NULL!');
		Vacuum_All := FALSE;
		EXIT;	// Exit the loop on the first match
	END_IF

	IF vacuumArray[di].IsHigh <> condition AND (channel = enumSelectIQ.Input OR channel = enumSelectIQ.Both)
	OR vacuumArray[di].IsTurnedOn <> condition AND (channel = enumSelectIQ.Output OR channel = enumSelectIQ.Both)
	THEN
		Vacuum_All := FALSE;
		EXIT;	// Exit the loop on the first match
	END_IF
END_FOR
END_METHOD

// Returns true if any element in the vacuum array is equal to condition. Option to test either vacuum high input, or vacuum set output.
METHOD PUBLIC Vacuum_Any : BOOL
VAR_IN_OUT
	vacuumArray			: ARRAY[*] OF IVacuum;
END_VAR
VAR_INPUT
	condition			: BOOL;
	channel				: enumSelectIQ := enumSelectIQ.Output;	// Optional: Select to check the vacuum high input, the set output, or both
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Tests
lower	:= LOWER_BOUND(vacuumArray, 1);
upper	:= UPPER_BOUND(vacuumArray, 1);

FOR di := lower TO upper DO
	IF vacuumArray[di] = 0 THEN
		LogPlc.Fatal('Vacuum_Any: Element in array of interfaces is NULL!');
		CONTINUE;
	END_IF
	CASE channel OF
		enumSelectIQ.Input:
			IF vacuumArray[di].IsHigh = condition THEN
				Vacuum_Any := TRUE;
				EXIT;	// Exit the loop on the first match
			END_IF
		enumSelectIQ.Output:
			IF vacuumArray[di].IsTurnedOn = condition THEN
				Vacuum_Any := TRUE;
				EXIT;	// Exit the loop on the first match
			END_IF
		enumSelectIQ.Both:
			IF vacuumArray[di].IsHigh = condition OR vacuumArray[di].IsTurnedOn = condition THEN
				Vacuum_Any := TRUE;
				EXIT;	// Exit the loop on the first match
			END_IF
	END_CASE
END_FOR
END_METHOD

// Returns true if all elements in the vacuum array (that are enabled) are equal to condition. Option to test either vacuum high input, or vacuum set output.
METHOD PUBLIC Vacuum_Enabled_All : BOOL
VAR_IN_OUT
	vacuumArray			: ARRAY[*] OF IVacuum;
END_VAR
VAR_INPUT
	bitMask				: WORD;	// Only test vacuums when corresponding bitnumber is high.
	condition			: BOOL;
	channel				: enumSelectIQ := enumSelectIQ.Output;	// Optional: Select to check the vacuum high input, the set output, or both
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Tests
lower	:= LOWER_BOUND(vacuumArray, 1);
upper	:= UPPER_BOUND(vacuumArray, 1);

Vacuum_Enabled_All := TRUE;

FOR di := lower TO upper DO
	IF vacuumArray[di] = 0 THEN
		LogPlc.Fatal('Vacuum_All: Element in array of interfaces is NULL!');
		Vacuum_Enabled_All := FALSE;
		EXIT;	// Exit the loop on the first match
	END_IF

	IF NOT BitLogic.Extract(bitMask, TO_USINT(di)) THEN
		CONTINUE;
	END_IF

	IF vacuumArray[di].IsHigh <> condition AND (channel = enumSelectIQ.Input OR channel = enumSelectIQ.Both)
	OR vacuumArray[di].IsTurnedOn <> condition AND (channel = enumSelectIQ.Output OR channel = enumSelectIQ.Both)
	THEN
		Vacuum_Enabled_All := FALSE;
		EXIT;	// Exit the loop on the first match
	END_IF
END_FOR
END_METHOD

// Returns true if any element in the vacuum array (that is enabled) is equal to condition. Option to test either vacuum high input, or vacuum set output.
METHOD PUBLIC Vacuum_Enabled_Any : BOOL
VAR_IN_OUT
	vacuumArray			: ARRAY[*] OF IVacuum;
END_VAR
VAR_INPUT
	bitMask				: WORD;	// Only test vacuums when corresponding bitnumber is high.
	condition			: BOOL;
	channel				: enumSelectIQ := enumSelectIQ.Output;	// Optional: Select to check the vacuum high input, the set output, or both
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Tests
lower	:= LOWER_BOUND(vacuumArray, 1);
upper	:= UPPER_BOUND(vacuumArray, 1);

FOR di := lower TO upper DO
	IF vacuumArray[di] = 0 THEN
		LogPlc.Fatal('Vacuum_Any: Element in array of interfaces is NULL!');
		CONTINUE;
	END_IF

	IF NOT BitLogic.Extract(bitMask, TO_USINT(di)) THEN
		CONTINUE;
	END_IF

	CASE channel OF
		enumSelectIQ.Input:
			IF vacuumArray[di].IsHigh = condition THEN
				Vacuum_Enabled_Any := TRUE;
				EXIT;	// Exit the loop on the first match
			END_IF
		enumSelectIQ.Output:
			IF vacuumArray[di].IsTurnedOn = condition THEN
				Vacuum_Enabled_Any := TRUE;
				EXIT;	// Exit the loop on the first match
			END_IF
		enumSelectIQ.Both:
			IF vacuumArray[di].IsHigh = condition OR vacuumArray[di].IsTurnedOn = condition THEN
				Vacuum_Enabled_Any := TRUE;
				EXIT;	// Exit the loop on the first match
			END_IF
	END_CASE
END_FOR
END_METHOD

// Fires the Release method on all elements in the vacuum array
METHOD PUBLIC Vacuum_ReleaseAll : BOOL
VAR_IN_OUT
	vacuumArray			: ARRAY[*] OF IVacuum;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Execute methods
lower	:= LOWER_BOUND(vacuumArray, 1);
upper	:= UPPER_BOUND(vacuumArray, 1);

Vacuum_ReleaseAll := TRUE;

FOR di := lower TO upper DO
	IF vacuumArray[di] = 0 THEN
		LogPlc.Fatal('Vacuum_ReleaseAll: Element in array of interfaces is NULL!');
		Vacuum_ReleaseAll := FALSE;
	ELSIF NOT vacuumArray[di].Release() THEN
		Vacuum_ReleaseAll := FALSE;
	END_IF
END_FOR
END_METHOD

// Fires the Release method on some elements in the vacuum array. Only reset vacuums whose corresponding bit is high in the bitMask
// !Remember! Vacuum arrays usually start from 1. So to set the first vacuum, use the second bit (bitMask.1) in the bitMask!
METHOD PUBLIC Vacuum_ReleaseSelected : BOOL
VAR_IN_OUT
	vacuumArray			: ARRAY[*] OF IVacuum;
END_VAR
VAR_INPUT
	bitMask				: WORD;	// Release vacuum if corresponding bitnumber is high.
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Execute methods
lower	:= LOWER_BOUND(vacuumArray, 1);
upper	:= UPPER_BOUND(vacuumArray, 1);

Vacuum_ReleaseSelected := TRUE;

FOR di := lower TO upper DO
	IF BitLogic.Extract(bitMask, TO_USINT(di)) THEN
		IF vacuumArray[di] = 0 THEN
			LogPlc.Fatal('Vacuum_ReleaseSelected: Element in array of interfaces is NULL!');
			Vacuum_ReleaseSelected := FALSE;
		ELSIF NOT vacuumArray[di].Release() THEN
			Vacuum_ReleaseSelected := FALSE;
		END_IF
	END_IF
END_FOR

// Method will fail if upper limit of vacuum array > 16
END_METHOD

// Resets the vacuum suction cups that no longer have a product. Returns 0 if all suction cups are turned off.
METHOD PUBLIC Vacuum_ResetIfNotHigh : UINT
VAR_IN_OUT
	vacuumArray			: ARRAY[*] OF IVacuum;
END_VAR
VAR
	result				: UINT;
	upper, lower, di	: DINT;
END_VAR
%FOLDER Execute methods
lower	:= LOWER_BOUND(vacuumArray, 1);
upper	:= UPPER_BOUND(vacuumArray, 1);

FOR di := lower TO upper DO
	IF vacuumArray[di] = 0 THEN
		LogPlc.Fatal('Vacuum_ResetIfNotHigh: Element in array of interfaces is NULL!');
	ELSIF vacuumArray[di].IsHigh THEN
		BitLogic.Load(result, TRUE, TO_USINT(LIMIT(0, di, 15)));
	ELSE
		vacuumArray[di].Reset();
	END_IF
END_FOR

Vacuum_ResetIfNotHigh := result;
END_METHOD

// Returns true if some elements in the vacuum array are equal to condition.
// Only test vacuums whose corresponding bit is high in the bitMask
// Option to test either vacuum high input, or vacuum set output.
// !Remember! Vacuum arrays usually start from 1. So to set the first vacuum, use the second bit (bitMask.1) in the bitMask!
METHOD PUBLIC Vacuum_Selected : BOOL
VAR_IN_OUT
	vacuumArray			: ARRAY[*] OF IVacuum;
END_VAR
VAR_INPUT
	bitMask				: WORD;	// Test vacuum if corresponding bitnumber is high.
	condition			: BOOL;
	channel				: enumSelectIQ := enumSelectIQ.Output;	// Optional: Select to check the vacuum high input, the set output, or both
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Tests
lower	:= LOWER_BOUND(vacuumArray, 1);
upper	:= UPPER_BOUND(vacuumArray, 1);

Vacuum_Selected := TRUE;

FOR di := lower TO upper DO
	IF BitLogic.Extract(bitMask, TO_USINT(di)) THEN
		IF vacuumArray[di] = 0 THEN
			LogPlc.Fatal('Vacuum_Selected: Element in array of interfaces is NULL!');
			Vacuum_Selected := FALSE;
			EXIT;
		END_IF
		CASE channel OF
			enumSelectIQ.Input:
				IF vacuumArray[di].IsHigh <> condition THEN
					Vacuum_Selected := FALSE;
					EXIT;	// Exit the loop on the first match
				END_IF
			enumSelectIQ.Output:
				IF vacuumArray[di].IsTurnedOn <> condition THEN
					Vacuum_Selected := FALSE;
					EXIT;	// Exit the loop on the first match
				END_IF
			enumSelectIQ.Both:
				IF vacuumArray[di].IsHigh <> condition OR vacuumArray[di].IsTurnedOn <> condition THEN
					Vacuum_Selected := FALSE;
					EXIT;	// Exit the loop on the first match
				END_IF
		END_CASE
	END_IF
END_FOR

// Method will fail if upper limit of vacuum array > 16
END_METHOD

// Fires the Set method on all elements in the vacuum array. Return true if all vacuums are high.
METHOD PUBLIC Vacuum_SetAll : BOOL
VAR_IN_OUT
	vacuumArray			: ARRAY[*] OF IVacuum;
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Execute methods
lower	:= LOWER_BOUND(vacuumArray, 1);
upper	:= UPPER_BOUND(vacuumArray, 1);

Vacuum_SetAll := TRUE;

FOR di := lower TO upper DO
	IF vacuumArray[di] = 0 THEN
		LogPlc.Fatal('Vacuum_SetAll: Element in array of interfaces is NULL!');
		Vacuum_SetAll := FALSE;
	ELSIF NOT vacuumArray[di].Set() THEN
		Vacuum_SetAll := FALSE;
	END_IF
END_FOR
END_METHOD

// Fires the Set method on some elements in the vacuum array. Only set vacuums whose corresponding bit is high in the bitMask
// !Remember! Vacuum arrays usually start from 1. So to set the first vacuum, use the second bit (bitMask.1) in the bitMask!
METHOD PUBLIC Vacuum_SetSelected : BOOL
VAR_IN_OUT
	vacuumArray			: ARRAY[*] OF IVacuum;
END_VAR
VAR_INPUT
	bitMask				: WORD;	// Set vacuum if corresponding bitnumber is high.
END_VAR
VAR
	upper, lower, di	: DINT;
END_VAR
%FOLDER Execute methods
lower	:= LOWER_BOUND(vacuumArray, 1);
upper	:= UPPER_BOUND(vacuumArray, 1);

Vacuum_SetSelected := TRUE;

FOR di := lower TO upper DO
	IF BitLogic.Extract(bitMask, TO_USINT(di)) THEN
		IF vacuumArray[di] = 0 THEN
			LogPlc.Fatal('Vacuum_SetSelected: Element in array of interfaces is NULL!');
			Vacuum_SetSelected := FALSE;
		ELSIF NOT vacuumArray[di].Set() THEN
			Vacuum_SetSelected := FALSE;
		END_IF
	END_IF
END_FOR

// Method will fail if upper limit of vacuum array > 16
END_METHOD
