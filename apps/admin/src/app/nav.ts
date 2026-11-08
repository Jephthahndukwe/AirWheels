import type { AdminRole } from '@/lib/api';

/** Admin modules from PRD 17.1, with the milestone that builds each one (PRD 24). */
export const NAV: {
  href: string;
  label: string;
  milestone: string;
  ready?: boolean;
  roles?: AdminRole[];
}[] = [
  { href: '/', label: 'Overview', milestone: 'M4', ready: true },
  { href: '/bookings', label: 'Bookings', milestone: 'M2', ready: true },
  { href: '/dispatch', label: 'Dispatch board', milestone: 'M4' },
  { href: '/drivers', label: 'Drivers', milestone: 'M1', ready: true },
  { href: '/vehicles', label: 'Vehicles and car partners', milestone: 'M1', ready: true },
  { href: '/airlines', label: 'Airlines', milestone: 'M1', ready: true },
  { href: '/support', label: 'Travellers and support', milestone: 'M3', ready: true },
  { href: '/messages', label: 'Traveller messages', milestone: 'M3', ready: true },
  { href: '/flights', label: 'Flights', milestone: 'M7' },
  { href: '/pricing', label: 'Pricing', milestone: 'M2', ready: true },
  { href: '/policies', label: 'Policies', milestone: 'M7' },
  { href: '/payments', label: 'Payments and ledger', milestone: 'M2', ready: true },
  { href: '/shared', label: 'Shared rides', milestone: 'M6' },
  {
    href: '/staff',
    label: 'Staff and roles',
    milestone: 'M1',
    ready: true,
    roles: ['SUPER_ADMIN'],
  },
  { href: '/audit', label: 'Audit log', milestone: 'M1', ready: true },
  { href: '/settings', label: 'Settings', milestone: 'M1', ready: true },
];
