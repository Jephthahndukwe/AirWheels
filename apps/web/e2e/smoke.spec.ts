import { expect, test } from '@playwright/test';

test('booking page shows the transfer form and the Airwheels mark', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Add an airport transfer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'See price' })).toBeVisible();
  await expect(page.getByText('Powered by Airwheels')).toBeVisible();
});

test('an unknown tracking link shows a friendly not-found page', async ({ page }) => {
  await page.goto('/t/not-a-real-token');
  await expect(page.getByText('We could not find that booking')).toBeVisible();
});
