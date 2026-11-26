import {
  WORLD_HALF_METERS,
  WORLD_SIZE_METERS,
  type DrawbridgePhase,
  type MinimapActor,
  type MinimapObstacle,
} from '../types/game';
import { CONNECTED_ROADS, DISTRICT_BOUNDS } from '../maps/neonHarborLayout';

interface MiniMapProps {
  obstacles: MinimapObstacle[];
  actors: MinimapActor[];
  drawbridgePhase: DrawbridgePhase;
  safeZoneRadiusMeters?: number;
}

export function MiniMap({
  obstacles,
  actors,
  drawbridgePhase,
  safeZoneRadiusMeters = 425,
}: MiniMapProps) {
  const size = 118;
  const toMap = (val: number) =>
    ((val + WORLD_HALF_METERS) / WORLD_SIZE_METERS) * size;
  const scaleLen = (len: number) => (len / WORLD_SIZE_METERS) * size;

  const bridgeColor =
    drawbridgePhase === 'closed'
      ? '#22c55e'
      : drawbridgePhase === 'warning'
        ? '#f59e0b'
        : '#ef4444';

  const showSafeZone = safeZoneRadiusMeters < 400;

  return (
    <div
      className="relative h-[86px] w-[86px] sm:h-[118px] sm:w-[118px] overflow-hidden rounded-lg border border-slate-500/50 bg-slate-950/90 shadow-lg"
      aria-label="NEON HARBOR Mini-Map"
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full block">
        {/* Base ground */}
        <rect x={0} y={0} width={size} height={size} fill="#141c27" />

        {/* Subtle 5-District zone tints */}
        {DISTRICT_BOUNDS.map((d) => (
          <rect
            key={d.id}
            x={toMap(d.minX)}
            y={toMap(d.minZ)}
            width={scaleLen(d.maxX - d.minX)}
            height={scaleLen(d.maxZ - d.minZ)}
            fill={d.color}
            fillOpacity={0.07}
          />
        ))}

        {/* River (East Harbor X=147.5..182.5, Z=-295..+95) */}
        <rect
          x={toMap(147.5)}
          y={toMap(-295)}
          width={scaleLen(35)}
          height={scaleLen(390)}
          fill="#0369a1"
          fillOpacity={0.8}
        />

        {/* Connected Road Network across 600m */}
        {CONNECTED_ROADS.map((r, idx) => (
          <rect
            key={idx}
            x={toMap(r.x - r.w * 0.5)}
            y={toMap(r.z - r.d * 0.5)}
            width={Math.max(1.5, scaleLen(r.w))}
            height={Math.max(1.5, scaleLen(r.d))}
            fill="#334155"
          />
        ))}

        {/* Downtown Roundabout Plaza */}
        <circle cx={toMap(0)} cy={toMap(0)} r={scaleLen(28)} fill="#3b495e" />

        {/* Animated Drawbridge indicator */}
        <rect
          x={toMap(135)}
          y={toMap(-9)}
          width={scaleLen(60)}
          height={Math.max(3, scaleLen(18))}
          fill={bridgeColor}
        />

        {/* Railway track line */}
        <line
          x1={toMap(195)}
          y1={toMap(75)}
          x2={toMap(195)}
          y2={toMap(295)}
          stroke="#94a3b8"
          strokeWidth={1.6}
          strokeDasharray="2.5 2"
        />

        {/* Buildings, ramps & stunts */}
        {obstacles.map((obs, idx) => {
          const w = Math.max(1.8, scaleLen(obs.w));
          const d = Math.max(1.8, scaleLen(obs.d));
          const fill =
            obs.kind === 'building'
              ? '#64748b'
              : obs.kind === 'ramp'
                ? '#f59e0b'
                : obs.kind === 'stunt'
                  ? '#ec4899'
                  : '#ef4444';
          return (
            <rect
              key={idx}
              x={toMap(obs.x) - w / 2}
              y={toMap(obs.z) - d / 2}
              width={w}
              height={d}
              fill={fill}
              rx={0.6}
            />
          );
        })}

        {/* Shrinking Safe Zone Boundary */}
        {showSafeZone && (
          <circle
            cx={toMap(0)}
            cy={toMap(0)}
            r={Math.max(4, scaleLen(safeZoneRadiusMeters))}
            fill="none"
            stroke="#fb7185"
            strokeWidth={1.6}
            strokeDasharray="3 2"
          />
        )}

        {/* Pickups, Hazards, Rivals & Moving Freight Train */}
        {actors.map((act) => {
          if (!act.alive || act.kind === 'player') return null;
          const cx = toMap(act.x);
          const cy = toMap(act.z);
          if (act.kind === 'train') {
            return (
              <rect
                key={act.id}
                x={cx - 1.8}
                y={cy - scaleLen(24)}
                width={3.6}
                height={scaleLen(48)}
                fill="#f97316"
                stroke="#ffffff"
                strokeWidth={0.6}
              />
            );
          }
          if (act.kind === 'hazard') {
            return (
              <rect
                key={act.id}
                x={cx - 1.5}
                y={cy - 1.5}
                width={3}
                height={3}
                fill={act.color}
                transform={`rotate(45 ${cx} ${cy})`}
              />
            );
          }
          if (act.kind === 'pickup') {
            return <circle key={act.id} cx={cx} cy={cy} r={1.8} fill={act.color} />;
          }
          return (
            <circle
              key={act.id}
              cx={cx}
              cy={cy}
              r={2.8}
              fill="#ef4444"
              stroke="#ffffff"
              strokeWidth={0.8}
            />
          );
        })}

        {/* Player directional chevron */}
        {actors
          .filter((a) => a.kind === 'player' && a.alive)
          .map((p) => {
            const px = toMap(p.x);
            const py = toMap(p.z);
            const deg = (-p.yaw * 180) / Math.PI;
            return (
              <g key={p.id} transform={`translate(${px}, ${py}) rotate(${deg})`}>
                <polygon
                  points="0,-5 3.6,4 0,2.2 -3.6,4"
                  fill="#38bdf8"
                  stroke="#0f172a"
                  strokeWidth={0.9}
                />
              </g>
            );
          })}
      </svg>
      <div className="pointer-events-none absolute bottom-0.5 right-1 text-[9px] font-bold tracking-wider text-slate-300/85">
        600m
      </div>
    </div>
  );
}

