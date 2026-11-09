import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { FeedbackService } from '../src/feedback/feedback.service';
const recipientId='11111111-1111-4111-8111-111111111111',sportId='22222222-2222-4222-8222-222222222222',skillId='33333333-3333-4333-8333-333333333333';
const secret='feedback-link-test-secret-longer-than-32';
it('issues a signed invitation that expires after 24 hours',async()=>{
 const jwt=new JwtService({secret});
 const db:any={sport:{findUnique:jest.fn().mockResolvedValue({id:sportId})}};
 const invite=await new FeedbackService(db,jwt).invite(recipientId,recipientId,sportId);
 const claims=await jwt.verifyAsync(invite.token);
 expect(claims.exp-claims.iat).toBe(86400);
 expect(claims.recipientId).toBe(recipientId);
 expect(claims.nonce).toEqual(expect.any(String));
});
it('allows repeated submissions with the same signed invitation and retains its audit nonce',async()=>{
 const jwt=new JwtService({secret});const nonce='44444444-4444-4444-8444-444444444444';
 const token=await jwt.signAsync({kind:'guest-feedback',nonce,recipientId,sportId},{expiresIn:'24h'});
 const tx:any={user:{findUnique:jest.fn().mockResolvedValue({id:recipientId})},sport:{findUnique:jest.fn().mockResolvedValue({id:sportId})},skill:{findMany:jest.fn().mockResolvedValue([{id:skillId}])},feedback:{create:jest.fn().mockResolvedValue({id:'f'}),findUniqueOrThrow:jest.fn().mockResolvedValue({id:'f'})},feedbackRating:{createMany:jest.fn()}};
 const service=new FeedbackService({$transaction:(fn:any)=>fn(tx)}as any,jwt);
 const input={recipientId,sportId,token,guestName:'First',ratings:[{skillId,rating:4}]};
 await service.submitGuest(input);await service.submitGuest({...input,guestName:'Second'});
 expect(tx.feedback.create).toHaveBeenCalledTimes(2);
 for(const call of tx.feedback.create.mock.calls)expect(call[0].data.guestInviteNonce).toBe(nonce);
});
it('rejects expired and scope-changed invitations before writing feedback',async()=>{
 const jwt=new JwtService({secret});const db:any={$transaction:jest.fn()};const service=new FeedbackService(db,jwt);
 const payload={kind:'guest-feedback',nonce:'44444444-4444-4444-8444-444444444444',recipientId,sportId};
 const input={recipientId,sportId,guestName:'Guest',ratings:[{skillId,rating:4}]};
 await expect(service.submitGuest({...input,token:await jwt.signAsync(payload,{expiresIn:-1})})).rejects.toBeInstanceOf(UnauthorizedException);
 await expect(service.submitGuest({...input,matchId:'55555555-5555-4555-8555-555555555555',token:await jwt.signAsync(payload,{expiresIn:'24h'})})).rejects.toBeInstanceOf(UnauthorizedException);
 expect(db.$transaction).not.toHaveBeenCalled();
});
