import { createRoot } from "react-dom/client";
import { OfficeCellMenu } from "@/components/office-cell-menu";
const locs = [1, 2, 3, 4].map((i) => ({ id: `loc${i}`, name: `Office ${i}` }));
const rows = Array.from({ length: 400 }, (_, i) => ({ id: `PT-${i}`, loc: `loc${(i % 4) + 1}` }));
createRoot(document.getElementById("root")!).render(<div>{rows.map((r) => <div key={r.id}>Mock Patient {r.id}<OfficeCellMenu locationId={r.loc} locations={locs} patientId={r.id} /></div>)}</div>);
