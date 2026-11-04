/** Native apps have one process per device: nothing to coordinate. */
export class TabLockTimeout extends Error {}

export async function claimDatabaseTab(_onTakenOver: () => Promise<void> | void): Promise<void> {}
