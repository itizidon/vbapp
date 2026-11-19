"""Download a pinned public MediaPipe model and verify its exact checksum."""
import hashlib,pathlib,urllib.request
root=pathlib.Path(__file__).resolve().parent/'models';root.mkdir(exist_ok=True)
path=root/'pose_landmarker_full.task'
sha='5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1'
if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=sha:
 request=urllib.request.Request('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task')
 with urllib.request.urlopen(request,timeout=60) as response:data=response.read(16000000)
 if hashlib.sha256(data).hexdigest()!=sha:raise RuntimeError('Model checksum mismatch')
 path.write_bytes(data)
print('Verified MediaPipe Pose Landmarker full float16 v1:',sha)
