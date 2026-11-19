import sys,pathlib,unittest,math,tempfile,json,subprocess
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from motion import feature_frame,dtw,compare
from pipeline import extract,probe,settings,quality_error,VideoError,FFMPEG
ROOT=pathlib.Path(__file__).resolve().parents[1]
def seq(n=30,delta=0,side='left'):
 return [{'timestampMs':i*100,'features':{f'{side}_knee_angle':{'value':100+40*math.sin(i/(n-1)*math.pi)+delta,'unit':'degrees','confidence':.95},'trunk_inclination':{'value':20+15*math.sin(i/(n-1)*math.pi)+delta,'unit':'degrees','confidence':.9}}} for i in range(n)]
def cp(id='cp',feature='left_knee_angle',**kw):
 return {'id':id,'name':id,'phaseKey':'whole','importance':1,'coachingExplanation':'Compare projected observations.','measurementConfig':{'version':2,'feature':feature,'tolerance':20,'cameras':['SIDE'],'minConfidence':.6},**kw}
def ref(frames,id='ref',**kw):return {'id':id,'version':1,'artifactId':'pose-'+id,'artifact':{'frames':frames},'checkpointIds':['cp','trunk'],**kw}
class AlignmentTests(unittest.TestCase):
 def test_identical(self):self.assertEqual(dtw(seq(),seq(),['left_knee_angle'])['normalizedDistance'],0)
 def test_speed(self):self.assertLess(dtw(seq(30),seq(45),['left_knee_angle'])['normalizedDistance'],.04)
 def test_extreme_warp_rejected(self):self.assertIsNone(dtw(seq(10),seq(100),['left_knee_angle']))
 def test_missing_rejected(self):self.assertIsNone(dtw(seq(),[{'timestampMs':i*100,'features':{}} for i in range(30)],['left_knee_angle']))
 def test_mirror_explicit(self):
  self.assertIsNone(dtw(seq(),seq(side='right'),['left_knee_angle']))
  self.assertEqual(dtw(seq(),seq(side='right'),['left_knee_angle'],mirror=True)['normalizedDistance'],0)
 def test_feature_normalization(self):
  points=[{'x':.3+i*.005,'y':.2+i*.012,'visibility':.95,'presence':.95} for i in range(33)]
  changed=[{**p,'x':p['x']*1.5+.2,'y':p['y']*1.5+.1} for p in points]
  for k,v in feature_frame(points).items():self.assertAlmostEqual(v['value'],feature_frame(changed)[k]['value'],places=5)
 def test_low_confidence_omitted(self):
  points=[{'x':.3+i*.005,'y':.2+i*.012,'visibility':.1,'presence':.95} for i in range(33)]
  self.assertEqual(feature_frame(points),{})
 def test_known_difference_and_aggregation(self):
  player=seq();shifted=seq();same=seq()
  for f in player+same:f['features']['left_knee_angle']['value']=100
  for f in shifted:f['features']['left_knee_angle']['value']=120
  result=compare({'frames':player},[ref(shifted,'a'),ref(same,'b')],[cp(),cp('trunk','trunk_inclination')],{'cameraAngle':'SIDE'})
  self.assertEqual(result['checkpoints'][0]['perReference'][0]['medianAbsoluteDifference'],20)
  self.assertEqual(result['checkpoints'][0]['similarity'],75)
  self.assertEqual(result['overallSimilarity'],87.5)
 def test_one_checkpoint_no_overall(self):self.assertIsNone(compare({'frames':seq()},[ref(seq())],[cp()],{'cameraAngle':'SIDE'})['overallSimilarity'])
 def test_no_references(self):self.assertIsNone(compare({'frames':seq()},[],[cp()],{'cameraAngle':'SIDE'})['overallSimilarity'])
 def test_camera_unsupported(self):self.assertEqual(compare({'frames':seq()},[ref(seq())],[cp()],{'cameraAngle':'FRONT'})['checkpoints'][0]['status'],'NOT_SUPPORTED')
 def test_manual_checkpoint(self):self.assertEqual(compare({'frames':seq()},[ref(seq())],[cp(measurementConfig=None)],{'cameraAngle':'SIDE'})['checkpoints'][0]['status'],'NOT_SUPPORTED')
 def test_unknown_phase(self):self.assertEqual(compare({'frames':seq()},[ref(seq())],[cp(phaseKey='ball-contact')],{'cameraAngle':'SIDE'})['checkpoints'][0]['status'],'NOT_SUPPORTED')
 def test_low_quality_gates(self):
  for args,expected in [((100,0,0,0,0,0,False),'NO_PERSON_DETECTED'),((100,90,90,10,0,0,True),'MULTIPLE_PEOPLE'),((100,100,20,0,0,0,True),'LOW_LANDMARK_COVERAGE'),((100,100,90,0,30,0,True),'BODY_OUT_OF_FRAME'),((100,100,90,0,0,50,True),'ATHLETE_TOO_SMALL'),((100,100,90,0,0,0,False),'INCOMPLETE_ATTEMPT')]:self.assertEqual(quality_error(*args),expected)
class RealVideoTests(unittest.TestCase):
 def test_actual_mediapipe_fixture(self):
  with tempfile.TemporaryDirectory() as d:
   out=pathlib.Path(d)/'pose.json';r=extract(str(ROOT/'fixtures/squat-ccby3.webm'),str(out));self.assertEqual(r['quality']['errorCode'],None)
   artifact=json.loads(out.read_text());self.assertGreater(len(artifact['frames']),50);self.assertGreater(r['quality']['validRatio'],.65)
   self.assertTrue(any(f.get('landmarks') for f in artifact['frames']));self.assertTrue(any(f.get('features') for f in artifact['frames']))
   result=compare(artifact,[ref(artifact['frames'])],[cp(),cp('trunk','trunk_inclination')],{'cameraAngle':'SIDE'})
   self.assertEqual(result['overallSimilarity'],100)
 def test_blank_video_has_no_person(self):
  with tempfile.TemporaryDirectory() as d:
   path=str(pathlib.Path(d)/'blank.mp4');subprocess.run([FFMPEG,'-v','error','-f','lavfi','-i','color=black:s=640x480:r=15','-t','1.5','-c:v','libx264','-threads','1',path],check=True)
   r=extract(path,str(pathlib.Path(d)/'pose.json'));self.assertEqual(r['quality']['errorCode'],'NO_PERSON_DETECTED')
 def test_invalid_video(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'bad.mp4';p.write_text('not a video')
   with self.assertRaises(VideoError):probe(str(p),settings())
 def test_fps_and_duration_and_rotation(self):
  with tempfile.TemporaryDirectory() as d:
   for fps in [15,60]:
    p=str(pathlib.Path(d)/f'{fps}.mp4');subprocess.run([FFMPEG,'-v','error','-f','lavfi','-i',f'color=black:s=640x480:r={fps}','-t','2','-c:v','libx264','-threads','1',p],check=True)
    meta=probe(p,settings());self.assertEqual(meta['frameRate'],fps);self.assertEqual(meta['durationMs'],2000)
   rotated=str(pathlib.Path(d)/'rotated.mp4');subprocess.run([FFMPEG,'-v','error','-display_rotation','90','-i',p,'-c','copy',rotated],check=True)
   meta=probe(rotated,settings());self.assertEqual((meta['width'],meta['height']),(480,640))
   with self.assertRaises(VideoError):probe(p,{**settings(),'maxDurationMs':1000})
if __name__=='__main__':unittest.main()
