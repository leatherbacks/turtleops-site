/**
 * Receiver settings for the gear a recovery team is likely to have.
 *
 * The 33938 search at Melbourne Beach showed what goes wrong without them: a
 * team with an Argos goniometer narrowed the tag to a boat lockup but heard it
 * only within ~200 m, at ~40% strength, with bearings jumping. Any of a wrong
 * band, proximity mode left on from the start, or another transmitter would
 * explain that, and nobody had checked the frequency or ID on screen. Each
 * card here gives the settings computed from the tag's own data and a check
 * that the signal heard is this tag. In the same search, a firmware update
 * done afterwards to read the log wiped it, so the firmware check comes first.
 *
 * GONIO 2 settings follow CLS's RXG-234 Installation and User Manual
 * (CLS-ENV-MU-20-0106, issue 1.3) and Recommendations for Goniometry
 * Technique (CLS-ENV-MU-20-0173).
 */

export interface RadioGear {
  id: 'gonio2' | 'other_gonio' | 'uhf_handheld' | 'sdr' | 'vhf_pinger';
  name: string;
  /** One line on what the device is and when to use it. */
  summary: string;
  settings: string[];
  /** How to tell that what you hear is this tag. */
  verify: string;
}

interface Band {
  name: string;
  lo: number;
  hi: number;
}

/** GONIO 2, Argos-only firmware: Setup page 2, Argos Band. */
const GONIO_ARGOS_BANDS: Band[] = [
  { name: 'B1', lo: 401.61, hi: 401.69 },
  { name: 'B2', lo: 401.53, hi: 401.61 },
  { name: 'B3', lo: 401.46, hi: 401.54 },
  { name: 'B4', lo: 401.39, hi: 401.47 },
  { name: 'B5', lo: 401.31, hi: 401.39 },
  { name: 'B6', lo: 401.11, hi: 401.19 },
];
/** GONIO 2, Argos/Kinéis firmware (serial 296 on, FPGA 2.1.0+). */
const GONIO_KINEIS_BANDS: Band[] = [
  { name: 'MSS', lo: 399.9, hi: 399.98 },
  { name: 'ESS1-1', lo: 401.0, hi: 401.08 },
  { name: 'ESS1-2', lo: 401.07, hi: 401.15 },
  { name: 'ESS1-3', lo: 401.14, hi: 401.22 },
  { name: 'ESS2-1', lo: 401.3, hi: 401.38 },
  { name: 'ESS2-2', lo: 401.37, hi: 401.45 },
  { name: 'ESS2-3', lo: 401.44, hi: 401.52 },
  { name: 'ESS3', lo: 401.61, hi: 401.69 },
  { name: 'ESS4-1', lo: 402.87, hi: 402.95 },
  { name: 'ESS4-2', lo: 402.94, hi: 403.02 },
];

/** Bands overlap at the edges; take the one the frequency sits deepest inside. */
export function bandFor(freqMHz: number, bands: Band[]): string | null {
  let best: Band | null = null, margin = -Infinity;
  for (const b of bands) {
    const m = Math.min(freqMHz - b.lo, b.hi - freqMHz);
    if (m >= 0 && m > margin) { best = b; margin = m; }
  }
  return best?.name ?? null;
}

/** Oscillator drift with temperature plus the receiver's ±3.5 ppm. */
export const FREQ_CHECK_HZ = 2000;
/** Handheld UHF radios tune in 2.5 kHz steps at best. */
const HANDHELD_STEP_MHZ = 0.0025;

export function radioGear(opts: {
  frequencyMHz: number | null;
  periodS: number | null;
  manufacturer: string;
}): RadioGear[] {
  const measured = opts.frequencyMHz;
  const f = measured ?? 401.65;
  const p = opts.periodS;
  const every = p ? `every ${p} s` : 'every 30–90 s (interval not measured)';
  const argosBand = bandFor(f, GONIO_ARGOS_BANDS);
  const kineisBand = bandFor(f, GONIO_KINEIS_BANDS);
  const hz = Math.round(f * 1e6);
  const window = measured
    ? `${(hz - FREQ_CHECK_HZ).toLocaleString('en-US')}–${(hz + FREQ_CHECK_HZ).toLocaleString('en-US')} Hz`
    : '401,610,000–401,690,000 Hz (no measured frequency; anything in the band)';
  const idCheck = 'The receiver shows the hexadecimal Argos ID, not the decimal PTT: get it from the Argos web account (Devices tab) or the manufacturer before going.';
  const handheld = (Math.round(f / HANDHELD_STEP_MHZ) * HANDHELD_STEP_MHZ).toFixed(4);

  const gear: RadioGear[] = [
    {
      id: 'gonio2',
      name: 'CLS GONIO 2 (RXG-234 receiver, AXG-234 antenna)',
      summary: 'Argos direction finder that decodes the ID and logs every message from a favourite, with its own GPS position, so a visit can be mapped afterwards.',
      settings: [
        "Before the trip, not after: connect it to Argos Gonio Manager and compare the receiver's firmware (Configuration tab, or the About screen) with the latest on CLS's goniometer page. Update first if it is behind. Updating erases the stored message log, and the current Manager may fail to download from old firmware (\"Bad checksum in RFP binary data\" or \"Invalid command: $ACK,GFG\").",
        `Setup page 2: Direction mode Goniometry, Antenna type AXG234, Argos Band ${argosBand ?? '(none covers this frequency)'} on Argos-only firmware or ${kineisBand ?? '(none)'} on Argos/Kinéis firmware. In any other band the tag is not heard at all; something heard there is another transmitter.`,
        'Proximity OFF while searching. It attenuates the signal and is meant for the last 100 m; left on from the start it makes the tag audible only close in.',
        'Setup page 1: Acquisition GPS ON, so each logged message carries where you stood, and calibrate the compass if it has been near a magnet.',
        `Add the tag as a favourite (RECEIVING PTT screen, or AllToFavorite ON). Only favourites are logged. Label it with the decimal PTT; Repeat period ${p ?? 'blank (the receiver will measure it)'} s; Frequency mode Narrow once it is detected, if other transmitters are about.`,
        'Antenna on its mount, vertical, held high, white pointer toward north. Wait for 3 messages and use the averaged bearing (Ø); walk 30–60° off it in a spiral, and stop for 3 more each time the strength rises.',
        'Bearings jump near buildings, boats and metal: CLS expect it. Take readings from outside, 30–50 m apart, and trust where the strength peaks over any single bearing.',
        'Afterwards: Argos Gonio Manager (Windows) → USB on the receiver (select it twice the first time) → Messages tab → retrieve from flash → export CSV. Each row has time, ID, frequency, band, level (dBm), bearing and the receiver position.',
      ],
      verify: `INFO (left button) shows the last message's Freq: it should read ${window}, a message ${every}. ${idCheck}`,
    },
    {
      id: 'other_gonio',
      name: 'Other Argos goniometer (older RXG-134, other makes)',
      summary: 'Same method; menus differ. Check its manual for band, attenuation and logging.',
      settings: [
        `Set it to receive ${f.toFixed(4)} MHz (the band containing it, if it has bands).`,
        'Any attenuation or close-range mode off until within about 100 m.',
        'Turn on whatever logging it has, and note where you stood and when.',
        'Take bearings from outside buildings, several per spot, and cross them from 2–3 spots.',
      ],
      verify: `Its message or frequency display should show ${window}, ${every}. ${idCheck}`,
    },
    {
      id: 'uhf_handheld',
      name: 'Handheld UHF radio or scanner (400–520 MHz) with a 70 cm Yagi',
      summary: 'Ham foxhunting kit for under $150. No ID decoding or log: you confirm the tag by its frequency and timing.',
      settings: [
        `Tune ${handheld} MHz, narrow FM, squelch off or just above the hiss. Each message is a short burst ${every}.`,
        'RECEIVE ONLY. Never press transmit: transmitting on the Argos band is illegal and can interfere with satellite reception.',
        'Yagi held vertical. Swing a full circle per burst and note the loudest direction; cross bearings from 2–3 spots.',
        'When everything is loud: add an offset or step attenuator, take the antenna off, or detune a few kHz. Last few metres: hold the radio to your chest and turn; the tag is behind you where it goes quietest.',
        'Write down where you stood, the time and how loud each burst was.',
      ],
      verify: `Bursts exactly ${every} on ${handheld} MHz, fading as you walk away. A burst off that rhythm is another transmitter.`,
    },
    {
      id: 'sdr',
      name: 'Software radio (RTL-SDR or similar) with a directional antenna',
      summary: 'A $40 dongle with a laptop (SDR++) or an Android phone (SDR Touch). The waterfall shows the burst, so you can see it is the tag.',
      settings: [
        `Centre ${f.toFixed(3)} MHz, span about 50 kHz, waterfall on. Gain moderate; turn it down as you close in so the burst does not swamp the display.`,
        'Same directional antenna and bearing method as the handheld; read the strength off the waterfall or the signal meter.',
      ],
      verify: `A short stripe at ${f.toFixed(4)} MHz ±0.002 ${every}; nothing else in the span on that rhythm.`,
    },
  ];
  if (opts.manufacturer === 'wildlife_computers')
    gear.push({
      id: 'vhf_pinger',
      name: 'VHF receiver for a recovery pinger or beacon',
      summary: 'Only if the tag has one enabled; ask whoever programmed it. The export does not say.',
      settings: [
        'Get the pinger frequency and pulse rate from the programmer or Wildlife Computers (with the serial number).',
        'A standard wildlife-tracking VHF receiver and Yagi; same bearing method. A pinger that pulses faster than the Argos interval homes quicker.',
      ],
      verify: 'Pulses at the programmed frequency and rate.',
    });
  return gear;
}
