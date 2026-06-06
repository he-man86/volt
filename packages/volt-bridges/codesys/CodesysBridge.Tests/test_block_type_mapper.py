"""
Regression tests for `helpers.block_type_mapper.classify_nonsource`.

CODESYS marker strings are a comma-separated capability list inside
`{...}`. Each capability has a positive form (`ScriptXxxObject,`) or
a negative form (`NoXxxObject,`). MOST capabilities are reliable
per-object kind indicators: a node whose marker contains `ScriptDevice-
Object,` IS the device. But some markers are universal/leaky — they
appear positive on objects that aren't of that kind. `ScriptCamObject,`
was such a marker (CODESYS 3.5.21+): it showed up on every object
including Project Settings, Device, Plc Logic, Application. Including
it in the classifier mis-routed any object without an EARLIER positive
marker match to kind `cam` → file extension `.cam` in the workspace.

These tests pin the behavior so the regression can't quietly return.
"""
# pyright: reportMissingImports=false
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "CodesysBridge"))

from helpers.block_type_mapper import classify_nonsource, KIND_CONFIG


# Real marker captured from CODESYS 3.5.21.40 via /debug/flat on the
# language-conformance project. Project Settings is the first node and
# has no positive kind markers (every concrete capability is NoXxx)
# EXCEPT some universal flags including the now-removed ScriptCamObject.
PROJECT_SETTINGS_MARKER = (
    "ScriptObject{NoRecipeManObject, NoRecipeDefinitionObject, "
    "ScriptCamObject, NoScriptTraceObject, NoDeviceObject, "
    "NoExplicitConnectorObject, NoSymbolConfigObject, NoLibManObject, "
    "ScriptNoProjectInfoMarker, NoScriptApplicationObject, "
    "ScriptNonTextualObject, ScriptExternalFileObjectMarker`1, "
    "NoTaskConfigObject, NoTaskObject, ScriptNoTransientObjectMarker, "
    "NoImagePoolObject, NoTextListObject, "
    "NoScriptApplicationComposerObject, NoScriptApplicationComposerObject, "
    "NoVisualObject}(Project=0, Name=Project Settings, "
    "guid=6470a90f-b7cb-43ac-9ae5-94b2338b4573)"
)

# Real marker from a Device node — earlier match (ScriptDeviceObject) wins.
DEVICE_MARKER = (
    "ScriptObject{NoRecipeManObject, NoRecipeDefinitionObject, "
    "ScriptCamObject, NoScriptTraceObject, ScriptDeviceObject, "
    "NoExplicitConnectorObject, NoSymbolConfigObject, NoLibManObject}"
)


class ClassifyNonsourceTest(unittest.TestCase):
    def test_project_settings_does_not_mis_classify_as_cam(self):
        # Regression: ScriptCamObject appears on every object in CODESYS
        # 3.5.21+, so classifying on it routed Project Settings → .cam.
        kind = classify_nonsource(PROJECT_SETTINGS_MARKER)
        self.assertNotEqual(kind, "cam")
        # Project Settings has no specific per-object kind marker —
        # falls through to the generic config catch-all.
        self.assertEqual(kind, KIND_CONFIG)

    def test_device_still_classifies_as_device(self):
        # Sanity: ScriptDeviceObject is BEFORE the (removed) ScriptCam
        # entry in the iteration, so devices were always correctly
        # classified. Confirm we didn't break that path.
        self.assertEqual(classify_nonsource(DEVICE_MARKER), "device")

    def test_no_x_prefix_does_not_trigger_positive_match(self):
        # Boundary check still works: `NoScriptTraceObject,` must NOT
        # match the positive `ScriptTraceObject,` token.
        marker = "ScriptObject{NoScriptTraceObject, NoDeviceObject}"
        self.assertEqual(classify_nonsource(marker), KIND_CONFIG)


if __name__ == "__main__":
    unittest.main()
