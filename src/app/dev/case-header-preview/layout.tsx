const THEME = `(function(){
  try {
    localStorage.setItem("casemate.brand.v1", JSON.stringify({ theme: "blue" }));
    localStorage.setItem("casemate.theme-tone.v1", "dark");
  } catch (e) {}
  var root = document.documentElement;
  root.setAttribute("data-brand", "blue");
  root.setAttribute("data-tone", "dark");
  root.setAttribute("data-theme-lock", "1");
})();`;

/** Locks NoteGoat Blue dark before paint. This route is not linked from the app. */
export default function CaseHeaderPreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME }} />
      {children}
    </>
  );
}
