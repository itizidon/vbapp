import { BadRequestException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
it('does not query short searches and rejects excessive lengths',async()=>{
 const db:any={$queryRaw:jest.fn()};const service=new AuthService(db,{} as any);
 expect(await service.playerSuggestions(' x ')).toEqual([]);
 await expect(service.playerSuggestions('x'.repeat(255))).rejects.toBeInstanceOf(BadRequestException);
 expect(db.$queryRaw).not.toHaveBeenCalled();
});
it('matches usernames and emails, ranks exact/prefix matches, and returns only five directory records',async()=>{
 const rows=[{id:'p',username:'Player',isPublic:false}];
 const db:any={$queryRaw:jest.fn().mockResolvedValue(rows)};
 await expect(new AuthService(db,{} as any).playerSuggestions(' Player@Example.test ')).resolves.toEqual(rows);
 const query=db.$queryRaw.mock.calls[0][0];
 expect(query.sql).toContain('LIMIT 5');expect(query.sql).toContain('ORDER BY CASE');
 expect(query.sql).toContain('THEN 0');expect(query.sql).toContain('THEN 1');
 expect(query.sql).toContain('OR email ILIKE');
 expect(query.sql.split('FROM')[0]).not.toContain('email');
 expect(query.values).toContain('Player@Example.test');
 expect(query.values).toContain('Player@Example.test%');
});
it('treats SQL wildcard characters as literal search text',async()=>{
 const db:any={$queryRaw:jest.fn().mockResolvedValue([])};
 await new AuthService(db,{} as any).playerSuggestions('a_b%');
 expect(db.$queryRaw.mock.calls[0][0].values[0]).toBe(String.raw`%a\_b\%%`);
});
