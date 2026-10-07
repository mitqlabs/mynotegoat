"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { loadFileManagerState } from "@/lib/file-manager";
import { getSignedUrl } from "@/lib/file-storage";
import { onLocalChange } from "@/lib/local-sync";
import type { GoatFile } from "@/lib/goat-docs";
import {
  cancelGoatReading,
  goatFileFor,
  goatReaderState,
  loadCachedText,
  patientFileRecords,
  pendingOcrCount,
  readGoatFiles,
  subscribeGoatReader,
  type GoatReaderState,
} from "@/lib/goat-files";

const FILES_KEY = "casemate.files.v1";

export interface GoatFilesController {
  /** False when Patient Files are hidden for this user (G.O.A.T. then doesn't read them). */
  enabled: boolean;
  files: GoatFile[];
  counts: { total: number; read: number; waiting: number; scanned: number; failed: number; other: number };
  reader: GoatReaderState;
  /** Read everything not read yet, including OCR of scanned pages/images. */
  readAll: () => void;
  stop: () => void;
  /** Open a file (at a page for PDFs) in a new tab. */
  openFile: (fileId: string, page?: number) => void;
}

/**
 * The patient's uploaded files as G.O.A.T. sees them. On first use it pulls
 * any text already extracted (this browser, then the office cache) and reads
 * the text layer of the rest in the background; OCR of scanned files waits
 * for the "Read files" button because it takes longer.
 */
export function useGoatFiles(patientId: string | undefined, enabled: boolean): GoatFilesController {
  const [fileState, setFileState] = useState(() => loadFileManagerState());
  const [textVersion, bumpText] = useReducer((n: number) => n + 1, 0);
  const [reader, setReader] = useState<GoatReaderState>(() => goatReaderState());

  useEffect(() => onLocalChange(FILES_KEY, () => setFileState(loadFileManagerState())), []);
  // Reader progress + uploads made elsewhere on the page.
  useEffect(
    () =>
      subscribeGoatReader((event) => {
        setReader(goatReaderState());
        if (event === "text") {
          setFileState(loadFileManagerState());
          bumpText();
        }
      }),
    [],
  );

  const records = useMemo(
    () => (enabled && patientId ? patientFileRecords(fileState, patientId) : []),
    [enabled, patientId, fileState],
  );
  const pathsKey = records.map((r) => r.file.storagePath).join("|");

  useEffect(() => {
    if (!enabled || !pathsKey) return;
    let alive = true;
    const list = records.map((r) => r.file);
    // Let the page settle first; then cached text, then text layers.
    const timer = setTimeout(() => {
      void loadCachedText(list).then(
        () => {
          if (alive) readGoatFiles(list, { ocr: false });
        },
        (err: unknown) => console.warn("[goat-files] cache load failed:", err),
      );
    }, 1200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // records is derived from pathsKey; re-run only when the set of files changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pathsKey]);

  const readingName = reader.running ? reader.current?.fileName : undefined;
  // Stable between progress ticks so G.O.A.T. only re-answers when text changes.
  const files = useMemo(
    () => records.map((r) => goatFileFor(r.file, r.folder)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, textVersion, readingName],
  );
  const counts = useMemo(() => ({
    total: files.length,
    read: files.filter((f) => f.status === "read").length,
    waiting: files.filter((f) => f.status === "unread" || f.status === "reading").length,
    scanned: pendingOcrCount(records.map((r) => r.file)),
    failed: files.filter((f) => f.status === "failed").length,
    other: files.filter((f) => f.status === "unsupported").length,
  }), [files, records]);

  const readAll = useCallback(() => {
    readGoatFiles(
      records.map((r) => r.file),
      { ocr: true },
    );
  }, [records]);

  const openFile = useCallback(
    (fileId: string, page?: number) => {
      const rec = records.find((r) => r.file.id === fileId)?.file;
      if (!rec) return;
      void getSignedUrl(rec.storagePath).then(({ url, error }) => {
        if (error || !url) {
          console.warn("[goat-files] couldn't open file:", error);
          return;
        }
        const pdfPage = page && /\.pdf$/i.test(rec.name) ? `#page=${page}` : "";
        window.open(url + pdfPage, "_blank", "noopener");
      });
    },
    [records],
  );

  return { enabled, files, counts, reader, readAll, stop: cancelGoatReading, openFile };
}
