Repro for the "Listener leak detected (mousedown on document)" alarm: 400 mock
Patients rows with 4 offices, each with an OfficeCellMenu. Counts document
listeners in Chromium.

    node build.mjs "$(git rev-parse --show-toplevel)" && node run.js   # needs playwright

Before the fix: idle 400 mousedown + 400 keydown. After: idle 0, 1 while a menu is open.
