/** Airwheels brand tokens (PRD 26). Single source for web, admin, widget and driver app. */
export const brand = {
  coral: '#FF4D3D',
  ink: '#14141A',
  cloud: '#F4F5F7',
  slate: '#6B7280',
  white: '#FFFFFF',
} as const;

export const fontFamily = {
  sans: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 } as const;

/** Per-airline theme. Widget and tracking page render in the airline's colours (CHN-01). */
export interface AirlineTheme {
  primary: string;
  primaryForeground: string;
  background: string;
  foreground: string;
  muted: string;
  fontFamily: string;
  logoUrl?: string;
  serviceName: string;
}

export const airwheelsTheme: AirlineTheme = {
  primary: brand.coral,
  primaryForeground: brand.white,
  background: brand.white,
  foreground: brand.ink,
  muted: brand.slate,
  fontFamily: fontFamily.sans,
  serviceName: 'Airwheels',
};

/** Merge an airline's partial theme over the Airwheels default. */
export const resolveTheme = (partial?: Partial<AirlineTheme>): AirlineTheme => ({
  ...airwheelsTheme,
  ...partial,
});

/** CSS custom properties for a theme, e.g. inside the widget's shadow root. */
export const themeToCssVars = (t: AirlineTheme): Record<string, string> => ({
  '--aw-primary': t.primary,
  '--aw-primary-fg': t.primaryForeground,
  '--aw-bg': t.background,
  '--aw-fg': t.foreground,
  '--aw-muted': t.muted,
  '--aw-font': t.fontFamily,
});

/** Required mark under the transfer step and in the tracking page footer (CHN-13). */
export const POWERED_BY = 'Powered by Airwheels';
export const OPERATOR_NAME = 'Airwheels Technologies Limited';
