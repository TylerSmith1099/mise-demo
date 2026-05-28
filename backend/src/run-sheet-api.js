// Run Sheet API — full 9-section duty manager run sheet (MIS-639 / MIS-626 W3).
//
//   GET /api/run-sheet
//     Returns the 9-section run sheet for the caller's current shift, scoped by
//     their JWT role tier. Sections the role cannot see are omitted from the
//     response entirely (not DOM-hidden — they are never sent).
//
//   POST /api/run-sheet/alerts/:refId/ack
//     Acknowledge a red compliance alert. Logs to compliance_acknowledgements.
//     Body: { alertType: string }
//
//   POST /api/run-sheet/handover
//     Save (or update) the current shift's handover note.
//     Body: { bodyText: string, tags: string[] }
//
// ISOLATION: every query runs through withClientContext(req.auth.clientId).
// Role tier, staffId, and venueId are always from the VERIFIED token — never
// from the request body (carries the MIS-429 rule forward).

import { Router } from 'express';
import { withClientContext } from './db.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function shiftLabelFromHour(hour) {
  if (hour == null) return null;
  if (hour < 12) return 'Morning';
  if (hour < 16) return 'Afternoon';
  return 'Evening';
}

// Returns the caller's best current shift (live first, then nearest).
async function currentShift(q, { staffId, venueId }) {
  const { rows } = await q(
    `SELECT sh.shift_id, sh.role_name, sh.shift_start, sh.shift_end,
            v.timezone,
            EXTRACT(HOUR FROM sh.shift_start AT TIME ZONE v.timezone)::int AS local_start_hour
       FROM shifts sh
       JOIN venues v ON v.venue_id = sh.venue_id AND v.deleted_at IS NULL
      WHERE sh.staff_id = $1
        AND sh.venue_id = $2
        AND sh.deleted_at IS NULL
      ORDER BY (now() BETWEEN sh.shift_start AND sh.shift_end) DESC,
               ABS(EXTRACT(EPOCH FROM (sh.shift_start - now())))
      LIMIT 1`,
    [staffId, venueId],
  );
  return rows[0] || null;
}

// Returns today's local date string (YYYY-MM-DD) in the venue's timezone.
function venueLocalToday(timezone) {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

// ─── section builders ────────────────────────────────────────────────────────

async function buildHeader(q, { venueId, shift, roleTier }) {
  const today = venueLocalToday(shift.timezone);

  // Venue info
  const { rows: [venue] } = await q(
    `SELECT venue_name FROM venues WHERE venue_id = $1 AND deleted_at IS NULL`,
    [venueId],
  );

  // Calendar check (public holiday, trading-hours override)
  const { rows: [cal] } = await q(
    `SELECT is_public_holiday, holiday_name, trading_hours_override
       FROM venue_calendar
      WHERE venue_id = $1 AND calendar_date = $2::date`,
    [venueId, today],
  );

  // Weather (static demo seed — graceful degrade if absent)
  const { rows: [wx] } = await q(
    `SELECT temperature_c, condition_label, trade_note
       FROM weather_cache
      WHERE venue_id = $1 AND cached_date = $2::date`,
    [venueId, today],
  );

  const localDt = new Date(shift.shift_start).toLocaleDateString('en-AU', {
    timeZone: shift.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return {
    venueName: venue?.venue_name || '',
    dateLabel: localDt,
    shiftLabel: shiftLabelFromHour(shift.local_start_hour),
    shiftStart: shift.shift_start,
    shiftEnd: shift.shift_end,
    weather: wx
      ? { temperatureC: wx.temperature_c, conditionLabel: wx.condition_label, tradeNote: wx.trade_note }
      : null,
    publicHoliday: cal?.is_public_holiday
      ? { name: cal.holiday_name || 'Public Holiday' }
      : null,
    tradingHoursOverride: cal?.trading_hours_override || null,
  };
}

async function buildAlerts(q, { venueId, shiftId, roleTier, staffId }) {
  const today = new Date().toISOString().slice(0, 10);
  const alerts = [];

  if (roleTier <= 5) {
    // Cert expiries: expiring ≤30 days or already expired
    const { rows: certs } = await q(
      `SELECT c.cert_type, c.expires_at,
              s.first_name || ' ' || s.last_name AS staff_name,
              c.cert_id
         FROM certifications c
         JOIN staff s ON s.staff_id = c.staff_id AND s.deleted_at IS NULL
        WHERE s.venue_id = $1
          AND c.deleted_at IS NULL
          AND c.expires_at <= (CURRENT_DATE + INTERVAL '30 days')`,
      [venueId],
    );
    for (const c of certs) {
      const expired = new Date(c.expires_at) < new Date(today);
      const daysLeft = Math.ceil((new Date(c.expires_at) - new Date(today)) / 86400000);
      alerts.push({
        alertId: c.cert_id,
        alertType: 'cert_expiry',
        severity: expired ? 'critical' : 'warning',
        label: expired
          ? `${c.staff_name} — ${c.cert_type.toUpperCase()} cert EXPIRED`
          : `${c.staff_name} — ${c.cert_type.toUpperCase()} cert expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        refId: c.cert_id,
      });
    }

    // Open incidents from prior shifts
    const { rows: incidents } = await q(
      `SELECT incident_id, incident_type, created_at
         FROM incident_reports
        WHERE venue_id = $1
          AND status IN ('draft','submitted')
          AND deleted_at IS NULL
          AND created_at < $2::timestamptz
        ORDER BY created_at DESC
        LIMIT 3`,
      [venueId, new Date().toISOString()],
    );
    for (const inc of incidents) {
      alerts.push({
        alertId: inc.incident_id,
        alertType: 'open_incident',
        severity: 'warning',
        label: `1 open incident from last shift — ${inc.incident_type || 'see incident log'}`,
        refId: inc.incident_id,
        deepLink: 'incidents',
      });
    }

    // Gaming understaffing (from compliance_events table if exists)
    try {
      const { rows: understaffing } = await q(
        `SELECT event_id, event_data
           FROM compliance_events
          WHERE venue_id = $1
            AND event_type = 'gaming_understaffing'
            AND acknowledged_at IS NULL
            AND deleted_at IS NULL
          LIMIT 1`,
        [venueId],
      );
      for (const u of understaffing) {
        const data = u.event_data || {};
        alerts.push({
          alertId: u.event_id,
          alertType: 'gaming_understaffing',
          severity: 'critical',
          label: `Gaming floor: ${data.current || '?'} GA rostered — minimum ${data.minimum || 2} required`,
          refId: u.event_id,
          deepLink: 'roster',
        });
      }
    } catch (_) {
      // compliance_events may not have gaming_understaffing rows; skip gracefully
    }
  } else if (roleTier === 7) {
    // Tier 7 sees only their own cert compliance items
    const { rows: certs } = await q(
      `SELECT c.cert_type, c.expires_at, c.cert_id
         FROM certifications c
        WHERE c.staff_id = $1
          AND c.expires_at <= (CURRENT_DATE + INTERVAL '30 days')
          AND c.deleted_at IS NULL`,
      [staffId],
    );
    for (const c of certs) {
      const expired = new Date(c.expires_at) < new Date(today);
      const daysLeft = Math.ceil((new Date(c.expires_at) - new Date(today)) / 86400000);
      alerts.push({
        alertId: c.cert_id,
        alertType: 'cert_expiry',
        severity: expired ? 'critical' : 'warning',
        label: expired
          ? `Your ${c.cert_type.toUpperCase()} cert is EXPIRED`
          : `Your ${c.cert_type.toUpperCase()} cert expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        refId: c.cert_id,
      });
    }
  }

  // Sort: critical first, then warning
  alerts.sort((a, b) => (a.severity === 'critical' ? -1 : 1) - (b.severity === 'critical' ? -1 : 1));
  return alerts;
}

async function buildRoster(q, { venueId, shiftId, staffId, roleTier }) {
  const today = venueLocalToday('Australia/Brisbane');

  // Get roster shifts for today at this venue
  const { rows: rosterRows } = await q(
    `SELECT sh.shift_id, sh.staff_id, sh.role_name, sh.shift_start, sh.shift_end, sh.status,
            s.first_name, s.last_name, s.role_tier,
            vr.area_group, vr.is_rsg_required, vr.is_rsa_required, vr.sort_order,
            COALESCE(rb.break_start, NULL) AS break_start,
            COALESCE(rb.break_end, NULL) AS break_end,
            sc_rsg.expires_at AS rsg_expiry,
            sc_rsa.expires_at AS rsa_expiry
       FROM shifts sh
       JOIN staff s ON s.staff_id = sh.staff_id AND s.deleted_at IS NULL
       LEFT JOIN venue_roles vr ON vr.venue_id = sh.venue_id AND vr.label = sh.role_name AND vr.deleted_at IS NULL
       LEFT JOIN roster_breaks rb ON rb.shift_id = sh.shift_id
       LEFT JOIN certifications sc_rsg ON sc_rsg.staff_id = sh.staff_id
                 AND sc_rsg.cert_type = 'rsg' AND sc_rsg.deleted_at IS NULL
       LEFT JOIN certifications sc_rsa ON sc_rsa.staff_id = sh.staff_id
                 AND sc_rsa.cert_type = 'rsa' AND sc_rsa.deleted_at IS NULL
      WHERE sh.venue_id = $1
        AND sh.deleted_at IS NULL
        AND sh.shift_start >= $2::timestamptz
        AND sh.shift_start < ($2::date + INTERVAL '1 day')::timestamptz
      ORDER BY COALESCE(vr.sort_order, 99), sh.shift_start`,
    [venueId, `${today}T00:00:00+10:00`],
  );

  const today_ts = new Date().toISOString();
  const groups = {};

  for (const row of rosterRows) {
    // Tier 7 sees only gaming area
    if (roleTier === 7 && row.area_group !== 'gaming') continue;

    const group = row.area_group || 'other';
    if (!groups[group]) groups[group] = { label: groupLabel(group), members: [] };

    const rsgExpired = row.rsg_expiry && new Date(row.rsg_expiry) < new Date(today_ts);
    const rsgExpiring = row.rsg_expiry && !rsgExpired && daysUntil(row.rsg_expiry) <= 30;
    const rsaExpired = row.rsa_expiry && new Date(row.rsa_expiry) < new Date(today_ts);
    const rsaExpiring = row.rsa_expiry && !rsaExpired && daysUntil(row.rsa_expiry) <= 30;

    groups[group].members.push({
      staffId: row.staff_id,
      name: `${row.first_name} ${row.last_name}`,
      role: row.role_name,
      shiftStart: row.shift_start,
      shiftEnd: row.shift_end,
      breakStart: row.break_start || null,
      breakEnd: row.break_end || null,
      breakLabel: row.break_start
        ? `${hhmm(row.break_start)}–${hhmm(row.break_end)}`
        : 'Break TBC',
      status: row.status,
      certs: buildCertChips({ row, rsgExpired, rsgExpiring, rsaExpired, rsaExpiring }),
      isCurrentUser: row.staff_id === staffId,
    });
  }

  const orderedGroups = GROUP_ORDER.filter((g) => groups[g]).map((g) => ({
    groupKey: g,
    label: groups[g].label,
    members: groups[g].members,
  }));

  return { groups: orderedGroups, totalCount: rosterRows.length };
}

const GROUP_ORDER = ['management', 'bar_foh', 'gaming', 'kitchen', 'bottle_shop', 'security'];

function groupLabel(key) {
  const labels = {
    management: 'Management',
    bar_foh: 'Bar / FOH',
    gaming: 'Gaming',
    kitchen: 'Kitchen',
    bottle_shop: 'Bottle Shop',
    security: 'Security',
  };
  return labels[key] || key;
}

function hhmm(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-AU', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Australia/Brisbane',
  });
}

function daysUntil(iso) {
  return Math.ceil((new Date(iso) - new Date()) / 86400000);
}

function buildCertChips({ row, rsgExpired, rsgExpiring, rsaExpired, rsaExpiring }) {
  const chips = [];
  if (row.is_rsg_required) {
    if (!row.rsg_expiry) chips.push({ type: 'rsg', status: 'missing', label: 'RSG missing' });
    else if (rsgExpired) chips.push({ type: 'rsg', status: 'expired', label: 'RSG EXPIRED' });
    else if (rsgExpiring) chips.push({ type: 'rsg', status: 'expiring', label: `RSG exp ${daysUntil(row.rsg_expiry)}d` });
    else chips.push({ type: 'rsg', status: 'ok', label: 'RSG ✓' });
  }
  if (row.is_rsa_required) {
    if (!row.rsa_expiry) chips.push({ type: 'rsa', status: 'missing', label: 'RSA missing' });
    else if (rsaExpired) chips.push({ type: 'rsa', status: 'expired', label: 'RSA EXPIRED' });
    else if (rsaExpiring) chips.push({ type: 'rsa', status: 'expiring', label: `RSA exp ${daysUntil(row.rsa_expiry)}d` });
    else chips.push({ type: 'rsa', status: 'ok', label: 'RSA ✓' });
  }
  return chips;
}

async function buildSports(q, { venueId }) {
  const today = venueLocalToday('Australia/Brisbane');
  const { rows } = await q(
    `SELECT se.event_id, se.event_name, se.teams, se.competition,
            se.start_time, se.channel_label, se.is_sound_on, se.crowd_impact,
            vs.screen_label, vs.zone_label
       FROM sports_events se
       LEFT JOIN venue_screens vs ON vs.current_event_id = se.event_id
                 AND vs.deleted_at IS NULL
      WHERE se.venue_id = $1
        AND se.event_date = $2::date
        AND se.deleted_at IS NULL
      ORDER BY se.start_time`,
    [venueId, today],
  );

  // Group by event (multiple screens can carry same event)
  const eventMap = new Map();
  for (const row of rows) {
    if (!eventMap.has(row.event_id)) {
      eventMap.set(row.event_id, {
        eventId: row.event_id,
        eventName: row.event_name,
        teams: row.teams || null,
        competition: row.competition || null,
        startTime: row.start_time,
        channelLabel: row.channel_label,
        isSoundOn: row.is_sound_on,
        crowdImpact: row.crowd_impact || 'medium',
        screens: [],
      });
    }
    if (row.screen_label) {
      eventMap.get(row.event_id).screens.push({
        label: row.screen_label,
        zone: row.zone_label,
      });
    }
  }
  return Array.from(eventMap.values());
}

async function buildSpecials(q, { venueId }) {
  const today = venueLocalToday('Australia/Brisbane');

  const { rows: specials } = await q(
    `SELECT special_id, dish_name, description, price_cents, allergen_tags,
            available_count, is_pushed, service
       FROM chef_specials
      WHERE venue_id = $1
        AND service_date = $2::date
        AND deleted_at IS NULL
      ORDER BY is_pushed DESC, created_at`,
    [venueId, today],
  );

  const { rows: eightySix } = await q(
    `SELECT item_id, category, item_name, reason
       FROM eighty_six_items
      WHERE venue_id = $1
        AND service_date = $2::date
        AND deleted_at IS NULL
      ORDER BY logged_at`,
    [venueId, today],
  );

  return {
    specials: specials.map((s) => ({
      id: s.special_id,
      dishName: s.dish_name,
      description: s.description || null,
      priceDollars: (s.price_cents / 100).toFixed(2),
      allergenTags: s.allergen_tags || [],
      availableCount: s.available_count,
      isPushed: s.is_pushed,
      service: s.service,
    })),
    eightySix: eightySix.map((e) => ({
      id: e.item_id,
      category: e.category,
      itemName: e.item_name,
      reason: e.reason || null,
    })),
  };
}

async function buildBookings(q, { venueId }) {
  const today = venueLocalToday('Australia/Brisbane');

  // Try the bookings table (migration 035). If it doesn't exist yet, return null.
  try {
    const { rows } = await q(
      `SELECT booking_id, booking_time, guest_name, pax, area, occasion,
              vip, dietary, table_number, special_requirements, status
         FROM bookings
        WHERE venue_id = $1
          AND booking_date = $2::date
          AND status NOT IN ('cancelled')
          AND deleted_at IS NULL
        ORDER BY booking_time`,
      [venueId, today],
    );

    const totalCovers = rows.reduce((sum, r) => sum + r.pax, 0);
    const largeGroups = rows.filter((r) => r.pax >= 8);
    const vipCount = rows.filter((r) => r.vip).length;

    // Split lunch vs dinner by booking time
    const lunchCovers = rows
      .filter((r) => r.booking_time < '15:00')
      .reduce((sum, r) => sum + r.pax, 0);
    const dinnerCovers = rows
      .filter((r) => r.booking_time >= '15:00')
      .reduce((sum, r) => sum + r.pax, 0);

    return {
      totalCovers,
      lunchCovers,
      dinnerCovers,
      vipCount,
      largeGroups: largeGroups.map((g) => ({
        id: g.booking_id,
        time: g.booking_time,
        guestName: g.guest_name,
        pax: g.pax,
        area: g.area,
        occasion: g.occasion || null,
        vip: g.vip,
        dietary: g.dietary || [],
        specialRequirements: g.special_requirements || null,
        tableNumber: g.table_number || null,
        status: g.status,
      })),
    };
  } catch (_) {
    return null;
  }
}

async function buildIncentives(q, { venueId }) {
  const now = new Date().toISOString();
  const { rows: incentives } = await q(
    `SELECT si.incentive_id, si.name, si.target_description, si.reward_description,
            si.active_from, si.active_to
       FROM shift_incentives si
      WHERE si.venue_id = $1
        AND si.is_active = true
        AND si.deleted_at IS NULL
        AND (si.active_from IS NULL OR si.active_from <= $2::timestamptz)
        AND (si.active_to IS NULL OR si.active_to >= $2::timestamptz)
      ORDER BY si.active_from`,
    [venueId, now],
  );

  const result = [];
  for (const inc of incentives) {
    const { rows: scores } = await q(
      `SELECT is2.score, s.first_name || ' ' || s.last_name AS name
         FROM incentive_scores is2
         JOIN staff s ON s.staff_id = is2.staff_id AND s.deleted_at IS NULL
        WHERE is2.incentive_id = $1
        ORDER BY is2.score DESC
        LIMIT 5`,
      [inc.incentive_id],
    );
    result.push({
      id: inc.incentive_id,
      name: inc.name,
      targetDescription: inc.target_description || null,
      rewardDescription: inc.reward_description || null,
      activeFrom: inc.active_from,
      activeTo: inc.active_to,
      leaderboard: scores.map((s, i) => ({ rank: i + 1, name: s.name, score: s.score })),
    });
  }
  return result;
}

async function buildBudget(q, { venueId }) {
  const today = venueLocalToday('Australia/Brisbane');

  // Budget targets (migration 038: revenue_daily_budgets)
  const { rows: budgets } = await q(
    `SELECT channel, budget_cents
       FROM revenue_daily_budgets
      WHERE venue_id = $1 AND trade_date = $2::date`,
    [venueId, today],
  ).catch(() => ({ rows: [] }));

  if (!budgets.length) return null;

  // Actuals from revenue_daily (per-channel rows added by migration 036 + seed)
  const { rows: actuals } = await q(
    `SELECT channel, net_revenue_cents AS actual_cents
       FROM revenue_daily
      WHERE venue_id = $1 AND business_date = $2::date
        AND channel != 'total' AND deleted_at IS NULL`,
    [venueId, today],
  ).catch(() => ({ rows: [] }));

  // Same day last week
  const lastWeekDate = new Date(today);
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lwDate = lastWeekDate.toISOString().slice(0, 10);
  const { rows: lwActuals } = await q(
    `SELECT channel, net_revenue_cents AS lw_cents
       FROM revenue_daily
      WHERE venue_id = $1 AND business_date = $2::date
        AND channel != 'total' AND deleted_at IS NULL`,
    [venueId, lwDate],
  ).catch(() => ({ rows: [] }));

  const actualsMap = Object.fromEntries(actuals.map((r) => [r.channel, Number(r.actual_cents)]));
  const lwMap = Object.fromEntries(lwActuals.map((r) => [r.channel, Number(r.lw_cents)]));

  const departments = budgets.map((b) => {
    const actualCents = actualsMap[b.channel] || 0;
    const lwCents = lwMap[b.channel];
    const pct = b.budget_cents > 0 ? Math.round((actualCents / b.budget_cents) * 100) : 0;
    const variance = lwCents != null ? actualCents - lwCents : null;
    return {
      department: b.channel,
      budgetDollars: Math.round(b.budget_cents / 100),
      actualDollars: Math.round(actualCents / 100),
      lastWeekDollars: lwCents != null ? Math.round(lwCents / 100) : null,
      varianceDollars: variance != null ? Math.round(variance / 100) : null,
      pctToTarget: pct,
      paceStatus: paceStatus(pct),
    };
  });

  // Gaming net RTV from revenue_daily channel='gaming'
  const { rows: [gamingRow] } = await q(
    `SELECT net_revenue_cents
       FROM revenue_daily
      WHERE venue_id = $1 AND business_date = $2::date AND channel = 'gaming'
        AND deleted_at IS NULL
      LIMIT 1`,
    [venueId, today],
  ).catch(() => ({ rows: [null] }));

  // Labour from labour_actuals_daily (seed provides this for gaming % calc)
  const { rows: [labourRow] } = await q(
    `SELECT labour_cost_cents, worked_hours
       FROM labour_actuals_daily
      WHERE venue_id = $1 AND business_date = $2::date
      ORDER BY source DESC
      LIMIT 1`,
    [venueId, today],
  ).catch(() => ({ rows: [null] }));

  // Staff count from today's shifts
  const { rows: [countRow] } = await q(
    `SELECT COUNT(*)::int AS staff_count
       FROM shifts
      WHERE venue_id = $1 AND deleted_at IS NULL
        AND shift_start >= $2::timestamptz
        AND shift_start < ($2::date + INTERVAL '1 day')::timestamptz`,
    [venueId, `${today}T00:00:00+10:00`],
  ).catch(() => ({ rows: [{ staff_count: 0 }] }));

  const gamingNetRtv = gamingRow?.net_revenue_cents ? Number(gamingRow.net_revenue_cents) : null;
  const labourCostCents = Number(labourRow?.labour_cost_cents || 0);
  const gamingLabourPct = gamingNetRtv && gamingNetRtv > 0
    ? Math.round((labourCostCents / gamingNetRtv) * 100 * 10) / 10
    : null;

  return {
    departments,
    labourSnapshot: {
      staffCount: countRow?.staff_count || 0,
      estCostDollars: Math.round(labourCostCents / 100),
      gamingLabourPct,
      gamingLabourFlag: gamingLabourPct != null
        ? (gamingLabourPct > 15 ? 'critical' : gamingLabourPct > 12 ? 'warning' : null)
        : null,
    },
  };
}

function paceStatus(pct) {
  if (pct >= 95) return 'ahead';
  if (pct >= 80) return 'on_track';
  if (pct >= 60) return 'behind';
  return 'well_behind';
}

async function buildHandover(q, { venueId, shiftId, roleTier, staffId }) {
  const today = venueLocalToday('Australia/Brisbane');

  // Prior shift's handover note (last shift before the current one)
  const { rows: [priorNote] } = await q(
    `SELECT hn.note_id, hn.body_text, hn.tags, hn.created_at, hn.is_locked,
            s.first_name || ' ' || s.last_name AS author_name
       FROM shift_handover_notes hn
       LEFT JOIN staff s ON s.staff_id = hn.author_staff_id AND s.deleted_at IS NULL
      WHERE hn.venue_id = $1
        AND hn.shift_id != $2
        AND hn.is_locked = true
      ORDER BY hn.created_at DESC
      LIMIT 1`,
    [venueId, shiftId],
  );

  // Current shift's note (current DM's draft)
  const { rows: [currentNote] } = await q(
    `SELECT hn.note_id, hn.body_text, hn.tags, hn.is_locked, hn.updated_at
       FROM shift_handover_notes hn
      WHERE hn.shift_id = $1`,
    [shiftId],
  );

  // Shift priorities
  const { rows: priorities } = await q(
    `SELECT priority_order, body
       FROM shift_priorities
      WHERE shift_id = $1
      ORDER BY priority_order`,
    [shiftId],
  );

  const canWrite = roleTier <= 5;

  // Tier 7 sees patron+equipment notes only
  const filteredTags = ['equipment_fault', 'patron_note', 'incident', 'stock_note', 'follow_up_required', 'staffing_note'];
  const allowedTags = roleTier === 7
    ? ['equipment_fault', 'patron_note', 'incident']
    : filteredTags;

  return {
    incoming: priorNote
      ? {
          noteId: priorNote.note_id,
          authorName: priorNote.author_name,
          bodyText: priorNote.body_text,
          tags: (priorNote.tags || []).filter((t) => allowedTags.includes(t)),
          createdAt: priorNote.created_at,
        }
      : null,
    current: canWrite
      ? {
          noteId: currentNote?.note_id || null,
          bodyText: currentNote?.body_text || '',
          tags: currentNote?.tags || [],
          isLocked: currentNote?.is_locked || false,
          updatedAt: currentNote?.updated_at || null,
        }
      : null,
    priorities: priorities.map((p) => ({ order: p.priority_order, body: p.body })),
    canWrite,
  };
}

// ─── main assembler ──────────────────────────────────────────────────────────

async function buildRunSheetFull(q, { staffId, venueId, roleTier }) {
  const shift = await currentShift(q, { staffId, venueId });
  if (!shift) return null;

  const shiftId = shift.shift_id;

  const [header, alerts, roster, sports, specials, incentives, handover] = await Promise.all([
    buildHeader(q, { venueId, shift, roleTier }),
    buildAlerts(q, { venueId, shiftId, roleTier, staffId }),
    buildRoster(q, { venueId, shiftId, staffId, roleTier }),
    buildSports(q, { venueId }),
    buildSpecials(q, { venueId }),
    buildIncentives(q, { venueId }),
    buildHandover(q, { venueId, shiftId, roleTier, staffId }),
  ]);

  // Sections omitted for tier 7: bookings + budget
  const budget = roleTier <= 5 ? await buildBudget(q, { venueId }) : undefined;
  const bookings = roleTier !== 7 ? await buildBookings(q, { venueId }) : undefined;

  return {
    roleTier,
    shiftId,
    header,
    alerts,
    roster,
    sports,
    specials,
    bookings: bookings !== undefined ? bookings : undefined,
    incentives,
    budget: budget !== undefined ? budget : undefined,
    handover,
  };
}

// ─── router ──────────────────────────────────────────────────────────────────

export function runSheetFullRouter() {
  const router = Router();

  router.get('/run-sheet', async (req, res, next) => {
    try {
      const { clientId, staffId, venueId, roleTier } = req.auth;
      const sheet = await withClientContext(clientId, (q) =>
        buildRunSheetFull(q, { staffId, venueId, roleTier }),
      );
      if (!sheet) return res.status(404).json({ error: 'no_current_shift' });
      res.json(sheet);
    } catch (err) {
      next(err);
    }
  });

  // Acknowledge a compliance alert from the run sheet
  router.post('/run-sheet/alerts/:refId/ack', async (req, res, next) => {
    try {
      const { clientId, staffId, venueId } = req.auth;
      const { alertType } = req.body || {};
      if (!alertType) return res.status(400).json({ error: 'alertType required' });

      await withClientContext(clientId, (q) =>
        q(
          `INSERT INTO compliance_acknowledgements
             (client_id, venue_id, alert_type, alert_ref_id, acknowledged_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [clientId, venueId, alertType, req.params.refId, staffId],
        ),
      );

      // Also mark the compliance_event as acknowledged if it exists
      try {
        await withClientContext(clientId, (q) =>
          q(
            `UPDATE compliance_events
                SET acknowledged_at = now(), acknowledged_by = $2
              WHERE event_id = $1::uuid AND acknowledged_at IS NULL`,
            [req.params.refId, staffId],
          ),
        );
      } catch (_) {}

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Save or update the current shift's handover note (auto-save)
  router.post('/run-sheet/handover', async (req, res, next) => {
    try {
      const { clientId, staffId, venueId, roleTier } = req.auth;
      if (roleTier > 5) return res.status(403).json({ error: 'forbidden' });

      const { bodyText = '', tags = [] } = req.body || {};

      const sheet = await withClientContext(clientId, (q) =>
        currentShift(q, { staffId, venueId }),
      );
      if (!sheet) return res.status(404).json({ error: 'no_current_shift' });

      const result = await withClientContext(clientId, (q) =>
        q(
          `INSERT INTO shift_handover_notes
               (client_id, venue_id, shift_id, author_staff_id, body_text, tags)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (shift_id) DO UPDATE
             SET body_text  = EXCLUDED.body_text,
                 tags       = EXCLUDED.tags,
                 updated_at = now()
           RETURNING note_id, body_text, tags, updated_at, is_locked`,
          [clientId, venueId, sheet.shift_id, staffId, bodyText, JSON.stringify(tags)],
        ),
      );

      res.json(result.rows[0] || {});
    } catch (err) {
      next(err);
    }
  });

  return router;
}
