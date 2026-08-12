import type { DriftPrediction, DriftForcing, ForcingSample } from '@/lib/types';

/**
 * Cross-check a measured drift vector against modelled wind and current.
 *
 * Deliberately NOT additive. The vector comes from the tag's own positions, so
 * it already contains the wind and current that acted during the fitting
 * window; layering a modelled leeway term on top would count the same forcing
 * twice. What the models can tell us is whether the extrapolation is safe:
 *
 *   1. Does the modelled current agree with the direction the tag actually
 *      went? Agreement corroborates the vector. Disagreement means something
 *      else is driving the tag — or the model grid does not resolve where it is.
 *   2. Has the wind changed since the window we fitted? Extrapolating a vector
 *      measured under one wind regime into a different one is the single
 *      easiest way to be confidently wrong.
 *
 * Direction conventions, which are easy to invert:
 *   - wind  is reported as the direction it blows FROM (meteorological)
 *   - current is reported as the direction it flows TOWARD (oceanographic)
 * Confirmed empirically at a reference PSAT+ deployment: the model gave current toward ~0° and
 * the tag's own track ran 355°. Had the field meant "from", the model would
 * have implied southward flow, contradicting both the observed drift and the
 * known northward set of the Florida Current.
 */

/** Wind direction change beyond this makes the fitted vector unreliable. */
const WIND_SHIFT_DEG = 45;
/** Wind speed change beyond this (m/s) does the same. */
const WIND_SPEED_CHANGE_MS = 3;
/** Beyond this, drift and modelled current are not telling the same story. */
const CURRENT_DISAGREE_DEG = 90;

/** Smallest angle between two compass bearings, 0-180. */
export function angleDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Mean of compass bearings, handling wrap-around at 360. */
function circularMean(degrees: number[]): number | null {
  if (degrees.length === 0) return null;
  let sin = 0;
  let cos = 0;
  for (const d of degrees) {
    sin += Math.sin((d * Math.PI) / 180);
    cos += Math.cos((d * Math.PI) / 180);
  }
  return ((Math.atan2(sin / degrees.length, cos / degrees.length) * 180) / Math.PI + 360) % 360;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
}

function windowStats(samples: ForcingSample[], from: number, to: number) {
  const inWindow = samples.filter((s) => {
    const t = s.time.getTime();
    return t >= from && t <= to;
  });
  const windSpeed = mean(
    inWindow.map((s) => s.windSpeedMs).filter((v): v is number => v !== null)
  );
  const windFrom = circularMean(
    inWindow.map((s) => s.windFromDeg).filter((v): v is number => v !== null)
  );
  const currentSpeed = mean(
    inWindow.map((s) => s.currentKmH).filter((v): v is number => v !== null)
  );
  const currentToward = circularMean(
    inWindow.map((s) => s.currentTowardDeg).filter((v): v is number => v !== null)
  );
  return { windSpeed, windFrom, currentSpeed, currentToward, count: inWindow.length };
}

export function assessDriftForcing(
  prediction: DriftPrediction,
  samples: ForcingSample[],
  now: Date,
  horizonHours: number
): DriftForcing | null {
  if (samples.length === 0) return null;

  const fit = windowStats(
    samples,
    prediction.fitFrom.getTime(),
    prediction.fitTo.getTime()
  );
  const ahead = windowStats(
    samples,
    now.getTime(),
    now.getTime() + horizonHours * 3_600_000
  );

  const notes: string[] = [];

  // --- Current cross-check -------------------------------------------------
  let currentAgreementDeg: number | null = null;
  let currentSpeedRatio: number | null = null;
  const modelCurrent =
    ahead.currentToward !== null && ahead.currentSpeed !== null
      ? { speedKmH: ahead.currentSpeed, towardDeg: ahead.currentToward }
      : null;

  if (modelCurrent) {
    currentAgreementDeg = angleDelta(prediction.headingDeg, modelCurrent.towardDeg);
    currentSpeedRatio =
      modelCurrent.speedKmH > 0 ? prediction.speedKmH / modelCurrent.speedKmH : null;

    if (currentAgreementDeg <= 45) {
      notes.push(
        `Modelled current sets ${Math.round(modelCurrent.towardDeg)}° at ` +
          `${modelCurrent.speedKmH.toFixed(1)} km/h, within ${Math.round(currentAgreementDeg)}° ` +
          `of the tag's measured heading — the track and the model agree on direction.`
      );
    } else if (currentAgreementDeg >= CURRENT_DISAGREE_DEG) {
      notes.push(
        `Modelled current sets ${Math.round(modelCurrent.towardDeg)}°, ` +
          `${Math.round(currentAgreementDeg)}° away from the tag's measured heading. ` +
          `Either something other than the current is driving it, or the model grid ` +
          `does not resolve this position.`
      );
    } else {
      notes.push(
        `Modelled current sets ${Math.round(modelCurrent.towardDeg)}°, ` +
          `${Math.round(currentAgreementDeg)}° off the measured heading — partial agreement.`
      );
    }

    if (currentSpeedRatio !== null && currentSpeedRatio < 0.4) {
      notes.push(
        `The tag is moving at ${(currentSpeedRatio * 100).toFixed(0)}% of the modelled ` +
          `current speed, which is what you would expect inshore of the main flow, in ` +
          `shelter, or already partly grounded.`
      );
    } else if (currentSpeedRatio !== null && currentSpeedRatio > 2.5) {
      notes.push(
        `The tag is moving ${currentSpeedRatio.toFixed(1)}x faster than the modelled ` +
          `current, so wind or wave forcing is likely dominating.`
      );
    }
  } else {
    notes.push('No modelled current available for this position.');
  }

  // --- Wind stability ------------------------------------------------------
  let windShiftDeg: number | null = null;
  let windSpeedChangeMs: number | null = null;
  let windShifted = false;

  if (fit.windFrom !== null && ahead.windFrom !== null) {
    windShiftDeg = angleDelta(fit.windFrom, ahead.windFrom);
    if (fit.windSpeed !== null && ahead.windSpeed !== null) {
      windSpeedChangeMs = ahead.windSpeed - fit.windSpeed;
    }
    windShifted =
      windShiftDeg > WIND_SHIFT_DEG ||
      (windSpeedChangeMs !== null && Math.abs(windSpeedChangeMs) > WIND_SPEED_CHANGE_MS);

    notes.push(
      windShifted
        ? `Wind has changed since the track was measured: ${Math.round(fit.windFrom)}° at ` +
            `${(fit.windSpeed ?? 0).toFixed(1)} m/s during the fit, versus ` +
            `${Math.round(ahead.windFrom)}° at ${(ahead.windSpeed ?? 0).toFixed(1)} m/s ahead. ` +
            `The measured vector describes conditions that no longer apply.`
        : `Wind is steady either side of the fit (${Math.round(fit.windFrom)}° at ` +
            `${(fit.windSpeed ?? 0).toFixed(1)} m/s, now ${Math.round(ahead.windFrom)}° at ` +
            `${(ahead.windSpeed ?? 0).toFixed(1)} m/s), so extrapolating it forward is reasonable.`
    );
  } else if (fit.count === 0) {
    notes.push(
      'No wind data covering the fitting window — it may predate the available history.'
    );
  }

  const confidence: DriftForcing['confidence'] = windShifted
    ? 'low'
    : currentAgreementDeg !== null && currentAgreementDeg >= CURRENT_DISAGREE_DEG
      ? 'caution'
      : 'good';

  return {
    current: modelCurrent,
    windDuringFit:
      fit.windSpeed !== null && fit.windFrom !== null
        ? { speedMs: fit.windSpeed, fromDeg: fit.windFrom }
        : null,
    windAhead:
      ahead.windSpeed !== null && ahead.windFrom !== null
        ? { speedMs: ahead.windSpeed, fromDeg: ahead.windFrom }
        : null,
    currentAgreementDeg,
    currentSpeedRatio,
    windShifted,
    windShiftDeg,
    windSpeedChangeMs,
    confidence,
    reasoning: notes.join(' '),
  };
}
