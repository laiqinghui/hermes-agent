Here is my completed shadow-fleet AIS-gap analysis. Render the final
investigation canvas for it.

Available data handles (already retrieved, bind these directly — do not re-query):
  data://f4e4262d  potential_shadow_fleets suspects (4 rows)
  data://08d4277a  CLYDE NOBLE monthly AIS activity (4 rows)
  data://c771b7aa  WONDER VEGA monthly AIS activity (6 rows)
  data://4c10f34c  TREND monthly AIS activity (3 rows)
  data://1355b700  AGNI daily AIS activity (6 rows)

KEY JUDGMENTS — highest-value imagery tasking windows:
 1. AGNI (IMO 9314167), 2025-06-25 20:22Z to 2025-11-20 19:37Z — 148.0-day
    silence, the longest observed. No MMSI change.
 2. CLYDE NOBLE (IMO 9282792), 2025-05-19 06:30Z to 2025-09-08 01:07Z —
    111.8 days, with an MMSI change 511100866 -> 307031000.
 3. WONDER VEGA (IMO 9293155), 2025-07-17 16:47Z to 2025-09-03 09:28Z —
    47.7 days, with an MMSI change 538009443 -> 610107031.
 4. WONDER VEGA, 2025-09-19 18:30Z to 2025-11-02 02:52Z — 43.3 days, after
    the MMSI change.
 5. TREND (IMO 9231509), 2025-11-02 22:55Z to 2025-12-08 00:22Z — 35.1 days,
    tight geographic boundary.

SENSOR RECOMMENDATION: SAR first for every window (cloud/night independent,
best for confirming presence during AIS silence). High-resolution optical when
daylight and cloud allow, for deck activity, rendezvous and possible STS
indicators. For MMSI-change gaps, task both the late-gap and first-reappearance
windows to see whether the same hull returns under a new identity.

CAVEAT: these are AIS transmission gaps from records returned through the
Denodo-governed AIS view. They indicate absence of returned observations, not
proof of deliberate disablement. Satellite imagery is the independent
corroboration step.
