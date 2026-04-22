'use client';

import type { EnvironmentData } from '@/lib/types';
import { Mountain, CloudSun, Waves as WavesIcon, MapPin, Loader2 } from 'lucide-react';

interface EnvironmentPanelProps {
  data: EnvironmentData;
  loading: {
    elevation: boolean;
    weather: boolean;
    tides: boolean;
    location: boolean;
  };
}

export default function EnvironmentPanel({ data, loading }: EnvironmentPanelProps) {
  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <h3 className="font-semibold mb-4">Environmental Context</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LocationSection data={data} loading={loading.location} />
        <ElevationSection data={data} loading={loading.elevation} />
        <WeatherSection data={data} loading={loading.weather} />
        <TidesSection data={data} loading={loading.tides} />
      </div>
    </div>
  );
}

function LocationSection({ data, loading }: { data: EnvironmentData; loading: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-muted">
        <MapPin className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">Location</span>
      </div>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted" />
      ) : data.location ? (
        <div className="text-sm">{data.location.name}</div>
      ) : (
        <div className="text-sm text-muted">Not available</div>
      )}
    </div>
  );
}

function ElevationSection({ data, loading }: { data: EnvironmentData; loading: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-muted">
        <Mountain className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">Elevation</span>
      </div>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted" />
      ) : data.elevation ? (
        <div className="text-sm">
          <span className="font-mono font-medium">{data.elevation.meters.toFixed(2)} m</span>
          <span className="text-muted ml-2 text-xs">
            ({classifyLabel(data.elevation.classification)})
          </span>
        </div>
      ) : (
        <div className="text-sm text-muted">Not available</div>
      )}
    </div>
  );
}

function WeatherSection({ data, loading }: { data: EnvironmentData; loading: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-muted">
        <CloudSun className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">Weather</span>
      </div>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted" />
      ) : data.weather ? (
        <div className="text-sm space-y-0.5">
          {data.weather.temperature !== null && (
            <div>
              <span className="font-mono font-medium">{data.weather.temperature.toFixed(1)}°C</span>
              {data.weather.conditions && (
                <span className="text-muted ml-2 text-xs">{data.weather.conditions}</span>
              )}
            </div>
          )}
          {data.weather.windSpeed !== null && (
            <div className="text-xs text-muted">
              Wind {data.weather.windDirection} {data.weather.windSpeed.toFixed(0)} km/h
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted">Not available</div>
      )}
    </div>
  );
}

function TidesSection({ data, loading }: { data: EnvironmentData; loading: boolean }) {
  const stateColors: Record<string, string> = {
    rising: 'text-info',
    falling: 'text-warning',
    high: 'text-info',
    low: 'text-warning',
    unknown: 'text-muted',
  };

  return (
    <div className="md:col-span-2">
      <div className="flex items-center gap-2 mb-2 text-muted">
        <WavesIcon className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">Tides</span>
      </div>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted" />
      ) : data.tides ? (
        <div className="text-sm space-y-1">
          <div className="flex items-baseline gap-2">
            <span className={`font-medium capitalize ${stateColors[data.tides.current]}`}>
              {data.tides.current}
            </span>
            {data.tides.tidalRange !== null && (
              <span className="text-xs text-muted">
                (range: {data.tides.tidalRange.toFixed(1)} ft)
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted">
            {data.tides.nextHigh && (
              <div>
                <span className="text-info">▲ High:</span> {formatTime(data.tides.nextHigh.time)}{' '}
                <span className="font-mono">({data.tides.nextHigh.height.toFixed(1)} ft)</span>
              </div>
            )}
            {data.tides.nextLow && (
              <div>
                <span className="text-warning">▼ Low:</span> {formatTime(data.tides.nextLow.time)}{' '}
                <span className="font-mono">({data.tides.nextLow.height.toFixed(1)} ft)</span>
              </div>
            )}
          </div>
          <div className="text-xs text-muted opacity-70">
            Station: {data.tides.station} ({data.tides.stationDistanceKm.toFixed(1)} km away)
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted">
          Not available (outside US waters or no nearby station)
        </div>
      )}
    </div>
  );
}

function classifyLabel(c: 'land' | 'intertidal' | 'water'): string {
  if (c === 'land') return 'on land';
  if (c === 'intertidal') return 'intertidal';
  return 'open water';
}

function formatTime(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
