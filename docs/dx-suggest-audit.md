# G.O.A.T. "Suggested from MRI" coding audit (FY2026 ICD-10-CM)

Sources: CMS FY2026 code descriptions (`public/icd10/icd10cm-2026.json`) and the FY2026
tabular + index XML (`2026-code-tables-tabular-and-index.zip`). Every mapped code is
checked to be billable with the exact official description in
`scripts/tests/dx-suggest.test.ts` ("AUDIT" tests).

| MRI finding | Code(s) suggested | Official basis | Excludes1 / notes checked | Change in this audit |
|---|---|---|---|---|
| Herniation / protrusion / extrusion / sequestration | M50.21, M50.221–M50.223, M50.20, M50.23; M51.24–M51.27 | Index: Herniation, nucleus pulposus / Protrusion, intervertebral disc → Displacement, intervertebral disc | M50–M54 Excludes1 current injury (S13.0/S23.0/S33.0 on patient → held back) | Every stated cervical level suggested (the old "most superior level" rule is gone; FY2026 M50 has no such note). Unspecified M50.20 only when no level is stated |
| Disc bulge | same displacement codes | Not an Index term | as above | Own rule with a "confirm the radiologist means displacement" why line |
| Degeneration / desiccation / disc-height loss | M50.3x; M51.34, M51.35, M51.369 (+M51.360–362), M51.379 (+M51.370–372) | Index: Degeneration, intervertebral disc | — | No change to codes |
| Annular tear / fissure | M51.34/M51.35/M51.36-/M51.37- by region | Index: Tear, annular fibrosis → M51.35 | M51.A- is "code first" herniation (not used) | **Cervical annular tear removed** (no Index entry) |
| Central canal stenosis | M48.02–M48.07, M48.061; M48.062 with documented neurogenic claudication | Index: Stenosis, spinal → M48.0- | M99 note "not used if classifiable elsewhere" | **M99.5x only if the office list has it AND the report states the disc causes it** ("due to / causing / secondary to"); otherwise M48.0- |
| Foraminal narrowing | M48.0- by region | User directive + M99 note | M99 note | **Was M99.6x/M99.7x by default; now M48.0-**. M99.6x (bony cause) / M99.7x (disc cause) only if in the office list AND the cause is stated |
| Spondylosis / spondylotic / DOC / uncovertebral arthrosis | M47.81x; M47.2x with radiculopathy; M47.1x with myelopathy | Index: Spondylosis; M47 includes arthrosis of spine | M47.1 Excludes1 vertebral subluxation M43.3–M43.5X9 | **Lone osteophyte/spurring removed** (Index: Osteophyte, vertebrae → M25.78) |
| Facet arthropathy / hypertrophy | M47.81x | Index: Arthropathy / Hypertrophy, facet joint → M47.819, see Spondylosis | — | — |
| Spondylolisthesis / anterolisthesis | M43.12–M43.17 | Index: Spondylolisthesis | M43.1 Excludes1 acute traumatic (S33.1-, fracture codes), congenital Q76.2 → shown as a note; S33.1 on patient → held back | **Retrolisthesis and "listhesis" removed** (not indexed) |
| Spondylolysis / pars defect | M43.02–M43.07 | Index: Spondylolysis | M43.0 Excludes1 spondylolisthesis M43.1 → never suggested together | Excludes1 enforced |
| Schmorl's node | M51.44–M51.47 | Index: Schmorl's disease or nodes | — | — |
| Radiculopathy (notes) + disc finding | M50.11–M50.13, M51.14–M51.17 | Index: Disorder, disc, with radiculopathy | M54.1 Excludes1 M50.1 / M51.1 / M47.2; M51.1 Excludes1 M54.3 | **Notes must name radiculopathy / radiculitis / radicular / sciatica**; symptoms alone (radiating, numbness, tingling) no longer count |
| Radiculopathy (notes), no disc/spondylosis code | M54.12–M54.17 | Index: Radiculopathy | M54.1 Excludes1 as above; S14.2/S24.2/S34.2 on patient → held back | — |
| Myelopathy documented | M50.0x, M51.04–M51.06, M47.1x | Index: Disorder, disc, with myelopathy | — | — |

Engine rules: exact official descriptions always (the office's own wording is not shown on
suggestions); level-specific codes only when the level is in that finding's sentence or an
earlier sentence of the same item; any Excludes1 pair (between suggestions, or with a code
already on the patient) is held back and listed under "Not suggested" with the note.
