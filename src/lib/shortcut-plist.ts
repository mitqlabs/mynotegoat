/**
 * A send-only shortcut named for one rule.
 * It calls the queue with that rule id. STOP stays on the original NoteGoat shortcut.
 */
import { randomUUID } from "crypto";

const BATCH = 5;
const LOOPS = 8;
const OBJ = "\ufffc";

function U(): string {
  return randomUUID().toUpperCase();
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function S(value: string): string {
  return `<string>${esc(value)}</string>`;
}

function I(value: number): string {
  return `<integer>${value}</integer>`;
}

function B(value: boolean): string {
  return value ? "<true/>" : "<false/>";
}

function dict(entries: [string, string][]): string {
  return `<dict>${entries.map(([key, value]) => `<key>${esc(key)}</key>${value}`).join("")}</dict>`;
}

function action(ident: string, params: [string, string][], uuid?: string): string {
  const extra = uuid ? `<key>UUID</key>${S(uuid)}` : "";
  return `<dict><key>WFWorkflowActionIdentifier</key>${S(ident)}<key>WFWorkflowActionParameters</key>${dict(params)}${extra}</dict>`;
}

function variable(name: string, dictKey?: string): string {
  const agg = dictKey
    ? `<key>Aggrandizements</key><array><dict><key>DictionaryKey</key>${S(dictKey)}<key>Type</key>${S("WFDictionaryValueVariableAggrandizement")}</dict></array>`
    : "";
  return `<dict><key>Type</key>${S("Variable")}<key>VariableName</key>${S(name)}${agg}</dict>`;
}

function output(uuid: string, name: string): string {
  return `<dict><key>OutputName</key>${S(name)}<key>OutputUUID</key>${S(uuid)}<key>Type</key>${S("ActionOutput")}</dict>`;
}

function attachment(valueXml: string): string {
  return `<dict><key>Value</key>${valueXml}<key>WFSerializationType</key>${S("WFTextTokenAttachment")}</dict>`;
}

function textToken(prefix: string, valueXml?: string, suffix = ""): string {
  if (!valueXml) {
    return `<dict><key>Value</key><dict><key>string</key>${S(prefix)}</dict><key>WFSerializationType</key>${S("WFTextTokenString")}</dict>`;
  }
  const range = `{${prefix.length}, 1}`;
  return `<dict><key>Value</key><dict><key>attachmentsByRange</key><dict><key>${esc(range)}</key>${valueXml}</dict><key>string</key>${S(prefix + OBJ + suffix)}</dict><key>WFSerializationType</key>${S("WFTextTokenString")}</dict>`;
}

function fields(items: [string, string][]): string {
  const rows = items
    .map(
      ([key, value]) =>
        `<dict><key>WFItemType</key>${I(0)}<key>WFKey</key>${textToken(key)}<key>WFValue</key>${value}</dict>`,
    )
    .join("");
  return `<dict><key>Value</key><dict><key>WFDictionaryFieldValueItems</key><array>${rows}</array></dict><key>WFSerializationType</key>${S("WFDictionaryFieldValue")}</dict>`;
}

/** Unsigned shortcut plist. The Device code is already filled in. */
export function buildNamedShortcut(input: { token: string; name: string; ruleId: string; origin: string }): string {
  const origin = input.origin.replace(/\/$/, "");
  const query = `format=shortcut&force=1&batch=${BATCH}&rule=${encodeURIComponent(input.ruleId)}`;
  const url = `${origin}/api/reminders/queue?${query}`;
  const ack = `${origin}/api/reminders/ack`;
  const auth = fields([["Authorization", textToken("Bearer ", variable("Token"))]]);
  const loop = U();
  const iff = U();
  const rep = U();
  const tk = U();
  const q = U();
  const dVisit = U();
  const dMsg = U();
  const dSend = U();
  const dItems = U();
  const txt = U();
  const ph = U();
  const actions = [
    action("is.workflow.actions.gettext", [["WFTextActionText", S(input.token)]], tk),
    action("is.workflow.actions.setvariable", [
      ["WFVariableName", S("Token")],
      ["WFInput", attachment(output(tk, "Text"))],
    ]),
    action("is.workflow.actions.repeat.count", [
      ["GroupingIdentifier", S(loop)],
      ["WFControlFlowMode", I(0)],
      ["WFRepeatCount", I(LOOPS)],
    ]),
    action(
      "is.workflow.actions.downloadurl",
      [
        ["WFURL", S(url)],
        ["WFHTTPMethod", S("GET")],
        ["ShowHeaders", B(true)],
        ["WFHTTPHeaders", auth],
      ],
      q,
    ),
    action("is.workflow.actions.setvariable", [
      ["WFVariableName", S("Queue")],
      ["WFInput", attachment(output(q, "Contents of URL"))],
    ]),
    action(
      "is.workflow.actions.getvalueforkey",
      [
        ["WFDictionaryKey", S("visitDate")],
        ["WFInput", attachment(variable("Queue"))],
      ],
      dVisit,
    ),
    action("is.workflow.actions.setvariable", [
      ["WFVariableName", S("VisitDate")],
      ["WFInput", attachment(output(dVisit, "Dictionary Value"))],
    ]),
    action(
      "is.workflow.actions.getvalueforkey",
      [
        ["WFDictionaryKey", S("message")],
        ["WFInput", attachment(variable("Queue"))],
      ],
      dMsg,
    ),
    action("is.workflow.actions.setvariable", [
      ["WFVariableName", S("Message")],
      ["WFInput", attachment(output(dMsg, "Dictionary Value"))],
    ]),
    action(
      "is.workflow.actions.getvalueforkey",
      [
        ["WFDictionaryKey", S("send")],
        ["WFInput", attachment(variable("Queue"))],
      ],
      dSend,
    ),
    action("is.workflow.actions.conditional", [
      ["GroupingIdentifier", S(iff)],
      ["WFControlFlowMode", I(0)],
      ["WFCondition", I(4)],
      ["WFConditionalActionString", S("yes")],
      ["WFInput", attachment(output(dSend, "Dictionary Value"))],
    ]),
    action(
      "is.workflow.actions.getvalueforkey",
      [
        ["WFDictionaryKey", S("items")],
        ["WFInput", attachment(variable("Queue"))],
      ],
      dItems,
    ),
    action("is.workflow.actions.repeat.each", [
      ["GroupingIdentifier", S(rep)],
      ["WFControlFlowMode", I(0)],
      ["WFInput", attachment(output(dItems, "Dictionary Value"))],
    ]),
    action(
      "is.workflow.actions.getvalueforkey",
      [
        ["WFDictionaryKey", S("text")],
        ["WFInput", attachment(variable("Repeat Item"))],
      ],
      txt,
    ),
    action(
      "is.workflow.actions.getvalueforkey",
      [
        ["WFDictionaryKey", S("phone")],
        ["WFInput", attachment(variable("Repeat Item"))],
      ],
      ph,
    ),
    action("is.workflow.actions.sendmessage", [
      ["ShowWhenRun", B(false)],
      ["WFSendMessageContent", textToken("", output(txt, "Dictionary Value"))],
      ["WFSendMessageActionRecipients", attachment(output(ph, "Dictionary Value"))],
    ]),
    action("is.workflow.actions.downloadurl", [
      ["WFURL", S(ack)],
      ["WFHTTPMethod", S("POST")],
      ["ShowHeaders", B(true)],
      ["WFHTTPHeaders", auth],
      ["WFHTTPBodyType", S("JSON")],
      [
        "WFJSONValues",
        fields([
          ["visitDate", textToken("", variable("VisitDate"))],
          ["id", textToken("", variable("Repeat Item", "id"))],
          ["status", textToken("sent")],
        ]),
      ],
    ]),
    action("is.workflow.actions.delay", [["WFDelayTime", I(2)]]),
    action("is.workflow.actions.repeat.each", [
      ["GroupingIdentifier", S(rep)],
      ["WFControlFlowMode", I(2)],
    ]),
    action("is.workflow.actions.notification", [
      ["WFNotificationActionTitle", S("NoteGoat")],
      ["WFNotificationActionBody", textToken("", variable("Message"))],
    ]),
    action("is.workflow.actions.conditional", [
      ["GroupingIdentifier", S(iff)],
      ["WFControlFlowMode", I(1)],
    ]),
    action("is.workflow.actions.exit", []),
    action("is.workflow.actions.conditional", [
      ["GroupingIdentifier", S(iff)],
      ["WFControlFlowMode", I(2)],
    ]),
    action("is.workflow.actions.repeat.count", [
      ["GroupingIdentifier", S(loop)],
      ["WFControlFlowMode", I(2)],
    ]),
  ];
  const workflow = `<dict><key>WFWorkflowActions</key><array>${actions.join("")}</array><key>WFWorkflowClientVersion</key>${S("2302.0.4")}<key>WFWorkflowIcon</key><dict><key>WFWorkflowIconGlyphNumber</key>${I(59511)}<key>WFWorkflowIconStartColor</key>${I(4292093695)}</dict><key>WFWorkflowImportQuestions</key><array></array><key>WFWorkflowInputContentItemClasses</key><array></array><key>WFWorkflowMinimumClientVersion</key>${I(900)}<key>WFWorkflowMinimumClientVersionString</key>${S("900")}<key>WFWorkflowName</key>${S(input.name)}<key>WFWorkflowTypes</key><array></array></dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${workflow}\n</plist>\n`;
}
