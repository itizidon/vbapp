import{BadRequestException}from'@nestjs/common';import{MatchesService}from'../src/matches/matches.service';
import{FeedbackService}from'../src/feedback/feedback.service';
describe('core service rules',()=>{
 it('creates a completed match with its owner and current date',async()=>{const db:any={match:{create:jest.fn().mockResolvedValue({id:'m',status:'COMPLETED'})}};const s=new MatchesService(db);await expect(s.create('u',{})).resolves.toMatchObject({status:'COMPLETED'});expect(db.match.create).toHaveBeenCalledWith(expect.objectContaining({data:{createdById:'u',status:'COMPLETED',playedAt:expect.any(Date)}}))});
});
