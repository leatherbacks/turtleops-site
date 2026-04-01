'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import L from 'leaflet';

interface MapObservation {
  id: string;
  turtle_name: string | null;
  encounter_date: string;
  latitude: number;
  longitude: number;
  did_she_nest: boolean | null;
  is_recapture: boolean;
  beach_sector: string | null;
  observer_name: string;
  species: string | null;
}

interface ObservationMapProps {
  observations: MapObservation[];
  onMarkerClick?: (id: string) => void;
  style?: React.CSSProperties;
}

// Custom marker colors
function getMarkerColor(obs: MapObservation): string {
  if (obs.did_she_nest) return '#10b981'; // green for nesting
  if (obs.is_recapture) return '#3b82f6'; // blue for recapture
  return '#ff5757'; // primary red for standard
}

function createCircleIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="
      width: 12px;
      height: 12px;
      background: ${color};
      border: 2px solid rgba(255,255,255,0.9);
      border-radius: 50%;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -8],
  });
}

export default function ObservationMap({ observations, onMarkerClick, style }: ObservationMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([11.18, -60.73], 14); // Default center (Trinidad area)

    // Dark tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Update markers when observations change
  useEffect(() => {
    if (!mapRef.current || !markersRef.current) return;

    markersRef.current.clearLayers();

    if (observations.length === 0) return;

    const bounds = L.latLngBounds([]);

    observations.forEach((obs) => {
      const latlng = L.latLng(obs.latitude, obs.longitude);
      bounds.extend(latlng);

      const marker = L.marker(latlng, {
        icon: createCircleIcon(getMarkerColor(obs)),
      });

      const date = new Date(obs.encounter_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      const badges = [
        obs.did_she_nest ? '<span style="color:#10b981;font-weight:600;font-size:11px">NESTED</span>' : '',
        obs.is_recapture ? '<span style="color:#3b82f6;font-weight:600;font-size:11px">RECAPTURE</span>' : '',
      ].filter(Boolean).join(' ');

      marker.bindPopup(`
        <div style="font-family:Inter,sans-serif;min-width:160px;line-height:1.5">
          <div style="font-weight:700;font-size:14px;margin-bottom:2px">${obs.turtle_name || 'Unknown'}</div>
          ${badges ? `<div style="margin-bottom:4px">${badges}</div>` : ''}
          <div style="font-size:12px;color:#666">${date}</div>
          ${obs.observer_name ? `<div style="font-size:12px;color:#666">by ${obs.observer_name}</div>` : ''}
          ${obs.beach_sector ? `<div style="font-size:12px;color:#666">Sector: ${obs.beach_sector}</div>` : ''}
          ${obs.species ? `<div style="font-size:12px;color:#666">${obs.species}</div>` : ''}
        </div>
      `, { closeButton: false });

      if (onMarkerClick) {
        marker.on('click', () => onMarkerClick(obs.id));
      }

      markersRef.current!.addLayer(marker);
    });

    if (bounds.isValid()) {
      mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }, [observations, onMarkerClick]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '500px',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        ...style,
      }}
    />
  );
}
