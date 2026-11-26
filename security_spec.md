# Drift Arena Security Specification (Phase 0)

## 1. Data Invariants
1. **Default Deny**: Every unmatched Firestore path is denied for read and write.
2. **PII Isolation**: Email addresses live exclusively inside `/users/{userId}/private/info` and can only be read or written by the authenticated verified owner (`request.auth.uid == userId`). No blanket `list` is allowed.
3. **Identity Integrity**: Every document written to `/leaderboard/{userId}` or `/matchHistory/{matchId}` must bind `uid`/`ownerId == request.auth.uid` and require `request.auth.token.email_verified == true`.
4. **Immutable Ownership & Timestamps**: `createdAt` must equal `request.time` on creation and remain unchanged on updates; `updatedAt` must equal `request.time` on writes. `matchHistory` records are strictly append-only (updates and deletes denied).
5. **Volumetric & Schema Strictness**: Every write passes a dedicated `isValid*()` helper enforcing `keys().hasAll(...)` + `keys().hasOnly(...)`, enum membership for `vehicleId`/`mode`, numeric bounds, and string `.size()` limits.
6. **Zero Physics in Firestore**: Real-time vehicle positions, velocities, health ticks, and collisions flow exclusively over the authoritative WebSocket server, never Firestore.

## 2. The "Dirty Dozen" Attack Payloads (Must All Be Denied)
1. **Unauthenticated Write**: Anonymous `create` on `/leaderboard/attacker` -> DENIED (`request.auth != null`).
2. **Unverified Email Write**: Signed-in user with `email_verified: false` writing `/leaderboard/{uid}` -> DENIED.
3. **Cross-User Profile Hijack**: Authenticated user A attempting `update` on `/leaderboard/userB` -> DENIED (`isOwner(userId)`).
4. **UID Spoofing inside Payload**: User A writing `/leaderboard/userA` with `{ uid: "userB", ... }` -> DENIED (`data.uid == request.auth.uid`).
5. **Shadow / Ghost Field Injection**: Adding `{ isAdmin: true }` or `{ role: "superadmin" }` to `/leaderboard/{uid}` -> DENIED (`hasOnly`).
6. **PII Snooping**: User A calling `get` on `/users/userB/private/info` -> DENIED (`isOwner(userId)`).
7. **Collection Scrape on Match History**: User A listing `/matchHistory` without `where("ownerId", "==", uid)` -> DENIED (`resource.data.ownerId == request.auth.uid`).
8. **Backdated Timestamp Forgery**: Setting `createdAt` or `updatedAt` to a client timestamp instead of `request.time` -> DENIED.
9. **Immutable Match Tampering**: Attempting `update` or `delete` on `/matchHistory/{matchId}` to alter `won: true` -> DENIED.
10. **ID Poisoning**: Creating `/matchHistory/bad$id!` or a 500-char ID -> DENIED (`isValidId`).
11. **Value Poisoning / Stat Inflation**: Setting `wins: -5` or `bestScore: 999999999` or `displayName` > 32 chars -> DENIED.
12. **Invalid Enum Injection**: Setting `favoriteVehicle: "jet_fighter"` or `mode: "godmode"` -> DENIED.
