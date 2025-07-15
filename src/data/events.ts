export interface EventItem {
  id: string
  /** ISO date string in YYYY-MM-DD */
  date: string
  title: string
  description: string
}

export const events: EventItem[] = [
  {
    id: "kickoff",
    date: "2025-09-01",
    title: "Implementation Kick‑off",
    description: "Begin testing and logistics prep for BFCM."
  },
  {
    id: "social-teasers",
    date: "2025-10-15",
    title: "Social Media Teasers Start",
    description: "Launch first teaser posts and story countdowns."
  },
  {
    id: "email-teasers",
    date: "2025-11-01",
    title: "Email Teasers + Site Banner",
    description: "Send first teaser email to subscribers and activate homepage countdown banner."
  },
  {
    id: "paid-ads",
    date: "2025-11-15",
    title: "Paid Ads Launch",
    description: "Kick‑off Meta/Google/TikTok ad campaigns."
  },
  {
    id: "popup",
    date: "2025-11-20",
    title: "LBX Hangar Pop‑Up",
    description: "In‑person collab event to hype the sale."
  },
  {
    id: "black-friday",
    date: "2025-11-28",
    title: "Black Friday Sale Begins",
    description: "Sitewide 30% off, tiered savings, first doorbuster."
  },
  {
    id: "doorbuster-2",
    date: "2025-11-29",
    title: "Doorbuster Day 2",
    description: "Second daily flash sale item."
  },
  {
    id: "doorbuster-3",
    date: "2025-11-30",
    title: "Doorbuster Day 3",
    description: "Third daily flash sale item."
  },
  {
    id: "cyber-monday",
    date: "2025-12-01",
    title: "Cyber Monday",
    description: "Final day of BFCM core offers."
  },
  {
    id: "cyber-week",
    date: "2025-12-02",
    title: "Cyber Week Extension",
    description: "25% off leftovers continues."
  },
  {
    id: "end-cyber-week",
    date: "2025-12-05",
    title: "Cyber Week Ends",
    description: "Promotions conclude, ads wind down."
  },
  {
    id: "thank-you",
    date: "2025-12-06",
    title: "Thank‑You Emails & Survey",
    description: "Send gratitude emails and collect feedback."
  }
]
