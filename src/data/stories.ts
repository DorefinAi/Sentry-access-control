// Every story that moved today (and three from yesterday, so their traces open).
// Counts, traces, logs and the daily report are all derived from this list.
import { addMin, at, YESTERDAY } from "./time";
import { UNKNOWN_WA_NUMBER } from "./world";

export type Source = "portal" | "outlook" | "whatsapp";
export type DigitalOutcome =
  | "posted"
  | "recalled"
  | "waiting_operator"
  | "operator_rejected"
  | "render_failed"
  | "skipped";

export interface Story {
  slug: string;
  headline: string;
  reporter: string | null;
  city: string | null;
  source: Source;
  itemId: string;
  from: string; // phone, email or portal user
  receivedAt: string;
  desk: "waiting" | "approved" | "rejected";
  deskAt?: string;
  deskBy?: string;
  rejectReason?: string;
  files?: { count: number; mb: number };
  oversize?: { name: string; mb: number }[];
  ftp?: "done" | "failed" | "uploading";
  ftpAt?: string;
  ftpAttempts?: string[];
  feedAt?: string;
  collectedAt?: string;
  digital?: DigitalOutcome;
  ingestAt?: string;
  renderAt?: string;
  renderAttempts?: string[];
  operatorAt?: string;
  operator?: string;
  postedAt?: string;
  xPostId?: string;
  recalledAt?: string;
  recallReason?: string;
}

export const CITY_NAMES: Record<string, string> = {
  JPR: "Jaipur",
  AJM: "Ajmer",
  UDR: "Udaipur",
  JDH: "Jodhpur",
  KOTA: "Kota",
};

type RepKey = "P" | "R" | "S" | "T" | "B";

const REPORTERS: Record<Exclude<RepKey, "B">, { name: string; code: string; phone: string; email: string; user: string }> = {
  P: { name: "Pooja", code: "POOJA", phone: "919828011201", email: "pooja@vartmaan.in", user: "pooja.jpr" },
  R: { name: "Ramesh", code: "RAMESH", phone: "919829022302", email: "ramesh@vartmaan.in", user: "ramesh.ajm" },
  S: { name: "Sunita", code: "SUNITA", phone: "919829033403", email: "sunita@vartmaan.in", user: "sunita.udr" },
  T: { name: "Test Reporter", code: "TEST", phone: "919000000001", email: "test@vartmaan.in", user: "test.reporter" },
};

function bureau(city: string) {
  const lower = city === "KOTA" ? "kota" : "jodhpur";
  return {
    name: `${CITY_NAMES[city]} bureau`,
    code: "BUREAU",
    phone: "",
    email: `${lower}.bureau@vartmaan.in`,
    user: `${lower}.bureau`,
  };
}

function rep(key: RepKey, city: string) {
  return key === "B" ? bureau(city) : REPORTERS[key];
}

function itemId(source: Source, n: number): string {
  const prefix = source === "whatsapp" ? "wa" : source === "outlook" ? "ol" : "pt";
  return `${prefix}-${(0x3a10 + n * 37).toString(16)}`;
}

function xId(n: number): string {
  return `18492${String(310000000000 + n * 7919).padStart(14, "0")}`;
}

const OPERATORS = ["op.neha", "op.arjun"];

// [received, city, subject, type, reporter, source, outcome, headline, minutes to feed, digital outcome]
type Row = [string, string, string, string, RepKey, Source, "feed" | "rej" | "wait", string, number?, DigitalOutcome?];

const ROWS: Row[] = [
  ["06:42", "JPR", "DOODH_DAAM", "AV", "P", "whatsapp", "feed", "जयपुर में दूध के दाम बढ़े", 6, "posted"],
  ["06:55", "JDH", "MEHRANGARH_UTSAV", "PKG", "B", "outlook", "feed", "मेहरानगढ़ में लोक उत्सव की धूम", 10, "posted"],
  ["07:15", "UDR", "PICHOLA_SAFAI", "AV", "S", "whatsapp", "feed", "पिछोला झील में सफाई अभियान शुरू", 7, "posted"],
  ["07:30", "KOTA", "CHAMBAL_RIVERFRONT", "VO", "B", "outlook", "feed", "चंबल रिवरफ्रंट पर लाइट शो", 11, "posted"],
  ["07:48", "AJM", "PUSHKAR_MELA_TAIYARI", "AV", "R", "whatsapp", "feed", "पुष्कर मेले की तैयारियां तेज", 5, "posted"],
  ["08:20", "JPR", "SCHOOL_BUS_HADSA", "AV", "P", "whatsapp", "feed", "जयपुर में स्कूल बस पलटी, बच्चे सुरक्षित", 9, "posted"],
  ["08:35", "JDH", "TANKA_YOJANA", "VO", "B", "outlook", "rej", "टांका योजना पर रिपोर्ट"],
  ["08:55", "UDR", "SADAK_GADDHE", "AV", "S", "whatsapp", "rej", "शहर की सड़कों पर गड्ढे"],
  ["09:05", "KOTA", "COACHING_FEES", "VO", "B", "outlook", "feed", "कोचिंग फीस पर नई गाइडलाइन", 12, "posted"],
  ["09:20", "JPR", "AMER_FORT_LIGHT", "PKG", "P", "portal", "feed", "आमेर किले में नया लाइट एंड साउंड शो", 7, "posted"],
  ["09:40", "AJM", "ANA_SAGAR_JALSTAR", "AV", "R", "whatsapp", "feed", "आनासागर का जलस्तर बढ़ा", 6, "posted"],
  ["10:05", "JPR", "HAWA_MAHAL_PARYATAK", "AV", "P", "whatsapp", "feed", "हवा महल में पर्यटकों की भीड़", 7, "skipped"],
  ["10:30", "JDH", "BAJRA_KHARID", "PKG", "B", "outlook", "feed", "बाजरा खरीद केंद्र खुले", 9, "posted"],
  ["10:40", "AJM", "KISHANGARH_MARBLE", "PKG", "R", "portal", "feed", "किशनगढ़ मार्बल मंडी में सुस्ती", 5, "posted"],
  ["10:50", "UDR", "DEEPAWALI_BAZAR", "AV", "S", "whatsapp", "feed", "दीपावली से पहले बाजारों में रौनक", 4, "posted"],
  ["12:10", "JPR", "DENGUE_MAMLE", "AV", "P", "whatsapp", "feed", "जयपुर में डेंगू के मामले बढ़े", 8, "posted"],
  ["12:20", "KOTA", "DORIA_SAREE", "PKG", "B", "outlook", "feed", "कोटा डोरिया साड़ी को नई पहचान", 14, "posted"],
  ["12:45", "AJM", "RAILWAY_STATION_SAFAI", "AV", "R", "whatsapp", "rej", "रेलवे स्टेशन पर सफाई"],
  ["13:05", "JPR", "NAGAR_NIGAM_BAITHAK", "VO", "P", "outlook", "feed", "नगर निगम की बैठक में हंगामा", 6, "posted"],
  ["13:20", "UDR", "FATEHSAGAR_NAUKA", "AV", "S", "whatsapp", "feed", "फतहसागर में नौका विहार फिर शुरू", 7, "posted"],
  ["13:35", "UDR", "CITY_PALACE", "PKG", "S", "portal", "feed", "सिटी पैलेस में शाही उत्सव", 6, "skipped"],
  ["14:05", "JPR", "BIJLI_KATAUTI", "AV", "P", "whatsapp", "feed", "कई इलाकों में बिजली कटौती", 6, "waiting_operator"],
  ["14:15", "JPR", "MAHILA_THANA", "PKG", "P", "portal", "rej", "महिला थाने का उद्घाटन"],
  ["14:30", "JDH", "HANDICRAFT_EXPORT", "PKG", "B", "outlook", "feed", "हस्तशिल्प निर्यात में बढ़त", 7, "operator_rejected"],
  ["15:10", "KOTA", "TRAIN_LATE", "VO", "B", "outlook", "rej", "कोहरे से पहले ही ट्रेनें देरी से"],
  ["15:30", "AJM", "KISAN_PRADARSHAN", "AV", "R", "whatsapp", "feed", "अजमेर में किसानों का प्रदर्शन", 7, "waiting_operator"],
  ["15:42", "AJM", "COLLEGE_CHUNAV", "VO", "R", "outlook", "feed", "कॉलेज छात्रसंघ चुनाव की तैयारी", 6, "waiting_operator"],
  ["15:58", "UDR", "AYAD_NADI", "AV", "S", "whatsapp", "wait", "आयड़ नदी के किनारे अतिक्रमण"],
  ["16:04", "JPR", "GULABI_NAGAR_ROSHNI", "AV", "P", "whatsapp", "wait", "गुलाबी नगर में रोशनी की सजावट"],
  ["16:08", "JDH", "GHANTAGHAR_MARKET", "VO", "B", "outlook", "wait", "घंटाघर बाजार में खरीदारी"],
  ["16:11", "AJM", "SOOFI_SANGEET", "AV", "R", "whatsapp", "wait", "सूफी संगीत की शाम"],
  ["16:15", "AJM", "BAAL_MELA", "PKG", "R", "portal", "wait", "बाल मेले में बच्चों की प्रतिभा"],
  ["16:20", "UDR", "SHILPGRAM_UTSAV", "AV", "S", "whatsapp", "wait", "शिल्पग्राम उत्सव की तैयारी"],
  ["16:26", "JPR", "PATANG_BAZAR", "AV", "P", "whatsapp", "wait", "पतंग बाजार में चहल-पहल"],
];

function fromRow(row: Row, n: number): Story {
  const [recv, city, subject, type, key, source, outcome, headline, toFeed, digital] = row;
  const r = rep(key, city);
  const receivedAt = at(recv);
  const story: Story = {
    slug: `271026_${city}_${subject}_${type}_${r.code}`,
    headline,
    reporter: r.name,
    city: CITY_NAMES[city],
    source,
    itemId: itemId(source, n),
    from: source === "whatsapp" ? r.phone : source === "outlook" ? r.email : r.user,
    receivedAt,
    desk: outcome === "feed" ? "approved" : outcome === "rej" ? "rejected" : "waiting",
    files: { count: 1 + (n % 3), mb: type === "PKG" ? 180 + n * 7 : 24 + n * 3 },
  };
  if (outcome === "rej") {
    story.deskAt = addMin(receivedAt, 8);
    story.deskBy = "desk";
    story.rejectReason = n % 2 ? "duplicate of an earlier story" : "not enough for a story";
  }
  if (outcome === "feed" && toFeed) {
    story.deskAt = addMin(receivedAt, toFeed - 3);
    story.deskBy = n % 4 === 0 ? "lead" : "desk";
    story.ftp = "done";
    story.ftpAt = addMin(receivedAt, toFeed - 1);
    story.feedAt = addMin(receivedAt, toFeed);
    story.collectedAt = addMin(story.feedAt, 1);
    story.digital = digital;
    story.ingestAt = addMin(story.feedAt, 2);
    if (digital !== "skipped") story.renderAt = addMin(story.feedAt, 6);
    if (digital === "posted" || digital === "operator_rejected") {
      story.operatorAt = addMin(story.feedAt, 10);
      story.operator = OPERATORS[n % 2];
    }
    if (digital === "posted") {
      story.postedAt = addMin(story.feedAt, 11);
      story.xPostId = xId(n);
    }
  }
  return story;
}

const NAMED: Story[] = [
  {
    slug: "271026_UDR_NAAV_HADSA_AV_SUNITA",
    headline: "उदयपुर में झील में नाव पलटी, सभी लोगों को बचाया गया",
    reporter: "Sunita",
    city: "Udaipur",
    source: "whatsapp",
    itemId: "wa-3f2a",
    from: REPORTERS.S.phone,
    receivedAt: at("11:31"),
    desk: "approved",
    deskAt: at("11:36"),
    deskBy: "desk",
    files: { count: 3, mb: 86 },
    ftp: "done",
    ftpAt: at("11:38"),
    feedAt: at("11:39:30"),
    collectedAt: at("11:52"),
    digital: "posted",
    ingestAt: at("11:41"),
    renderAt: at("11:45"),
    operatorAt: at("11:50"),
    operator: "op.neha",
    postedAt: at("11:51"),
    xPostId: "1849231000000107",
  },
  {
    slug: "271026_JPR_METRO_TRIAL_AV_POOJA",
    headline: "जयपुर मेट्रो के नए रूट पर ट्रायल रन",
    reporter: "Pooja",
    city: "Jaipur",
    source: "whatsapp",
    itemId: "wa-3f31",
    from: REPORTERS.P.phone,
    receivedAt: at("11:36"),
    desk: "approved",
    deskAt: at("11:41"),
    deskBy: "lead",
    files: { count: 2, mb: 54 },
    ftp: "done",
    ftpAt: at("11:42"),
    feedAt: at("11:43"),
    collectedAt: at("11:52"),
    digital: "recalled",
    ingestAt: at("11:45"),
    renderAt: at("11:49"),
    operatorAt: at("11:51"),
    operator: "op.arjun",
    postedAt: at("11:52"),
    xPostId: "1849231000000214",
    recalledAt: at("12:05"),
    recallReason: "wrong photo on the card",
  },
  {
    slug: "271026_JDH_PANI_SANKAT_VO_BUREAU",
    headline: "जोधपुर में पानी का संकट, टैंकरों से सप्लाई",
    reporter: "Jodhpur bureau",
    city: "Jodhpur",
    source: "outlook",
    itemId: "ol-1c07",
    from: "jodhpur.bureau@vartmaan.in",
    receivedAt: at("11:40"),
    desk: "approved",
    deskAt: at("11:44"),
    deskBy: "desk",
    files: { count: 2, mb: 38 },
    ftp: "done",
    ftpAt: at("11:45"),
    feedAt: at("11:46"),
    collectedAt: at("11:52"),
    digital: "posted",
    ingestAt: at("11:48"),
    renderAt: at("11:52"),
    operatorAt: at("11:58"),
    operator: "op.neha",
    postedAt: at("11:59"),
    xPostId: "1849231000000321",
  },
  {
    slug: "271026_AJM_DARGAH_URS_BYTE_RAMESH",
    headline: "अजमेर दरगाह में उर्स की तैयारियां",
    reporter: "Ramesh",
    city: "Ajmer",
    source: "portal",
    itemId: "pt-0b19",
    from: REPORTERS.R.user,
    receivedAt: at("11:43"),
    desk: "approved",
    deskAt: at("11:46"),
    deskBy: "desk",
    files: { count: 1, mb: 22 },
    ftp: "done",
    ftpAt: at("11:48"),
    feedAt: at("11:49"),
    collectedAt: at("11:52"),
    digital: "posted",
    ingestAt: at("11:51"),
    renderAt: at("11:55"),
    operatorAt: at("12:02"),
    operator: "op.arjun",
    postedAt: at("12:03"),
    xPostId: "1849231000000428",
  },
  {
    slug: "271026_AJM_ROZGAR_MELA_PKG_RAMESH",
    headline: "अजमेर में रोजगार मेला, युवाओं को मिले नियुक्ति पत्र",
    reporter: "Ramesh",
    city: "Ajmer",
    source: "portal",
    itemId: "pt-0b42",
    from: REPORTERS.R.user,
    receivedAt: at("13:52"),
    desk: "approved",
    deskAt: at("14:03"),
    deskBy: "chief",
    files: { count: 2, mb: 1152 },
    oversize: [
      { name: "rozgar_mela_full.mp4", mb: 612 },
      { name: "rozgar_mela_bytes.mp4", mb: 540 },
    ],
    ftp: "failed",
    ftpAttempts: [at("14:06"), at("14:11"), at("14:19")],
  },
  {
    slug: "271026_JPR_RAIN_AV_POOJA",
    headline: "जयपुर में तेज बारिश, कई इलाकों में जलभराव",
    reporter: "Pooja",
    city: "Jaipur",
    source: "whatsapp",
    itemId: "wa-41c8",
    from: REPORTERS.P.phone,
    receivedAt: at("14:48"),
    desk: "approved",
    deskAt: at("14:53"),
    deskBy: "desk",
    files: { count: 3, mb: 48 },
    ftp: "done",
    ftpAt: at("14:55"),
    feedAt: at("14:56"),
    collectedAt: at("14:57"),
    digital: "render_failed",
    ingestAt: at("14:58"),
    renderAttempts: [at("15:02"), at("15:09"), at("15:21")],
  },
  {
    slug: "271026_KOTA_DUSSEHRA_MELA_VO_BUREAU",
    headline: "कोटा दशहरा मेले की तैयारियां अंतिम चरण में",
    reporter: "Kota bureau",
    city: "Kota",
    source: "outlook",
    itemId: "ol-1b88",
    from: "kota.bureau@vartmaan.in",
    receivedAt: at("09:27"),
    desk: "approved",
    deskAt: at("09:32"),
    deskBy: "desk",
    files: { count: 2, mb: 64 },
    ftp: "done",
    ftpAt: at("09:34"),
    feedAt: at("09:35"),
    collectedAt: at("09:36"),
    digital: "posted",
    ingestAt: at("09:37"),
    renderAt: at("09:41"),
    operatorAt: at("09:44"),
    operator: "op.neha",
    postedAt: at("09:45"),
    xPostId: "1849231000000535",
  },
  {
    slug: "271026_JPR_VIDHANSABHA_PKG_POOJA",
    headline: "विधानसभा सत्र से पहले सर्वदलीय बैठक",
    reporter: "Pooja",
    city: "Jaipur",
    source: "portal",
    itemId: "pt-0a77",
    from: REPORTERS.P.user,
    receivedAt: at("10:12"),
    desk: "approved",
    deskAt: at("10:16"),
    deskBy: "lead",
    files: { count: 4, mb: 236 },
    ftp: "done",
    ftpAt: at("10:18"),
    feedAt: at("10:19"),
    collectedAt: at("10:20"),
    digital: "posted",
    ingestAt: at("10:21"),
    renderAt: at("10:25"),
    operatorAt: at("10:29"),
    operator: "op.arjun",
    postedAt: at("10:30"),
    xPostId: "1849231000000642",
  },
  {
    slug: "271026_KOTA_COACHING_SURVEY_PKG_BUREAU",
    headline: "कोचिंग छात्रों पर सर्वे: तनाव सबसे बड़ी चिंता",
    reporter: "Kota bureau",
    city: "Kota",
    source: "outlook",
    itemId: "ol-1d3e",
    from: "kota.bureau@vartmaan.in",
    receivedAt: at("16:12"),
    desk: "approved",
    deskAt: at("16:24"),
    deskBy: "lead",
    files: { count: 4, mb: 210 },
    ftp: "uploading",
  },
  {
    slug: "271026_UDR_SMART_CITY_AV_SUNITA",
    headline: "स्मार्ट सिटी प्रोजेक्ट में देरी पर सवाल",
    reporter: "Sunita",
    city: "Udaipur",
    source: "whatsapp",
    itemId: "wa-4310",
    from: REPORTERS.S.phone,
    receivedAt: at("16:18"),
    desk: "waiting",
    files: { count: 2, mb: 41 },
  },
  {
    // No reporter matched, so Samvadia gave it a provisional slug with the sender's number.
    slug: `271026_UNK_WHATSAPP_AV_${UNKNOWN_WA_NUMBER}`,
    headline: "हाईवे पर ट्रक और कार की टक्कर (अज्ञात नंबर से)",
    reporter: null,
    city: null,
    source: "whatsapp",
    itemId: "wa-42e5",
    from: UNKNOWN_WA_NUMBER,
    receivedAt: at("15:52"),
    desk: "waiting",
    files: { count: 1, mb: 31 },
  },
  {
    slug: "271026_JPR_TEST_UPLOAD_AV_TEST",
    headline: "टेस्ट अपलोड",
    reporter: "Test Reporter",
    city: "Jaipur",
    source: "portal",
    itemId: "pt-09f0",
    from: REPORTERS.T.user,
    receivedAt: at("08:02"),
    desk: "rejected",
    deskAt: at("08:05"),
    deskBy: "vansh",
    rejectReason: "test upload",
    files: { count: 1, mb: 3 },
  },
];

// Yesterday's three slowest, kept so the 26 Oct report links open a trace.
const YESTERDAY_STORIES: Story[] = [
  ["10:05", "JDH", "AANDHI_TOOFAN", "AV", "Jodhpur bureau", "outlook", "ol-19a0", 41],
  ["15:12", "UDR", "PARYATAN_SEASON", "PKG", "Sunita", "portal", "pt-0972", 34],
  ["15:30", "AJM", "BAZAR_JAM", "AV", "Ramesh", "whatsapp", "wa-3c11", 29],
].map(([time, city, subject, type, reporter, source, id, toFeed], i) => {
  const receivedAt = at(time as string, YESTERDAY);
  const code = reporter === "Jodhpur bureau" ? "BUREAU" : String(reporter).toUpperCase();
  const feedAt = addMin(receivedAt, toFeed as number);
  return {
    slug: `261026_${city}_${subject}_${type}_${code}`,
    headline: ["जोधपुर में आंधी-तूफान से नुकसान", "उदयपुर में पर्यटन सीजन की शुरुआत", "अजमेर के बाजारों में जाम"][i],
    reporter: reporter as string,
    city: CITY_NAMES[city as string],
    source: source as Source,
    itemId: id as string,
    from: reporter as string,
    receivedAt,
    desk: "approved" as const,
    deskAt: addMin(feedAt, -3),
    deskBy: "desk",
    files: { count: 2, mb: 120 },
    ftp: "done" as const,
    ftpAt: addMin(feedAt, -1),
    feedAt,
    collectedAt: addMin(feedAt, 1),
    digital: "posted" as const,
    ingestAt: addMin(feedAt, 2),
    renderAt: addMin(feedAt, 6),
    operatorAt: addMin(feedAt, 10),
    operator: "op.neha",
    postedAt: addMin(feedAt, 11),
    xPostId: xId(90 + i),
  };
});

export const STORIES: Story[] = [...NAMED, ...ROWS.map((row, i) => fromRow(row, i + 1)), ...YESTERDAY_STORIES].sort(
  (a, b) => a.receivedAt.localeCompare(b.receivedAt),
);

export const STORY_BY_SLUG = new Map(STORIES.map((s) => [s.slug, s]));

export const SLUGS = {
  rain: "271026_JPR_RAIN_AV_POOJA",
  rozgar: "271026_AJM_ROZGAR_MELA_PKG_RAMESH",
  naav: "271026_UDR_NAAV_HADSA_AV_SUNITA",
  metro: "271026_JPR_METRO_TRIAL_AV_POOJA",
  pani: "271026_JDH_PANI_SANKAT_VO_BUREAU",
  dargah: "271026_AJM_DARGAH_URS_BYTE_RAMESH",
  coaching: "271026_KOTA_COACHING_SURVEY_PKG_BUREAU",
  dussehra: "271026_KOTA_DUSSEHRA_MELA_VO_BUREAU",
  vidhansabha: "271026_JPR_VIDHANSABHA_PKG_POOJA",
  smartCity: "271026_UDR_SMART_CITY_AV_SUNITA",
  unknown: `271026_UNK_WHATSAPP_AV_${UNKNOWN_WA_NUMBER}`,
} as const;
