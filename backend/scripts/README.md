# Mise demo seed data

Scripts that populate a freshly-migrated database with demo content.

- `seed-demo-criterion.js` — the full MIS-26 product demo dataset (Pinnacle Hotel
  Group / The Criterion Hotel, Brisbane QLD), plus a second NSW tenant to keep the
  cross-client isolation story intact.
- `seed.js` — minimal two-client seed used for isolation testing.

Run against a migrated DB:

```bash
node scripts/seed-demo-criterion.js
```

---

## Net vs meter: the gaming labour % denominator (MIS-73 — NON-NEGOTIABLE)

Gaming labour % is the core Duty Manager demo moment (the ">12% labour flag").
Getting the denominator wrong either **invents or hides** that flag, and the two
candidate denominators differ by ~14x. There is exactly one correct denominator.

| Figure | Weekly (Criterion) | What it is | Use as labour-% denominator? |
|---|---|---|---|
| **Net gaming revenue (RTV net)** | **~$126,000** | Net revenue retained by the venue after player wins are paid out (Returned-to-Venue net). | **YES — this is the only correct denominator.** |
| EGM meter turnover | ~$1,800,000 | Gross amount *wagered* through the machines (the meter). Includes money churned and paid back out as wins. | **NEVER.** It is ~14x larger and is operational context only. |

### The formula

```
gaming labour % = gross_labour_cost / net_gaming_revenue (RTV net)
```

For the Criterion demo: `16,450 / 126,000 ≈ 13.05%`, which is **above the 12%
threshold**, so the DM flag fires. Using the meter (`16,450 / 1,800,000 ≈ 0.9%`)
would silently hide the flag — a demo failure.

### Where each figure lives (source of truth)

- **Net** is stored in `pnl_summary.net_gaming_revenue` (monthly; divide by
  `WEEKS_PER_MONTH = 4.33` for the weekly basis). Column 009 comment:
  *"gaming only: net (RTV) revenue."* This is the denominator the code reads.
- **Meter** is stored separately in `pnl_summary.meter_turnover` (009 comment:
  *"gaming only: amount wagered (context, never a revenue base)"*) and in
  `egm_machines.weekly_turnover` (per-machine meter turnover). Meter is rendered
  as machine-performance context only and is **never** divided into labour cost.

The seed deliberately keeps these in two distinct columns so the wrong one cannot
be picked up by accident. See the gaming P&L row in `seed-demo-criterion.js`
(`net=126000`, `meter=1800000` per week) and the `deptPlan.gaming.weeklyLabour`
target (`16450`) chosen to land just over 12% of net.

### Code that consumes this

`src/shift-summary-api.js` → `buildShiftSummary()` computes `pct` from
`pnl_summary.net_gaming_revenue` only, carries the mandated comment, and exposes
`gamingLabour.netGamingRevenueWeekly` to the UI. The UI
(`web/src/components/ShiftSummary.jsx`) labels the figure **"of net gaming
revenue (RTV)"** so the denominator is never ambiguous on the demo floor.
