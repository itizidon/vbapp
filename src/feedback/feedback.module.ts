import { FeedbackRatingResolver, ApprovalRatingResolver } from "./rating.resolver";
import { FeedbackPrivacyService, FeedbackPrivacyResolver } from "./privacy";
import {Module} from '@nestjs/common';import {AuthModule} from '../auth/auth.module';import {FeedbackService} from './feedback.service';import {FeedbackResolver} from './feedback.resolver';@Module({imports:[AuthModule],providers:[FeedbackRatingResolver,ApprovalRatingResolver,FeedbackService,FeedbackResolver,FeedbackPrivacyService,FeedbackPrivacyResolver],exports:[FeedbackService]})export class FeedbackModule{}
