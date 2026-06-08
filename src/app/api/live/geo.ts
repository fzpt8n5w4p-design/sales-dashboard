// Server-side geocoding for the live-view globe. Veeqo delivery addresses give
// us city + country (+ postcode) but no coordinates, so we map them here against
// a compact bundled dataset. The dataset never ships to the client — the /api/live
// route returns ready lat/lng pings.
//
// Strategy: city+country exact match → country centroid fallback → null.
// A small deterministic jitter (seeded by order id) spreads multiple orders in
// the same place so they don't perfectly overlap on the globe.

export type LatLng = { lat: number; lng: number }

// Country centroids keyed by lower-cased country name. ISO2/ISO3 codes and a few
// common variants are aliased below. Covers the realistic e-commerce destination
// set (UK/EU/US heavy + the major rest-of-world markets); unknowns fall through.
const COUNTRY_CENTROIDS: Record<string, LatLng> = {
  'united kingdom': { lat: 54.0, lng: -2.5 },
  'ireland': { lat: 53.3, lng: -7.7 },
  'france': { lat: 46.6, lng: 2.4 },
  'germany': { lat: 51.2, lng: 10.4 },
  'spain': { lat: 40.0, lng: -3.7 },
  'portugal': { lat: 39.5, lng: -8.0 },
  'italy': { lat: 42.8, lng: 12.5 },
  'netherlands': { lat: 52.1, lng: 5.3 },
  'belgium': { lat: 50.6, lng: 4.6 },
  'luxembourg': { lat: 49.8, lng: 6.1 },
  'switzerland': { lat: 46.8, lng: 8.2 },
  'austria': { lat: 47.6, lng: 14.1 },
  'denmark': { lat: 56.0, lng: 9.5 },
  'sweden': { lat: 62.2, lng: 14.6 },
  'norway': { lat: 64.6, lng: 11.5 },
  'finland': { lat: 64.0, lng: 26.0 },
  'iceland': { lat: 64.9, lng: -19.0 },
  'poland': { lat: 51.9, lng: 19.1 },
  'czechia': { lat: 49.8, lng: 15.5 },
  'slovakia': { lat: 48.7, lng: 19.7 },
  'hungary': { lat: 47.2, lng: 19.5 },
  'romania': { lat: 45.9, lng: 24.9 },
  'bulgaria': { lat: 42.7, lng: 25.5 },
  'greece': { lat: 39.1, lng: 22.0 },
  'croatia': { lat: 45.1, lng: 15.2 },
  'slovenia': { lat: 46.1, lng: 14.8 },
  'serbia': { lat: 44.0, lng: 21.0 },
  'lithuania': { lat: 55.2, lng: 23.9 },
  'latvia': { lat: 56.9, lng: 24.6 },
  'estonia': { lat: 58.6, lng: 25.0 },
  'ukraine': { lat: 48.4, lng: 31.2 },
  'russia': { lat: 61.5, lng: 105.3 },
  'turkey': { lat: 38.9, lng: 35.2 },
  'malta': { lat: 35.9, lng: 14.4 },
  'cyprus': { lat: 35.1, lng: 33.4 },
  'united states': { lat: 39.8, lng: -98.6 },
  'canada': { lat: 56.1, lng: -106.3 },
  'mexico': { lat: 23.6, lng: -102.5 },
  'brazil': { lat: -14.2, lng: -51.9 },
  'argentina': { lat: -38.4, lng: -63.6 },
  'chile': { lat: -35.7, lng: -71.5 },
  'australia': { lat: -25.3, lng: 133.8 },
  'new zealand': { lat: -41.0, lng: 174.0 },
  'japan': { lat: 36.2, lng: 138.3 },
  'china': { lat: 35.9, lng: 104.2 },
  'south korea': { lat: 36.5, lng: 127.9 },
  'india': { lat: 22.4, lng: 78.9 },
  'singapore': { lat: 1.35, lng: 103.8 },
  'hong kong': { lat: 22.3, lng: 114.2 },
  'united arab emirates': { lat: 24.0, lng: 54.0 },
  'saudi arabia': { lat: 24.0, lng: 45.0 },
  'israel': { lat: 31.5, lng: 34.9 },
  'south africa': { lat: -30.6, lng: 22.9 },
  'egypt': { lat: 26.8, lng: 30.8 },
  'nigeria': { lat: 9.1, lng: 8.7 },
  'morocco': { lat: 31.8, lng: -7.1 },
  'thailand': { lat: 15.9, lng: 100.99 },
  'malaysia': { lat: 4.2, lng: 101.98 },
  'indonesia': { lat: -0.8, lng: 113.9 },
  'philippines': { lat: 12.9, lng: 121.8 },
  'vietnam': { lat: 14.1, lng: 108.3 },
}

// Aliases → canonical key in COUNTRY_CENTROIDS (handles ISO codes & variants).
const COUNTRY_ALIASES: Record<string, string> = {
  'uk': 'united kingdom', 'gb': 'united kingdom', 'gbr': 'united kingdom',
  'great britain': 'united kingdom', 'england': 'united kingdom',
  'scotland': 'united kingdom', 'wales': 'united kingdom',
  'northern ireland': 'united kingdom',
  'ie': 'ireland', 'irl': 'ireland',
  'fr': 'france', 'fra': 'france',
  'de': 'germany', 'deu': 'germany', 'deutschland': 'germany',
  'es': 'spain', 'esp': 'spain', 'españa': 'spain',
  'pt': 'portugal', 'prt': 'portugal',
  'it': 'italy', 'ita': 'italy', 'italia': 'italy',
  'nl': 'netherlands', 'nld': 'netherlands', 'holland': 'netherlands',
  'be': 'belgium', 'bel': 'belgium',
  'lu': 'luxembourg', 'ch': 'switzerland', 'che': 'switzerland',
  'at': 'austria', 'aut': 'austria',
  'dk': 'denmark', 'dnk': 'denmark',
  'se': 'sweden', 'swe': 'sweden',
  'no': 'norway', 'nor': 'norway',
  'fi': 'finland', 'fin': 'finland',
  'pl': 'poland', 'pol': 'poland',
  'cz': 'czechia', 'cze': 'czechia', 'czech republic': 'czechia',
  'gr': 'greece', 'grc': 'greece',
  'us': 'united states', 'usa': 'united states', 'u.s.a.': 'united states',
  'u.s.': 'united states', 'america': 'united states',
  'united states of america': 'united states',
  'ca': 'canada', 'can': 'canada',
  'au': 'australia', 'aus': 'australia',
  'nz': 'new zealand', 'nzl': 'new zealand',
  'jp': 'japan', 'jpn': 'japan',
  'cn': 'china', 'chn': 'china',
  'ae': 'united arab emirates', 'uae': 'united arab emirates',
  'hk': 'hong kong', 'za': 'south africa', 'kr': 'south korea',
  'in': 'india', 'ind': 'india',
}

// City coordinates keyed by "city|country-canonical". UK-heavy (main market),
// plus EU capitals/large cities and major US metros for spread.
const CITIES: Record<string, LatLng> = {
  // United Kingdom
  'london|united kingdom': { lat: 51.5074, lng: -0.1278 },
  'birmingham|united kingdom': { lat: 52.4862, lng: -1.8904 },
  'manchester|united kingdom': { lat: 53.4808, lng: -2.2426 },
  'leeds|united kingdom': { lat: 53.8008, lng: -1.5491 },
  'glasgow|united kingdom': { lat: 55.8642, lng: -4.2518 },
  'edinburgh|united kingdom': { lat: 55.9533, lng: -3.1883 },
  'liverpool|united kingdom': { lat: 53.4084, lng: -2.9916 },
  'bristol|united kingdom': { lat: 51.4545, lng: -2.5879 },
  'sheffield|united kingdom': { lat: 53.3811, lng: -1.4701 },
  'cardiff|united kingdom': { lat: 51.4816, lng: -3.1791 },
  'belfast|united kingdom': { lat: 54.5973, lng: -5.9301 },
  'newcastle|united kingdom': { lat: 54.9783, lng: -1.6178 },
  'newcastle upon tyne|united kingdom': { lat: 54.9783, lng: -1.6178 },
  'nottingham|united kingdom': { lat: 52.9548, lng: -1.1581 },
  'leicester|united kingdom': { lat: 52.6369, lng: -1.1398 },
  'coventry|united kingdom': { lat: 52.4068, lng: -1.5197 },
  'bradford|united kingdom': { lat: 53.7960, lng: -1.7594 },
  'southampton|united kingdom': { lat: 50.9097, lng: -1.4044 },
  'portsmouth|united kingdom': { lat: 50.8198, lng: -1.0880 },
  'brighton|united kingdom': { lat: 50.8225, lng: -0.1372 },
  'plymouth|united kingdom': { lat: 50.3755, lng: -4.1427 },
  'reading|united kingdom': { lat: 51.4543, lng: -0.9781 },
  'derby|united kingdom': { lat: 52.9228, lng: -1.4763 },
  'wolverhampton|united kingdom': { lat: 52.5870, lng: -2.1288 },
  'stoke-on-trent|united kingdom': { lat: 53.0027, lng: -2.1794 },
  'hull|united kingdom': { lat: 53.7676, lng: -0.3274 },
  'preston|united kingdom': { lat: 53.7632, lng: -2.7031 },
  'aberdeen|united kingdom': { lat: 57.1497, lng: -2.0943 },
  'swansea|united kingdom': { lat: 51.6214, lng: -3.9436 },
  'milton keynes|united kingdom': { lat: 52.0406, lng: -0.7594 },
  'norwich|united kingdom': { lat: 52.6309, lng: 1.2974 },
  'oxford|united kingdom': { lat: 51.7520, lng: -1.2577 },
  'cambridge|united kingdom': { lat: 52.2053, lng: 0.1218 },
  'york|united kingdom': { lat: 53.9600, lng: -1.0873 },
  'exeter|united kingdom': { lat: 50.7184, lng: -3.5339 },
  'bournemouth|united kingdom': { lat: 50.7192, lng: -1.8808 },
  'dundee|united kingdom': { lat: 56.4620, lng: -2.9707 },
  'inverness|united kingdom': { lat: 57.4778, lng: -4.2247 },
  // Ireland
  'dublin|ireland': { lat: 53.3498, lng: -6.2603 },
  'cork|ireland': { lat: 51.8985, lng: -8.4756 },
  'galway|ireland': { lat: 53.2707, lng: -9.0568 },
  // France
  'paris|france': { lat: 48.8566, lng: 2.3522 },
  'marseille|france': { lat: 43.2965, lng: 5.3698 },
  'lyon|france': { lat: 45.7640, lng: 4.8357 },
  'toulouse|france': { lat: 43.6047, lng: 1.4442 },
  'nice|france': { lat: 43.7102, lng: 7.2620 },
  'bordeaux|france': { lat: 44.8378, lng: -0.5792 },
  'lille|france': { lat: 50.6292, lng: 3.0573 },
  // Germany
  'berlin|germany': { lat: 52.5200, lng: 13.4050 },
  'munich|germany': { lat: 48.1351, lng: 11.5820 },
  'münchen|germany': { lat: 48.1351, lng: 11.5820 },
  'hamburg|germany': { lat: 53.5511, lng: 9.9937 },
  'frankfurt|germany': { lat: 50.1109, lng: 8.6821 },
  'cologne|germany': { lat: 50.9375, lng: 6.9603 },
  'köln|germany': { lat: 50.9375, lng: 6.9603 },
  'stuttgart|germany': { lat: 48.7758, lng: 9.1829 },
  'düsseldorf|germany': { lat: 51.2277, lng: 6.7735 },
  // Spain
  'madrid|spain': { lat: 40.4168, lng: -3.7038 },
  'barcelona|spain': { lat: 41.3851, lng: 2.1734 },
  'valencia|spain': { lat: 39.4699, lng: -0.3763 },
  'seville|spain': { lat: 37.3891, lng: -5.9845 },
  'málaga|spain': { lat: 36.7213, lng: -4.4214 },
  // Italy
  'rome|italy': { lat: 41.9028, lng: 12.4964 },
  'milan|italy': { lat: 45.4642, lng: 9.1900 },
  'naples|italy': { lat: 40.8518, lng: 14.2681 },
  'turin|italy': { lat: 45.0703, lng: 7.6869 },
  'florence|italy': { lat: 43.7696, lng: 11.2558 },
  // Netherlands / Belgium
  'amsterdam|netherlands': { lat: 52.3676, lng: 4.9041 },
  'rotterdam|netherlands': { lat: 51.9244, lng: 4.4777 },
  'the hague|netherlands': { lat: 52.0705, lng: 4.3007 },
  'brussels|belgium': { lat: 50.8503, lng: 4.3517 },
  'antwerp|belgium': { lat: 51.2194, lng: 4.4025 },
  // Nordics
  'copenhagen|denmark': { lat: 55.6761, lng: 12.5683 },
  'stockholm|sweden': { lat: 59.3293, lng: 18.0686 },
  'oslo|norway': { lat: 59.9139, lng: 10.7522 },
  'helsinki|finland': { lat: 60.1699, lng: 24.9384 },
  // Other EU
  'lisbon|portugal': { lat: 38.7223, lng: -9.1393 },
  'porto|portugal': { lat: 41.1579, lng: -8.6291 },
  'vienna|austria': { lat: 48.2082, lng: 16.3738 },
  'zurich|switzerland': { lat: 47.3769, lng: 8.5417 },
  'geneva|switzerland': { lat: 46.2044, lng: 6.1432 },
  'warsaw|poland': { lat: 52.2297, lng: 21.0122 },
  'prague|czechia': { lat: 50.0755, lng: 14.4378 },
  'athens|greece': { lat: 37.9838, lng: 23.7275 },
  // United States
  'new york|united states': { lat: 40.7128, lng: -74.0060 },
  'los angeles|united states': { lat: 34.0522, lng: -118.2437 },
  'chicago|united states': { lat: 41.8781, lng: -87.6298 },
  'houston|united states': { lat: 29.7604, lng: -95.3698 },
  'phoenix|united states': { lat: 33.4484, lng: -112.0740 },
  'philadelphia|united states': { lat: 39.9526, lng: -75.1652 },
  'san antonio|united states': { lat: 29.4241, lng: -98.4936 },
  'san diego|united states': { lat: 32.7157, lng: -117.1611 },
  'dallas|united states': { lat: 32.7767, lng: -96.7970 },
  'san francisco|united states': { lat: 37.7749, lng: -122.4194 },
  'seattle|united states': { lat: 47.6062, lng: -122.3321 },
  'miami|united states': { lat: 25.7617, lng: -80.1918 },
  'boston|united states': { lat: 42.3601, lng: -71.0589 },
  'atlanta|united states': { lat: 33.7490, lng: -84.3880 },
  'denver|united states': { lat: 39.7392, lng: -104.9903 },
  // Canada / Australia
  'toronto|canada': { lat: 43.6532, lng: -79.3832 },
  'vancouver|canada': { lat: 49.2827, lng: -123.1207 },
  'montreal|canada': { lat: 45.5017, lng: -73.5673 },
  'sydney|australia': { lat: -33.8688, lng: 151.2093 },
  'melbourne|australia': { lat: -37.8136, lng: 144.9631 },
  'brisbane|australia': { lat: -27.4698, lng: 153.0251 },
  'auckland|new zealand': { lat: -36.8485, lng: 174.7633 },
}

function normalize(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function canonicalCountry(country: string | null | undefined): string {
  const n = normalize(country)
  if (!n) return ''
  if (COUNTRY_CENTROIDS[n]) return n
  if (COUNTRY_ALIASES[n]) return COUNTRY_ALIASES[n]
  return n
}

// Deterministic jitter from a string seed (order id), ±~0.4° (~30–40km) so
// repeat orders from the same city fan out instead of stacking on one pixel.
// Raw deterministic offset in [-0.5, 0.5] per axis from a string seed.
function jitter(seed: string): LatLng {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const a = ((h >>> 0) % 1000) / 1000 - 0.5
  const b = (((h >>> 10) >>> 0) % 1000) / 1000 - 0.5
  return { lat: a, lng: b }
}

type Resolved = { lat: number; lng: number; spread: number }
const memo = new Map<string, Resolved | null>()

export function geocode(
  city: string | null | undefined,
  country: string | null | undefined,
  seed: string
): LatLng | null {
  const cc = canonicalCountry(country)
  const c = normalize(city)
  const cacheKey = `${c}|${cc}`

  let base = memo.get(cacheKey)
  if (base === undefined) {
    const cityHit = CITIES[`${c}|${cc}`]
    const centroid = cityHit || COUNTRY_CENTROIDS[cc]
    // Known city → tight jitter (~±0.3°, keeps it on the city). Country-centroid
    // fallback (unknown city) → wide jitter (~±3.5°) so those orders scatter
    // across the country instead of stacking into one blob on the centroid.
    base = centroid
      ? { lat: centroid.lat, lng: centroid.lng, spread: cityHit ? 0.6 : 7 }
      : null
    memo.set(cacheKey, base)
  }
  if (!base) return null

  const j = jitter(seed)
  return {
    lat: Math.max(-85, Math.min(85, base.lat + j.lat * base.spread)),
    lng: base.lng + j.lng * base.spread,
  }
}
