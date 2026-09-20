import type { BBox } from "@quod/contracts";
/** PyMuPDF points: top-left origin, y down. Page numbers stay 1-indexed. */
export function pdfToViewport(
  box: BBox,
  pageWidthPt: number,
  renderedWidthPx: number,
): BBox {
  if (pageWidthPt <= 0 || renderedWidthPx <= 0)
    throw new Error("Page widths must be positive");
  const scale = renderedWidthPx / pageWidthPt;
  return box.map((n) => n * scale) as BBox;
}
export function viewportToPdf(
  box: BBox,
  pageWidthPt: number,
  renderedWidthPx: number,
): BBox {
  return pdfToViewport(box, renderedWidthPx, pageWidthPt);
}
