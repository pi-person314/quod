import type { Anchor } from "@quod/contracts";

/** One hit target for nested detections such as "By Theorem 2" / "Theorem 2". */
export function referenceOverlays(anchors: readonly Anchor[]): Anchor[] {
  const name = (anchor: Anchor) => anchor.surface.replace(/^by\s+/i, "").trim().toLowerCase();
  return anchors.filter((anchor, index) => !anchors.some((other, otherIndex) => {
    if (index === otherIndex || other.doc_id !== anchor.doc_id || other.page !== anchor.page
      || name(other) !== name(anchor) || other.target_node_id !== anchor.target_node_id
      || other.target_entity_id !== anchor.target_entity_id) return false;
    const contains = other.bbox[0] <= anchor.bbox[0] + 1 && other.bbox[1] <= anchor.bbox[1] + 1
      && other.bbox[2] >= anchor.bbox[2] - 1 && other.bbox[3] >= anchor.bbox[3] - 1;
    return contains && (other.surface.length > anchor.surface.length
      || (other.surface.length === anchor.surface.length && otherIndex < index));
  }));
}
