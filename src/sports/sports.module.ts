import {Module} from '@nestjs/common'; import {SportsResolver} from './sports.resolver'; @Module({providers:[SportsResolver]}) export class SportsModule{}
