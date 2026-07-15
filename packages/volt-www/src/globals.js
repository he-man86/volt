// The design components (src/design/*.jsx) are authored the way the Claude Design preview loads them: as global
// scripts that read `React`, the shared icon/logo helpers, and `window.VoltDesignSystem_704691.Button` at render
// time. We keep them verbatim (so future /design-sync is a drop-in) and set those globals here. This module MUST be
// imported before any design file — main.jsx does that.
import React from "react"
import { Button } from "./design/Button.jsx"
import { Input } from "./design/Input.jsx"
import { Card } from "./design/Card.jsx"
import { Badge } from "./design/Badge.jsx"
import * as VoltConfig from "./config.js"

window.React = React
window.VoltDesignSystem_704691 = { Button, Input, Card, Badge }
// volt: real console URLs (auth/download) for the design CTAs — see config.js
window.VOLT = VoltConfig
