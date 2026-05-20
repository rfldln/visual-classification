export const CATEGORIES = [
  { id: "anal",     label: "Anal",      description: "Anal penetration is actively and visibly occurring — insertion of penis, toy, or fingers into the anus must be clearly confirmed. Visible anal area alone is NOT sufficient.", group: "acts" },
  { id: "bbg",      label: "B/B/G",     description: "Two male performers with one female performer",             group: "partnered" },
  { id: "bg",       label: "B/G",       description: "One male and one female performer, standard partnered content", group: "partnered" },
  { id: "bgg",      label: "B/G/G",     description: "One male performer with two female performers",              group: "partnered" },
  { id: "blowjob",  label: "BJ",        description: "Oral sex performed on a male performer",                     group: "acts" },
  { id: "butt",     label: "Butt",      description: "Content showcasing the butt, no penetration",                group: "body" },
  { id: "creampie", label: "Cream Pie", description: "Partnered content ending with an internal finish",           group: "acts" },
  { id: "feet",     label: "Feet",      description: "Content focused on feet, showing or close-ups",              group: "body" },
  { id: "gg",       label: "G/G",       description: "Two female performers together",                             group: "partnered" },
  { id: "ggg",      label: "G/G/G",     description: "Three female performers together",                           group: "partnered" },
  { id: "handjob",  label: "Hand Job",  description: "A female performer uses her hand(s) to stimulate a male performer — male self-stimulation does NOT qualify",  group: "acts" },
  { id: "orgy",     label: "Orgy",      description: "Four or more performers in group content",                   group: "partnered" },
  { id: "pussy",    label: "Pussy",     description: "Content showcasing the vagina, no toy or penetration",       group: "body" },
  { id: "sextape",  label: "Sex Tape",  description: "Higher production B/G content, cinematic quality",           group: "partnered" },
  { id: "solo",     label: "Solo",      description: "Single performer self-pleasure, fingers or toys",            group: "solo" },
  { id: "squirt",   label: "Squirt",    description: "Content where the performer squirts, solo or partnered",     group: "acts" },
  { id: "tits",     label: "Tits",      description: "Content focused on breasts, showing or playing",             group: "body" },
] as const;

export type CategoryId = typeof CATEGORIES[number]["id"];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as readonly CategoryId[];

export const CATEGORY_GROUPS: { key: string; label: string }[] = [
  { key: "solo", label: "Solo content" },
  { key: "partnered", label: "Partnered content" },
  { key: "body", label: "Body focus" },
  { key: "acts", label: "Acts" },
];

// Keyboard shortcut keys (1-9 then a-z) mapped positionally.
const SHORTCUT_POOL = "1234567890qwertyuiopasdfghjklzxcvbnm".split("");
export const CATEGORY_SHORTCUTS: Record<CategoryId, string> = Object.fromEntries(
  CATEGORIES.map((c, i) => [c.id, SHORTCUT_POOL[i] ?? ""]),
) as Record<CategoryId, string>;
