// Validate canonical decimal tenths without binary modulo checks or silent rounding.
export function isFeedbackRating(value:unknown):value is number {
 return typeof value==="number" && Number.isFinite(value) && value>=1 && value<=5 && /^[1-5](?:\.[0-9])?$/.test(String(value));
}
