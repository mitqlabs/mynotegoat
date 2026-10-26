#!/usr/bin/env python3
"""Builds the unsigned NoteGoat 'Send Reminders' Apple Shortcuts files.
No token is embedded: the code is asked for when the shortcut is added
(WFWorkflowImportQuestions). Run: python3 tools/build-shortcuts.py"""
import plistlib, uuid, pathlib, sys

ORIGIN = "https://www.mynotegoat.com"
OBJ = "\ufffc"

def U(): return str(uuid.uuid4()).upper()
def act(ident, **p): return {"WFWorkflowActionIdentifier": ident, "WFWorkflowActionParameters": p}
def out(uid, name): return {"Type": "ActionOutput", "OutputUUID": uid, "OutputName": name}
def var(name, key=None):
    v = {"Type": "Variable", "VariableName": name}
    if key: v["Aggrandizements"] = [{"Type": "WFDictionaryValueVariableAggrandizement", "DictionaryKey": key}]
    return v
def att(v): return {"Value": v, "WFSerializationType": "WFTextTokenAttachment"}
def tstr(prefix, v=None, suffix=""):
    if v is None: return {"Value": {"string": prefix}, "WFSerializationType": "WFTextTokenString"}
    return {"Value": {"string": prefix + OBJ + suffix,
                      "attachmentsByRange": {"{%d, 1}" % len(prefix): v}},
            "WFSerializationType": "WFTextTokenString"}
def fields(items):
    return {"Value": {"WFDictionaryFieldValueItems": [
        {"WFItemType": 0, "WFKey": tstr(k), "WFValue": v} for k, v in items]},
        "WFSerializationType": "WFDictionaryFieldValue"}

def build(name, query):
    auth = [("Authorization", tstr("Bearer ", var("Token")))]
    q, d1, d2, rep, txt, ph, msg, tk = (U() for _ in range(8))
    acts = [
        act("is.workflow.actions.gettext", UUID=tk, WFTextActionText=""),  # index 0 = import question
        act("is.workflow.actions.setvariable", WFVariableName="Token",
            WFInput=att(out(tk, "Text"))),
        act("is.workflow.actions.downloadurl", UUID=q, WFURL=f"{ORIGIN}/api/reminders/queue?{query}",
            WFHTTPMethod="GET", ShowHeaders=True, WFHTTPHeaders=fields(auth)),
        act("is.workflow.actions.setvariable", WFVariableName="Queue",
            WFInput=att(out(q, "Contents of URL"))),
        act("is.workflow.actions.getvalueforkey", UUID=d1, WFDictionaryKey="visitDate",
            WFInput=att(var("Queue"))),
        act("is.workflow.actions.setvariable", WFVariableName="VisitDate",
            WFInput=att(out(d1, "Dictionary Value"))),
        act("is.workflow.actions.getvalueforkey", UUID=msg, WFDictionaryKey="message",
            WFInput=att(var("Queue"))),
        act("is.workflow.actions.getvalueforkey", UUID=d2, WFDictionaryKey="items",
            WFInput=att(var("Queue"))),
        act("is.workflow.actions.repeat.each", GroupingIdentifier=rep, WFControlFlowMode=0,
            WFInput=att(out(d2, "Dictionary Value"))),
        act("is.workflow.actions.getvalueforkey", UUID=txt, WFDictionaryKey="text",
            WFInput=att(var("Repeat Item"))),
        act("is.workflow.actions.getvalueforkey", UUID=ph, WFDictionaryKey="phone",
            WFInput=att(var("Repeat Item"))),
        act("is.workflow.actions.sendmessage", ShowWhenRun=False,
            WFSendMessageContent=tstr("", out(txt, "Dictionary Value")),
            WFSendMessageActionRecipients=att(out(ph, "Dictionary Value"))),
        act("is.workflow.actions.downloadurl", UUID=U(), WFURL=f"{ORIGIN}/api/reminders/ack",
            WFHTTPMethod="POST", ShowHeaders=True, WFHTTPHeaders=fields(auth), WFHTTPBodyType="JSON",
            WFJSONValues=fields([("visitDate", tstr("", var("VisitDate"))),
                                 ("id", tstr("", var("Repeat Item", "id"))),
                                 ("status", tstr("sent"))])),
        act("is.workflow.actions.delay", WFDelayTime=5),
        act("is.workflow.actions.repeat.each", GroupingIdentifier=rep, WFControlFlowMode=2, UUID=U()),
        act("is.workflow.actions.notification", WFNotificationActionTitle="NoteGoat",
            WFNotificationActionBody=tstr("", out(msg, "Dictionary Value"))),
    ]
    wf = {
        "WFWorkflowName": name,
        "WFWorkflowClientVersion": "2302.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4292093695, "WFWorkflowIconGlyphNumber": 59511},
        "WFWorkflowTypes": [], "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowImportQuestions": [{"ActionIndex": 0, "Category": "Parameter", "DefaultValue": "",
            "ParameterKey": "WFTextActionText",
            "Text": "Paste your NoteGoat device code (starts with ngr_). Get it in NoteGoat › Settings › Text Reminders."}],
        "WFWorkflowActions": acts,
    }
    return wf

def build_opt_out():
    """Run by a Message automation ("Message contains STOP", Run Immediately)
    with Shortcut Input = the message. POSTs {from: Sender, text: message} to
    /api/reminders/inbound. Never replies to the patient."""
    tk, sender, body = U(), U(), U()
    auth = [("Authorization", tstr("Bearer ", var("Token")))]
    inp = {"Type": "ExtensionInput"}
    acts = [
        act("is.workflow.actions.gettext", UUID=tk, WFTextActionText=""),  # index 0 = import question
        act("is.workflow.actions.setvariable", WFVariableName="Token", WFInput=att(out(tk, "Text"))),
        act("is.workflow.actions.gettext", UUID=sender, WFTextActionText=tstr("", dict(inp, Aggrandizements=[
            {"Type": "WFPropertyVariableAggrandizement", "PropertyName": "Sender"}]))),
        act("is.workflow.actions.gettext", UUID=body, WFTextActionText=tstr("", inp)),
        act("is.workflow.actions.downloadurl", UUID=U(), WFURL=f"{ORIGIN}/api/reminders/inbound",
            WFHTTPMethod="POST", ShowHeaders=True, WFHTTPHeaders=fields(auth), WFHTTPBodyType="JSON",
            WFJSONValues=fields([("from", tstr("", out(sender, "Text"))),
                                 ("text", tstr("", out(body, "Text")))])),
    ]
    return {
        "WFWorkflowName": "NoteGoat Opt-Out",
        "WFWorkflowClientVersion": "2302.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59511},
        "WFWorkflowTypes": [],
        "WFWorkflowInputContentItemClasses": ["WFStringContentItem", "WFGenericFileContentItem"],
        "WFWorkflowImportQuestions": [{"ActionIndex": 0, "Category": "Parameter", "DefaultValue": "",
            "ParameterKey": "WFTextActionText",
            "Text": "Paste your NoteGoat device code (starts with ngr_). Get it in NoteGoat › Settings › Text Reminders."}],
        "WFWorkflowActions": acts,
    }

# Usage: build-shortcuts.py [send|opt-out ...]  (default: all). Rebuilding
# replaces a signed file with an unsigned one, so build only what changed.
only = set(sys.argv[1:]) or {"send", "opt-out"}
d = pathlib.Path(__file__).resolve().parent.parent / "public" / "shortcuts"
d.mkdir(parents=True, exist_ok=True)
for fname, name, query in [("Send-Reminders.shortcut", "Send Reminders", "format=shortcut"),
                           ("Send-Reminders-Now.shortcut", "Send Reminders Now", "format=shortcut&force=1")]:
    if "send" not in only: continue
    (d / fname).write_bytes(plistlib.dumps(build(name, query), fmt=plistlib.FMT_BINARY))
    print("wrote", d / fname)
if "opt-out" in only:
    (d / "NoteGoat-Opt-Out.shortcut").write_bytes(plistlib.dumps(build_opt_out(), fmt=plistlib.FMT_BINARY))
    print("wrote", d / "NoteGoat-Opt-Out.shortcut")
