export const COUNTRIES = [
  ['PK', 'Pakistan'], ['SA', 'Saudi Arabia'], ['AE', 'United Arab Emirates'], ['IN', 'India'],
  ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'],
  ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'],
  ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['PL', 'Poland'],
  ['PT', 'Portugal'], ['IE', 'Ireland'], ['CH', 'Switzerland'], ['AT', 'Austria'], ['BE', 'Belgium'],
  ['CZ', 'Czechia'], ['GR', 'Greece'], ['RO', 'Romania'], ['HU', 'Hungary'], ['UA', 'Ukraine'],
  ['RU', 'Russia'], ['TR', 'Turkey'], ['EG', 'Egypt'], ['MA', 'Morocco'], ['NG', 'Nigeria'],
  ['KE', 'Kenya'], ['ZA', 'South Africa'], ['GH', 'Ghana'], ['ET', 'Ethiopia'], ['IR', 'Iran'],
  ['IQ', 'Iraq'], ['JO', 'Jordan'], ['KW', 'Kuwait'], ['QA', 'Qatar'], ['OM', 'Oman'],
  ['BH', 'Bahrain'], ['LB', 'Lebanon'], ['AF', 'Afghanistan'], ['BD', 'Bangladesh'], ['LK', 'Sri Lanka'],
  ['NP', 'Nepal'], ['KZ', 'Kazakhstan'], ['UZ', 'Uzbekistan'], ['CN', 'China'], ['JP', 'Japan'],
  ['KR', 'South Korea'], ['TW', 'Taiwan'], ['HK', 'Hong Kong'], ['SG', 'Singapore'], ['MY', 'Malaysia'],
  ['ID', 'Indonesia'], ['PH', 'Philippines'], ['VN', 'Vietnam'], ['TH', 'Thailand'], ['NZ', 'New Zealand'],
  ['BR', 'Brazil'], ['AR', 'Argentina'], ['MX', 'Mexico'], ['CL', 'Chile'], ['CO', 'Colombia'],
  ['PE', 'Peru'], ['VE', 'Venezuela'], ['UN', 'Somewhere on Earth'],
];

/** "PK" -> 🇵🇰 using regional-indicator symbols. */
export function flag(code) {
  if (!code || code === 'UN' || code.length !== 2) return '🌍';
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const TZ_HINTS = {
  'Asia/Karachi': 'PK', 'Asia/Riyadh': 'SA', 'Asia/Dubai': 'AE', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
  'Asia/Dhaka': 'BD', 'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Singapore': 'SG',
  'Asia/Jakarta': 'ID', 'Asia/Manila': 'PH', 'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Kuala_Lumpur': 'MY',
  'Asia/Tehran': 'IR', 'Asia/Baghdad': 'IQ', 'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW', 'Asia/Muscat': 'OM',
  'Asia/Amman': 'JO', 'Asia/Kabul': 'AF', 'Asia/Colombo': 'LK', 'Asia/Kathmandu': 'NP', 'Asia/Almaty': 'KZ',
  'Asia/Tashkent': 'UZ', 'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW', 'Europe/Istanbul': 'TR',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI', 'Europe/Warsaw': 'PL', 'Europe/Lisbon': 'PT', 'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT',
  'Europe/Brussels': 'BE', 'Europe/Prague': 'CZ', 'Europe/Athens': 'GR', 'Europe/Bucharest': 'RO', 'Europe/Budapest': 'HU',
  'Europe/Kyiv': 'UA', 'Europe/Kiev': 'UA', 'Europe/Moscow': 'RU', 'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA',
  'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE', 'Africa/Johannesburg': 'ZA', 'Africa/Accra': 'GH', 'Africa/Addis_Ababa': 'ET',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Perth': 'AU', 'Pacific/Auckland': 'NZ',
  'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR', 'America/Mexico_City': 'MX', 'America/Santiago': 'CL',
  'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Caracas': 'VE', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
};

/** Best-effort guess from the browser locale, then the time zone. */
export function detectCountry() {
  const known = new Set(COUNTRIES.map(([c]) => c));
  try {
    const m = (navigator.language || '').match(/[-_]([A-Za-z]{2})$/);
    if (m && known.has(m[1].toUpperCase())) return m[1].toUpperCase();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TZ_HINTS[tz] && known.has(TZ_HINTS[tz])) return TZ_HINTS[tz];
    if (tz && tz.startsWith('America/') ) return 'US';
  } catch (_) { /* ignore */ }
  return 'UN';
}
