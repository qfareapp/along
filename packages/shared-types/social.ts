/** Later-phase contract only. No shared memory is published automatically. */
export interface SharedMemoryConsent {
  participantId: string;
  grantedAt: string | null;
  withdrawnAt: string | null;
}
export interface SharedMemoryDraft {
  activityId: string;
  participantIds: [string, string];
  createdBy: string;
  caption: string;
  privateAssetId?: string;
  status: "draft" | "awaiting_consent" | "shared" | "archived" | "withdrawn";
  consents: [SharedMemoryConsent, SharedMemoryConsent];
  audience: "participants_only";
}
// Activation must verify actual participation, current eligibility and both
// explicit consents. Either withdrawal revokes shared display immediately.
