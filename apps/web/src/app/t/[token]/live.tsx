'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { connectLive } from '@/lib/live';
import { API_URL } from '@/lib/utils';

type Point = { lat: number; lng: number };

/**
 * Keeps the tracking page current (TRV-04). Booking and leg changes refresh the server-rendered page;
 * driver positions move the map without a refresh. When the WebSocket is down, it polls instead.
 */
export function LiveUpdates({
  bookingId,
  token,
  pollSeconds,
}: {
  bookingId: string;
  token: string;
  pollSeconds: number;
}) {
  const router = useRouter();
  useEffect(() => {
    let socketUp = false;
    const stop = connectLive(API_URL, `booking:${bookingId}`, token, {
      onUp: () => (socketUp = true),
      onDown: () => (socketUp = false),
      onEvent: (event, payload) => {
        if (event === 'driver.location')
          window.dispatchEvent(new CustomEvent('aw:location', { detail: payload }));
        else router.refresh();
      },
    });
    const poll = setInterval(() => {
      if (!socketUp && document.visibilityState === 'visible') router.refresh();
    }, pollSeconds * 1000);
    return () => {
      stop();
      clearInterval(poll);
    };
  }, [bookingId, token, pollSeconds, router]);
  return null;
}

const Z = 15;
const tileOf = (p: Point) => {
  const n = 2 ** Z;
  const x = ((p.lng + 180) / 360) * n;
  const r = (p.lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x, y };
};

/**
 * A light live map: four OpenStreetMap tiles around the driver, with the driver and the pickup
 * marked. No map library, so it costs only the tile images, and only while the driver is moving.
 */
export function LiveMap({
  legId,
  initial,
  target,
  etaMinutes,
}: {
  legId: string;
  initial: Point | null;
  target: Point;
  etaMinutes: number | null;
}) {
  const [pos, setPos] = useState<Point | null>(initial);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ legId: string; lat: number; lng: number }>).detail;
      if (d.legId === legId) setPos({ lat: d.lat, lng: d.lng });
    };
    window.addEventListener('aw:location', on);
    return () => window.removeEventListener('aw:location', on);
  }, [legId]);
  if (!pos)
    return (
      <p className="rounded-md bg-muted p-3 text-sm">Waiting for the driver&apos;s location…</p>
    );

  const c = tileOf(pos);
  const x0 = Math.floor(c.x - 0.5);
  const y0 = Math.floor(c.y - 0.5);
  const at = (p: Point) => {
    const t = tileOf(p);
    return { left: `${((t.x - x0) / 2) * 100}%`, top: `${((t.y - y0) / 2) * 100}%` };
  };
  const t = tileOf(target);
  const targetVisible = t.x >= x0 && t.x < x0 + 2 && t.y >= y0 && t.y < y0 + 2;
  return (
    <figure className="overflow-hidden rounded-md border border-border">
      <div className="relative aspect-square w-full bg-muted">
        {[0, 1].flatMap((dy) =>
          [0, 1].map((dx) => (
            <img
              key={`${dx}${dy}`}
              alt=""
              loading="lazy"
              src={`https://tile.openstreetmap.org/${Z}/${x0 + dx}/${y0 + dy}.png`}
              className="absolute h-1/2 w-1/2"
              style={{ left: `${dx * 50}%`, top: `${dy * 50}%` }}
            />
          )),
        )}
        {targetVisible && (
          <span
            className="absolute -ml-2 -mt-2 h-4 w-4 rounded-full border-2 border-white bg-ink"
            style={at(target)}
            title="Pickup"
          />
        )}
        <span
          className="absolute -ml-3 -mt-3 h-6 w-6 rounded-full border-2 border-white bg-primary shadow"
          style={at(pos)}
          title="Driver"
        />
      </div>
      <figcaption className="flex justify-between px-3 py-2 text-sm">
        <span>{etaMinutes !== null ? `About ${etaMinutes} min away` : 'Driver is here'}</span>
        <span className="text-xs text-muted-foreground">© OpenStreetMap</span>
      </figcaption>
    </figure>
  );
}
