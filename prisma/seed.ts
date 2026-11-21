import {beachSkillDescriptions} from './skill-descriptions';
import{PrismaClient}from'@prisma/client';const db=new PrismaClient();
const catalog=[{name:'Volleyball',slug:'volleyball',skills:[['Attack','attack',true],['Defense','defense',true],['Passing','passing',true],['Setting','setting',true],['Serving','serving',false]]},{name:'Beach Volleyball',slug:'beach-volleyball',skills:[['Attack','attack',true],['Defense','defense',true],['Passing','passing',true],['Setting','setting',true],['Serving','serving',true]]},{name:'Tennis',slug:'tennis',skills:[['Forehand','forehand',true],['Backhand','backhand',true],['Serve','serve',true]]},{name:'Pickleball',slug:'pickleball',skills:[['Dink','dink',true],['Serve','serve',true],['Volley','volley',true]]}] as const;
async function main(){for(const s of catalog){const sport=await db.sport.upsert({where:{slug:s.slug},create:{name:s.name,slug:s.slug},update:{name:s.name}});if(['volleyball','beach-volleyball'].includes(s.slug)) {
 // Rename the existing rows where possible to retain historical rating links.
 for(const [legacy,slug] of [['bump','passing'],['set','setting'],['spike','attack'],['attacking','attack'],['serve','serving']] as const) {
  const current=await db.skill.findUnique({where:{sportId_slug:{sportId:sport.id,slug}}});
  if(!current) await db.skill.updateMany({where:{sportId:sport.id,slug:legacy},data:{slug}});
 }
 await db.skill.updateMany({where:{sportId:sport.id,slug:{notIn:s.skills.map(([,slug])=>slug)}},data:{active:false}});
}
for(const [name,slug,required]of s.skills){const description=['volleyball','beach-volleyball'].includes(s.slug)?beachSkillDescriptions[slug]:undefined;const skill=await db.skill.upsert({where:{sportId_slug:{sportId:sport.id,slug}},create:{sportId:sport.id,name,slug,requiredForSelfAssessment:required,description},update:{name,requiredForSelfAssessment:required,active:true}});if(description)await db.skill.updateMany({where:{id:skill.id,OR:[{description:null},{description:''}]},data:{description}})}}

}main().catch((error: unknown)=>{
 const code=typeof error==='object'&&error!==null&&'code' in error?error.code:undefined;
 if(code==='P2021') console.error('Seed failed: database tables are missing. Apply migrations with pnpm prisma:deploy before seeding.');
 else console.error('Database seed failed. Check database connectivity and migration status.');
 process.exitCode=1;
}).finally(()=>db.$disconnect());
