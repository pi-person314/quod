"""Reconcile demo anchors with actual PyMuPDF top-left text coordinates."""
from pathlib import Path
import json
import pymupdf as fitz
root=Path(__file__).resolve().parent.parent/'demo'
count=0
for path in root.glob('*.json'):
    data=json.loads(path.read_text(encoding='utf8'))
    pdf=fitz.open(root/data['pdf'])
    for anchor in data['anchors']:
        rects=pdf[anchor['page']-1].search_for(anchor['surface'])
        assert rects, anchor['surface']
        rect=min(rects,key=lambda r:abs(r.y0-anchor['bbox'][1]))
        anchor['bbox']=list(rect)
        count+=1
    path.write_text(json.dumps(data,indent=2),encoding='utf8')
print(f'Anchors reconciled against PyMuPDF text: {count}')
