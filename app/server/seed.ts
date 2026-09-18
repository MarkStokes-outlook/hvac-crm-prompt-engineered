/**
 * Demo data. All people, customers and figures are fictional (the two founders are named on
 * the FrostLine website). Everything is generated relative to "now" so the demo always has
 * work today, overdue response targets, upcoming PPM, etc.
 */
import { DB } from "./db.js";
import { addDays, addHours, fmtDateTime, now, nowDate, today } from "./time.js";
import { hashPassword } from "./services/auth.js";

export const DEMO_PASSWORD = "frostline";

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];

export function seedDatabase(db: DB) {
  seed = 42;
  const T = today();
  const N = now();
  const at = (dayOffset: number, time: string) => `${addDays(T, dayOffset)}T${time}`;
  const minutesAgo = (m: number) => {
    const d = new Date(nowDate().getTime() - m * 60000);
    d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
    return fmtDateTime(d);
  };
  /** n-th working day (Mon–Fri) after today, so future demo bookings never land on a weekend. */
  const wd = (n: number) => {
    let d = T;
    for (let i = 0; i < n; ) {
      d = addDays(d, 1);
      const dow = new Date(d + "T12:00").getDay();
      if (dow !== 0 && dow !== 6) i++;
    }
    return d;
  };
  const atWd = (n: number, time: string) => `${wd(n)}T${time}`;

  const ins = (table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row);
    const r = db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((c) => "@" + c).join(",")})`).run(row);
    return Number(r.lastInsertRowid);
  };
  const act = (userId: number | null, action: string, summary: string, refs: Record<string, number | null | undefined>, when: string, via = "ui") =>
    ins("activity", { at: when, user_id: userId, via, action, summary, ...refs });

  const pw = hashPassword(DEMO_PASSWORD);

  // ---------------- users ----------------
  const U: Record<string, number> = {};
  const user = (key: string, name: string, role: string, title: string, extra: Record<string, unknown> = {}) =>
    (U[key] = ins("users", { name, email: `${key}@frostline.example`, role, job_title: title, password_hash: pw, phone: `07700 9${String(Object.keys(U).length).padStart(5, "0")}`, ...extra }));
  user("martin.hale", "Martin Hale", "manager", "Managing Director");
  user("susan.mercer", "Susan Mercer", "manager", "Service Director");
  user("priya.nair", "Priya Nair", "coordinator", "Service Coordinator");
  user("tom.whitaker", "Tom Whitaker", "coordinator", "Service Coordinator");
  user("rachel.dunn", "Rachel Dunn", "sales", "Estimator");
  const eng = (key: string, name: string, title: string, skills: string[], region: string, sub = false) =>
    user(key, name, "engineer", title, { skills: JSON.stringify(skills), base_region: region, is_subcontractor: sub ? 1 : 0 });
  eng("dave.kershaw", "Dave Kershaw", "Senior Refrigeration Engineer", ["refrigeration", "fgas", "ac"], "Greater Manchester");
  eng("lewis.tran", "Lewis Tran", "Service Engineer", ["ac", "fgas", "vrf", "heat_pumps", "controls"], "Greater Manchester");
  eng("sam.oconnor", "Sam O'Connor", "Service Engineer (Ventilation)", ["ventilation", "controls"], "Lancashire");
  eng("aisha.rahman", "Aisha Rahman", "Service Engineer", ["ac", "fgas", "refrigeration", "vrf"], "Merseyside");
  eng("gareth.pike", "Gareth Pike", "Heating Engineer", ["gas", "heat_pumps"], "Cheshire");
  eng("kyle.brennan", "Kyle Brennan", "Improver Engineer", ["ac", "ventilation"], "Greater Manchester");
  eng("nathan.holt", "Nathan Holt", "Lead Engineer (West Yorkshire)", ["refrigeration", "fgas", "ac", "vrf"], "West Yorkshire");
  eng("mick.farrell", "Mick Farrell", "Subcontract Engineer — Controls", ["controls", "ventilation"], "Greater Manchester", true);
  const engineers = ["dave.kershaw", "lewis.tran", "sam.oconnor", "aisha.rahman", "gareth.pike", "kyle.brennan", "nathan.holt"];

  // ---------------- equipment categories ----------------
  const cats: [string, string, string | null][] = [
    ["split_ac", "Split / cassette air conditioning", "fgas"],
    ["vrf", "VRF / VRV system", "vrf"],
    ["chiller", "Chiller", "refrigeration"],
    ["cold_room", "Cold room / commercial refrigeration", "refrigeration"],
    ["ahu", "Air handling unit", "ventilation"],
    ["extract", "Extract / kitchen ventilation", "ventilation"],
    ["mvhr", "Heat recovery ventilation (MVHR)", "ventilation"],
    ["boiler", "Commercial boiler", "gas"],
    ["heat_pump", "Air source heat pump", "heat_pumps"],
    ["fcu", "Fan coil unit", "ac"],
    ["controls", "Controls / BMS", "controls"],
  ];
  for (const [code, label, skill] of cats) ins("equipment_categories", { code, label, suggested_skill: skill });

  // ---------------- suppliers & parts ----------------
  const S1 = ins("suppliers", { name: "Northern Refrigeration Supplies Ltd", phone: "0161 555 0110", email: "orders@northern-refrig.example", account_ref: "FROST01" });
  const S2 = ins("suppliers", { name: "Pennine HVAC Distribution", phone: "01706 555 0142", email: "sales@pennine-hvac.example", account_ref: "FL-2231" });
  const S3 = ins("suppliers", { name: "Mersey Controls & Electrical", phone: "0151 555 0177", email: "trade@mersey-controls.example", account_ref: "FMS100" });
  const P: Record<string, number> = {};
  const part = (sku: string, name: string, category: string, unit: string, cost: number, sell: number, sup: number) =>
    (P[sku] = ins("parts", { sku, name, category, unit, unit_cost: cost, sell_price: sell, preferred_supplier_id: sup }));
  part("FLT-G4-592", "Panel filter G4 592×592×48", "Filters", "each", 6.2, 12.5, S2);
  part("FLT-BAG-F7", "Bag filter F7 592×592 6-pocket", "Filters", "each", 18.4, 36, S2);
  part("FLT-CAS-600", "Cassette return filter 600×600", "Filters", "each", 9.1, 19, S2);
  part("CAP-35-5", "Run capacitor 35+5µF 440V", "Electrical", "each", 8.9, 24, S3);
  part("CAP-45", "Run capacitor 45µF 440V", "Electrical", "each", 7.5, 21, S3);
  part("CON-2P-30A", "Contactor 2-pole 30A 230V coil", "Electrical", "each", 14.2, 38, S3);
  part("FUSE-T3A15", "Fuse T3.15A 5×20 (pack 10)", "Electrical", "pack", 3.8, 9, S3);
  part("PCB-DAI-MAIN", "Daikin indoor main PCB (generic ref)", "Electrical", "each", 142, 265, S1);
  part("FAN-MTR-CDU", "Condenser fan motor 1/4HP 230V", "Motors", "each", 96, 189, S1);
  part("FAN-MTR-EC250", "EC fan motor 250mm", "Motors", "each", 178, 320, S1);
  part("BELT-SPA-1250", "V-belt SPA 1250", "Belts", "each", 7.4, 16, S2);
  part("BELT-SPZ-1000", "V-belt SPZ 1000", "Belts", "each", 5.9, 13, S2);
  part("REF-R32-9", "Refrigerant R32 (per kg)", "Refrigerant", "kg", 22, 58, S1);
  part("REF-R410A", "Refrigerant R410A (per kg)", "Refrigerant", "kg", 31, 78, S1);
  part("REF-R404A", "Refrigerant R404A (per kg)", "Refrigerant", "kg", 44, 105, S1);
  part("REF-R448A", "Refrigerant R448A (per kg)", "Refrigerant", "kg", 39, 92, S1);
  part("PMP-COND-MINI", "Mini condensate pump 230V", "Pumps", "each", 48, 112, S2);
  part("TXV-R404A", "Thermostatic expansion valve R404A", "Refrigeration", "each", 64, 145, S1);
  part("DRIER-083", "Filter drier 3/8\" flare", "Refrigeration", "each", 11, 27, S1);
  part("SOL-VALVE-3/8", "Solenoid valve 3/8\" with coil", "Refrigeration", "each", 52, 118, S1);
  part("PRS-HP-SW", "High pressure switch (manual reset)", "Refrigeration", "each", 29, 68, S1);
  part("THERM-DIG-7D", "Digital room thermostat 7-day", "Controls", "each", 38, 85, S3);
  part("SNS-NTC-10K", "NTC 10k temperature sensor", "Controls", "each", 12, 29, S3);
  part("CTRL-CR-EVCO", "Cold room controller (EVCO type)", "Controls", "each", 88, 185, S3);
  part("IGN-ELEC-SET", "Burner ignition electrode set", "Heating", "set", 24, 58, S2);
  part("PUMP-CIRC-GR", "Circulating pump 25-60 (commercial)", "Heating", "each", 132, 255, S2);
  part("CLN-COIL-5L", "Coil cleaner 5L", "Consumables", "each", 16, 0, S2);
  part("TAPE-PVC", "PVC insulation tape", "Consumables", "roll", 0.9, 0, S3);
  part("LAG-15MM", "Pipe insulation 15mm (2m)", "Consumables", "length", 2.2, 5.5, S2);

  // ---------------- stock locations & levels ----------------
  const STORE = ins("stock_locations", { name: "Depot stores (Greater Manchester)", kind: "store", engineer_id: null });
  const VAN: Record<string, number> = {};
  for (const e of engineers) VAN[e] = ins("stock_locations", { name: `Van — ${e.split(".").map((s) => s[0].toUpperCase() + s.slice(1)).join(" ").replace("Oconnor", "O'Connor")}`, kind: "van", engineer_id: U[e] });
  const setLevel = (sku: string, loc: number, qty: number, min: number) =>
    db.prepare("INSERT INTO stock_levels (part_id, location_id, quantity, min_quantity) VALUES (?, ?, ?, ?) ON CONFLICT(part_id, location_id) DO UPDATE SET quantity = excluded.quantity, min_quantity = excluded.min_quantity").run(P[sku], loc, qty, min);
  const storeLevels: [string, number, number][] = [
    ["FLT-G4-592", 64, 40], ["FLT-BAG-F7", 18, 12], ["FLT-CAS-600", 22, 20], ["CAP-35-5", 9, 10], ["CAP-45", 12, 8], ["CON-2P-30A", 6, 6],
    ["FUSE-T3A15", 14, 5], ["PCB-DAI-MAIN", 1, 1], ["FAN-MTR-CDU", 2, 2], ["FAN-MTR-EC250", 0, 1], ["BELT-SPA-1250", 16, 10], ["BELT-SPZ-1000", 9, 10],
    ["REF-R32-9", 18, 10], ["REF-R410A", 26, 15], ["REF-R404A", 8, 10], ["REF-R448A", 12, 10], ["PMP-COND-MINI", 4, 3], ["TXV-R404A", 1, 2],
    ["DRIER-083", 10, 6], ["SOL-VALVE-3/8", 2, 2], ["PRS-HP-SW", 3, 2], ["THERM-DIG-7D", 5, 3], ["SNS-NTC-10K", 15, 10], ["CTRL-CR-EVCO", 2, 1],
    ["IGN-ELEC-SET", 6, 4], ["PUMP-CIRC-GR", 1, 1], ["CLN-COIL-5L", 11, 6], ["TAPE-PVC", 40, 20], ["LAG-15MM", 30, 20],
  ];
  for (const [sku, q, m] of storeLevels) setLevel(sku, STORE, q, m);
  const vanKit: [string, number, number][] = [
    ["FLT-G4-592", 6, 4], ["CAP-35-5", 2, 2], ["CAP-45", 2, 1], ["CON-2P-30A", 1, 1], ["FUSE-T3A15", 2, 1], ["BELT-SPA-1250", 2, 2],
    ["DRIER-083", 2, 1], ["SNS-NTC-10K", 2, 2], ["CLN-COIL-5L", 1, 1], ["TAPE-PVC", 4, 2], ["LAG-15MM", 4, 2], ["REF-R410A", 5, 3], ["REF-R32-9", 4, 3],
  ];
  for (const e of engineers) for (const [sku, q, m] of vanKit) setLevel(sku, VAN[e], q + (rand() < 0.04 ? -q + m - 1 : 1), m);
  setLevel("REF-R404A", VAN["dave.kershaw"], 4, 3);
  setLevel("REF-R448A", VAN["dave.kershaw"], 3, 2);
  setLevel("REF-R404A", VAN["nathan.holt"], 3, 2);
  setLevel("IGN-ELEC-SET", VAN["gareth.pike"], 1, 1);
  setLevel("THERM-DIG-7D", VAN["gareth.pike"], 1, 1);
  // Edge: a van record that has gone negative (fitted but never booked out) — needs reconciling.
  setLevel("CAP-35-5", VAN["kyle.brennan"], -1, 2);
  setLevel("BELT-SPA-1250", VAN["sam.oconnor"], 0, 2);

  // ---------------- customers, sites, contacts, equipment ----------------
  const C: Record<string, number> = {};
  const SITE: Record<string, number> = {};
  const EQ: Record<string, number[]> = {};
  const CT: Record<string, number> = {};
  const customer = (key: string, row: Record<string, unknown>) => (C[key] = ins("customers", { status: "active", account_hold: 0, created_at: `${addDays(T, -900)}T09:00`, ...row }));
  const site = (key: string, cust: string, name: string, address: string, postcode: string, region: string, access?: string) =>
    (SITE[key] = ins("sites", { customer_id: C[cust], name, address, postcode, region, access_notes: access ?? null, active: 1 }));
  const contact = (key: string, cust: string, name: string, role: string, phone: string, email: string, siteKey?: string, primary = false) =>
    (CT[key] = ins("contacts", { customer_id: C[cust], site_id: siteKey ? SITE[siteKey] : null, name, role, phone, email, is_primary: primary ? 1 : 0 }));
  let tagN = 100;
  const equip = (siteKey: string, category: string, manufacturer: string, model: string, location: string, extra: Record<string, unknown> = {}) => {
    const id = ins("equipment", {
      site_id: SITE[siteKey], category, manufacturer, model, location,
      asset_tag: `FL-${++tagN}`, serial_number: `${manufacturer.slice(0, 3).toUpperCase()}${Math.floor(rand() * 9e7 + 1e7)}`,
      status: "active", ...extra,
    });
    (EQ[siteKey] ??= []).push(id);
    return id;
  };

  customer("npm", { account_ref: "NORT001", name: "Northgate Property Management", sector: "Offices & commercial property", phone: "0161 555 0200", email: "facilities@northgate-pm.example", billing_address: "Accounts Payable, Northgate House, 14 King Street, Manchester M2 4LQ", notes: "Managing agent for several multi-tenanted office buildings. Wants a single point of contact and consistent reporting across the portfolio." });
  site("npm-house", "npm", "Northgate House", "14 King Street, Manchester", "M2 4LQ", "Greater Manchester", "Report to ground-floor reception; plant on roof via service lift (key from security). Tenant floors 3–5 require 24h notice.");
  site("npm-deansgate", "npm", "Deansgate Chambers", "220 Deansgate, Manchester", "M3 4BQ", "Greater Manchester", "Loading bay access from Bridge Street. Permit to work required for roof plant.");
  site("npm-quays", "npm", "Salford Quays Business Centre", "3 Merchants Quay, Salford", "M50 3XR", "Greater Manchester", "Visitor parking bays 1–4. Plant room B1.");
  contact("npm-fm", "npm", "Joanne Ashworth", "Facilities Manager", "0161 555 0201", "joanne.ashworth@northgate-pm.example", undefined, true);
  contact("npm-house-sec", "npm", "Carl Mitchell", "Building Manager, Northgate House", "0161 555 0209", "carl.mitchell@northgate-pm.example", "npm-house");
  contact("npm-quays-bm", "npm", "Hannah Doyle", "Centre Manager", "0161 555 0233", "hannah.doyle@northgate-pm.example", "npm-quays");
  equip("npm-house", "vrf", "Daikin", "VRV IV RXYQ16U", "Roof — plant deck", { refrigerant: "R410A", refrigerant_kg: 11.8, install_date: "2017-05-12" });
  equip("npm-house", "fcu", "Daikin", "FXZQ50A cassette", "3rd floor — meeting room 4", { refrigerant: "R410A", install_date: "2017-05-12" });
  equip("npm-house", "fcu", "Daikin", "FXZQ50A cassette", "4th floor — open plan east", { refrigerant: "R410A", install_date: "2017-05-12" });
  equip("npm-house", "ahu", "Swegon", "GOLD RX 25", "Roof — AHU-1", { install_date: "2015-09-01" });
  equip("npm-house", "boiler", "Hamworthy", "Wessex ModuMax 116", "Basement plant room", { install_date: "2014-11-20" });
  equip("npm-deansgate", "ahu", "Fläkt Woods", "eQ Prime 030", "Roof — AHU-2", { install_date: "2012-03-30", notes: "Supply fan bearings noisy at last service." });
  equip("npm-deansgate", "split_ac", "Mitsubishi Electric", "PKA-M60 / PUZ-ZM60", "Comms room 2F", { refrigerant: "R32", refrigerant_kg: 1.4, install_date: "2021-07-02", warranty_expiry: addDays(T, 120) });
  equip("npm-deansgate", "boiler", "Remeha", "Quinta Ace 160", "Basement boiler room", { install_date: "2016-10-10" });
  equip("npm-quays", "vrf", "Mitsubishi Electric", "City Multi PUHY-P250", "Roof", { refrigerant: "R410A", refrigerant_kg: 16.5, install_date: "2019-02-18" });
  equip("npm-quays", "mvhr", "Nuaire", "XBOXER XBC65", "Plant room B1", { install_date: "2019-02-18" });
  equip("npm-quays", "controls", "Trend", "IQ4 BMS outstation", "Plant room B1", { install_date: "2019-02-18" });

  customer("pch", { account_ref: "PENN001", name: "Pennine Care Homes Group", sector: "Healthcare & care", phone: "01706 555 0300", email: "estates@penninecare.example", billing_address: "Pennine Care Homes Group, Ashgrove Business Park, Rochdale OL16 1XX", notes: "Residential care — continuous occupation. Heating failures affecting residents are treated as high priority by the customer." });
  site("pch-rossendale", "pch", "Rossendale House", "Bacup Road, Rawtenstall, Rossendale", "BB4 7NW", "Lancashire", "Sign in at reception; engineers must wear ID badges. Avoid resident mealtimes (12:00–13:30) for noisy work.");
  site("pch-heywood", "pch", "Heywood Grange", "Manchester Road, Heywood", "OL10 2QA", "Greater Manchester", "Sign in at reception. Kitchen extract accessible from rear yard.");
  contact("pch-estates", "pch", "Graham Lord", "Estates Manager", "01706 555 0301", "graham.lord@penninecare.example", undefined, true);
  contact("pch-ross-mgr", "pch", "Denise Tattersall", "Home Manager, Rossendale House", "01706 555 0310", "denise.tattersall@penninecare.example", "pch-rossendale");
  contact("pch-hey-mgr", "pch", "Imran Siddiqui", "Home Manager, Heywood Grange", "01706 555 0320", "imran.siddiqui@penninecare.example", "pch-heywood");
  equip("pch-rossendale", "boiler", "Ideal", "Evomax 2 150", "Plant room — boiler 1", { install_date: "2018-08-15" });
  equip("pch-rossendale", "boiler", "Ideal", "Evomax 2 150", "Plant room — boiler 2", { install_date: "2018-08-15" });
  equip("pch-rossendale", "extract", "Vent-Axia", "Kitchen canopy extract", "Kitchen", { install_date: "2013-04-01" });
  equip("pch-rossendale", "split_ac", "Fujitsu", "ASYG12KMTB", "Medication room", { refrigerant: "R32", refrigerant_kg: 0.9, install_date: "2020-06-11" });
  equip("pch-heywood", "heat_pump", "Mitsubishi Electric", "Ecodan CAHV-R450", "Rear compound", { refrigerant: "R454C", refrigerant_kg: 7.5, install_date: "2023-10-01", warranty_expiry: addDays(T, 400) });
  equip("pch-heywood", "extract", "Nuaire", "Kitchen extract fan", "Kitchen", { install_date: "2015-01-01" });
  equip("pch-heywood", "mvhr", "Vent-Axia", "Sentinel Kinetic", "Loft plant space", { install_date: "2015-01-01" });

  customer("staidans", { account_ref: "STAI001", name: "St Aidan's Academy Trust", sector: "Education", phone: "01204 555 0400", email: "estates@staidans-trust.example", billing_address: "Trust Office, St Aidan's High School, Chorley New Road, Bolton BL1 5AB" });
  site("sa-high", "staidans", "St Aidan's High School", "Chorley New Road, Bolton", "BL1 5AB", "Greater Manchester", "DBS-checked engineers only. Report to site team office; lanyard required. Noisy/hot works outside lesson times where possible.");
  site("sa-holycross", "staidans", "Holy Cross Primary", "Wigan Lane, Wigan", "WN1 2RP", "Greater Manchester", "DBS-checked engineers only. Site caretaker: via main office. No vehicle movements 08:30–09:00 or 15:00–15:30.");
  contact("sa-estates", "staidans", "Paul Heaton", "Trust Estates Lead", "01204 555 0401", "p.heaton@staidans-trust.example", undefined, true);
  contact("sa-caretaker", "staidans", "Bernie Walsh", "Site Manager, St Aidan's High", "01204 555 0409", "b.walsh@staidans-trust.example", "sa-high");
  equip("sa-high", "ahu", "Systemair", "Topvex TR09", "Sports hall plant room", { install_date: "2011-08-01" });
  equip("sa-high", "ahu", "Systemair", "Topvex SR11", "Science block roof", { install_date: "2014-08-01" });
  equip("sa-high", "split_ac", "Toshiba", "RAV-GM801 cassette", "Server room", { refrigerant: "R32", refrigerant_kg: 1.8, install_date: "2022-08-10" });
  equip("sa-high", "boiler", "Hamworthy", "Purewell VariHeat", "Main boiler house", { install_date: "2010-09-01" });
  equip("sa-holycross", "boiler", "Potterton", "Sirius Two FS", "Boiler room", { install_date: "2012-07-20" });
  equip("sa-holycross", "extract", "Airflow", "Kitchen extract", "School kitchen", { install_date: "2012-07-20" });

  customer("mwh", { account_ref: "MERS001", name: "The Mersey Wharf Hotel", sector: "Hospitality & leisure", phone: "0151 555 0500", email: "operations@merseywharfhotel.example", billing_address: "The Mersey Wharf Hotel, Waterloo Road, Liverpool L3 7BE", notes: "Busy event kitchen; plant downtime during service is very costly for them." });
  site("mwh-hotel", "mwh", "The Mersey Wharf Hotel", "Waterloo Road, Liverpool", "L3 7BE", "Merseyside", "Use staff entrance on Bath Street. Kitchen works only 14:30–17:00 or after 22:00.");
  contact("mwh-ops", "mwh", "Sophie Carragher", "Operations Manager", "0151 555 0501", "sophie.carragher@merseywharfhotel.example", undefined, true);
  contact("mwh-chef", "mwh", "Luca Benedetti", "Executive Chef", "0151 555 0514", "luca.benedetti@merseywharfhotel.example", "mwh-hotel");
  equip("mwh-hotel", "vrf", "LG", "Multi V 5 ARUM200LTE5", "Roof", { refrigerant: "R410A", refrigerant_kg: 14.2, install_date: "2018-03-20" });
  equip("mwh-hotel", "extract", "Elta", "Kitchen extract fan EF-1", "Kitchen roof", { install_date: "2016-05-01" });
  equip("mwh-hotel", "extract", "Elta", "Kitchen supply fan SF-1", "Kitchen roof", { install_date: "2016-05-01" });
  equip("mwh-hotel", "cold_room", "Foster", "Cold room + condensing unit", "Kitchen basement", { refrigerant: "R404A", refrigerant_kg: 3.2, install_date: "2014-02-01" });
  equip("mwh-hotel", "split_ac", "Daikin", "FTXM35R", "Function suite bar", { refrigerant: "R32", refrigerant_kg: 1.1, install_date: "2021-04-01" });

  customer("brindle", { account_ref: "BRIN001", name: "Brindle & Co Retail", sector: "Retail", phone: "0161 555 0600", email: "stores@brindleandco.example", billing_address: "Brindle & Co, 5 Merseyway, Stockport SK1 1PB", notes: "No maintenance contract — ad hoc reactive work only." });
  site("br-stockport", "brindle", "Stockport store", "5 Merseyway, Stockport", "SK1 1PB", "Greater Manchester", "Trading hours 09:00–17:30. Service entrance at rear.");
  site("br-chester", "brindle", "Chester store", "42 Bridge Street Row, Chester", "CH1 1NN", "Cheshire", "Listed building — no fixings without permission.");
  contact("br-ops", "brindle", "Ellie Moran", "Head of Store Operations", "0161 555 0601", "ellie.moran@brindleandco.example", undefined, true);
  contact("br-stockport-mgr", "brindle", "Jason Kaur", "Store Manager, Stockport", "0161 555 0610", "stockport@brindleandco.example", "br-stockport");
  equip("br-stockport", "split_ac", "Mitsubishi Electric", "PLA-M100 cassette", "Shop floor front", { refrigerant: "R32", refrigerant_kg: 2.4, install_date: "2019-05-01" });
  equip("br-stockport", "split_ac", "Mitsubishi Electric", "PLA-M100 cassette", "Shop floor rear", { refrigerant: "R32", refrigerant_kg: 2.4, install_date: "2019-05-01" });
  equip("br-chester", "split_ac", "Fujitsu", "AUXG18KVLA cassette", "Ground floor", { refrigerant: "R410A", refrigerant_kg: 1.6, install_date: "2016-04-01" });

  customer("kestrel", { account_ref: "KEST001", name: "Kestrel Logistics Ltd", sector: "Light industrial & warehousing", phone: "01925 555 0700", email: "facilities@kestrel-logistics.example", billing_address: "Kestrel Logistics Ltd, Unit 7 Gemini Park, Warrington WA5 7XX", account_hold: 1, account_hold_note: "Two invoices over 90 days — accounts chasing (per finance, 3 weeks ago)" });
  site("kes-warrington", "kestrel", "Warrington distribution centre", "Unit 7 Gemini Park, Warrington", "WA5 7XX", "Cheshire", "Hi-vis and safety boots mandatory. Sign in at gatehouse; forklift traffic in yard.");
  contact("kes-fm", "kestrel", "Rob Pennington", "Site Facilities Manager", "01925 555 0701", "rob.pennington@kestrel-logistics.example", undefined, true);
  equip("kes-warrington", "cold_room", "Searle", "Cold store evaporators + Bitzer CU", "Chilled store (zone C)", { refrigerant: "R448A", refrigerant_kg: 18, install_date: "2016-09-01" });
  equip("kes-warrington", "heat_pump", "Daikin", "EWYT-B warehouse heating", "Warehouse roof", { refrigerant: "R32", refrigerant_kg: 9.5, install_date: "2022-01-15" });
  equip("kes-warrington", "split_ac", "Daikin", "FTXM50R", "Transport office", { refrigerant: "R32", refrigerant_kg: 1.2, install_date: "2020-03-01" });

  customer("calder", { account_ref: "CALD001", name: "Calder Valley Leisure Trust", sector: "Hospitality & leisure", phone: "01422 555 0800", email: "facilities@caldervalleyleisure.example", billing_address: "Calder Valley Leisure Trust, Skircoat Road, Halifax HX1 2NE", notes: "Customer contract acquired from Calder Cooling Services in 2021." });
  site("cal-halifax", "calder", "Halifax Pool & Fitness Centre", "Skircoat Road, Halifax", "HX1 2NE", "West Yorkshire", "Pool hall plant is humid — PPE and slip-resistant boots. Duty manager holds plant keys.");
  site("cal-brighouse", "calder", "Brighouse Sports Centre", "Mill Lane, Brighouse", "HD6 1PN", "West Yorkshire");
  contact("cal-fm", "calder", "Andrew Sutcliffe", "Facilities Manager", "01422 555 0801", "andrew.sutcliffe@caldervalleyleisure.example", undefined, true);
  equip("cal-halifax", "ahu", "Calorex", "Delta pool dehumidifier AHU", "Pool plant room", { refrigerant: "R407C", refrigerant_kg: 12, install_date: "2009-06-01", notes: "Ageing unit; R407C. Replacement discussed informally." });
  equip("cal-halifax", "split_ac", "Toshiba", "RAV-RM1101 cassette", "Gym", { refrigerant: "R32", refrigerant_kg: 2.1, install_date: "2020-01-10" });
  equip("cal-halifax", "boiler", "Viessmann", "Vitocrossal 200", "Boiler house", { install_date: "2015-06-01" });
  equip("cal-brighouse", "ahu", "Nuaire", "Sports hall AHU", "Roof", { install_date: "2013-02-01" });
  equip("cal-brighouse", "split_ac", "Fujitsu", "ARXG24KHTAP ducted", "Reception", { refrigerant: "R410A", refrigerant_kg: 2.3, install_date: "2017-02-01" });

  customer("oakfield", { account_ref: "OAKF001", name: "Oakfield Medical Practice", sector: "Healthcare & care", phone: "0161 555 0900", email: "practice.manager@oakfieldmedical.example", billing_address: "Oakfield Medical Practice, 22 Oakfield Road, Altrincham WA14 1LR", notes: "Small GP practice. No contract." });
  site("oak-altrincham", "oakfield", "Oakfield Medical Practice", "22 Oakfield Road, Altrincham", "WA14 1LR", "Greater Manchester", "Clinical areas — arrive via staff door; avoid patient waiting area with tools.");
  contact("oak-pm", "oakfield", "Dr Fiona Grant", "Practice Manager", "0161 555 0901", "fiona.grant@oakfieldmedical.example", undefined, true);
  equip("oak-altrincham", "split_ac", "LG", "S12ET wall unit", "Server / comms cupboard", { refrigerant: "R32", refrigerant_kg: 0.8, install_date: "2015-03-01", notes: "Undersized for current IT load?" });
  equip("oak-altrincham", "split_ac", "LG", "S18ET wall unit", "Treatment room 1", { refrigerant: "R32", refrigerant_kg: 1.0, install_date: "2019-05-01" });

  customer("greenacre", { account_ref: "GREE001", name: "Greenacre Foods Ltd", sector: "Light industrial & warehousing", phone: "0161 555 1000", email: "engineering@greenacrefoods.example", billing_address: "Greenacre Foods Ltd, Pilsworth Road, Bury BL9 8RS", notes: "Chilled food production — temperature excursions are business-critical." });
  site("gf-bury", "greenacre", "Pilsworth Road production site", "Pilsworth Road, Bury", "BL9 8RS", "Greater Manchester", "Food hygiene rules: whites, hairnets and boot wash on entry to production. Report to engineering office.");
  contact("gf-eng", "greenacre", "Stuart Ogden", "Engineering Manager", "0161 555 1001", "stuart.ogden@greenacrefoods.example", undefined, true);
  equip("gf-bury", "chiller", "Carrier", "30RBP 160 air-cooled chiller", "Yard compound", { refrigerant: "R410A", refrigerant_kg: 26, install_date: "2016-11-01" });
  equip("gf-bury", "cold_room", "Searle", "Dispatch chiller evaporators", "Dispatch chill", { refrigerant: "R448A", refrigerant_kg: 22, install_date: "2019-04-01" });
  equip("gf-bury", "cold_room", "Searle", "Blast chiller BC-2", "Production hall 2", { refrigerant: "R404A", refrigerant_kg: 6.5, install_date: "2012-09-01", notes: "R404A — service ban on virgin refrigerant top-ups for larger systems; plan replacement." });
  equip("gf-bury", "ahu", "Fläkt Woods", "Production hall AHU", "Mezzanine", { install_date: "2016-11-01" });

  customer("harbour", { account_ref: "HARB001", name: "Harbour Lane Studios", sector: "Offices & commercial property", status: "prospect", phone: "0161 555 1100", email: "hello@harbourlanestudios.example", billing_address: "Harbour Lane Studios, 8 Tariff Street, Manchester M1 2FF", notes: "New creative-office fit-out enquiry (via website form)." });
  site("hl-tariff", "harbour", "8 Tariff Street", "8 Tariff Street, Manchester", "M1 2FF", "Greater Manchester", "Under refurbishment — main contractor site rules apply.");
  contact("hl-dir", "harbour", "Megan Lloyd", "Operations Director", "0161 555 1101", "megan@harbourlanestudios.example", undefined, true);

  // ---------------- contracts ----------------
  const K: Record<string, number> = {};
  const contract = (key: string, row: Record<string, unknown>, sites: string[]) => {
    K[key] = ins("contracts", { status: "active", out_of_hours_cover: 0, labour_included: 0, parts_included: 0, ...row });
    for (const s of sites) ins("contract_sites", { contract_id: K[key], site_id: SITE[s] });
  };
  contract("npm", { customer_id: C.npm, reference: "CT-NPM-24", name: "Northgate portfolio maintenance", start_date: addDays(T, -250), end_date: addDays(T, 115), response_emergency_hours: 4, response_urgent_hours: 8, response_routine_hours: 48, out_of_hours_cover: 1, ppm_visits_per_year: 4, ppm_visit_hours: 4, labour_included: 1, annual_value: 18400, terms_notes: "Quarterly PPM across three sites. Reactive labour included in working hours; parts chargeable." }, ["npm-house", "npm-deansgate", "npm-quays"]);
  contract("pch", { customer_id: C.pch, reference: "CT-PCH-01", name: "Pennine Care — heating & ventilation", start_date: addDays(T, -500), end_date: addDays(T, 230), response_emergency_hours: 4, response_urgent_hours: 12, response_routine_hours: 72, out_of_hours_cover: 1, ppm_visits_per_year: 2, ppm_visit_hours: 5, annual_value: 7900 }, ["pch-rossendale", "pch-heywood"]);
  contract("sa", { customer_id: C.staidans, reference: "CT-SAT-02", name: "St Aidan's Trust annual servicing", start_date: addDays(T, -60), end_date: addDays(T, 305), response_emergency_hours: null, response_urgent_hours: 24, response_routine_hours: 72, ppm_visits_per_year: 1, ppm_visit_hours: 7, annual_value: 4200, terms_notes: "Annual service in the summer holidays; no out-of-hours cover." }, ["sa-high", "sa-holycross"]);
  contract("mwh", { customer_id: C.mwh, reference: "CT-MWH-03", name: "Mersey Wharf — HVAC & kitchen ventilation", start_date: addDays(T, -345), end_date: addDays(T, 20), response_emergency_hours: 4, response_urgent_hours: 8, response_routine_hours: 48, out_of_hours_cover: 1, ppm_visits_per_year: 4, ppm_visit_hours: 4, annual_value: 9600, terms_notes: "Renewal due — sales to discuss." }, ["mwh-hotel"]);
  contract("kestrel-old", { customer_id: C.kestrel, reference: "CT-KES-01", name: "Kestrel cold store maintenance (lapsed)", start_date: addDays(T, -800), end_date: addDays(T, -70), status: "ended", response_emergency_hours: 6, response_urgent_hours: 24, ppm_visits_per_year: 4, ppm_visit_hours: 3, annual_value: 5200 }, ["kes-warrington"]);
  contract("calder", { customer_id: C.calder, reference: "CT-CVL-21", name: "Calder Valley Leisure (ex-Calder Cooling)", start_date: addDays(T, -140), end_date: addDays(T, 225), response_emergency_hours: 6, response_urgent_hours: 24, response_routine_hours: 72, out_of_hours_cover: 0, ppm_visits_per_year: 2, ppm_visit_hours: 6, annual_value: 6800 }, ["cal-halifax", "cal-brighouse"]);
  contract("gf", { customer_id: C.greenacre, reference: "CT-GAF-05", name: "Greenacre refrigeration & chiller cover", start_date: addDays(T, -180), end_date: addDays(T, 185), response_emergency_hours: 4, response_urgent_hours: 8, response_routine_hours: 24, out_of_hours_cover: 1, ppm_visits_per_year: 12, ppm_visit_hours: 3, labour_included: 1, parts_included: 0, annual_value: 21600 }, ["gf-bury"]);

  // ---------------- jobs / visits helpers ----------------
  let jobN = 10000;
  const job = (row: {
    site: string; type: string; priority: string; status: string; title: string; description?: string; created: string; contract?: string | null;
    responseHours?: number | null; due?: string; hold?: string; next?: string; via?: string; reporter?: string; equipment?: number[]; completed?: string; closed?: string;
    estimated?: number; createdBy?: string; quote?: number; parent?: number; firstAttended?: string; ppmKey?: string; orderRef?: string;
  }) => {
    const siteRow = db.prepare("SELECT * FROM sites WHERE id = ?").get(SITE[row.site]) as any;
    const k = row.contract ? db.prepare("SELECT * FROM contracts WHERE id = ?").get(K[row.contract]) as any : null;
    const responseDue = row.responseHours != null ? addHours(row.created, row.responseHours) : null;
    const id = ins("jobs", {
      reference: `J-${++jobN}`, customer_id: siteRow.customer_id, site_id: siteRow.id, contract_id: k?.id ?? null, job_type: row.type, priority: row.priority,
      status: row.status, hold_reason: row.hold ?? null, next_action: row.next ?? null, title: row.title, description: row.description ?? null,
      reported_via: row.via ?? (row.type === "planned_maintenance" ? "planned" : "phone"), reported_by_contact_id: row.reporter ? CT[row.reporter] : null,
      customer_order_ref: row.orderRef ?? null, estimated_hours: row.estimated ?? null, due_date: row.due ?? null, response_due_at: responseDue,
      response_target_source: responseDue ? `Contract ${k.reference}: ${row.priority} response within ${row.responseHours}h (clock hours)` : !["reactive", "warranty"].includes(row.type) || row.priority === "planned" ? "Not applicable — planned/quoted work is scheduled against a due date" : k ? `Contract ${k.reference} has no ${row.priority} response target` : "No contract — no committed response time (none configured for non-contract work)",
      first_attended_at: row.firstAttended ?? null, quote_id: row.quote ?? null, parent_job_id: row.parent ?? null, ppm_key: row.ppmKey ?? null,
      completed_at: row.completed ?? null, closed_at: row.closed ?? null, created_by: U[row.createdBy ?? "priya.nair"], created_at: row.created, updated_at: row.completed ?? row.created,
    });
    for (const e of row.equipment ?? []) ins("job_equipment", { job_id: id, equipment_id: e });
    act(U[row.createdBy ?? "priya.nair"], "job.create", `Logged ${row.type.replace("_", " ")} job J-${jobN}: ${row.title}${k ? ` (contract ${k.reference})` : " (no contract)"}`, { customer_id: siteRow.customer_id, site_id: siteRow.id, job_id: id, contract_id: k?.id }, row.created);
    return id;
  };
  const jobRef = (id: number) => (db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as any);
  const visit = (jobId: number, engineer: string, start: string, hours: number, row: Record<string, unknown> = {}) => {
    const id = ins("visits", { job_id: jobId, engineer_id: U[engineer], scheduled_start: start, scheduled_end: addHours(start, hours), status: "scheduled", created_by: U["priya.nair"], created_at: addHours(start, -24), ...row });
    const j = jobRef(jobId);
    act(U["priya.nair"], "visit.schedule", `Booked ${db.prepare("SELECT name FROM users WHERE id = ?").pluck().get(U[engineer])} for ${start.replace("T", " ")}–${addHours(start, hours).slice(11)}`, { customer_id: j.customer_id, site_id: j.site_id, job_id: jobId, visit_id: id }, (row.created_at as string) ?? addHours(start, -24));
    return id;
  };
  const check = (visitId: number, equipmentId: number, condition: string, notes?: string, readings?: string) =>
    ins("visit_equipment", { visit_id: visitId, equipment_id: equipmentId, condition, notes: notes ?? null, readings: readings ?? null });
  const usePart = (visitId: number, engineer: string, sku: string, qty: number, when: string) => {
    const mv = ins("stock_movements", { part_id: P[sku], from_location_id: VAN[engineer], to_location_id: null, quantity: qty, reason: "used", visit_id: visitId, user_id: U[engineer], created_at: when });
    ins("visit_parts", { visit_id: visitId, part_id: P[sku], quantity: qty, location_id: VAN[engineer], movement_id: mv });
  };
  const complete = (jobId: number, visitId: number, engineer: string, start: string, hours: number, outcome: string, notes: string, outcomeNotes?: string) => {
    const end = addHours(start, hours);
    db.prepare("UPDATE visits SET status = ?, travel_started_at = ?, arrived_at = ?, departed_at = ?, work_notes = ?, outcome = ?, outcome_notes = ?, signoff_name = ? WHERE id = ?")
      .run(outcome === "no_access" ? "no_access" : "completed", addHours(start, -0.5), outcome === "no_access" ? null : start, end, notes, outcome, outcomeNotes ?? null, outcome === "no_access" ? null : pick(["Site manager", "Duty manager", "Reception", "Facilities"]), visitId);
    const j = jobRef(jobId);
    if (!j.first_attended_at && outcome !== "no_access") db.prepare("UPDATE jobs SET first_attended_at = ? WHERE id = ?").run(start, jobId);
    act(U[engineer], "visit.arrive", `Arrived on site`, { customer_id: j.customer_id, site_id: j.site_id, job_id: jobId, visit_id: visitId }, start);
    act(U[engineer], "visit.complete", `Visit completed — ${outcome.replace("_", " ")}${outcomeNotes ? `: ${outcomeNotes}` : ""}`, { customer_id: j.customer_id, site_id: j.site_id, job_id: jobId, visit_id: visitId }, end);
  };

  // ---------------- history: past 12 months ----------------
  const faults: [string, string, string[], string][] = [
    ["npm-house", "Meeting room cassette dripping water", ["PMP-COND-MINI"], "Condensate pump failed; replaced and tested. Drain line flushed."],
    ["npm-deansgate", "Comms room AC high temperature alarm", ["CAP-35-5"], "Outdoor fan capacitor failed. Replaced; unit cooling normally (supply 11°C)."],
    ["npm-quays", "4th floor too warm — VRF zone not cooling", ["SNS-NTC-10K"], "Faulty return air thermistor on FCU 4-3. Replaced; zone controlling."],
    ["pch-rossendale", "Boiler 2 locking out", ["IGN-ELEC-SET"], "Ignition electrodes worn. Replaced set, combustion checked and recorded."],
    ["pch-heywood", "Kitchen extract fan tripping", ["CON-2P-30A"], "Contactor contacts pitted. Replaced contactor; motor current within rating."],
    ["mwh-hotel", "Cold room running warm (+9°C)", ["DRIER-083", "REF-R404A"], "Blocked drier. Recovered charge, replaced drier, evacuated and recharged 3.2kg R404A. Leak test OK."],
    ["mwh-hotel", "Function suite AC not heating", [], "Unit in cooling mode lock via remote. Reset controller settings, demonstrated to staff."],
    ["br-stockport", "Shop floor cassette noisy", ["FLT-CAS-600"], "Filter collapsed into fan. Replaced filter, cleaned fan wheel."],
    ["kes-warrington", "Cold store alarm — evaporator iced", ["SOL-VALVE-3/8"], "Defrost solenoid sticking. Replaced; manual defrost carried out, temps recovered."],
    ["cal-halifax", "Pool hall humid — dehumidifier fault", ["BELT-SPA-1250"], "Fan belt snapped. Replaced belt and tensioned; unit restarted."],
    ["gf-bury", "Blast chiller BC-2 slow pull-down", ["TXV-R404A"], "TXV hunting. Replaced valve, superheat set to 6K. Monitor — ageing R404A system."],
    ["oak-altrincham", "Server cupboard AC tripping", ["CAP-45"], "Compressor run capacitor weak; replaced. Cupboard heat load is high for unit size."],
    ["sa-high", "Science block AHU not running", ["FUSE-T3A15"], "Control fuse blown on AHU panel. Replaced; traced to wet sensor cable, re-terminated."],
    ["npm-house", "Boiler lockout — no heating 2nd floor", [], "Low system pressure. Repressurised, checked expansion vessel. Recommend monitoring."],
  ];
  const histEngineers: Record<string, string> = {
    "npm-house": "lewis.tran", "npm-deansgate": "lewis.tran", "npm-quays": "kyle.brennan", "pch-rossendale": "gareth.pike", "pch-heywood": "sam.oconnor",
    "mwh-hotel": "aisha.rahman", "br-stockport": "lewis.tran", "kes-warrington": "dave.kershaw", "cal-halifax": "nathan.holt", "gf-bury": "dave.kershaw",
    "oak-altrincham": "aisha.rahman", "sa-high": "sam.oconnor", "br-chester": "gareth.pike", "sa-holycross": "sam.oconnor", "cal-brighouse": "nathan.holt", "pch-heywood-b": "gareth.pike",
  };
  const contractFor: Record<string, string | null> = { "npm-house": "npm", "npm-deansgate": "npm", "npm-quays": "npm", "pch-rossendale": "pch", "pch-heywood": "pch", "mwh-hotel": "mwh", "br-stockport": null, "kes-warrington": "kestrel-old", "cal-halifax": "calder", "gf-bury": "gf", "oak-altrincham": null, "sa-high": null, "sa-holycross": null };
  faults.forEach(([s, title, parts, notes], i) => {
    const d = -(20 + i * 23);
    const created = at(d, `0${8 + (i % 2)}:${i % 2 ? "15" : "40"}`);
    const k = contractFor[s];
    const kRow = k ? (db.prepare("SELECT * FROM contracts WHERE id = ?").get(K[k]) as any) : null;
    const activeThen = kRow && kRow.start_date <= created.slice(0, 10) && kRow.end_date >= created.slice(0, 10);
    const pr = i % 3 === 0 ? "urgent" : "routine";
    const hrs = activeThen ? kRow[`response_${pr}_hours`] : null;
    const e = histEngineers[s];
    const start = addHours(created, pr === "urgent" ? 3 : 26);
    const eqs = EQ[s].slice(0, 1 + (i % 2));
    const jid = job({ site: s, type: "reactive", priority: pr, status: "closed", title, created, contract: activeThen ? k : null, responseHours: hrs, equipment: eqs, completed: addHours(start, 2), closed: addHours(start, 50) });
    const vid = visit(jid, e, start, 2);
    complete(jid, vid, e, start, 2, "resolved", notes);
    for (const eq of eqs) check(vid, eq, i % 4 === 0 ? "attention" : "good", i % 4 === 0 ? "Monitor at next service" : undefined);
    for (const sku of parts) usePart(vid, e, sku, sku.startsWith("REF") ? 3.2 : 1, addHours(start, 1));
    act(U["tom.whitaker"], "job.close", "Closed", { customer_id: jobRef(jid).customer_id, site_id: SITE[s], job_id: jid }, addHours(start, 50));
  });

  // Past planned maintenance (gives equipment a service history).
  const ppmHistory: [string, string, string, number][] = [
    ["npm-house", "npm", "lewis.tran", -85], ["npm-deansgate", "npm", "lewis.tran", -84], ["npm-quays", "npm", "kyle.brennan", -83],
    ["pch-rossendale", "pch", "gareth.pike", -150], ["pch-heywood", "pch", "gareth.pike", -149],
    ["mwh-hotel", "mwh", "aisha.rahman", -75], ["cal-halifax", "calder", "nathan.holt", -110], ["cal-brighouse", "calder", "nathan.holt", -109],
    ["gf-bury", "gf", "dave.kershaw", -58], ["gf-bury", "gf", "dave.kershaw", -28], ["sa-high", "sa", "sam.oconnor", -45], ["sa-holycross", "sa", "sam.oconnor", -44],
  ];
  const ppmNotes = [
    "Full service: filters changed, coils cleaned, drains cleared, electrical checks, refrigerant leak check (no leaks found), operating pressures and temperatures recorded.",
    "Service completed to schedule. All units operating within parameters. Filters replaced. Belts inspected.",
  ];
  ppmHistory.forEach(([s, k, e, d], i) => {
    const kr = db.prepare("SELECT * FROM contracts WHERE id = ?").get(K[k]) as any;
    const start = at(d, "08:30");
    const jid = job({ site: s, type: "planned_maintenance", priority: "planned", status: "closed", title: `Planned maintenance — ${(db.prepare("SELECT name FROM sites WHERE id = ?").get(SITE[s]) as any).name}`, description: `Scheduled service under contract ${kr.reference}.`, created: at(d - 20, "10:00"), contract: k, due: addDays(T, d), equipment: EQ[s], completed: addHours(start, kr.ppm_visit_hours ?? 4), closed: addHours(start, 30), ppmKey: `${kr.id}:${SITE[s]}:${addDays(T, d)}`, createdBy: "tom.whitaker", estimated: kr.ppm_visit_hours });
    const vid = visit(jid, e, start, kr.ppm_visit_hours ?? 4);
    complete(jid, vid, e, start, kr.ppm_visit_hours ?? 4, "resolved", ppmNotes[i % 2]);
    EQ[s].forEach((eq, n) => check(vid, eq, n === 0 && i % 3 === 0 ? "attention" : "good", n === 0 && i % 3 === 0 ? "Wear noted — see recommendation" : undefined, "Suction 8.2 bar / discharge 24.5 bar, supply air 12°C"));
    usePart(vid, e, "FLT-G4-592", 2, addHours(start, 1));
  });

  // Recommendations raised on past PPM visits (open → for the office to quote)
  const rec = (s: string, eqIdx: number | null, description: string, urgency: string, e: string, d: number, status = "open", quoteId: number | null = null) =>
    ins("recommendations", { site_id: SITE[s], equipment_id: eqIdx == null ? null : EQ[s][eqIdx], description, urgency, status, quote_id: quoteId, raised_by: U[e], created_at: at(d, "15:10"), job_id: (db.prepare("SELECT j.id FROM jobs j WHERE j.site_id = ? AND j.job_type = 'planned_maintenance' ORDER BY j.created_at DESC LIMIT 1").get(SITE[s]) as any)?.id ?? null });
  rec("npm-deansgate", 0, "AHU-2 supply fan bearings noisy and running hot — recommend replacing fan bearings and belts before failure.", "high", "lewis.tran", -84);
  rec("cal-halifax", 0, "Pool dehumidifier is 17 years old on R407C with corrosion on the coil. Recommend budgeting for replacement within 12 months.", "normal", "nathan.holt", -110);
  rec("gf-bury", 2, "Blast chiller BC-2 on R404A (6.5kg). Recommend replacement/retrofit to lower-GWP refrigerant; spares becoming expensive.", "normal", "dave.kershaw", -28);
  rec("sa-holycross", 1, "Kitchen extract fan guard missing on roof — safety risk. Replace guard.", "safety", "sam.oconnor", -44);

  // ---------------- current operational picture ----------------
  const nowT = N;

  // 1) Emergency: care home heating failure logged 3h10m ago, not yet scheduled → response at risk (4h target)
  job({ site: "pch-rossendale", type: "reactive", priority: "emergency", status: "to_schedule", title: "No heating in east wing — residents cold", description: "Home manager reports radiators cold in east wing since early morning. Boiler 1 showing fault light. Portable heaters in use. Residents are elderly/vulnerable.", created: minutesAgo(190), contract: "pch", responseHours: 4, equipment: [EQ["pch-rossendale"][0]], reporter: "pch-ross-mgr" });

  // 2) Urgent reactive scheduled today with Lewis
  const j2 = job({ site: "npm-house", type: "reactive", priority: "urgent", status: "scheduled", title: "Meeting room 4 AC not cooling", description: "Tenant reports cassette in meeting room 4 blowing warm air. Board meeting there this afternoon.", created: at(0, "08:10"), contract: "npm", responseHours: 8, equipment: [EQ["npm-house"][1]], reporter: "npm-house-sec" });
  visit(j2, "lewis.tran", at(0, "13:00"), 2, { instructions: "Tenant floor 3 — sign in with Carl at reception.", created_at: at(0, "08:25") });

  // 3) Overdue routine reactive at hotel (48h target, logged 3 days ago, not attended)
  job({ site: "mwh-hotel", type: "reactive", priority: "routine", status: "to_schedule", title: "Kitchen extract fan EF-1 noisy / vibrating", description: "Chef reports loud rumble from extract fan during service. Still running.", created: at(-3, "15:20"), contract: "mwh", responseHours: 48, equipment: [EQ["mwh-hotel"][1]], reporter: "mwh-chef", via: "email" });

  // 4) Kestrel: account hold + awaiting parts with PO part-received
  const j4 = job({ site: "kes-warrington", type: "reactive", priority: "emergency", status: "on_hold", hold: "awaiting_parts", next: "Order parts: 1 × Condenser fan motor, 1 × Contactor — then book return visit", title: "Chilled store zone C high temperature alarm", description: "Store at +8°C (setpoint +3°C). Stock being moved to trailers.", created: at(-1, "07:05"), contract: null, responseHours: null, equipment: [EQ["kes-warrington"][0]], reporter: "kes-fm", firstAttended: at(-1, "09:10") });
  const v4 = visit(j4, "dave.kershaw", at(-1, "09:10"), 3, { created_at: at(-1, "07:20") });
  complete(j4, v4, "dave.kershaw", at(-1, "09:10"), 3, "parts_required", "Condenser fan 2 motor seized; contactor for fan bank burnt. Temporary: fan 1 running, store holding +5°C with door discipline. Customer informed.", "Need replacement condenser fan motor and contactor. Temporary repair in place.");
  check(v4, EQ["kes-warrington"][0], "failed", "Condenser fan 2 seized; store running warm", "Suction 2.9 bar / discharge 21 bar");
  ins("recommendations", { job_id: j4, visit_id: v4, site_id: SITE["kes-warrington"], equipment_id: EQ["kes-warrington"][0], description: "Remaining condenser fan motors are original (2016) — recommend replacing all three at next visit to prevent repeat failure.", urgency: "normal", status: "open", raised_by: U["dave.kershaw"], created_at: at(-1, "12:05") });
  const po1 = ins("purchase_orders", { reference: "PO-5001", supplier_id: S1, status: "part_received", deliver_to_location_id: STORE, job_id: j4, supplier_ref: "NRS-88213", expected_date: addDays(T, 1), created_by: U["priya.nair"], created_at: at(-1, "13:00"), ordered_at: at(-1, "13:10") });
  const pl1 = ins("po_lines", { po_id: po1, part_id: P["FAN-MTR-CDU"], description: "Condenser fan motor 1/4HP 230V", quantity: 1, received_quantity: 0, unit_cost: 96 });
  const pl2 = ins("po_lines", { po_id: po1, part_id: P["CON-2P-30A"], description: "Contactor 2-pole 30A 230V coil", quantity: 1, received_quantity: 1, unit_cost: 14.2 });
  ins("job_parts", { job_id: j4, part_id: P["FAN-MTR-CDU"], description: "Condenser fan motor 1/4HP 230V", quantity: 1, status: "ordered", po_line_id: pl1, created_at: at(-1, "12:10") });
  ins("job_parts", { job_id: j4, part_id: P["CON-2P-30A"], description: "Contactor 2-pole 30A 230V coil", quantity: 1, status: "available", po_line_id: pl2, created_at: at(-1, "12:10") });
  db.prepare("UPDATE stock_levels SET quantity = quantity + 1 WHERE part_id = ? AND location_id = ?").run(P["CON-2P-30A"], STORE);
  ins("stock_movements", { part_id: P["CON-2P-30A"], to_location_id: STORE, quantity: 1, reason: "receipt", po_id: po1, user_id: U["tom.whitaker"], created_at: at(0, "08:05") });
  act(U["priya.nair"], "po.create", "Raised purchase order PO-5001 for job " + jobRef(j4).reference, { po_id: po1, job_id: j4, customer_id: C.kestrel }, at(-1, "13:00"));
  act(U["tom.whitaker"], "po.receive", "Received 1 × Contactor 2-pole 30A 230V coil into Depot stores (part delivery)", { po_id: po1, job_id: j4 }, at(0, "08:05"));
  act(U["dave.kershaw"], "job.hold", "Put on hold (awaiting parts)", { job_id: j4, customer_id: C.kestrel, site_id: SITE["kes-warrington"] }, at(-1, "12:10"));

  // 5) Non-contract reactive to schedule (Brindle)
  job({ site: "br-stockport", type: "reactive", priority: "routine", status: "to_schedule", title: "Shop floor rear cassette leaking onto display", description: "Water dripping from rear cassette onto clothing display. Store has moved stock; bucket in place.", created: at(-1, "11:30"), equipment: [EQ["br-stockport"][1]], reporter: "br-stockport-mgr", via: "email" });

  // 6) Oakfield: visit found undersized unit → quote required → job on hold awaiting quote; quote sent
  const j6 = job({ site: "oak-altrincham", type: "reactive", priority: "urgent", status: "on_hold", hold: "awaiting_quote", next: "Quote sent — awaiting practice decision", title: "Server cupboard AC tripping again", description: "Second trip in a month; IT supplier worried about server temperatures.", created: at(-9, "09:00"), equipment: [EQ["oak-altrincham"][0]], reporter: "oak-pm", firstAttended: at(-8, "10:00") });
  const v6 = visit(j6, "aisha.rahman", at(-8, "10:00"), 2, { created_at: at(-9, "09:30") });
  complete(j6, v6, "aisha.rahman", at(-8, "10:00"), 2, "quote_required", "Unit tripping on high pressure: cupboard ambient 31°C with IT load ~3kW; 3.5kW unit running flat out. Cleaned coils, reset. Temporary portable unit advised.", "Replace with correctly sized unit (min 5kW) — quote needed.");
  check(v6, EQ["oak-altrincham"][0], "attention", "Undersized for current IT load; running continuously");
  const rec6 = ins("recommendations", { job_id: j6, visit_id: v6, site_id: SITE["oak-altrincham"], equipment_id: EQ["oak-altrincham"][0], description: "Replace server cupboard unit with a correctly sized (≥5kW) inverter unit with low-ambient kit.", urgency: "high", status: "quoted", raised_by: U["aisha.rahman"], created_at: at(-8, "12:00") });

  // 7) In progress now: Sam at St Aidan's
  const j7 = job({ site: "sa-high", type: "reactive", priority: "urgent", status: "in_progress", title: "Sports hall AHU tripping on overload", description: "Sports hall getting stuffy; AHU trips after ~20 mins.", created: at(-1, "14:00"), contract: "sa", responseHours: 24, equipment: [EQ["sa-high"][0]], reporter: "sa-caretaker", firstAttended: minutesAgo(70) });
  const v7 = visit(j7, "sam.oconnor", minutesAgo(80), 3, { created_at: at(-1, "14:30") });
  db.prepare("UPDATE visits SET status = 'on_site', travel_started_at = ?, arrived_at = ?, work_notes = ? WHERE id = ?").run(minutesAgo(110), minutesAgo(70), "Motor drawing 9.8A vs 7.6A FLC. Belts glazed and over-tensioned; bearing noise on fan shaft.", v7);
  act(U["sam.oconnor"], "visit.arrive", "Sam O'Connor arrived on site", { job_id: j7, visit_id: v7, customer_id: C.staidans, site_id: SITE["sa-high"] }, minutesAgo(70));

  // 8) Urgent tomorrow with Nathan (West Yorkshire)
  const j8 = job({ site: "cal-halifax", type: "reactive", priority: "urgent", status: "scheduled", title: "Pool hall condensation — dehumidifier alarm", description: "Duty manager reports condensation on pool hall windows and 'HP fault' on dehumidifier panel.", created: at(-0, "07:45"), contract: "calder", responseHours: 24, equipment: [EQ["cal-halifax"][0]], reporter: "cal-fm" });
  visit(j8, "nathan.holt", atWd(1, "08:00"), 4, { created_at: at(0, "08:00") });

  // 9) Greenacre monthly PPM: this morning's visit completed by Dave; job awaiting office close
  const gfk = db.prepare("SELECT * FROM contracts WHERE id = ?").get(K.gf) as any;
  const j9 = job({ site: "gf-bury", type: "planned_maintenance", priority: "planned", status: "completed", title: "Planned maintenance — Pilsworth Road production site", description: `Scheduled service under contract ${gfk.reference}.`, created: at(-20, "10:00"), contract: "gf", due: T, equipment: EQ["gf-bury"], ppmKey: `${gfk.id}:${SITE["gf-bury"]}:${T}`, estimated: 3, completed: at(0, "10:40"), createdBy: "tom.whitaker" });
  const v9 = visit(j9, "dave.kershaw", at(0, "07:30"), 3);
  complete(j9, v9, "dave.kershaw", at(0, "07:30"), 3, "resolved", "Monthly refrigeration checks complete. Chiller operating normally. Dispatch evaporators defrosting correctly. BC-2 pull-down time 105 min (was 95).");
  EQ["gf-bury"].forEach((eq, n) => check(v9, eq, n === 2 ? "attention" : "good", n === 2 ? "Pull-down slower than last month" : undefined));
  usePart(v9, "dave.kershaw", "FLT-G4-592", 2, at(0, "09:00"));
  db.prepare("UPDATE jobs SET status='completed' WHERE id = ?").run(j9);

  // 10) Upcoming PPM to schedule (due within 2 weeks) + one booked with Gareth clashing with his training
  const npmk = db.prepare("SELECT * FROM contracts WHERE id = ?").get(K.npm) as any;
  for (const [s, d] of [["npm-house", 5], ["npm-deansgate", 6], ["npm-quays", 7]] as [string, number][]) {
    job({ site: s, type: "planned_maintenance", priority: "planned", status: "to_schedule", title: `Planned maintenance — ${(db.prepare("SELECT name FROM sites WHERE id = ?").get(SITE[s]) as any).name}`, description: `Scheduled service under contract ${npmk.reference}.`, created: at(-10, "10:00"), contract: "npm", due: addDays(T, d), equipment: EQ[s], ppmKey: `${npmk.id}:${SITE[s]}:${addDays(T, d)}`, estimated: 4, createdBy: "tom.whitaker" });
  }
  const pchk = db.prepare("SELECT * FROM contracts WHERE id = ?").get(K.pch) as any;
  const j10 = job({ site: "pch-heywood", type: "planned_maintenance", priority: "planned", status: "scheduled", title: "Planned maintenance — Heywood Grange", description: `Scheduled service under contract ${pchk.reference}.`, created: at(-14, "10:00"), contract: "pch", due: wd(3), equipment: EQ["pch-heywood"], ppmKey: `${pchk.id}:${SITE["pch-heywood"]}:${wd(3)}`, estimated: 5, createdBy: "tom.whitaker" });
  visit(j10, "gareth.pike", atWd(2, "08:30"), 5, { created_at: at(-12, "09:00") });
  ins("engineer_absences", { user_id: U["gareth.pike"], start_at: atWd(2, "08:00"), end_at: atWd(2, "17:00"), kind: "training", note: "Heat pump manufacturer course (booked after PPM visit)" });
  ins("engineer_absences", { user_id: U["kyle.brennan"], start_at: at(0, "00:00"), end_at: atWd(2, "23:59"), kind: "holiday", note: "Annual leave" });

  // 11) Other booked work this week for a realistic board
  const j11 = job({ site: "npm-quays", type: "reactive", priority: "routine", status: "scheduled", title: "BMS showing MVHR filter alarm", description: "Centre manager reports filter alarm on BMS front end.", created: at(-1, "16:00"), contract: "npm", responseHours: 48, equipment: [EQ["npm-quays"][1]], reporter: "npm-quays-bm", via: "email" });
  visit(j11, "lewis.tran", at(0, "09:00"), 2.5);
  const j12 = job({ site: "br-chester", type: "reactive", priority: "routine", status: "scheduled", title: "Ground floor cassette not heating", description: "Store cold in mornings; unit shows timer light flashing.", created: at(-2, "10:30"), equipment: [EQ["br-chester"][0]], reporter: "br-ops" });
  visit(j12, "gareth.pike", at(0, "10:00"), 2);
  const j13 = job({ site: "mwh-hotel", type: "reactive", priority: "urgent", status: "scheduled", title: "Function suite bar AC leaking", description: "Water running down wall below indoor unit.", created: at(0, "09:15"), contract: "mwh", responseHours: 8, equipment: [EQ["mwh-hotel"][4]], reporter: "mwh-ops" });
  visit(j13, "aisha.rahman", at(0, "14:00"), 2);
  visit(j11, "lewis.tran", atWd(1, "09:00"), 1, { instructions: "Return with filters if needed" });
  db.prepare("UPDATE visits SET status = 'cancelled', cancelled_reason = 'Duplicate booking' WHERE job_id = ? AND scheduled_start = ?").run(j11, atWd(1, "09:00"));
  const j14 = job({ site: "sa-holycross", type: "quoted_works", priority: "routine", status: "to_schedule", title: "Replace missing extract fan guard (safety)", description: "Approved as remedial safety item under trust instruction.", created: at(-6, "11:00"), contract: "sa", equipment: [EQ["sa-holycross"][1]], orderRef: "SAT-PO-4471" });
  void j14;

  // 12) Completed yesterday awaiting office review/close
  const j15 = job({ site: "npm-deansgate", type: "reactive", priority: "routine", status: "completed", title: "Boiler room — pump noisy", description: "Building manager reports loud noise from heating pump.", created: at(-4, "10:00"), contract: "npm", responseHours: 48, equipment: [EQ["npm-deansgate"][2]], completed: at(-1, "15:30") });
  const v15 = visit(j15, "gareth.pike", at(-1, "13:00"), 2.5);
  complete(j15, v15, "gareth.pike", at(-1, "13:00"), 2.5, "resolved", "Air in system causing pump cavitation noise. Vented system and topped up pressure to 1.5 bar. Pump running quietly.");
  check(v15, EQ["npm-deansgate"][2], "good");

  // ---------------- quotes ----------------
  let qN = 20000;
  const quote = (row: Record<string, any>, lines: [string, string, number, number, string?][]) => {
    const { _eq, ...cols } = row;
    const id = ins("quotes", { reference: `Q-${++qN}`, revision: 1, vat_rate: 0.2, prepared_by: U["rachel.dunn"], updated_at: row.created_at, ...cols });
    lines.forEach(([type, desc, qty, price, sku], i) => ins("quote_lines", { quote_id: id, sort: i, line_type: type, description: desc, quantity: qty, unit_price: price, part_id: sku ? P[sku] : null, equipment_id: _eq ?? null }));
    return id;
  };
  const qOak = quote({ customer_id: C.oakfield, site_id: SITE["oak-altrincham"], contact_id: CT["oak-pm"], origin_job_id: j6, quote_type: "replacement", title: "Replace server cupboard air conditioning unit", scope: "Remove existing 3.5kW wall unit and install 5kW inverter wall unit with low-ambient kit, new condensate pump, reuse pipe route where possible. Recover and dispose of refrigerant. Commission and hand over.", status: "sent", valid_until: addDays(T, 23), sent_at: at(-7, "16:00"), created_at: at(-7, "11:00") }, [
    ["material", "5.0kW inverter wall-mounted split (R32) with low-ambient kit", 1, 1480],
    ["part", "Mini condensate pump 230V", 1, 112, "PMP-COND-MINI"],
    ["labour", "Installation — 2 engineers", 12, 65],
    ["other", "Refrigerant recovery & WEEE disposal of old unit", 1, 95],
  ]);
  db.prepare("UPDATE recommendations SET quote_id = ? WHERE id = ?").run(qOak, rec6);
  db.prepare("UPDATE jobs SET next_action = ? WHERE id = ?").run(`Quote Q-${qN} sent — awaiting practice decision`, j6);
  act(U["rachel.dunn"], "quote.send", `Issued Q-${qN} rev 1 to customer`, { quote_id: qOak, customer_id: C.oakfield, job_id: j6 }, at(-7, "16:00"));

  const qHarbour = quote({ customer_id: C.harbour, site_id: SITE["hl-tariff"], contact_id: CT["hl-dir"], quote_type: "installation", title: "VRF heating & cooling — 2nd floor studio fit-out", scope: "Design coordination, supply and install of heat-recovery VRF (1 outdoor, 9 ceiling cassettes), controls, commissioning and handover documentation.", status: "sent", valid_until: addDays(T, -6), sent_at: at(-36, "12:00"), created_at: at(-38, "10:00") }, [
    ["material", "Heat-recovery VRF outdoor unit 28kW", 1, 9850],
    ["material", "4-way ceiling cassettes 3.6kW", 9, 845],
    ["material", "Branch selectors, pipework, insulation & condensate", 1, 3120],
    ["material", "Central controller + 9 wired remotes", 1, 1460],
    ["labour", "Installation labour", 160, 65],
    ["labour", "Commissioning & handover", 14, 65],
    ["subcontract", "Electrical supplies & isolators (subcontract)", 1, 2350],
  ]);
  act(U["rachel.dunn"], "quote.send", `Issued Q-${qN} rev 1 to customer`, { quote_id: qHarbour, customer_id: C.harbour }, at(-36, "12:00"));

  const qNpm = quote({ customer_id: C.npm, site_id: SITE["npm-deansgate"], contact_id: CT["npm-fm"], quote_type: "repair", title: "AHU-2 supply fan bearing & belt replacement", scope: "Isolate AHU-2, replace supply fan bearings and belts, align pulleys, test run and record currents. Out-of-hours to avoid tenant disruption.", status: "accepted", valid_until: addDays(T, 14), sent_at: at(-12, "10:00"), decided_at: at(-2, "11:20"), decision_by_name: "Joanne Ashworth", customer_po: "NPM-77341", created_at: at(-14, "15:00"), _eq: EQ["npm-deansgate"][0] }, [
    ["material", "Fan bearings (pair) & housings", 1, 285],
    ["part", "V-belt SPA 1250", 3, 16, "BELT-SPA-1250"],
    ["labour", "Engineer time (Saturday)", 6, 85],
    ["other", "Access equipment", 1, 60],
  ]);
  db.prepare("UPDATE recommendations SET status = 'quoted', quote_id = ? WHERE site_id = ? AND equipment_id = ?").run(qNpm, SITE["npm-deansgate"], EQ["npm-deansgate"][0]);
  act(U["rachel.dunn"], "quote.accept", `Customer accepted Q-${qN} rev 1 (Joanne Ashworth, PO NPM-77341)`, { quote_id: qNpm, customer_id: C.npm }, at(-2, "11:20"));

  const qBrindle = quote({ customer_id: C.brindle, site_id: SITE["br-chester"], contact_id: CT["br-ops"], quote_type: "replacement", title: "Replace Chester store cassette (R410A)", scope: "Replace ageing cassette with new R32 unit.", status: "rejected", valid_until: addDays(T, 5), sent_at: at(-25, "09:00"), decided_at: at(-10, "14:00"), decision_by_name: "Ellie Moran", rejection_reason: "Budget not available this financial year — repair only for now", created_at: at(-26, "09:00") }, [
    ["material", "7.1kW R32 cassette system", 1, 2250],
    ["labour", "Installation", 10, 65],
  ]);
  void qBrindle;

  const qMwh = quote({ customer_id: C.mwh, site_id: SITE["mwh-hotel"], contact_id: CT["mwh-ops"], quote_type: "replacement", title: "Kitchen supply & extract fan replacement (EC)", scope: "Replace EF-1 and SF-1 with EC fans and speed controller. Works 22:00–06:00 over two nights.", status: "accepted", valid_until: addDays(T, 10), sent_at: at(-20, "10:00"), decided_at: at(-9, "10:00"), decision_by_name: "Sophie Carragher", customer_po: "MWH-2291", created_at: at(-21, "10:00") }, [
    ["part", "EC fan motor 250mm", 2, 320, "FAN-MTR-EC250"],
    ["material", "EC speed controller & wiring", 1, 410],
    ["labour", "Night works — 2 engineers × 2 nights", 32, 85],
  ]);
  const jMwh = job({ site: "mwh-hotel", type: "installation", priority: "routine", status: "on_hold", hold: "awaiting_parts", next: "EC fan motors on order (PO-5002)", title: "Kitchen supply & extract fan replacement (EC)", description: `From accepted quote Q-${qN} rev 1.`, created: at(-9, "10:30"), contract: "mwh", equipment: [EQ["mwh-hotel"][1], EQ["mwh-hotel"][2]], quote: qMwh, estimated: 32, orderRef: "MWH-2291" });
  db.prepare("UPDATE quotes SET converted_job_id = ? WHERE id = ?").run(jMwh, qMwh);
  const po2 = ins("purchase_orders", { reference: "PO-5002", supplier_id: S1, status: "ordered", deliver_to_location_id: STORE, job_id: jMwh, supplier_ref: "NRS-88190", expected_date: addDays(T, 3), created_by: U["tom.whitaker"], created_at: at(-8, "09:00"), ordered_at: at(-8, "09:30") });
  const pl3 = ins("po_lines", { po_id: po2, part_id: P["FAN-MTR-EC250"], description: "EC fan motor 250mm", quantity: 2, received_quantity: 0, unit_cost: 178 });
  ins("job_parts", { job_id: jMwh, part_id: P["FAN-MTR-EC250"], description: "EC fan motor 250mm", quantity: 2, status: "ordered", po_line_id: pl3, created_at: at(-9, "10:30") });
  ins("job_parts", { job_id: jMwh, part_id: null, description: "EC speed controller & wiring", quantity: 1, status: "needed", created_at: at(-9, "10:30") });
  act(U["tom.whitaker"], "po.create", "Raised purchase order PO-5002 for job " + jobRef(jMwh).reference, { po_id: po2, job_id: jMwh }, at(-8, "09:00"));

  quote({ customer_id: C.pch, site_id: SITE["pch-rossendale"], contact_id: CT["pch-estates"], quote_type: "repair", title: "Kitchen extract — replace worn fan belts and clean ductwork access", scope: "Draft — scope to be confirmed with estates.", status: "draft", valid_until: addDays(T, 30), created_at: at(-1, "16:00") }, [
    ["part", "V-belt SPZ 1000", 2, 13, "BELT-SPZ-1000"],
    ["labour", "Engineer time", 3, 65],
  ]);

  // Low-stock purchase order in draft for the store
  const po3 = ins("purchase_orders", { reference: "PO-5003", supplier_id: S2, status: "draft", deliver_to_location_id: STORE, job_id: null, created_by: U["priya.nair"], created_at: at(0, "08:30"), notes: "Weekly replenishment" });
  ins("po_lines", { po_id: po3, part_id: P["BELT-SPZ-1000"], description: "V-belt SPZ 1000", quantity: 10, unit_cost: 5.9 });
  ins("po_lines", { po_id: po3, part_id: P["FLT-CAS-600"], description: "Cassette return filter 600×600", quantity: 20, unit_cost: 9.1 });

  // Settings: record explicitly that labour rate is a demo value (defaults cover the rest)
  void nowT;
  return { users: Object.keys(U).length, customers: Object.keys(C).length, jobs: jobN - 10000, quotes: qN - 20000 };
}
