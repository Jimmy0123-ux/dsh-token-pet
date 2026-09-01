"""Convert a white-background video to transparent WebM.
Pipeline: ffmpeg extract frames -> Python flood-fill background -> ffmpeg encode WebM VP9+alpha.
Usage: python video_to_transparent.py <input.mp4> <output.webm> [--max-bg-dist 50] [--feather 3]"""
from pathlib import Path
import subprocess, json, sys, tempfile, shutil
import numpy as np
from PIL import Image
from collections import deque

def probe(video):
    cmd = ['ffprobe','-v','error','-select_streams','v:0',
           '-show_entries','stream=r_frame_rate,nb_frames,duration','-of','json',str(video)]
    d = json.loads(subprocess.run(cmd,capture_output=True,text=True,timeout=60).stdout)['streams'][0]
    num,den = d['r_frame_rate'].split('/'); fps=float(num)/float(den)
    n=int(d.get('nb_frames') or 0); dur=float(d.get('duration') or 0)
    if not n and dur: n=int(dur*fps)
    return fps,n,dur

def remove_bg(arr, bg_color, hard=50, feather=3):
    h,w=arr.shape[:2]; mask=np.zeros((h,w),dtype=bool); q=deque()
    for x in range(w): q.append((0,x)); q.append((h-1,x))
    for y in range(h): q.append((y,0)); q.append((y,w-1))
    while q:
        r,c=q.popleft()
        if r<0 or r>=h or c<0 or c>=w or mask[r,c]: continue
        if np.sqrt(((arr[r,c,:3].astype(float)-bg_color)**2).sum())>hard: continue
        mask[r,c]=True; q.append((r+1,c)); q.append((r-1,c)); q.append((r,c+1)); q.append((r,c-1))
    result=arr.copy(); result[mask,3]=0
    # feather
    dilated=mask.copy()
    for _ in range(feather):
        up=np.roll(dilated,1,0); dn=np.roll(dilated,-1,0); lt=np.roll(dilated,1,1); rt=np.roll(dilated,-1,1)
        dilated=dilated|up|dn|lt|rt
    zone=dilated & ~mask
    if np.any(zone):
        fy,fx=np.where(zone)
        for y,x in zip(fy,fx):
            dist=np.sqrt(((arr[y,x,:3].astype(float)-bg_color)**2).sum())
            result[y,x,3]=max(int(result[y,x,3]),min(255,int(255*dist/30)))
    return result

def convert(input_mp4, output_webm, max_bg_dist=50, feather=3):
    fps,n,dur=probe(input_mp4)
    print(f'Input: {input_mp4}, fps={fps}, frames={n}, dur={dur:.3f}s')
    tmpdir=Path(tempfile.mkdtemp(prefix='transparent_'))
    try:
        # 1) Extract raw frames
        print('Extracting frames...')
        subprocess.run(['ffmpeg','-y','-v','error','-i',str(input_mp4),
                        str(tmpdir/'raw_%04d.png')],timeout=120)
        frames=sorted(tmpdir.glob('raw_*.png'))
        print(f'  {len(frames)} frames extracted')
        # 2) Detect background from first frame corners
        a0=np.array(Image.open(frames[0]).convert('RGBA'))
        corners=[a0[0,0,:3],a0[0,-1,:3],a0[-1,0,:3],a0[-1,-1,:3]]
        bg=np.mean(corners,axis=0)
        print(f'  Background color: ({bg[0]:.0f},{bg[1]:.0f},{bg[2]:.0f})')
        # 3) Remove background per frame
        print('Removing background...')
        out_frames=tmpdir/'out'
        out_frames.mkdir()
        for i,f in enumerate(frames):
            a=np.array(Image.open(f).convert('RGBA'))
            if i==0:
                alpha_only=np.sum((a[:,:,:3].astype(float)-bg)**2,axis=2)**0.5
            result=remove_bg(a,bg,hard=max_bg_dist,feather=feather)
            Image.fromarray(result.astype(np.uint8),'RGBA').save(out_frames/f'out_{i:04d}.png')
            if i%10==0: print(f'  frame {i}/{len(frames)}')
        print(f'  {len(frames)} transparent frames done')
        # 4) Encode to WebM VP9+alpha
        print('Encoding WebM VP9+alpha...')
        subprocess.run(['ffmpeg','-y','-v','warning',
                        '-framerate',str(fps),
                        '-i',str(out_frames/'out_%04d.png'),
                        '-c:v','libvpx-vp9','-b:v','2M','-auto-alt-ref','0',
                        '-an','-pix_fmt','yuva420p',
                        str(output_webm)],timeout=600)
        sz=Path(output_webm).stat().st_size
        print(f'Output: {output_webm} ({sz//1024}KB)')
        # 5) Verify alpha on frame 0
        subprocess.run(['ffmpeg','-y','-v','error','-i',str(output_webm),
                        '-vf','select=eq(n\\,0)','-frames:v','1',
                        str(tmpdir/'verify.png')],timeout=30)
        va=np.array(Image.open(tmpdir/'verify.png').convert('RGBA'))
        print(f'Verify frame 0: alpha=0 frac: {(va[:,:,3]==0).mean():.4f}')
    finally:
        shutil.rmtree(tmpdir,ignore_errors=True)

if __name__=='__main__':
    inp=Path(sys.argv[1]); out=Path(sys.argv[2])
    convert(inp,out)
