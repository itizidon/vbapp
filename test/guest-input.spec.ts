import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitGuestFeedbackInput } from '../src/common/inputs';

it('accepts the signed token through strict input whitelisting', async () => {
 const input = plainToInstance(SubmitGuestFeedbackInput, {recipientId:'11111111-1111-4111-8111-111111111111',sportId:'22222222-2222-4222-8222-222222222222',guestName:'Teammate',token:'signed-invitation',ratings:[{skillId:'33333333-3333-4333-8333-333333333333',rating:4}]});
 expect(await validate(input,{whitelist:true,forbidNonWhitelisted:true})).toEqual([]);
});
it('rejects empty guest tokens', async () => {
 const input=plainToInstance(SubmitGuestFeedbackInput,{token:''});
 expect((await validate(input)).some(e=>e.property==='token')).toBe(true);
});
