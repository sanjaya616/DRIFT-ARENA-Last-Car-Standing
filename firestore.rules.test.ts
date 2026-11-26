import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isValidLeaderboardPayload,
  isValidMatchHistoryPayload,
  sanitizeDisplayName,
} from './src/firebase/payloadValidation';

test('Dirty Dozen payload validation enforces blueprint schema & blocks shadow/spoof fields', () => {
  const validLeaderboard = {
    uid: 'user_abc123',
    displayName: 'Apex_Drifter',
    favoriteVehicle: 'drift_x',
    wins: 4,
    matchesPlayed: 10,
    eliminations: 19,
    bestScore: 14500,
    createdAt: 'SERVER_TIMESTAMP',
    updatedAt: 'SERVER_TIMESTAMP',
  };
  assert.equal(isValidLeaderboardPayload(validLeaderboard, 'user_abc123'), true);

  // Spoofed UID
  assert.equal(
    isValidLeaderboardPayload({ ...validLeaderboard, uid: 'other_user' }, 'user_abc123'),
    false,
  );
  // Shadow field injection
  assert.equal(
    isValidLeaderboardPayload({ ...validLeaderboard, isAdmin: true }, 'user_abc123'),
    false,
  );
  // Negative / inflated stats
  assert.equal(
    isValidLeaderboardPayload({ ...validLeaderboard, wins: -1 }, 'user_abc123'),
    false,
  );
  assert.equal(
    isValidLeaderboardPayload({ ...validLeaderboard, bestScore: 99999999 }, 'user_abc123'),
    false,
  );
  // Invalid vehicle enum
  assert.equal(
    isValidLeaderboardPayload({ ...validLeaderboard, favoriteVehicle: 'jet_fighter' }, 'user_abc123'),
    false,
  );
  // Overlong displayName
  assert.equal(
    isValidLeaderboardPayload({ ...validLeaderboard, displayName: 'A'.repeat(40) }, 'user_abc123'),
    false,
  );
});

test('MatchHistory payload validation enforces immutable schema & bounds', () => {
  const validMatch = {
    matchId: 'match_1001_userA',
    ownerId: 'userA',
    roomCode: 'PUB01',
    mode: 'online_public',
    vehicleId: 'street_rs',
    placement: 1,
    playersCount: 6,
    eliminations: 3,
    score: 8200,
    won: true,
    winnerName: 'Apex_Drifter',
    durationSec: 185,
    createdAt: 'SERVER_TIMESTAMP',
  };
  assert.equal(isValidMatchHistoryPayload(validMatch, 'userA'), true);
  assert.equal(isValidMatchHistoryPayload({ ...validMatch, matchId: 'bad$id!' }, 'userA'), false);
  assert.equal(isValidMatchHistoryPayload({ ...validMatch, ownerId: 'userB' }, 'userA'), false);
  assert.equal(isValidMatchHistoryPayload({ ...validMatch, mode: 'godmode' }, 'userA'), false);
  assert.equal(isValidMatchHistoryPayload({ ...validMatch, placement: 99 }, 'userA'), false);
});

test('sanitizeDisplayName strips unsafe chars & clamps length cleanly', () => {
  assert.equal(sanitizeDisplayName('  Neon<Driver>!@#  '), 'NeonDriver');
  assert.equal(sanitizeDisplayName('   '), 'Arena Driver');
  assert.equal(sanitizeDisplayName('X'.repeat(64)).length, 32);
});

test('firestore.rules includes default deny, verified user check, PII isolation, and no update on matchHistory', () => {
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  assert.match(rules, /email_verified == true/);
  assert.match(rules, /match \/users\/\{userId\}\/private\/info/);
  assert.match(rules, /match \/matchHistory\/\{matchId\}[\s\S]*allow update, delete: if false;/);
});
