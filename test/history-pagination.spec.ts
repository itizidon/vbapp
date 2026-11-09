import { BadRequestException } from '@nestjs/common';
import { matchDateFilter } from '../src/matches/match-date-filter';
import { MatchesService } from '../src/matches/matches.service';
import { FeedbackService } from '../src/feedback/feedback.service';
const from=new Date('2026-11-01T04:00:00Z');
const before=new Date('2026-11-02T05:00:00Z');
it('filters by played date with an inclusive start and exclusive next-day boundary',()=>{
 expect(matchDateFilter(from,before)).toEqual({playedAt:{gte:from,lt:before}});
 expect(matchDateFilter(from)).toEqual({playedAt:{gte:from}});
 expect(matchDateFilter(undefined,before)).toEqual({playedAt:{lt:before}});
 expect(matchDateFilter()).toEqual({});
});
it('rejects reversed, empty, and invalid date ranges',()=>{
 expect(()=>matchDateFilter(before,from)).toThrow(BadRequestException);
 expect(()=>matchDateFilter(from,from)).toThrow(BadRequestException);
 expect(()=>matchDateFilter(new Date('invalid'))).toThrow(BadRequestException);
});
it('applies dates before fetching a ten-row page plus lookahead without changing ownership',async()=>{
 const db:any={match:{findMany:jest.fn().mockResolvedValue([])}};
 await new MatchesService(db).list('me','cursor',from,before);
 expect(db.match.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{playedAt:{gte:from,lt:before},OR:[{createdById:'me'},{participants:{some:{userId:'me'}}}]},take:11,cursor:{id:'cursor'},skip:1,orderBy:[{createdAt:'desc'},{id:'desc'}]}));
});
it.each([true,false,undefined,null])('filters feedback before pagination and preserves actor scope: %s',async matchOnly=>{
 const db:any={feedback:{findMany:jest.fn().mockResolvedValue([])}};
 await new FeedbackService(db,{} as any).received('me','cursor',matchOnly as boolean|undefined);
 expect(db.feedback.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{recipientId:'me',...(matchOnly==null?{}:{matchId:matchOnly?{not:null}:null}),status:{not:'DELETED'}},take:11,cursor:{id:'cursor'},skip:1}));
});

it('combines submitted dates and feedback type before paging while retaining recipient permissions',async()=>{
 const db:any={feedback:{findMany:jest.fn().mockResolvedValue([])}};
 await new FeedbackService(db,{} as any).received('me','cursor',true,from,before);
 expect(db.feedback.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{recipientId:'me',matchId:{not:null},createdAt:{gte:from,lt:before},status:{not:'DELETED'}},take:11,cursor:{id:'cursor'},skip:1}));
});
it('rejects invalid feedback dates before loading any data',()=>{
 const db:any={feedback:{findMany:jest.fn()}};
 expect(()=>new FeedbackService(db,{} as any).received('me',undefined,undefined,before,from)).toThrow(BadRequestException);
 expect(db.feedback.findMany).not.toHaveBeenCalled();
});
