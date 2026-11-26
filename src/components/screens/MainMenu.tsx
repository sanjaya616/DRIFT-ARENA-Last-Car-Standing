import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { ScreenId } from '../../types/game';
import {
  fetchLeaderboard,
  fetchUserMatchHistory,
  type MatchHistorySummary,
  type RacerProfile,
} from '../../firebase/profileService';
import { VEHICLE_CONFIGS } from '../../cars/vehicleConfigs';

interface MainMenuProps {
  bestScore: number;
  user: User | null;
  profile: RacerProfile | null;
  authBusy: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onMenuClick: () => void;
  onQuickPlay: () => void;
  onNavigate: (screen: ScreenId) => void;
}

export function MainMenu({
  bestScore,
  user,
  profile,
  authBusy,
  onSignIn,
  onSignOut,
  onMenuClick,
  onQuickPlay,
  onNavigate,
}: MainMenuProps) {
  const [boardOpen, setBoardOpen] = useState(false);
  const [boardTab, setBoardTab] = useState<'leaders' | 'history'>('leaders');
  const [leaders, setLeaders] = useState<RacerProfile[]>([]);
  const [history, setHistory] = useState<MatchHistorySummary[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (boardOpen) {
        if (e.code === 'Escape') setBoardOpen(false);
        return;
      }
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onMenuClick();
        onQuickPlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boardOpen, onMenuClick, onQuickPlay]);

  const openLeaderboard = async () => {
    onMenuClick();
    setBoardOpen(true);
    setLoadingBoard(true);
    setBoardError(null);
    try {
      const top = await fetchLeaderboard(12);
      setLeaders(top);
      if (user) {
        const hist = await fetchUserMatchHistory(user.uid, 10);
        setHistory(hist);
      } else {
        setHistory([]);
      }
    } catch {
      setBoardError('Unable to load leaderboard right now.');
    } finally {
      setLoadingBoard(false);
    }
  };

  const displayBest = Math.max(bestScore, profile?.bestScore ?? 0);

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-5 sm:p-8">
      {/* Top-Right Compact Account & Leaderboard Bar */}
      <div className="pointer-events-auto flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void openLeaderboard()}
          className="rounded-lg border border-slate-600/70 bg-slate-950/92 px-3.5 py-2 text-xs font-black tracking-wider text-amber-300 uppercase shadow-lg hover:border-amber-400"
        >
          Leaderboard
        </button>

        {user ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-sky-500/45 bg-slate-950/92 px-3 py-1.5 shadow-lg">
            <div className="text-right">
              <div className="text-xs font-black text-white">
                {profile?.displayName || user.displayName || 'Driver'}
              </div>
              <div className="tabular-nums text-[10px] font-bold text-sky-300 uppercase">
                {profile?.wins ?? 0} Wins · {profile?.eliminations ?? 0} KOs
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onMenuClick();
                onSignOut();
              }}
              className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-bold text-slate-300 uppercase hover:border-rose-400 hover:text-white"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={authBusy}
            onClick={() => {
              onMenuClick();
              onSignIn();
            }}
            className="rounded-lg border border-sky-400/70 bg-slate-950/92 px-3.5 py-2 text-xs font-black tracking-wider text-sky-200 uppercase shadow-lg hover:border-sky-300 hover:text-white disabled:opacity-60"
          >
            {authBusy ? 'Signing In...' : 'Google Sign In'}
          </button>
        )}
      </div>

      {/* Left-third menu column leaving central/right 3D Arena flyover unobstructed */}
      <div className="my-auto flex max-w-[420px] flex-col gap-5">
        <div className="pointer-events-auto">
          <svg
            viewBox="0 0 380 112"
            className="w-full max-w-[340px] drop-shadow-[0_6px_14px_rgba(0,0,0,0.65)]"
            role="img"
            aria-label="DRIFT ARENA – Last Car Standing"
          >
            <polygon
              points="14,10 368,10 352,66 2,66"
              fill="#0f172a"
              stroke="#f97316"
              strokeWidth="3"
            />
            <polygon points="18,14 48,14 34,62 4,62" fill="#f97316" />
            <text
              x="58"
              y="49"
              fill="#f8fafc"
              fontSize="34"
              fontWeight="900"
              fontStyle="italic"
              letterSpacing="2"
              fontFamily="Inter, system-ui, sans-serif"
            >
              DRIFT ARENA
            </text>
            <polygon points="44,72 344,72 336,102 36,102" fill="#1e293b" stroke="#38bdf8" strokeWidth="2" />
            <text
              x="190"
              y="92"
              textAnchor="middle"
              fill="#7dd3fc"
              fontSize="14"
              fontWeight="800"
              letterSpacing="4"
              fontFamily="Inter, system-ui, sans-serif"
            >
              LAST CAR STANDING
            </text>
          </svg>
        </div>

        <div className="pointer-events-auto flex flex-col gap-2.5 rounded-xl border border-slate-600/50 bg-slate-950/92 p-4 shadow-2xl">
          <button
            type="button"
            data-start="true"
            onClick={() => {
              onMenuClick();
              onQuickPlay();
            }}
            className="flex w-full items-center justify-between rounded-lg bg-orange-500 px-5 py-3.5 text-left text-base font-black tracking-wider text-slate-950 uppercase shadow-lg transition-colors hover:bg-orange-400 active:scale-[0.99]"
          >
            <span>Play Arena</span>
            <span className="text-xs font-extrabold opacity-80">ENTER</span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onMenuClick();
                onNavigate('singleplayer');
              }}
              className="whitespace-nowrap rounded-lg border border-slate-600/70 bg-slate-900/90 px-3 py-2.5 text-left text-xs font-bold tracking-wider text-slate-100 uppercase transition-colors hover:border-sky-400 hover:text-white"
            >
              Single Player
            </button>
            <button
              type="button"
              onClick={() => {
                onMenuClick();
                onNavigate('multiplayer');
              }}
              className="whitespace-nowrap rounded-lg border border-sky-500/60 bg-slate-900/90 px-3 py-2.5 text-left text-xs font-bold tracking-wider text-sky-200 uppercase transition-colors hover:border-sky-300 hover:text-white"
            >
              Online Multiplayer
            </button>
            <button
              type="button"
              onClick={() => {
                onMenuClick();
                onNavigate('garage');
              }}
              className="rounded-lg border border-slate-600/70 bg-slate-900/90 px-3.5 py-2.5 text-left text-xs font-bold tracking-wider text-slate-100 uppercase transition-colors hover:border-amber-400 hover:text-white"
            >
              Car Garage
            </button>
            <button
              type="button"
              onClick={() => {
                onMenuClick();
                onNavigate('settings');
              }}
              className="rounded-lg border border-slate-600/70 bg-slate-900/90 px-3.5 py-2.5 text-left text-xs font-bold tracking-wider text-slate-100 uppercase transition-colors hover:border-slate-300 hover:text-white"
            >
              Settings
            </button>
          </div>

          {displayBest > 0 && (
            <div className="mt-1 flex items-center justify-between border-t border-slate-800 pt-2 text-xs text-slate-400">
              <span className="font-semibold uppercase tracking-wider">Best Score</span>
              <span className="tabular-nums font-black text-amber-300">{displayBest}</span>
            </div>
          )}
        </div>
      </div>

      <div className="text-center text-xs font-semibold tracking-wide text-slate-200 hud-text-stroke">
        W/S Drive · A/D Steer · Space Drift · Shift Nitro · E Jump · F Weapon · Q Ability · Esc Pause
      </div>

      {/* Leaderboard & Match History Modal */}
      {boardOpen && (
        <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-600 bg-slate-950 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-lg font-black tracking-wider text-white uppercase">
                  Arena Leaderboard & Career
                </h2>
                <p className="text-xs text-slate-400">
                  Top drivers and personal match results saved to Firestore
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBoardOpen(false)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-400"
              >
                Close
              </button>
            </div>

            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setBoardTab('leaders')}
                className={`rounded-lg border px-3 py-1.5 text-xs font-black uppercase ${
                  boardTab === 'leaders'
                    ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                Global Top Drivers
              </button>
              <button
                type="button"
                onClick={() => setBoardTab('history')}
                className={`rounded-lg border px-3 py-1.5 text-xs font-black uppercase ${
                  boardTab === 'history'
                    ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                My Match History
              </button>
            </div>

            {loadingBoard ? (
              <div className="py-8 text-center text-xs font-bold text-slate-400 uppercase">
                Loading rankings...
              </div>
            ) : boardError ? (
              <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
                {boardError}
              </div>
            ) : boardTab === 'leaders' ? (
              <div className="max-h-72 overflow-y-auto">
                {leaders.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    No recorded leaderboard entries yet. Sign in and finish a match!
                  </div>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 text-[10px] font-bold text-slate-400 uppercase">
                      <tr>
                        <th className="py-1.5">#</th>
                        <th className="py-1.5">Driver</th>
                        <th className="py-1.5">Car</th>
                        <th className="py-1.5 text-right">Wins</th>
                        <th className="py-1.5 text-right">KOs</th>
                        <th className="py-1.5 text-right">Best</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {leaders.map((row, idx) => (
                        <tr key={row.uid} className="text-slate-200">
                          <td className="py-2 font-black text-amber-300 tabular-nums">{idx + 1}</td>
                          <td className="py-2 font-bold">{row.displayName}</td>
                          <td className="py-2 text-slate-400">
                            {VEHICLE_CONFIGS[row.favoriteVehicle]?.name ?? row.favoriteVehicle}
                          </td>
                          <td className="py-2 text-right tabular-nums text-emerald-300">{row.wins}</td>
                          <td className="py-2 text-right tabular-nums text-rose-300">{row.eliminations}</td>
                          <td className="py-2 text-right font-black tabular-nums text-white">{row.bestScore}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : !user ? (
              <div className="py-6 text-center text-xs text-slate-300">
                Sign in with Google to view your personal match history.
              </div>
            ) : history.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400">
                No matches recorded yet. Complete a match while signed in!
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-2">
                {history.map((m) => (
                  <div
                    key={m.matchId}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-2 text-xs"
                  >
                    <div>
                      <div className="font-black text-white uppercase">
                        #{m.placement}/{m.playersCount} · {m.mode.replace('_', ' ')}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {VEHICLE_CONFIGS[m.vehicleId]?.name ?? m.vehicleId} · Room {m.roomCode}
                      </div>
                    </div>
                    <div className="text-right tabular-nums">
                      <div className={m.won ? 'font-black text-emerald-300' : 'font-bold text-amber-300'}>
                        {m.score} PTS
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {m.eliminations} KOs · {m.durationSec}s
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
