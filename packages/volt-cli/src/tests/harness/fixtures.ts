import type { TestBridgeItem } from "../../bridge/test-bridge.js"

const FB_MOTOR_SRC = `FUNCTION_BLOCK FB_Motor
VAR
	speed : INT := 0;
	running : BOOL := FALSE;
END_VAR

IF NOT running THEN
	speed := speed + 1;
END_IF
END_FUNCTION_BLOCK
`

const GVL_CONFIG_SRC = `{attribute 'qualified_only'}
VAR_GLOBAL
	maxSpeed : INT := 100;
	startDelay : TIME := T#2s;
END_VAR
`

const DUT_MOTORSTATE_SRC = `TYPE DUT_MotorState :
STRUCT
	idle : BOOL;
	forward : BOOL;
	reverse : BOOL;
	fault : BOOL;
END_STRUCT
END_TYPE
`

export const simple: TestBridgeItem[] = [
	{ name: "FB_Motor", kind: "function_block", folder: "POUs", sourceText: FB_MOTOR_SRC },
	{ name: "GVL_Config", kind: "gvl", sourceText: GVL_CONFIG_SRC },
	{ name: "DUT_MotorState", kind: "structure", folder: "POUs/Types", sourceText: DUT_MOTORSTATE_SRC },
	{ name: "PLC_PRG", kind: "program", sourceText: "PROGRAM PLC_PRG\nVAR\nEND_VAR\nEND_PROGRAM\n" },
]

const FB_PUMP_SRC = `FUNCTION_BLOCK FB_Pump
VAR
	speed : INT;
END_VAR

speed := 100;
END_FUNCTION_BLOCK
`

const LIBRARY_SRC = "name = #IoStandard\nresolution = 3.5.18.0 (default)\n"

export const withConfig: TestBridgeItem[] = [
	{ name: "FB_Pump", kind: "function_block", folder: "POUs", sourceText: FB_PUMP_SRC },
	{ name: "PLC_PRG", kind: "program", sourceText: "PROGRAM PLC_PRG\nVAR\nEND_VAR\nEND_PROGRAM\n" },
	{ name: "IoStandard", kind: "library", folder: "Device/Plc Logic/Application/Library Manager", sourceText: LIBRARY_SRC },
	{ name: "MainTask", kind: "task", folder: "Device/Plc Logic/Application", sourceText: "Name=MainTask\nInterval=1\n" },
]
