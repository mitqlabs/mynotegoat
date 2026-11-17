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

/** Exact words the office follows. **these** are the words on the iPhone screen. */
export function iphoneSetupSteps(sendHour: number): SetupStep[] {
  const [atSend, atHalf, atNext] = catchUpClockLabels(sendHour);
  return [
    { icon: "📱", text: "Tap **Add to this iPhone**." },
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
    step(["Tap **Add to this iPhone**."]),
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
      fix: `${when}. The phone also checked in ${fmtDateTime(input.lastSeenAt, input.timeZone)}.`,
    };
  }
  if (input.stopReportAt) {
    return {
      ok: true,
      title: "STOP catcher working ✓",
      fix: `${when}. Texts go out at ${atSend}. Leave the iPhone on and unlocked then.`,
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
      fix: "The phone can send texts. Tap Test so we know STOP replies work.",
    };
  }
  return {
    ok: false,
    title: "Not working yet",
    fix: "Tap Add to this iPhone, tap Add Shortcut, then come back and tap Test.",
  };
}
