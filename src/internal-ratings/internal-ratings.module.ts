import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InternalRatingsService } from "./internal-ratings.service";
import { InternalRatingsResolver } from "./internal-ratings.resolver";
@Global()
@Module({
  imports: [AuthModule],
  providers: [InternalRatingsService, InternalRatingsResolver],
  exports: [InternalRatingsService],
})
export class InternalRatingsModule {}
