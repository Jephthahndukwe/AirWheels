/** Admin modules from PRD 17.1, with the milestone that builds each one (PRD 24). */
export const NAV: { href: string; label: string; milestone: string; ready?: boolean }[] = [
  { href: '/', label: 'Overview', milestone: 'M4', ready: true },
  { href: '/bookings', label: 'Bookings', milestone: 'M2', ready: true },
  { href: '/dispatch', label: 'Dispatch board', milestone: 'M4' },
  { href: '/drivers', label: 'Drivers', milestone: 'M1' },
  { href: '/vehicles', label: 'Vehicles and car partners', milestone: 'M1' },
  { href: '/airlines', label: 'Airlines', milestone: 'M5' },
  { href: '/support', label: 'Travellers and support', milestone: 'M3' },
  { href: '/flights', label: 'Flights', milestone: 'M7' },
  { href: '/pricing', label: 'Pricing', milestone: 'M2' },
  { href: '/policies', label: 'Policies', milestone: 'M7' },
  { href: '/payments', label: 'Payments', milestone: 'M2' },
  { href: '/shared', label: 'Shared rides', milestone: 'M6' },
  { href: '/staff', label: 'Staff and roles', milestone: 'M1' },
  { href: '/audit', label: 'Audit log', milestone: 'M1' },
  { href: '/settings', label: 'Settings', milestone: 'M1' },
];
