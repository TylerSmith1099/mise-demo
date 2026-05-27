// Development Profile API — Progression Tracker (MIS-536)
// Sprint 1: pre-seeded demo data per spec recommendation (Mise-ProgressionTracker-Spec-V1).
// Sprint 2 (post-QHA demo): replace with live queries against employee_profiles,
// interaction_log, development_record (migration 022).
//
// Endpoints:
//   GET /api/development-profile  — individual profile (tiers 5 and 7)
//   GET /api/team-development     — team view (tier 5 only)

import { Router } from 'express';
import { requireTier } from './permissions.js';

// ---------------------------------------------------------------------------
// Individual profiles — keyed by staff email for demo routing.
// A real implementation would query user_development_profiles WHERE user_id = req.auth.staffId.
// ---------------------------------------------------------------------------
const INDIVIDUAL_PROFILES = {
  // gaming@steward.demo — Gaming Attendant (tier 7)
  gaming: {
    staffName: 'Sarah Chen',
    role: 'Gaming Attendant',
    knowledgeAreas: [
      { category: 'Compliance & Legislation', signal: 'solid',   detail: 'RSA, RSG, harm minimisation', lastEngagedDaysAgo: 2  },
      { category: 'Patron Management',        signal: 'growing', detail: 'RG intervention, self-exclusion', lastEngagedDaysAgo: 3  },
      { category: 'Operational Procedures',   signal: 'active',  detail: 'EGM faults, TITO, float handling', lastEngagedDaysAgo: 0  },
      { category: 'Venue Knowledge',          signal: 'watch',   detail: 'Product knowledge, emergency procedures', lastEngagedDaysAgo: 38 },
    ],
    recentActivity: {
      topics: ['RG patron intervention', 'self-exclusion protocol', 'EGM fault response'],
      totalTopics: 3,
    },
    certifications: [
      { type: 'RSG', status: 'current', label: 'Current', expiresLabel: 'Feb 2027' },
      { type: 'RSA', status: 'current', label: 'Current', expiresLabel: 'Aug 2026' },
    ],
    nudge: null,
    sessionCount: 24,
  },
  // dutymanager@steward.demo — Duty Manager (tier 5) — self profile (not shown in demo)
  default: {
    staffName: 'James Reilly',
    role: 'Duty Manager',
    knowledgeAreas: [
      { category: 'Labour Management',        signal: 'solid',   detail: 'Fair Work, award rates, rostering', lastEngagedDaysAgo: 1  },
      { category: 'Financial Oversight',      signal: 'growing', detail: 'Labour %, gaming net revenue', lastEngagedDaysAgo: 4  },
      { category: 'Compliance Leadership',    signal: 'solid',   detail: 'OLGR obligations, incident management', lastEngagedDaysAgo: 2  },
      { category: 'Operational Intelligence', signal: 'active',  detail: 'Shift handover, exception management', lastEngagedDaysAgo: 0  },
    ],
    recentActivity: {
      topics: ['labour cost variance', 'penalty rate calculations', 'shift handover protocol'],
      totalTopics: 3,
    },
    certifications: [
      { type: 'RSA',  status: 'current', label: 'Current', expiresLabel: 'Mar 2027' },
      { type: 'RMLV', status: 'current', label: 'Current', expiresLabel: 'Nov 2026' },
    ],
    nudge: null,
    sessionCount: 31,
  },
};

// ---------------------------------------------------------------------------
// Team development data — for Venue Manager / Duty Manager team view.
// A real implementation would aggregate development_record + employee_profiles.
// ---------------------------------------------------------------------------
const TEAM_DEVELOPMENT = {
  venueName: 'The Steward Hotel',
  summary: {
    totalStaff: 6,
    activeThisWeek: 4,
    stagnantFlags: 1,
    openCertFlags: 1,
  },
  staff: [
    // Flagged / Stagnant first
    {
      id: 'jordan-k',
      name: 'Jordan K.',
      role: 'Gaming Attendant',
      developmentStatus: 'stagnant',
      lastActivityLabel: '22 days ago',
      topStrength: null,
      activeFlag: 'No Mise activity — 22 days',
      certFlag: 'RSG obligations: not engaged 35+ days',
    },
    {
      id: 'cassie-h',
      name: 'Cassie H.',
      role: 'Gaming Attendant',
      developmentStatus: 'watch',
      lastActivityLabel: '8 days ago',
      topStrength: null,
      activeFlag: null,
      certFlag: 'RSG obligations: not engaged 30+ days',
    },
    // Developing
    {
      id: 'sarah-c',
      name: 'Sarah Chen',
      role: 'Gaming Attendant',
      developmentStatus: 'developing',
      lastActivityLabel: 'Today',
      topStrength: 'RG compliance',
      activeFlag: null,
      certFlag: null,
    },
    {
      id: 'marcus-t',
      name: 'Marcus T.',
      role: 'Gaming Attendant',
      developmentStatus: 'developing',
      lastActivityLabel: '2 days ago',
      topStrength: 'Operational procedures',
      activeFlag: null,
      certFlag: null,
    },
    // Steady
    {
      id: 'priya-r',
      name: 'Priya R.',
      role: 'Gaming Attendant',
      developmentStatus: 'steady',
      lastActivityLabel: '3 days ago',
      topStrength: 'EGM operations',
      activeFlag: null,
      certFlag: null,
    },
    // Not Started
    {
      id: 'daniel-f',
      name: 'Daniel F.',
      role: 'Gaming Attendant',
      developmentStatus: 'not_started',
      lastActivityLabel: 'No activity',
      topStrength: null,
      activeFlag: null,
      certFlag: null,
    },
  ],
  teamGaps: [
    {
      topic: 'RSG obligations',
      description: '3 of 6 not engaged in 30+ days',
    },
    {
      topic: 'Self-exclusion protocol',
      description: '2 of 6 not engaged in 45+ days',
    },
    {
      topic: 'EGM clearance procedure',
      description: '4 of 6 no recent activity',
    },
  ],
  // One notably-developing staff member (positive framing)
  spotlight: {
    name: 'Sarah Chen',
    note: 'Active this week — strong engagement with RG compliance and self-exclusion topics.',
  },
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export function developmentProfileRouter() {
  const router = Router();

  // Individual development profile — tiers 5 and 7.
  router.get('/development-profile', requireTier([5, 7]), (req, res) => {
    // Demo routing: tier 7 (Gaming Attendant) → Sarah Chen; others → default.
    // In production: query by req.auth.staffId against employee_profiles.
    const key = req.auth?.roleTier === 7 ? 'gaming' : 'default';
    const profile = INDIVIDUAL_PROFILES[key];
    res.json(profile);
  });

  // Team development view — tier 5 only (Duty Manager and up in MVP).
  router.get('/team-development', requireTier([4, 5]), (_req, res) => {
    res.json(TEAM_DEVELOPMENT);
  });

  return router;
}
