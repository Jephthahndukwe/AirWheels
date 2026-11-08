'use client';

import type { Place } from '@airwheels/types';
import { useEffect, useRef, useState } from 'react';
import { Input, Label } from '@/components/ui/input';
import { API_URL, cn } from '@/lib/utils';

export interface PickedAddress {
  text: string;
  location: { lat: number; lng: number };
  landmark?: string;
}

/** Lagos box for the pin-drop map. Area dots help people find their way without map tiles. */
const BOX = { north: 6.66, south: 6.4, west: 3.24, east: 3.66 };
const AREAS: [string, number, number][] = [
  ['Ikeja', 6.6, 3.35],
  ['Ikorodu', 6.62, 3.51],
  ['Surulere', 6.5, 3.35],
  ['Yaba', 6.51, 3.37],
  ['Festac', 6.467, 3.283],
  ['V.I.', 6.428, 3.422],
  ['Ikoyi', 6.45, 3.435],
  ['Lekki', 6.447, 3.472],
  ['Ajah', 6.468, 3.585],
  ['Airport', 6.577, 3.321],
];
const toXY = (lat: number, lng: number) => ({
  x: ((lng - BOX.west) / (BOX.east - BOX.west)) * 100,
  y: ((BOX.north - lat) / (BOX.north - BOX.south)) * 60,
});

/**
 * Address entry (CHN-07): Places search, "use my location", a pin you can drop on a small map of
 * Lagos, and a landmark note. Plain SVG, no map library, so it stays fast on low-end phones.
 */
export function AddressPicker({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: PickedAddress | null;
  onChange: (a: PickedAddress | null) => void;
}) {
  const [query, setQuery] = useState(value?.text ?? '');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API_URL}/v1/places/search?q=${encodeURIComponent(query)}`);
        if (r.ok) setResults((await r.json()) as Place[]);
      } catch {
        setResults([]);
      }
    }, 300);
  }, [query, open]);

  const pick = (p: Place) => {
    setQuery(p.description);
    setOpen(false);
    onChange({ text: p.description, location: p.location, landmark: value?.landmark });
  };

  const pin = async (lat: number, lng: number) => {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/v1/places/reverse?lat=${lat}&lng=${lng}`);
      const p = (await r.json()) as Place;
      setQuery(p.description);
      onChange({ text: p.description, location: { lat, lng }, landmark: value?.landmark });
    } catch {
      onChange({ text: 'Dropped pin', location: { lat, lng }, landmark: value?.landmark });
    } finally {
      setBusy(false);
    }
  };

  const useMyLocation = () => {
    setNote(null);
    if (!navigator.geolocation)
      return setNote('Your phone cannot share its location here. Search instead.');
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        void pin(Number(pos.coords.latitude.toFixed(6)), Number(pos.coords.longitude.toFixed(6))),
      () => setNote('Location is off. Search for the address or drop a pin.'),
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  };

  const onMapTap = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const lat = Number((BOX.north - fy * (BOX.north - BOX.south)).toFixed(5));
    const lng = Number((BOX.west + fx * (BOX.east - BOX.west)).toFixed(5));
    void pin(lat, lng);
  };

  const marker = value ? toXY(value.location.lat, value.location.lng) : null;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          autoComplete="off"
          placeholder="Search street, estate or landmark"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          aria-autocomplete="list"
        />
        {open && results.length > 0 && (
          <ul
            className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-background shadow"
            role="listbox"
          >
            {results.map((p) => (
              <li key={p.placeId}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => pick(p)}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">{p.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex gap-3 text-sm">
        <button
          type="button"
          className="font-medium text-primary underline"
          onClick={useMyLocation}
        >
          Use my location
        </button>
        <button
          type="button"
          className="font-medium text-primary underline"
          onClick={() => setShowMap((s) => !s)}
        >
          {showMap ? 'Hide map' : 'Drop a pin on the map'}
        </button>
        {busy && <span className="text-muted-foreground">Finding the address…</span>}
      </div>
      {note && <p className="text-sm text-coral">{note}</p>}
      {showMap && (
        <svg
          viewBox="0 0 100 60"
          className="w-full cursor-crosshair touch-manipulation rounded-md border border-border bg-muted"
          onClick={onMapTap}
          role="img"
          aria-label="Map of Lagos. Tap to drop a pin."
        >
          <path
            d="M0 47 C 20 44, 40 52, 55 47 S 85 42, 100 46 L100 60 L0 60 Z"
            className="fill-sky-200"
          />
          {AREAS.map(([name, lat, lng]) => {
            const p = toXY(lat, lng);
            return (
              <g key={name}>
                <circle cx={p.x} cy={p.y} r={0.9} className="fill-slate-500" />
                <text x={p.x + 1.4} y={p.y + 1} fontSize={2.6} className="fill-slate-600">
                  {name}
                </text>
              </g>
            );
          })}
          {marker && (
            <g>
              <circle cx={marker.x} cy={marker.y} r={1.8} className="fill-coral" />
              <circle cx={marker.x} cy={marker.y} r={3.5} className="fill-coral/30" />
            </g>
          )}
        </svg>
      )}
      <Input
        aria-label={`${label}: landmark`}
        placeholder="Landmark, e.g. opposite the filling station (optional)"
        value={value?.landmark ?? ''}
        disabled={!value}
        className={cn(!value && 'opacity-60')}
        onChange={(e) => value && onChange({ ...value, landmark: e.target.value || undefined })}
      />
    </div>
  );
}
