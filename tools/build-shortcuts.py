#!/usr/bin/env python3
"""Builds the unsigned NoteGoat 'Send Reminders' Apple Shortcuts files.
No token is embedded: the code is asked for when the shortcut is added
(WFWorkflowImportQuestions). Run: python3 tools/build-shortcuts.py"""
import plistlib, uuid, pathlib, sys

ORIGIN = "https://www.mynotegoat.com"
OBJ = "\ufffc"
# One call hands out this many texts. The shortcut asks again until the
# server says send=no, so a killed run only leases one small batch.
BATCH = 5
LOOPS = 8
SETUP_AGAIN = "This Device needs to be set up again: open NoteGoat > Text Reminders > Add to this Device"
# Same length as a real device code (ngr_ + 64 hex). The download route
# swaps this for the office's code so nobody pastes it.
TOKEN_SLOT = "NG" + ("0" * 66)

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

def failed_fetch_notice():
    """send is not yes, or the queue call failed. Always show a notification."""
    err_if, msg_if = U(), U()
    d_err = U()
    return [
        act("is.workflow.actions.getvalueforkey", UUID=d_err, WFDictionaryKey="error",
            WFInput=att(var("Queue"))),
        act("is.workflow.actions.conditional", GroupingIdentifier=err_if, WFControlFlowMode=0,
            WFCondition=100, WFInput=att(out(d_err, "Dictionary Value"))),
        act("is.workflow.actions.notification", WFNotificationActionTitle="NoteGoat",
            WFNotificationActionBody=tstr("", out(d_err, "Dictionary Value"))),
        act("is.workflow.actions.conditional", GroupingIdentifier=err_if, WFControlFlowMode=1),
        act("is.workflow.actions.conditional", GroupingIdentifier=msg_if, WFControlFlowMode=0,
            WFCondition=100, WFInput=att(var("Message"))),
        act("is.workflow.actions.notification", WFNotificationActionTitle="NoteGoat",
            WFNotificationActionBody=tstr("", var("Message"))),
        act("is.workflow.actions.conditional", GroupingIdentifier=msg_if, WFControlFlowMode=1),
        act("is.workflow.actions.notification", WFNotificationActionTitle="NoteGoat",
            WFNotificationActionBody=tstr(SETUP_AGAIN)),
        act("is.workflow.actions.conditional", GroupingIdentifier=msg_if, WFControlFlowMode=2),
        act("is.workflow.actions.conditional", GroupingIdentifier=err_if, WFControlFlowMode=2),
    ]


def build(name, query, notify_on_stop=False):
    """Fetch a small batch, text it, ack each one, then ask again.

    Stops as soon as the server says send=no. Send Message has Show When Run
    off so the automation does not sit on a Messages prompt. NoteGoat shows
    the error or message instead of exiting with nothing on screen.
    """
    auth = [("Authorization", tstr("Bearer ", var("Token")))]
    loop, iff, rep = U(), U(), U()
    tk, q, d_visit, d_msg, d_send, d_items, txt, ph = (U() for _ in range(8))
    acts = [
        act("is.workflow.actions.gettext", UUID=tk, WFTextActionText=""),  # index 0 = import question
        act("is.workflow.actions.setvariable", WFVariableName="Token",
            WFInput=att(out(tk, "Text"))),
        act("is.workflow.actions.repeat.count", GroupingIdentifier=loop, WFControlFlowMode=0, WFRepeatCount=LOOPS),
        act("is.workflow.actions.downloadurl", UUID=q, WFURL=f"{ORIGIN}/api/reminders/queue?{query}",
            WFHTTPMethod="GET", ShowHeaders=True, WFHTTPHeaders=fields(auth)),
        act("is.workflow.actions.setvariable", WFVariableName="Queue",
            WFInput=att(out(q, "Contents of URL"))),
        act("is.workflow.actions.getvalueforkey", UUID=d_visit, WFDictionaryKey="visitDate",
            WFInput=att(var("Queue"))),
        act("is.workflow.actions.setvariable", WFVariableName="VisitDate",
            WFInput=att(out(d_visit, "Dictionary Value"))),
        act("is.workflow.actions.getvalueforkey", UUID=d_msg, WFDictionaryKey="message",
            WFInput=att(var("Queue"))),
        act("is.workflow.actions.setvariable", WFVariableName="Message",
            WFInput=att(out(d_msg, "Dictionary Value"))),
        act("is.workflow.actions.getvalueforkey", UUID=d_send, WFDictionaryKey="send",
            WFInput=att(var("Queue"))),
        # send == "yes" → there is a batch to text. Anything else: stop.
        act("is.workflow.actions.conditional", GroupingIdentifier=iff, WFControlFlowMode=0,
            WFCondition=4, WFConditionalActionString="yes",
            WFInput=att(out(d_send, "Dictionary Value"))),
        act("is.workflow.actions.getvalueforkey", UUID=d_items, WFDictionaryKey="items",
            WFInput=att(var("Queue"))),
        act("is.workflow.actions.repeat.each", GroupingIdentifier=rep, WFControlFlowMode=0,
            WFInput=att(out(d_items, "Dictionary Value"))),
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
        act("is.workflow.actions.delay", WFDelayTime=2),
        act("is.workflow.actions.repeat.each", GroupingIdentifier=rep, WFControlFlowMode=2, UUID=U()),
        act("is.workflow.actions.notification", WFNotificationActionTitle="NoteGoat",
            WFNotificationActionBody=tstr("", var("Message"))),
        act("is.workflow.actions.conditional", GroupingIdentifier=iff, WFControlFlowMode=1),
        *(failed_fetch_notice() if notify_on_stop else [act("is.workflow.actions.exit")]),
        act("is.workflow.actions.conditional", GroupingIdentifier=iff, WFControlFlowMode=2),
        act("is.workflow.actions.repeat.count", GroupingIdentifier=loop, WFControlFlowMode=2, UUID=U()),
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

def post_inbound(auth, from_value, text_value):
    return act(
        "is.workflow.actions.downloadurl",
        UUID=U(),
        WFURL=f"{ORIGIN}/api/reminders/inbound",
        WFHTTPMethod="POST",
        ShowHeaders=True,
        WFHTTPHeaders=fields(auth),
        WFHTTPBodyType="JSON",
        WFJSONValues=fields([("from", from_value), ("text", text_value)]),
    )


def build_notegoat(token):
    """One shortcut. A message (STOP reply or the test) is reported.
    Anything else sends the reminder batches. The code is already filled in
    when token is set, so the phone does not ask anyone to paste it."""
    auth = [("Authorization", tstr("Bearer ", var("Token")))]
    outer, inner = U(), U()
    tk, body, sender = U(), U(), U()
    shortcut_in = {"Type": "ExtensionInput"}
    # Reuse the send shortcut's actions, minus its own code question.
    send = build("NoteGoat", f"format=shortcut&force=1&batch={BATCH}", notify_on_stop=True)
    send_acts = send["WFWorkflowActions"][2:]
    acts = [
        act("is.workflow.actions.gettext", UUID=tk, WFTextActionText=token),
        act("is.workflow.actions.setvariable", WFVariableName="Token", WFInput=att(out(tk, "Text"))),
        # No message: send texts. A message (or the test words): report it.
        act(
            "is.workflow.actions.conditional",
            GroupingIdentifier=outer,
            WFControlFlowMode=0,
            WFCondition=100,
            WFInput=att(shortcut_in),
        ),
        act("is.workflow.actions.gettext", UUID=body, WFTextActionText=tstr("", shortcut_in)),
        act("is.workflow.actions.setvariable", WFVariableName="Reply", WFInput=att(out(body, "Text"))),
        act(
            "is.workflow.actions.conditional",
            GroupingIdentifier=inner,
            WFControlFlowMode=0,
            WFCondition=4,
            WFConditionalActionString="STOP TEST",
            WFInput=att(var("Reply")),
        ),
        post_inbound(auth, tstr("test"), tstr("STOP TEST")),
        act("is.workflow.actions.notification", WFNotificationActionTitle="NoteGoat", WFNotificationActionBody=tstr("Test received")),
        act("is.workflow.actions.conditional", GroupingIdentifier=inner, WFControlFlowMode=1),
        act(
            "is.workflow.actions.gettext",
            UUID=sender,
            WFTextActionText=tstr("", dict(shortcut_in, Aggrandizements=[
                {"Type": "WFPropertyVariableAggrandizement", "PropertyName": "Sender"},
            ])),
        ),
        post_inbound(auth, tstr("", out(sender, "Text")), tstr("", var("Reply"))),
        act("is.workflow.actions.conditional", GroupingIdentifier=inner, WFControlFlowMode=2),
        act("is.workflow.actions.conditional", GroupingIdentifier=outer, WFControlFlowMode=1),
        *send_acts,
        act("is.workflow.actions.conditional", GroupingIdentifier=outer, WFControlFlowMode=2),
    ]
    return {
        "WFWorkflowName": "NoteGoat",
        "WFWorkflowClientVersion": "2302.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4292093695, "WFWorkflowIconGlyphNumber": 59511},
        "WFWorkflowTypes": ["WFWorkflowTypeShowInShareSheet"],
        "WFWorkflowInputContentItemClasses": ["WFStringContentItem", "WFGenericFileContentItem"],
        "WFWorkflowImportQuestions": [],
        "WFWorkflowActions": acts,
    }


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
only = set(sys.argv[1:]) or {"send", "opt-out", "notegoat"}
d = pathlib.Path(__file__).resolve().parent.parent / "public" / "shortcuts"
d.mkdir(parents=True, exist_ok=True)
for fname, name, query in [("Send-Reminders.shortcut", "Send Reminders", f"format=shortcut&batch={BATCH}"),
                           ("Send-Reminders-Now.shortcut", "Send Reminders Now", f"format=shortcut&force=1&batch={BATCH}")]:
    if "send" not in only: continue
    (d / fname).write_bytes(plistlib.dumps(build(name, query), fmt=plistlib.FMT_BINARY))
    print("wrote", d / fname)
if "opt-out" in only:
    (d / "NoteGoat-Opt-Out.shortcut").write_bytes(plistlib.dumps(build_opt_out(), fmt=plistlib.FMT_BINARY))
    print("wrote", d / "NoteGoat-Opt-Out.shortcut")
if "notegoat" in only:
    folder = pathlib.Path(__file__).resolve().parent.parent / "src" / "lib" / "shortcuts"
    folder.mkdir(parents=True, exist_ok=True)
    template = folder / "NoteGoat.template.shortcut"
    template.write_bytes(plistlib.dumps(build_notegoat(TOKEN_SLOT), fmt=plistlib.FMT_BINARY))
    print("wrote", template)
