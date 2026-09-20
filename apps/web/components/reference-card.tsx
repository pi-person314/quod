"use client";
import { documentColor } from "@/lib/document-colors";
import { useEffect, useState } from "react";
import type { Card, ForwardResponse, ReaderState } from "@quod/contracts";
import type { Dataset } from "@/lib/data";
import { forward } from "@/lib/intelligence";
import { MathText } from "./math-text";
export function ReferenceCard({
  card,
  data,
  state,
  onJump,
  onPin,
  onKnown,
  pinned = false,
  onClose,
}: {
  card: Card;
  data: Dataset;
  state: Record<string, ReaderState>;
  onJump: (doc: string, page: number, node?: string) => void;
  onPin: () => void;
  onKnown: (id: string) => void;
  pinned?: boolean;
  onClose?: () => void;
}) {
  const [full, setFull] = useState(false),
    [expanded, setExpanded] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [links, setLinks] = useState<ForwardResponse["downstream"]>([]);
  const anchor = data.anchors.find((a) => a.id === card.anchor_id),
    targetId = anchor?.target_node_id ?? data.entities.find(e => e.id === anchor?.target_entity_id)?.canonical_node_id,
    // Cards built from a result stated on the page carry its node id in place
    // of an anchor id, so fall back to that.
    node =
      data.nodes.find((n) => n.id === targetId) ??
      data.nodes.find((n) => n.id === card.anchor_id),
    doc = data.docs.find((d) => d.id === card.source.doc_id);
  const known = node && state[node.id]?.known;
  const occurrences = data.nodes.filter(
    (n) => node?.entity_id && n.entity_id === node.entity_id,
  );
  useEffect(() => {
    let active = true;
    if (node?.entity_id)
      void forward(data, node.entity_id)
        .then((r) => {
          if (active) setLinks(r.downstream);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [node?.entity_id, data]);
  return (
    <article
      className={`reference-card ${pinned ? "pinned" : ""}`}
      data-card={card.anchor_id}
    >
      <header>
        <div>
          <span className="eyebrow">{node?.label ?? "REFERENCE"}</span>
          <h3>{card.headline}</h3>
        </div>
        {pinned && (
          <>
            <button
              aria-label="Collapse pinned card"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? "+" : "−"}
            </button>
            <button aria-label="Unpin card" onClick={onClose}>
              ×
            </button>
          </>
        )}
      </header>
      {!collapsed && (
        <>
          <button
            className="source-chip"
            style={{
              color: documentColor(doc?.id ?? "",data.docs),
            }}
            onClick={() =>
              onJump(card.source.doc_id, card.source.page, node?.id)
            }
          >
            {doc?.title.split(" · ")[0]} · p. {card.source.page}
          </button>
          {known && !expanded ? (
            <>
              <p className="reminder">Known · {card.headline}</p>
              <button className="text-button" onClick={() => setExpanded(true)}>
                Show reminder details
              </button>
            </>
          ) : (
            <>
              <div className="substitutions">
                {card.substitutions.map((s, i) => (
                  <span key={i}>
                    <MathText text={`$${s.from}$`} />
                    <span>→</span>
                    <MathText text={`$${s.to}$`} />
                  </span>
                ))}
              </div>
              {!node || !state[node.id]?.seen ? (
                <p className="gloss">{card.gloss}</p>
              ) : null}
              <MathText text={card.instantiated_md} />
              <button className="text-button" onClick={() => setFull(!full)}>
                {full ? "Hide full statement" : "Show full statement"}{" "}
                <span>{full ? "−" : "+"}</span>
              </button>
              {full && (
                <div className="full-statement">
                  <MathText text={card.full_md} />
                </div>
              )}
              {!pinned && occurrences.length > 1 && (
                <div className="occurrences">
                  <span className="eyebrow">
                    ONE RESULT, {occurrences.length} OCCURRENCES
                  </span>
                  {occurrences.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => onJump(n.doc_id, n.page, n.id)}
                      style={{
                        color: documentColor(n.doc_id,data.docs),
                      }}
                    >
                      {
                        data.docs
                          .find((d) => d.id === n.doc_id)
                          ?.title.split(" · ")[0]
                      }{" "}
                      · {n.label}
                    </button>
                  ))}
                </div>
              )}
              {!pinned && links.length > 0 && (
                <div className="forward">
                  <span className="eyebrow">PAYS OFF IN</span>
                  {links.slice(0, 3).map((h) => (
                    <button
                      key={h.node.id}
                      onClick={() =>
                        onJump(h.node.doc_id, h.node.page, h.node.id)
                      }
                    >
                      {h.node.title ?? h.node.label} <span>↗</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <footer>
            <button
              className="cross-link"
              onClick={() =>
                onJump(card.source.doc_id, card.source.page, node?.id)
              }
            >
              Jump to source ↗
            </button>
            {node && (
              <button onClick={() => onKnown(node.id)}>
                {known ? "Unmark known" : "Mark known"}
              </button>
            )}
            {!pinned && <button onClick={onPin}>Pin +</button>}
          </footer>
        </>
      )}
    </article>
  );
}
