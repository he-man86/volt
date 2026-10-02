# THE POU KIND FROM THE PRECOMPILE SIGNATURE - the facts openspec `push-without-header-check` 5.D builds on.
#
# 5.A (probe-kind-source.py, DIALECT C2g) measured that CODESYS keeps a POU's kind only in its language model:
# `LanguageModelMgr.GetPrecompileContext(appGuid).GetSignature(objectGuid).POUType`. It probed POUs UNDER the
# application. Three things the driver needs were not measured, and this asks them:
#
#   1. A POU in the project's POU POOL (no Application above it): which precompile context, if any, answers it?
#   2. Is a context obtained BEFORE an in-place write current AFTER it (may the driver keep one per operation)?
#   3. Every POU of a real project (Pro2193): does POUType name a POU kind for every one (no None), and does it
#      agree with the declaration's leading keyword (the text read 5.D deletes)?
#
# Run on a COPY (vp.open_copy), never saved:
#   & "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" --profile="CODESYS V3.5 SP21 Patch 4" `
#     --noUI --runscript="<repo>\packages\volt-cli\scripts\probe-pou-kind-signature.py"
#   with VOLT_PROBE_PROJECT=<repo>\packages\volt-cli\test\fixtures\Pro2193-94-95-96_COdesys.project
#
# ASCII ONLY (IronPython 2.7).
from __future__ import print_function
import os
import sys
import re

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import voltprobe as vp

log, done = vp.logger("pou-kind-signature.log")


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


def ifaces(iobj):
    return set(i.Name for i in iobj.GetType().GetInterfaces())


def read_obj(mgr, o):
    raw = vp.unwrap(o)
    ok, meta = vp.call(mgr, "GetObjectToRead", [vp.prop(raw, "handle"), vp.prop(raw, "guid")])
    return vp.prop(meta, "Object") if ok else None


def decl_text(iobj):
    a = vp.prop(iobj, "Interface")
    d = vp.prop(a, "TextDocument")
    return vp.prop(d, "Text") or ""


def leading(decl):
    for line in decl.replace("\r", "").split("\n"):
        s = re.sub(r"\(\*.*?\*\)|\{[^}]*\}|//.*$", "", line).strip()
        if s:
            return s.split()[0].upper()
    return ""


def sig_of(ctx, o):
    ok, sig = vp.call(ctx, "GetSignature", [vp.prop(vp.unwrap(o), "guid")])
    if not ok:
        return "<GetSignature failed: %s>" % sig
    if sig is None:
        return "<null signature>"
    return str(vp.prop(sig, "POUType"))


try:
    src = (os.environ.get("VOLT_PROBE_PROJECT") or "").strip()
    proj = vp.open_copy(projects, src, "pou-kind-sig")
    log("project: %s" % src)
    m = lmm()
    log("LanguageModelMgr: %s" % (m.GetType().FullName if m is not None else "NONE"))
    import System
    t = m.GetType()
    seen = set()
    for s in [t] + list(t.GetInterfaces()):
        for mi in s.GetMethods(vp.bf()):
            if ("Precompile" in mi.Name or "Signature" in mi.Name) and (mi.Name + str(len(mi.GetParameters()))) not in seen:
                seen.add(mi.Name + str(len(mi.GetParameters())))
                log("  %s(%s) -> %s" % (mi.Name, ", ".join(p.ParameterType.Name + " " + p.Name for p in mi.GetParameters()),
                                        mi.ReturnType.Name))

    app = proj.active_application
    appguid = vp.prop(vp.unwrap(app), "guid")
    ok, ctx = vp.call(m, "GetPrecompileContext", [appguid])
    log("app context: %s" % ("yes" if ok and ctx is not None else "NO: %s" % ctx))
    mgr = vp.object_manager()

    # ---- 3. every POU under the application: POUType vs the leading keyword, and the time of each read ----
    pous = []
    for o in vp.walk(app):
        try:
            if getattr(o, "is_folder", False):
                continue
        except Exception:
            pass
        iobj = read_obj(mgr, o)
        if iobj is not None and "IPOUObject" in ifaces(iobj):
            pous.append(o)
    log("")
    log("==== %d IPOUObject under the application" % len(pous))
    tally = {}
    disagree = []
    for o in pous:
        kw = leading(decl_text(read_obj(mgr, o)))
        pt = sig_of(ctx, o)
        tally[pt] = tally.get(pt, 0) + 1
        want = {"PROGRAM": "Program", "FUNCTION_BLOCK": "FunctionBlock", "FUNCTION": "Function"}.get(kw, "?" + kw)
        if want != pt:
            disagree.append("%s: keyword %s, POUType %s" % (o.get_name(), kw, pt))
    log("POUType tally: %s" % ", ".join("%s=%d" % kv for kv in sorted(tally.items())))
    log("keyword vs POUType disagreements: %d" % len(disagree))
    for d in disagree[:40]:
        log("  " + d)

    # ---- 3b. the POUs the application context does not answer: what are they, and who answers them? ----
    import clr
    okz, zctx = vp.call(m, "GetPrecompileContext", [System.Guid.Empty])

    fsm = [mi for s in [m.GetType()] + list(m.GetType().GetInterfaces()) for mi in s.GetMethods(vp.bf())
           if mi.Name == "FindSignature"][0]

    def find_sig(o):
        args = System.Array[System.Object]([vp.prop(vp.unwrap(o), "guid"), None])
        try:
            fs = fsm.Invoke(m, args)
        except Exception as e:
            return "<raised %s>" % str(e)[:80]
        return str(vp.prop(fs, "POUType")) if fs is not None else "<null signature>"

    # Signatures of objects that are NOT compiled (exclude from build): AllSignatures(False) / GlobalSignatures(False)?
    uncompiled = {}
    for label, call in (("AllSignatures(False)", "AllSignatures"), ("GlobalSignatures(False)", "GlobalSignatures")):
        oks, scope = vp.call(m, call, [False])
        log("%s: %s" % (label, scope.GetType().FullName if oks and scope is not None else "none (%s)" % scope))
        if oks and scope is not None and label.startswith("All"):
            vp.dump(scope, log)
            try:
                sigs = list(vp.prop(scope, "AllSignatures") or [])
            except Exception:
                sigs = []
            if not sigs:
                try:
                    sigs = list(scope)
                except Exception:
                    sigs = []
            log("  enumerated %d signatures" % len(sigs))
            for sg in sigs:
                g = vp.prop(sg, "ObjectGuid")
                if g is not None:
                    uncompiled[str(g)] = str(vp.prop(sg, "POUType"))

    for o in pous:
        if sig_of(ctx, o) != "<null signature>":
            continue
        chain = []
        q = o
        for _ in range(8):
            q = q.parent
            if q is None or not hasattr(q, "get_name"):
                break
            chain.append(q.get_name())
        try:
            exb = vp.prop(vp.prop(o, "build_properties"), "exclude_from_build")
        except Exception as e:
            exb = "<%s>" % type(e).__name__
        log("  null: %s  exclude_from_build=%s  parents=%s  Guid.Empty ctx=%s  FindSignature=%s  uncompiled=%s"
            % (o.get_name(), exb, "/".join(chain), sig_of(zctx, o), find_sig(o), uncompiled.get(str(vp.prop(vp.unwrap(o), "guid")), "-")))
    agree = 0
    differ = []
    for o in pous:
        a = sig_of(ctx, o)
        f = find_sig(o)
        if a == f:
            agree += 1
        else:
            differ.append("%s: app %s, FindSignature %s" % (o.get_name(), a, f))
    log("FindSignature vs application context: %d agree, %d differ" % (agree, len(differ)))
    for d in differ[:20]:
        log("  " + d)
    sw = System.Diagnostics.Stopwatch.StartNew()
    for o in pous:
        find_sig(o)
    log("FindSignature over %d POUs: %d ms" % (len(pous), sw.ElapsedMilliseconds))

    sw = System.Diagnostics.Stopwatch.StartNew()
    for o in pous:
        decl_text(read_obj(mgr, o))
    t_text = sw.ElapsedMilliseconds
    sw = System.Diagnostics.Stopwatch.StartNew()
    for o in pous:
        okc, c = vp.call(m, "GetPrecompileContext", [appguid])
        sig_of(c, o)
    t_sig_fresh = sw.ElapsedMilliseconds
    sw = System.Diagnostics.Stopwatch.StartNew()
    for o in pous:
        sig_of(ctx, o)
    t_sig_cached = sw.ElapsedMilliseconds
    sw = System.Diagnostics.Stopwatch.StartNew()
    for o in pous:
        read_obj(mgr, o)
    t_obj = sw.ElapsedMilliseconds
    log("timing over %d POUs (IronPython reflection, relative only): object read %d ms; object read + Interface "
        "text %d ms; context + signature %d ms; signature on one context %d ms"
        % (len(pous), t_obj, t_text, t_sig_fresh, t_sig_cached))

    # ---- 2. a context obtained before an in-place write, read after it ----
    log("")
    log("==== in-place write: is an earlier context current?")
    p = app.create_pou("VltSigProbe", PouType.Program)
    p.textual_declaration.replace("PROGRAM VltSigProbe\nVAR\nEND_VAR\n")
    okc, before = vp.call(m, "GetPrecompileContext", [appguid])
    log("  after create as PROGRAM: %s" % sig_of(before, p))
    p.textual_declaration.replace("FUNCTION_BLOCK VltSigProbe\nVAR\nEND_VAR\n")
    okc, after = vp.call(m, "GetPrecompileContext", [appguid])
    log("  after rewrite as FUNCTION_BLOCK: earlier context %s; fresh context %s; same object %s"
        % (sig_of(before, p), sig_of(after, p), str(before is after or before.Equals(after))))
    p.textual_declaration.replace("(* unclosed\nPROGRAM VltSigProbe\nVAR\nEND_VAR\n")
    log("  after rewrite with an unclosed comment: earlier context %s" % sig_of(before, p))

    # ---- 1. a POU in the POU pool ----
    log("")
    log("==== POU pool (project root, no Application above)")
    try:
        pool = proj.create_pou("VltPoolProbe", PouType.FunctionBlock)
        pool.textual_declaration.replace("FUNCTION_BLOCK VltPoolProbe\nVAR\nEND_VAR\n")
        par = pool.parent
        log("  created; parent = %s" % (par.get_name() if par is not None and hasattr(par, "get_name") else str(par)))
        okc, c = vp.call(m, "GetPrecompileContext", [appguid])
        log("  application context: %s" % sig_of(c, pool))
        okp, pc = vp.call(m, "GetPrecompileContext", [vp.prop(vp.unwrap(proj), "guid") if vp.prop(vp.unwrap(proj), "guid") is not None else System.Guid.Empty])
        log("  project-guid context: %s" % (sig_of(pc, pool) if okp and pc is not None else "none (%s)" % pc))
        okz, zc = vp.call(m, "GetPrecompileContext", [System.Guid.Empty])
        log("  Guid.Empty context: %s" % (sig_of(zc, pool) if okz and zc is not None else "none (%s)" % zc))
        log("  FindSignature: %s" % find_sig(pool))
        pool.textual_declaration.replace("(* unclosed\nFUNCTION_BLOCK VltPoolProbe\nVAR\nEND_VAR\n")
        log("  after an unclosed comment: FindSignature %s" % find_sig(pool))
        p.textual_declaration.replace("PROGRAM VltSigProbe\nVAR\nEND_VAR\n")
        log("  VltSigProbe repaired as PROGRAM: FindSignature %s" % find_sig(p))
        # every application's context, in case the pool is compiled into each
        for o in vp.walk(proj):
            iobj = read_obj(mgr, o)
            if iobj is not None and "IApplicationObject" in ifaces(iobj):
                g = vp.prop(vp.unwrap(o), "guid")
                oka, ac = vp.call(m, "GetPrecompileContext", [g])
                log("  application '%s' context: %s" % (o.get_name(), sig_of(ac, pool) if oka and ac is not None else "none"))
    except Exception:
        import traceback
        log("  pool probe raised: " + traceback.format_exc().strip().split(chr(10))[-1])
    done()
except Exception:
    done(error=True)
