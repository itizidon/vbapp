import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { FeedbackService } from '../src/feedback/feedback.service';
const recipientId='11111111-1111-4111-8111-111111111111',sportId='22222222-2222-4222-8222-222222222222',skillId='33333333-3333-4333-8333-333333333333';
const secret='feedback-link-test-secret-longer-than-32';
it('issues an opaque stored invitation that expires after 24 hours',async()=>{
 const jwt=new JwtService({secret});
 const db:any={sport:{findUnique:jest.fn().mockResolvedValue({id:sportId})},feedbackLink:{create:jest.fn().mockResolvedValue({id:'link'})}};
 const before=Date.now();
 const invite=await new FeedbackService(db,jwt).invite(recipientId,recipientId,sportId);
 expect(invite.token).toMatch(/^[a-f0-9]{64}$/);
 expect(invite.expiresAt.getTime()-before).toBeGreaterThanOrEqual(86400000);
 expect(invite.expiresAt.getTime()-before).toBeLessThan(86401000);
 expect(db.feedbackLink.create).toHaveBeenCalledWith({data:expect.objectContaining({recipientId,sportId,tokenHash:expect.any(String)})});
 expect(db.feedbackLink.create.mock.calls[0][0].data.tokenHash).not.toBe(invite.token);
});
it('allows repeated submissions with the same signed invitation and retains its audit nonce',async()=>{
 const jwt=new JwtService({secret});const nonce='44444444-4444-4444-8444-444444444444';
 const token=await jwt.signAsync({kind:'guest-feedback',nonce,recipientId,sportId},{expiresIn:'24h'});
 const tx:any={feedbackLink:{findUnique:jest.fn().mockResolvedValue(null)},$queryRaw:jest.fn(),user:{findUnique:jest.fn().mockResolvedValue({id:recipientId})},sport:{findUnique:jest.fn().mockResolvedValue({id:sportId})},skill:{findMany:jest.fn().mockResolvedValue([{id:skillId}])},feedback:{create:jest.fn().mockResolvedValue({id:'f'}),findUniqueOrThrow:jest.fn().mockResolvedValue({id:'f'})},feedbackRating:{createMany:jest.fn()}};
 const service=new FeedbackService({feedbackLink:{findUnique:jest.fn().mockResolvedValue(null)},$transaction:(fn:any)=>fn(tx)}as any,jwt,{syncFeedback:jest.fn(),snapshotReviewerInfluence:jest.fn().mockResolvedValue({})} as any);
 const input={recipientId,sportId,token,guestName:'First',ratings:[{skillId,rating:4}]};
 await service.submitGuest(input);await service.submitGuest({...input,guestName:'Second'});
 await service.submitGuest({...input,guestName:undefined});await service.submitGuest({...input,guestName:'   '});
 expect(tx.feedback.create).toHaveBeenCalledTimes(4);
 expect(tx.feedback.create.mock.calls[2][0].data.guestName).toBe('Guest reviewer');
 expect(tx.feedback.create.mock.calls[3][0].data.guestName).toBe('Guest reviewer');
 for(const call of tx.feedback.create.mock.calls)expect(call[0].data.guestInviteNonce).toBe(nonce);
});
it('rejects expired and scope-changed invitations before writing feedback',async()=>{
 const jwt=new JwtService({secret});const db:any={feedbackLink:{findUnique:jest.fn().mockResolvedValue(null)},$transaction:jest.fn()};const service=new FeedbackService(db,jwt);
 const payload={kind:'guest-feedback',nonce:'44444444-4444-4444-8444-444444444444',recipientId,sportId};
 const input={recipientId,sportId,guestName:'Guest',ratings:[{skillId,rating:4}]};
 await expect(service.submitGuest({...input,token:await jwt.signAsync(payload,{expiresIn:-1})})).rejects.toBeInstanceOf(UnauthorizedException);
 await expect(service.submitGuest({...input,matchId:'55555555-5555-4555-8555-555555555555',token:await jwt.signAsync(payload,{expiresIn:'24h'})})).rejects.toBeInstanceOf(UnauthorizedException);
 expect(db.$transaction).not.toHaveBeenCalled();
});
