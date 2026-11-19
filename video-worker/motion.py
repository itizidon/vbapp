"""Deterministic 2D feature/alignment MVP. Scores are experimental similarity, not correctness."""
import math
import numpy as np

FEATURE_VERSION = "image-plane-features-v1"
COMPARISON_VERSION = "confidence-dtw-v1"
# MediaPipe's named anatomical indices. No facial recognition is performed.
INDEX = {"left_shoulder":11,"right_shoulder":12,"left_elbow":13,"right_elbow":14,"left_wrist":15,"right_wrist":16,"left_hip":23,"right_hip":24,"left_knee":25,"right_knee":26,"left_ankle":27,"right_ankle":28,"left_heel":29,"right_heel":30,"left_foot_index":31,"right_foot_index":32}
FEATURES = {
 "left_elbow_angle": ("degrees",[11,13,15]), "right_elbow_angle":("degrees",[12,14,16]),
 "left_knee_angle":("degrees",[23,25,27]),"right_knee_angle":("degrees",[24,26,28]),
 "trunk_inclination":("degrees",[11,12,23,24]),"platform_wrist_height":("normalized",[11,12,15,16,23,24]),
}

def feature_frame(landmarks, threshold=.6):
    p=np.asarray([[l['x'],l['y']] for l in landmarks],dtype=float)
    q=np.asarray([min(l.get('visibility',0),l.get('presence',0)) for l in landmarks])
    hip=(p[23]+p[24])/2; shoulder=(p[11]+p[12])/2
    scale=float(np.linalg.norm(shoulder-hip))
    if scale<.025:return {}
    normalized=(p-hip)/scale
    out={}
    for name,(unit,ids) in FEATURES.items():
        confidence=float(min(q[ids]))
        if confidence<threshold:continue
        if len(ids)==3:
            a,b,c=normalized[ids];u=a-b;v=c-b;den=float(np.linalg.norm(u)*np.linalg.norm(v))
            if den<1e-7:continue
            value=math.degrees(math.acos(float(np.clip(np.dot(u,v)/den,-1,1))))
        elif name=='trunk_inclination':
            d=shoulder-hip;value=math.degrees(math.atan2(abs(float(d[0])),abs(float(d[1]))))
        else:value=float((normalized[15,1]+normalized[16,1])/2-(normalized[11,1]+normalized[12,1])/2)
        out[name]={'value':value,'confidence':confidence,'unit':unit}
    return out

def mirrored_feature(name):
    if name.startswith('left_'):return 'right_'+name[5:]
    if name.startswith('right_'):return 'left_'+name[6:]
    return name

def dtw(player, reference, feature_names, max_warp=.25, min_confidence=.6, mirror=False):
    """Slope-constrained normalized-time band; missing features are not imputed."""
    n,m=len(player),len(reference)
    if n<6 or m<6 or n/m>2.5 or m/n>2.5:return None
    costs=np.full((n,m),np.inf);prev={}
    for i in range(n):
        for j in range(m):
            if abs(i/(n-1)-j/(m-1))>max_warp:continue
            terms=[]
            for f in feature_names:
                a=player[i]['features'].get(f);b=reference[j]['features'].get(mirrored_feature(f) if mirror else f)
                if not a or not b or min(a['confidence'],b['confidence'])<min_confidence:continue
                # Alignment uses a fixed versioned dimension scale, not checkpoint scoring tolerance.
                unit_scale=180 if a['unit']=='degrees' else 2
                terms.append((abs(a['value']-b['value'])/unit_scale,min(a['confidence'],b['confidence'])))
            if len(terms)<max(1,math.ceil(len(feature_names)*.5)):continue
            local=sum(d*w for d,w in terms)/sum(w for _,w in terms)
            if i==0 and j==0:costs[i,j]=local;continue
            # (1,1),(1,2),(2,1) prevent long repeated-frame stretches.
            candidates=[]
            for di,dj in [(1,1),(1,2),(2,1)]:
                pi,pj=i-di,j-dj
                if pi>=0 and pj>=0 and math.isfinite(costs[pi,pj]):candidates.append((costs[pi,pj]+local*(di+dj)/2+(.025 if di!=dj else 0),pi,pj))
            if candidates:
                best=min(candidates);costs[i,j]=best[0];prev[i,j]=(best[1],best[2])
    if not math.isfinite(costs[-1,-1]):return None
    path=[];at=(n-1,m-1)
    while True:
        path.append(at)
        if at==(0,0):break
        if at not in prev:return None
        at=prev[at]
    path.reverse()
    coverage=len(set(i for i,j in path))/n
    warp_ratio=sum(1 for a,b in zip(path,path[1:]) if b[0]-a[0]!=b[1]-a[1])/max(1,len(path)-1)
    normalized_cost=float(costs[-1,-1]/((n+m)/2))
    if coverage<.5 or normalized_cost>.35 or warp_ratio>.6:return None
    return {'path':path,'normalizedDistance':normalized_cost,'playerCoverage':coverage,'warpFraction':warp_ratio,
            'timestampMap':[{'playerMs':player[i]['timestampMs'],'referenceMs':reference[j]['timestampMs']} for i,j in path]}

def active_window(frames):
    # Baseline is an activity envelope, not automatic identification of ball contact/takeoff.
    valid=[f for f in frames if f.get('features')]
    if len(valid)<6:return None
    series=[]
    for a,b in zip(valid,valid[1:]):
        ds=[abs(a['features'][k]['value']-b['features'][k]['value'])/(180 if a['features'][k]['unit']=='degrees' else 2) for k in a['features'].keys()&b['features'].keys()]
        series.append(float(np.mean(ds)) if ds else 0)
    if not series or max(series)<.003:return None
    threshold=max(.003,float(np.quantile(series,.4)))
    indices=[i for i,v in enumerate(series) if v>=threshold]
    start=max(0,min(indices)-2);end=min(len(valid)-1,max(indices)+3)
    return (valid[start]['timestampMs'],valid[end]['timestampMs'])

def compare(player, refs, checkpoints, config):
    allowed=config.get('cameraAngle');motion=config.get('motionConfig') or {}
    windows={w['key']:(w['startRatio'],w['endRatio']) for w in motion.get('phaseWindows',[])}
    p_active=active_window(player['frames'])
    results=[];per_ref=[]
    supported=[c for c in checkpoints if (c.get('measurementConfig') or {}).get('version')==2]
    names=sorted({c['measurementConfig']['feature'] for c in supported if c['measurementConfig'].get('feature') in FEATURES})
    limitations=['Single uncalibrated camera: projected 2D movement only, not 3D biomechanics or a correctness percentage.',
                 'Phase windows are coach-configured portions of an activity envelope; ball contact/takeoff are not automatically detected.',
                 'Similarity tolerances are configurable engineering heuristics, not clinically or statistically calibrated thresholds.']
    alignments={}
    if not p_active:return {'checkpoints':[], 'references':[], 'overallSimilarity':None,'limitations':limitations+['No sufficiently complete movement interval detected.']}
    pf=[f for f in player['frames'] if p_active[0]<=f['timestampMs']<=p_active[1] and f.get('features')]
    for ref in refs:
        artifact=ref['artifact'];ra=active_window(artifact['frames'])
        rf=[f for f in artifact['frames'] if ra and ra[0]<=f['timestampMs']<=ra[1] and f.get('features')]
        alignment=dtw(pf,rf,names,min_confidence=config.get('minConfidence',.6),mirror=ref.get('mirrored',False))
        alignments[ref['id']]=(alignment,rf,ref)
    for c in checkpoints:
        mc=c.get('measurementConfig') or {};feature=mc.get('feature');phase=mc.get('phaseKey',c.get('phaseKey','whole'))
        item={'checkpointId':c['id'],'name':c['name'],'status':'NOT_SUPPORTED','similarity':None,'quality':None,'evidence':[], 'explanation':c.get('coachingExplanation',''), 'limitations':[],'perReference':[]}
        if mc.get('version')!=2 or feature not in FEATURES:
            item['limitations']=['This checkpoint has no implemented version-2 measurement definition.'];results.append(item);continue
        if allowed not in mc.get('cameras',[]):
            item['limitations']=['This camera angle is not approved for this projected feature.'];results.append(item);continue
        window=(0,1) if phase=='whole' else windows.get(phase)
        if mc.get('phaseWindow'):window=(mc['phaseWindow']['startRatio'],mc['phaseWindow']['endRatio'])
        if not window:
            item['limitations']=['The configured movement phase cannot be located reliably.'];results.append(item);continue
        tol=mc['tolerance'];min_q=mc.get('minConfidence',.65);scores=[];evidence=[]
        for ref_id,(alignment,rf,ref) in alignments.items():
            if not alignment:continue
            if c['id'] not in ref.get('checkpointIds',[]):continue
            rows=[]
            for i,j in alignment['path']:
                ratio=(pf[i]['timestampMs']-p_active[0])/max(1,p_active[1]-p_active[0])
                if not window[0]<=ratio<=window[1]:continue
                a=pf[i]['features'].get(feature);b=rf[j]['features'].get(mirrored_feature(feature) if ref.get('mirrored') else feature)
                if not a or not b or min(a['confidence'],b['confidence'])<min_q:continue
                rows.append({'playerMs':pf[i]['timestampMs'],'referenceMs':rf[j]['timestampMs'],'playerValue':a['value'],'referenceValue':b['value'],'difference':a['value']-b['value'],'quality':min(a['confidence'],b['confidence'])})
            if len(rows)<3:continue
            difference=float(np.median([abs(r['difference']) for r in rows]));score=max(0.,100*(1-difference/(2*tol)))
            # Evidence is a real aligned pair close to the median absolute difference, not an invented instant.
            ev=min(rows,key=lambda r:abs(abs(r['difference'])-difference));ev={**ev,'referenceVideoId':ref_id,'feature':feature,'unit':FEATURES[feature][0]}
            scores.append(score);evidence.append(ev)
            item['perReference'].append({'referenceVideoId':ref_id,'similarity':round(score,2),'medianAbsoluteDifference':difference,'unit':FEATURES[feature][0], 'sampleCount':len(rows),'alignmentQuality':{k:v for k,v in alignment.items() if k not in ['path','timestampMap']},'mirrored':ref.get('mirrored',False)})
        if not scores:item.update(status='INSUFFICIENT_DATA',limitations=['Not enough confidently tracked aligned samples.'])
        else:
            item.update(status='EVALUATED',similarity=round(float(np.median(scores)),2),quality=round(float(np.mean([e['quality'] for e in evidence])),4),evidence=evidence,
                        limitations=['Differences are projected observations and may be valid physical adaptations; they do not establish an error or cause.'])
        results.append(item)
    for ref in refs:
        scores=[c['similarity'] for item in results for c in item['perReference'] if c['referenceVideoId']==ref['id']]
        per_ref.append({'referenceVideoId':ref['id'],'referenceVersion':ref['version'],'poseArtifactId':ref['artifactId'],'similarity':round(float(np.median(scores)),2) if scores else None,'evaluatedCheckpoints':len(scores),'mirrored':ref.get('mirrored',False),'timestampMap':alignments[ref['id']][0]['timestampMap'] if alignments[ref['id']][0] else [],'alignmentAvailable':bool(alignments[ref['id']][0])})
    usable=[(r,c) for r,c in zip(results,checkpoints) if r['status']=='EVALUATED' and c.get('importance',1)>0]
    overall=round(sum(r['similarity']*c.get('importance',1) for r,c in usable)/sum(c.get('importance',1) for r,c in usable),2) if len(usable)>=config.get('minOverallCheckpoints',2) else None
    return {'algorithmVersion':COMPARISON_VERSION,'featureVersion':FEATURE_VERSION,'checkpoints':results,'references':per_ref,'overallSimilarity':overall,'scoreLabel':'Experimental movement similarity','aggregation':'Median per-checkpoint similarity across every compatible reference, then importance-weighted mean across at least two evaluated checkpoints. No best-reference cherry-picking.','limitations':limitations}
