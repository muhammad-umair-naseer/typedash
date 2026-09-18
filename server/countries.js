'use strict';

/** Country list — keep in sync with public/js/countries.js (test/run-pages-test.js checks parity). */
const COUNTRIES = [
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
const NAME = Object.fromEntries(COUNTRIES);

const nameOf = (code) => NAME[code] || null;
const isCountry = (code) => !!NAME[code] && code !== 'UN';

module.exports = { COUNTRIES, nameOf, isCountry };
