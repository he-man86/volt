# -*- coding: utf-8 -*-
# WHAT DOES CODESYS DO WITH A NAME THAT IS NO ASCII IEC IDENTIFIER? (openspec bridge-refusal-review 3.1)
#
# `StReader.ParseSignature` refuses a member name that is not `[A-Za-z_][A-Za-z0-9_]*` ("not a valid IEC
# identifier", `IsIdentifier`) BEFORE the push asks the IDE, on the belief - never measured - that the vendor will
# not create such a member and the failure would land mid-write. The names each vendor refuses for an ordinary word
# were measured (push-keeps-what-landed 3.1, `member-name-refusal*.log`); the non-identifier SHAPES were not, because
# Volt's own check stopped every one of them first.
#
# This asks the IDE directly, through the same scripting factories `CodesysObjectModel.CreateChild` calls
# (`create_pou`, `create_method`, `create_action`, `create_property`), for every shape class: non-ASCII letters,
# a leading digit, every ASCII punctuation mark a member line can carry (a space, a tab and `:` cannot - they end
# the name), Unicode spaces/format characters the line split does not cut at, and controls that must be accepted.
# For each: was it created, under WHICH name (read back - a silent rename is not an accept), and does the project
# BUILD with the object referenced (an object created under a name the compiler cannot read is not a usable
# object). Each name is built alone, its objects removed after, so every message belongs to one name.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   CODESYS.exe --profile="CODESYS V3.5 SP21 Patch 4" --noUI --runscript="<repo>\packages\volt-cli\scripts\probe-identifier-names.py"
#
# Works on a COPY of the project and never saves. ASCII ONLY - the names are \u escapes.
from __future__ import print_function
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("identifier-names.log")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(HERE, "..", "test", "fixtures", "CodesysTestProject.project")

# (label, name). The label is ASCII so the log reads anywhere; the name is what the IDE is asked for.
NAMES = [
    ("control Run", u"Run"),
    ("control _lead", u"_lead"),
    ("control With9", u"With9"),
    ("control trailing underscore", u"Trail_"),
    ("latin-1 letters F\\u00f6\\u00f6bar", u"F\u00f6\u00f6bar"),
    ("latin-1 capital \\u00dcnit", u"\u00dcnit"),
    ("cyrillic \\u041f\\u0440\\u0438", u"\u041f\u0440\u0438\u0432\u0435\u0442"),
    ("greek \\u03b1\\u03b2", u"\u03b1\u03b2"),
    ("cjk \\u540d\\u524d", u"\u540d\u524d"),
    ("ascii + arabic-indic digit a\\u0663", u"a\u0663"),
    ("leading digit 2Fast", u"2Fast"),
    ("hyphen My-Name", u"My-Name"),
    ("dot a.b", u"a.b"),
    ("dollar a$b", u"a$b"),
    ("hash a#b", u"a#b"),
    ("at @ab", u"@ab"),
    ("plus a+b", u"a+b"),
    ("slash a/b", u"a/b"),
    ("backslash a\\b", u"a\\b"),
    ("quote a'b", u"a'b"),
    ("dquote a\"b", u"a\"b"),
    ("percent a%b", u"a%b"),
    ("ampersand a&b", u"a&b"),
    ("paren a(b", u"a(b"),
    ("bracket a[b", u"a[b"),
    ("brace a{b", u"a{b"),
    ("semicolon a;b", u"a;b"),
    ("comma a,b", u"a,b"),
    ("equals a=b", u"a=b"),
    ("star a*b", u"a*b"),
    ("bang a!b", u"a!b"),
    ("question a?b", u"a?b"),
    ("caret a^b", u"a^b"),
    ("tilde a~b", u"a~b"),
    ("pipe a|b", u"a|b"),
    ("lt a<b", u"a<b"),
    ("backtick `ab`", u"`ab`"),
    ("no-break space a\\u00a0b", u"a\u00a0b"),
    ("zero-width space a\\u200bb", u"a\u200bb"),
    ("lone underscore _", u"_"),
    ("double underscore a__b (measured refused, push-keeps-what-landed 3.1)", u"a__b"),
    # A BACKTICK-QUOTED name was ACCEPTED on the first run (`ab`, every kind, build clean): what may stand between
    # the backticks, and is a stray backtick a name character?
    ("backtick, hyphen inside `a-b`", u"`a-b`"),
    ("backtick, latin-1 inside `Foo` with o-umlauts", u"`F\u00f6\u00f6bar`"),
    ("backtick, leading digit `2Fast`", u"`2Fast`"),
    ("backtick, space inside `a b`", u"`a b`"),
    ("backtick, keyword `INT`", u"`INT`"),
    ("backtick, empty ``", u"``"),
    ("backtick, unbalanced `ab", u"`ab"),
    ("backtick, inside a`b", u"a`b"),
    ("backtick, then text `a`b", u"`a`b"),
]

KINDS = ["pou", "method", "action", "property", "itf_method", "itf_property"]
# Each member kind lives in its own FB: a method and an action of one name collide in one FB's namespace (the first
# run did exactly that), which is a refusal of the second create, not of the name.
CALLS = "fm();\nfa();\nfp();\n"


def text(s):
    try:
        return s.encode("unicode_escape")
    except Exception:
        return repr(s)


def first_line(e):
    m = str(getattr(e, "message", "") or e)
    return m.splitlines()[0][:200] if m else type(e).__name__


try:
    src = (vp.projects_from_env() or [DEFAULT])[0]
    log("project copy of: %s" % src)
    proj = vp.open_copy(projects, src, "identifier-names")
    app = proj.active_application
    prg = [o for o in proj.find("PLC_PRG", True)][0]
    prg.textual_declaration.replace("PROGRAM PLC_PRG\nVAR\n  fm : VltIdFb_method;\n  fa : VltIdFb_action;\n"
                                    "  fp : VltIdFb_property;\nEND_VAR\n")
    fbs = {}
    for k in ("method", "action", "property"):
        fbname = "VltIdFb_" + k
        o = app.create_pou(name=fbname, type=PouType.FunctionBlock, language=ImplementationLanguages.st)
        o.textual_declaration.replace("FUNCTION_BLOCK %s\nVAR\nEND_VAR\n" % fbname)
        o.textual_implementation.replace("")
        fbs[k] = o
    # And an INTERFACE per interface-member kind: the push pre-flights names on interface members too only if they
    # are measured.
    itfs = {}
    for k in ("itf_method", "itf_property"):
        itfs[k] = app.create_interface("VltIdItf_" + k)

    prg.textual_implementation.replace(CALLS)
    base = vp.build_messages(app, system, Severity)
    log("baseline build (FBs alone): %s" % ("CLEAN" if not base else " | ".join(base)))
    log("")

    for label, name in NAMES:
        log("== %s   (%s)" % (label, text(name)))
        made = []
        for kind in KINDS:
            try:
                if kind == "pou":
                    o = app.create_pou(name=name, type=PouType.Program, language=ImplementationLanguages.st)
                elif kind == "method":
                    o = fbs["method"].create_method(name)
                elif kind == "action":
                    o = fbs["action"].create_action(name)
                elif kind == "property":
                    o = fbs["property"].create_property(name, "INT")
                elif kind == "itf_method":
                    o = itfs["itf_method"].create_method(name)
                else:
                    o = itfs["itf_property"].create_property(name, "INT")
                if o is None:
                    log("   %-12s CREATE answered None" % kind)
                    continue
                got = o.get_name()
                same = (got == name)
                log("   %-12s CREATED as %s%s" % (kind, text(got), "" if same else "   <-- NOT the name asked"))
                made.append((kind, o, got))
            except Exception as e:
                log("   %-12s REFUSED: %s: %s" % (kind, type(e).__name__, text(first_line(e))))
        if made:
            # Reference what was made: the program is called, the FB is called (its members compile with it).
            calls = CALLS
            if any(k == "pou" for k, _, _ in made):
                calls += u"%s();\n" % [g for k, _, g in made if k == "pou"][0]
            try:
                prg.textual_implementation.replace(calls)
                msgs = vp.build_messages(app, system, Severity)
                log("   build: %s" % ("CLEAN" if not msgs else ""))
                for m in msgs:
                    log("      " + text(m if isinstance(m, unicode) else unicode(m, "utf-8", "replace")))
            except Exception as e:
                log("   build FAILED: %s: %s" % (type(e).__name__, text(first_line(e))))
            for kind, o, _ in reversed(made):
                try:
                    o.remove()
                except Exception as e:
                    log("   remove %s failed: %s" % (kind, text(first_line(e))))
        prg.textual_implementation.replace(CALLS)
    proj.close()
    log("done")
except SystemExit:
    pass
except Exception:
    done(error=True)
finally:
    done()
