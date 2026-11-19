// Loopback-only development emulator. Never deploy or store real sensitive recordings here.
const S3rver=require('s3rver');
const {mkdirSync}=require('node:fs');const {resolve}=require('node:path');
const directory=resolve(process.env.VIDEO_LOCAL_STORAGE_DIR??resolve(__dirname,'../../.video-tmp/local-s3'));mkdirSync(directory,{recursive:true,mode:0o700});
const origin=process.env.VIDEO_LOCAL_FRONTEND_ORIGIN??'http://localhost:3001';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))throw new Error('Local frontend origin required');
const cors=`<CORSConfiguration><CORSRule><AllowedOrigin>${origin}</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader></CORSRule></CORSConfiguration>`;
const server=new S3rver({address:'127.0.0.1',port:4569,directory,silent:false,configureBuckets:[{name:'bvbtips-video-local',configs:[cors]}]});
server.run().then(()=>console.log('Development S3 emulator: http://127.0.0.1:4569 · bucket bvbtips-video-local · credentials S3RVER / S3RVER')).catch(()=>{console.error('Local S3 emulator failed');process.exitCode=1;});
process.on('SIGINT',()=>server.close());process.on('SIGTERM',()=>server.close());
