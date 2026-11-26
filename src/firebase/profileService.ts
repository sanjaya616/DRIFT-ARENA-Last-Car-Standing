import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import type { VehicleId } from '../types/game';
import { db, handleFirestoreError, OperationType } from './firebaseClient';
import {
  sanitizeDisplayName,
  sanitizeId,
  type HistoryMode,
} from './payloadValidation';

export interface RacerProfile {
  uid: string;
  displayName: string;
  favoriteVehicle: VehicleId;
  wins: number;
  matchesPlayed: number;
  eliminations: number;
  bestScore: number;
}

export interface MatchHistorySummary {
  matchId: string;
  ownerId: string;
  roomCode: string;
  mode: HistoryMode;
  vehicleId: VehicleId;
  placement: number;
  playersCount: number;
  eliminations: number;
  score: number;
  won: boolean;
  winnerName: string;
  durationSec: number;
}

export async function ensureUserProfile(
  user: User,
  preferredVehicle: VehicleId,
): Promise<RacerProfile> {
  const uid = sanitizeId(user.uid);
  const displayName = sanitizeDisplayName(user.displayName);

  // 1. Ensure private PII doc exists / stays synced (owner-only)
  const privatePath = `users/${uid}/private/info`;
  try {
    const privRef = doc(db, 'users', uid, 'private', 'info');
    const privSnap = await getDoc(privRef);
    const email = (user.email || `${uid}@driftarena.local`).slice(0, 254);
    if (!privSnap.exists()) {
      await setDoc(privRef, {
        uid,
        email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (privSnap.data().email !== email) {
      await setDoc(
        privRef,
        {
          uid,
          email,
          createdAt: privSnap.data().createdAt,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, privatePath);
  }

  // 2. Ensure public leaderboard racer doc exists
  const lbPath = `leaderboard/${uid}`;
  try {
    const lbRef = doc(db, 'leaderboard', uid);
    const snap = await getDoc(lbRef);
    if (!snap.exists()) {
      const initial: RacerProfile = {
        uid,
        displayName,
        favoriteVehicle: preferredVehicle,
        wins: 0,
        matchesPlayed: 0,
        eliminations: 0,
        bestScore: 0,
      };
      await setDoc(lbRef, {
        ...initial,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return initial;
    }
    const d = snap.data();
    return {
      uid,
      displayName: sanitizeDisplayName(d.displayName),
      favoriteVehicle: (d.favoriteVehicle as VehicleId) || preferredVehicle,
      wins: Number(d.wins) || 0,
      matchesPlayed: Number(d.matchesPlayed) || 0,
      eliminations: Number(d.eliminations) || 0,
      bestScore: Number(d.bestScore) || 0,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, lbPath);
  }
}

export async function fetchLeaderboard(maxRows = 12): Promise<RacerProfile[]> {
  const path = 'leaderboard';
  try {
    const q = query(
      collection(db, path),
      where('bestScore', '>=', 0),
      orderBy('bestScore', 'desc'),
      limit(maxRows),
    );
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => {
      const d = docSnap.data();
      return {
        uid: String(d.uid || docSnap.id),
        displayName: sanitizeDisplayName(d.displayName),
        favoriteVehicle: (d.favoriteVehicle as VehicleId) || 'street_rs',
        wins: Number(d.wins) || 0,
        matchesPlayed: Number(d.matchesPlayed) || 0,
        eliminations: Number(d.eliminations) || 0,
        bestScore: Number(d.bestScore) || 0,
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchUserMatchHistory(
  uid: string,
  maxRows = 10,
): Promise<MatchHistorySummary[]> {
  const cleanUid = sanitizeId(uid);
  const path = 'matchHistory';
  try {
    const q = query(
      collection(db, path),
      where('ownerId', '==', cleanUid),
      orderBy('createdAt', 'desc'),
      limit(maxRows),
    );
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => {
      const d = docSnap.data();
      return {
        matchId: String(d.matchId || docSnap.id),
        ownerId: String(d.ownerId),
        roomCode: String(d.roomCode || 'ARENA'),
        mode: (d.mode as HistoryMode) || 'survival',
        vehicleId: (d.vehicleId as VehicleId) || 'street_rs',
        placement: Number(d.placement) || 1,
        playersCount: Number(d.playersCount) || 1,
        eliminations: Number(d.eliminations) || 0,
        score: Number(d.score) || 0,
        won: Boolean(d.won),
        winnerName: sanitizeDisplayName(d.winnerName),
        durationSec: Number(d.durationSec) || 0,
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function recordMatchOutcome(params: {
  user: User;
  roomCode: string;
  mode: HistoryMode;
  vehicleId: VehicleId;
  placement: number;
  playersCount: number;
  eliminations: number;
  score: number;
  won: boolean;
  winnerName: string;
  durationSec: number;
}): Promise<RacerProfile> {
  const uid = sanitizeId(params.user.uid);
  const displayName = sanitizeDisplayName(params.user.displayName);
  const cleanScore = Math.max(0, Math.min(500000, Math.round(params.score)));
  const cleanKOs = Math.max(0, Math.min(50, Math.round(params.eliminations)));
  const cleanDuration = Math.max(0, Math.min(7200, Math.round(params.durationSec)));
  const cleanPlacement = Math.max(1, Math.min(8, Math.round(params.placement)));
  const cleanPlayers = Math.max(1, Math.min(8, Math.round(params.playersCount)));

  const lbPath = `leaderboard/${uid}`;
  let updatedProfile: RacerProfile;
  try {
    const lbRef = doc(db, 'leaderboard', uid);
    const existing = await getDoc(lbRef);
    if (!existing.exists()) {
      updatedProfile = {
        uid,
        displayName,
        favoriteVehicle: params.vehicleId,
        wins: params.won ? 1 : 0,
        matchesPlayed: 1,
        eliminations: cleanKOs,
        bestScore: cleanScore,
      };
      await setDoc(lbRef, {
        ...updatedProfile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const prev = existing.data();
      updatedProfile = {
        uid,
        displayName,
        favoriteVehicle: params.vehicleId,
        wins: (Number(prev.wins) || 0) + (params.won ? 1 : 0),
        matchesPlayed: (Number(prev.matchesPlayed) || 0) + 1,
        eliminations: (Number(prev.eliminations) || 0) + cleanKOs,
        bestScore: Math.max(Number(prev.bestScore) || 0, cleanScore),
      };
      await setDoc(lbRef, {
        ...updatedProfile,
        createdAt: prev.createdAt,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, lbPath);
  }

  const matchId = sanitizeId(`m_${Date.now()}_${uid.slice(0, 12)}`);
  const matchPath = `matchHistory/${matchId}`;
  try {
    await setDoc(doc(db, 'matchHistory', matchId), {
      matchId,
      ownerId: uid,
      roomCode: sanitizeId(params.roomCode, 16),
      mode: params.mode,
      vehicleId: params.vehicleId,
      placement: cleanPlacement,
      playersCount: cleanPlayers,
      eliminations: cleanKOs,
      score: cleanScore,
      won: Boolean(params.won),
      winnerName: sanitizeDisplayName(params.winnerName),
      durationSec: cleanDuration,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, matchPath);
  }

  return updatedProfile;
}
