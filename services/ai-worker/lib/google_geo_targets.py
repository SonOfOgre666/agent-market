"""
Google Ads GeoTargetConstant criteria IDs by ISO-3166-1 alpha-2 country code.

Source: Google Ads API geotargets (country-level Target Type = Country).
https://developers.google.com/google-ads/api/data/geotargets

Only use these IDs for country-level campaign targeting. Cities/regions require
``google_search_geo_locations`` (GeoTargetConstantService.suggest).
"""

from __future__ import annotations

from typing import Iterable

# Criteria ID → ISO for every targetable country in Google's geotargets list.
GOOGLE_GEO_BY_ISO: dict[str, int] = {
    'AF': 2004, 'AL': 2008, 'DZ': 2012, 'AS': 2016, 'AD': 2020, 'AO': 2024,
    'AQ': 2010, 'AG': 2028, 'AR': 2032, 'AM': 2051, 'AU': 2036, 'AT': 2040,
    'AZ': 2031, 'BH': 2048, 'BD': 2050, 'BB': 2052, 'BY': 2112, 'BE': 2056,
    'BZ': 2084, 'BJ': 2204, 'BT': 2064, 'BO': 2068, 'BA': 2070, 'BW': 2072,
    'BR': 2076, 'BN': 2096, 'BG': 2100, 'BF': 2854, 'BI': 2108, 'KH': 2116,
    'CM': 2120, 'CA': 2124, 'CV': 2132, 'BQ': 2535, 'CF': 2140, 'TD': 2148,
    'CL': 2152, 'CN': 2156, 'CX': 2162, 'CC': 2166, 'CO': 2170, 'KM': 2174,
    'CK': 2184, 'CR': 2188, 'CI': 2384, 'HR': 2191, 'CW': 2531, 'CY': 2196,
    'CZ': 2203, 'CD': 2180, 'DK': 2208, 'DJ': 2262, 'DM': 2212, 'DO': 2214,
    'EC': 2218, 'EG': 2818, 'SV': 2222, 'GQ': 2226, 'ER': 2232, 'EE': 2233,
    'SZ': 2748, 'ET': 2231, 'FM': 2583, 'FJ': 2242, 'FI': 2246, 'FR': 2250,
    'PF': 2258, 'TF': 2260, 'GA': 2266, 'GE': 2268, 'DE': 2276, 'GH': 2288,
    'GR': 2300, 'GD': 2308, 'GU': 2316, 'GT': 2320, 'GG': 2831, 'GN': 2324,
    'GW': 2624, 'GY': 2328, 'HT': 2332, 'HM': 2334, 'HN': 2340, 'HU': 2348,
    'IS': 2352, 'IN': 2356, 'ID': 2360, 'IQ': 2368, 'IE': 2372, 'IL': 2376,
    'IT': 2380, 'JM': 2388, 'JP': 2392, 'JE': 2832, 'JO': 2400, 'KZ': 2398,
    'KE': 2404, 'KI': 2296, 'KW': 2414, 'KG': 2417, 'LA': 2418, 'LV': 2428,
    'LB': 2422, 'LS': 2426, 'LR': 2430, 'LY': 2434, 'LI': 2438, 'LT': 2440,
    'LU': 2442, 'MG': 2450, 'MW': 2454, 'MY': 2458, 'MV': 2462, 'ML': 2466,
    'MT': 2470, 'MH': 2584, 'MR': 2478, 'MU': 2480, 'MX': 2484, 'MD': 2498,
    'MC': 2492, 'MN': 2496, 'ME': 2499, 'MA': 2504, 'MZ': 2508, 'MM': 2104,
    'NA': 2516, 'NR': 2520, 'NP': 2524, 'NL': 2528, 'NC': 2540, 'NZ': 2554,
    'NI': 2558, 'NE': 2562, 'NG': 2566, 'NU': 2570, 'NF': 2574, 'MK': 2807,
    'MP': 2580, 'NO': 2578, 'OM': 2512, 'PK': 2586, 'PW': 2585, 'PA': 2591,
    'PG': 2598, 'PY': 2600, 'PE': 2604, 'PH': 2608, 'PN': 2612, 'PL': 2616,
    'PT': 2620, 'QA': 2634, 'CG': 2178, 'RO': 2642, 'RU': 2643, 'RW': 2646,
    'BL': 2652, 'SH': 2654, 'KN': 2659, 'LC': 2662, 'MF': 2663, 'PM': 2666,
    'VC': 2670, 'WS': 2882, 'SM': 2674, 'ST': 2678, 'SA': 2682, 'SN': 2686,
    'RS': 2688, 'SC': 2690, 'SL': 2694, 'SG': 2702, 'SX': 2534, 'SK': 2703,
    'SI': 2705, 'SB': 2090, 'SO': 2706, 'ZA': 2710, 'GS': 2239, 'KR': 2410,
    'SS': 2728, 'ES': 2724, 'LK': 2144, 'SD': 2736, 'SR': 2740, 'SE': 2752,
    'CH': 2756, 'TW': 2158, 'TJ': 2762, 'TZ': 2834, 'TH': 2764, 'BS': 2044,
    'GM': 2270, 'TL': 2626, 'TG': 2768, 'TK': 2772, 'TO': 2776, 'TT': 2780,
    'TN': 2788, 'TR': 2792, 'TM': 2795, 'TV': 2798, 'UG': 2800, 'UA': 2804,
    'AE': 2784, 'GB': 2826, 'US': 2840, 'UM': 2581, 'UY': 2858, 'UZ': 2860,
    'VU': 2548, 'VA': 2336, 'VE': 2862, 'VN': 2704, 'WF': 2876, 'YE': 2887,
    'ZM': 2894, 'ZW': 2716,
}

# Common presets for UI (subset of GOOGLE_GEO_BY_ISO).
GOOGLE_GEO_PRESETS: list[dict[str, str | int]] = [
    {'id': 2840, 'code': 'US', 'label': 'United States'},
    {'id': 2124, 'code': 'CA', 'label': 'Canada'},
    {'id': 2826, 'code': 'GB', 'label': 'United Kingdom'},
    {'id': 2504, 'code': 'MA', 'label': 'Morocco'},
    {'id': 2012, 'code': 'DZ', 'label': 'Algeria'},
    {'id': 2788, 'code': 'TN', 'label': 'Tunisia'},
    {'id': 2250, 'code': 'FR', 'label': 'France'},
    {'id': 2276, 'code': 'DE', 'label': 'Germany'},
    {'id': 2724, 'code': 'ES', 'label': 'Spain'},
    {'id': 2380, 'code': 'IT', 'label': 'Italy'},
    {'id': 2528, 'code': 'NL', 'label': 'Netherlands'},
    {'id': 2056, 'code': 'BE', 'label': 'Belgium'},
    {'id': 2620, 'code': 'PT', 'label': 'Portugal'},
    {'id': 2784, 'code': 'AE', 'label': 'United Arab Emirates'},
    {'id': 2682, 'code': 'SA', 'label': 'Saudi Arabia'},
    {'id': 2818, 'code': 'EG', 'label': 'Egypt'},
    {'id': 2484, 'code': 'MX', 'label': 'Mexico'},
    {'id': 2076, 'code': 'BR', 'label': 'Brazil'},
    {'id': 2356, 'code': 'IN', 'label': 'India'},
    {'id': 2036, 'code': 'AU', 'label': 'Australia'},
    {'id': 2616, 'code': 'PL', 'label': 'Poland'},
    {'id': 2752, 'code': 'SE', 'label': 'Sweden'},
    {'id': 2756, 'code': 'CH', 'label': 'Switzerland'},
    {'id': 2040, 'code': 'AT', 'label': 'Austria'},
    {'id': 2372, 'code': 'IE', 'label': 'Ireland'},
    {'id': 2792, 'code': 'TR', 'label': 'Turkey'},
]

_ISO_LABELS: dict[str, str] = {str(p['code']): str(p['label']) for p in GOOGLE_GEO_PRESETS}


def country_label_for_iso(iso: str | None) -> str | None:
    """Human country name for ISO code when known (Morocco, France, …)."""
    code = str(iso or '').strip().upper()
    if len(code) != 2:
        return None
    return _ISO_LABELS.get(code)


def geo_target_id_for_iso(iso: str | None) -> int | None:
    code = str(iso or '').strip().upper()
    if len(code) != 2:
        return None
    return GOOGLE_GEO_BY_ISO.get(code)


def geo_target_ids_for_iso_codes(iso_codes: Iterable[str]) -> tuple[list[int], list[str]]:
    """
    Map ISO country codes to Google geo target constant IDs.
    Returns (ids in stable order, iso codes with no mapping).
    """
    ids: list[int] = []
    missing: list[str] = []
    seen_ids: set[int] = set()
    for raw in iso_codes or []:
        code = str(raw or '').strip().upper()
        if len(code) != 2:
            continue
        gid = GOOGLE_GEO_BY_ISO.get(code)
        if gid is None:
            if code not in missing:
                missing.append(code)
            continue
        if gid not in seen_ids:
            ids.append(gid)
            seen_ids.add(gid)
    return ids, missing
