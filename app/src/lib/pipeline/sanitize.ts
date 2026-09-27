import { defaultSchema } from "rehype-sanitize";

const GLOBAL = ["dataBlock", "dataLines", "className", "id"];

export const ART_TAGS = [
  "art-card",
  "art-callout",
  "art-kpis",
  "art-kpi",
  "art-columns",
  "art-col",
  "art-tabs",
  "art-tab",
  "art-details",
  "art-timeline",
  "art-event",
  "art-table",
  "art-chart",
  "art-embed",
  "art-error",
];

export const schema = {
  ...defaultSchema,
  clobberPrefix: "",
  clobber: [],
  tagNames: [...(defaultSchema.tagNames ?? []), ...ART_TAGS],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), ...GLOBAL],
    "art-card": [...GLOBAL, "title", "subtitle"],
    "art-callout": [...GLOBAL, "tone", "title"],
    "art-kpi": [...GLOBAL, "label", "value", "tone", "delta", "note"],
    "art-columns": [...GLOBAL, "n", "compact", "aside"],
    "art-timeline": [...GLOBAL, "legend"],
    "art-event": [...GLOBAL, "date", "title", "kind", "source"],
    "art-tab": [...GLOBAL, "label"],
    "art-details": [...GLOBAL, "summary", "open"],
    "art-table": [...GLOBAL, "dataTable"],
    "art-chart": [...GLOBAL, "dataChart"],
    "art-embed": [...GLOBAL, "dataEmbed", "dataKind", "dataWidth", "dataHeight", "dataTitle"],
    img: [...(defaultSchema.attributes?.img ?? []), "width", "height", "loading"],
    li: [...(defaultSchema.attributes?.li ?? []), "dataTaskKey"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https"],
    href: ["http", "https", "mailto"],
  },
};
