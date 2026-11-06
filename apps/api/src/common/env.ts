/**
 * Development shortcuts (ACC-12). One place decides when they are allowed, and every check
 * fails closed: an unset, misspelled or unknown NODE_ENV counts as "not development".
 *
 *  - Codes on screen (invite links, invite codes, SMS codes in API responses): `development` only.
 *  - Fake providers (SMS, payments, KYC, storage...): `development`, plus `test` for the
 *    automated test runner, which never serves real users. Staging and production must use
 *    real providers, so the API refuses to start there with a fake.
 *
 * The `...Env` functions are pure (pass the value to check); the others read process.env.
 */
export const isDevelopmentEnv = (env: string | undefined): boolean => env === 'development';
export const fakeProvidersAllowedEnv = (env: string | undefined): boolean => env === 'development' || env === 'test';

export const isDevelopment = (): boolean => isDevelopmentEnv(process.env.NODE_ENV);
export const fakeProvidersAllowed = (): boolean => fakeProvidersAllowedEnv(process.env.NODE_ENV);
