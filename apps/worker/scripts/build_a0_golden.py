#!/usr/bin/env python3
"""Generate fixtures/golden/analysis-ch3.* and pset4.* with measured PyMuPDF bboxes."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import fitz

REPO = Path(__file__).resolve().parents[3]
GOLDEN = REPO / "fixtures" / "golden"
CORPUS = "00000000-0000-4000-8000-000000000001"
DOC_CH3 = "00000000-0000-4000-8000-000000000011"
DOC_PSET = "00000000-0000-4000-8000-000000000012"

ENT_RANK = "00000000-0000-4000-8000-000000000101"
ENT_DIM = "00000000-0000-4000-8000-000000000102"
ENT_SPEC = "00000000-0000-4000-8000-000000000103"


def _uid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012x}"


def _bbox_for(page: fitz.Page, needle: str) -> list[float]:
    rects = page.search_for(needle, quads=False)
    if not rects:
        # fallback: first line containing substring via dict
        for block in page.get_text("dict")["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block["lines"]:
                t = "".join(s["text"] for s in line["spans"])
                if needle in t:
                    xs, ys = [], []
                    for s in line["spans"]:
                        x0, y0, x1, y1 = s["bbox"]
                        xs.extend([x0, x1])
                        ys.extend([y0, y1])
                    return [min(xs), min(ys), max(xs), max(ys)]
        raise RuntimeError(f"bbox not found for {needle!r} on page {page.number + 1}")
    r = rects[0]
    return [r.x0, r.y0, r.x1, r.y1]


def _write_ch3_pdf(path: Path) -> fitz.Document:
    doc = fitz.open()
    lines_page1 = [
        "Chapter 3 — Linear Maps",
        "",
        "Definition 3.1. A linear map $T: V \\to W$ satisfies $T(u+v)=Tu+Tv$.",
        "",
        "Definition 3.2. $\\ker T = \\{v \\in V : Tv = 0\\}$.",
        "",
        "Definition 3.3. $\\operatorname{im} T = \\{Tv : v \\in V\\}$.",
        "",
        "Theorem 3.4 (Rank-Nullity). Let $T: V \\to W$ be linear with $V$ finite-dimensional. Then",
        "$\\dim \\ker T + \\dim \\operatorname{im} T = \\dim V$.",
        "",
        "Lemma 3.5. For any linear $T$, $\\dim V = \\dim \\ker T + \\dim \\operatorname{im} T$.",
    ]
    lines_page2 = [
        "Proposition 3.6. If $T$ is injective then $\\ker T = \\{0\\}$.",
        "",
        "Theorem 3.7 (Dimension Theorem). For surjective $S: U \\to W$, $\\dim U = \\dim \\ker S + \\dim W$.",
        "",
        "Lemma 3.8. Rank-nullity applies to composition when dimensions match.",
        "",
        "Corollary 3.9. By Theorem 3.4, $\\dim \\ker T \\le \\dim V$.",
        "",
        "Theorem 3.10. Isomorphisms preserve dimension.",
        "",
        "Definition 3.11. The rank of $T$ is $\\dim \\operatorname{im} T$.",
    ]
    lines_page3 = [
        "Lemma 3.12. As above, use the previous lemma for subspaces.",
        "",
        "Theorem 3.22. For linear $T$ on finite-dimensional $V$, rank plus nullity equals $\\dim V$.",
        "",
        "Example 3.13. Let $T: \\mathbb{R}^3 \\to \\mathbb{R}^2$ projection; apply Theorem 3.4.",
        "",
        "Proof. Of Theorem 3.4: extend a basis of $\\ker T$ to a basis of $V$.",
        "",
        "Notation 3.1. Write $\\mathcal{L}(V,W)$ for linear maps $V \\to W$.",
        "",
        "Theorem 3.14 (Spectral). Normal operators on finite inner product spaces admit orthonormal eigenbases.",
    ]
    lines_page4 = [
        "Lemma 3.15. The spectral theorem implies diagonalizability for symmetric matrices.",
        "",
        "Corollary 3.16. By Lemma 3.5 and Theorem 3.7, dimension counts add along short exact sequences.",
        "",
        "Proposition 3.17. Named result: the Rank-Nullity theorem is equivalent to Theorem 3.22.",
        "",
        "Remark. See Theorem 3.14 for the spectral theorem in the complex case.",
        "",
        "Exercise pointer. Problem sets restate Theorem 3.4 as the dimension theorem.",
    ]
    all_pages = [lines_page1, lines_page2, lines_page3, lines_page4]
    for plines in all_pages:
        page = doc.new_page(width=612, height=792)
        y = 72
        for line in plines:
            page.insert_text((72, y), line, fontsize=11, fontname="helv")
            y += 16 if line else 8
    doc.save(path)
    return doc


def _write_pset_pdf(path: Path) -> fitz.Document:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    lines = [
        "Problem Set 4",
        "",
        "Problem 1. State the dimension theorem for a linear map $T: V \\to W$.",
        "",
        "Problem 2. Prove Rank-Nullity for your favorite $T: \\mathbb{R}^n \\to \\mathbb{R}^m$.",
        "",
        "Problem 3. Use the spectral theorem on a symmetric $2\\times 2$ matrix.",
        "",
        "Problem 4. Show $\\dim \\ker T + \\dim \\operatorname{im} T = \\dim V$ without citing labels.",
        "",
        "Problem 5. Let $A$ be normal. Invoke the spectral theorem.",
        "",
        "Problem 6. Explain why Theorem 3.22 and Rank-Nullity name the same fact.",
    ]
    y = 72
    for line in lines:
        page.insert_text((72, y), line, fontsize=11, fontname="helv")
        y += 18 if line else 10
    doc.save(path)
    return doc


def build_ch3_fixture() -> dict:
    pdf_path = GOLDEN / "analysis-ch3.pdf"
    doc = _write_ch3_pdf(pdf_path)
    doc = fitz.open(pdf_path)

    node_specs = [
        ("n01", 1, "definition", "Definition 3.1", "Linear map", ENT_RANK, "Definition 3.1."),
        ("n02", 1, "definition", "Definition 3.2", "Kernel", None, "Definition 3.2."),
        ("n03", 1, "definition", "Definition 3.3", "Image", None, "Definition 3.3."),
        ("n04", 1, "theorem", "Theorem 3.4", "Rank-Nullity", ENT_RANK, "Theorem 3.4 (Rank-Nullity)."),
        ("n05", 1, "lemma", "Lemma 3.5", None, ENT_RANK, "Lemma 3.5."),
        ("n06", 2, "proposition", "Proposition 3.6", None, None, "Proposition 3.6."),
        ("n07", 2, "theorem", "Theorem 3.7", "Dimension Theorem", ENT_DIM, "Theorem 3.7 (Dimension Theorem)."),
        ("n08", 2, "lemma", "Lemma 3.8", None, ENT_RANK, "Lemma 3.8."),
        ("n09", 2, "corollary", "Corollary 3.9", None, None, "Corollary 3.9."),
        ("n10", 2, "theorem", "Theorem 3.10", None, None, "Theorem 3.10."),
        ("n11", 2, "definition", "Definition 3.11", "Rank", None, "Definition 3.11."),
        ("n12", 3, "lemma", "Lemma 3.12", None, None, "Lemma 3.12."),
        ("n13", 3, "theorem", "Theorem 3.22", "Rank-Nullity", ENT_RANK, "Theorem 3.22."),
        ("n14", 3, "example", "Example 3.13", None, None, "Example 3.13."),
        ("n15", 3, "proof", None, "Proof of Theorem 3.4", None, "Proof."),
        ("n16", 3, "notation", "Notation 3.1", None, None, "Notation 3.1."),
        ("n17", 3, "theorem", "Theorem 3.14", "Spectral", ENT_SPEC, "Theorem 3.14 (Spectral)."),
        ("n18", 4, "lemma", "Lemma 3.15", None, ENT_SPEC, "Lemma 3.15."),
        ("n19", 4, "corollary", "Corollary 3.16", None, ENT_DIM, "Corollary 3.16."),
        ("n20", 4, "proposition", "Proposition 3.17", None, ENT_RANK, "Proposition 3.17."),
    ]

    node_ids = [_uid(0x201 + i) for i in range(20)]
    nodes = []

    for i, (key, page_num, kind, label, title, ent, search) in enumerate(node_specs):
        page = doc[page_num - 1]
        bb = _bbox_for(page, search)
        stmt = f"{label or title or kind}: standard statement for demo fixture."
        if key == "n04":
            stmt = "Let $T: V \\to W$ be linear, $\\dim V$ finite. Then $\\dim \\ker T + \\dim \\operatorname{im} T = \\dim V$."
        nodes.append(
            {
                "id": node_ids[i],
                "doc_id": DOC_CH3,
                "kind": kind,
                "label": label,
                "title": title,
                "statement_md": stmt,
                "clauses": [{"id": "i", "text": stmt}],
                "symbols": [{"sym": "T", "role": "linear map"}] if kind != "notation" else [],
                "page": page_num,
                "bbox": bb,
                "entity_id": ent,
                "confidence": 0.95,
            }
        )

    edges = []
    edge_pairs = [
        (0, 1, "uses_notation", "deterministic"),
        (0, 2, "uses_notation", "deterministic"),
        (3, 1, "depends_on", "deterministic"),
        (3, 2, "depends_on", "deterministic"),
        (3, 0, "depends_on", "deterministic"),
        (4, 3, "restates", "heuristic"),
        (5, 1, "depends_on", "deterministic"),
        (6, 1, "depends_on", "deterministic"),
        (6, 2, "depends_on", "deterministic"),
        (7, 3, "depends_on", "deterministic"),
        (8, 3, "depends_on", "deterministic"),
        (9, 6, "depends_on", "heuristic"),
        (10, 2, "uses_notation", "notation"),
        (11, 4, "depends_on", "heuristic"),
        (12, 3, "restates", "deterministic"),
        (13, 3, "depends_on", "deterministic"),
        (14, 3, "depends_on", "deterministic"),
        (15, 0, "uses_notation", "notation"),
        (16, 0, "depends_on", "llm"),
        (17, 16, "depends_on", "deterministic"),
        (18, 4, "depends_on", "deterministic"),
        (18, 6, "depends_on", "deterministic"),
        (19, 12, "restates", "llm"),
        (19, 3, "depends_on", "deterministic"),
        (8, 4, "depends_on", "deterministic"),
        (11, 3, "depends_on", "heuristic"),
        (17, 3, "specialises", "heuristic"),
        (13, 1, "depends_on", "deterministic"),
        (14, 1, "depends_on", "deterministic"),
        (9, 7, "depends_on", "heuristic"),
    ]
    for si, di, ek, ex in edge_pairs:
        edges.append(
            {
                "src": node_ids[si],
                "dst": node_ids[di],
                "kind": ek,
                "extractor": ex,
                "confidence": 0.9,
            }
        )

    anchor_specs = [
        (2, "By Theorem 3.4", "Theorem 3.4", True),
        (2, "Theorem 3.4", "Theorem 3.4", True),
        (3, "Theorem 3.4", "Theorem 3.4", True),
        (3, "the previous lemma", None, False),
        (3, "as above", None, False),
        (4, "Theorem 3.14", "Theorem 3.14", True),
        (4, "Lemma 3.5", "Lemma 3.5", True),
        (4, "Theorem 3.7", "Theorem 3.7", True),
        (4, "Theorem 3.22", "Theorem 3.22", True),
        (4, "the spectral theorem", None, False),
        (4, "Rank-Nullity", None, False),
        (1, "Lemma 3.5", "Lemma 3.5", True),
        (2, "Theorem 3.7", "Theorem 3.7", True),
        (2, "Corollary 3.9", "Corollary 3.9", True),
        (4, "Theorem 3.4", "Theorem 3.4", True),
    ]

    anchors = []
    cards = []
    for i, (page_num, surface, label, explicit) in enumerate(anchor_specs):
        page = doc[page_num - 1]
        needle = label if label else surface.split()[-1]
        try:
            bb = _bbox_for(page, needle if label else surface[:20])
        except RuntimeError:
            bb = [72.0, 200.0 + i * 12, 400.0, 212.0 + i * 12]
        aid = _uid(0x301 + i)
        target = None
        if explicit and label:
            for n in nodes:
                if n["label"] == label:
                    target = n["id"]
                    break
        anchors.append(
            {
                "id": aid,
                "doc_id": DOC_CH3,
                "page": page_num,
                "bbox": bb,
                "surface": surface,
                "target_node_id": target,
                "target_entity_id": ENT_RANK if "Rank" in surface or (label == "Theorem 3.4") else None,
                "card_id": aid.replace("301", "401") if i < 15 else None,
            }
        )
        cid = _uid(0x401 + i)
        anchors[i]["card_id"] = cid
        src_node = next((n for n in nodes if n["id"] == target), nodes[3])
        cards.append(
            {
                "id": cid,
                "anchor_id": aid,
                "headline": f"{src_node.get('title') or src_node.get('label') or 'Result'}",
                "instantiated_md": src_node["statement_md"][:120],
                "full_md": src_node["statement_md"],
                "substitutions": [{"from": "V", "to": "V"}],
                "clause_ids": ["i"],
                "gloss": "Demo fixture card for hover.",
                "source": {"doc_id": DOC_CH3, "page": src_node["page"]},
            }
        )

    entities = [
        {"id": ENT_RANK, "corpus_id": CORPUS, "canonical_node_id": node_ids[3], "name": "Rank-Nullity Theorem"},
        {"id": ENT_DIM, "corpus_id": CORPUS, "canonical_node_id": node_ids[6], "name": "Dimension Theorem"},
        {"id": ENT_SPEC, "corpus_id": CORPUS, "canonical_node_id": node_ids[16], "name": "Spectral Theorem"},
    ]

    doc.close()
    return {
        "document": {
            "id": DOC_CH3,
            "corpus_id": CORPUS,
            "title": "Analysis Chapter 3 (demo)",
            "filename": "analysis-ch3.pdf",
            "file_hash": None,
            "page_count": 4,
            "quality": 0.95,
            "status": "ready",
        },
        "pdf": "analysis-ch3.pdf",
        "nodes": nodes,
        "edges": edges,
        "anchors": anchors,
        "cards": cards,
        "entities": entities,
    }


def build_pset_fixture(ch3: dict) -> dict:
    pdf_path = GOLDEN / "pset4.pdf"
    _write_pset_pdf(pdf_path)
    doc = fitz.open(pdf_path)
    page = doc[0]

    ch3_by_ent = {e["id"]: e for e in ch3["entities"]}
    rn_node = ch3["nodes"][3]["id"]
    dim_node = ch3["nodes"][6]["id"]
    spec_node = ch3["nodes"][16]["id"]

    pset_nodes = [
        (_uid(0x501), "Problem 1", "theorem", "the dimension theorem", ENT_DIM, "Problem 1."),
        (_uid(0x502), "Problem 2", "theorem", "Rank-Nullity", ENT_RANK, "Problem 2."),
        (_uid(0x503), "Problem 3", "theorem", "spectral theorem", ENT_SPEC, "Problem 3."),
        (_uid(0x504), "Problem 4", "lemma", None, ENT_RANK, "Problem 4."),
        (_uid(0x505), "Problem 5", "proposition", None, ENT_SPEC, "Problem 5."),
        (_uid(0x506), "Problem 6", "example", "Theorem 3.22", ENT_RANK, "Problem 6."),
    ]

    nodes = []
    for nid, label, kind, title, ent, search in pset_nodes:
        bb = _bbox_for(page, search)
        nodes.append(
            {
                "id": nid,
                "doc_id": DOC_PSET,
                "kind": kind,
                "label": label,
                "title": title if title else None,
                "statement_md": f"Pset restatement of {title or label}.",
                "clauses": [],
                "symbols": [],
                "page": 1,
                "bbox": bb,
                "entity_id": ent,
                "confidence": 0.9,
            }
        )

    edges = [
        {"src": nodes[0]["id"], "dst": dim_node, "kind": "restates", "extractor": "llm", "confidence": 0.85},
        {"src": nodes[1]["id"], "dst": rn_node, "kind": "restates", "extractor": "llm", "confidence": 0.85},
        {"src": nodes[2]["id"], "dst": spec_node, "kind": "restates", "extractor": "llm", "confidence": 0.85},
        {"src": nodes[3]["id"], "dst": rn_node, "kind": "depends_on", "extractor": "heuristic", "confidence": 0.8},
        {"src": nodes[5]["id"], "dst": rn_node, "kind": "restates", "extractor": "deterministic", "confidence": 0.9},
    ]

    doc.close()
    return {
        "document": {
            "id": DOC_PSET,
            "corpus_id": CORPUS,
            "title": "Problem Set 4",
            "filename": "pset4.pdf",
            "file_hash": None,
            "page_count": 1,
            "quality": 0.95,
            "status": "ready",
        },
        "pdf": "pset4.pdf",
        "nodes": nodes,
        "edges": edges,
        "anchors": [],
        "cards": [],
        "entities": [],
    }


def main() -> None:
    GOLDEN.mkdir(parents=True, exist_ok=True)
    ch3 = build_ch3_fixture()
    pset = build_pset_fixture(ch3)
    (GOLDEN / "analysis-ch3.json").write_text(json.dumps(ch3, indent=2) + "\n", encoding="utf-8")
    (GOLDEN / "pset4.json").write_text(json.dumps(pset, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {GOLDEN}/analysis-ch3.json: {len(ch3['nodes'])} nodes, {len(ch3['edges'])} edges")
    print(f"Wrote {GOLDEN}/pset4.json: {len(pset['nodes'])} nodes")


if __name__ == "__main__":
    main()
