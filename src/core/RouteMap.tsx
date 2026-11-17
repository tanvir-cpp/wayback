import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Polyline, Text as SvgText } from 'react-native-svg';
import { Pt } from './path';

export const COLORS = { paper: '#0A0A0B', ink: '#F5F5F4', mute: '#8B8B90', rule: '#2A2A2E', accent: '#7CF5C8', green: '#7CF5C8' };

interface Props {
  path: Pt[];
  ghost: Pt[];
  floor: number; // floor being viewed
  heading: number | null;
  returning: boolean;
}

/** Groups consecutive points on `floor` into separate runs (a floor change breaks the line). */
function runs(path: Pt[], floor: number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of path) {
    if (p.floor === floor) cur.push(p);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

export default function RouteMap({ path, ghost, floor, heading, returning }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const geo = useMemo(() => {
    const all = (ghost.length ? ghost : path).concat(path).filter((p) => p.floor === floor);
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 0);
    const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 0);
    const span = Math.max(maxX - minX, maxY - minY, 20) * 1.3; // metres shown, with margin
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, span };
  }, [path, ghost, floor]);

  const { w, h } = size;
  const k = Math.min(w, h) / geo.span; // px per metre
  const sx = (x: number) => w / 2 + (x - geo.cx) * k;
  const sy = (y: number) => h / 2 - (y - geo.cy) * k; // north is up
  const toStr = (r: Pt[]) => r.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');

  const here = path[path.length - 1];
  const start = path[0];
  const gridStep = geo.span > 120 ? 50 : geo.span > 40 ? 10 : 5;
  const gx0 = Math.ceil((geo.cx - geo.span) / gridStep) * gridStep;
  const gy0 = Math.ceil((geo.cy - geo.span) / gridStep) * gridStep;
  const dots: [number, number][] = [];
  for (let x = gx0; x < geo.cx + geo.span; x += gridStep) for (let y = gy0; y < geo.cy + geo.span; y += gridStep) dots.push([x, y]);

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      {w > 0 && (
        <Svg width={w} height={h}>
          {dots.map(([x, y]) => (
            <Circle key={`${x},${y}`} cx={sx(x)} cy={sy(y)} r={1.2} fill={COLORS.rule} />
          ))}
          {/* Where you've been; fades away as you retrace it */}
          {returning && runs(ghost, floor).map((r, i) => (
            <Polyline key={`g${i}`} points={toStr(r)} stroke={COLORS.rule} strokeWidth={2} strokeDasharray="2,5" strokeLinecap="round" fill="none" />
          ))}
          {runs(path, floor).map((r, i) => (
            <Polyline
              key={`p${i}`}
              points={toStr(r)}
              stroke={returning ? COLORS.accent : COLORS.ink}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
          {/* Floor changes */}
          {(returning ? ghost : path).map((p, i, a) =>
            p.transition && p.floor === floor ? (
              <SvgText key={`t${i}`} x={sx(p.x)} y={sy(p.y) + 5} fontSize={16} fontWeight="700" textAnchor="middle" fill={COLORS.accent}>
                {p.floor > (a[i - 1]?.floor ?? p.floor) ? '↑' : '↓'}
              </SvgText>
            ) : null,
          )}
          {/* Exit: the exact spot you started */}
          {start && floor === start.floor && (
            <G>
              <Circle cx={sx(start.x)} cy={sy(start.y)} r={11} fill={COLORS.paper} stroke={COLORS.green} strokeWidth={3} />
              <Circle cx={sx(start.x)} cy={sy(start.y)} r={4} fill={COLORS.green} />
            </G>
          )}
          {/* You */}
          {here && floor === here.floor && (
            <G rotation={heading ?? 0} originX={sx(here.x)} originY={sy(here.y)}>
              <Polygon
                points={`${sx(here.x)},${sy(here.y) - 16} ${sx(here.x) + 9},${sy(here.y) + 8} ${sx(here.x)},${sy(here.y) + 3} ${sx(here.x) - 9},${sy(here.y) + 8}`}
                fill={COLORS.ink}
                stroke={COLORS.paper}
                strokeWidth={2}
              />
            </G>
          )}
          <G>
            <Line x1={w - 28} y1={44} x2={w - 28} y2={24} stroke={COLORS.mute} strokeWidth={2} />
            <SvgText x={w - 28} y={18} fontSize={12} fill={COLORS.mute} textAnchor="middle">N</SvgText>
          </G>
        </Svg>
      )}
    </View>
  );
}
