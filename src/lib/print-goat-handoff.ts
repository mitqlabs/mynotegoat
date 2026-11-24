/**
 * Print only the End of Day Handoff, starting at the top of page 1.
 *
 * The old print rules only marked the rest of the page as invisible, so those
 * boxes still took up height. The handoff also sat inside a transformed
 * grid box, so it printed on a later page after a blank one. A copy placed
 * on the body, with every other top-level node left out of the print layout,
 * starts on page 1.
 */
const STYLE_ID = "goat-handoff-print-style";

const PRINT_CSS = `
@media print {
  @page { margin: 0.5in; }
  html, body.goat-printing-handoff {
    height: auto !important;
    overflow: visible !important;
    margin: 0 !important;
    background: #fff !important;
  }
  body.goat-printing-handoff > *:not(.goat-print-root) {
    display: none !important;
  }
  body.goat-printing-handoff > .goat-print-root,
  body.goat-printing-handoff .goat-handoff {
    display: block !important;
    position: static !important;
    left: auto !important;
    top: auto !important;
    width: 100% !important;
    height: auto !important;
    max-height: none !important;
    margin: 0 !important;
    overflow: visible !important;
    transform: none !important;
    box-shadow: none !important;
    break-before: auto !important;
    page-break-before: auto !important;
  }
  .goat-handoff-actions { display: none !important; }
}
`;

export function printGoatHandoff(root: HTMLElement | null) {
  if (!root || typeof document === "undefined") return;
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);
  }
  const shell = document.createElement("div");
  shell.className = "goat-print-root";
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".goat-handoff-actions").forEach((node) => node.remove());
  shell.appendChild(copy);
  document.body.appendChild(shell);
  document.body.classList.add("goat-printing-handoff");
  const cleanup = () => {
    document.body.classList.remove("goat-printing-handoff");
    shell.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
