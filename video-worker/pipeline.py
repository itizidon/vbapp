"""CPU worker subprocess. Accepts only worker-generated local paths and bounded JSON configuration."""
import os,sys,json,subprocess,pathlib,hashlib,time,resource,math
os.environ.setdefault('OMP_NUM_THREADS','1');os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
import numpy as np
from motion import feature_frame,active_window,FEATURE_VERSION,compare
ROOT=pathlib.Path(__file__).resolve().parent.parent
FFMPEG=os.environ.get('VIDEO_FFMPEG',str(ROOT/'.video-tools/usr/bin/ffmpeg') if (ROOT/'.video-tools/usr/bin/ffmpeg').exists() else 'ffmpeg')
FFPROBE=os.environ.get('VIDEO_FFPROBE',str(ROOT/'.video-tools/usr/bin/ffprobe') if (ROOT/'.video-tools/usr/bin/ffprobe').exists() else 'ffprobe')
MODEL=pathlib.Path(os.environ.get('VIDEO_POSE_MODEL',str(ROOT/'video-worker/models/pose_landmarker_full.task')))
MODEL_SHA='5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1'
EXTRACTION_VERSION='pose-video-extraction-v1'
class VideoError(Exception):
 def __init__(self,code):self.code=code

def run(cmd,timeout=15):
 try:return subprocess.run(cmd,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout).stdout
 except subprocess.TimeoutExpired:raise VideoError('PROCESSING_TIMEOUT')
 except subprocess.CalledProcessError:raise VideoError('INVALID_VIDEO')

def settings():
 return {'fps':int(os.environ.get('VIDEO_SAMPLE_FPS','10')),'minVisibility':float(os.environ.get('VIDEO_MIN_VISIBILITY','.6')),'minValidRatio':float(os.environ.get('VIDEO_MIN_VALID_RATIO','.65')),'maxDurationMs':int(os.environ.get('VIDEO_MAX_DURATION_MS','30000')),'maxBytes':int(os.environ.get('TRAINING_MAX_VIDEO_BYTES',str(100*1024*1024))),'maxPixels':3840*2160}

def probe(path,config):
 p=pathlib.Path(path)
 if not p.is_file() or p.is_symlink() or p.stat().st_size>config['maxBytes']:raise VideoError('INVALID_VIDEO_SIZE')
 raw=json.loads(run([FFPROBE,'-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm','-show_format','-show_streams','-of','json',str(p)]))
 streams=[s for s in raw.get('streams',[]) if s.get('codec_type')=='video']
 if len(streams)!=1:raise VideoError('UNSUPPORTED_VIDEO_STREAMS')
 v=streams[0];duration=float(v.get('duration') or raw.get('format',{}).get('duration') or 0);w=v.get('width',0);h=v.get('height',0)
 if not math.isfinite(duration) or duration<1 or duration*1000>config['maxDurationMs']:raise VideoError('INVALID_VIDEO_DURATION')
 if w<64 or h<64 or w*h>config['maxPixels']:raise VideoError('UNSUPPORTED_RESOLUTION')
 codec=v.get('codec_name');formats=raw.get('format',{}).get('format_name','')
 if codec not in ['h264','hevc','vp8','vp9','av1'] or not any(f in formats.split(',') for f in ['mov','mp4','matroska','webm']):raise VideoError('UNSUPPORTED_VIDEO_FORMAT')
 rate=v.get('avg_frame_rate','0/1').split('/');fps=float(rate[0])/max(1,float(rate[1]))
 if not 1<=fps<=120:raise VideoError('UNSUPPORTED_FRAME_RATE')
 rotation=next((int(s.get('rotation',0)) for s in v.get('side_data_list',[]) if 'rotation' in s),0)%360
 if rotation not in [0,90,180,270]:raise VideoError('UNSUPPORTED_ORIENTATION')
 sha=hashlib.sha256(p.read_bytes()).hexdigest()
 return {'durationMs':round(duration*1000),'width':h if rotation in [90,270] else w,'height':w if rotation in [90,270] else h,'frameRate':fps,'bytes':p.stat().st_size,'mimeType':'video/webm' if 'webm' in formats else 'video/mp4','codec':codec,'rotation':rotation,'sourceHash':sha}

def health():
 import mediapipe as mp
 if not MODEL.is_file() or hashlib.sha256(MODEL.read_bytes()).hexdigest()!=MODEL_SHA:raise VideoError('MODEL_ASSET_INVALID')
 config=settings()
 if not 3<=config['fps']<=20 or not .3<=config['minVisibility']<=.95 or not .5<=config['minValidRatio']<=1 or not 1000<=config['maxDurationMs']<=60000:raise VideoError('PROCESSING_CONFIG_INVALID')
 # Instantiate the real CPU model before advertising worker availability.
 options=mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(MODEL),delegate=mp.tasks.BaseOptions.Delegate.CPU),running_mode=mp.tasks.vision.RunningMode.VIDEO,num_poses=2)
 with mp.tasks.vision.PoseLandmarker.create_from_options(options):pass
 return {'modelVersion':f'mediapipe-{mp.__version__}:{MODEL_SHA[:16]}','modelSha256':MODEL_SHA,'extractionVersion':EXTRACTION_VERSION,'featureVersion':FEATURE_VERSION,'config':config,'ffmpegVersion':run([FFMPEG,'-version']).decode().splitlines()[0]}

def quality_error(total,detected,valid,multiple,clipped,small,active,min_ratio=.65):
 if multiple/max(1,total)>.05:return 'MULTIPLE_PEOPLE'
 if detected==0:return 'NO_PERSON_DETECTED'
 if small/max(1,total)>.35:return 'ATHLETE_TOO_SMALL'
 if clipped/max(1,total)>.2:return 'BODY_OUT_OF_FRAME'
 if valid/max(1,total)<min_ratio:return 'LOW_LANDMARK_COVERAGE'
 if not active:return 'INCOMPLETE_ATTEMPT'
 return None

def extract(path,out_path):
 import mediapipe as mp
 config=settings();meta=probe(path,config)
 if hashlib.sha256(MODEL.read_bytes()).hexdigest()!=MODEL_SHA:raise VideoError('MODEL_ASSET_INVALID')
 fps=config['fps'];size=640;command=[FFMPEG,'-nostdin','-v','error','-threads','1','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm','-i',path,'-an','-sn','-dn','-vf',f'setpts=PTS-STARTPTS,fps={fps}:start_time=0,scale={size}:{size}:force_original_aspect_ratio=decrease,pad={size}:{size}:(ow-iw)/2:(oh-ih)/2','-frames:v',str(math.ceil(meta['durationMs']/1000*fps)),'-threads','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
 proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 frames=[];valid=0;detected=0;multiple=0;clipped=0;small=0;essential=[11,12,23,24,25,26,27,28,29,30,31,32]
 options=mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(MODEL),delegate=mp.tasks.BaseOptions.Delegate.CPU),running_mode=mp.tasks.vision.RunningMode.VIDEO,num_poses=2,min_pose_detection_confidence=.5,min_tracking_confidence=.5)
 started=time.monotonic()
 try:
  with mp.tasks.vision.PoseLandmarker.create_from_options(options) as model:
   for idx in range(math.ceil(meta['durationMs']/1000*fps)):
    if time.monotonic()-started>100:raise VideoError('PROCESSING_TIMEOUT')
    data=proc.stdout.read(size*size*3)
    if not data:break
    if len(data)!=size*size*3:raise VideoError('INVALID_VIDEO')
    image=mp.Image(image_format=mp.ImageFormat.SRGB,data=np.frombuffer(data,dtype=np.uint8).reshape(size,size,3))
    timestamp=round(idx*1000/fps);result=model.detect_for_video(image,timestamp)
    frame={'timestampMs':timestamp,'detected':len(result.pose_landmarks)==1,'features':{}}
    if len(result.pose_landmarks)>1:multiple+=1
    if len(result.pose_landmarks)==1:
     detected+=1;points=[{'x':float(p.x),'y':float(p.y),'z':float(p.z),'visibility':float(p.visibility),'presence':float(p.presence)} for p in result.pose_landmarks[0]]
     frame['landmarks']=points
     frame['worldLandmarks']=[{'x':float(p.x),'y':float(p.y),'z':float(p.z),'visibility':float(p.visibility)} for p in result.pose_world_landmarks[0]]
     visible=all(min(points[i]['visibility'],points[i]['presence'])>=config['minVisibility'] for i in [11,12,23,24]) and any(all(min(points[i]['visibility'],points[i]['presence'])>=config['minVisibility'] for i in leg) for leg in [[25,27,29,31],[26,28,30,32]])
     contained=all(.005<points[i]['x']<.995 and .005<points[i]['y']<.995 for i in essential)
     body_height=max(points[i]['y'] for i in essential)-min(points[i]['y'] for i in essential)
     if not contained:clipped+=1
     if body_height<.25:small+=1
     if visible and contained and body_height>=.25:
      frame['features']=feature_frame(points,config['minVisibility']);valid+=1
    if frames and frame.get('features'):
     dt=(timestamp-frames[-1]['timestampMs'])/1000
     if 0<dt<=.35:
      frame['angularVelocities']={k:{'value':(v['value']-frames[-1]['features'][k]['value'])/dt,'unit':'degrees_per_second','confidence':min(v['confidence'],frames[-1]['features'][k]['confidence'])} for k,v in frame['features'].items() if v['unit']=='degrees' and k in frames[-1]['features']}
    frames.append(frame)
  proc.wait(timeout=10)
  if proc.returncode!=0:raise VideoError('INVALID_VIDEO')
 finally:
  if proc.poll() is None:proc.kill();proc.wait()
 if not frames:raise VideoError('INVALID_VIDEO')
 warnings=[];error=None
 error=quality_error(len(frames),detected,valid,multiple,clipped,small,bool(active_window(frames)),config['minValidRatio'])
 if valid/len(frames)<.9:warnings.append('Some frames have missing/occluded joints; only reliable samples are measured.')
 warnings+=['Uncalibrated single-view image-plane measurements; estimated world coordinates are stored but not treated as calibrated biomechanics.','Single intended repetition required; trim setup and extra repetitions before upload.']
 artifact={'schemaVersion':1,'modelVersion':f'mediapipe-{mp.__version__}:{MODEL_SHA[:16]}','modelSha256':MODEL_SHA,'extractionVersion':EXTRACTION_VERSION,'featureVersion':FEATURE_VERSION,'coordinateSystem':{'space':'LETTERBOXED_NORMALIZED_IMAGE','units':'normalized','orientation':'FFmpeg autorotated upright','frameSize':[size,size]},'samplingFps':fps,'metadata':meta,'quality':{'processedFrames':len(frames),'detectedFrames':detected,'validFrames':valid,'validRatio':valid/len(frames),'multiplePersonFrames':multiple,'clippedFrames':clipped,'smallAthleteFrames':small,'warnings':warnings,'errorCode':error},'frames':frames}
 pathlib.Path(out_path).write_text(json.dumps(artifact,separators=(',',':'),allow_nan=False))
 return {k:v for k,v in artifact.items() if k!='frames'}

def main():
 request=json.load(sys.stdin);command=request['command']
 resource.setrlimit(resource.RLIMIT_CPU,(120,125));resource.setrlimit(resource.RLIMIT_FSIZE,(32*1024*1024,32*1024*1024))
 if command=='health':return health()
 if command=='probe':return probe(request['path'],settings())
 if command=='extract':return extract(request['path'],request['outputPath'])
 if command=='compare':
  player=json.loads(pathlib.Path(request['playerPath']).read_text());refs=[{**r,'artifact':json.loads(pathlib.Path(r['path']).read_text())} for r in request['references']]
  return compare(player,refs,request['checkpoints'],request['config'])
 raise VideoError('UNKNOWN_OPERATION')
if __name__=='__main__':
 try:print(json.dumps({'ok':True,'value':main()},allow_nan=False,separators=(',',':')))
 except VideoError as e:print(json.dumps({'ok':False,'errorCode':e.code}));sys.exit(2)
 except Exception:print(json.dumps({'ok':False,'errorCode':'VIDEO_PROCESSING_FAILED'}));sys.exit(3)
