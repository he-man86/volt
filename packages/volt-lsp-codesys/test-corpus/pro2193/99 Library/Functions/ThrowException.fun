FUNCTION ThrowException : BOOL
VAR_INPUT
	message			: STRING := '';	// A custom message (reason of throwing the exception) to echo to the PLC log
END_VAR

LogPlc.Fatal(message);		// Add a custom message to the PLC log
LogPlc.Throw();

END_FUNCTION
