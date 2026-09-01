import numpy as np, pathlib, json
from PIL import Image

ACTIONS = ['idle','working','eating','digesting','warning','evolve','click','archive','tool-success','tool-failure','prompt-enhancing','prompt-ready']
out = pathlib.Path(r'H:\ds\dsh-token-pet\Review\h3-actions')

results = {}
ref_bh = None
for action in ACTIONS:
    strip_path = out / action / f'{action}-transparent-strip.png'
    if not strip_path.exists():
        print(action + ': NO STRIP'); continue
    strip = Image.open(strip_path).convert('RGBA')
    w, h = strip.size
    # frames: strip_width / frame_height (since frames are square 1024x1024 → nf = strip_w/1024)
    nf = round(w / h)
    fw = w // nf
    print(action + ': strip=' + str(w) + 'x' + str(h) + ', frames=' + str(nf) + ', cell=' + str(fw) + 'x' + str(h))
    ux0,uy0,ux1,uy1 = 9999,9999,0,0
    for i in range(nf):
        frame = strip.crop((i*fw, 0, (i+1)*fw, h))
        a = np.array(frame)[:,:,3]
        ys,xs = np.where(a > 16)
        if len(xs)==0: continue
        ux0=min(ux0,int(xs.min())); uy0=min(uy0,int(ys.min()))
        ux1=max(ux1,int(xs.max()+1)); uy1=max(uy1,int(ys.max()+1))
    bw,bh = ux1-ux0, uy1-uy0
    print('  union bbox: ('+str(ux0)+','+str(uy0)+')-('+str(ux1)+','+str(uy1)+'), size '+str(bw)+'x'+str(bh))
    results[action] = {'bw':bw,'bh':bh,'nf':nf,'fw':fw,'fh':h}
    if ref_bh is None:
        ref_bh = bh
    else:
        print('  vs idle body height ratio: ' + str(round(bh/ref_bh,3)))

print()
print('=== SUMMARY ===')
for a,r in results.items():
    fw,fh,bw,bh,nf = r['fw'],r['fh'],r['bw'],r['bh'],r['nf']
    print(a.ljust(16) + ' cell=' + str(fw) + 'x' + str(fh) +
          ' content=' + str(bw) + 'x' + str(bh) +
          ' ratio=' + str(round(bw/bh,3)) +
          ' nf=' + str(nf))
