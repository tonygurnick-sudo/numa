// Simulating react-i18next behavior with defaultValue
const translations = {
  admin: {
    title: 'Voice Admin',
  },
};

function t(key, options = {}) {
  const keys = key.split('.');
  let value = translations;
  for (const k of keys) {
    value = value?.[k];
  }
  return value ?? options.defaultValue ?? key;
}

console.log('Test 1 - Existing key:', t('admin.title')); // Should return "Voice Admin"
console.log('Test 2 - Missing key with defaultValue:', t('admin.instance', { defaultValue: 'Instance' })); // Should return "Instance"
console.log('Test 3 - Missing key no defaultValue:', t('admin.missing')); // Should return "admin.missing"
