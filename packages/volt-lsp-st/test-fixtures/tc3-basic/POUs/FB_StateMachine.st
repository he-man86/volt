(* =================================================================================================================================
   Sample FB which encapsulates a state machine
   =================================================================================================================================
   InfoSys: https://infosys.beckhoff.de/content/1033/tc3_plc_intro/27021600294502539-1.html?id=3091135132823593756
   ================================================================================================================================= *)
FUNCTION_BLOCK FB_StateMachine
VAR
	eStateMachine		: E_StateMachine;
	nCounterState1		: INT;
	nCounterState2		: INT;
	nCounterState3		: INT;
	fbTimer				: TON;
	tGoToNextState1		: TIME := T#10S;
	tGoToNextState2		: TIME := T#5S;
	fbTrigger			: R_TRIG;
	bGoToNextState		: BOOL;
END_VAR

END_FUNCTION_BLOCK

(* =================================================================================================================================
   Sample method with a state machine implementation
   =================================================================================================================================
   InfoSys: https://infosys.beckhoff.de/content/1033/tc3_plc_intro/36028799549271435-1.html?id=5888189752030005481
   ================================================================================================================================= *)
METHOD Execute
VAR_INPUT
END_VAR
// Sample state machine which shows different basic functionalities (timer, trigger) and basic statements
CASE eStateMachine OF
	
	// =================================================================================================================
	// State 1) Time control
	// This state is left when the time of "tGoToNextState1" has run off (default: after 10s)
	E_StateMachine.GoToNextState_viaTimer1:
	
				// Increase counter to show that state 1 is active
				nCounterState1 := nCounterState1 + 1;
	
				// Call timer FB with the desired time parameter
				// In the first execution of this state, "fbTimer" is activated by a rising edge at the execute input "IN".
				// PLEASE REMARK: Afterwards, the FB has to be called in each following cycle until the time has run off.
				// When the time has run off, the output Q becomes TRUE and the timer FB is called with an input reset.
				// Then, the FB does not have to be called anymore - until it should be activated with a rising edge at the execute input again.
				fbTimer(IN := TRUE,
						PT := tGoToNextState1);
				
				// Check if the time has run off
				IF fbTimer.Q THEN
					fbTimer(IN := FALSE);											// Reset timer FB by resetting the execute input "IN"
					eStateMachine := E_StateMachine.GoToNextState_viaRisingEdge;	// Switch to next state
				END_IF
	
	// =================================================================================================================
	// State 2) Rising edge
	// This state is left when the variable "bGoToNextState" has a rising edge
	E_StateMachine.GoToNextState_viaRisingEdge:
	
				// Increase counter to show that state 2 is active
				nCounterState2 := nCounterState2 + 1;
	
				// Call trigger FB to detect a rising edge of the connected variable/condition
				// => User interaction necessary: To switch to the next state, write the variable "bGoToNextState" to TRUE
				fbTrigger(CLK := bGoToNextState);
	
				// Check if the trigger detected a rising edge
				IF fbTrigger.Q THEN
					bGoToNextState	:= FALSE;										// Reset control variable
					eStateMachine	:= E_StateMachine.GoToNextState_viaTimer2;		// Switch to next state
				END_IF
	
	// =================================================================================================================
	// State 3) Time control
	// This state is left when the time of "tGoToNextState2" has run off (default: after 10s)
	E_StateMachine.GoToNextState_viaTimer2:
	
				// Increase counter to show that state 3 is active
				nCounterState3 := nCounterState3 + 1;
	
				// Call timer FB with the desired time parameter
				fbTimer(IN := TRUE,
						PT := tGoToNextState2);
				
				// Check if the time has run off
				IF fbTimer.Q THEN
					fbTimer(IN := FALSE);											// Reset timer FB by resetting the execute input "IN"
					eStateMachine := E_StateMachine.GoToNextState_viaTimer1;		// Switch back to the first state
				END_IF
END_CASE
END_METHOD
