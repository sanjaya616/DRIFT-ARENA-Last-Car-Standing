import { useEffect, useState } from 'react';
import type { CarCustomization } from '../../types/game';
import type { MultiplayerClient } from '../../multiplayer/MultiplayerClient';
import type { RoomLobbySnapshot } from '../../multiplayer/protocol';
import { VEHICLE_CONFIGS } from '../../cars/vehicleConfigs';

interface PublicLobbySummary {
  roomCode: string;
  players: number;
  maxPlayers: number;
  readyCount: number;
  aiFill: boolean;
}

interface MultiplayerScreenProps {
  client: MultiplayerClient;
  connected: boolean;
  reconnecting: boolean;
  playerId: string | null;
  verifiedUid: string | null;
  room: RoomLobbySnapshot | null;
  driverName: string;
  customization: CarCustomization;
  errorMsg: string | null;
  onDriverNameChange: (name: string) => void;
  onStartLocalSkirmish: () => void;
  onBack: () => void;
}

export function MultiplayerScreen({
  client,
  connected,
  reconnecting,
  playerId,
  verifiedUid,
  room,
  driverName,
  customization,
  errorMsg,
  onDriverNameChange,
  onStartLocalSkirmish,
  onBack,
}: MultiplayerScreenProps) {
  const [joinCode, setJoinCode] = useState('');
  const [aiFillCreate, setAiFillCreate] = useState(true);
  const [publicRooms, setPublicRooms] = useState<PublicLobbySummary[]>([]);
  const [copiedCode, setCopiedCode] = useState(false);

  const refreshPublicRooms = async () => {
    try {
      const res = await fetch('/api/rooms');
      if (!res.ok) return;
      const data = (await res.json()) as { rooms?: PublicLobbySummary[] };
      if (Array.isArray(data.rooms)) {
        setPublicRooms(data.rooms);
      }
    } catch {
      // ignore fetch error
    }
  };

  useEffect(() => {
    void refreshPublicRooms();
    const id = window.setInterval(() => {
      void refreshPublicRooms();
    }, 3500);
    return () => window.clearInterval(id);
  }, []);

  const meInRoom = room?.players.find((p) => p.id === playerId) ?? null;
  const isHost = Boolean(room && playerId && room.hostId === playerId);
  const activeVehicleName = VEHICLE_CONFIGS[customization.vehicleId]?.name ?? customization.vehicleId;

  const handleCopyCode = async () => {
    if (!room?.roomCode) return;
    try {
      await navigator.clipboard.writeText(room.roomCode);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center p-4 bg-slate-950/65">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl border border-slate-600/70 bg-slate-950/96 p-5 shadow-2xl">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h1 className="text-xl font-black tracking-wide text-white uppercase">
              Online Multiplayer Arena
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
              <span
                data-testid="mp-connection-status"
                className={`font-bold uppercase ${
                  connected
                    ? 'text-emerald-300'
                    : reconnecting
                      ? 'text-amber-300'
                      : 'text-rose-300'
                }`}
              >
                {connected
                  ? 'Server Connected (20 Hz Authoritative)'
                  : reconnecting
                    ? 'Reconnecting...'
                    : 'Connecting to WebSocket Server...'}
              </span>
              {verifiedUid && (
                <span className="rounded border border-sky-500/40 bg-sky-950/60 px-1.5 py-0.5 text-[10px] font-bold text-sky-300 uppercase">
                  Verified Account
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (room) client.leaveRoom();
              onBack();
            }}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-400"
          >
            Back
          </button>
        </div>

        {errorMsg && (
          <div
            data-testid="mp-error-banner"
            className="mb-3 rounded-lg border border-rose-500/60 bg-rose-950/60 px-3 py-2 text-xs font-bold text-rose-200"
          >
            {errorMsg}
          </div>
        )}

        {!room ? (
          <div className="grid gap-4 md:grid-cols-2">
            {/* Left Column: Driver Setup + Matchmaking Actions */}
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-3.5">
                <label
                  htmlFor="mp-driver-name"
                  className="mb-1 block text-[10px] font-black tracking-wider text-slate-400 uppercase"
                >
                  Driver Callsign · Active Car: {activeVehicleName}
                </label>
                <input
                  id="mp-driver-name"
                  type="text"
                  maxLength={24}
                  value={driverName}
                  onChange={(e) => onDriverNameChange(e.target.value)}
                  placeholder="Enter driver name"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white outline-none focus:border-sky-400"
                />
              </div>

              <button
                type="button"
                data-testid="mp-join-public"
                disabled={!connected}
                onClick={() => client.joinPublic(driverName, customization)}
                className="rounded-lg bg-orange-500 px-4 py-3 text-left shadow-lg transition-colors hover:bg-orange-400 disabled:opacity-50"
              >
                <div className="text-sm font-black tracking-wider text-slate-950 uppercase">
                  Public Matchmaking
                </div>
                <div className="text-[11px] font-bold text-slate-900">
                  Auto-join an open 2–8 player arena or host a new public room
                </div>
              </button>

              <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-black tracking-wider text-white uppercase">
                    Create Private Room
                  </span>
                  <button
                    type="button"
                    onClick={() => setAiFillCreate((v) => !v)}
                    className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${
                      aiFillCreate
                        ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                        : 'border-slate-700 bg-slate-950 text-slate-400'
                    }`}
                  >
                    AI Fill: {aiFillCreate ? 'On' : 'Off'}
                  </button>
                </div>
                <button
                  type="button"
                  data-testid="mp-create-private"
                  disabled={!connected}
                  onClick={() =>
                    client.createRoom({
                      isPrivate: true,
                      aiFill: aiFillCreate,
                      displayName: driverName,
                      customization,
                    })
                  }
                  className="w-full rounded-lg border border-sky-400/70 bg-sky-500/20 py-2.5 text-xs font-black tracking-wider text-sky-100 uppercase hover:bg-sky-500/30 disabled:opacity-50"
                >
                  Create Private Room & Generate Code
                </button>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-3.5">
                <div className="mb-1.5 text-xs font-black tracking-wider text-white uppercase">
                  Join Room by Code
                </div>
                <div className="flex gap-2">
                  <input
                    data-testid="mp-room-code-input"
                    type="text"
                    maxLength={8}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="ROOM CODE"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm font-black tracking-widest text-amber-300 uppercase outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    data-testid="mp-join-code-btn"
                    disabled={!connected || joinCode.trim().length < 4}
                    onClick={() => client.joinRoom(joinCode, driverName, customization)}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-black tracking-wider text-slate-950 uppercase hover:bg-amber-400 disabled:opacity-50"
                  >
                    Join
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column: Live Public Rooms + Offline Skirmish Fallback */}
            <div className="flex flex-col justify-between gap-3">
              <div className="flex-1 rounded-lg border border-slate-800 bg-slate-900/90 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-black tracking-wider text-sky-300 uppercase">
                    Open Public Rooms
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshPublicRooms()}
                    className="text-[10px] font-bold text-slate-400 uppercase hover:text-white"
                  >
                    Refresh
                  </button>
                </div>
                {publicRooms.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No open public rooms waiting. Click Public Matchmaking to start one!
                  </div>
                ) : (
                  <div className="space-y-2">
                    {publicRooms.map((r) => (
                      <div
                        key={r.roomCode}
                        className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                      >
                        <div>
                          <div className="font-mono text-xs font-black text-white">
                            ROOM {r.roomCode}
                          </div>
                          <div className="text-[10px] text-slate-400 uppercase">
                            {r.players}/{r.maxPlayers} Players · {r.readyCount} Ready ·{' '}
                            {r.aiFill ? 'AI Fill' : 'Humans Only'}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={!connected}
                          onClick={() => client.joinRoom(r.roomCode, driverName, customization)}
                          className="rounded bg-sky-500 px-3 py-1.5 text-[11px] font-black text-slate-950 uppercase hover:bg-sky-400 disabled:opacity-50"
                        >
                          Join
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                <div className="mb-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  Single-Device Offline Preview
                </div>
                <button
                  type="button"
                  onClick={onStartLocalSkirmish}
                  className="w-full rounded-lg border border-slate-600 bg-slate-950 py-2.5 text-xs font-black tracking-wider text-slate-200 uppercase hover:border-orange-400 hover:text-white"
                >
                  Launch Local AI Skirmish (Offline)
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Active Room Lobby View */
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-500/45 bg-slate-900/90 p-4">
              <div>
                <div className="text-[10px] font-black tracking-widest text-sky-300 uppercase">
                  {room.isPrivate ? 'Private Room Code' : 'Public Arena Room'}
                </div>
                <div className="mt-0.5 flex items-center gap-3">
                  <span
                    data-testid="mp-active-room-code"
                    className="font-mono text-2xl font-black tracking-widest text-amber-300"
                  >
                    {room.roomCode}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyCode()}
                    className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-bold text-slate-200 uppercase hover:border-sky-400"
                  >
                    {copiedCode ? 'Copied' : 'Copy Code'}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isHost && (
                  <button
                    type="button"
                    onClick={() => client.setAiFill(!room.aiFill)}
                    className={`rounded-lg border px-3 py-2 text-xs font-black uppercase ${
                      room.aiFill
                        ? 'border-sky-400 bg-sky-500/20 text-sky-100'
                        : 'border-slate-700 bg-slate-950 text-slate-300'
                    }`}
                  >
                    AI Fill: {room.aiFill ? 'On' : 'Off'}
                  </button>
                )}

                <button
                  type="button"
                  data-testid="mp-ready-btn"
                  onClick={() => client.setReady(!meInRoom?.ready)}
                  className={`rounded-lg border px-4 py-2 text-xs font-black uppercase ${
                    meInRoom?.ready
                      ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                      : 'border-amber-400 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                  }`}
                >
                  {meInRoom?.ready ? 'Ready ✓' : 'Mark Ready'}
                </button>

                {isHost && (
                  <button
                    type="button"
                    data-testid="mp-start-match-btn"
                    disabled={!room.canStart}
                    onClick={() => client.startMatch()}
                    className="rounded-lg bg-orange-500 px-5 py-2 text-xs font-black tracking-wider text-slate-950 uppercase hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Start Match ({room.readyHumanCount}/{Math.max(2, room.humanCount)} Ready)
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => client.leaveRoom()}
                  className="rounded-lg border border-rose-500/50 bg-slate-950 px-3 py-2 text-xs font-bold text-rose-200 uppercase hover:border-rose-400"
                >
                  Leave Room
                </button>
              </div>
            </div>

            {!room.canStart && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-950/35 px-3 py-2 text-xs font-semibold text-amber-200">
                Waiting for at least 2 human players to mark Ready before the host can start (max 8 players).
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              {room.players.map((p) => {
                const vSpec = VEHICLE_CONFIGS[p.vehicleId];
                const isMe = p.id === playerId;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${
                      isMe
                        ? 'border-sky-400/70 bg-slate-900'
                        : 'border-slate-800 bg-slate-900/70'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-4 w-4 rounded-sm border border-white/40"
                        style={{ backgroundColor: p.bodyColor }}
                      />
                      <div>
                        <div className="text-xs font-black text-white">
                          {p.name}{' '}
                          {p.isHost && (
                            <span className="ml-1 text-[10px] text-amber-300 uppercase">[HOST]</span>
                          )}
                          {isMe && (
                            <span className="ml-1 text-[10px] text-sky-300 uppercase">(YOU)</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {vSpec?.name ?? p.vehicleId}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`rounded px-2 py-0.5 text-[10px] font-black uppercase ${
                        p.ready
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {p.ready ? 'Ready' : 'Not Ready'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
