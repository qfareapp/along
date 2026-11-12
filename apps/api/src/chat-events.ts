import { EventEmitter } from "node:events";
// Carries only an invalidation signal. Message content remains behind chat authorization.
export const chatEvents = new EventEmitter();
