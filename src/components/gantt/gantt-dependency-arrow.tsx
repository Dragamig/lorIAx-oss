"use client";

interface GanttDependencyArrowProps {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  color: string;
  highlighted: boolean;
  opacity?: number;
}

export function GanttDependencyArrow({
  sourceX,
  sourceY,
  targetX,
  targetY,
  color,
  highlighted,
  opacity = 0.6,
}: GanttDependencyArrowProps) {
  const dx = targetX - sourceX;
  const cx1 = sourceX + Math.max(dx * 0.4, 20);
  const cy1 = sourceY;
  const cx2 = targetX - Math.max(dx * 0.4, 20);
  const cy2 = targetY;

  const markerId = `arrow-${Math.round(sourceX)}-${Math.round(sourceY)}-${Math.round(targetX)}-${Math.round(targetY)}`;

  return (
    <g>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 6 4"
          refX="6"
          refY="2"
          markerWidth="5"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 6 2 L 0 4 Z" fill={color} />
        </marker>
      </defs>
      <path
        d={`M ${sourceX},${sourceY} C ${cx1},${cy1} ${cx2},${cy2} ${targetX},${targetY}`}
        fill="none"
        stroke={color}
        strokeWidth={highlighted ? 2 : 1.5}
        strokeOpacity={highlighted ? 1 : opacity}
        markerEnd={`url(#${markerId})`}
        className="pointer-events-none"
      />
    </g>
  );
}
