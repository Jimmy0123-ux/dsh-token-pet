from collections import deque
from pathlib import Path
import json
import sys
import numpy as np
from PIL import Image

path=Path(sys.argv[1]); a=np.array(Image.open(path).convert('RGBA'))[:,:,3]
mask=a>12; h,w=mask.shape; seen=np.zeros((h,w),bool); comps=[]
for sy,sx in zip(*np.where(mask)):
    if seen[sy,sx]: continue
    q=deque([(int(sy),int(sx))]); seen[sy,sx]=True; pts=[]; x0=x1=int(sx); y0=y1=int(sy)
    while q:
        y,x=q.popleft(); pts.append((y,x)); x0=min(x0,x);x1=max(x1,x);y0=min(y0,y);y1=max(y1,y)
        for ny,nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0<=ny<h and 0<=nx<w and mask[ny,nx] and not seen[ny,nx]: seen[ny,nx]=True;q.append((ny,nx))
    comps.append({'area':len(pts),'bbox':[x0,y0,x1+1,y1+1],'width':x1-x0+1,'height':y1-y0+1,'cx':round(sum(x for y,x in pts)/len(pts),1),'cy':round(sum(y for y,x in pts)/len(pts),1)})
comps.sort(key=lambda c:c['area'],reverse=True)
print(json.dumps(comps[:30],indent=2))
