import { Matches, type ValidationOptions } from "class-validator";
export const IsClerkUserId = (options?: ValidationOptions) =>
  Matches(/^user_[A-Za-z0-9]{8,128}$/, options);
