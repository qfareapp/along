let cleanup: (() => Promise<void>) | undefined;
export function setPushCleanup(handler: () => Promise<void>) {
  cleanup = handler;
  return () => {
    if (cleanup === handler) cleanup = undefined;
  };
}
export async function clearPushRegistration() {
  const handler = cleanup;
  cleanup = undefined;
  await handler?.();
}
