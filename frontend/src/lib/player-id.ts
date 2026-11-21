export const isClerkPlayerId = (value: unknown): value is string =>
  typeof value === "string" && /^user_[A-Za-z0-9]{8,128}$/.test(value);
