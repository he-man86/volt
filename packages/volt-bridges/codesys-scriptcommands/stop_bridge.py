# -*- coding: utf-8 -*-
"""
Stop Volt Bridge  (CODESYS Script Command / Execute Script File)

Asks the running in-process bridge to shut down via POST /shutdown.
No DLL needed - just talks to the listener started by start_bridge.py.
"""
from __future__ import print_function

try:
    from urllib2 import urlopen, Request          # IronPython 2.7
except ImportError:
    from urllib.request import urlopen, Request    # Py3 fallback

try:
    req = Request("http://127.0.0.1:8556/shutdown", data=b"")
    req.get_method = lambda: "POST"
    urlopen(req, timeout=2).read()
    print("Volt bridge stopped")
except Exception as e:
    print("Volt bridge: not running (%s)" % str(e))
