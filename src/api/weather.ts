/**
 * NOAA National Weather Service (NWS) API Client for Field / Searcher Safety
 * Provides hourly forecast, active alerts, and safety condition analysis for incidents.
 */

export interface NOAAHourlyPeriod {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: string;
  temperatureTrend?: string | null;
  probabilityOfPrecipitation?: {
    unitCode?: string;
    value: number | null;
  };
  dewpoint?: {
    unitCode?: string;
    value: number | null; // Celsius in NWS API
  };
  relativeHumidity?: {
    unitCode?: string;
    value: number | null;
  };
  windSpeed?: string;
  windGust?: string | null;
  windDirection?: string;
  shortForecast?: string;
  detailedForecast?: string;
  icon?: string;
}

export interface NOAAActiveAlert {
  id: string;
  event: string;
  headline?: string;
  severity: string;
  urgency: string;
  certainty: string;
  description?: string;
  instruction?: string;
  effective?: string;
  expires?: string;
}

export interface WeatherSafetySummary {
  locationCity?: string;
  locationState?: string;
  isIncidentWindow: boolean;
  timeRangeLabel: string;
  forecastStart: string; // ISO string of first matched period start
  forecastEnd: string;   // ISO string of last matched period end
  tempMin: number;
  tempMax: number;
  tempCurrent: number;
  feelsLike: number;
  windSpeed: string;
  windMaxMph: number;
  windGustMph?: number;
  windDirection: string;
  precipChanceMax: number;
  primaryCondition: string;
  humidityAvg: number;
  dewpointF: number;
  alerts: NOAAActiveAlert[];
  safetyInsights: {
    tempStatus: 'normal' | 'cold-caution' | 'freeze-danger' | 'heat-caution' | 'heat-danger';
    tempMessage: string;
    windStatus: 'calm' | 'moderate' | 'gusty' | 'high-hazard';
    windMessage: string;
    precipStatus: 'dry' | 'chance' | 'likely' | 'heavy';
    precipMessage: string;
    fogStatus: 'low' | 'moderate' | 'dense-fog';
    fogMessage: string;
  };
}

// In-memory cache to prevent repetitive network requests
const weatherCache = new Map<string, { data: WeatherSafetySummary; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function parseMph(speedStr?: string): number {
  if (!speedStr) return 0;
  const matches = speedStr.match(/(\d+)/g);
  if (!matches || matches.length === 0) return 0;
  const nums = matches.map(Number);
  return Math.max(...nums);
}

function celsiusToFahrenheit(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

function calculateFeelsLike(tempF: number, windMph: number, humidityPct: number): number {
  // Wind chill if <= 50F and wind > 3mph
  if (tempF <= 50 && windMph > 3) {
    const wc =
      35.74 +
      0.6215 * tempF -
      35.75 * Math.pow(windMph, 0.16) +
      0.4275 * tempF * Math.pow(windMph, 0.16);
    return Math.round(wc);
  }
  // Heat index if >= 80F
  if (tempF >= 80) {
    const hi =
      -42.379 +
      2.04901523 * tempF +
      10.14333127 * humidityPct -
      0.22475541 * tempF * humidityPct -
      0.00683783 * tempF * tempF -
      0.05481717 * humidityPct * humidityPct +
      0.00122874 * tempF * tempF * humidityPct +
      0.00085282 * tempF * humidityPct * humidityPct -
      0.00000199 * tempF * tempF * humidityPct * humidityPct;
    return Math.round(hi);
  }
  return tempF;
}

/**
 * Fetch NOAA Weather Forecast and Active Safety Alerts for given coordinates and timeframe.
 */
export async function fetchNOAAWeather(
  lat: number,
  lng: number,
  startDate?: Date,
  endDate?: Date
): Promise<WeatherSafetySummary | null> {
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}_${startDate?.getTime() || 0}_${endDate?.getTime() || 0}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const headers = {
      'User-Agent': 'SAR211App (ICS-211 Field Activity Manager, contact@sar.org)',
      Accept: 'application/geo+json, application/json',
    };

    // 1. Fetch gridpoint metadata from coordinates
    const pointUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`;
    const pointRes = await fetch(pointUrl, { headers });
    if (!pointRes.ok) {
      // Non-US location or NOAA service unavailable
      return null;
    }
    const pointData = await pointRes.json();
    const props = pointData?.properties;
    if (!props?.forecastHourly) {
      return null;
    }

    const locationCity = props.relativeLocation?.properties?.city || undefined;
    const locationState = props.relativeLocation?.properties?.state || undefined;

    // 2. Concurrently fetch hourly forecast and active alerts
    const alertsUrl = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}`;
    const [hourlyRes, alertsRes] = await Promise.all([
      fetch(props.forecastHourly, { headers }),
      fetch(alertsUrl, { headers }).catch(() => null),
    ]);

    if (!hourlyRes.ok) {
      return null;
    }

    const hourlyData = await hourlyRes.json();
    const allPeriods: NOAAHourlyPeriod[] = hourlyData?.properties?.periods || [];
    if (allPeriods.length === 0) {
      return null;
    }

    // Process alerts
    const alerts: NOAAActiveAlert[] = [];
    if (alertsRes && alertsRes.ok) {
      try {
        const alertsData = await alertsRes.json();
        const features = alertsData?.features || [];
        for (const f of features) {
          if (f.properties?.event) {
            alerts.push({
              id: f.id || f.properties.id || String(Math.random()),
              event: f.properties.event,
              headline: f.properties.headline,
              severity: f.properties.severity || 'Unknown',
              urgency: f.properties.urgency || 'Unknown',
              certainty: f.properties.certainty || 'Unknown',
              description: f.properties.description,
              instruction: f.properties.instruction,
              effective: f.properties.effective,
              expires: f.properties.expires,
            });
          }
        }
      } catch (e) {
        console.warn('Error parsing NOAA alerts:', e);
      }
    }

    // 3. Filter periods matching incident start and end time
    let matchedPeriods: typeof allPeriods = [];
    let isIncidentWindow = false;
    let timeRangeLabel = 'Current Forecast';

    if (startDate && !isNaN(startDate.getTime())) {
      const end = endDate && !isNaN(endDate.getTime()) ? endDate : new Date(startDate.getTime() + 4 * 3600 * 1000);
      const filtered = allPeriods.filter((p) => {
        const pStart = new Date(p.startTime).getTime();
        const pEnd = new Date(p.endTime).getTime();
        return pEnd >= startDate.getTime() && pStart <= end.getTime();
      });

      if (filtered.length > 0) {
        matchedPeriods = filtered;
        isIncidentWindow = true;
        timeRangeLabel = 'Incident Window';
      } else {
        // Incident window is outside NOAA's forecast range — don't show weather tiles
        return null;
      }
    } else {
      // No incident date at all — also hide rather than show generic forecast
      return null;
    }

    // Compute aggregations across periods
    const temps = matchedPeriods.map((p) => p.temperature);
    const tempMin = Math.min(...temps);
    const tempMax = Math.max(...temps);
    const tempCurrent = matchedPeriods[0].temperature;

    const windSpeeds = matchedPeriods.map((p) => parseMph(p.windSpeed));
    const windMaxMph = Math.max(...windSpeeds);
    const windGusts = matchedPeriods.map((p) => parseMph(p.windGust || ''));
    const windGustMph = Math.max(0, ...windGusts);

    const precips = matchedPeriods.map((p) => p.probabilityOfPrecipitation?.value ?? 0);
    const precipChanceMax = Math.max(0, ...precips);

    const humidities = matchedPeriods.map((p) => p.relativeHumidity?.value ?? 50);
    const humidityAvg = Math.round(humidities.reduce((a, b) => a + b, 0) / humidities.length);

    const dewpoints = matchedPeriods
      .map((p) => (p.dewpoint?.value != null ? celsiusToFahrenheit(p.dewpoint.value) : null))
      .filter((v): v is number => v !== null);
    const dewpointF = dewpoints.length > 0 ? Math.round(dewpoints.reduce((a, b) => a + b, 0) / dewpoints.length) : 48;

    const primaryCondition = matchedPeriods[0].shortForecast || 'Fair';
    const windDirection = matchedPeriods[0].windDirection || 'VAR';
    const windSpeed = matchedPeriods[0].windSpeed || `${windMaxMph} mph`;
    const feelsLike = calculateFeelsLike(tempCurrent, windMaxMph, humidityAvg);

    // 4. Generate SAR / Field Safety Insights
    let tempStatus: WeatherSafetySummary['safetyInsights']['tempStatus'] = 'normal';
    let tempMessage = 'Favorable operating temperature';

    if (tempMin <= 32) {
      tempStatus = 'freeze-danger';
      tempMessage = 'Freezing hazards. Hypothermia risk; cold weather gear required.';
    } else if (tempMin <= 45) {
      tempStatus = 'cold-caution';
      tempMessage = 'Chilly conditions. Monitor searchers for hypothermia & wet clothing.';
    } else if (tempMax >= 95) {
      tempStatus = 'heat-danger';
      tempMessage = 'Extreme heat. High risk of heat stroke; mandatory hydration breaks.';
    } else if (tempMax >= 85) {
      tempStatus = 'heat-caution';
      tempMessage = 'Warm conditions. Monitor team hydration & heat exhaustion.';
    }

    let windStatus: WeatherSafetySummary['safetyInsights']['windStatus'] = 'calm';
    let windMessage = 'Light wind; favorable for UAS/drone & canine search operations.';

    if (windMaxMph >= 30 || windGustMph >= 35) {
      windStatus = 'high-hazard';
      windMessage = 'High wind hazard. Tree fall risk; drone operations grounded.';
    } else if (windMaxMph >= 18 || windGustMph >= 22) {
      windStatus = 'gusty';
      windMessage = 'Gusty winds. Scent dispersal rapid; caution with drone flights.';
    } else if (windMaxMph >= 10) {
      windStatus = 'moderate';
      windMessage = 'Moderate breeze; favorable for canine tracking.';
    }

    let precipStatus: WeatherSafetySummary['safetyInsights']['precipStatus'] = 'dry';
    let precipMessage = 'Dry ground; optimal terrain footing.';

    if (precipChanceMax >= 70) {
      precipStatus = 'heavy';
      precipMessage = 'High precipitation likely. Slick terrain, creek swell & hypothermia risk.';
    } else if (precipChanceMax >= 40) {
      precipStatus = 'likely';
      precipMessage = 'Showers expected. Rain gear & dry bags recommended.';
    } else if (precipChanceMax >= 15) {
      precipStatus = 'chance';
      precipMessage = 'Slight chance of precipitation.';
    }

    let fogStatus: WeatherSafetySummary['safetyInsights']['fogStatus'] = 'low';
    let fogMessage = 'Good field visibility.';

    const tempDewDiff = Math.abs(tempCurrent - dewpointF);
    if (primaryCondition.toLowerCase().includes('fog') || (tempDewDiff <= 2 && humidityAvg >= 90)) {
      fogStatus = 'dense-fog';
      fogMessage = 'Dense fog / low visibility. Mark waypoints carefully; ground search caution.';
    } else if (tempDewDiff <= 4 && humidityAvg >= 80) {
      fogStatus = 'moderate';
      fogMessage = 'Patchy fog / mist potential; morning condensation on gear.';
    }

    const summary: WeatherSafetySummary = {
      locationCity,
      locationState,
      isIncidentWindow,
      timeRangeLabel,
      forecastStart: matchedPeriods[0].startTime,
      forecastEnd: matchedPeriods[matchedPeriods.length - 1].endTime,
      tempMin,
      tempMax,
      tempCurrent,
      feelsLike,
      windSpeed,
      windMaxMph,
      windGustMph: windGustMph > 0 ? windGustMph : undefined,
      windDirection,
      precipChanceMax,
      primaryCondition,
      humidityAvg,
      dewpointF,
      alerts,
      safetyInsights: {
        tempStatus,
        tempMessage,
        windStatus,
        windMessage,
        precipStatus,
        precipMessage,
        fogStatus,
        fogMessage,
      },
    };

    weatherCache.set(cacheKey, { data: summary, timestamp: Date.now() });
    return summary;
  } catch (err) {
    console.warn('Failed to fetch NOAA weather:', err);
    return null;
  }
}
