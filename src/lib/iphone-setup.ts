/**
 * The office iPhone steps, and whether the phone has actually reported in.
 * Plain words only. Green only after a real report, never a box someone ticked.
 */
import { catchUpClockLabels } from "@/lib/reminder-automation";
import { fmtDateTime } from "@/lib/reminder-format";
import { clockWords } from "@/lib/text-rules";

export interface SetupStep {
  icon: string;
  text: string;
  /** One action per line. **these** are the words on the screen. */
  lines?: string[];
}

export type SetupPlatform = "iphone" | "mac" | "other";

/** iPhone, iPad, a desktop Mac, or something else. iPadOS reports itself as a Mac with touch. */
export function readSetupPlatform(ua: string, touchPoints = 0): SetupPlatform {
  if (/iPhone|iPad|iPod/.test(ua)) return "iphone";
  if (/Macintosh/.test(ua) && touchPoints > 1) return "iphone";
  if (/Macintosh|Mac OS X/.test(ua)) return "mac";
  return "other";
}

/**
 * The office already picked iPhone.
 * Allow an iOS browser in any form, and any touch Device.
 * Block a desktop Mac (no touch, or a single pointer) and a Windows desktop.
 */
export function pickedIphoneAllowed(ua: string, touchPoints = 0): boolean {
  if (/iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS|OPiOS|like Mac OS X|CPU (?:iPhone )?OS/i.test(ua)) return true;
  if (/Macintosh|Mac OS X/i.test(ua) && touchPoints <= 1) return false;
  if (/Windows NT|Win64/i.test(ua) && touchPoints <= 0) return false;
  return touchPoints > 0;
}

/** Exact words the office follows. **these** are the words on the device screen. */
export function iphoneSetupSteps(sendHour: number): SetupStep[] {
  const [atSend, atHalf, atNext] = catchUpClockLabels(sendHour);
  return [
    { icon: "📱", text: "Tap **Add to this Device**." },
    { icon: "⬇️", text: "Tap **Add Shortcut**." },
    { icon: "⏰", text: "Open **Shortcuts**. Tap **Automation**. Tap **+**. Tap **Time of Day**." },
    { icon: "⏰", text: `Set **${atSend}**. Tap **Every Day**. Tap **Run Immediately**. Turn **Notify When Run** off. Tap **Next**.` },
    { icon: "✅", text: "Tap **NoteGoat**. Tap **Done**." },
    { icon: "⏰", text: `Do steps 3 to 5 again, with **${atHalf}**.` },
    { icon: "⏰", text: `Do steps 3 to 5 again, with **${atNext}**.` },
    { icon: "💬", text: "Tap **+**. Tap **Message**. Tap **Message Contains**. Type **STOP**. Tap **Done**." },
    { icon: "💬", text: "Tap **Run Immediately**. Turn **Notify When Run** off. Tap **Next**. Tap **NoteGoat**. If you see **Shortcut Input**, tap it. Tap **Done**." },
    { icon: "✅", text: "Come back here and tap **Test**." },
  ];
}

/**
 * Phone steps for the times the saved texts actually use.
 * The first time lists every button. Later times say to do that again.
 * A time that is already in the list is not asked twice.
 */
function step(lines: string[]): SetupStep {
  return { icon: String(lines.length), text: lines.join(" "), lines };
}

/** The time steps, once in full. Later times point back at that step. */
export function phoneStepsForClocks(clocks: { hour: number; minute: number }[]): SetupStep[] {
  if (!clocks.length) return [];
  const first = clockWords(clocks[0].hour, clocks[0].minute);
  const steps: SetupStep[] = [
    step(["Tap **Add to this Device**."]),
    step(["Tap **Add Shortcut**."]),
    step([
      "Open **Shortcuts**.",
      "Tap **Automation**.",
      "Tap **+**.",
      "Tap **Time of Day**.",
      `Set **${first}**.`,
      "Tap **Every Day**.",
      "Tap **Run Immediately**.",
      "Turn **Notify When Run** off.",
      "Tap **Next**.",
      "Tap **NoteGoat**.",
      "Tap **Done**.",
    ]),
  ];
  clocks.slice(1).forEach((clock) => {
    const time = clockWords(clock.hour, clock.minute);
    steps.push(step([`Same as step 3, but set **${time}**.`]));
  });
  steps.push(
    step([
      "Tap **+**.",
      "Tap **Message**.",
      "Tap **Message Contains**.",
      "Type **STOP**.",
      "Tap **Done**.",
      "Tap **Run Immediately**.",
      "Turn **Notify When Run** off.",
      "Tap **Next**.",
      "Tap **NoteGoat**.",
      "If you see **Shortcut Input**, tap it.",
      "Tap **Done**.",
    ]),
  );
  steps.push(step(["Tap **Test**."]));
  return steps;
}

/**
 * Shortcuts on macOS Sonoma or later. Time of Day is a Personal Automation.
 * Message may be missing, so that step says so instead of sending someone looking for a button that is not there.
 */
export function macSetupSteps(clocks: { hour: number; minute: number }[]): SetupStep[] {
  if (!clocks.length) return [];
  const first = clockWords(clocks[0].hour, clocks[0].minute);
  const steps: SetupStep[] = [
    step(["Click **Add to this Device**."]),
    step(["Click **Add Shortcut**."]),
    step([
      "Open **Shortcuts**.",
      "Click **Automation**.",
      "Click **+**.",
      "Click **Time of Day**.",
      `Set **${first}**.`,
      "Click **Daily**.",
      "Click **Run Immediately**.",
      "Turn **Notify When Run** off.",
      "Click **Next**.",
      "Click **NoteGoat**.",
      "Click **Done**.",
    ]),
  ];
  clocks.slice(1).forEach((clock) => {
    steps.push(step([`Same as step 3, but set **${clockWords(clock.hour, clock.minute)}**.`]));
  });
  steps.push(step([
    "Click **+**.",
    "If you see **Message**, click it.",
    "If you do not see **Message**, skip it. A Mac may not have **Message**.",
  ]));
  steps.push(step(["Click **Test**."]));
  return steps;
}

/** iPhone steps, or Mac steps when this browser is a Mac. */
export function deviceSetupSteps(platform: SetupPlatform, clocks: { hour: number; minute: number }[]): SetupStep[] {
  return platform === "mac" ? macSetupSteps(clocks) : phoneStepsForClocks(clocks);
}

/**
 * Steps for one shortcut only. One action per line, in the words the Device shows.
 * Apple will not let a website create the Time of Day automation, so this is that one automation.
 */
export function oneShortcutLines(platform: SetupPlatform, name: string, time: string): string[] {
  const press = platform === "mac" ? "Click" : "Tap";
  const day = platform === "mac" ? "Daily" : "Every Day";
  return [
    `${press} **Add Shortcut**.`,
    "Open **Shortcuts**.",
    `${press} **Automation**.`,
    `${press} **+**.`,
    `${press} **Time of Day**.`,
    `Set **${time}**.`,
    `${press} **${day}**.`,
    `${press} **Run Immediately**.`,
    "Turn **Notify When Run** off.",
    `${press} **Next**.`,
    `${press} **"${name}"**.`,
    `${press} **Done**.`,
  ];
}

/** STOP catcher and Test stay separate from each shortcut. */
export function stopCatcherLines(platform: SetupPlatform): string[] {
  const press = platform === "mac" ? "Click" : "Tap";
  if (platform === "mac") {
    return ["Click **+**. If you see **Message**, click it. If you do not, skip it."];
  }
  return [
    "Tap **+**. Tap **Message**. Tap **Message Contains**.",
    "Type **STOP**. Tap **Done**.",
    "Tap **Run Immediately**. Turn **Notify When Run** off.",
    "Tap **Next**. Tap **NoteGoat**. Tap **Done**.",
  ];
}

export interface SetupReport {
  /** Green only when the phone has reported a STOP test or a real STOP. */
  ok: boolean;
  title: string;
  fix: string;
}

export function setupTestReport(input: {
  stopReportAt: string | null;
  lastSeenAt: string | null;
  unmatched: number;
  timeZone: string;
  sendHour: number;
}): SetupReport {
  const [atSend] = catchUpClockLabels(input.sendHour);
  const when = input.stopReportAt ? fmtDateTime(input.stopReportAt, input.timeZone) : "";
  if (input.stopReportAt && input.unmatched > 0) {
    return {
      ok: true,
      title: "STOP catcher working ✓",
      fix: `${when}. A STOP came in that we could not match. Use the red line at the top to mark that person.`,
    };
  }
  if (input.stopReportAt && input.lastSeenAt) {
    return {
      ok: true,
      title: "STOP catcher working ✓",
      fix: `${when}. The device also checked in ${fmtDateTime(input.lastSeenAt, input.timeZone)}.`,
    };
  }
  if (input.stopReportAt) {
    return {
      ok: true,
      title: "STOP catcher working ✓",
      fix: `${when}. Texts go out at ${atSend}. Leave the device on and unlocked then.`,
    };
  }
  if (input.unmatched > 0) {
    return {
      ok: false,
      title: "Not done yet",
      fix: "A STOP came in and we could not tell who sent it. Use the red line at the top.",
    };
  }
  if (input.lastSeenAt) {
    return {
      ok: false,
      title: "Not done yet",
      fix: "The device can send texts. Tap Test so we know STOP replies work.",
    };
  }
  return {
    ok: false,
    title: "Not working yet",
    fix: "Use Add to this Device, then Add Shortcut, then come back and tap Test.",
  };
}
