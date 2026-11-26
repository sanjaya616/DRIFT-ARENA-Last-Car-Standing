import type { VehicleId } from '../types/game';

export const BLUEPRINT_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
export const BLUEPRINT_DISPLAY_NAME_REGEX = /^[a-zA-Z0-9 _\-.]+$/;
export const MAX_DISPLAY_NAME_LENGTH = 32;
export const MAX_UID_LENGTH = 128;
export const MAX_ROOM_CODE_LENGTH = 16;

export const VALID_VEHICLE_IDS: readonly VehicleId[] = [
  'street_rs',
  'drift_x',
  'muscle_gt',
  'speedster',
  'rally_beast',
  'titan_4x',
];

export type HistoryMode = 'online_public' | 'online_private' | 'survival' | 'freedrive';

export const VALID_HISTORY_MODES: readonly HistoryMode[] = [
  'online_public',
  'online_private',
  'survival',
  'freedrive',
];

export function sanitizeDisplayName(raw: string | null | undefined): string {
  const cleaned = (raw ?? '')
    .replace(/[^a-zA-Z0-9 _\-.]/g, '')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : 'Arena Driver';
}

export function sanitizeId(raw: string, maxLen = MAX_UID_LENGTH): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : 'guest';
}

export function isValidLeaderboardPayload(
  data: Record<string, unknown>,
  expectedUid: string,
): boolean {
  const required = [
    'uid',
    'displayName',
    'favoriteVehicle',
    'wins',
    'matchesPlayed',
    'eliminations',
    'bestScore',
    'createdAt',
    'updatedAt',
  ];
  const keys = Object.keys(data);
  if (!required.every((k) => keys.includes(k))) return false;
  if (!keys.every((k) => required.includes(k))) return false;

  if (typeof data.uid !== 'string' || data.uid !== expectedUid) return false;
  if (data.uid.length < 1 || data.uid.length > MAX_UID_LENGTH || !BLUEPRINT_ID_REGEX.test(data.uid)) {
    return false;
  }
  if (
    typeof data.displayName !== 'string' ||
    data.displayName.length < 1 ||
    data.displayName.length > MAX_DISPLAY_NAME_LENGTH ||
    !BLUEPRINT_DISPLAY_NAME_REGEX.test(data.displayName)
  ) {
    return false;
  }
  if (
    typeof data.favoriteVehicle !== 'string' ||
    !VALID_VEHICLE_IDS.includes(data.favoriteVehicle as VehicleId)
  ) {
    return false;
  }
  if (typeof data.wins !== 'number' || data.wins < 0 || data.wins > 100000) return false;
  if (typeof data.matchesPlayed !== 'number' || data.matchesPlayed < 0 || data.matchesPlayed > 500000) return false;
  if (typeof data.eliminations !== 'number' || data.eliminations < 0 || data.eliminations > 1000000) return false;
  if (typeof data.bestScore !== 'number' || data.bestScore < 0 || data.bestScore > 5000000) return false;

  return true;
}

export function isValidMatchHistoryPayload(
  data: Record<string, unknown>,
  expectedOwnerId: string,
): boolean {
  const required = [
    'matchId',
    'ownerId',
    'roomCode',
    'mode',
    'vehicleId',
    'placement',
    'playersCount',
    'eliminations',
    'score',
    'won',
    'winnerName',
    'durationSec',
    'createdAt',
  ];
  const keys = Object.keys(data);
  if (!required.every((k) => keys.includes(k))) return false;
  if (!keys.every((k) => required.includes(k))) return false;

  if (
    typeof data.matchId !== 'string' ||
    data.matchId.length < 4 ||
    data.matchId.length > MAX_UID_LENGTH ||
    !BLUEPRINT_ID_REGEX.test(data.matchId)
  ) {
    return false;
  }
  if (typeof data.ownerId !== 'string' || data.ownerId !== expectedOwnerId) return false;
  if (
    typeof data.roomCode !== 'string' ||
    data.roomCode.length < 2 ||
    data.roomCode.length > MAX_ROOM_CODE_LENGTH ||
    !BLUEPRINT_ID_REGEX.test(data.roomCode)
  ) {
    return false;
  }
  if (
    typeof data.mode !== 'string' ||
    !VALID_HISTORY_MODES.includes(data.mode as HistoryMode)
  ) {
    return false;
  }
  if (
    typeof data.vehicleId !== 'string' ||
    !VALID_VEHICLE_IDS.includes(data.vehicleId as VehicleId)
  ) {
    return false;
  }
  if (typeof data.placement !== 'number' || data.placement < 1 || data.placement > 8) return false;
  if (typeof data.playersCount !== 'number' || data.playersCount < 1 || data.playersCount > 8) return false;
  if (typeof data.eliminations !== 'number' || data.eliminations < 0 || data.eliminations > 50) return false;
  if (typeof data.score !== 'number' || data.score < 0 || data.score > 500000) return false;
  if (typeof data.won !== 'boolean') return false;
  if (typeof data.winnerName !== 'string' || data.winnerName.length < 1 || data.winnerName.length > MAX_DISPLAY_NAME_LENGTH) {
    return false;
  }
  if (typeof data.durationSec !== 'number' || data.durationSec < 0 || data.durationSec > 7200) return false;

  return true;
}
