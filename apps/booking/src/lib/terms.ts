/**
 * RACEGROUNDS PTY LTD's terms and conditions, as the owner supplied them (D102,
 * `assets/brand/tnc.txt`), word for word. Two changes only: "at least {arriveEarly} minutes" in
 * sections 4 and 12 is the back office's arrive-early setting (the owner's file said 10; the owner
 * chose 15 to match the booking rules), and a full stop in the address is a comma.
 *
 * Section 3 matches the booking system's own rule since D101: a full refund 24 hours or more before
 * the start, nothing inside that.
 */

export type TermsBlock =
  | { kind: "p"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "important"; text: string }
  | { kind: "list"; items: string[] };

export interface TermsSection {
  number: number;
  title: string;
  /** "Additional Venue Conditions" for sections 12–16. */
  group: string | null;
  blocks: TermsBlock[];
}

export const TERMS_COMPANY = { name: "RACEGROUNDS PTY LTD", abn: "64 700 493 723" };

export const TERMS_SECTIONS: TermsSection[] = [
  {
    number: 1,
    title: "Acceptance of Terms",
    group: null,
    blocks: [
      { kind: "p", text: "By booking a session, accessing our venue, or using our website, you agree to be bound by these Terms & Conditions. If you do not agree, please do not proceed with any booking or visit to the venue." },
      { kind: "p", text: "RACEGROUNDS PTY LTD (ABN 64 700 493 723), trading as RACEGROUNDS (“RACEGROUNDS”, “we”, “us”, “our”), reserves the right to update these terms from time to time. Updated terms will apply to future bookings. Material changes to existing confirmed bookings will be handled in accordance with applicable law." },
    ],
  },
  {
    number: 2,
    title: "Bookings & Reservations",
    group: null,
    blocks: [
      { kind: "p", text: "All bookings made through the RACEGROUNDS website are confirmed once payment has been successfully processed and a booking confirmation has been issued." },
      { kind: "p", text: "Bookings are subject to availability. RACEGROUNDS reserves the right to reschedule or cancel bookings due to technical issues, events beyond our reasonable control, or operational requirements. Where we cannot provide the booked service, an alternative booking or an appropriate refund will be offered in accordance with applicable law." },
      { kind: "p", text: "Customers must provide accurate personal details when booking. Deliberately false or misleading information may result in cancellation where reasonably justified." },
    ],
  },
  {
    number: 3,
    title: "Cancellation & Refunds",
    group: null,
    blocks: [
      { kind: "p", text: "Cancellations made more than 24 hours before the scheduled session start time are eligible for a full refund." },
      { kind: "p", text: "Cancellations made within 24 hours of the scheduled session are generally non-refundable. No-shows are treated as same-day cancellations." },
      { kind: "p", text: "These cancellation conditions do not limit any refund or other remedy required under Australian Consumer Law." },
      { kind: "p", text: "Approved refunds will be processed through the original payment method and may take approximately 5–10 business days to appear, depending on the payment provider and bank." },
      { kind: "p", text: "RACEGROUNDS reserves the right to refuse entry or terminate a session where a participant is under the influence of alcohol or drugs, behaves in an unsafe or disruptive manner, or deliberately tampers with equipment. Refund eligibility will depend on the circumstances and applicable law." },
    ],
  },
  {
    number: 4,
    title: "Participation, Briefing & Conduct",
    group: null,
    blocks: [
      { kind: "p", text: "All participants must follow reasonable instructions from RACEGROUNDS staff." },
      { kind: "p", text: "A safety briefing will be provided before each session where appropriate. Participants must understand and comply with the instructions before using the equipment." },
      { kind: "p", text: "Customers must arrive at least {arriveEarly} minutes before their scheduled session to allow time for check-in and briefing." },
      { kind: "p", text: "Participants agree to use all simulator equipment responsibly and in accordance with staff instructions." },
      { kind: "p", text: "Deliberate or negligent damage to equipment may result in the participant being held financially responsible for reasonable repair or replacement costs, excluding ordinary wear and tear." },
      { kind: "p", text: "Participants under 14 years of age must be accompanied by a responsible adult who assumes responsibility for their supervision and conduct." },
      { kind: "p", text: "RACEGROUNDS may terminate a session for safety, conduct or operational reasons, subject to customers’ rights under applicable law." },
    ],
  },
  {
    number: 5,
    title: "Assumption of Risk & Limitation of Liability",
    group: null,
    blocks: [
      { kind: "important", text: "IMPORTANT — PLEASE READ CAREFULLY. THIS SECTION AFFECTS YOUR LEGAL RIGHTS." },
      { kind: "heading", text: "(a) Assumption of Inherent Risk" },
      { kind: "p", text: "Sim racing involves motorised force-feedback steering equipment, racing cockpits, large-format displays and immersive audio." },
      { kind: "p", text: "Potential risks include, but are not limited to:" },
      {
        kind: "list",
        items: [
          "Sudden steering wheel rotation or torque kickback causing hand, wrist, finger or arm injury.",
          "Muscle strain, fatigue or discomfort from extended seated activity.",
          "Eye strain, headaches, motion sickness, dizziness, nausea or disorientation.",
          "Photosensitive seizures in susceptible individuals.",
          "Aggravation of pre-existing medical conditions.",
          "Minor impacts or injuries from contact with simulator components.",
        ],
      },
      { kind: "p", text: "Participants acknowledge that these activities carry inherent risks and voluntarily choose to participate." },
      { kind: "heading", text: "(b) Health Declaration" },
      { kind: "p", text: "Participants confirm that they are reasonably fit to participate in their selected activity." },
      { kind: "p", text: "Participants must not use equipment while intoxicated or otherwise impaired in a way that creates a safety risk." },
      { kind: "p", text: "Participants with medical conditions that may be aggravated by physical exertion, force-feedback equipment, visual stimulation or immersive gameplay should seek medical advice where appropriate before participating." },
      { kind: "p", text: "Relevant conditions may include epilepsy, vertigo, severe motion sickness, recent surgery, cardiovascular conditions or musculoskeletal injuries." },
      { kind: "p", text: "Participants must immediately notify staff if they experience discomfort or any health-related symptoms during their session." },
      { kind: "heading", text: "(c) Limitation of Liability" },
      { kind: "p", text: "To the maximum extent permitted by applicable law, RACEGROUNDS PTY LTD, its directors, employees, contractors and representatives are not responsible for injury, loss or damage arising solely from:" },
      {
        kind: "list",
        items: [
          "Inherent risks voluntarily accepted by participants.",
          "Failure to follow safety briefings or reasonable staff instructions.",
          "Improper or unauthorised equipment use.",
          "A participant’s failure to take reasonable care for their own safety.",
        ],
      },
      { kind: "p", text: "Nothing in these Terms excludes, restricts or modifies any consumer guarantee, right or remedy under Australian Consumer Law or any other law to the extent that it cannot lawfully be excluded." },
      { kind: "heading", text: "(d) Recreational Services" },
      { kind: "p", text: "Certain recreational services may be subject to specific statutory provisions concerning contractual limitations of liability, including section 139A of the Competition and Consumer Act 2010 (Cth)." },
      { kind: "p", text: "Any contractual exclusion or limitation relied upon by RACEGROUNDS applies only to the extent lawfully permitted and effective under the relevant legislation." },
      { kind: "p", text: "Nothing in these Terms is intended to exclude liability that cannot legally be excluded, including liability for reckless conduct where prohibited by law." },
    ],
  },
  {
    number: 6,
    title: "Insurance",
    group: null,
    blocks: [
      { kind: "p", text: "Participants are encouraged to maintain suitable personal accident, health and ambulance insurance where appropriate." },
      { kind: "p", text: "Any public liability insurance held by RACEGROUNDS does not replace a participant’s personal insurance arrangements." },
      { kind: "p", text: "Ambulance, medical or hospital expenses may be the responsibility of the participant or their insurer, depending on the circumstances and applicable law." },
      { kind: "p", text: "Nothing in this section limits any liability RACEGROUNDS may have under applicable law." },
    ],
  },
  {
    number: 7,
    title: "Leaderboard & Driver Tags",
    group: null,
    blocks: [
      { kind: "p", text: "Driver tags submitted during booking or registration may be publicly displayed on the RACEGROUNDS leaderboard alongside associated lap times." },
      { kind: "p", text: "By registering a driver tag, participants consent to its display for leaderboard and competition purposes." },
      { kind: "p", text: "RACEGROUNDS reserves the right to remove offensive, misleading, inappropriate or infringing driver tags." },
      { kind: "p", text: "Leaderboard results are recorded primarily for entertainment and competitive purposes and may be corrected, reset or removed where reasonably necessary because of technical faults, competition rules or improper conduct." },
    ],
  },
  {
    number: 8,
    title: "Intellectual Property",
    group: null,
    blocks: [
      { kind: "p", text: "All original content on the RACEGROUNDS website, including text, images, videos, logos, layouts and designs owned by RACEGROUNDS PTY LTD, is protected by applicable intellectual property laws." },
      { kind: "p", text: "Such content may not be copied, reproduced, modified, distributed or commercially used without appropriate authorisation." },
      { kind: "p", text: "The RACEGROUNDS brand name and associated original branding are used by RACEGROUNDS PTY LTD." },
      { kind: "p", text: "Third-party games, software, trademarks and other intellectual property remain the property of their respective owners." },
    ],
  },
  {
    number: 9,
    title: "Privacy",
    group: null,
    blocks: [
      { kind: "p", text: "Personal information collected through bookings and venue operations is handled in accordance with applicable privacy legislation and our Privacy Policy, available through the RACEGROUNDS website." },
      { kind: "p", text: "By making a booking, customers acknowledge that their personal information will be collected, used and disclosed as described in the Privacy Policy, subject to applicable law." },
    ],
  },
  {
    number: 10,
    title: "Governing Law",
    group: null,
    blocks: [
      { kind: "p", text: "These Terms & Conditions are governed by the laws of New South Wales, Australia." },
      { kind: "p", text: "Any disputes arising in connection with these Terms or the use of RACEGROUNDS services will be dealt with by the courts and tribunals having appropriate jurisdiction in New South Wales, subject to any mandatory legal rights." },
    ],
  },
  {
    number: 11,
    title: "Contact",
    group: null,
    blocks: [
      { kind: "p", text: "For questions regarding these Terms & Conditions, please contact:" },
      { kind: "p", text: "RACEGROUNDS PTY LTD" },
      { kind: "p", text: "Trading as RACEGROUNDS" },
      { kind: "p", text: "ABN: 64 700 493 723" },
      { kind: "p", text: "Venue Address: 8-18 Bowden Street, Alexandria" },
      { kind: "p", text: "Email: racegrounds@gmail.com" },
      { kind: "p", text: "Website: racegrounds.au" },
    ],
  },
  {
    number: 12,
    title: "Late Arrivals",
    group: "Additional Venue Conditions",
    blocks: [
      { kind: "p", text: "Customers must arrive at least {arriveEarly} minutes before their scheduled session." },
      { kind: "p", text: "Late arrivals may result in reduced playing time without compensation. Session extensions are subject to availability." },
      { kind: "p", text: "No-shows are subject to our cancellation policy and applicable consumer law." },
    ],
  },
  {
    number: 13,
    title: "Equipment Malfunctions",
    group: "Additional Venue Conditions",
    blocks: [
      { kind: "p", text: "In the event of simulator or equipment malfunction, RACEGROUNDS will make reasonable efforts to restore service or provide an alternative simulator." },
      { kind: "p", text: "If the purchased service cannot be adequately provided, customers may be entitled to a replacement session, partial refund or full refund in accordance with Australian Consumer Law." },
    ],
  },
  {
    number: 14,
    title: "Virtual Reality (VR) Safety",
    group: "Additional Venue Conditions",
    blocks: [
      { kind: "p", text: "VR participants acknowledge the potential risks of dizziness, motion sickness, nausea, disorientation and eye strain." },
      { kind: "p", text: "Participants must follow staff instructions and immediately discontinue use if they experience discomfort." },
      { kind: "p", text: "Participants must comply with applicable VR equipment age and safety requirements." },
    ],
  },
  {
    number: 15,
    title: "Billiards & Equipment Usage",
    group: "Additional Venue Conditions",
    blocks: [
      { kind: "p", text: "Customers must use billiards tables, cues, balls and simulator equipment responsibly." },
      { kind: "p", text: "Sitting on tables, throwing equipment, aggressive behaviour and any deliberate misuse are strictly prohibited." },
      { kind: "p", text: "Customers may be held responsible for reasonable repair or replacement costs resulting from deliberate or negligent damage, excluding normal wear and tear." },
    ],
  },
  {
    number: 16,
    title: "Photography, CCTV & Promotional Content",
    group: "Additional Venue Conditions",
    blocks: [
      { kind: "p", text: "CCTV may operate within the venue for security and safety purposes, subject to applicable privacy and surveillance laws." },
      { kind: "p", text: "Customers may take photos and videos for personal use, provided they do not disrupt operations or infringe on others’ privacy." },
      { kind: "p", text: "RACEGROUNDS will obtain appropriate consent before using identifiable customer images or videos for promotional purposes where required by law." },
    ],
  },
];

/** Puts the venue's arrive-early minutes into the text. */
export const withArriveEarly = (text: string, minutes: number) => text.replaceAll("{arriveEarly}", String(minutes));
