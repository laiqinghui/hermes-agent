# Analysis product — 31 Aug 2026 shadow-fleet AIS-gap investigation

The Hermes agent's own final answer for the session captured in this fixture directory.
This is the **target content**: the canvas produced by that same session
(`render-spec-before.json`) showed none of it — only the source tables it had retrieved.

Everything below was already in the agent's context at `render_view` time. It never
reached the canvas because no component could hold prose or agent-computed rows.
See `apps/gis-canvas/docs/2026-08-31-analysis-product-canvas-design.md`.

---

## Suspect set

`admin.potential_shadow_fleets` returned 4 high-confidence suspects:

| Vessel | IMO | MMSIs in suspect view |
|---|---:|---|
| CLYDE NOBLE | 9282792 | 307031000 → 511100866 |
| TREND | 9231509 | 312325000 → 613007420 |
| AGNI | 9314167 | 538005245 → 655910000 |
| WONDER VEGA | 9293155 | 538009443 → 610107031 |

AIS coverage came from `admin.pg_vessel_positions_select`.

| Vessel | AIS records | First seen | Last seen | Distinct MMSIs |
|---|---:|---|---|---:|
| AGNI | 340 | 2025-06-25 05:17Z | 2025-11-23 09:57Z | 2 |
| CLYDE NOBLE | 2,344 | 2025-05-12 19:42Z | 2025-11-21 05:57Z | 2 |
| TREND | 363 | 2025-11-01 01:02Z | 2025-12-12 05:00Z | 2 |
| WONDER VEGA | 7,791 | 2025-05-15 11:12Z | 2025-12-28 09:42Z | 2 |

---

# Best AIS-gap imagery tasking windows

## 1. AGNI — IMO 9314167

### Gap A — very high-priority
- Last AIS before gap: **2025-06-25 20:22Z**
- First AIS after gap: **2025-11-20 19:37Z**
- Duration: **148.0 days**
- MMSI: **655910000 → 655910000**
- Boundary positions: **1.471362, 104.543933 → 1.755494, 104.753772**

Recommended imagery windows:
- **Early SAR:** 2025-06-26 02:22Z–08:22Z
- **Mid-gap SAR / optical if daylight-clear:** 2025-09-07 13:59Z–2025-09-08 01:59Z
- **Late SAR:** 2025-11-20 07:37Z–13:37Z

### Gap B
- Last AIS before gap: **2025-11-21 14:55Z**
- First AIS after gap: **2025-11-23 07:47Z**
- Duration: **40.9 h**
- Boundary positions: **1.077658, 103.305104 → 1.066374, 103.292370**

Recommended imagery windows:
- **Early SAR:** 2025-11-21 20:55Z–2025-11-22 02:55Z
- **Mid-gap SAR / optical if daylight-clear:** 2025-11-22 05:21Z–17:21Z
- **Late SAR:** 2025-11-22 19:47Z–2025-11-23 01:47Z

---

## 2. CLYDE NOBLE — IMO 9282792

For CLYDE NOBLE, full chronological row retrieval hit a Denodo execution-plan error, so
monthly/daily aggregate boundaries were used and each gap boundary validated with separate
Denodo latest-before / earliest-after row queries.

### Gap A — very high-priority, MMSI change
- Last AIS before gap: **2025-05-19 06:30Z**
- First AIS after gap: **2025-09-08 01:07Z**
- Duration: **111.8 days**
- MMSI: **511100866 → 307031000**
- Boundary positions: **1.872818, 104.861671 → 1.672380, 104.764074**

Recommended imagery windows:
- **Early SAR:** 2025-05-19 12:30Z–18:30Z
- **Mid-gap SAR / optical if daylight-clear:** 2025-07-13 21:48Z–2025-07-14 09:48Z
- **Late SAR:** 2025-09-07 13:07Z–19:07Z

### Gap B
- Last AIS before gap: **2025-09-16 16:35Z**
- First AIS after gap: **2025-10-28 08:37Z**
- Duration: **41.7 days**
- MMSI: **307031000 → 307031000**
- Boundary positions: **2.130400, 104.758974 → 1.875130, 104.802882**

Recommended imagery windows:
- **Early SAR:** 2025-09-16 22:35Z–2025-09-17 04:35Z
- **Mid-gap SAR / optical if daylight-clear:** 2025-10-07 06:36Z–18:36Z
- **Late SAR:** 2025-10-27 20:37Z–2025-10-28 02:37Z

### Gap C
- Last AIS before gap: **2025-10-29 19:36Z**
- First AIS after gap: **2025-11-20 17:07Z**
- Duration: **21.9 days**
- Boundary positions: **1.890226, 104.847185 → 1.740487, 104.765247**

Recommended imagery windows:
- **Early SAR:** 2025-10-30 01:36Z–07:36Z
- **Mid-gap SAR / optical if daylight-clear:** 2025-11-09 12:21Z–2025-11-10 00:21Z
- **Late SAR:** 2025-11-20 05:07Z–11:07Z

---

## 3. WONDER VEGA — IMO 9293155

Full chronological row retrieval also hit the Denodo execution-plan error; month-level
active-period aggregates were used and the key boundary rows validated individually.

### Gap A — high-priority, MMSI change
- Last AIS before gap: **2025-07-17 16:47Z**
- First AIS after gap: **2025-09-03 09:28Z**
- Duration: **47.7 days**
- MMSI: **538009443 → 610107031**
- Boundary positions: **1.785733, 104.707234 → 1.328883, 104.272117**

Recommended imagery windows:
- **Early SAR:** 2025-07-17 22:47Z–2025-07-18 04:47Z
- **Mid-gap SAR / optical if daylight-clear:** 2025-08-10 07:08Z–19:08Z
- **Late SAR:** 2025-09-02 21:28Z–2025-09-03 03:28Z

### Gap B
- Last AIS before gap: **2025-09-19 18:30Z**
- First AIS after gap: **2025-11-02 02:52Z**
- Duration: **43.3 days**
- MMSI: **610107031 → 610107031**
- Boundary positions: **1.786033, 104.677384 → 1.112980, 103.750276**

Recommended imagery windows:
- **Early SAR:** 2025-09-20 00:30Z–06:30Z
- **Mid-gap SAR / optical if daylight-clear:** 2025-10-11 04:41Z–16:41Z
- **Late SAR:** 2025-11-01 14:52Z–20:52Z

### Gap C
- Last AIS before gap: **2025-05-26 19:35Z**
- First AIS after gap: **2025-06-27 07:17Z**
- Duration: **31.5 days**
- MMSI: **538009443 → 538009443**
- Boundary positions: **1.784933, 104.708651 → 1.784683, 104.707234**

Recommended imagery windows:
- **Early SAR:** 2025-05-27 01:35Z–07:35Z
- **Mid-gap SAR / optical if daylight-clear:** 2025-06-11 07:26Z–19:26Z
- **Late SAR:** 2025-06-26 19:17Z–2025-06-27 01:17Z

### Gap D
- Last AIS before gap: **2025-11-26 14:42Z**
- First AIS after gap: **2025-12-02 01:02Z**
- Duration: **5.4 days**
- Boundary positions: **1.377951, 103.228461 → 1.079813, 103.576303**

Recommended imagery windows:
- **Early SAR:** 2025-11-26 20:42Z–2025-11-27 02:42Z
- **Mid-gap SAR / optical if daylight-clear:** 2025-11-29 01:52Z–13:52Z
- **Late SAR:** 2025-12-01 13:02Z–19:02Z

---

## 4. TREND — IMO 9231509

Full AIS rows were retrieved for TREND and analyzed locally.

### Gap A — high-priority
- Last AIS before gap: **2025-11-02 22:55Z**
- First AIS after gap: **2025-12-08 00:22Z**
- Duration: **35.1 days**
- MMSI: **312325000 → 312325000**
- Boundary positions: **1.817228, 104.696247 → 1.852202, 104.678554**

Recommended imagery windows:
- **Early SAR:** 2025-11-03 04:55Z–10:55Z
- **Mid-gap SAR / optical if daylight-clear:** 2025-11-20 05:38Z–17:38Z
- **Late SAR:** 2025-12-07 12:22Z–18:22Z

### Gap B
- Last AIS before gap: **2025-12-09 18:12Z**
- First AIS after gap: **2025-12-11 11:57Z**
- Duration: **41.8 h**
- Boundary positions: **1.850447, 104.678922 → 1.855353, 104.678901**

Recommended imagery windows:
- **Early SAR:** 2025-12-10 00:12Z–06:12Z
- **Mid-gap SAR / optical if daylight-clear:** 2025-12-10 09:04Z–21:04Z
- **Late SAR:** 2025-12-10 23:57Z–2025-12-11 05:57Z

---

# Prioritization

Highest-value imagery tasking targets:

1. **AGNI, 2025-06-25 → 2025-11-20** — longest silence, ~148 days.
2. **CLYDE NOBLE, 2025-05-19 → 2025-09-08** — long silence plus MMSI change.
3. **WONDER VEGA, 2025-07-17 → 2025-09-03** — long silence plus MMSI change.
4. **WONDER VEGA, 2025-09-19 → 2025-11-02** — long silence after MMSI change.
5. **TREND, 2025-11-02 → 2025-12-08** — 35-day silence with tight geographic boundary.

## Sensor recommendation

- **SAR first** for every window: cloud/night independent; best for confirming vessel
  presence during AIS silence.
- **High-resolution optical** when daylight and cloud conditions allow: useful for deck
  activity, rendezvous, possible STS transfer indicators, vessel identity clues, or
  proximity to other vessels.
- For MMSI-change gaps, prioritize imagery near both **late-gap** and **first-reappearance**
  windows to see whether the same hull reappears under a new broadcast identity.

## Caveat

These are AIS transmission gaps based on records returned through the Denodo-governed AIS
view. They indicate absence of returned AIS observations, not proof by themselves of
deliberate AIS disablement. Satellite imagery would be the independent corroboration step.
