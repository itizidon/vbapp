import { BadRequestException } from '@nestjs/common';
import { DashboardService, summarizeDays } from '../src/analytics/dashboard.service';
const game=(score:number|null,opponent:number|null,date='2026-11-08T15:00:00Z')=>({playedAt:new Date(date),teams:[{id:'mine',score},{id:'other',score:opponent}],participants:[{teamId:'mine'}]});
it('computes daily win rates with zero scores and ignores ties, missing scores, and unassigned players',()=>{
 const games=[game(21,0),game(0,21),game(21,21),game(null,21),{...game(21,0),participants:[{teamId:null}]}];
 const result=summarizeDays(games,[],'UTC');
 expect(result.wins).toBe(1);expect(result.losses).toBe(1);
 expect(result.points).toEqual([{date:'2026-11-08',winRate:50,wins:1,losses:1,ratings:[]}]);
});
it('groups games by local day and preserves arbitrary backend category IDs',()=>{
 const result=summarizeDays([game(21,0,'2026-11-08T02:00:00Z')],[{date:'2026-11-07',skillId:'new-category',average:4.5,count:2n}],'America/New_York');
 expect(result.points[0]).toEqual({date:'2026-11-07',winRate:100,wins:1,losses:0,ratings:[{skillId:'new-category',average:4.5,count:2}]});
 expect(result.ratingCount).toBe(2);
});
it('does not invent zeros for days that only have feedback or no observations',()=>{
 const result=summarizeDays([],[{date:'2026-11-08',skillId:'category',average:3,count:1n}],'UTC');
 expect(result.points[0].winRate).toBeNull();expect(result.wins).toBe(0);
 expect(summarizeDays([],[],'UTC').points).toEqual([]);
});
it('loads active backend categories and only the current player’s scored games',async()=>{
 const db:any={skill:{findMany:jest.fn().mockResolvedValue([{id:'dynamic',name:'New category'}])},match:{findMany:jest.fn().mockResolvedValue([])},$queryRaw:jest.fn().mockResolvedValue([])};
 const from=new Date('2026-01-01');
 const result=await new DashboardService(db).dashboard('11111111-1111-4111-8111-111111111111',from,undefined,'UTC');
 expect(result.categories[0].name).toBe('New category');
 expect(db.skill.findMany).toHaveBeenCalledWith({where:{sport:{slug:'beach-volleyball'},active:true},orderBy:{name:'asc'}});
 expect(db.match.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({playedAt:{gte:from,lt:expect.any(Date)},status:{notIn:['CANCELLED','IN_PROGRESS']},participants:{some:{userId:'11111111-1111-4111-8111-111111111111',teamId:{not:null}}}})}));
 const sql=db.$queryRaw.mock.calls[0][0];
 expect(sql.sql).toContain('f."recipientId" =');
 expect(sql.values).toContain('11111111-1111-4111-8111-111111111111');
 expect(sql.sql).not.toContain('analyticsAllowed');
});
it('rejects invalid time zones and dates before querying',async()=>{
 const db:any={skill:{findMany:jest.fn()}};
 const service=new DashboardService(db);
 await expect(service.dashboard('actor',undefined,undefined,'invalid/zone')).rejects.toBeInstanceOf(BadRequestException);
 await expect(service.dashboard('actor',new Date('invalid'))).rejects.toBeInstanceOf(BadRequestException);
 expect(db.skill.findMany).not.toHaveBeenCalled();
});
it('returns individual received ratings separately with the same timestamp bounds',async()=>{
 const skillId='11111111-1111-4111-8111-111111111111';
 const before=new Date(Date.now()-1000),from=new Date(before.getTime()-86400000),submittedAt=new Date(from.getTime()+1000);
 const db:any={feedbackRating:{findMany:jest.fn().mockResolvedValue([{rating:2,feedback:{id:'first',createdAt:submittedAt}},{rating:4,feedback:{id:'second',createdAt:submittedAt}}])}};
 const rows=await new DashboardService(db).categoryFeedback('owner',skillId,from,before);
 expect(rows).toEqual([{id:'first',submittedAt,rating:2},{id:'second',submittedAt,rating:4}]);
 expect(db.feedbackRating.findMany).toHaveBeenCalledWith({where:{skillId,skill:{active:true,sport:{slug:'beach-volleyball'}},feedback:{recipientId:'owner',status:'PUBLISHED',sport:{slug:'beach-volleyball'},createdAt:{gte:from,lt:before}}},select:{rating:true,feedback:{select:{id:true,createdAt:true}}},orderBy:[{feedback:{createdAt:'asc'}},{feedbackId:'asc'}]});
});
it('validates individual-feedback category and dates before reading ratings',async()=>{
 const db:any={feedbackRating:{findMany:jest.fn()}};
 const service=new DashboardService(db);
 await expect(service.categoryFeedback('owner','invalid')).rejects.toBeInstanceOf(BadRequestException);
 await expect(service.categoryFeedback('owner','11111111-1111-4111-8111-111111111111',new Date('invalid'))).rejects.toBeInstanceOf(BadRequestException);
 expect(db.feedbackRating.findMany).not.toHaveBeenCalled();
});
