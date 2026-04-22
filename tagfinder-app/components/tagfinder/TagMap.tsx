'use client';

import { useEffect, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle,
  Polygon,
  Polyline,
  Popup,
  useMap,
} from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AnalysisResult, ArgosFix } from '@/lib/types';
import { MARKER_COLORS } from '@/lib/constants';

interface TagMapProps {
  result: AnalysisResult;
  style?: React.CSSProperties;
}

export default function TagMap({ result, style }: TagMapProps) {
  const center: [number, number] = [result.bestLat, result.bestLon];

  return (
    <MapContainer
      center={center}
      zoom={13}
      style={{ height: '500px', borderRadius: '12px', ...style }}
      className="z-0"
    >
      {/* Esri World Imagery */}
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri"
        maxZoom={19}
      />
      {/* Esri Reference labels */}
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
      />

      {/* Search radius circles */}
      <Circle
        center={center}
        radius={result.expandedRadiusM}
        pathOptions={{
          color: MARKER_COLORS.searchExpanded,
          weight: 2,
          dashArray: '8,6',
          fillOpacity: 0.05,
        }}
      />
      <Circle
        center={center}
        radius={result.primaryRadiusM}
        pathOptions={{
          color: MARKER_COLORS.searchPrimary,
          weight: 3,
          dashArray: '10,6',
          fillOpacity: 0.08,
        }}
      />

      {/* BCEE ellipse (popoff) */}
      {result.popoff && (
        <BCEEEllipse popoff={result.popoff} />
      )}

      {/* Drift prediction cone */}
      {result.driftPrediction && (
        <DriftCone result={result} />
      )}

      {/* Fix markers */}
      {result.allFixes.map((fix, i) => (
        <FixMarker key={i} fix={fix} />
      ))}

      {/* Popoff estimate marker */}
      {result.popoff && (
        <CircleMarker
          center={[result.popoff.lat, result.popoff.lon]}
          radius={10}
          pathOptions={{
            fillColor: MARKER_COLORS.popoff.fill,
            color: MARKER_COLORS.popoff.border,
            weight: 3,
            fillOpacity: 0.9,
          }}
        >
          <Popup>
            <strong>Popoff Estimate (P₀)</strong>
            <br />
            {result.popoff.lat.toFixed(4)}°, {result.popoff.lon.toFixed(4)}°
            <br />
            <em>{result.popoff.method}</em>
          </Popup>
        </CircleMarker>
      )}

      {/* Best estimate marker (on top) */}
      <CircleMarker
        center={center}
        radius={10}
        pathOptions={{
          fillColor: MARKER_COLORS.current.fill,
          color: MARKER_COLORS.current.border,
          weight: 3,
          fillOpacity: 0.9,
        }}
      >
        <Popup>
          <strong>Best Estimate</strong>
          <br />
          {result.bestLat.toFixed(4)}°, {result.bestLon.toFixed(4)}°
        </Popup>
      </CircleMarker>

      <AutoFitBounds result={result} />
    </MapContainer>
  );
}

function FixMarker({ fix }: { fix: ArgosFix }) {
  const colors = getFixColors(fix);
  const radius = fix.quality === '3' || fix.quality === '2' ? 7 : 5;

  return (
    <CircleMarker
      center={[fix.latitude, fix.longitude]}
      radius={fix.isOutlier ? 4 : radius}
      pathOptions={{
        fillColor: colors.fill,
        color: colors.border,
        weight: fix.isOutlier ? 1 : 2,
        fillOpacity: fix.isOutlier ? 0.3 : 0.7,
      }}
    >
      <Popup>
        <strong>Q{fix.quality}</strong> fix
        <br />
        {fix.date.toISOString().replace('T', ' ').slice(0, 19)} UTC
        <br />
        {fix.latitude.toFixed(4)}°, {fix.longitude.toFixed(4)}°
        <br />
        Error: {fix.effectiveError.toFixed(0)}m
        {fix.isOutlier && <><br /><em style={{ color: 'red' }}>Outlier — excluded</em></>}
      </Popup>
    </CircleMarker>
  );
}

function getFixColors(fix: ArgosFix) {
  if (fix.isOutlier) return MARKER_COLORS.outlier;
  switch (fix.quality) {
    case '3': return MARKER_COLORS.q3;
    case '2': return MARKER_COLORS.q2;
    case '1':
    case 'A': return MARKER_COLORS.q1a;
    default: return MARKER_COLORS.b;
  }
}

function BCEEEllipse({ popoff }: { popoff: NonNullable<AnalysisResult['popoff']> }) {
  const points = useMemo(() => {
    // Generate ellipse polygon points
    const numPoints = 72;
    const pts: [number, number][] = [];
    const orientRad = (popoff.ellipseOrientationDeg * Math.PI) / 180;

    for (let i = 0; i < numPoints; i++) {
      const angle = (2 * Math.PI * i) / numPoints;
      // Ellipse in local coords (meters)
      const x = popoff.ellipseSemiMajorM * Math.cos(angle);
      const y = popoff.ellipseSemiMinorM * Math.sin(angle);
      // Rotate by orientation
      const rx = x * Math.cos(orientRad) - y * Math.sin(orientRad);
      const ry = x * Math.sin(orientRad) + y * Math.cos(orientRad);
      // Convert meters offset to degrees (approximate)
      const dLat = ry / 111320;
      const dLon = rx / (111320 * Math.cos((popoff.lat * Math.PI) / 180));
      pts.push([popoff.lat + dLat, popoff.lon + dLon]);
    }
    return pts;
  }, [popoff]);

  return (
    <Polygon
      positions={points}
      pathOptions={{
        color: MARKER_COLORS.bcee,
        weight: 2,
        fillOpacity: 0.15,
        fillColor: MARKER_COLORS.bcee,
      }}
    />
  );
}

function DriftCone({ result }: { result: AnalysisResult }) {
  const pred = result.driftPrediction;
  if (!pred || pred.predictions.length === 0) return null;

  // Build cone polygon: centerline + expanding widths
  const lastFix = result.validFixes[result.validFixes.length - 1];
  if (!lastFix) return null;

  const leftEdge: [number, number][] = [[lastFix.latitude, lastFix.longitude]];
  const rightEdge: [number, number][] = [[lastFix.latitude, lastFix.longitude]];

  for (const p of pred.predictions) {
    const offsetDeg = p.uncertaintyRadiusKm / 111.32;
    const headingRad = (pred.headingDeg * Math.PI) / 180;
    const perpRad = headingRad + Math.PI / 2;

    const dLatL = offsetDeg * Math.cos(perpRad);
    const dLonL = offsetDeg * Math.sin(perpRad) / Math.cos((p.lat * Math.PI) / 180);
    const dLatR = -dLatL;
    const dLonR = -dLonL;

    leftEdge.push([p.lat + dLatL, p.lon + dLonL]);
    rightEdge.push([p.lat + dLatR, p.lon + dLonR]);
  }

  const conePositions = [...leftEdge, ...rightEdge.reverse()];

  const centerline: [number, number][] = [
    [lastFix.latitude, lastFix.longitude],
    ...pred.predictions.map((p) => [p.lat, p.lon] as [number, number]),
  ];

  return (
    <>
      <Polygon
        positions={conePositions}
        pathOptions={{
          color: MARKER_COLORS.searchExpanded,
          weight: 1,
          fillOpacity: 0.1,
          fillColor: MARKER_COLORS.searchExpanded,
          dashArray: '6,4',
        }}
      />
      <Polyline
        positions={centerline}
        pathOptions={{
          color: MARKER_COLORS.searchExpanded,
          weight: 2,
          dashArray: '8,6',
        }}
      />
    </>
  );
}

function AutoFitBounds({ result }: { result: AnalysisResult }) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [];

    // All non-outlier fixes
    for (const fix of result.validFixes) {
      points.push([fix.latitude, fix.longitude]);
    }

    // Best estimate
    points.push([result.bestLat, result.bestLon]);

    // Popoff
    if (result.popoff) {
      points.push([result.popoff.lat, result.popoff.lon]);
    }

    // Predictions
    if (result.driftPrediction) {
      for (const p of result.driftPrediction.predictions) {
        points.push([p.lat, p.lon]);
      }
    }

    if (points.length > 0) {
      const bounds: LatLngBoundsExpression = points as [number, number][];
      // Zoom out a bit more so recovery teams see surrounding context
      // (coastline, roads, terrain). Cap at zoom 15 even for tight clusters.
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
    }
  }, [result, map]);

  return null;
}
