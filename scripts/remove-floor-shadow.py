"""Remove low-chroma floor shadows below a protected coloured boot mask."""
from pathlib import Path
import json
import sys
import numpy as np
from PIL import Image

input_path=Path(sys.argv[1]); output_path=Path(sys.argv[2])
image=np.array(Image.open(input_path).convert('RGBA'),dtype=np.uint8)
rgb=image[:,:,:3].astype(np.int16); alpha=image[:,:,3]; h,w=alpha.shape
y,x=np.indices((h,w)); chroma=rgb.max(axis=2)-rgb.min(axis=2)
# Coloured boot/gold pixels in lower central region.
boot_seed=(alpha>0)&(y>int(h*.72))&(x>int(w*.35))&(x<int(w*.65))&(chroma>22)
protect=boot_seed.copy()
for _ in range(2):
    grown=protect.copy(); grown[1:]|=protect[:-1]; grown[:-1]|=protect[1:]; grown[:,1:]|=protect[:,:-1]; grown[:,:-1]|=protect[:,1:]; protect=grown
bottom=(y>int(h*.88))
shadow=(alpha>0)&bottom&(chroma<=18)&(~protect)
image[shadow]=(0,0,0,0)

# Remove small disconnected remnants in the bottom 12%; upper detached action
# sparkles remain untouched.
from collections import deque
mask=image[:,:,3]>12
seen=np.zeros((h,w),dtype=bool)
removed_components=0
removed_component_pixels=0
for sy,sx in zip(*np.where(mask)):
    if seen[sy,sx]:
        continue
    queue=deque([(int(sy),int(sx))]); seen[sy,sx]=True; pixels=[]; min_y=int(sy)
    while queue:
        cy,cx=queue.popleft(); pixels.append((cy,cx)); min_y=min(min_y,cy)
        for ny,nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
            if 0<=ny<h and 0<=nx<w and mask[ny,nx] and not seen[ny,nx]:
                seen[ny,nx]=True; queue.append((ny,nx))
    if min_y>int(h*.88) and len(pixels)<5000:
        for py,px in pixels:
            image[py,px]=(0,0,0,0)
        removed_components+=1; removed_component_pixels+=len(pixels)

Image.fromarray(image,'RGBA').save(output_path,optimize=True)
report={'input':str(input_path),'output':str(output_path),'bootSeedPixels':int(boot_seed.sum()),'removedShadowPixels':int(shadow.sum()),'removedBottomComponents':removed_components,'removedBottomComponentPixels':removed_component_pixels}
output_path.with_suffix('.shadow.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
