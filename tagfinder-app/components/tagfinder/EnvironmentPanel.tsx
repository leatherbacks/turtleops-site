'use client';

import type { EnvironmentData } from '@/lib/types';
import {
  Mountain,
  CloudSun,
  Waves as WavesIcon,
  MapPin,
  Loader2,
  AlertTriangle,
  Phone,
} from 'lucide-react';

interface EnvironmentPanelProps {
  data: EnvironmentData;
  loading: {
    elevation: boolean;
    weather: boolean;
    tides: boolean;
    location: boolean;
    forecast?: boolean;
  };
}

export default function EnvironmentPanel({ data, loading }: EnvironmentPanelProps) {
  return (
    <div className="space-y-4">
      {data.forecast?.stormAlert && <StormAlertBanner data={data} />}
      <div className="bg-surface rounded-xl border border-border p-5">
        <h3 className="font-semibold mb-4">Environmental Context</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <LocationSection data={data} loading={loading.location} />
          <ElevationSection data={data} loading={loading.elevation} />
          <WeatherSection data={data} loading={loading.weather} />
          <TidesSection data={data} loading={loading.tides} />
        </div>
        {data.forecast && !data.forecast.stormAlert && (
          <div className="mt-4 pt-4 border-t border-border">
            <ForecastSection data={data} />
          </div>
        )}
        {data.location && (
          <div className="mt-4 pt-4 border-t border-border">
            <LocalContactsSection data={data} />
          </div>
        )}
      </div>
    </div>
  );
}

function StormAlertBanner({ data }: { data: EnvironmentData }) {
  if (!data.forecast?.stormAlert) return null;
  return (
    <div className="bg-error/10 border border-error/40 rounded-xl p-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-error flex-shrink-0 mt-0.5" />
      <div>
        <div className="font-semibold text-error text-sm uppercase tracking-wide">
          Storm alert — recover ASAP
        </div>
        <div className="text-sm mt-1">
          {data.forecast.alertReason}. Tag could be washed off the beach into open
          water, making recovery much harder. Prioritize a ground search in the next
          24–48 hours before conditions deteriorate.
        </div>
      </div>
    </div>
  );
}

function ForecastSection({ data }: { data: EnvironmentData }) {
  if (!data.forecast) return null;
  const next3 = data.forecast.days.slice(0, 3);
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-muted">
        <CloudSun className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">
          3-day forecast
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        {next3.map((d) => (
          <div key={d.date} className="rounded-md bg-surface-elevated p-2">
            <div className="font-medium">{shortDate(d.date)}</div>
            {d.tempMinC !== null && d.tempMaxC !== null && (
              <div className="text-muted">
                {d.tempMinC.toFixed(0)}–{d.tempMaxC.toFixed(0)}°C
              </div>
            )}
            {d.windGustKn !== null && (
              <div className="text-muted">Wind to {d.windGustKn.toFixed(0)} kn</div>
            )}
            {d.waveMaxM !== null && (
              <div className="text-muted">Swell {d.waveMaxM.toFixed(1)} m</div>
            )}
            {d.precipitationMm !== null && d.precipitationMm > 1 && (
              <div className="text-muted">
                Rain {d.precipitationMm.toFixed(0)} mm
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LocalContactsSection({ data }: { data: EnvironmentData }) {
  if (!data.location) return null;
  const name = data.location.name;
  const encoded = encodeURIComponent(name);
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-muted">
        <Phone className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">
          Local contacts
        </span>
      </div>
      <div className="text-xs text-muted space-y-1">
        <div>
          <a
            className="underline hover:text-primary"
            href={`https://www.google.com/search?q=${encoded}+beach+patrol+phone`}
            target="_blank"
            rel="noopener"
          >
            Beach patrol / lifeguard
          </a>{' '}
          ·{' '}
          <a
            className="underline hover:text-primary"
            href={`https://www.google.com/search?q=${encoded}+parks+recreation+found+items`}
            target="_blank"
            rel="noopener"
          >
            Parks &amp; Rec / found items
          </a>
        </div>
        <div>
          <a
            className="underline hover:text-primary"
            href={`https://www.google.com/search?q=${encoded}+national+seashore+ranger+station`}
            target="_blank"
            rel="noopener"
          >
            Ranger station (if a park)
          </a>{' '}
          ·{' '}
          <a
            className="underline hover:text-primary"
            href={`https://www.google.com/search?q=${encoded}+beach+cleanup+schedule`}
            target="_blank"
            rel="noopener"
          >
            Beach cleanup / maintenance
          </a>
        </div>
      </div>
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
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
          {data.tides.nextLow && (
            <div className="text-xs text-success mt-1">
              ★ Best beach-search window: around low tide ({formatTime(
                data.tides.nextLow.time
              )}). Widest exposed sand + easiest to scan the wrack line.
            </div>
          )}
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
