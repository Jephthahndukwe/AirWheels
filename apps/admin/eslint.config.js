import base from '@airwheels/config/eslint';
export default [...base, { ignores: ['playwright-report/**', 'test-results/**'] }];
