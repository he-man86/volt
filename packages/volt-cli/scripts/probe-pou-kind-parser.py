# CODESYS'S OWN PARSER, for the POUs its precompile does not answer - openspec `push-without-header-check` 5.D.
#
# probe-pou-kind-signature.py measured that `LanguageModelMgr.FindSignature(objectGuid, out ctx)` names every
# COMPILED POU's kind (271/271 agree with the application context, pool POUs included) - and that a POU CODESYS does
# not compile (excluded from build, itself or by its folder: 9 of Pro2193's 271) has NO signature. This asks whether
# the vendor's own parser (LanguageModelMgr scanner + parser) states the kind of a declaration text, so such a POU's
# kind is still CODESYS's answer and not a Volt header read:
#   1. the scanner/parser surface of the LanguageModelMgr (methods named Scanner/Parser/Parse);
#   2. for every POU of Pro2193: the parser's answer vs the signature where one exists, and for the 9 without;
#   3. broken texts (unclosed comment, empty, prose) and the C2f shapes.
#
# Run on a COPY (vp.open_copy), never saved:
#   & "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" --profile="CODESYS V3.5 SP21 Patch 4" `
#     --noUI --runscript="<repo>\packages\volt-cli\scripts\probe-pou-kind-parser.py"
#   with VOLT_PROBE_PROJECT=<repo>\packages\volt-cli\test\fixtures\Pro2193-94-95-96_COdesys.project
#
# ASCII ONLY (IronPython 2.7).
from __future__ import print_function
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import voltprobe as vp

log, done = vp.logger("pou-kind-parser.log")


def lmm():
    import System
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = asm.GetType("_3S.CoDeSys.Core.SystemInstances")
        except Exception:
            continue
        if t is None:
            continue
        p = t.GetProperty("LanguageModelMgr")
        if p is not None:
            return p.GetValue(None, None)
    return None


def methods(o, pred):
    out = []
    t = o.GetType()
    seen = set()
    for s in [t] + list(t.GetInterfaces()):
        for mi in s.GetMethods(vp.bf()):
            key = mi.Name + "/" + ",".join(p.ParameterType.Name for p in mi.GetParameters())
            if pred(mi.Name) and key not in seen:
                seen.add(key)
                out.append(mi)
    return out


def sig_line(mi):
    return "%s(%s) -> %s" % (mi.Name, ", ".join(p.ParameterType.Name + " " + p.Name for p in mi.GetParameters()),
                             mi.ReturnType.FullName)


try:
    import System
    src = (os.environ.get("VOLT_PROBE_PROJECT") or "").strip()
    proj = vp.open_copy(projects, src, "pou-kind-parser")
    m = lmm()
    log("==== LanguageModelMgr scanner/parser surface")
    for mi in methods(m, lambda n: "Scanner" in n or "Parser" in n or "Parse" in n):
        log("  " + sig_line(mi))

    create_scanner = [mi for mi in methods(m, lambda n: n == "CreateScanner")]
    create_parser = [mi for mi in methods(m, lambda n: n == "CreateParser")]
    if not create_scanner or not create_parser:
        log("no CreateScanner/CreateParser - stopping")
        done()

    def scanner_for(text):
        for mi in create_scanner:
            ps = mi.GetParameters()
            args = []
            for p in ps:
                if p.ParameterType == System.String:
                    args.append(text)
                elif p.ParameterType == System.Boolean:
                    args.append(False)
                else:
                    args.append(None)
            try:
                return mi.Invoke(m, System.Array[System.Object](args)), sig_line(mi)
            except Exception as e:
                last = str(e)[:120]
        return None, last

    def parser_for(scanner):
        for mi in create_parser:
            ps = mi.GetParameters()
            if len(ps) == 1:
                try:
                    return mi.Invoke(m, System.Array[System.Object]([scanner]))
                except Exception:
                    pass
        return None

    sc, how = scanner_for("PROGRAM P\nVAR\nEND_VAR\n")
    log("scanner: %s via %s" % (sc.GetType().FullName if sc is not None else "NONE", how))
    pa = parser_for(sc) if sc is not None else None
    log("parser: %s" % (pa.GetType().FullName if pa is not None else "NONE"))
    if pa is None:
        done()
    log("==== parser methods")
    for mi in methods(pa, lambda n: n.startswith("Parse")):
        log("  " + sig_line(mi))

    def parse(text):
        """Every zero-argument Parse* that returns something with a POUType, tried in turn."""
        out = []
        for mi in methods(pa, lambda n: n.startswith("Parse")):
            if len(mi.GetParameters()) != 0:
                continue
            s, _ = scanner_for(text)
            p = parser_for(s)
            try:
                r = mi.Invoke(p, None)
            except Exception as e:
                out.append("%s:<raised %s>" % (mi.Name, str(e.InnerException if hasattr(e, "InnerException") and e.InnerException else e)[:60]))
                continue
            pt = vp.prop(r, "POUType")
            if pt is not None:
                out.append("%s:%s" % (mi.Name, pt))
        return out

    log("")
    log("==== shapes")
    shapes = [
        ("PROGRAM", "PROGRAM P\nVAR\nEND_VAR\n"),
        ("FUNCTION_BLOCK", "FUNCTION_BLOCK F\nVAR\nEND_VAR\n"),
        ("FUNCTION", "FUNCTION G : INT\nVAR_INPUT\nEND_VAR\n"),
        ("pragma+PROGRAM", "{attribute 'qualified_only'}\n(* doc *)\nPROGRAM P\nVAR\nEND_VAR\n"),
        ("unclosed comment", "(* doc\nPROGRAM P\nVAR\nEND_VAR\n"),
        ("empty", ""),
        ("prose", "this is not code\n"),
        ("TYPE struct", "TYPE T :\nSTRUCT\n a : INT;\nEND_STRUCT\nEND_TYPE\n"),
    ]
    for label, text in shapes:
        log("  %-18s %s" % (label, ", ".join(parse(text))))

    # ---- every POU of the project: parser vs signature ----
    mgr = vp.object_manager()
    fsm = methods(m, lambda n: n == "FindSignature")[0]
    rows = 0
    agree = 0
    nosig = []
    differ = []
    for o in vp.walk(proj.active_application):
        raw = vp.unwrap(o)
        ok, meta = vp.call(mgr, "GetObjectToRead", [vp.prop(raw, "handle"), vp.prop(raw, "guid")])
        iobj = vp.prop(meta, "Object") if ok else None
        if iobj is None or "IPOUObject" not in set(i.Name for i in iobj.GetType().GetInterfaces()):
            continue
        text = vp.prop(vp.prop(vp.prop(iobj, "Interface"), "TextDocument"), "Text") or ""
        sg = fsm.Invoke(m, System.Array[System.Object]([vp.prop(raw, "guid"), None]))
        s = str(vp.prop(sg, "POUType")) if sg is not None else None
        p = parse(text)
        rows += 1
        if s is None:
            nosig.append("%s: parser %s" % (o.get_name(), ", ".join(p)))
        elif any(x.endswith(":" + s) for x in p):
            agree += 1
        else:
            differ.append("%s: signature %s, parser %s" % (o.get_name(), s, ", ".join(p)))
    log("")
    log("==== %d POUs: %d parser agrees with the signature, %d differ, %d have no signature" % (rows, agree, len(differ), len(nosig)))
    for d in differ[:20]:
        log("  differ: " + d)
    for d in nosig:
        log("  no signature: " + d)
    # ---- timing: the text read 5.D deletes vs FindSignature vs text + ParseInterface (relative: IronPython) ----
    pmi = [mi for mi in methods(pa, lambda n: n == "ParseInterface") if len(mi.GetParameters()) == 0][0]
    objs = []
    for o in vp.walk(proj.active_application):
        raw = vp.unwrap(o)
        ok, meta = vp.call(mgr, "GetObjectToRead", [vp.prop(raw, "handle"), vp.prop(raw, "guid")])
        iobj = vp.prop(meta, "Object") if ok else None
        if iobj is not None and "IPOUObject" in set(i.Name for i in iobj.GetType().GetInterfaces()):
            objs.append(raw)
    for rnd in range(2):
        sw = System.Diagnostics.Stopwatch.StartNew()
        for raw in objs:
            ok, meta = vp.call(mgr, "GetObjectToRead", [vp.prop(raw, "handle"), vp.prop(raw, "guid")])
            vp.prop(vp.prop(vp.prop(vp.prop(meta, "Object"), "Interface"), "TextDocument"), "Text")
        t_text = sw.ElapsedMilliseconds
        sw = System.Diagnostics.Stopwatch.StartNew()
        for raw in objs:
            fsm.Invoke(m, System.Array[System.Object]([vp.prop(raw, "guid"), None]))
        t_sig = sw.ElapsedMilliseconds
        sw = System.Diagnostics.Stopwatch.StartNew()
        for raw in objs:
            ok, meta = vp.call(mgr, "GetObjectToRead", [vp.prop(raw, "handle"), vp.prop(raw, "guid")])
            text = vp.prop(vp.prop(vp.prop(vp.prop(meta, "Object"), "Interface"), "TextDocument"), "Text") or ""
            s, _ = scanner_for(text)
            pmi.Invoke(parser_for(s), None)
        t_parse = sw.ElapsedMilliseconds
        log("round %d over %d POUs: object read + Interface text %d ms; FindSignature %d ms; text + ParseInterface %d ms"
            % (rnd, len(objs), t_text, t_sig, t_parse))
    done()
except SystemExit:
    raise
except Exception:
    done(error=True)
