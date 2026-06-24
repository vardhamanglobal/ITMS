import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  auth, googleProvider,
  signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail,
  signOut, onAuthStateChanged,
} from "./firebase.js";
const IMGBB_KEY = (window.CORPDESK_CONFIG && window.CORPDESK_CONFIG.IMGBB_KEY) || "";

/* ── CURRENCY HELPERS ── */
const CURRENCY_SYMBOLS = { INR:"₹", USD:"$", AED:"د.إ" };
const ALL_CURRENCIES = ["INR","USD","AED"];

// Approximate exchange rates (base: INR). Update as needed.
const EXCHANGE_RATES = {
  INR: { INR:1,       USD:0.012,  AED:0.044 },
  USD: { INR:83.5,    USD:1,      AED:3.67  },
  AED: { INR:22.73,   USD:0.272,  AED:1     },
};

const convertAmt = (amount, fromCur, toCur) => {
  if(fromCur===toCur) return parseFloat(amount)||0;
  const rate = (EXCHANGE_RATES[fromCur]||{})[toCur] || 1;
  return (parseFloat(amount)||0) * rate;
};

const fmtAmt = (amount, currency) => {
  const sym = CURRENCY_SYMBOLS[currency] || (currency + " ");
  const v = parseFloat(amount) || 0;
  const r = Number.isInteger(v) ? v : parseFloat(v.toFixed(2));
  return sym + r.toLocaleString(undefined, {minimumFractionDigits: Number.isInteger(v)?0:2, maximumFractionDigits:2});
};

const groupByCurrency = (items, getAmt, getCur) => {
  const t = {};
  items.forEach(i => {
    const c = getCur(i);
    t[c] = (t[c] || 0) + (parseFloat(getAmt(i)) || 0);
  });
  return t;
};

const fmtMulti = (totals) => {
  const entries = Object.entries(totals).filter(([,v]) => v > 0);
  if (entries.length === 0) return "—";
  return entries.map(([c, v]) => {
    const sym = CURRENCY_SYMBOLS[c] || (c + " ");
    const r = Number.isInteger(v) ? v : parseFloat(v.toFixed(2));
    return sym + r.toLocaleString(undefined, {minimumFractionDigits: Number.isInteger(v)?0:2, maximumFractionDigits:2});
  }).join("  +  ");
};

/* ── DATE FORMAT DD-MM-YYYY ── */
const fmtDate = (iso) => {
  if(!iso) return "—";
  const [y,m,d] = iso.split("-");
  if(!y||!m||!d) return iso;
  return `${d}-${m}-${y}`;
};

/* ── CONSTANTS ── */
const CARRIERS   = ["Jio","Airtel","Vi","BSNL","Airtel Business","Jio Business","Other"];
const DEFAULT_DEPTS = ["Engineering","Sales","Marketing","Finance","HR","Operations","Legal","Design"];
const DEFAULT_DESIGNATIONS = ["Manager","Senior Manager","Executive","Senior Executive","Team Lead","Analyst","Intern","Director","Vice President","Other"];
const DEFAULT_BRANCHES = ["Head Office","Mumbai HQ","Delhi Office","Bangalore Office","Chennai Office"];
const CATEGORIES = ["Communication","Productivity","Design","Development","CRM","Other"];
const DEFAULT_ASSET_TYPES = ["Mobile","Tablet","Laptop","Headphones","CPU","Monitor","Keyboard","Mouse","Docking Station","Webcam","Printer","Router","UPS","Hard Drive","Other"];
const ASSET_STATUS = ["assigned","available","in repair","damaged","retired"];
const ASSET_CONDITION = ["new","good","fair","poor"];

const USEFUL_LIFE_MONTHS = {Laptop:36,Desktop:48,CPU:48,Mobile:24,Tablet:30,Server:60,Printer:48,Monitor:60,Headphones:24,Webcam:36,Keyboard:36,Mouse:36,UPS:60,Router:48,"Hard Drive":36,"Docking Station":36,"Network Switch":48,AIO:48,Firewall:60,CCTV:48,Modem:48};
const calcDepreciation = (asset) => {
  if(!asset.purchaseDate||!asset.purchaseAmount) return null;
  const months=Math.floor((Date.now()-new Date(asset.purchaseDate).getTime())/(1000*60*60*24*30.44));
  const life=USEFUL_LIFE_MONTHS[asset.type]||36;
  const ratio=Math.max(0,1-months/life);
  return {bookValue:parseFloat(asset.purchaseAmount)*ratio,pct:Math.round(ratio*100),fullyDepreciated:ratio===0};
};

const SPEC_PRESETS = {
  "Laptop":         ["Processor","RAM","Storage","Display","GPU","OS","Battery"],
  "CPU":            ["Processor","RAM","Storage","Motherboard","GPU","PSU","OS"],
  "Mobile":         ["Processor","RAM","Storage","Display","Battery","OS","IMEI 2"],
  "Tablet":         ["Processor","RAM","Storage","Display","Battery","OS"],
  "Monitor":        ["Panel Size","Resolution","Panel Type","Refresh Rate","Ports"],
  "Hard Drive":     ["Capacity","Type","Interface","RPM","Form Factor"],
  "UPS":            ["Capacity (VA)","Output Power (W)","Battery Type","Runtime"],
  "Printer":        ["Type","Print Speed","Connectivity","Paper Size","Colour"],
  "Router":         ["Bands","Speed (Mbps)","Ports","Protocol","Coverage"],
  "Webcam":         ["Resolution","FPS","Field of View","Mic","USB/Connection"],
  "Headphones":     ["Driver","Frequency Range","Connectivity","Noise Cancel","Battery"],
  "Keyboard":       ["Layout","Switch Type","Connectivity","Backlit","Form Factor"],
  "Mouse":          ["DPI","Buttons","Connectivity","Sensor","Battery"],
  "Docking Station":["Ports","Power Delivery (W)","Display Outputs","USB Spec"],
  "Server":         ["Processor","RAM","Storage","RAID","OS","Power Supply"],
  "Network Switch": ["Ports","Speed","Managed","PoE","Layer"],
  "Firewall":       ["Throughput","VPN","Ports","UTM","Manufacturer"],
  "UPS Battery":    ["Capacity (Ah)","Voltage","Chemistry","Cycles","Brand"],
  "AIO":            ["Processor","RAM","Storage","Display","OS","Connectivity"],
  "CCTV":           ["Resolution","IR Range (m)","Lens (mm)","Type","Weatherproof"],
  "Monitor Stand":  ["Max Load (kg)","VESA","Adjustable","Material"],
  "Modem":          ["Type","Downstream","Upstream","Ports","Standard"],
};

const PAY_CLR = { paid:"#059669", pending:"#d97706", overdue:"#dc2626" };
const STA_CLR = { active:"#059669", suspended:"#d97706", inactive:"#94a3b8" };

/* ── SEED DATA ── */
const SEED_SIMS = [
  {id:"SIM001",employee:"Alice Johnson",dept:"Engineering",number:"+91 98100 11111",carrier:"Airtel Business",planName:"Corporate 5G",amount:999,currency:"INR",status:"active",payment:"paid",nextBillingDate:"2026-03-12",nameOnRecord:"Rajkumar V"},
  {id:"SIM002",employee:"Bob Martinez",dept:"Sales",number:"+91 98200 22222",carrier:"Jio Business",planName:"JioBiz Max",amount:49,currency:"USD",status:"active",payment:"paid",nextBillingDate:"2026-03-15",nameOnRecord:"Rajkumar V"},
  {id:"SIM003",employee:"Carol Lee",dept:"HR",number:"+91 70100 33333",carrier:"Vi",planName:"Vi Work 399",amount:399,currency:"INR",status:"active",payment:"overdue",nextBillingDate:"2026-03-05",nameOnRecord:"Rajkumar V"},
  {id:"SIM004",employee:"David Kim",dept:"Engineering",number:"+971 50 444 4444",carrier:"Airtel",planName:"Gulf Roaming",amount:35,currency:"AED",status:"suspended",payment:"overdue",nextBillingDate:"2026-03-10",nameOnRecord:"Rajkumar V"},
  {id:"SIM005",employee:"Eva Chen",dept:"Marketing",number:"+91 88001 55555",carrier:"Jio",planName:"Jio 239",amount:239,currency:"INR",status:"active",payment:"paid",nextBillingDate:"2026-04-01",nameOnRecord:"Rajkumar V"},
];
const SEED_APPS = [
  {id:"APP001",appName:"Slack",assignedTo:["Alice Johnson","Bob Martinez","Eva Chen"],planTier:"Pro",amount:7.25,currency:"USD",category:"Communication",status:"active",payment:"paid",billingType:"perUser",billingCycle:"monthly",nextBillingDate:"",payMode:"autopay"},
  {id:"APP002",appName:"Notion",assignedTo:["Alice Johnson","Carol Lee"],planTier:"Team",amount:16,currency:"USD",category:"Productivity",status:"active",payment:"paid",billingType:"perUser",billingCycle:"monthly",nextBillingDate:"",payMode:"manual"},
  {id:"APP003",appName:"Figma",assignedTo:["Eva Chen"],planTier:"Pro",amount:15,currency:"USD",category:"Design",status:"active",payment:"pending",billingType:"perUser",billingCycle:"monthly",nextBillingDate:"",payMode:"manual"},
  {id:"APP004",appName:"GitHub",assignedTo:["Alice Johnson","David Kim"],planTier:"Team",amount:4,currency:"USD",category:"Development",status:"active",payment:"paid",billingType:"perUser",billingCycle:"monthly",nextBillingDate:"",payMode:"autopay"},
];
const SEED_ASSETS = [
  {id:"AST001",name:"MacBook Pro 14\"",type:"Laptop",serialNo:"SN-MBP-001",assignedTo:"Alice Johnson",dept:"Engineering",purchaseDate:"2023-01-15",warrantyDate:"2026-01-15",purchaseAmount:185000,currency:"INR",condition:"good",status:"assigned",notes:"M2 Pro, 16GB RAM",photos:[]},
  {id:"AST002",name:"iPhone 14 Pro",type:"Mobile",serialNo:"SN-IP14-002",assignedTo:"Bob Martinez",dept:"Sales",purchaseDate:"2023-03-10",warrantyDate:"2025-03-10",purchaseAmount:1099,currency:"USD",condition:"good",status:"assigned",notes:"256GB Space Black",photos:[]},
  {id:"AST003",name:"Dell XPS 15",type:"Laptop",serialNo:"SN-DEL-006",assignedTo:"",dept:"",purchaseDate:"2022-08-05",warrantyDate:"2025-08-05",purchaseAmount:1500,currency:"USD",condition:"good",status:"available",notes:"Intel i7, 32GB RAM",photos:[]},
];

/* ── FIREBASE REALTIME DATABASE (REST + SSE) ── */
const FB_URL = (window.CORPDESK_CONFIG && window.CORPDESK_CONFIG.FIREBASE_URL) || "";
const FB_ROOT = FB_URL ? (FB_URL + "/vgi") : "";

// Firebase stores arrays as {0:{...},1:{...}} — normalise back to arrays
const fbArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return Object.values(val).filter(v => v !== null && v !== undefined);
};

const fixAsset = (a) => {
  if (!a || typeof a !== 'object') return a;
  let photos = [];
  if (typeof a.photos === 'string' && a.photos) photos = a.photos.split('||').filter(Boolean);
  else if (Array.isArray(a.photos)) photos = a.photos.filter(Boolean);
  else if (a.photos && typeof a.photos === 'object') photos = Object.values(a.photos).filter(Boolean);
  return {
    ...a, photos,
    specs: Array.isArray(a.specs) ? a.specs : a.specs && typeof a.specs === 'object' ? Object.values(a.specs) : [],
    assignedTo: Array.isArray(a.assignedTo) ? a.assignedTo : typeof a.assignedTo === 'string' ? a.assignedTo : [],
  };
};

const fixApp = (a) => {
  if (!a || typeof a !== 'object') return a;
  return { ...a, assignedTo: Array.isArray(a.assignedTo) ? a.assignedTo : a.assignedTo && typeof a.assignedTo === 'object' ? Object.values(a.assignedTo) : [] };
};

// Shared callback reference — set once by gsListen, used by fbSave to push updates
let _gsCallback = null;

// Fetch the full /vgi node from Firebase and push to UI
const fbRefresh = () => {
  if (!FB_ROOT || !_gsCallback) return Promise.resolve();
  return fetch(`${FB_ROOT}.json`)
    .then(r => r.json())
    .then(d => {
      if (!d || typeof d !== 'object') return;
      const cfg = d.config || {};
      _gsCallback({
        sims:               fbArr(d.sims),
        apps:               fbArr(d.apps).map(fixApp),
        assets:             fbArr(d.assets).map(fixAsset),
        assetTypes:         fbArr(cfg.assetTypes),
        depts:              fbArr(cfg.depts),
        branches:           fbArr(cfg.branches),
        designations:       fbArr(cfg.designations),
        employees:          fbArr(cfg.employees),
        carrierBillingDays: cfg.carrierBillingDays || {},
        audit:              fbArr(d.audit),
        appUsers:           fbArr(cfg.appUsers),
        assetHandovers:     fbArr(d.assetHandovers),
      });
    })
    .catch(e => console.error("Firebase fetch error:", e));
};

// Write a path under /vgi/, then re-fetch the full node to confirm what landed
const fbSave = (path, data) => {
  if (!FB_ROOT) { console.warn("Firebase URL not configured"); return Promise.resolve(); }
  return fetch(`${FB_ROOT}/${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  .then(r => { if (!r.ok) console.error("Firebase save HTTP error:", r.status, path); })
  .then(() => fbRefresh())
  .catch(e => console.error("Firebase save error:", e));
};

const gsSave = (action, data) => {
  if (action === "saveSims")   return fbSave("sims",               data);
  if (action === "saveApps")   return fbSave("apps",               data);
  if (action === "saveAssets") return fbSave("assets",             data);
  if (action === "saveConfig")    return fbSave(`config/${data.key}`, data.value);
  if (action === "saveHandovers") return fbSave("assetHandovers",       data);
  console.warn("Unknown action:", action);
};

// SSE listener — initial load + live updates from other tabs/devices
const gsListen = (callback) => {
  _gsCallback = callback;

  if (!FB_ROOT) {
    setTimeout(() => callback({ sims:[], apps:[], assets:[], assetTypes:[], depts:[], branches:[], designations:[], employees:[], carrierBillingDays:{}, appUsers:[] }), 100);
    return () => {};
  }

  // Load data immediately via REST on page load
  fbRefresh();

  // SSE stream — only used to detect changes made by OTHER clients
  // Our own writes already call fbRefresh() inside fbSave, so we skip
  // the first SSE put event (which is just Firebase echoing back the initial state)
  const es = new EventSource(`${FB_ROOT}.json`);
  let ready = false; // becomes true after the initial put is received

  es.addEventListener("put", () => {
    if (!ready) { ready = true; return; } // skip initial snapshot — already loaded above
    fbRefresh(); // another client changed data
  });
  es.addEventListener("patch", () => {
    if (!ready) { ready = true; return; }
    fbRefresh();
  });
  es.onerror = (e) => console.error("Firebase SSE error:", e);

  return () => { es.close(); _gsCallback = null; };
};

/* ── IMGBB UPLOAD ── */
const uploadToImgBB = async (base64data) => {
  const base64 = base64data.includes(',') ? base64data.split(',')[1] : base64data;
  const formData = new FormData();
  formData.append('image', base64);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { method:'POST', body:formData });
  const json = await res.json();
  if (json.success) return json.data.url;
  throw new Error('ImgBB upload failed');
};

/* ── XLSX EXPORT HELPERS ── */
const XLSX = window.XLSX;

const styleSheet = (ws, headers) => {
  // Bold header row
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const addr = XLSX.utils.encode_cell({r:0, c:C});
    if (!ws[addr]) continue;
    ws[addr].s = { font:{bold:true}, fill:{fgColor:{rgb:"1E293B"}} };
  }
  // Set col widths based on header length
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 14) }));
  return ws;
};

const exportSimXLSX = (sims) => {
  const headers = ["ID","Name on Record","Assigned To (Employee)","Department","Branch","Designation","Phone Number","Carrier","Plan Name","Amount","Currency","Next Billing Date","Status","Payment"];
  const rows = sims.map(s => [s.id,s.nameOnRecord||"",s.employee,s.dept,s.branch||"",s.designation||"",s.number,s.carrier,s.planName,s.amount,s.currency,s.nextBillingDate||'',s.status,s.payment]);
  const ws = styleSheet(XLSX.utils.aoa_to_sheet([headers,...rows]), headers);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "SIM Plans");
  XLSX.writeFile(wb, "SIM_Plans.xlsx");
};

const exportAppXLSX = (apps) => {
  const headers = ["ID","App Name","Plan Tier","Category","Amount/Seat","Currency","Total Amount","Billing Type","Billing Cycle","Next Billing Date","Assigned To","Seats","Payment","Status"];
  const rows = apps.map(a => {
    const at=Array.isArray(a.assignedTo)?a.assignedTo:[];
    const seats = a.billingType==="flatInvoice" ? 1 : at.length;
    return [a.id,a.appName,a.planTier,a.category,a.amount,a.currency,a.amount*seats,a.billingType||"perUser",a.billingCycle||"monthly",a.nextBillingDate||"",at.join("; "),at.length,a.payment,a.status];
  });
  const ws = styleSheet(XLSX.utils.aoa_to_sheet([headers,...rows]), headers);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "App Subscriptions");
  XLSX.writeFile(wb, "App_Subscriptions.xlsx");
};

const exportAssetXLSX = (assets) => {
  const headers = ["ID","Asset Name","Type","Serial No / IMEI","Assigned To","Department","Branch","Designation","Purchase Date","Warranty Date","Purchase Amount","Currency","Condition","Status","Notes","Specs"];
  const rows = assets.map(a => [a.id,a.name,a.type,a.serialNo||"",a.assignedTo||"",a.dept||"",a.branch||"",a.designation||"",a.purchaseDate||"",a.warrantyDate||"",a.purchaseAmount||0,a.currency,a.condition,a.status,a.notes||"",(a.specs&&a.specs.length>0)?a.specs.map(s=>`${s.key}: ${s.val}`).join(" | "):"" ]);
  const ws = styleSheet(XLSX.utils.aoa_to_sheet([headers,...rows]), headers);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Assets");
  XLSX.writeFile(wb, "Assets.xlsx");
};

const exportAllXLSX = (sims, apps, assets) => {
  const wb = XLSX.utils.book_new();
  // SIMs
  const sh1 = ["ID","Name on Record","Assigned To (Employee)","Department","Branch","Designation","Phone Number","Carrier","Plan Name","Amount","Currency","Next Billing Date","Status","Payment"];
  const sr = sims.map(s => [s.id,s.nameOnRecord||"",s.employee,s.dept,s.branch||"",s.designation||"",s.number,s.carrier,s.planName,s.amount,s.currency,s.nextBillingDate||'',s.status,s.payment]);
  XLSX.utils.book_append_sheet(wb, styleSheet(XLSX.utils.aoa_to_sheet([sh1,...sr]), sh1), "SIM Plans");
  // Apps
  const sh2 = ["ID","App Name","Plan Tier","Category","Amount/Seat","Currency","Total Amount","Billing Type","Billing Cycle","Next Billing Date","Assigned To","Seats","Payment","Status"];
  const ar = apps.map(a => {
    const at2=Array.isArray(a.assignedTo)?a.assignedTo:[];
    const seats = a.billingType==="flatInvoice"?1:at2.length;
    return [a.id,a.appName,a.planTier,a.category,a.amount,a.currency,a.amount*seats,a.billingType||"perUser",a.billingCycle||"monthly",a.nextBillingDate||"",at2.join("; "),at2.length,a.payment,a.status];
  });
  XLSX.utils.book_append_sheet(wb, styleSheet(XLSX.utils.aoa_to_sheet([sh2,...ar]), sh2), "App Subscriptions");
  // Assets
  const sh3 = ["ID","Asset Name","Type","Serial No / IMEI","Assigned To","Department","Branch","Designation","Purchase Date","Warranty Date","Purchase Amount","Currency","Condition","Status","Notes","Specs"];
  const asr = assets.map(a => [a.id,a.name,a.type,a.serialNo||"",a.assignedTo||"",a.dept||"",a.branch||"",a.designation||"",a.purchaseDate||"",a.warrantyDate||"",a.purchaseAmount||0,a.currency,a.condition,a.status,a.notes||"",(a.specs&&a.specs.length>0)?a.specs.map(s=>`${s.key}: ${s.val}`).join(" | "):"" ]);
  XLSX.utils.book_append_sheet(wb, styleSheet(XLSX.utils.aoa_to_sheet([sh3,...asr]), sh3), "Assets");
  XLSX.writeFile(wb, "VGI_Export.xlsx");
};

/* ── EMPLOYEE IMPORT PARSER ── */
const parseEmployeeRows = (headers, rows) => {
  const ci = k => headers.findIndex(h=>(h||"").toString().toLowerCase().includes(k.toLowerCase()));
  return rows.filter(r=>r.some(c=>c)).map(r=>({
    id:     String(r[ci("system")]||"").trim().toUpperCase(),
    empId:  String(r[ci("employee id")]!==-1&&r[ci("employee id")]!==undefined ? r[ci("employee id")] : (r[ci("empid")]!==undefined?r[ci("empid")]:"")||"").trim().toUpperCase(),
    name:   String(r[ci("name")]||"").trim(),
    dept:   String(r[ci("dept")]||"").trim(),
    branch: String(r[ci("branch")]||"").trim(),
  })).filter(e=>e.name);
};

/* ── XLSX IMPORT HELPERS ── */
const readXLSXFile = (file, onData) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:""});
    if (rows.length < 2) { onData(null, "File appears empty or has no data rows."); return; }
    const headers = rows[0].map(h => String(h).toLowerCase().trim());
    const dataRows = rows.slice(1).filter(r => r.some(c => c !== ""));
    onData({ headers, dataRows }, null);
  };
  reader.onerror = () => onData(null, "Failed to read file.");
  reader.readAsArrayBuffer(file);
};

const colIdx = (headers, ...keys) => {
  for (const k of keys) {
    const i = headers.findIndex(h => h.includes(k.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
};

const parseSIMRows = (headers, dataRows) => {
  const ci = (k, ...rest) => colIdx(headers, k, ...rest);
  return dataRows.map((r, i) => ({
    id: String(r[ci('id')] || `SIM_IMP_${i+1}`).trim(),
    employee: String(r[ci('employee')] || "").trim(),
    dept: String(r[ci('dept','department')] || "").trim(),
    branch: String(r[ci('branch')] || "").trim(),
    number: String(r[ci('phone','number')] || "").trim(),
    carrier: String(r[ci('carrier')] || "Jio").trim(),
    planName: String(r[ci('plan')] || "").trim(),
    amount: parseFloat(r[ci('amount')]) || 0,
    currency: String(r[ci('currency')] || "INR").trim().toUpperCase(),
    nextBillingDate: String(r[ci('next billing','next billing date','bill date')] || '').trim(),
    status: String(r[ci('status')] || "active").trim().toLowerCase(),
    payment: String(r[ci('payment')] || "paid").trim().toLowerCase(),
    nameOnRecord: String(r[ci('name on record','nameOnRecord','record name','registered')] || "").trim(),
    designation: String(r[ci('designation')] || "").trim(),
  })).filter(s => s.employee);
};

const parseAppRows = (headers, dataRows) => {
  const ci = (k, ...rest) => colIdx(headers, k, ...rest);
  return dataRows.map((r, i) => {
    const assignedRaw = String(r[ci('assigned to','assigned')] || "").trim();
    const assignedTo = assignedRaw ? assignedRaw.split(/[;,]/).map(p=>p.trim()).filter(Boolean) : [];
    return {
      id: String(r[ci('id')] || `APP_IMP_${i+1}`).trim(),
      appName: String(r[ci('app name','app')] || "").trim(),
      planTier: String(r[ci('plan tier','tier')] || "").trim(),
      category: String(r[ci('category')] || "Productivity").trim(),
      amount: parseFloat(r[ci('amount')]) || 0,
      currency: String(r[ci('currency')] || "USD").trim().toUpperCase(),
      billingType: String(r[ci('billing type')] || "perUser").trim(),
      billingCycle: String(r[ci('billing cycle')] || "monthly").trim(),
      nextBillingDate: String(r[ci('next billing','next')] || "").trim(),
      assignedTo,
      payment: String(r[ci('payment')] || "paid").trim().toLowerCase(),
      status: String(r[ci('status')] || "active").trim().toLowerCase(),
    };
  }).filter(a => a.appName);
};

const parseAssetRows = (headers, dataRows) => {
  const ci = (k, ...rest) => colIdx(headers, k, ...rest);
  return dataRows.map((r, i) => ({
    id: String(r[ci('id')] || `AST_IMP_${i+1}`).trim(),
    name: String(r[ci('asset name','name')] || "").trim(),
    type: String(r[ci('type')] || "Other").trim(),
    serialNo: String(r[ci('serial')] || "").trim(),
    assignedTo: String(r[ci('assigned to','assigned')] || "").trim(),
    dept: String(r[ci('dept','department')] || "").trim(),
    branch: String(r[ci('branch')] || "").trim(),
    purchaseDate: String(r[ci('purchase date')] || "").trim(),
    warrantyDate: String(r[ci('warranty')] || "").trim(),
    purchaseAmount: parseFloat(r[ci('purchase amount','amount')]) || 0,
    currency: String(r[ci('currency')] || "INR").trim().toUpperCase(),
    condition: String(r[ci('condition')] || "good").trim().toLowerCase(),
    status: String(r[ci('status')] || "assigned").trim().toLowerCase(),
    notes: String(r[ci('notes')] || "").trim(),
    designation: String(r[ci('designation')] || "").trim(),
    photos: [],
    specs: (()=>{
      const raw = String(r[ci('specs')] || "").trim();
      if(!raw) return [];
      return raw.split("|").map(p=>{
        const idx = p.indexOf(":");
        if(idx===-1) return {key:p.trim(),val:""};
        return {key:p.slice(0,idx).trim(), val:p.slice(idx+1).trim()};
      }).filter(s=>s.key);
    })(),
  })).filter(a => a.name);
};

/* mergeById — updates existing record if ID matches, appends new ones */
const mergeById = (existing, imported) => {
  const map = {};
  existing.forEach(x => map[x.id] = x);
  imported.forEach(x => map[x.id] = x);
  return Object.values(map);
};

/* dedupMergeSIMs — skips rows where phone number already exists */
const dedupMergeSIMs = (existing, imported) => {
  const existingPhones = new Set(existing.map(s => s.number.replace(/\s/g,"")));
  const added = []; const skipped = [];
  imported.forEach(s => {
    const norm = (s.number||"").replace(/\s/g,"");
    if(norm && existingPhones.has(norm)){ skipped.push(s); }
    else { added.push(s); if(norm) existingPhones.add(norm); }
  });
  return { merged: [...existing, ...added], added: added.length, skipped: skipped.length };
};

/* dedupMergeApps — skips rows where app name already exists */
const dedupMergeApps = (existing, imported) => {
  const existingNames = new Set(existing.map(a => a.appName.toLowerCase().trim()));
  const added = []; const skipped = [];
  imported.forEach(a => {
    const norm = (a.appName||"").toLowerCase().trim();
    if(norm && existingNames.has(norm)){ skipped.push(a); }
    else { added.push(a); if(norm) existingNames.add(norm); }
  });
  return { merged: [...existing, ...added], added: added.length, skipped: skipped.length };
};

/* dedupMergeAssets — skips rows where serial number already exists (if provided) */
const dedupMergeAssets = (existing, imported) => {
  const existingSerials = new Set(existing.map(a => (a.serialNo||"").toLowerCase().trim()).filter(Boolean));
  const added = []; const skipped = [];
  imported.forEach(a => {
    const norm = (a.serialNo||"").toLowerCase().trim();
    if(norm && existingSerials.has(norm)){ skipped.push(a); }
    else { added.push(a); if(norm) existingSerials.add(norm); }
  });
  return { merged: [...existing, ...added], added: added.length, skipped: skipped.length };
};

/* ── UI COMPONENTS ── */
function Pill({text,color}){
  return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:600,color,whiteSpace:"nowrap"}}>
    <span style={{width:6,height:6,borderRadius:"50%",background:color,flexShrink:0,display:"inline-block"}}/>
    {text}
  </span>;
}
function CTag({currency}){
  return <span style={{fontSize:10,color:"#94a3b8",fontFamily:"'DM Mono',monospace",letterSpacing:.3}}>{currency}</span>;
}
function Btn({onClick,color="#60a5fa",children,sm,disabled}){
  const [h,setH]=useState(false);
  return <button onClick={onClick} disabled={disabled} onMouseOver={()=>setH(true)} onMouseOut={()=>setH(false)}
    style={{background:h&&!disabled?color+"30":color+"15",border:`1px solid ${color}40`,color,borderRadius:8,
      padding:sm?"3px 9px":"6px 14px",fontSize:sm?11:12,fontWeight:600,cursor:disabled?"not-allowed":"pointer",
      whiteSpace:"nowrap",transition:"all .12s",fontFamily:"inherit",opacity:disabled?.5:1}}>{children}</button>;
}
const INP={width:"100%",background:"#fff",border:"1px solid #e2e8f0",
  borderRadius:8,padding:"9px 13px",color:"#1e293b",fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit",boxShadow:"0 1px 2px rgba(0,0,0,.04)"};
const SEL={...INP,cursor:"pointer",appearance:"none"};
const LBL={display:"block",color:"#64748b",fontSize:11,fontWeight:600,letterSpacing:.5,textTransform:"uppercase",marginBottom:5};

function Modal({title,onClose,wide,children}){
  useEffect(()=>{
    const onKey=e=>{ if(e.key==="Escape") onClose(); };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[onClose]);
  return(
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",
      padding:16,background:"rgba(15,23,42,.6)",backdropFilter:"blur(12px)"}}>
      <div style={{width:"100%",maxWidth:wide?700:500,background:"#fff",border:"1px solid #e2e8f0",
        borderRadius:14,boxShadow:"0 16px 50px rgba(0,0,0,.18)",overflow:"hidden",maxHeight:"90vh",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 24px",
          borderBottom:"1px solid #f1f5f9",flexShrink:0,background:"#f8fafc"}}>
          <span style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>{title}</span>
          <button onClick={onClose} style={{background:"#f1f5f9",border:"1px solid #e2e8f0",color:"#64748b",
            fontSize:16,cursor:"pointer",lineHeight:1,padding:"4px 10px",fontFamily:"inherit",borderRadius:7}}>×</button>
        </div>
        <div style={{padding:24,overflowY:"auto",background:"#fff"}}>{children}</div>
      </div>
    </div>
  );
}
function FR({label,children}){
  return <div style={{marginBottom:14}}><label style={LBL}>{label}</label>{children}</div>;
}

function StatCard({label,val,accent,sub}){
  const isLong = typeof val==="string" && val.length > 14;
  return(
    <div style={{background:"#fff",border:"1px solid #e8edf2",borderRadius:12,padding:"16px 18px",
      borderLeft:`3px solid ${accent}`,boxShadow:"0 1px 6px rgba(0,0,0,.06)",animation:"fadeIn .3s ease"}}>
      <div style={{fontSize:11,color:"#94a3b8",fontWeight:700,letterSpacing:.5,textTransform:"uppercase",marginBottom:6}}>{label}</div>
      <div style={{fontSize:isLong?12:24,fontWeight:800,color:"#0f172a",fontFamily:"'DM Mono',monospace",lineHeight:isLong?1.6:1.2,wordBreak:"break-word",letterSpacing:isLong?0:-.5}}>{val}</div>
      {sub&&<div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>{sub}</div>}
    </div>
  );
}

/* ── IMPORT TOAST ── */
function ImportToast({msg, ok}){
  if(!msg)return null;
  const color = ok ? "#34d399" : "#f87171";
  return(
    <div style={{position:"fixed",bottom:24,right:24,zIndex:999,padding:"10px 18px",
      background:ok?"#f0fdf4":"#fef2f2",border:`1px solid ${color}50`,
      borderRadius:10,color,fontSize:13,fontWeight:600,boxShadow:"0 4px 16px rgba(0,0,0,.1)",
      animation:"fadeIn .2s ease"}}>
      {ok?"✓ ":"✗ "}{msg}
    </div>
  );
}

/* ── DEPT SELECT ── */
function DeptSelect({value,onChange,depts}){
  return(
    <select value={value||""} onChange={e=>onChange(e.target.value)} style={SEL}>
      <option value="">— Select Department —</option>
      {depts.map(d=><option key={d} value={d}>{d}</option>)}
    </select>
  );
}

/* ── BRANCH SELECT ── */
function BranchSelect({value,onChange,branches}){
  return(
    <select value={value||""} onChange={e=>onChange(e.target.value)} style={SEL}>
      <option value="">— Select Branch —</option>
      {branches.map(b=><option key={b} value={b}>{b}</option>)}
    </select>
  );
}
function DesignationSelect({value,onChange,designations}){
  return(
    <select value={value||""} onChange={e=>onChange(e.target.value)} style={SEL}>
      <option value="">— Select Designation —</option>
      {(designations||[]).map(d=><option key={d} value={d}>{d}</option>)}
    </select>
  );
}

/* ── DEPT COMBOBOX (kept for backward compat, now just a select) ── */
function DeptInput({value,onChange,depts}){
  return <DeptSelect value={value} onChange={onChange} depts={depts}/>;
}

/* ── PHOTO LIGHTBOX ── */
function PhotoLightbox({photos,startIndex,onClose}){
  const [idx,setIdx]=useState(startIndex||0);
  const prev=()=>setIdx(i=>(i-1+photos.length)%photos.length);
  const next=()=>setIdx(i=>(i+1)%photos.length);
  useEffect(()=>{
    const onKey=e=>{ if(e.key==="ArrowLeft")prev(); else if(e.key==="ArrowRight")next(); else if(e.key==="Escape")onClose(); };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[]);
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.92)",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <button onClick={onClose} style={{position:"absolute",top:20,right:24,background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.2)",color:"#fff",borderRadius:999,width:36,height:36,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
      <div style={{position:"absolute",top:24,left:"50%",transform:"translateX(-50%)",fontSize:12,color:"#64748b",fontWeight:600}}>{idx+1} / {photos.length}</div>
      <div onClick={e=>e.stopPropagation()} style={{maxWidth:"90vw",maxHeight:"80vh",display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
        <img src={photos[idx]} alt={`Photo ${idx+1}`} style={{maxWidth:"90vw",maxHeight:"80vh",borderRadius:12,objectFit:"contain",boxShadow:"0 20px 80px rgba(0,0,0,.8)"}}/>
      </div>
      {photos.length>1&&(
        <>
          <button onClick={e=>{e.stopPropagation();prev();}} style={{position:"absolute",left:20,top:"50%",transform:"translateY(-50%)",background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.2)",color:"#fff",borderRadius:999,width:44,height:44,fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
          <button onClick={e=>{e.stopPropagation();next();}} style={{position:"absolute",right:20,top:"50%",transform:"translateY(-50%)",background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.2)",color:"#fff",borderRadius:999,width:44,height:44,fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
        </>
      )}
      {photos.length>1&&(
        <div onClick={e=>e.stopPropagation()} style={{display:"flex",gap:8,padding:"0 16px",overflowX:"auto",maxWidth:"90vw"}}>
          {photos.map((src,i)=>(
            <img key={i} src={src} alt="" onClick={()=>setIdx(i)}
              style={{width:56,height:56,borderRadius:8,objectFit:"cover",cursor:"pointer",flexShrink:0,
                border:i===idx?"2px solid #6366f1":"2px solid transparent",opacity:i===idx?1:.6,transition:"all .15s"}}/>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── CONFIRM DELETE BUTTON ── */
function ConfirmBtn({label="Del", onConfirm, color="#f87171"}){
  const [armed, setArmed] = useState(false);
  if(armed) return(
    <span style={{display:"inline-flex",gap:4,alignItems:"center"}}>
      <button onClick={onConfirm}
        style={{background:color+"25",border:`1px solid ${color}60`,color,borderRadius:8,padding:"3px 8px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>Sure?</button>
      <button onClick={()=>setArmed(false)}
        style={{background:"#f1f5f9",border:"1px solid #e2e8f0",color:"#64748b",borderRadius:8,padding:"3px 7px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
    </span>
  );
  return <Btn sm onClick={()=>setArmed(true)} color={color}>{label}</Btn>;
}
function ImportBtn({label, color, onFile, disabled}){
  const ref = useRef(null);
  return(
    <>
      <input ref={ref} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={e=>{if(e.target.files[0])onFile(e.target.files[0]);e.target.value="";}}/>
      <button onClick={()=>ref.current&&ref.current.click()} disabled={disabled}
        style={{display:"flex",alignItems:"center",gap:7,padding:"9px 14px",background:color+"12",
          border:`1px solid ${color}30`,borderRadius:10,color,fontSize:12,fontWeight:600,
          cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",whiteSpace:"nowrap",opacity:disabled?.5:1}}
        onMouseOver={e=>!disabled&&(e.currentTarget.style.background=color+"22")}
        onMouseOut={e=>e.currentTarget.style.background=color+"12"}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        {label}
      </button>
    </>
  );
}

/* ── DASHBOARD ── */
const DASH_TYPES = ["Laptop","Mobile","Tablet","Monitor","CPU","Mouse","Headphones","Keyboard","Webcam","Printer","Router","UPS","Hard Drive","Docking Station"];
const TYPE_EMOJI = {"Mobile":"📱","Tablet":"📲","Laptop":"💻","Monitor":"🖥️","Headphones":"🎧","CPU":"💾","Keyboard":"⌨️","Mouse":"🖱️","Docking Station":"🔌","Webcam":"📷","Printer":"🖨️","Router":"📡","UPS":"🔋","Hard Drive":"💿"};

/* DashSection removed — replaced inline per-section */


/* ── SETTINGS PANEL (Depts, Branches, Designations, Email) ── */
/* ══════════════════════════════════════════
   AUDIT LOG HELPERS + COMPONENT  (Firebase-backed)
══════════════════════════════════════════ */
const MAX_AUDIT = 200;

// In-memory cache so getAuditLog() is synchronous for the UI
let _auditCache = [];

// Called once from the Firebase SSE listener to seed the cache
const seedAuditCache = (entries) => {
  _auditCache = Array.isArray(entries) ? entries : fbArr(entries);
};

/* Write one audit entry to Firebase — fire-and-forget, never throws */
const auditLog = async (action, entityType, entityId, entityLabel, changes, user) => {
  try {
    const entry = {
      id:          Date.now() + Math.random().toString(36).slice(2,6),
      ts:          new Date().toISOString(),
      action,
      entityType,
      entityId:    entityId || "",
      entityLabel: entityLabel || "",
      changes:     changes || {},
      user:        user || "unknown",
    };
    // Optimistically update the in-memory cache
    _auditCache = [entry, ..._auditCache];
    if(_auditCache.length > MAX_AUDIT) _auditCache.length = MAX_AUDIT;
    // Persist to Firebase
    if(FB_ROOT){
      await fetch(`${FB_ROOT}/audit.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(_auditCache),
      }).catch(e => console.error("Audit save error:", e));
    }
  } catch(e) { /* silent */ }
};

const getAuditLog = () => _auditCache;

const clearAuditLog = async () => {
  _auditCache = [];
  if(FB_ROOT){
    await fetch(`${FB_ROOT}/audit.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([]),
    }).catch(e => console.error("Audit clear error:", e));
  }
};

/* Format a changes object for display */
const fmtChanges = (changes) => {
  if(!changes || typeof changes !== "object") return [];
  return Object.entries(changes).map(([k,v]) => {
    if(typeof v === "object" && v !== null && "from" in v && "to" in v){
      return {field:k, from:String(v.from ?? ""), to:String(v.to ?? "")};
    }
    return null;
  }).filter(Boolean);
};

/* Diff two objects — returns {field:{from,to}} for changed fields */
const diffObjects = (oldObj, newObj, skipFields=["_id","id","ts"]) => {
  const diff = {};
  const keys = new Set([...Object.keys(oldObj||{}), ...Object.keys(newObj||{})]);
  keys.forEach(k => {
    if(skipFields.includes(k)) return;
    const ov = String((oldObj||{})[k] ?? "");
    const nv = String((newObj||{})[k] ?? "");
    if(ov !== nv) diff[k] = {from:ov, to:nv};
  });
  return diff;
};

/* ── AuditLogPanel component ── */
function AuditLogPanel(){
  const[log, setLog]   = useState(()=>getAuditLog());
  const[filter, setFilter] = useState("all");
  const[expanded, setExpanded] = useState(null);
  const[showClearDlg, setShowClearDlg] = useState(false);
  const[clearPw, setClearPw] = useState("");
  const[clearErr, setClearErr] = useState("");
  const[clearing, setClearing] = useState(false);

  const refresh = () => setLog([...getAuditLog()]);

  const attemptClear = async () => {
    const users = (window.CORPDESK_CONFIG && window.CORPDESK_CONFIG.USERS) || [];
    const match = users.find(u => u.role === "editor" && u.password === clearPw);
    if(match){
      setClearing(true);
      await clearAuditLog();
      setLog([]);
      setClearing(false);
      setShowClearDlg(false);
      setClearPw("");
      setClearErr("");
    } else {
      setClearErr("Incorrect password");
    }
  };

  const ACTION_LABEL = {create:"Created", update:"Updated", delete:"Deleted"};
  const ACTION_COLOR = {create:"#059669", update:"#2563eb", delete:"#dc2626"};
  const ACTION_BG    = {create:"#f0fdf4", update:"#eff6ff", delete:"#fef2f2"};
  const TYPE_LABEL   = {sim:"SIM", app:"App", asset:"Asset"};

  const filtered = filter==="all" ? log : log.filter(e=>e.entityType===filter);

  const fmtDate = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})
        + " " + d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:false});
    } catch(e){ return iso||""; }
  };

  return(
    <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:14}}>
      {showClearDlg&&(
        <div style={{position:"fixed",inset:0,zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,23,42,.55)",backdropFilter:"blur(8px)"}}>
          <div style={{width:"100%",maxWidth:360,background:"#fff",borderRadius:16,boxShadow:"0 20px 60px rgba(0,0,0,.22)",overflow:"hidden",border:"1px solid #fecaca"}}>
            <div style={{padding:"18px 20px 14px",background:"#fff5f5",borderBottom:"1px solid #fecaca",display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:32,height:32,borderRadius:8,background:"#fecaca",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              </div>
              <div>
                <div style={{fontWeight:800,fontSize:15,color:"#0f172a"}}>Clear Audit Log</div>
                <div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>Enter an editor password to proceed</div>
              </div>
            </div>
            <div style={{padding:"18px 20px 20px"}}>
              <label style={{fontSize:10,fontWeight:700,color:"#64748b",letterSpacing:.5,textTransform:"uppercase",display:"block",marginBottom:6}}>Editor Password</label>
              <input type="password" value={clearPw} autoFocus
                onChange={e=>{setClearPw(e.target.value);setClearErr("");}}
                onKeyDown={e=>{if(e.key==="Enter")attemptClear();if(e.key==="Escape"){setShowClearDlg(false);setClearPw("");setClearErr("");}}}
                placeholder="Enter editor password…"
                style={{width:"100%",padding:"10px 13px",border:`1px solid ${clearErr?"#fca5a5":"#e2e8f0"}`,borderRadius:9,fontSize:13,fontFamily:"inherit",outline:"none",color:"#0f172a",background:"#f8fafc"}}/>
              {clearErr&&<div style={{fontSize:11,color:"#dc2626",fontWeight:600,marginTop:6,padding:"6px 10px",background:"#fff5f5",border:"1px solid #fecaca",borderRadius:7}}>{clearErr}</div>}
              <div style={{display:"flex",gap:8,marginTop:14}}>
                <button onClick={()=>{setShowClearDlg(false);setClearPw("");setClearErr("");}}
                  style={{flex:1,padding:"10px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,color:"#64748b",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                <button onClick={attemptClear} disabled={clearing}
                  style={{flex:1,padding:"10px",background:"#dc2626",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:clearing?"not-allowed":"pointer",fontFamily:"inherit",opacity:clearing?.6:1}}>
                  {clearing?"Clearing…":"Clear Log"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"#0f172a"}}>Audit Log</div>
          <div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>Last {MAX_AUDIT} changes · synced to Firebase</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button onClick={refresh}
            style={{padding:"5px 10px",borderRadius:7,border:"1px solid #e2e8f0",background:"#f8fafc",
              fontSize:11,fontWeight:600,color:"#64748b",cursor:"pointer",fontFamily:"inherit"}}>
            Refresh
          </button>
          <button onClick={()=>setShowClearDlg(true)}
            style={{padding:"5px 10px",borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",
              fontSize:11,fontWeight:600,color:"#dc2626",cursor:"pointer",fontFamily:"inherit"}}>
            Clear Log
          </button>
        </div>
      </div>

      <div style={{display:"flex",gap:6}}>
        {[{v:"all",l:"All"},{v:"sim",l:"SIM"},{v:"app",l:"App"},{v:"asset",l:"Asset"}].map(f=>(
          <button key={f.v} onClick={()=>setFilter(f.v)}
            style={{padding:"4px 10px",borderRadius:99,border:"1px solid",cursor:"pointer",
              fontSize:11,fontWeight:700,fontFamily:"inherit",transition:"all .12s",
              borderColor:filter===f.v?"#2563eb":"#e2e8f0",
              background:filter===f.v?"#eff6ff":"#f8fafc",
              color:filter===f.v?"#1d4ed8":"#64748b"}}>
            {f.l}
          </button>
        ))}
        <span style={{marginLeft:"auto",fontSize:11,color:"#94a3b8",alignSelf:"center"}}>
          {filtered.length} entries
        </span>
      </div>

      {filtered.length===0
        ?<div style={{textAlign:"center",padding:"32px 0",color:"#cbd5e1"}}>
            <div style={{fontSize:13,fontWeight:600}}>No audit entries yet</div>
            <div style={{fontSize:11,marginTop:4}}>Changes will appear here after you create, update or delete records.</div>
          </div>
        :<div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:380,overflowY:"auto"}}>
          {filtered.map(entry=>{
            const isOpen = expanded===entry.id;
            const changes = fmtChanges(entry.changes);
            return(
              <div key={entry.id}
                style={{border:"1px solid #e8edf4",borderRadius:10,overflow:"hidden",background:"#fff"}}
                onMouseOver={e=>e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,.06)"}
                onMouseOut={e=>e.currentTarget.style.boxShadow="none"}>
                <div onClick={()=>setExpanded(isOpen?null:entry.id)}
                  style={{padding:"9px 12px",display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                  {/* action badge */}
                  <div style={{flexShrink:0,padding:"2px 8px",borderRadius:4,
                    background:ACTION_BG[entry.action]||"#f8fafc",
                    border:`1px solid ${ACTION_COLOR[entry.action]||"#e2e8f0"}30`}}>
                    <span style={{fontSize:10,fontWeight:800,letterSpacing:.4,
                      color:ACTION_COLOR[entry.action]||"#64748b",textTransform:"uppercase"}}>
                      {ACTION_LABEL[entry.action]||entry.action||"?"}
                    </span>
                  </div>
                  {/* entity type badge */}
                  <div style={{flexShrink:0,padding:"2px 7px",borderRadius:4,background:"#f1f5f9",border:"1px solid #e2e8f0"}}>
                    <span style={{fontSize:10,fontWeight:700,color:"#64748b",letterSpacing:.3}}>
                      {TYPE_LABEL[entry.entityType]||entry.entityType||"?"}
                    </span>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#0f172a",
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {entry.entityLabel||entry.entityId||"Unknown"}
                    </div>
                    <div style={{fontSize:10,color:"#94a3b8",marginTop:1,display:"flex",gap:8}}>
                      <span>{entry.user||"unknown"}</span>
                      <span>{fmtDate(entry.ts)}</span>
                      {changes.length>0&&<span>· {changes.length} field{changes.length!==1?"s":""} changed</span>}
                    </div>
                  </div>
                  <span style={{fontSize:10,color:"#94a3b8",flexShrink:0,paddingLeft:4}}>
                    {isOpen?"▲":"▼"}
                  </span>
                </div>
                {isOpen&&(
                  <div style={{borderTop:"1px solid #f1f5f9",background:"#f8fafc",padding:"10px 12px"}}>
                    {changes.length===0
                      ?<div style={{fontSize:11,color:"#94a3b8",fontStyle:"italic"}}>
                          {entry.action==="create"?"Record created."
                           :entry.action==="delete"?"Record deleted."
                           :"No field-level changes recorded."}
                        </div>
                      :<div style={{display:"flex",flexDirection:"column",gap:5}}>
                          {changes.map(({field,from,to})=>(
                            <div key={field}
                              style={{display:"flex",gap:8,alignItems:"flex-start",
                                padding:"4px 8px",borderRadius:6,background:"#fff",
                                border:"1px solid #e8edf4",fontSize:11}}>
                              <span style={{minWidth:90,fontWeight:700,color:"#475569",
                                flexShrink:0,textTransform:"uppercase",
                                fontSize:9,letterSpacing:.3,paddingTop:1}}>{field}</span>
                              <span style={{color:"#dc2626",textDecoration:"line-through",
                                maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",
                                whiteSpace:"nowrap",flexShrink:0}}>{from||"—"}</span>
                              <span style={{color:"#94a3b8",flexShrink:0}}>→</span>
                              <span style={{color:"#059669",maxWidth:120,overflow:"hidden",
                                textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{to||"—"}</span>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>
      }
    </div>
  );
}


/* ── PAYMENT HISTORY HELPERS ── */
const PAY_HIST_KEY = "cdPayHistory";

const logPayment = (entityType, entityId, entityLabel, amount, currency, user, note) => {
  try {
    const raw = localStorage.getItem(PAY_HIST_KEY);
    const hist = raw ? JSON.parse(raw) : {};
    const key = entityType + ":" + entityId;
    if(!hist[key]) hist[key] = [];
    hist[key].unshift({
      ts: new Date().toISOString(),
      amount: parseFloat(amount)||0,
      currency,
      user: user||"unknown",
      note: note||"",
      entityLabel,
    });
    if(hist[key].length > 50) hist[key].length = 50;
    localStorage.setItem(PAY_HIST_KEY, JSON.stringify(hist));
  } catch(e){}
};

const getPayHistory = (entityType, entityId) => {
  try {
    const raw = localStorage.getItem(PAY_HIST_KEY);
    const hist = raw ? JSON.parse(raw) : {};
    return hist[entityType+":"+entityId] || [];
  } catch(e){ return []; }
};

/* ── PAYMENT HISTORY MODAL ── */
function PayHistoryModal({entityType, entityId, entityLabel, onClose}){
  const hist = getPayHistory(entityType, entityId);
  const fmtD=(iso)=>{try{const d=new Date(iso);return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})+" "+d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:false});}catch(e){return iso||"";}};
  const icon = entityType==="sim"?"SIM":"App";
  return(
    <div style={{position:"fixed",inset:0,zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,23,42,.6)",backdropFilter:"blur(10px)",padding:16}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:520,background:"#fff",borderRadius:16,boxShadow:"0 20px 60px rgba(0,0,0,.2)",overflow:"hidden",maxHeight:"80vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"16px 20px",background:"#f0fdf4",borderBottom:"1px solid #bbf7d0",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:"#0f172a"}}>Payment History</div>
            <div style={{fontSize:12,color:"#059669",fontWeight:600,marginTop:1}}>{entityLabel} <span style={{color:"#94a3b8",fontWeight:400,fontFamily:"'DM Mono',monospace",fontSize:11}}>· {entityId}</span></div>
          </div>
          <button onClick={onClose} style={{background:"#f1f5f9",border:"1px solid #e2e8f0",color:"#64748b",fontSize:16,cursor:"pointer",padding:"4px 10px",borderRadius:7,fontFamily:"inherit"}}>×</button>
        </div>
        <div style={{overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:8}}>
          {hist.length===0&&<div style={{textAlign:"center",padding:"32px 0",color:"#94a3b8",fontSize:13,fontStyle:"italic"}}>No payments recorded yet.<br/><span style={{fontSize:11}}>Payments are logged when you click "Pay" or "Mark Paid".</span></div>}
          {hist.map((h,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10}}>
              <div style={{width:36,height:36,borderRadius:999,background:"#d1fae5",border:"1px solid #6ee7b7",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:11,fontWeight:700,color:"#059669"}}>PAID</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#059669",fontSize:14}}>{fmtAmt(h.amount,h.currency)}</div>
                <div style={{fontSize:10,color:"#94a3b8",marginTop:1,display:"flex",gap:8}}>
                  <span>{h.user}</span>
                  <span>{fmtD(h.ts)}</span>
                </div>
                {h.note&&<div style={{fontSize:11,color:"#475569",marginTop:2}}>📝 {h.note}</div>}
              </div>
              <div style={{fontSize:10,color:"#94a3b8",fontWeight:600,flexShrink:0}}>#{hist.length-i}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── ASSET HISTORY MODAL ── */
function AssetHistoryModal({assetId, assetName, onClose}){
  const log = getAuditLog().filter(e=>e.entityType==="asset"&&e.entityId===assetId);
  const ACTION_COLOR={create:"#059669",update:"#2563eb",delete:"#dc2626"};
  const ACTION_BG={create:"#f0fdf4",update:"#eff6ff",delete:"#fef2f2"};
  const ACTION_LABEL={create:"Created",update:"Updated",delete:"Deleted"};
  const [expanded,setExpanded]=useState(null);
  const fmtD=(iso)=>{try{const d=new Date(iso);return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})+" "+d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:false});}catch(e){return iso||"";}};
  return(
    <div style={{position:"fixed",inset:0,zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,23,42,.6)",backdropFilter:"blur(10px)",padding:16}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:620,background:"#fff",borderRadius:16,boxShadow:"0 20px 60px rgba(0,0,0,.2)",overflow:"hidden",maxHeight:"85vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"16px 20px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:"#0f172a"}}>Asset History</div>
            <div style={{fontSize:12,color:"#6366f1",fontWeight:600,marginTop:1}}>{assetName} <span style={{color:"#94a3b8",fontWeight:400,fontFamily:"'DM Mono',monospace",fontSize:11}}>· {assetId}</span></div>
          </div>
          <button onClick={onClose} style={{background:"#f1f5f9",border:"1px solid #e2e8f0",color:"#64748b",fontSize:16,cursor:"pointer",padding:"4px 10px",borderRadius:7,fontFamily:"inherit"}}>×</button>
        </div>
        <div style={{overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:8}}>
          {log.length===0&&<div style={{textAlign:"center",padding:"32px 0",color:"#94a3b8",fontSize:13,fontStyle:"italic"}}>No history recorded for this asset yet.</div>}
          {log.map(entry=>{
            const changes=fmtChanges(entry.changes);
            const isOpen=expanded===entry.id;
            return(
              <div key={entry.id} style={{border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden",background:"#fff",transition:"box-shadow .12s"}}
                onMouseOver={e=>e.currentTarget.style.boxShadow="0 2px 10px rgba(0,0,0,.07)"}
                onMouseOut={e=>e.currentTarget.style.boxShadow="none"}>
                <div onClick={()=>setExpanded(isOpen?null:entry.id)}
                  style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                  <div style={{flexShrink:0,padding:"2px 8px",borderRadius:4,background:ACTION_BG[entry.action]||"#f8fafc",border:`1px solid ${ACTION_COLOR[entry.action]||"#e2e8f0"}30`}}>
                    <span style={{fontSize:9,fontWeight:800,letterSpacing:.5,color:ACTION_COLOR[entry.action]||"#64748b",textTransform:"uppercase"}}>{ACTION_LABEL[entry.action]||entry.action}</span>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#0f172a"}}>{entry.action==="create"?"Asset created":entry.action==="delete"?"Asset deleted":`${changes.length} field${changes.length!==1?"s":""} changed`}</div>                    <div style={{fontSize:10,color:"#94a3b8",marginTop:1,display:"flex",gap:8}}>
                      <span>{entry.user||"unknown"}</span>
                      <span>{fmtD(entry.ts)}</span>
                    </div>
                  </div>
                  <span style={{fontSize:10,color:"#94a3b8",flexShrink:0}}>{isOpen?"▲":"▼"}</span>
                </div>
                {isOpen&&changes.length>0&&(
                  <div style={{borderTop:"1px solid #f1f5f9",background:"#f8fafc",padding:"10px 14px",display:"flex",flexDirection:"column",gap:5}}>
                    {changes.map(({field,from,to})=>(
                      <div key={field} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"4px 8px",borderRadius:6,background:"#fff",border:"1px solid #e8edf4",fontSize:11}}>
                        <span style={{minWidth:90,fontWeight:700,color:"#475569",flexShrink:0,textTransform:"uppercase",fontSize:9,letterSpacing:.3,paddingTop:1}}>{field}</span>
                        <span style={{color:"#dc2626",textDecoration:"line-through",maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flexShrink:0}}>{from||"—"}</span>
                        <span style={{color:"#94a3b8",flexShrink:0}}>→</span>
                        <span style={{color:"#059669",maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{to||"—"}</span>
                      </div>
                    ))}
                  </div>
                )}
                {isOpen&&changes.length===0&&(
                  <div style={{borderTop:"1px solid #f1f5f9",background:"#f8fafc",padding:"10px 14px",fontSize:11,color:"#94a3b8",fontStyle:"italic"}}>
                    {entry.action==="create"?"Asset record created.":entry.action==="delete"?"Asset record deleted.":"No detailed field changes recorded."}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SettingsPage({
  depts, setDepts, saveDepts,
  branches, setBranches, saveBranches,
  designations, setDesignations, saveDesignations,
  sims, setSims, saveSims,
  apps, setApps, saveApps,
  assets, setAssets, saveAssets,
  reminderEmail, setReminderEmail,
  ejsService, ejsTemplate, ejsKey,
  autoSentToday, setAutoSentToday,
  displayCurrency, setDisplayCurrency,
  canEdit, showToast,
}){
  const [newVals,setNewVals]=useState({depts:"",branches:"",designations:""});
  const [editing,setEditing]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const [collapsed,setCollapsed]=useState({depts:true,branches:true,designations:true,currency:true,email:true,export:true,audit:true});
  const toggleCollapse=(key)=>setCollapsed(c=>({...c,[key]:!c[key]}));

  const getSectionData=(section)=>{
    if(section==="depts")        return {list:depts,setList:setDepts,saveList:saveDepts,label:"Department",fieldKey:"dept"};
    if(section==="branches")     return {list:branches,setList:setBranches,saveList:saveBranches,label:"Branch",fieldKey:"branch"};
    if(section==="designations") return {list:designations,setList:setDesignations,saveList:saveDesignations,label:"Designation",fieldKey:"designation"};
    return null;
  };

  const addItem=(section)=>{
    const {list,setList,saveList}=getSectionData(section);
    const v=newVals[section].trim();
    if(!v||list.includes(v)) return;
    const updated=[...list,v]; setList(updated); saveList(updated);
    setNewVals(n=>({...n,[section]:""}));
  };

  const commitEdit=()=>{
    if(!confirm||confirm.type!=="edit") return;
    const {section,item,newVal:nv}=confirm;
    const {list,setList,saveList,fieldKey}=getSectionData(section);
    const updated=list.map(x=>x===item?nv:x); setList(updated); saveList(updated);
    // cascade rename
    if(section==="depts"||section==="branches"){
      const rs=sims.map(s=>s[fieldKey]===item?{...s,[fieldKey]:nv}:s); setSims(rs); saveSims(rs);
      const ra=assets.map(a=>a[fieldKey]===item?{...a,[fieldKey]:nv}:a); setAssets(ra); saveAssets(ra);
    }
    setConfirm(null);
  };

  const commitDelete=()=>{
    if(!confirm||confirm.type!=="delete") return;
    const {section,item}=confirm;
    const {list,setList,saveList}=getSectionData(section);
    const updated=list.filter(x=>x!==item); setList(updated); saveList(updated);
    setConfirm(null);
  };

  const CARD={background:"#fff",border:"1px solid #e8edf4",borderRadius:14,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,.04)",marginBottom:20};
  const CARD_HEAD={padding:"16px 22px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",userSelect:"none"};
  const Chevron=({open})=>(
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a0aec0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{transition:"transform .22s",transform:open?"rotate(0deg)":"rotate(-90deg)",flexShrink:0}}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );

  const ListSection=({section})=>{
    const {list,label}=getSectionData(section);
    const open=!collapsed[section];
    return(
      <div style={CARD}>
        <div style={CARD_HEAD} onClick={()=>toggleCollapse(section)}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Chevron open={open}/>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#1a202c"}}>{label}s</div>
              <div style={{fontSize:12,color:"#a0aec0"}}>Add and manage {label.toLowerCase()}s</div>
            </div>
          </div>
        </div>
        {open&&<>
        {/* Add row */}
        <div style={{padding:"12px 22px",borderBottom:"1px solid #f7fafc",display:"flex",gap:8}}>
          <input value={newVals[section]} onChange={e=>setNewVals(n=>({...n,[section]:e.target.value}))}
            onKeyDown={e=>e.key==="Enter"&&addItem(section)}
            placeholder={`New ${label.toLowerCase()}…`}
            style={{flex:1,padding:"8px 12px",border:"1.5px solid #e2e8f0",borderRadius:9,fontSize:13,fontFamily:"inherit",color:"#1a202c",background:"#f7fafc",outline:"none"}}
            onFocus={e=>{e.target.style.borderColor="#667eea";e.target.style.background="#fff";}}
            onBlur={e=>{e.target.style.borderColor="#e2e8f0";e.target.style.background="#f7fafc";}}/>
          <button onClick={()=>addItem(section)}
            style={{padding:"8px 18px",background:"linear-gradient(135deg,#667eea,#764ba2)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            + Add
          </button>
        </div>
        {/* Items */}
        {list.length===0&&<div style={{padding:"24px",textAlign:"center",color:"#a0aec0",fontSize:13}}>No {label.toLowerCase()}s yet</div>}
        {list.map((item,i)=>(
          <div key={item} style={{display:"flex",alignItems:"center",padding:"13px 22px",borderBottom:i<list.length-1?"1px solid #f7fafc":"none",gap:16,transition:"background .1s"}}
            onMouseOver={e=>e.currentTarget.style.background="#fafbff"}
            onMouseOut={e=>e.currentTarget.style.background="transparent"}>
            {editing&&editing.section===section&&editing.item===item?(
              <input value={editing.value} autoFocus
                onChange={e=>setEditing({...editing,value:e.target.value})}
                onKeyDown={e=>{
                  if(e.key==="Enter"){
                    const nv=editing.value.trim();
                    if(nv&&nv!==item&&!list.includes(nv)) setConfirm({type:"edit",section,item,newVal:nv});
                    else setEditing(null);
                  }
                  if(e.key==="Escape") setEditing(null);
                }}
                style={{flex:1,padding:"6px 10px",border:"1.5px solid #667eea",borderRadius:8,fontSize:13,fontFamily:"inherit",color:"#1a202c",background:"#fff",outline:"none",boxShadow:"0 0 0 3px rgba(102,126,234,.12)"}}/>
            ):(
              <>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:600,color:"#1a202c"}}>{item}</div>
                </div>
                <div style={{width:1,height:20,background:"#e2e8f0",flexShrink:0}}/>
              </>
            )}
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              {editing&&editing.section===section&&editing.item===item?(
                <>
                  <button onClick={()=>{
                    const nv=editing.value.trim();
                    if(nv&&nv!==item&&!list.includes(nv)) setConfirm({type:"edit",section,item,newVal:nv});
                    else setEditing(null);
                  }} style={{padding:"5px 14px",background:"#667eea",border:"none",borderRadius:7,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Save</button>
                  <button onClick={()=>setEditing(null)} style={{padding:"5px 12px",background:"#f7fafc",border:"1px solid #e2e8f0",borderRadius:7,color:"#718096",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                </>
              ):(
                <>
                  <button onClick={()=>setEditing({section,item,value:item})}
                    style={{padding:"5px 14px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:7,color:"#2563eb",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Edit</button>
                  <button onClick={()=>setConfirm({type:"delete",section,item})}
                    style={{padding:"5px 14px",background:"#fff5f5",border:"1px solid #fed7d7",borderRadius:7,color:"#e53e3e",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Delete</button>
                </>
              )}
            </div>
          </div>
        ))}
        </>}
      </div>
    );
  };

  return(
    <div>
      <div style={{marginBottom:28}}>
        <h2 style={{fontSize:22,fontWeight:800,color:"#1a202c",letterSpacing:-.4,marginBottom:4}}>Settings</h2>
        <p style={{fontSize:13,color:"#718096"}}>Configure system behaviour and integrations</p>
      </div>

      <ListSection section="depts"/>
      <ListSection section="branches"/>
      <ListSection section="designations"/>

      {/* Display Currency */}
      <div style={{...CARD,marginBottom:20}}>
        <div style={CARD_HEAD} onClick={()=>toggleCollapse("currency")}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Chevron open={!collapsed.currency}/>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#1a202c"}}>Display Currency</div>
              <div style={{fontSize:12,color:"#a0aec0"}}>Set the default currency for cost summaries</div>
            </div>
          </div>
        </div>
        {!collapsed.currency&&<div style={{padding:"20px 22px"}}>
          <select value={displayCurrency} onChange={e=>{setDisplayCurrency(e.target.value);localStorage.setItem("cdDisplayCurrency",e.target.value);showToast(`Currency set to ${e.target.value}`);}}
            style={{padding:"9px 14px",border:"1.5px solid #e2e8f0",borderRadius:9,fontSize:13,fontFamily:"inherit",color:"#1a202c",background:"#f7fafc",outline:"none",cursor:"pointer",minWidth:180}}>
            {ALL_CURRENCIES.map(c=><option key={c} value={c}>{c} ({CURRENCY_SYMBOLS[c]})</option>)}
          </select>
          <div style={{marginTop:10,fontSize:12,color:"#059669",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"8px 12px",display:"inline-block"}}>
            Displaying in {displayCurrency} ({CURRENCY_SYMBOLS[displayCurrency]})
          </div>
        </div>}
      </div>

      {/* Email & Reminders */}
      <div style={{...CARD,marginBottom:20}}>
        <div style={CARD_HEAD} onClick={()=>toggleCollapse("email")}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Chevron open={!collapsed.email}/>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#1a202c"}}>Email & Reminders</div>
              <div style={{fontSize:12,color:"#a0aec0"}}>Configure billing reminder notifications via EmailJS</div>
            </div>
          </div>
          <span style={{fontSize:11,color:ejsService&&ejsTemplate&&ejsKey&&reminderEmail?"#059669":"#f87171",fontWeight:700,background:ejsService&&ejsTemplate&&ejsKey&&reminderEmail?"#f0fdf4":"#fff5f5",border:`1px solid ${ejsService&&ejsTemplate&&ejsKey&&reminderEmail?"#bbf7d0":"#fecaca"}`,borderRadius:99,padding:"2px 10px"}}>
            {ejsService&&ejsTemplate&&ejsKey&&reminderEmail?"Active":"Inactive"}
          </span>
        </div>
        {!collapsed.email&&<div style={{padding:"20px 22px",display:"flex",flexDirection:"column",gap:14}}>
          <div>
            <label style={{display:"block",fontSize:11,fontWeight:700,color:"#718096",marginBottom:6,textTransform:"uppercase",letterSpacing:.4}}>Recipient Email</label>
            <input value={reminderEmail} onChange={e=>{setReminderEmail(e.target.value);localStorage.setItem("cdReminderEmail",e.target.value);}}
              placeholder="your@email.com"
              style={{width:"100%",maxWidth:360,padding:"9px 12px",border:"1.5px solid #e2e8f0",borderRadius:9,fontSize:13,fontFamily:"inherit",color:"#1a202c",background:"#f7fafc",outline:"none",boxSizing:"border-box"}}
              onFocus={e=>{e.target.style.borderColor="#667eea";e.target.style.background="#fff";}}
              onBlur={e=>{e.target.style.borderColor="#e2e8f0";e.target.style.background="#f7fafc";}}/>
          </div>
          <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"14px 16px"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#718096",textTransform:"uppercase",letterSpacing:.4,marginBottom:10}}>Config.js Status</div>
            {[{label:"Service ID",val:ejsService},{label:"Template ID",val:ejsTemplate},{label:"Public Key",val:ejsKey?"••••••••":""}].map(({label,val})=>(
              <div key={label} style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                <span style={{fontSize:11,fontWeight:600,color:"#718096",minWidth:90,flexShrink:0}}>{label}</span>
                <span style={{fontSize:11,fontFamily:"monospace",color:val?"#059669":"#f87171",padding:"2px 8px",background:val?"#f0fdf4":"#fff5f5",border:`1px solid ${val?"#bbf7d0":"#fecaca"}`,borderRadius:6}}>{val||"Not set"}</span>
              </div>
            ))}
          </div>
          {autoSentToday&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11,color:"#059669"}}>
            <span>Auto-sent today</span>
            <button onClick={()=>{localStorage.removeItem("cdAutoSent");setAutoSentToday("");showToast("Reset — will re-send on next load");}} style={{padding:"3px 10px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:6,color:"#718096",fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>Reset flag</button>
          </div>}
        </div>}
      </div>

      {/* Export */}
      <div style={{...CARD,marginBottom:20}}>
        <div style={CARD_HEAD} onClick={()=>toggleCollapse("export")}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Chevron open={!collapsed.export}/>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#1a202c"}}>Export Data</div>
              <div style={{fontSize:12,color:"#a0aec0"}}>Download records as Excel (.xlsx) files</div>
            </div>
          </div>
        </div>
        {!collapsed.export&&<div style={{padding:"16px 22px",display:"flex",flexDirection:"column",gap:10}}>
          {[
            {label:"All Data",desc:"SIM Plans + App Subs + Assets in one file",fn:()=>{exportAllXLSX(sims,apps,assets);showToast("Exported all data");}},
            {label:"SIM Plans",desc:"All SIM records with billing details",fn:()=>{exportSimXLSX(sims);showToast("SIM Plans exported");}},
            {label:"App Subscriptions",desc:"All app subscription records",fn:()=>{exportAppXLSX(apps);showToast("App Subs exported");}},
            {label:"Assets",desc:"All hardware and asset records",fn:()=>{exportAssetXLSX(assets);showToast("Assets exported");}},
          ].map(({label,desc,fn})=>(
            <div key={label} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 16px",background:"#f8fafc",border:"1px solid #e8edf4",borderRadius:10}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:"#1a202c"}}>{label}</div>
                <div style={{fontSize:12,color:"#a0aec0"}}>{desc}</div>
              </div>
              <button onClick={fn} style={{padding:"7px 18px",background:"#fff",border:"1.5px solid #667eea",borderRadius:9,color:"#667eea",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",flexShrink:0,transition:"all .15s"}}
                onMouseOver={e=>{e.currentTarget.style.background="#667eea";e.currentTarget.style.color="#fff";}}
                onMouseOut={e=>{e.currentTarget.style.background="#fff";e.currentTarget.style.color="#667eea";}}>
                Export
              </button>
            </div>
          ))}
        </div>}
      </div>

      {/* Audit Log */}
      <div style={CARD}>
        <div style={CARD_HEAD} onClick={()=>toggleCollapse("audit")}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Chevron open={!collapsed.audit}/>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#1a202c"}}>Audit Log</div>
              <div style={{fontSize:12,color:"#a0aec0"}}>All data changes with timestamps</div>
            </div>
          </div>
        </div>
        {!collapsed.audit&&<div style={{padding:"4px 0"}}><AuditLogPanel/></div>}
      </div>

      {/* Confirm dialog */}
      {confirm&&(
        <div style={{position:"fixed",inset:0,zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,23,42,.45)",backdropFilter:"blur(6px)"}}>
          <div style={{width:"100%",maxWidth:360,background:"#fff",borderRadius:14,boxShadow:"0 20px 60px rgba(0,0,0,.2)",overflow:"hidden",border:"1px solid #e2e8f0"}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:"18px 20px 14px",borderBottom:"1px solid #f1f5f9",background:confirm.type==="delete"?"#fff5f5":"#f0f4ff"}}>
              <div style={{fontWeight:800,fontSize:15,color:"#1a202c"}}>{confirm.type==="delete"?"Confirm Delete":"Confirm Rename"}</div>
            </div>
            <div style={{padding:"16px 20px 20px"}}>
              {confirm.type==="delete"
                ?<p style={{fontSize:13,color:"#475569",lineHeight:1.5}}>Delete <strong>"{confirm.item}"</strong>? Records using it keep the old value.</p>
                :<p style={{fontSize:13,color:"#475569",lineHeight:1.5}}>Rename <strong>"{confirm.item}"</strong> → <strong style={{color:"#667eea"}}>"{confirm.newVal}"</strong>? SIMs and Assets will auto-update.</p>
              }
              <div style={{display:"flex",gap:8,marginTop:16}}>
                <button onClick={()=>{setConfirm(null);setEditing(null);}} style={{flex:1,padding:"10px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,color:"#718096",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                <button onClick={confirm.type==="delete"?commitDelete:commitEdit}
                  style={{flex:1,padding:"10px",border:"none",borderRadius:10,background:confirm.type==="delete"?"#e53e3e":"#667eea",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  {confirm.type==="delete"?"Delete":"Rename"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* kept for reference but no longer rendered — settings is now a full page tab */
function SettingsPanel({onClose,
  depts, setDepts, saveDepts,
  branches, setBranches, saveBranches,
  designations, setDesignations, saveDesignations,
  sims, setSims, saveSims,
  apps, setApps, saveApps,
  assets, setAssets, saveAssets,
  reminderEmail, setReminderEmail,
  ejsService, setEjsService,
  ejsTemplate, setEjsTemplate,
  ejsKey, setEjsKey,
  autoSentToday, setAutoSentToday,
  displayCurrency, setDisplayCurrency,
  canEdit,
  showToast,
  initialTab
}){
  const [tab, setTab] = useState(initialTab||"depts");
  const [newVal, setNewVal] = useState("");
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [showKey, setShowKey] = useState(false);

  const INP2={padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,
    fontFamily:"inherit",color:"#0f172a",outline:"none",background:"#f8fafc",flex:1};

  const tabs = [
    {v:"depts",       label:"Departments",  icon:""},
    {v:"branches",    label:"Branches",     icon:""},
    {v:"designations",label:"Designations", icon:""},
    {v:"display",     label:"Currency",     icon:""},
    {v:"export",      label:"Export",       icon:""},
    {v:"audit",       label:"Audit Log",    icon:""},
    {v:"email",       label:"Email",        icon:""},
  ];

  const getList = () => {
    if(tab==="depts") return depts;
    if(tab==="branches") return branches;
    if(tab==="designations") return designations;
    return [];
  };
  const setList = (v) => {
    if(tab==="depts"){ setDepts(v); saveDepts(v); }
    else if(tab==="branches"){ setBranches(v); saveBranches(v); }
    else if(tab==="designations"){ setDesignations(v); saveDesignations(v); }
  };

  const fieldKey = tab==="depts"?"dept":tab==="branches"?"branch":"designation";
  const label = tab==="depts"?"Department":tab==="branches"?"Branch":"Designation";

  /* cascade rename for dept/branch */
  const cascadeRename = (oldVal, nv) => {
    if(tab==="depts" || tab==="branches"){
      const renameSims = sims.map(s => s[fieldKey]===oldVal ? {...s,[fieldKey]:nv} : s);
      const renameAssets = assets.map(a => a[fieldKey]===oldVal ? {...a,[fieldKey]:nv} : a);
      setSims(renameSims); saveSims(renameSims);
      setAssets(renameAssets); saveAssets(renameAssets);
    }
  };

  const addItem = () => {
    const v = newVal.trim(); if(!v||getList().includes(v)) return;
    setList([...getList(), v]); setNewVal("");
  };
  const requestDelete = (item) => setConfirm({type:"delete",item});
  const requestEdit = (item) => setEditing({item,value:item});
  const commitEdit = (item, nv) => {
    const trimmed = nv.trim();
    if(!trimmed||trimmed===item||getList().includes(trimmed)){setEditing(null);return;}
    setConfirm({type:"edit",item,newVal:trimmed}); setEditing(null);
  };
  const confirmAction = () => {
    if(!confirm) return;
    if(confirm.type==="delete"){
      setList(getList().filter(x=>x!==confirm.item));
    } else {
      setList(getList().map(x=>x===confirm.item?confirm.newVal:x));
      cascadeRename(confirm.item, confirm.newVal);
    }
    setConfirm(null);
  };

  const list = getList();
  const ICONS = {depts:"",branches:"",designations:""};
  const icon = ICONS[tab]||"•";

  return(
    <div style={{position:"fixed",inset:0,zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,23,42,.55)",backdropFilter:"blur(10px)"}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:520,background:"#fff",border:"1px solid #e2e8f0",borderRadius:16,boxShadow:"0 16px 50px rgba(0,0,0,.18)",overflow:"hidden",maxHeight:"90vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid #f1f5f9",background:"#f8fafc",flexShrink:0}}>
          <span style={{fontWeight:800,fontSize:15,color:"#0f172a"}}>Settings</span>
          <button onClick={onClose} style={{background:"#f1f5f9",border:"1px solid #e2e8f0",color:"#64748b",fontSize:16,cursor:"pointer",padding:"4px 10px",borderRadius:7,fontFamily:"inherit"}}>×</button>
        </div>

        {/* Tab bar */}
        <div style={{display:"flex",borderBottom:"1px solid #f1f5f9",background:"#f8fafc",flexShrink:0,overflowX:"auto"}}>
          {tabs.map(({v,label:l})=>(
            <button key={v} onClick={()=>{setTab(v);setEditing(null);setConfirm(null);setNewVal("");}}
              style={{flex:1,minWidth:90,padding:"11px 6px",border:"none",borderBottom:tab===v?"2px solid #1e3a5f":"2px solid transparent",
                background:"transparent",color:tab===v?"#1e3a5f":"#94a3b8",fontSize:12,fontWeight:700,
                cursor:"pointer",fontFamily:"inherit",transition:"all .15s",whiteSpace:"nowrap"}}>
              {l}
            </button>
          ))}
        </div>

        <div style={{overflowY:"auto",flex:1}}>
          {/* LIST TABS */}
          {(tab==="depts"||tab==="branches"||tab==="designations")&&(
            <div style={{padding:20}}>
              <div style={{display:"flex",gap:8,marginBottom:16}}>
                <input value={newVal} onChange={e=>setNewVal(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&addItem()}
                  placeholder={`New ${label}…`} style={INP2} autoFocus/>
                <button onClick={addItem}
                  style={{padding:"9px 18px",background:"#1e3a5f",border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                  + Add
                </button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:360,overflowY:"auto"}}>
                {list.length===0&&<div style={{textAlign:"center",padding:"24px 0",color:"#94a3b8",fontSize:13,fontStyle:"italic"}}>No {label.toLowerCase()}s yet</div>}
                {list.map(item=>(
                  <div key={item} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:9}}>
                    <span style={{fontSize:14,flexShrink:0}}>{icon}</span>
                    {editing&&editing.item===item?(
                      <input value={editing.value} autoFocus
                        onChange={e=>setEditing({...editing,value:e.target.value})}
                        onKeyDown={e=>{if(e.key==="Enter")commitEdit(item,editing.value);if(e.key==="Escape")setEditing(null);}}
                        style={{...INP2,fontSize:13,fontWeight:600,padding:"5px 9px",background:"#fff",border:"1.5px solid #1e3a5f",flex:1}}/>
                    ):(
                      <span style={{flex:1,fontSize:13,fontWeight:600,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item}</span>
                    )}
                    {editing&&editing.item===item?(
                      <div style={{display:"flex",gap:5,flexShrink:0}}>
                        <button onClick={()=>commitEdit(item,editing.value)} style={{padding:"4px 11px",background:"rgba(30,58,95,.1)",border:"1px solid rgba(30,58,95,.3)",borderRadius:6,color:"#1e3a5f",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>✓ Save</button>
                        <button onClick={()=>setEditing(null)} style={{padding:"4px 9px",background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:6,color:"#64748b",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
                      </div>
                    ):(
                      <div style={{display:"flex",gap:5,flexShrink:0}}>
                        <button onClick={()=>requestEdit(item)} style={{padding:"4px 11px",background:"rgba(99,102,241,.07)",border:"1px solid rgba(99,102,241,.25)",borderRadius:6,color:"#6366f1",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>✎ Edit</button>
                        <button onClick={()=>requestDelete(item)} style={{padding:"4px 10px",background:"rgba(220,38,38,.06)",border:"1px solid rgba(220,38,38,.2)",borderRadius:6,color:"#dc2626",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Del</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DISPLAY TAB */}
          {tab==="display"&&(
            <div style={{padding:20}}>
              <div style={{fontSize:13,color:"#64748b",marginBottom:16,lineHeight:1.6}}>
                Set your preferred display currency for the dashboard. Asset prices are stored in their original currency but displayed in your chosen currency on charts and summaries.
              </div>
              <div>
                <label style={{...LBL}}>Preferred Display Currency</label>
                <select 
                  value={displayCurrency} 
                  onChange={e=>{
                    setDisplayCurrency(e.target.value);
                    localStorage.setItem("cdDisplayCurrency",e.target.value);
                    showToast(`Display currency set to ${e.target.value}`);
                  }} 
                  style={{...INP,cursor:"pointer"}}>
                  {ALL_CURRENCIES.map(c=>(
                    <option key={c} value={c}>{c} ({CURRENCY_SYMBOLS[c]})</option>
                  ))}
                </select>
              </div>
              <div style={{fontSize:11,color:"#10b981",fontWeight:700,marginTop:12,padding:"8px 12px",background:"#f0fdf4",borderRadius:8,border:"1px solid #bbf7d0"}}>
                All amounts will display in {displayCurrency} ({CURRENCY_SYMBOLS[displayCurrency]}) format
              </div>
            </div>
          )}

          {/* EMAIL TAB */}
          {tab==="email"&&(
            <div style={{padding:20}}>
              <div style={{fontSize:13,color:"#64748b",marginBottom:16,lineHeight:1.6}}>
                Auto-sends billing reminders when bills are due within 3 days. Fires once per day on page load.
                EmailJS credentials (Service ID, Template ID, Public Key) are read from <code style={{fontFamily:"monospace",fontSize:12,background:"#f1f5f9",padding:"1px 5px",borderRadius:4}}>config.js</code> — keep that file private.
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div>
                  <label style={{...LBL}}>Recipient Email</label>
                  <input value={reminderEmail} onChange={e=>{setReminderEmail(e.target.value);localStorage.setItem("cdReminderEmail",e.target.value);}} placeholder="your@email.com" style={INP}/>
                  <div style={{fontSize:10,color:"#94a3b8",marginTop:5}}>Billing reminders will be sent to this address.</div>
                </div>

                {/* Config status — read-only display */}
                <div style={{marginTop:8,padding:"12px 14px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10}}>
                  <div style={{fontSize:10,fontWeight:700,color:"#64748b",letterSpacing:.5,textTransform:"uppercase",marginBottom:10}}>Config.js Status</div>
                  {[
                    {label:"Service ID", val:ejsService, placeholder:"Not set in config.js"},
                    {label:"Template ID", val:ejsTemplate, placeholder:"Not set in config.js"},
                    {label:"Public Key", val:ejsKey ? "••••••••••••" : "", placeholder:"Not set in config.js"},
                  ].map(({label,val,placeholder})=>(
                    <div key={label} style={{display:"flex",alignItems:"center",gap:10,marginBottom:7}}>
                      <span style={{fontSize:10,fontWeight:600,color:"#64748b",minWidth:88,flexShrink:0}}>{label}</span>
                      <span style={{flex:1,fontSize:11,fontFamily:"monospace",
                        color:val?"#059669":"#f87171",
                        padding:"3px 8px",background:val?"#f0fdf4":"#fff5f5",
                        border:`1px solid ${val?"#bbf7d0":"#fecaca"}`,borderRadius:6}}>
                        {val||placeholder}
                      </span>
                      <span style={{fontSize:11,fontWeight:700,color:val?"#059669":"#f87171"}}>{val?"OK":"—"}</span>
                    </div>
                  ))}
                  <div style={{fontSize:9.5,color:"#94a3b8",marginTop:8,lineHeight:1.5}}>
                    To update these, edit <strong>config.js</strong>: set <code style={{fontFamily:"monospace"}}>EJS_SERVICE</code>, <code style={{fontFamily:"monospace"}}>EJS_TEMPLATE</code>, <code style={{fontFamily:"monospace"}}>EJS_KEY</code>. Get free keys at <span style={{color:"#2563eb"}}>emailjs.com</span>. Template needs: <code style={{fontFamily:"monospace",fontSize:9}}>to_email, subject, message</code>
                  </div>
                </div>
              </div>
              {ejsService&&ejsTemplate&&ejsKey&&reminderEmail
                ?<div style={{fontSize:11,color:"#059669",fontWeight:700,marginTop:12,padding:"8px 12px",background:"#f0fdf4",borderRadius:8,border:"1px solid #bbf7d0"}}>Email reminders active — fires once per day on load</div>
                :<div style={{fontSize:11,color:"#f87171",fontWeight:600,marginTop:12,padding:"8px 12px",background:"#fff5f5",borderRadius:8,border:"1px solid #fecaca"}}>⚠️ Complete all 4 fields (3 in config.js + recipient email above) to activate reminders</div>
              }

              {/* ── Test Email Button ── */}
              <div style={{marginTop:16,padding:"14px 16px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10}}>
                <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:6}}>🧪 Test Email Delivery</div>
                <div style={{fontSize:11,color:"#64748b",marginBottom:10,lineHeight:1.5}}>
                  Sends a test email to <strong>{reminderEmail||"(no address set)"}</strong> to verify your EmailJS config is working.
                </div>
                {(()=>{
                  const ready = ejsService&&ejsTemplate&&ejsKey&&reminderEmail;
                  return(
                    <button disabled={!ready} onClick={()=>{
                      if(typeof emailjs==="undefined"){showToast("EmailJS library not loaded",false);return;}
                      emailjs.init({publicKey:ejsKey});
                      const testMsg = `Hi,\n\nThis is a test email from Vardhamanglobal Inventory Management System.\n\nIf you received this, your EmailJS configuration is working correctly!\n\nService ID: ${ejsService}\nTemplate ID: ${ejsTemplate}\nRecipient: ${reminderEmail}\nSent at: ${new Date().toLocaleString()}\n\nRegards,\nVardhamanglobal IM`;
                      emailjs.send(ejsService, ejsTemplate, {to_email:reminderEmail, subject:"VGI: Test Email ✓", message:testMsg})
                        .then(()=>showToast(`✓ Test email sent to ${reminderEmail}`))
                        .catch(e=>showToast("✗ Email failed: "+(e.text||e.message||String(e)),false));
                    }}
                      style={{padding:"9px 18px",background:ready?"#2563eb":"#f1f5f9",border:"none",borderRadius:9,
                        color:ready?"#fff":"#94a3b8",fontSize:12,fontWeight:700,cursor:ready?"pointer":"not-allowed",
                        fontFamily:"inherit",opacity:ready?1:.65,boxShadow:ready?"0 2px 8px rgba(37,99,235,.25)":"none"}}>
                      Send Test Email
                    </button>
                  );
                })()}
                {!(ejsService&&ejsTemplate&&ejsKey&&reminderEmail)&&(
                  <div style={{marginTop:8,fontSize:10,color:"#f87171"}}>
                    {!reminderEmail?"→ Set a recipient email above":""}
                    {!ejsService||!ejsTemplate||!ejsKey?" → Configure EJS_SERVICE, EJS_TEMPLATE, EJS_KEY in config.js":""}
                  </div>
                )}
              </div>

              {/* ── Auto-send status ── */}
              {autoSentToday&&(
                <div style={{marginTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:10,color:"#059669"}}>Auto-sent today</span>
                  <button onClick={()=>{localStorage.removeItem("cdAutoSent");setAutoSentToday("");showToast("Reset · will re-send on next load");}}
                    style={{padding:"4px 10px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:7,color:"#94a3b8",fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>
                    Reset flag
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── EXPORT TAB ── */}
          {tab==="export"&&(
            <div style={{padding:20}}>
              <div style={{fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:6}}>Export Data</div>
              <div style={{fontSize:12,color:"#64748b",marginBottom:20,lineHeight:1.6}}>
                Download all data as Excel files. Each sheet exports independently.
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {[
                  {label:"All Data (.xlsx)",desc:"SIM Plans + App Subs + Assets in one file",color:"#1d4ed8",fn:()=>{exportAllXLSX(sims,apps,assets);showToast("Exported all data");}},
                  {label:"SIM Plans (.xlsx)",desc:"All SIM records with billing details",color:"#0369a1",fn:()=>{exportSimXLSX(sims);showToast("SIM Plans exported");}},
                  {label:"App Subscriptions (.xlsx)",desc:"All app subscription records",color:"#0369a1",fn:()=>{exportAppXLSX(apps);showToast("App Subs exported");}},
                  {label:"Assets (.xlsx)",desc:"All hardware and asset records",color:"#0369a1",fn:()=>{exportAssetXLSX(assets);showToast("Assets exported");}},
                ].map(({label,desc,color,fn})=>(
                  <button key={label} onClick={fn} disabled={!canEdit}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",
                      background:canEdit?color+"10":"#f8fafc",
                      border:`1px solid ${canEdit?color+"25":"#e2e8f0"}`,
                      borderRadius:10,cursor:canEdit?"pointer":"not-allowed",
                      fontFamily:"inherit",textAlign:"left",width:"100%",opacity:canEdit?1:.55,
                      transition:"all .15s"}}
                    onMouseOver={e=>{if(canEdit)e.currentTarget.style.background=color+"20";}}
                    onMouseOut={e=>{if(canEdit)e.currentTarget.style.background=color+"10";}}>
                    <div style={{width:36,height:36,borderRadius:9,background:color+"18",
                      display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:11,fontWeight:700,color:color}}>XLS</div>
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:canEdit?color:"#94a3b8"}}>{label}</div>
                      <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{desc}</div>
                    </div>
                  </button>
                ))}
              </div>
              {!canEdit&&<div style={{marginTop:16,fontSize:11,color:"#f87171",background:"#fff5f5",border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px"}}>Editor role required to export data</div>}
            </div>
          )}

          {/* ── AUDIT LOG TAB ── */}
          {tab==="audit"&&(
            <AuditLogPanel/>
          )}

        </div>
      </div>

      {/* Confirm Dialog */}
      {confirm&&(
        <div style={{position:"fixed",inset:0,zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,23,42,.45)",backdropFilter:"blur(6px)"}} onClick={e=>e.stopPropagation()}>
          <div style={{width:"100%",maxWidth:360,background:"#fff",borderRadius:14,boxShadow:"0 20px 60px rgba(0,0,0,.2)",overflow:"hidden",border:"1px solid #e2e8f0"}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:"18px 20px 14px",borderBottom:"1px solid #f1f5f9",background:confirm.type==="delete"?"#fff5f5":"#f0f4ff"}}>
              
              <div style={{fontWeight:800,fontSize:15,color:"#0f172a"}}>{confirm.type==="delete"?`Delete ${label}?`:`Rename ${label}?`}</div>
            </div>
            <div style={{padding:"16px 20px 20px"}}>
              {confirm.type==="delete"
                ?<p style={{fontSize:13,color:"#475569",lineHeight:1.5}}>Delete <strong>"{confirm.item}"</strong>? Records using it will keep the old value.</p>
                :<p style={{fontSize:13,color:"#475569",lineHeight:1.5}}>Rename <strong>"{confirm.item}"</strong> → <strong style={{color:"#2563eb"}}>"{confirm.newVal}"</strong>. SIMs and Assets will auto-update.</p>
              }
              <div style={{display:"flex",gap:8,marginTop:14}}>
                <button onClick={()=>setConfirm(null)} style={{flex:1,padding:"10px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,color:"#64748b",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                <button onClick={confirmAction} style={{flex:1,padding:"10px",border:"none",borderRadius:10,background:confirm.type==="delete"?"#dc2626":"#1e3a5f",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  {confirm.type==="delete"?"Yes, Delete":"Yes, Rename"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── SPEND TREND CHART ──────────────────────────────────────────── */
function SpendTrendChart({sims,apps,displayCurrency}){
  const uc=displayCurrency||"INR";
  const now=new Date();
  const months=Array.from({length:6},(_,i)=>{
    const d=new Date(now.getFullYear(),now.getMonth()+i,1);
    return{label:d.toLocaleDateString("en-IN",{month:"short",year:"2-digit"}),year:d.getFullYear(),month:d.getMonth()};
  });
  const monthlyData=months.map(({year,month})=>{
    const byCur={};
    sims.forEach(s=>{
      if(!s.amount||!s.currency) return;
      if(s.nextBillingDate){
        const bd=new Date(s.nextBillingDate);
        if(year*12+month>=bd.getFullYear()*12+bd.getMonth()) byCur[s.currency]=(byCur[s.currency]||0)+Number(s.amount);
      } else byCur[s.currency]=(byCur[s.currency]||0)+Number(s.amount);
    });
    apps.forEach(a=>{
      if(!a.amount||!a.currency) return;
      const seats=a.billingType==="perUser"?(Array.isArray(a.assignedTo)?a.assignedTo.length:1):1;
      const total=Number(a.amount)*seats;
      if(a.billingCycle==="yearly"){
        if(a.nextBillingDate){const bd=new Date(a.nextBillingDate);if(bd.getFullYear()===year&&bd.getMonth()===month) byCur[a.currency]=(byCur[a.currency]||0)+total;}
      } else {
        if(a.nextBillingDate){const bd=new Date(a.nextBillingDate);if(year*12+month>=bd.getFullYear()*12+bd.getMonth()) byCur[a.currency]=(byCur[a.currency]||0)+total;}
        else byCur[a.currency]=(byCur[a.currency]||0)+total;
      }
    });
    return byCur;
  });
  const totals=monthlyData.map(byCur=>Object.entries(byCur).reduce((s,[c,v])=>s+convertAmt(v,c,uc),0));
  const maxTotal=Math.max(...totals,1);
  const W=540,H=140,PL=8,PR=8,PT=28,PB=24;
  const chartW=W-PL-PR,chartH=H-PT-PB;
  const step=chartW/6;
  const bw=step*0.55;
  const BARS=["#6366f1","#818cf8","#a5b4fc","#818cf8","#a5b4fc","#818cf8"];
  if(totals.every(t=>t===0)) return React.createElement("div",{style:{fontSize:12,color:"#94a3b8",fontStyle:"italic",padding:"12px 0"}},"No billing data yet");
  return React.createElement("div",null,
    React.createElement("svg",{width:"100%",viewBox:`0 0 ${W} ${H}`,style:{overflow:"visible"}},
      months.map(({label},i)=>{
        const barH=Math.max((totals[i]/maxTotal)*chartH,totals[i]>0?4:0);
        const x=PL+i*step+(step-bw)/2;
        const y=PT+chartH-barH;
        const isNow=i===0;
        return React.createElement("g",{key:label},
          React.createElement("rect",{x,y,width:bw,height:barH,rx:5,fill:isNow?"#6366f1":"#c7d2fe"}),
          React.createElement("text",{x:x+bw/2,y:PT+chartH+16,textAnchor:"middle",fontSize:10,fill:"#94a3b8",fontWeight:isNow?700:400},label),
          totals[i]>0&&React.createElement("text",{x:x+bw/2,y:y-5,textAnchor:"middle",fontSize:9,fill:isNow?"#4f46e5":"#64748b",fontWeight:600},fmtAmt(totals[i],uc))
        );
      })
    ),
    React.createElement("div",{style:{display:"flex",gap:12,flexWrap:"wrap",marginTop:4}},
      [...new Set(sims.map(s=>s.currency).concat(apps.map(a=>a.currency)))].filter(c=>monthlyData[0]&&(monthlyData[0][c]||0)>0).map(c=>
        React.createElement("span",{key:c,style:{fontSize:11,color:"#64748b"}},`${c}: ${fmtAmt(monthlyData[0][c]||0,c)}/mo`)
      )
    )
  );
}

/* ── HANDOVER LOG MODAL ──────────────────────────────────────────── */
function HandoverLogModal({assetId,assetName,handovers,onClose}){
  const logs=[...handovers].filter(h=>h.assetId===assetId).sort((a,b)=>new Date(b.ts)-new Date(a.ts));
  return React.createElement("div",{style:{position:"fixed",inset:0,zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,23,42,.6)",backdropFilter:"blur(10px)"},onClick:onClose},
    React.createElement("div",{style:{background:"#fff",borderRadius:16,padding:0,maxWidth:420,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,.2)",overflow:"hidden"},onClick:e=>e.stopPropagation()},
      React.createElement("div",{style:{padding:"20px 24px 16px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",justifyContent:"space-between"}},
        React.createElement("div",null,
          React.createElement("div",{style:{fontSize:15,fontWeight:800,color:"#0f172a"}},"Handover Log"),
          React.createElement("div",{style:{fontSize:12,color:"#6366f1",fontWeight:600}},assetName)
        ),
        React.createElement("button",{onClick:onClose,style:{width:30,height:30,borderRadius:8,border:"1px solid #e2e8f0",background:"#f8fafc",cursor:"pointer",fontFamily:"inherit",fontSize:16,color:"#64748b",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}},"×")
      ),
      React.createElement("div",{style:{maxHeight:380,overflowY:"auto",padding:"16px 24px"}},
        logs.length===0
          ?React.createElement("div",{style:{textAlign:"center",color:"#94a3b8",fontSize:13,padding:"32px 0",fontStyle:"italic"}},"No handovers recorded yet")
          :React.createElement("div",{style:{display:"flex",flexDirection:"column",gap:0}},
            logs.map((h,i)=>React.createElement("div",{key:h.id,style:{display:"flex",gap:14,paddingBottom:i<logs.length-1?16:0}},
              React.createElement("div",{style:{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}},
                React.createElement("div",{style:{width:10,height:10,borderRadius:"50%",background:"#6366f1",border:"2px solid #e0e7ff",marginTop:3,flexShrink:0}}),
                i<logs.length-1&&React.createElement("div",{style:{width:2,flex:1,background:"#e0e7ff",margin:"4px auto 0",minHeight:20}})
              ),
              React.createElement("div",{style:{flex:1,paddingBottom:i<logs.length-1?0:0}},
                React.createElement("div",{style:{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}},
                  React.createElement("span",{style:{fontSize:12,color:h.from?"#64748b":"#94a3b8",fontStyle:h.from?"normal":"italic"}},h.from||"Unassigned"),
                  React.createElement("svg",{width:14,height:14,viewBox:"0 0 24 24",fill:"none",stroke:"#94a3b8",strokeWidth:2},React.createElement("path",{strokeLinecap:"round",strokeLinejoin:"round",d:"M5 12h14m-6-6 6 6-6 6"})),
                  React.createElement("span",{style:{fontSize:12,fontWeight:700,color:h.to?"#0f172a":"#94a3b8",fontStyle:h.to?"normal":"italic"}},h.to||"Unassigned")
                ),
                h.toDept&&React.createElement("div",{style:{fontSize:11,color:"#6366f1",fontWeight:600,marginTop:2}},h.toDept),
                React.createElement("div",{style:{fontSize:10,color:"#94a3b8",marginTop:3}},
                  new Date(h.ts).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})+" · "+
                  new Date(h.ts).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true})+" · by "+h.by
                )
              )
            ))
          )
      )
    )
  );
}

/* ── QR CODE MODAL ─────────────────────────────────────────────── */
function AssetQRModal({asset, onClose}){
  if(!asset) return null;
  const qrData = encodeURIComponent("Vardhamanglobal Asset\nID: "+asset.id+"\nName: "+asset.name+"\nSerial: "+(asset.serialNo||"—")+"\nAssigned: "+(asset.assignedTo||"Unassigned")+"\nDept: "+(asset.dept||"—"));
  const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data="+qrData+"&margin=10";
  return(
    React.createElement("div",{style:{position:"fixed",inset:0,zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,23,42,.6)",backdropFilter:"blur(10px)"},onClick:onClose},
      React.createElement("div",{style:{background:"#fff",borderRadius:16,padding:28,maxWidth:300,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,.2)",textAlign:"center"},onClick:e=>e.stopPropagation()},
        React.createElement("div",{style:{fontSize:15,fontWeight:800,color:"#0f172a",marginBottom:4}},"Asset QR Code"),
        React.createElement("div",{style:{fontSize:12,color:"#6366f1",fontWeight:600,marginBottom:2}},asset.name),
        React.createElement("div",{style:{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#94a3b8",marginBottom:16}},asset.id+(asset.serialNo?" · "+asset.serialNo:"")),
        React.createElement("img",{src:qrUrl,alt:"QR Code",style:{width:220,height:220,borderRadius:8,border:"1px solid #e2e8f0"}}),
        React.createElement("div",{style:{fontSize:10,color:"#94a3b8",marginTop:10,marginBottom:16}},"Scan to view asset details"),
        React.createElement("div",{style:{display:"flex",gap:8}},
          React.createElement("a",{href:qrUrl,download:"QR_"+asset.id+".png",style:{flex:1,padding:"10px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,color:"#059669",fontSize:12,fontWeight:700,textDecoration:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:5}},"⬇ Download"),
          React.createElement("button",{onClick:onClose,style:{flex:1,padding:"10px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,color:"#64748b",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}},"Close")
        )
      )
    )
  );
}

/* ── DEPT BAR CHART ─────────────────────────────────────────────── */
function DeptBarChart({assets}){
  const deptMap={};
  assets.forEach(a=>{ const d=a.dept||"Unassigned"; deptMap[d]=(deptMap[d]||0)+1; });
  const entries=Object.entries(deptMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if(entries.length===0) return React.createElement("div",{style:{fontSize:12,color:"#94a3b8",fontStyle:"italic",padding:"12px 0"}},"No asset data yet");
  const max=Math.max(...entries.map(e=>e[1]));
  const COLORS=["#6366f1","#2563eb","#0891b2","#059669","#d97706","#dc2626","#7c3aed","#db2777"];
  return React.createElement("div",{style:{display:"flex",flexDirection:"column",gap:8}},
    entries.map(([dept,count],i)=>React.createElement("div",{key:dept,style:{display:"flex",alignItems:"center",gap:10}},
      React.createElement("div",{style:{fontSize:11,color:"#475569",fontWeight:600,width:90,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flexShrink:0}},dept),
      React.createElement("div",{style:{flex:1,height:20,background:"#f1f5f9",borderRadius:6,overflow:"hidden"}},
        React.createElement("div",{style:{width:((count/max)*100)+"%",height:"100%",background:COLORS[i%COLORS.length],borderRadius:6,display:"flex",alignItems:"center",paddingLeft:6}},
          React.createElement("span",{style:{fontSize:10,color:"#fff",fontWeight:700}},count)
        )
      ),
      React.createElement("div",{style:{fontSize:11,color:"#94a3b8",width:20,flexShrink:0,textAlign:"right"}},count)
    ))
  );
}

/* ── MONTHLY SPEND CARD ─────────────────────────────────────────── */
function MonthlySpendCard({sims,apps}){
  const byCur={};
  sims.forEach(s=>{ if(s.amount&&s.currency){ byCur[s.currency]=(byCur[s.currency]||0)+Number(s.amount); }});
  apps.forEach(a=>{
    if(!a.amount||!a.currency) return;
    const seats=a.billingType==="perUser"?(Array.isArray(a.assignedTo)?a.assignedTo.length:1):1;
    byCur[a.currency]=(byCur[a.currency]||0)+Number(a.amount)*seats;
  });
  const entries=Object.entries(byCur).filter(([,v])=>v>0);
  if(entries.length===0) return React.createElement("div",{style:{fontSize:12,color:"#94a3b8",fontStyle:"italic"}},"No spend data");
  return React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:12}},
    entries.map(([cur,val])=>React.createElement("div",{key:cur,style:{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"10px 16px",minWidth:120}},
      React.createElement("div",{style:{fontSize:10,color:"#64748b",fontWeight:700,letterSpacing:.4,textTransform:"uppercase",marginBottom:4}},cur+"/month"),
      React.createElement("div",{style:{fontFamily:"'DM Mono',monospace",fontSize:22,fontWeight:800,color:"#0f172a"}},fmtAmt(val,cur))
    ))
  );
}


function Dashboard({sims, apps, assets, canEdit, displayCurrency, onAssignSim, onAssignAsset}){
  const [page, setPage] = useState("sims");
  const [assignTarget, setAssignTarget] = useState(null);
  const [assignName, setAssignName] = useState("");
  const [assignDept, setAssignDept] = useState("");
  const [assignBranch, setAssignBranch] = useState("");
  const [astAssignTarget, setAstAssignTarget] = useState(null);
  const [astAssignName, setAstAssignName] = useState("");
  const [astAssignDept, setAstAssignDept] = useState("");
  const [astAssignBranch, setAstAssignBranch] = useState("");

  const simAssigned   = sims.filter(s=>s.employee&&s.employee.trim());
  const simUnassigned = sims.filter(s=>!s.employee||!s.employee.trim());

  // Total asset purchase value converted to the universal display currency
  const uc = displayCurrency || "INR";
  const totalAssetValueConverted = assets.reduce((sum,a)=>{
    const amt = parseFloat(a.purchaseAmount)||0;
    return sum + convertAmt(amt, a.currency, uc);
  }, 0);

  const knownTypes = DASH_TYPES.filter(t=>assets.some(a=>a.type===t));
  const customTypes = [...new Set(assets.map(a=>a.type))].filter(t=>!DASH_TYPES.includes(t));
  const allTypes = [...knownTypes,...customTypes];

  const typeStats = allTypes.map(type=>{
    const all = assets.filter(a=>a.type===type);
    return { type, items:all,
      assigned: all.filter(a=>a.status==="assigned"),
      unassigned: all.filter(a=>a.status!=="assigned") };
  });

  const totalAssigned   = assets.filter(a=>a.status==="assigned").length;
  const totalUnassigned = assets.filter(a=>a.status!=="assigned").length;

  const EmptyMsg = ({msg})=>(
    <div style={{padding:"20px 0",textAlign:"center",color:"#94a3b8",fontSize:13,fontStyle:"italic"}}>{msg}</div>
  );

  return(
    <>
      {/* Quick-Assign Modal */}
      {assignTarget&&(
        <div style={{position:"fixed",inset:0,zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,23,42,.55)",backdropFilter:"blur(10px)"}} onClick={()=>setAssignTarget(null)}>
          <div style={{width:"100%",maxWidth:360,background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,padding:24,boxShadow:"0 10px 40px rgba(0,0,0,.15)"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:800,color:"#0f172a",marginBottom:4}}>Assign SIM</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"#2563eb",marginBottom:16}}>{assignTarget.number} · {assignTarget.carrier}</div>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
              {[
                {label:"Employee Name *",val:assignName,set:setAssignName,ph:"Full name",auto:true},
                {label:"Department",val:assignDept,set:setAssignDept,ph:"e.g. Engineering, Sales"},
                {label:"Branch",val:assignBranch,set:setAssignBranch,ph:"e.g. Mumbai HQ, Delhi Office"},
              ].map(({label,val,set,ph,auto})=>(
                <div key={label}>
                  <div style={{fontSize:10,color:"#64748b",fontWeight:700,letterSpacing:.6,textTransform:"uppercase",marginBottom:5}}>{label}</div>
                  <input value={val} onChange={e=>set(e.target.value)} placeholder={ph} autoFocus={auto}
                    style={{width:"100%",padding:"10px 12px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,color:"#1e293b",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{setAssignTarget(null);setAssignName("");setAssignDept("");setAssignBranch("");}} style={{flex:1,padding:"10px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,color:"#64748b",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
              <button disabled={!assignName.trim()} onClick={()=>{if(!assignName.trim())return;onAssignSim(assignTarget.id,assignName.trim(),assignDept.trim(),assignBranch.trim());setAssignTarget(null);setAssignName("");setAssignDept("");setAssignBranch("");}}
                style={{flex:2,padding:"10px",background:assignName.trim()?"#2563eb":"#f8fafc",border:"none",borderRadius:10,color:assignName.trim()?"#fff":"#94a3b8",fontSize:13,fontWeight:700,cursor:assignName.trim()?"pointer":"not-allowed",fontFamily:"inherit",transition:"all .2s"}}>
                ✓ Assign SIM
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Hardware Quick-Assign Modal */}
      {astAssignTarget&&(
        <div style={{position:"fixed",inset:0,zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(15,23,42,.55)",backdropFilter:"blur(10px)"}} onClick={()=>setAstAssignTarget(null)}>
          <div style={{width:"100%",maxWidth:360,background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,padding:24,boxShadow:"0 10px 40px rgba(0,0,0,.15)"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:800,color:"#0f172a",marginBottom:4}}>Assign Hardware</div>
            <div style={{fontSize:12,color:"#6366f1",marginBottom:4,fontWeight:600}}>{astAssignTarget.name}</div>
            {astAssignTarget.serialNo&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#94a3b8",marginBottom:12}}>S/N / IMEI: {astAssignTarget.serialNo}</div>}
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
              {[
                {label:"Assign To *",val:astAssignName,set:setAstAssignName,ph:"Employee full name",auto:true},
                {label:"Department",val:astAssignDept,set:setAstAssignDept,ph:"e.g. Engineering, Sales"},
                {label:"Branch",val:astAssignBranch,set:setAstAssignBranch,ph:"e.g. Mumbai HQ, Delhi Office"},
              ].map(({label,val,set,ph,auto})=>(
                <div key={label}>
                  <div style={{fontSize:10,color:"#64748b",fontWeight:700,letterSpacing:.6,textTransform:"uppercase",marginBottom:5}}>{label}</div>
                  <input value={val} onChange={e=>set(e.target.value)} placeholder={ph} autoFocus={auto}
                    style={{width:"100%",padding:"10px 12px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,color:"#1e293b",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{setAstAssignTarget(null);setAstAssignName("");setAstAssignDept("");setAstAssignBranch("");}} style={{flex:1,padding:"10px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,color:"#64748b",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
              <button disabled={!astAssignName.trim()} onClick={()=>{if(!astAssignName.trim())return;onAssignAsset(astAssignTarget.id,astAssignName.trim(),astAssignDept.trim(),astAssignBranch.trim());setAstAssignTarget(null);setAstAssignName("");setAstAssignDept("");setAstAssignBranch("");}}
                style={{flex:2,padding:"10px",background:astAssignName.trim()?"#2563eb":"#f8fafc",border:"none",borderRadius:10,color:astAssignName.trim()?"#fff":"#94a3b8",fontSize:13,fontWeight:700,cursor:astAssignName.trim()?"pointer":"not-allowed",fontFamily:"inherit",transition:"all .2s"}}>
                ✓ Assign Asset
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:22,fontWeight:800,color:"#0f172a",letterSpacing:-.5,marginBottom:4}}>Inventory Dashboard</h1>
        <p style={{fontSize:13,color:"#64748b"}}>Assigned &amp; unassigned overview across SIMs and hardware</p>
      </div>

      {/* ── KPI Row ── */}
      {(()=>{
        const byCur={};
        sims.forEach(s=>{if(s.amount&&s.currency) byCur[s.currency]=(byCur[s.currency]||0)+Number(s.amount);});
        apps.forEach(a=>{
          if(!a.amount||!a.currency) return;
          const seats=a.billingType==="perUser"?(Array.isArray(a.assignedTo)?a.assignedTo.length:1):1;
          byCur[a.currency]=(byCur[a.currency]||0)+Number(a.amount)*seats;
        });
        const spendLines=Object.entries(byCur).filter(([,v])=>v>0).map(([c,v])=>fmtAmt(v,c)).join("  ·  ")||"—";
        const kpis=[
          {label:"Total Assets",val:assets.length,sub:`${assets.filter(a=>a.status==="assigned").length} assigned · ${assets.filter(a=>a.status!=="assigned").length} available`,accent:"#6366f1"},
          {label:"Active SIMs",val:sims.filter(s=>s.status==="active").length,sub:`${sims.length} total plans`,accent:"#0284c7"},
          {label:"App Subscriptions",val:apps.length,sub:`${apps.reduce((n,a)=>n+(Array.isArray(a.assignedTo)?a.assignedTo.length:1),0)} total seats`,accent:"#10b981"},
          {label:"Monthly Spend",val:spendLines,sub:"SIMs + apps combined",accent:"#f59e0b",mono:true},
        ];
        return(
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:20}}>
            {kpis.map(({label,val,sub,accent,mono})=>(
              <div key={label} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,.05)",borderTop:`3px solid ${accent}`}}>
                <div style={{fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:.3,marginBottom:10,textTransform:"uppercase"}}>{label}</div>
                <div style={{fontSize:mono?16:26,fontWeight:800,color:"#0f172a",fontFamily:mono?"'DM Mono',monospace":"inherit",letterSpacing:mono?-.3:-.5,lineHeight:1.1,marginBottom:6}}>{val}</div>
                <div style={{fontSize:11,color:"#94a3b8"}}>{sub}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Spend Trend Chart ── */}
      <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 4px rgba(0,0,0,.05)",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:"#374151"}}>6-Month Spend Projection</div>
          <div style={{fontSize:10,color:"#94a3b8"}}>SIMs + App subscriptions</div>
        </div>
        <SpendTrendChart sims={sims} apps={apps} displayCurrency={displayCurrency}/>
      </div>

      {/* ── Secondary row: dept chart + asset value ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:16,marginBottom:28}}>
        <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 4px rgba(0,0,0,.05)"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:14}}>Assets by Department</div>
          <DeptBarChart assets={assets}/>
        </div>
        <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 4px rgba(0,0,0,.05)"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:6}}>Total Asset Value</div>
          <div style={{fontSize:11,color:"#94a3b8",marginBottom:16}}>All assets · converted to {uc}</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:32,fontWeight:800,color:"#0f172a",letterSpacing:-.5,lineHeight:1}}>
            {fmtAmt(totalAssetValueConverted, uc)}
          </div>
          <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between"}}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:16,fontWeight:800,color:"#0f172a"}}>{assets.length}</div>
              <div style={{fontSize:10,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.3,marginTop:2}}>Total</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:16,fontWeight:800,color:"#10b981"}}>{assets.filter(a=>a.status==="assigned").length}</div>
              <div style={{fontSize:10,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.3,marginTop:2}}>Assigned</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:16,fontWeight:800,color:"#f59e0b"}}>{assets.filter(a=>a.status!=="assigned").length}</div>
              <div style={{fontSize:10,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.3,marginTop:2}}>Available</div>
            </div>
          </div>
          <div style={{marginTop:10,fontSize:10,color:"#cbd5e1",fontStyle:"italic"}}>Exchange rates are approximate</div>
        </div>
      </div>

      {/* Sub-nav */}
      <div style={{display:"flex",gap:0,marginBottom:20,background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:4,width:"fit-content"}}>
        {[
          {v:"sims",   label:"SIM Plans",      count:sims.length},
          {v:"assets", label:"Hardware Assets", count:assets.length},
        ].map(({v,label,count})=>(
          <button key={v} onClick={()=>setPage(v)}
            style={{padding:"8px 18px",borderRadius:7,border:"none",cursor:"pointer",fontFamily:"inherit",
              fontSize:13,fontWeight:600,transition:"all .15s",
              background:page===v?"#6366f1":"transparent",
              color:page===v?"#fff":"#64748b"}}>
            {label}
            <span style={{marginLeft:7,fontSize:11,fontWeight:700,
              background:page===v?"rgba(255,255,255,.25)":"#f1f5f9",
              color:page===v?"#fff":"#94a3b8",
              borderRadius:6,padding:"1px 7px"}}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* ══ SIM Plans section ══ */}
      {page==="sims"&&(()=>{
        const [dashSimFilter,setDashSimFilter]=React.useState("all");
        const [dashSimQ,setDashSimQ]=React.useState("");
        const allSims=[...sims].sort((a,b)=>(a.employee||"").localeCompare(b.employee||""));
        const filtered=allSims.filter(s=>{
          if(dashSimFilter==="assigned"&&(!s.employee||!s.employee.trim())) return false;
          if(dashSimFilter==="pool"&&(s.employee&&s.employee.trim())) return false;
          if(dashSimQ){const q=dashSimQ.toLowerCase();return (s.employee||"").toLowerCase().includes(q)||(s.number||"").includes(q)||(s.dept||"").toLowerCase().includes(q);}
          return true;
        });
        return(
          <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:16,overflow:"hidden",boxShadow:"0 1px 6px rgba(0,0,0,.05)"}}>
            {/* Header */}
            <div style={{padding:"16px 20px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{fontWeight:700,fontSize:14,color:"#0f172a"}}>SIM Plans</div>
              <div style={{display:"flex",gap:4,background:"#f1f5f9",borderRadius:8,padding:3}}>
                {[{v:"all",l:`All (${sims.length})`},{v:"assigned",l:`Assigned (${simAssigned.length})`},{v:"pool",l:`Pool (${simUnassigned.length})`}].map(({v,l})=>(
                  <button key={v} onClick={()=>setDashSimFilter(v)}
                    style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,transition:"all .12s",
                      background:dashSimFilter===v?"#fff":"transparent",
                      color:dashSimFilter===v?"#0f172a":"#94a3b8",
                      boxShadow:dashSimFilter===v?"0 1px 3px rgba(0,0,0,.1)":"none"}}>
                    {l}
                  </button>
                ))}
              </div>
              <input value={dashSimQ} onChange={e=>setDashSimQ(e.target.value)} placeholder="Quick search…"
                style={{marginLeft:"auto",padding:"6px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,fontFamily:"inherit",color:"#1a202c",background:"#f8fafc",outline:"none",width:200}}
                onFocus={e=>{e.target.style.borderColor="#667eea";e.target.style.background="#fff";}}
                onBlur={e=>{e.target.style.borderColor="#e2e8f0";e.target.style.background="#f8fafc";}}/>
            </div>
            {/* Table */}
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:"#f8fafc"}}>
                    {["Employee","Dept","Carrier · Plan","Number","SIM Status","Assignment",...(canEdit?[""]:[])].map((h,i)=>(
                      <th key={i} style={{padding:"10px 16px",textAlign:"left",fontSize:10,fontWeight:700,color:"#94a3b8",letterSpacing:.5,textTransform:"uppercase",borderBottom:"1px solid #e8edf2",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length===0&&<tr><td colSpan={canEdit?7:6} style={{padding:"40px",textAlign:"center",color:"#94a3b8",fontSize:13}}>No records found</td></tr>}
                  {filtered.map((s,i)=>{
                    const assigned=!!(s.employee&&s.employee.trim());
                    return(
                      <tr key={s.id} style={{borderBottom:"1px solid #f8fafc",background:i%2===0?"#fff":"#fafbff"}}
                        onMouseOver={e=>e.currentTarget.style.background="#f0f4ff"}
                        onMouseOut={e=>e.currentTarget.style.background=i%2===0?"#fff":"#fafbff"}>
                        <td style={{padding:"13px 16px"}}>
                          {assigned
                            ?<div style={{fontWeight:600,color:"#0f172a",fontSize:13}}>{s.employee}</div>
                            :<div style={{color:"#94a3b8",fontStyle:"italic",fontSize:12}}>— Unassigned —</div>}
                        </td>
                        <td style={{padding:"13px 16px",fontSize:12,color:"#64748b"}}>{s.dept||"—"}</td>
                        <td style={{padding:"13px 16px",fontSize:12,color:"#374151"}}>{s.carrier} · {s.planName}</td>
                        <td style={{padding:"13px 16px",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,color:"#0f172a",letterSpacing:.5}}>{s.number||"—"}</td>
                        <td style={{padding:"13px 16px"}}><Pill text={s.status||"active"} color={STA_CLR[s.status]||"#94a3b8"}/></td>
                        <td style={{padding:"13px 16px"}}>
                          <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:600,
                            color:assigned?"#059669":"#94a3b8"}}>
                            <span style={{width:6,height:6,borderRadius:"50%",background:assigned?"#10b981":"#cbd5e1",flexShrink:0}}/>
                            {assigned?"Assigned":"Pool"}
                          </span>
                        </td>
                        {canEdit&&<td style={{padding:"13px 16px"}}>
                          <button onClick={()=>{setAssignTarget(s);setAssignName(s.employee||"");setAssignDept(s.dept||"");setAssignBranch(s.branch||"");}}
                            style={{padding:"5px 13px",background:"transparent",border:"1px solid #e2e8f0",borderRadius:7,color:"#374151",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",transition:"all .12s"}}
                            onMouseOver={e=>{e.currentTarget.style.borderColor="#667eea";e.currentTarget.style.color="#667eea";}}
                            onMouseOut={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#374151";}}>
                            {assigned?"Reassign":"Assign"}
                          </button>
                        </td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ══ Hardware Assets section ══ */}
      {page==="assets"&&(()=>{
        const [dashAstFilter,setDashAstFilter]=React.useState("all");
        const [dashAstQ,setDashAstQ]=React.useState("");
        const allAssets=[...assets].sort((a,b)=>(a.type||"").localeCompare(b.type||"")||(a.name||"").localeCompare(b.name||""));
        const filtered=allAssets.filter(a=>{
          const isAssigned=a.status==="assigned";
          if(dashAstFilter==="assigned"&&!isAssigned) return false;
          if(dashAstFilter==="pool"&&isAssigned) return false;
          if(dashAstQ){const q=dashAstQ.toLowerCase();return (a.name||"").toLowerCase().includes(q)||(a.assignedTo||"").toLowerCase().includes(q)||(a.serialNo||"").toLowerCase().includes(q)||(a.dept||"").toLowerCase().includes(q);}
          return true;
        });
        return(
          <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:16,overflow:"hidden",boxShadow:"0 1px 6px rgba(0,0,0,.05)"}}>
            {/* Header */}
            <div style={{padding:"16px 20px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{fontWeight:700,fontSize:14,color:"#0f172a"}}>Hardware Assets</div>
              <div style={{display:"flex",gap:4,background:"#f1f5f9",borderRadius:8,padding:3}}>
                {[{v:"all",l:`All (${assets.length})`},{v:"assigned",l:`Assigned (${totalAssigned})`},{v:"pool",l:`Available (${totalUnassigned})`}].map(({v,l})=>(
                  <button key={v} onClick={()=>setDashAstFilter(v)}
                    style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,transition:"all .12s",
                      background:dashAstFilter===v?"#fff":"transparent",
                      color:dashAstFilter===v?"#0f172a":"#94a3b8",
                      boxShadow:dashAstFilter===v?"0 1px 3px rgba(0,0,0,.1)":"none"}}>
                    {l}
                  </button>
                ))}
              </div>
              <input value={dashAstQ} onChange={e=>setDashAstQ(e.target.value)} placeholder="Quick search…"
                style={{marginLeft:"auto",padding:"6px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,fontFamily:"inherit",color:"#1a202c",background:"#f8fafc",outline:"none",width:200}}
                onFocus={e=>{e.target.style.borderColor="#667eea";e.target.style.background="#fff";}}
                onBlur={e=>{e.target.style.borderColor="#e2e8f0";e.target.style.background="#f8fafc";}}/>
            </div>
            {/* Table */}
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:"#f8fafc"}}>
                    {["Type","Asset Name","Serial / ID","Assigned To","Department","Condition","Status",...(canEdit?[""]:[])].map((h,i)=>(
                      <th key={i} style={{padding:"10px 16px",textAlign:"left",fontSize:10,fontWeight:700,color:"#94a3b8",letterSpacing:.5,textTransform:"uppercase",borderBottom:"1px solid #e8edf2",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length===0&&<tr><td colSpan={canEdit?8:7} style={{padding:"40px",textAlign:"center",color:"#94a3b8",fontSize:13}}>No records found</td></tr>}
                  {filtered.map((a,i)=>{
                    const isAssigned=a.status==="assigned";
                    return(
                      <tr key={a.id} style={{borderBottom:"1px solid #f8fafc",background:i%2===0?"#fff":"#fafbff"}}
                        onMouseOver={e=>e.currentTarget.style.background="#f0f4ff"}
                        onMouseOut={e=>e.currentTarget.style.background=i%2===0?"#fff":"#fafbff"}>
                        <td style={{padding:"13px 16px",fontSize:11,color:"#94a3b8",fontWeight:700,textTransform:"uppercase",letterSpacing:.4,whiteSpace:"nowrap"}}>{a.type||"—"}</td>
                        <td style={{padding:"13px 16px"}}>
                          <div style={{fontWeight:600,color:"#0f172a",fontSize:13}}>{a.name||"—"}</div>
                          {(a.specs&&a.specs.length>0)&&<div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>{a.specs.slice(0,2).map(s=>s.key+": "+s.val).join(" · ")}</div>}
                        </td>
                        <td style={{padding:"13px 16px",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#64748b"}}>{a.serialNo||a.id||"—"}</td>
                        <td style={{padding:"13px 16px",fontSize:12,fontWeight:600,color:isAssigned?"#0f172a":"#94a3b8",fontStyle:isAssigned?"normal":"italic"}}>{a.assignedTo||"—"}</td>
                        <td style={{padding:"13px 16px",fontSize:12,color:"#64748b"}}>{a.dept||"—"}</td>
                        <td style={{padding:"13px 16px",fontSize:12,color:"#64748b",textTransform:"capitalize"}}>{a.condition||"—"}</td>
                        <td style={{padding:"13px 16px"}}>
                          <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:600,color:isAssigned?"#059669":"#94a3b8"}}>
                            <span style={{width:6,height:6,borderRadius:"50%",background:isAssigned?"#10b981":"#cbd5e1",flexShrink:0}}/>
                            {isAssigned?"Assigned":"Available"}
                          </span>
                        </td>
                        {canEdit&&<td style={{padding:"13px 16px"}}>
                          <button onClick={()=>{setAstAssignTarget(a);setAstAssignName(a.assignedTo||"");setAstAssignDept(a.dept||"");setAstAssignBranch(a.branch||"");}}
                            style={{padding:"5px 13px",background:"transparent",border:"1px solid #e2e8f0",borderRadius:7,color:"#374151",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",transition:"all .12s"}}
                            onMouseOver={e=>{e.currentTarget.style.borderColor="#667eea";e.currentTarget.style.color="#667eea";}}
                            onMouseOut={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#374151";}}>
                            {isAssigned?"Reassign":"Assign"}
                          </button>
                        </td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </>
  );
}

/* ── AUTH (multi-user, plain-text passwords) ── */
/* Users are defined in config.js as USERS array with plain-text passwords */
const getConfigUsers = () => {
  const cfg = window.CORPDESK_CONFIG || {};
  if (cfg.USERS && Array.isArray(cfg.USERS) && cfg.USERS.length > 0) return cfg.USERS;
  return [];
};
/* Fetch role for an email from Firebase appUsers */
async function fetchRoleByEmail(email){
  if(!FB_ROOT||!email) return null;
  try{
    const res=await fetch(`${FB_ROOT}/config/appUsers.json`);
    const d=await res.json();
    if(!d) return null;
    const list=Array.isArray(d)?d:Object.values(d).filter(Boolean);
    const found=list.find(u=>u.email&&u.email.toLowerCase()===email.toLowerCase());
    if(!found) return null;
    // Bootstrap: if no admin exists yet, treat any editor as admin so they can promote themselves
    const hasAdmin=list.some(u=>u.role==="admin");
    if(!hasAdmin && found.role==="editor") return "admin";
    return found.role;
  }catch(e){ return null; }
}

/* Map Firebase Auth error codes to readable messages */
function fbErrMsg(code){
  const map={
    "auth/invalid-email":"Invalid email address.",
    "auth/user-not-found":"No account found for this email.",
    "auth/wrong-password":"Incorrect password.",
    "auth/invalid-credential":"Incorrect email or password.",
    "auth/too-many-requests":"Too many attempts. Try again later.",
    "auth/email-already-in-use":"This email is already registered.",
    "auth/weak-password":"Password must be at least 6 characters.",
    "auth/popup-closed-by-user":"Google sign-in was cancelled.",
    "auth/network-request-failed":"Network error. Check your connection.",
  };
  return map[code]||"Authentication error. Please try again.";
}

function LoginModal({onLogin}){
  const[email,setEmail]=useState("");
  const[pw,setPw]=useState("");
  const[err,setErr]=useState("");
  const[show,setShow]=useState(false);
  const[loading,setLoading]=useState(false);
  const[mode,setMode]=useState("signin"); // "signin" | "reset"
  const[resetSent,setResetSent]=useState(false);

  const handleGoogle=async()=>{
    setErr("");setLoading(true);
    try{
      const cred=await signInWithPopup(auth,googleProvider);
      const role=await fetchRoleByEmail(cred.user.email);
      if(!role){ await signOut(auth); setErr("Your Google account is not authorized. Contact administrator."); setLoading(false); return; }
      onLogin(role,cred.user.email,cred.user.displayName||cred.user.email);
    }catch(e){ setErr(fbErrMsg(e.code)); }
    finally{ setLoading(false); }
  };

  const handleEmailAuth=async()=>{
    if(!email.trim()){setErr("Email is required");return;}
    if(mode==="reset"){
      setLoading(true);
      try{ await sendPasswordResetEmail(auth,email); setResetSent(true); setErr(""); }
      catch(e){ setErr(fbErrMsg(e.code)); }
      finally{ setLoading(false); }
      return;
    }
    if(!pw){setErr("Password is required");return;}
    setLoading(true);
    setErr("");
    try{
      const cred=await signInWithEmailAndPassword(auth,email,pw);
      const role=await fetchRoleByEmail(cred.user.email);
      if(!role){ await signOut(auth); setErr("Your account is not authorized. Contact administrator."); setLoading(false); return; }
      onLogin(role,cred.user.email,cred.user.displayName||cred.user.email);
    }catch(e){ setErr(fbErrMsg(e.code)); }
    finally{ setLoading(false); }
  };

  const INP_STYLE={width:"100%",padding:"11px 14px 11px 38px",border:"1.5px solid #e8edf4",borderRadius:12,fontSize:14,color:"#1a202c",background:"#f7f9fc",outline:"none",fontFamily:"inherit",boxSizing:"border-box",transition:"border .15s,box-shadow .15s"};
  const focusInp=e=>{e.target.style.borderColor="#667eea";e.target.style.background="#fff";e.target.style.boxShadow="0 0 0 3px rgba(102,126,234,0.12)";};
  const blurInp=e=>{e.target.style.borderColor="#e8edf4";e.target.style.background="#f7f9fc";e.target.style.boxShadow="none";};

  return(
    <div style={{minHeight:"100vh",background:"#eef0f8",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <style>{`
        @media(max-width:640px){.lg-left-col{display:none!important}}
        @keyframes lgCardIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
      `}</style>

      <div style={{display:"flex",borderRadius:24,overflow:"hidden",boxShadow:"0 24px 64px rgba(80,60,140,0.18)",animation:"lgCardIn .45s cubic-bezier(.22,1,.36,1) both",width:"100%",maxWidth:820}}>

        {/* LEFT */}
        <div className="lg-left-col" style={{width:300,flexShrink:0,background:"linear-gradient(145deg,#667eea 0%,#764ba2 100%)",position:"relative",overflow:"hidden",padding:"48px 36px",display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
          {/* Blobs */}
          <div style={{position:"absolute",top:-60,left:-40,width:280,height:280,borderRadius:"50%",background:"rgba(255,255,255,0.07)"}}/>
          <div style={{position:"absolute",top:30,right:-70,width:200,height:200,borderRadius:"50%",border:"1.5px solid rgba(255,255,255,0.1)"}}/>
          <div style={{position:"absolute",bottom:-80,left:20,width:320,height:320,borderRadius:"50%",background:"rgba(80,40,160,0.3)"}}/>
          <div style={{position:"absolute",bottom:60,right:-30,width:180,height:180,borderRadius:"50%",background:"rgba(255,255,255,0.05)"}}/>
          {/* Dot grid top-left */}
          <svg style={{position:"absolute",top:20,left:20,opacity:.22}} width="80" height="80" viewBox="0 0 80 80">
            {[0,1,2,3,4].map(r=>[0,1,2,3,4].map(c=><circle key={`${r}-${c}`} cx={c*16+8} cy={r*16+8} r="2" fill="white"/>))}
          </svg>
          {/* Dot grid bottom-right */}
          <svg style={{position:"absolute",bottom:20,right:20,opacity:.18}} width="64" height="64" viewBox="0 0 64 64">
            {[0,1,2,3].map(r=>[0,1,2,3].map(c=><circle key={`${r}-${c}`} cx={c*16+8} cy={r*16+8} r="2" fill="white"/>))}
          </svg>
          {/* Floating accent circles */}
          <div style={{position:"absolute",top:48,right:48,width:32,height:32,borderRadius:"50%",border:"2px solid rgba(255,255,255,0.35)"}}/>
          <div style={{position:"absolute",top:96,right:112,width:8,height:8,borderRadius:"50%",background:"#67e8f9"}}/>
          <div style={{position:"absolute",top:144,left:80,width:12,height:12,borderRadius:"50%",background:"rgba(255,255,255,0.25)"}}/>
          {/* Vertical pill shapes */}
          <div style={{position:"absolute",top:56,left:"50%",display:"flex",gap:6,transform:"translateX(-50%)"}}>
            <div style={{width:10,height:40,borderRadius:999,background:"rgba(255,255,255,0.35)"}}/>
            <div style={{width:10,height:64,borderRadius:999,background:"rgba(255,255,255,0.2)",marginTop:8}}/>
          </div>
          {/* ✕ mark */}
          <div style={{position:"absolute",bottom:144,left:48,fontSize:20,color:"rgba(255,255,255,0.25)",fontWeight:300,userSelect:"none"}}>✕</div>
          {/* Sphere at bottom */}
          <div style={{position:"absolute",bottom:24,left:"50%",transform:"translateX(-50%)"}}>
            <div style={{width:128,height:128,borderRadius:"50%",background:"linear-gradient(135deg,rgba(103,232,249,0.5) 0%,rgba(99,102,241,0.3) 50%,rgba(124,58,237,0.25) 100%)",border:"1px solid rgba(255,255,255,0.18)",position:"relative"}}>
              <div style={{position:"absolute",inset:12,borderRadius:"50%",background:"linear-gradient(135deg,rgba(255,255,255,0.12) 0%,transparent 100%)"}}/>
            </div>
          </div>
          {/* Content */}
          <div style={{position:"relative",zIndex:2}}>
            <div style={{fontSize:26,fontWeight:900,color:"#fff",letterSpacing:-.5,lineHeight:1.2,marginBottom:8}}>Vardhamanglobal</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.65)",fontWeight:400,lineHeight:1.6}}>Inventory &amp; asset<br/>management platform</div>
          </div>
          <div style={{position:"relative",zIndex:2}}/>
        </div>

        {/* RIGHT — form */}
        <div style={{flex:1,background:"#fff",padding:"44px 44px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
          <div style={{marginBottom:24,display:"flex",justifyContent:"center"}}>
            <img src="https://i.ibb.co/nMdGqhKR/image.png" alt="VGI" style={{width:64,height:64,objectFit:"contain"}} onError={e=>{e.target.style.display="none";}}/>
          </div>

          {mode==="reset"?(
            <>
              <h2 style={{fontSize:20,fontWeight:800,color:"#1a202c",textAlign:"center",marginBottom:4}}>Reset password</h2>
              <p style={{fontSize:13,color:"#a0aec0",textAlign:"center",marginBottom:24}}>We'll send a reset link to your email</p>
              {resetSent?(
                <div style={{padding:"14px",background:"#f0fdf4",border:"1px solid #86efac",borderRadius:10,textAlign:"center",color:"#166534",fontSize:13,fontWeight:600,marginBottom:16}}>
                  ✓ Reset email sent — check your inbox
                </div>
              ):(
                <>
                  <div style={{marginBottom:14}}>
                    <label style={{display:"block",fontSize:11,fontWeight:700,color:"#718096",letterSpacing:.6,textTransform:"uppercase",marginBottom:6}}>Email</label>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",display:"flex",pointerEvents:"none"}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a0aec0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></span>
                      <input value={email} onChange={e=>{setEmail(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&handleEmailAuth()} placeholder="your@email.com" type="email" autoFocus style={INP_STYLE} onFocus={focusInp} onBlur={blurInp}/>
                    </div>
                  </div>
                  {err&&<div style={{marginBottom:12,padding:"9px 13px",background:"#fff5f5",border:"1px solid #fed7d7",borderRadius:8,color:"#c53030",fontSize:12,fontWeight:600}}>{err}</div>}
                  <button onClick={handleEmailAuth} disabled={loading} style={{width:"100%",padding:"12px",background:"linear-gradient(135deg,#667eea,#764ba2)",border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:12}}>
                    {loading?<><span style={{width:13,height:13,border:"2px solid rgba(255,255,255,.35)",borderTopColor:"#fff",borderRadius:999,animation:"spin .7s linear infinite",display:"inline-block",marginRight:8}}/>Sending…</>:"Send reset link"}
                  </button>
                </>
              )}
              <button onClick={()=>{setMode("signin");setErr("");setResetSent(false);}} style={{background:"none",border:"none",color:"#667eea",fontSize:13,cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>← Back to sign in</button>
            </>
          ):(
            <>
              <h2 style={{fontSize:22,fontWeight:800,color:"#1a202c",textAlign:"center",letterSpacing:-.4,marginBottom:4}}>
                Hello! Welcome back
              </h2>
              <p style={{fontSize:13,color:"#a0aec0",textAlign:"center",marginBottom:20}}>
                Sign in to your workspace
              </p>

              {/* Google SSO */}
              <button onClick={handleGoogle} disabled={loading}
                style={{width:"100%",padding:"11px",background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:12,fontSize:14,fontWeight:600,color:"#1a202c",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:16,transition:"all .15s",boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}
                onMouseOver={e=>{e.currentTarget.style.borderColor="#667eea";e.currentTarget.style.boxShadow="0 2px 8px rgba(102,126,234,.15)";}}
                onMouseOut={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,.06)";}}>
                <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v8.51h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.14z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/></svg>
                Continue with Google
              </button>

              {/* Divider */}
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                <div style={{flex:1,height:1,background:"#e2e8f0"}}/>
                <span style={{fontSize:11,color:"#a0aec0",fontWeight:500}}>or sign in with email</span>
                <div style={{flex:1,height:1,background:"#e2e8f0"}}/>
              </div>

              {/* Email / Username */}
              <div style={{marginBottom:14}}>
                <label style={{display:"block",fontSize:11,fontWeight:700,color:"#718096",letterSpacing:.6,textTransform:"uppercase",marginBottom:6}}>Email</label>
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",display:"flex",pointerEvents:"none"}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a0aec0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></span>
                  <input value={email} onChange={e=>{setEmail(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&handleEmailAuth()} placeholder="your@email.com" type="email" autoFocus style={INP_STYLE} onFocus={focusInp} onBlur={blurInp}/>
                </div>
              </div>

              {/* Password */}
              <div style={{marginBottom:err?12:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <label style={{fontSize:11,fontWeight:700,color:"#718096",letterSpacing:.6,textTransform:"uppercase"}}>Password</label>
                  {mode==="signin"&&<button onClick={()=>{setMode("reset");setErr("");}} style={{background:"none",border:"none",color:"#667eea",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>Forgot password?</button>}
                </div>
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",display:"flex",pointerEvents:"none"}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a0aec0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
                  <input type={show?"text":"password"} value={pw} onChange={e=>{setPw(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&handleEmailAuth()} placeholder="••••••••"
                    style={{...INP_STYLE,padding:"11px 42px 11px 38px",borderColor:err?"#fc8181":"#e8edf4"}} onFocus={focusInp} onBlur={blurInp}/>
                  <button onClick={()=>setShow(s=>!s)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",color:"#a0aec0"}}
                    onMouseOver={e=>e.currentTarget.style.color="#718096"} onMouseOut={e=>e.currentTarget.style.color="#a0aec0"}>
                    {show
                      ?<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      :<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                </div>
              </div>

              {err&&<div style={{marginBottom:14,padding:"9px 13px",background:"#fff5f5",border:"1px solid #fed7d7",borderRadius:8,color:"#c53030",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:7}}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {err}
              </div>}

              <button onClick={handleEmailAuth} disabled={loading}
                style={{width:"100%",padding:"12px",background:loading?"#818cf8":"#4f46e5",border:"none",borderRadius:12,color:"#fff",fontSize:14,fontWeight:600,cursor:loading?"not-allowed":"pointer",fontFamily:"inherit",boxShadow:loading?"none":"0 4px 14px rgba(79,70,229,0.35)",transition:"all .18s",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:14}}
                onMouseOver={e=>{if(!loading){e.currentTarget.style.background="#4338ca";e.currentTarget.style.boxShadow="0 6px 20px rgba(79,70,229,0.45)";}}}
                onMouseOut={e=>{if(!loading){e.currentTarget.style.background="#4f46e5";e.currentTarget.style.boxShadow="0 4px 14px rgba(79,70,229,0.35)";}}}
              >
                {loading
                  ?<><span style={{width:13,height:13,border:"2px solid rgba(255,255,255,.35)",borderTopColor:"#fff",borderRadius:999,animation:"spin .7s linear infinite",display:"inline-block"}}/>Signing in…</>
                  :"Sign in"
                }
              </button>

              <p style={{fontSize:12,color:"#a0aec0",textAlign:"center"}}>
                Contact your administrator if you need access.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   USER MANAGEMENT PANEL (email-based)
══════════════════════════════════════════ */
function UsersPanel({appUsers,setAppUsers,saveAppUsers,showToast}){
  const [form,setForm]=useState({email:"",role:"viewer"});
  const [editId,setEditId]=useState(null);
  const uid=()=>"u"+Date.now().toString(36);

  const adminCount=appUsers.filter(u=>u.role==="admin").length;

  const save=()=>{
    if(!form.email.trim()||!form.email.includes("@")){showToast("Valid email required",false);return;}
    const allEmails=appUsers.filter(u=>u.id!==editId).map(u=>u.email?.toLowerCase());
    if(allEmails.includes(form.email.trim().toLowerCase())){showToast("Email already exists",false);return;}
    if(editId){
      const target=appUsers.find(u=>u.id===editId);
      if(target?.role==="admin"&&form.role!=="admin"&&adminCount<=1){
        showToast("Cannot demote — at least one admin must remain",false);return;
      }
    }
    let updated;
    if(editId){
      updated=appUsers.map(u=>u.id===editId?{...u,...form}:u);
      showToast("User updated");
    } else {
      updated=[...appUsers,{id:uid(),email:form.email.trim(),role:form.role}];
      showToast("User added — they can now sign in via Firebase Auth");
    }
    setAppUsers(updated);saveAppUsers(updated);
    setForm({email:"",role:"viewer"});setEditId(null);
  };

  const del=(id)=>{
    const target=appUsers.find(u=>u.id===id);
    if(target?.role==="admin"&&adminCount<=1){
      showToast("Cannot remove — at least one admin must remain",false);return;
    }
    const u=appUsers.filter(x=>x.id!==id);
    setAppUsers(u);saveAppUsers(u);showToast("User removed");
  };
  const startEdit=(u)=>{ setForm({email:u.email||"",role:u.role||"viewer"}); setEditId(u.id); };
  const cancel=()=>{ setForm({email:"",role:"viewer"}); setEditId(null); };

  const ROW={display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderBottom:"1px solid #f1f5f9"};
  const TAG=(role)=>({display:"inline-flex",padding:"2px 10px",borderRadius:999,fontSize:11,fontWeight:700,
    background:role==="admin"?"#fef3c7":role==="editor"?"#ede9fe":"#f0fdf4",
    color:role==="admin"?"#b45309":role==="editor"?"#7c3aed":"#059669",
    border:`1px solid ${role==="admin"?"#fde68a":role==="editor"?"#c4b5fd":"#86efac"}`});

  return(
    <div>
      <div style={{marginBottom:24}}>
        <h2 style={{fontSize:22,fontWeight:800,color:"#1a202c",letterSpacing:-.4,marginBottom:4}}>User Management</h2>
        <p style={{fontSize:13,color:"#718096"}}>Add email addresses here. Users sign in via Google SSO or Firebase email/password — no passwords stored in the app.</p>
      </div>

      {/* Add / Edit form */}
      <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,padding:24,marginBottom:20,boxShadow:"0 1px 6px rgba(0,0,0,.05)"}}>
        <div style={{fontSize:13,fontWeight:700,color:"#4a5568",marginBottom:16}}>{editId?"Edit User":"Add Authorized User"}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:12,alignItems:"flex-end"}}>
          <div>
            <label style={{display:"block",fontSize:11,fontWeight:600,color:"#718096",marginBottom:5}}>Email Address</label>
            <input value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="user@example.com" type="email"
              style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e2e8f0",borderRadius:9,fontSize:13,fontFamily:"inherit",color:"#1a202c",background:"#f7fafc",outline:"none",boxSizing:"border-box"}}
              onFocus={e=>{e.target.style.borderColor="#667eea";e.target.style.background="#fff";}}
              onBlur={e=>{e.target.style.borderColor="#e2e8f0";e.target.style.background="#f7fafc";}}
              onKeyDown={e=>e.key==="Enter"&&save()}/>
          </div>
          <div>
            <label style={{display:"block",fontSize:11,fontWeight:600,color:"#718096",marginBottom:5}}>Role</label>
            <select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}
              style={{padding:"9px 12px",border:"1.5px solid #e2e8f0",borderRadius:9,fontSize:13,fontFamily:"inherit",color:"#1a202c",background:"#f7fafc",outline:"none",cursor:"pointer"}}>
              <option value="viewer">Viewer — read-only (SIMs, Apps, Assets)</option>
              <option value="editor">Editor — full edit (SIMs, Apps, Assets)</option>
              <option value="admin">Admin — full access + Settings + Users</option>
            </select>
          </div>
        </div>
        <div style={{display:"flex",gap:8,marginTop:14}}>
          <button onClick={save} style={{padding:"9px 22px",background:"linear-gradient(135deg,#667eea,#764ba2)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 8px rgba(102,126,234,.35)"}}>
            {editId?"Save Changes":"Add User"}
          </button>
          {editId&&<button onClick={cancel} style={{padding:"9px 16px",background:"#f7fafc",border:"1px solid #e2e8f0",borderRadius:9,color:"#718096",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>}
        </div>
      </div>

      {/* Authorized users */}
      <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,boxShadow:"0 1px 6px rgba(0,0,0,.05)",overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:12,fontWeight:700,color:"#4a5568"}}>Authorized Users</span>
          <span style={{fontSize:10,color:"#667eea",background:"#ede9fe",border:"1px solid #c4b5fd",borderRadius:99,padding:"2px 8px",fontWeight:600}}>Firebase Auth · {appUsers.length} user{appUsers.length!==1?"s":""}</span>
        </div>
        {appUsers.map(u=>{
          const isLastEditor=u.role==="admin"&&adminCount<=1;
          return(
          <div key={u.id} style={ROW}>
            <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,#667eea,#764ba2)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:13,fontWeight:800,flexShrink:0}}>
              {(u.email||"?")[0].toUpperCase()}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:700,color:"#1a202c",display:"flex",alignItems:"center",gap:8}}>
                {u.email}
                {isLastEditor&&<span title="Last admin — cannot be removed or demoted" style={{fontSize:10,color:"#b45309",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:5,padding:"1px 7px",fontWeight:700,letterSpacing:.2}}>🔒 Protected</span>}
              </div>
              <div style={{fontSize:11,color:"#a0aec0"}}>Signs in via Google SSO or email/password</div>
            </div>
            <span style={TAG(u.role||"viewer")}>{u.role||"viewer"}</span>
            <button onClick={()=>startEdit(u)} style={{padding:"5px 12px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:7,color:"#2563eb",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Edit</button>
            <button onClick={()=>del(u.id)} disabled={isLastEditor}
              title={isLastEditor?"At least one editor must remain":undefined}
              style={{padding:"5px 12px",background:isLastEditor?"#f8fafc":"#fff5f5",border:`1px solid ${isLastEditor?"#e2e8f0":"#fed7d7"}`,borderRadius:7,color:isLastEditor?"#cbd5e0":"#e53e3e",fontSize:11,fontWeight:700,cursor:isLastEditor?"not-allowed":"pointer",fontFamily:"inherit",opacity:isLastEditor?.5:1}}>
              Remove
            </button>
          </div>
          );
        })}
        {appUsers.length===0&&(
          <div style={{padding:"32px",textAlign:"center"}}>
            <div style={{fontSize:13,color:"#a0aec0",marginBottom:6}}>No authorized users yet</div>
            <div style={{fontSize:12,color:"#cbd5e0"}}>Add an email above — that person can then sign in with Google or create a Firebase Auth account</div>
          </div>
        )}
      </div>
    </div>
  );
}

function App(){
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [authState, setAuthState] = useState(null); // "admin" | "editor" | "viewer"
  const [loggedInUser, setLoggedInUser] = useState(null);
  const isAdmin  = authState === "admin";
  const canEdit  = authState === "admin" || authState === "editor";

  const [sims, setSims] = useState([]);
  const [apps, setApps] = useState([]);
  const [assets, setAssets] = useState([]);
  const [assetTypes, setAssetTypes] = useState(()=>{ try{ const v=localStorage.getItem("cd_assetTypes"); return v?JSON.parse(v):DEFAULT_ASSET_TYPES; }catch(e){ return DEFAULT_ASSET_TYPES; }});
  const [depts, setDepts] = useState(()=>{ try{ const v=localStorage.getItem("cd_depts"); return v?JSON.parse(v):DEFAULT_DEPTS; }catch(e){ return DEFAULT_DEPTS; }});
  const [branches, setBranches] = useState(()=>{ try{ const v=localStorage.getItem("cd_branches"); return v?JSON.parse(v):DEFAULT_BRANCHES; }catch(e){ return DEFAULT_BRANCHES; }});
  const [designations, setDesignations] = useState(()=>{ try{ const v=localStorage.getItem("cd_designations"); return v?JSON.parse(v):DEFAULT_DESIGNATIONS; }catch(e){ return DEFAULT_DESIGNATIONS; }});
  const [employees, setEmployees] = useState([]);

  const [qrAsset, setQrAsset] = useState(null);
  const [handovers, setHandovers] = useState([]);
  const [handoverLogId, setHandoverLogId] = useState(null);

  // Toast state
  const [toast, setToast] = useState({msg:"", ok:true});
  const showToast = (msg, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast({msg:"",ok:true}),3500); };

  /* UI state */
  const [sSearch,setSSearch]=useState(""); const [sFCarr,setSFCarr]=useState("all"); const [sFStat,setSFStat]=useState("all"); const [sFPay,setSFPay]=useState("all"); const [sFAssign,setSFAssign]=useState("all"); const [sFDept,setSFDept]=useState("all"); const [sFBranch,setSFBranch]=useState("all");
  const [simCollapsed,setSimCollapsed]=useState({});
  const [sModal,setSModal]=useState(null);
  const [sForm,setSForm]=useState({employee:"",dept:"",branch:"",designation:"",nameOnRecord:"",number:"",carrier:"Jio",planName:"",amount:"",currency:"INR",nextBillingDate:"",status:"active",payment:"paid"});
  const [aSearch,setASearch]=useState(""); const [aFCat,setAFCat]=useState("all"); const [aFPay,setAFPay]=useState("all");
  const [aModal,setAModal]=useState(null);
  const [aForm,setAForm]=useState({appName:"",planTier:"",assignedTo:[],newPerson:"",amount:"",currency:"USD",category:"Productivity",status:"active",payment:"paid",billingType:"perUser",billingCycle:"monthly",nextBillingDate:"",payMode:"manual"});
  const [astSearch,setAstSearch]=useState(""); const [astFType,setAstFType]=useState("all"); const [astFStat,setAstFStat]=useState("all"); const [astFAssign,setAstFAssign]=useState("all"); const [astFDept,setAstFDept]=useState("all"); const [astFBranch,setAstFBranch]=useState("all");
  const [astModal,setAstModal]=useState(null);
  const [astForm,setAstForm]=useState({name:"",type:"Laptop",serialNo:"",assignedTo:"",dept:"",branch:"",purchaseDate:"",warrantyDate:"",purchaseAmount:"",currency:"INR",condition:"good",status:"assigned",notes:"",photos:[],specs:[]});
  const [showTypeEditor,setShowTypeEditor]=useState(false);
  const [selectedAssets,setSelectedAssets]=useState([]);
  const [selectedSims,setSelectedSims]=useState([]);
  const [astHistoryId,setAstHistoryId]=useState(null);
  const [simPayHist,setSimPayHist]=useState(null); // {id, label}
  const [appPayHist,setAppPayHist]=useState(null); // {id, label}
  const [newTypeName,setNewTypeName]=useState("");
  const [lightbox,setLightbox]=useState(null);
  const [photoUploading,setPhotoUploading]=useState(false);
  const [reminderEmail,setReminderEmail]=useState(()=>localStorage.getItem("cdReminderEmail")||"");
  const [ejsService,setEjsService]=useState(()=>localStorage.getItem("cdEjsService")||((window.CORPDESK_CONFIG&&window.CORPDESK_CONFIG.EJS_SERVICE)||""));
  const [ejsTemplate,setEjsTemplate]=useState(()=>localStorage.getItem("cdEjsTemplate")||((window.CORPDESK_CONFIG&&window.CORPDESK_CONFIG.EJS_TEMPLATE)||""));
  const [ejsKey,setEjsKey]=useState(()=>localStorage.getItem("cdEjsKey")||((window.CORPDESK_CONFIG&&window.CORPDESK_CONFIG.EJS_KEY)||""));
  const [autoSentToday,setAutoSentToday]=useState(()=>localStorage.getItem("cdAutoSent")||"");
  const [showEmailCfg,setShowEmailCfg]=useState(false);
  const [carrierBillingDays,setCarrierBillingDays]=useState({});  // {carrier: dayOfMonth 1-28}
  const [displayCurrency,setDisplayCurrency]=useState(()=>localStorage.getItem("cdDisplayCurrency")||"INR");
  const [appUsers,setAppUsers]=useState([]);
  const saveAppUsers=useCallback((d)=>gsSave("saveConfig",{key:"appUsers",value:d}),[]);

  /* Google Sheets sync */
  useEffect(()=>{
    const unsub = gsListen((data) => {
      // Consider the sheet "initialised" if ANY of: records OR config keys exist
      const hasRecords = data && (data.sims?.length || data.apps?.length || data.assets?.length);
      const hasConfig  = data && (data.depts?.length || data.branches?.length || data.assetTypes?.length);

      if(hasRecords || hasConfig){
        if(data.sims)   setSims(data.sims);
        if(data.apps)   setApps(data.apps);
        if(data.assets){
                      setAssets(data.assets);
        }
        if(data.assetTypes && data.assetTypes.length){ setAssetTypes(data.assetTypes); try{localStorage.setItem("cd_assetTypes",JSON.stringify(data.assetTypes));}catch(e){} }
        if(data.depts    && data.depts.length){    setDepts(data.depts);       try{localStorage.setItem("cd_depts",JSON.stringify(data.depts));}catch(e){} }
        if(data.branches && data.branches.length){ setBranches(data.branches); try{localStorage.setItem("cd_branches",JSON.stringify(data.branches));}catch(e){} }
        if(data.designations && data.designations.length){ setDesignations(data.designations); try{localStorage.setItem("cd_designations",JSON.stringify(data.designations));}catch(e){} }
        if(data.carrierBillingDays) setCarrierBillingDays(data.carrierBillingDays);
        if(data.employees) setEmployees(data.employees);
        if(data.audit) seedAuditCache(data.audit);
        if(data.appUsers) setAppUsers(data.appUsers);
        if(data.assetHandovers) setHandovers(data.assetHandovers);

      } else {
        // Truly first run — seed everything into the Sheet
        gsSave("saveSims",   SEED_SIMS);
        gsSave("saveApps",   SEED_APPS);
        gsSave("saveAssets", SEED_ASSETS);
        gsSave("saveConfig", { key: "assetTypes",        value: DEFAULT_ASSET_TYPES });
        gsSave("saveConfig", { key: "depts",             value: DEFAULT_DEPTS });
        gsSave("saveConfig", { key: "branches",          value: DEFAULT_BRANCHES });
        gsSave("saveConfig", { key: "designations",      value: DEFAULT_DESIGNATIONS });
        gsSave("saveConfig", { key: "carrierBillingDays",value: {} });
        setSims(SEED_SIMS); setApps(SEED_APPS); setAssets(SEED_ASSETS);
        setBranches(DEFAULT_BRANCHES);
        setDepts(DEFAULT_DEPTS);
        setAssetTypes(DEFAULT_ASSET_TYPES);
      }
      setLoading(false);
    });
    return unsub;
  },[]);

  const saveSims   = useCallback((d)=>gsSave("saveSims", d),[]);
  const saveCarrierBillingDays = useCallback((d)=>gsSave("saveConfig",{key:"carrierBillingDays",value:d}),[]);

  /* ── Auto email reminder: fires once per day on page load ── */
  useEffect(()=>{
    if(loading||!reminderEmail||!ejsService||!ejsTemplate||!ejsKey) return;
    const t=new Date();
    const todayStr=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
    if(autoSentToday===todayStr) return;
    const upcoming=[
      ...sims.filter(s=>s.nextBillingDate&&s.payment!=="paid").map(s=>({label:`SIM – ${s.employee||s.carrier} (${s.carrier})`,date:s.nextBillingDate,amt:fmtAmt(s.amount,s.currency)})),
      ...apps.filter(a=>a.nextBillingDate&&a.payment!=="paid"&&a.payMode!=="autopay").map(a=>({label:`App – ${a.appName}`,date:a.nextBillingDate,amt:fmtAmt(a.amount,a.currency)})),
    ].filter(b=>{ const d=Math.round((new Date(b.date)-new Date(todayStr))/(86400000)); return d>=0&&d<=3; });
    if(!upcoming.length) return;
    if(typeof emailjs==="undefined") return;
    const lines=upcoming.map(b=>`  • ${b.label} — due ${b.date} (${b.amt})`).join("\n");
    const msg=`Hi,\n\nThe following bills are due within 3 days:\n\n${lines}\n\nRegards,\nVardhamanglobal IM`;
    emailjs.init({publicKey:ejsKey});
    emailjs.send(ejsService,ejsTemplate,{to_email:reminderEmail,subject:`VGI: ${upcoming.length} bill${upcoming.length>1?"s":""} due in 3 days`,message:msg})
      .then(()=>{ localStorage.setItem("cdAutoSent",todayStr); setAutoSentToday(todayStr); showToast(`Auto-reminder sent to ${reminderEmail}`); })
      .catch(e=>showToast("Email failed: "+(e.text||String(e)),false));
  },[loading,sims,apps,reminderEmail,ejsService,ejsTemplate,ejsKey]);
  const saveApps      = useCallback((d)=>gsSave("saveApps",      d),[]);
  const saveAssets    = useCallback((d)=>gsSave("saveAssets",    d),[]);
  const saveHandovers = useCallback((d)=>gsSave("saveHandovers", d),[]);
  const saveDepts  = useCallback((d)=>{ try{localStorage.setItem("cd_depts",JSON.stringify(d));}catch(e){} gsSave("saveConfig",{key:"depts",value:d}); },[]);
  const saveBranches = useCallback((d)=>{ try{localStorage.setItem("cd_branches",JSON.stringify(d));}catch(e){} gsSave("saveConfig",{key:"branches",value:d}); },[]);
  const saveDesignations = useCallback((d)=>{ try{localStorage.setItem("cd_designations",JSON.stringify(d));}catch(e){} gsSave("saveConfig",{key:"designations",value:d}); },[]);
  const saveAssetTypes = useCallback((d)=>{ try{localStorage.setItem("cd_assetTypes",JSON.stringify(d));}catch(e){} gsSave("saveConfig",{key:"assetTypes",value:d}); },[]);
  const saveEmployees = useCallback((d)=>gsSave("saveConfig",{key:"employees",value:d}),[]);




  /* ── Import handlers ── */
  const handleImportSims = (file) => {
    readXLSXFile(file, (result, err) => {
      if(err){ showToast(err, false); return; }
      try {
        const {headers, dataRows} = result;
        let imported = parseSIMRows(headers, dataRows);
        if(!imported.length){ showToast("No valid SIM rows found. Check column headers.", false); return; }
        // Assign proper IDs continuing from current max
        let maxNum = sims.reduce((m,s)=>Math.max(m,parseInt(s.id.replace(/\D/g,""))||0),0);
        imported = imported.map(s=>({...s, id:`SIM${String(++maxNum).padStart(3,"0")}`}));
        const {merged, added, skipped} = dedupMergeSIMs(sims, imported);
        setSims(merged); saveSims(merged);
        const msg = skipped>0 ? `Imported ${added} SIM(s) · Skipped ${skipped} duplicate(s) (same phone number)` : `Imported ${added} SIM plan(s) — ${merged.length} total`;
        showToast(msg, skipped===0);
      } catch(e){ showToast("Import failed: " + e.message, false); }
    });
  };

  const handleImportApps = (file) => {
    readXLSXFile(file, (result, err) => {
      if(err){ showToast(err, false); return; }
      try {
        const {headers, dataRows} = result;
        let imported = parseAppRows(headers, dataRows);
        if(!imported.length){ showToast("No valid App rows found. Check column headers.", false); return; }
        let maxNum = apps.reduce((m,a)=>Math.max(m,parseInt(a.id.replace(/\D/g,""))||0),0);
        imported = imported.map(a=>({...a, id:`APP${String(++maxNum).padStart(3,"0")}`}));
        const {merged, added, skipped} = dedupMergeApps(apps, imported);
        setApps(merged); saveApps(merged);
        const msg = skipped>0 ? `Imported ${added} app(s) · Skipped ${skipped} duplicate(s) (same app name)` : `Imported ${added} app subscription(s) — ${merged.length} total`;
        showToast(msg, skipped===0);
      } catch(e){ showToast("Import failed: " + e.message, false); }
    });
  };

  const handleImportEmployees = (file) => {
    readXLSXFile(file, (result, err) => {
      if(err){ showToast("Import failed: "+err, false); return; }
      const {headers, dataRows} = result;
      let imported = parseEmployeeRows(headers, dataRows);
      if(!imported.length){ showToast("No valid employee rows found. Needs Name column.", false); return; }
      // Assign IDs to any without one
      const maxNum = Math.max(0,...(employees||[]).map(e=>parseInt(e.id.replace("EMP",""),10)||0));
      let counter = maxNum;
      imported = imported.map(e=>({ ...e, id: e.id||("EMP"+String(++counter).padStart(3,"0")) }));
      // Dedupe by ID
      const map = {};
      (employees||[]).forEach(e=>map[e.id]=e);
      imported.forEach(e=>{ map[e.id]=e; });
      const merged = Object.values(map);
      setEmployees(merged); saveEmployees(merged);

      showToast("Imported "+imported.length+" employee(s) — "+merged.length+" total");
    });
  };

  const handleImportAssets = (file) => {
    readXLSXFile(file, (result, err) => {
      if(err){ showToast(err, false); return; }
      try {
        const {headers, dataRows} = result;
        let imported = parseAssetRows(headers, dataRows);
        if(!imported.length){ showToast("No valid Asset rows found. Check column headers.", false); return; }
        let maxNum = assets.reduce((m,a)=>Math.max(m,parseInt(a.id.replace(/\D/g,""))||0),0);
        imported = imported.map(a=>({...a, id:`AST${String(++maxNum).padStart(3,"0")}`}));
        const {merged, added, skipped} = dedupMergeAssets(assets, imported);
        setAssets(merged); saveAssets(merged);
        const msg = skipped>0 ? `Imported ${added} asset(s) · Skipped ${skipped} duplicate(s) (same serial no)` : `Imported ${added} asset(s) — ${merged.length} total`;
        showToast(msg, skipped===0);
      } catch(e){ showToast("Import failed: " + e.message, false); }
    });
  };

  /* ── Computed stats (per-currency) ── */
  const visSims = useMemo(()=>sims.filter(s=>{
    const q=sSearch.toLowerCase();
    if(q&&!(s.employee||"").toLowerCase().includes(q)&&!s.id.toLowerCase().includes(q)&&!s.carrier.toLowerCase().includes(q)&&!s.number.includes(q)&&!(s.planName||"").toLowerCase().includes(q)&&!(s.nameOnRecord||"").toLowerCase().includes(q))return false;
    if(sFCarr!=="all"&&s.carrier!==sFCarr)return false;
    if(sFStat!=="all"&&s.status!==sFStat)return false;
    if(sFPay !=="all"&&s.payment!==sFPay)return false;
    if(sFAssign==="assigned"&&!(s.employee&&s.employee.trim()))return false;
    if(sFAssign==="unassigned"&&(s.employee&&s.employee.trim()))return false;
    if(sFDept!=="all"&&(s.dept||"")!==sFDept)return false;
    if(sFBranch!=="all"&&(s.branch||"")!==sFBranch)return false;
    return true;
  }),[sims,sSearch,sFCarr,sFStat,sFPay,sFAssign,sFDept,sFBranch]);

  const sStat = useMemo(()=>{
    const byCur = groupByCurrency(sims, s=>s.amount, s=>s.currency);
    const overdueByCur = groupByCurrency(sims.filter(s=>s.payment==="overdue"), s=>s.amount, s=>s.currency);
    return { total:sims.length, active:sims.filter(s=>s.status==="active").length, byCur, overdueByCur, carriers:[...new Set(sims.map(s=>s.carrier))].length };
  },[sims]);

  const visApps = useMemo(()=>apps.filter(a=>{
    const q=aSearch.toLowerCase();
    const assignedTo = Array.isArray(a.assignedTo)?a.assignedTo:[];
    if(q&&!(a.appName||"").toLowerCase().includes(q)&&!assignedTo.join(" ").toLowerCase().includes(q))return false;
    if(aFCat!=="all"&&a.category!==aFCat)return false;
    if(aFPay!=="all"&&a.payment!==aFPay)return false;
    return true;
  }),[apps,aSearch,aFCat,aFPay]);

  const aStat = useMemo(()=>{
    const byCur = {}; const overdueByCur = {};
    apps.forEach(ap=>{
      const seats = ap.billingType==="flatInvoice"?1:(Array.isArray(ap.assignedTo)?ap.assignedTo:[]).length;
      const monthly = ap.billingCycle==="yearly" ? (ap.amount * seats)/12 : ap.amount * seats;
      byCur[ap.currency] = (byCur[ap.currency]||0) + monthly;
      if(ap.payment==="overdue") overdueByCur[ap.currency] = (overdueByCur[ap.currency]||0) + monthly;
    });
    return { total:apps.length, seats:apps.reduce((a,ap)=>a+(Array.isArray(ap.assignedTo)?ap.assignedTo:[]).length,0), byCur, overdueByCur };
  },[apps]);

  const visAssets = useMemo(()=>assets.filter(a=>{
    const q=astSearch.toLowerCase();
    if(q&&!a.name.toLowerCase().includes(q)&&!(a.assignedTo||"").toLowerCase().includes(q)&&!(a.serialNo||"").toLowerCase().includes(q)&&!a.type.toLowerCase().includes(q))return false;
    if(astFType!=="all"&&a.type!==astFType)return false;
    if(astFStat!=="all"&&a.status!==astFStat)return false;
    if(astFAssign==="assigned"&&a.status!=="assigned")return false;
    if(astFAssign==="unassigned"&&a.status==="assigned")return false;
    if(astFDept!=="all"&&(a.dept||"")!==astFDept)return false;
    if(astFBranch!=="all"&&(a.branch||"")!==astFBranch)return false;
    return true;
  }),[assets,astSearch,astFType,astFStat,astFAssign,astFDept,astFBranch]);

  const astStat = useMemo(()=>{
    const byCur = groupByCurrency(assets, a=>a.purchaseAmount||0, a=>a.currency);
    return { total:assets.length, assigned:assets.filter(a=>a.status==="assigned").length, available:assets.filter(a=>a.status==="available").length, byCur };
  },[assets]);

  /* ── ID generators (collision-safe) ── */
  const nextSimId = () => {
    const nums = sims.map(s=>parseInt(s.id.replace(/\D/g,""))||0);
    return `SIM${String((nums.length?Math.max(...nums):0)+1).padStart(3,"0")}`;
  };
  const nextAppId = () => {
    const nums = apps.map(a=>parseInt(a.id.replace(/\D/g,""))||0);
    return `APP${String((nums.length?Math.max(...nums):0)+1).padStart(3,"0")}`;
  };

  /* ── SIM actions ── */
  const saveSim=()=>{
    if(!sForm.amount)return;
    const isNew=sModal==="add";
    let updated;
    if(isNew){
      const newRec={...sForm,id:nextSimId(),amount:parseFloat(sForm.amount)};
      updated=[...sims,newRec];
      auditLog("create","sim",newRec.id,newRec.employee||newRec.number,{},loggedInUser);
    } else {
      const changes=diffObjects(sModal,{...sModal,...sForm,amount:parseFloat(sForm.amount)});
      updated=sims.map(s=>s.id===sModal.id?{...sModal,...sForm,amount:parseFloat(sForm.amount)}:s);
      auditLog("update","sim",sModal.id,sModal.employee||sModal.number,changes,loggedInUser);
    }
    setSims(updated); saveSims(updated); setSModal(null);
  };
  const delSim=(id)=>{const s=sims.find(x=>x.id===id);const u=sims.filter(x=>x.id!==id);setSims(u);saveSims(u);auditLog("delete","sim",s?.id,s?.employee||s?.number,{},loggedInUser);};
  const delSelectedSims=()=>{const ids=new Set(selectedSims);const removed=sims.filter(s=>ids.has(s.id));const u=sims.filter(s=>!ids.has(s.id));removed.forEach(s=>auditLog("delete","sim",s.id,s.employee||s.number,{},loggedInUser));setSims(u);saveSims(u);setSelectedSims([]);showToast(`Deleted ${removed.length} SIM(s)`);};
  const paySelectedSims=()=>{const ids=new Set(selectedSims);const nbd=nextBillingForCarrier("");let u=sims.map(s=>{if(!ids.has(s.id)||s.payment==="paid")return s;logPayment("sim",s.id,s.employee||s.number,s.amount,s.currency,loggedInUser,s.planName||"");return{...s,payment:"paid",nextBillingDate:nextBillingForCarrier(s.carrier)};});setSims(u);saveSims(u);setSelectedSims([]);showToast(`Marked ${ids.size} SIM(s) as paid`);};

  /* advance date by N months */
  const advanceDate = (dateStr, months) => {
    if(!dateStr) return "";
    const d = new Date(dateStr);
    if(isNaN(d)) return dateStr;
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0,10);
  };
  /* next billing date for a carrier based on its configured day-of-month */
  const nextBillingForCarrier = (carrier) => {
    const day = parseInt(carrierBillingDays[carrier]) || 1;
    const t = new Date();
    const todayDay = t.getDate();
    // If billing day hasn't passed this month yet, use this month; otherwise next month
    let year = t.getFullYear();
    let month = t.getMonth() + 1; // 1-based
    if(todayDay >= day) {
      // already at or past the billing day → next month
      if(month === 12) { month = 1; year++; }
      else month++;
    }
    const maxDay = new Date(year, month, 0).getDate(); // last day of target month
    const actualDay = Math.min(day, maxDay);
    return `${year}-${String(month).padStart(2,"0")}-${String(actualDay).padStart(2,"0")}`;
  };
  const paySim=(id)=>{
    const sim=sims.find(s=>s.id===id);
    const nbd=sim?nextBillingForCarrier(sim.carrier):"";
    const u=sims.map(s=>s.id===id?{...s,payment:"paid",nextBillingDate:nbd}:s);
    if(sim) logPayment("sim",id,sim.employee||sim.number,sim.amount,sim.currency,loggedInUser,sim.planName||"");
    setSims(u);saveSims(u);showToast(`Marked paid · next billing → ${nbd}`);
  };
  /* pay ALL unpaid SIMs for a carrier at once */
  const payCarrier=(carrier)=>{
    const nbd=nextBillingForCarrier(carrier);
    const unpaid=sims.filter(s=>s.carrier===carrier&&s.payment!=="paid");
    unpaid.forEach(s=>logPayment("sim",s.id,s.employee||s.number,s.amount,s.currency,loggedInUser,s.planName||""));
    const u=sims.map(s=>s.carrier===carrier&&s.payment!=="paid"?{...s,payment:"paid",nextBillingDate:nbd}:s);
    const count=unpaid.length;
    setSims(u);saveSims(u);showToast(`${carrier}: ${count} SIM${count!==1?"s":""} marked paid · next billing → ${nbd}`);
  };
  /* mark ALL paid SIMs for a carrier as unpaid */
  const unpayCarrier=(carrier)=>{
    const u=sims.map(s=>s.carrier===carrier&&s.payment==="paid"?{...s,payment:"pending"}:s);
    const count=sims.filter(s=>s.carrier===carrier&&s.payment==="paid").length;
    setSims(u);saveSims(u);showToast(`${carrier}: ${count} SIM${count!==1?"s":""} marked unpaid`,false);
  };
  /* mark individual SIM as unpaid */
  const unpaySim=(id)=>{
    const u=sims.map(s=>s.id===id?{...s,payment:"pending"}:s);
    setSims(u);saveSims(u);showToast("Marked as unpaid");
  };
  const addSim=()=>{setSForm({employee:"",dept:"",branch:"",designation:"",nameOnRecord:"",number:"",carrier:"Jio",planName:"",amount:"",currency:"INR",nextBillingDate:"",status:"active",payment:"paid"});setSModal("add");};
  const editSim=(s)=>{setSForm({employee:s.employee,dept:s.dept,branch:s.branch||"",designation:s.designation||"",nameOnRecord:s.nameOnRecord||"",number:s.number,carrier:s.carrier,planName:s.planName,amount:String(s.amount),currency:s.currency,nextBillingDate:s.nextBillingDate||'',status:s.status,payment:s.payment});setSModal(s);};

  /* ── APP actions ── */
  const saveApp=()=>{
    if(!aForm.appName||!aForm.amount)return;
    const isNew=aModal==="add";
    const ppl=(Array.isArray(aForm.assignedTo)?aForm.assignedTo:[]).filter(Boolean);
    const {newPerson:_np, ...cleanForm} = aForm;
    let updated;
    if(isNew){
      const newRec={...cleanForm,id:nextAppId(),amount:parseFloat(aForm.amount),assignedTo:ppl};
      updated=[...apps,newRec];
      auditLog("create","app",newRec.id,newRec.appName,{},loggedInUser);
    } else {
      const changes=diffObjects(aModal,{...aModal,...cleanForm,amount:parseFloat(aForm.amount),assignedTo:ppl});
      updated=apps.map(a=>a.id===aModal.id?{...aModal,...cleanForm,amount:parseFloat(aForm.amount),assignedTo:ppl}:a);
      auditLog("update","app",aModal.id,aModal.appName,changes,loggedInUser);
    }
    setApps(updated); saveApps(updated); setAModal(null);
  };
  const delApp=(id)=>{const a=apps.find(x=>x.id===id);const u=apps.filter(x=>x.id!==id);setApps(u);saveApps(u);auditLog("delete","app",a?.id,a?.appName,{},loggedInUser);};
  const payApp=(id)=>{
    const ap=apps.find(a=>a.id===id);
    if(ap) logPayment("app",id,ap.appName,ap.amount,ap.currency,loggedInUser,ap.planTier||"");
    const u=apps.map(a=>a.id===id?{...a,payment:"paid",nextBillingDate:advanceDate(a.nextBillingDate,a.billingCycle==="yearly"?12:1)}:a);
    setApps(u);saveApps(u);
  };
  const addApp=()=>{setAForm({appName:"",planTier:"",assignedTo:[],newPerson:"",amount:"",currency:"USD",category:"Productivity",status:"active",payment:"paid",billingType:"perUser",billingCycle:"monthly",nextBillingDate:"",payMode:"manual"});setAModal("add");};
  const editApp=(a)=>{setAForm({...a,payMode:a.payMode||"manual",newPerson:""});setAModal(a);};
  const addPerson=()=>{if(aForm.newPerson.trim())setAForm({...aForm,assignedTo:[...aForm.assignedTo,aForm.newPerson.trim()],newPerson:""});};
  const remPerson=(i)=>setAForm({...aForm,assignedTo:(Array.isArray(aForm.assignedTo)?aForm.assignedTo:[]).filter((_,j)=>j!==i)});

  /* ── ASSET actions ── */
  const nextAstId = () => {
    const nums = assets.map(a=>parseInt(a.id.replace(/\D/g,""))||0);
    return `AST${String((nums.length?Math.max(...nums):0)+1).padStart(3,"0")}`;
  };
  const saveAsset=()=>{
    if(!astForm.name)return;
    let resolvedStatus = astForm.status;
    if(astForm.status==="assigned" && !astForm.assignedTo.trim()) resolvedStatus = "available";
    if(astForm.status!=="assigned" && astForm.status!=="in repair" && astForm.status!=="retired" && astForm.status!=="damaged" && astForm.assignedTo.trim()) resolvedStatus = "assigned";
    const finalId=(astForm.id&&astForm.id.trim())?astForm.id.trim():nextAstId();
    const rawPhotos = astForm.photos;
    const photosArr = Array.isArray(rawPhotos) ? rawPhotos
      : typeof rawPhotos === 'string' ? rawPhotos.split('||').filter(Boolean)
      : rawPhotos && typeof rawPhotos === 'object' ? Object.values(rawPhotos)
      : [];
    const safePhotos = photosArr.filter(p => p && typeof p === 'string' && p.startsWith('http'));
    // Store as pipe-delimited string — Firebase silently strips nested arrays
    const photosStr = safePhotos.join('||');
    const saved={...astForm,id:finalId,status:resolvedStatus,purchaseAmount:parseFloat(astForm.purchaseAmount)||0,photos:photosStr,specs:(astForm.specs||[]).filter(s=>s.key.trim()),lastEdited:new Date().toISOString(),lastEditedBy:loggedInUser||"unknown"};
    const isNew=astModal==="add";
    let updated;
    if(isNew){
      updated=[...assets,saved];
      auditLog("create","asset",saved.id,saved.name,{},loggedInUser);
      if(saved.assignedTo){
        const h={id:`HO-${Date.now()}`,assetId:saved.id,assetName:saved.name,from:"",to:saved.assignedTo,toDept:saved.dept||"",ts:new Date().toISOString(),by:loggedInUser||"unknown"};
        const uh=[...handovers,h];setHandovers(uh);saveHandovers(uh);
      }
    } else {
      const changes=diffObjects(astModal,saved,["photos","lastEdited","specs"]);
      updated=assets.map(a=>a.id===astModal.id?saved:a);
      auditLog("update","asset",astModal.id,astModal.name,changes,loggedInUser);
      if((astModal.assignedTo||"")!==(saved.assignedTo||"")){
        const h={id:`HO-${Date.now()}`,assetId:saved.id,assetName:saved.name,from:astModal.assignedTo||"",to:saved.assignedTo||"",toDept:saved.dept||"",ts:new Date().toISOString(),by:loggedInUser||"unknown"};
        const uh=[...handovers,h];setHandovers(uh);saveHandovers(uh);
      }
    }
    setAssets(updated); saveAssets(updated); setAstModal(null);
  };
  const delAsset=(id)=>{const a=assets.find(x=>x.id===id);const u=assets.filter(x=>x.id!==id);setAssets(u);saveAssets(u);auditLog("delete","asset",a?.id,a?.name,{},loggedInUser);};
  const delSelectedAssets=()=>{
    const toDelete=assets.filter(a=>selectedAssets.includes(a.id));
    const u=assets.filter(a=>!selectedAssets.includes(a.id));
    toDelete.forEach(a=>auditLog("delete","asset",a.id,a.name,{},loggedInUser));
    setAssets(u);saveAssets(u);setSelectedAssets([]);
    showToast(`Deleted ${selectedAssets.length} asset(s)`);
  };
  const addAsset=()=>{setAstForm({id:nextAstId(),name:"",type:assetTypes[0]||"Laptop",serialNo:"",assignedTo:"",dept:"",branch:"",designation:"",purchaseDate:"",warrantyDate:"",purchaseAmount:"",currency:"INR",condition:"good",status:"assigned",notes:"",photos:[]});setAstModal("add");};
  const editAsset=(a)=>{
    // decode photos — may be pipe-string from Firebase, array, or object
    const rawP=a.photos;
    const fixedPhotos = typeof rawP==='string' ? rawP.split('||').filter(Boolean)
      : Array.isArray(rawP) ? rawP
      : rawP && typeof rawP==='object' ? Object.values(rawP).filter(Boolean)
      : [];
    const fixedSpecs = Array.isArray(a.specs)?a.specs:a.specs&&typeof a.specs==='object'?Object.values(a.specs):[];
    setAstForm({...a,purchaseAmount:String(a.purchaseAmount||""),id:a.id,branch:a.branch||"",designation:a.designation||"",warrantyDate:a.warrantyDate||"",photos:fixedPhotos,specs:fixedSpecs});setAstModal(a);
  };
  const addAssetType=()=>{ const t=newTypeName.trim(); if(t&&!assetTypes.includes(t)){const u=[...assetTypes,t];setAssetTypes(u);saveAssetTypes(u);} setNewTypeName(""); };
  const removeAssetType=(t)=>{ if(assets.some(a=>a.type===t)){alert(`Cannot remove "${t}" — used by existing assets.`);return;} const u=assetTypes.filter(x=>x!==t);setAssetTypes(u);saveAssetTypes(u); };

  /* ── Photo upload ── */
  const handlePhotoUpload=async(files)=>{
    setPhotoUploading(true);
    try{
      const currentPhotos = Array.isArray(astForm.photos) ? astForm.photos
        : typeof astForm.photos==='string' ? astForm.photos.split('||').filter(Boolean)
        : [];
      const remaining=10-currentPhotos.length;
      const toLoad=Array.from(files).slice(0,remaining);
      const urls=await Promise.all(toLoad.map(file=>new Promise((res,rej)=>{
        const r=new FileReader();
        r.onload=async(ev)=>{
          try{
            const url=await uploadToImgBB(ev.target.result);
            res(url); // ImgBB URL — safe to save
          }catch(e){
            // ImgBB failed — fall back to local base64 preview (works in UI, stripped before Firebase save)
            res(ev.target.result);
          }
        };
        r.onerror=()=>rej(new Error("Read failed"));
        r.readAsDataURL(file);
      })));
      const imgbbUrls = urls.filter(u=>u.startsWith('http'));
      const localPreviews = urls.filter(u=>!u.startsWith('http'));
      setAstForm(f=>{
        const existing = Array.isArray(f.photos) ? f.photos
          : typeof f.photos==='string' ? f.photos.split('||').filter(Boolean)
          : [];
        return {...f, photos:[...existing,...urls]};
      });
      if(imgbbUrls.length>0) showToast(`${imgbbUrls.length} photo(s) uploaded successfully`);
      if(localPreviews.length>0) showToast(`${localPreviews.length} photo(s) saved as local preview — ImgBB key not set`,false);
    } catch(e){console.error("Photo upload failed",e);showToast("Upload error: "+e.message,false);}
    finally{setPhotoUploading(false);}
  };

  if(authState===null) return <LoginModal onLogin={(role, username, displayName)=>{setAuthState(["admin","editor","viewer"].includes(role)?role:"viewer");setLoggedInUser(displayName||username);}}/>;

  if(loading){
    return(
      <div style={{minHeight:"100vh",background:"#f5f7fa",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
        <div style={{width:44,height:44,borderRadius:999,border:"3px solid rgba(102,126,234,0.2)",borderTopColor:"#667eea",animation:"spin 1s linear infinite"}}/>
        <div style={{fontSize:14,color:"#667eea",fontWeight:600}}>Connecting to server…</div>
      </div>
    );
  }

  return(
    <div style={{minHeight:"100vh",background:"#f5f7fa",color:"#1a202c",display:"flex",alignItems:"flex-start"}}>

      {/* ── SIDEBAR ── */}
      <aside style={{width:256,flexShrink:0,background:"linear-gradient(135deg,#667eea 0%,#764ba2 100%)",display:"flex",flexDirection:"column",position:"sticky",top:0,height:"100vh",overflowY:"auto",boxShadow:"4px 0 24px rgba(102,126,234,0.2)"}}>
        {/* Logo / Brand */}
        <div style={{padding:"20px 16px",borderBottom:"1px solid rgba(255,255,255,0.12)"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:40,height:40,borderRadius:12,background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.3)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <img src="https://i.ibb.co/nMdGqhKR/image.png" alt="VGI" style={{width:32,height:32,objectFit:"contain",borderRadius:8}} onError={e=>{e.target.style.display="none";}}/>
            </div>
            <div>
              <div style={{fontSize:12,fontWeight:800,color:"#fff",letterSpacing:-.2}}>Vardhamanglobal</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.65)",fontWeight:500}}>Inventory Management</div>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav style={{padding:"12px 12px",flex:1}}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:".15em",textTransform:"uppercase",color:"rgba(255,255,255,0.45)",padding:"0 8px",marginBottom:8}}>Navigation</div>
          {[
            {id:"dashboard",label:"Dashboard",icon:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>},
            {id:"sims",label:"SIM Plans",icon:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>},
            {id:"apps",label:"App Subscriptions",icon:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>},
            {id:"assets",label:"Assets",icon:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>},
            ...(isAdmin?[
              {id:"users",label:"User Management",icon:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>},
              {id:"settings",label:"Settings",icon:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>},
            ]:[]),
          ].map(n=>(
            <button key={n.id} onClick={()=>setTab(n.id)} style={{
              display:"flex",alignItems:"center",gap:10,padding:"10px 12px",width:"100%",textAlign:"left",
              background:tab===n.id?"rgba(255,255,255,0.18)":"transparent",
              border:"none",
              borderRadius:10,
              color:tab===n.id?"#fff":"rgba(255,255,255,0.7)",
              fontSize:13,fontWeight:tab===n.id?700:500,
              transition:"all .15s",fontFamily:"inherit",cursor:"pointer",marginBottom:2,
              boxShadow:tab===n.id?"0 2px 8px rgba(0,0,0,0.15)":"none"
            }}
            onMouseOver={e=>{if(tab!==n.id){e.currentTarget.style.background="rgba(255,255,255,0.1)";e.currentTarget.style.color="#fff";}}}
            onMouseOut={e=>{if(tab!==n.id){e.currentTarget.style.background="transparent";e.currentTarget.style.color="rgba(255,255,255,0.7)";}}}
            >
              <span style={{opacity:tab===n.id?1:0.75,flexShrink:0}}>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div style={{borderTop:"1px solid rgba(255,255,255,0.12)",padding:"12px"}}>
          {/* Quick stats */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:10}}>
            {[{label:"Assets",val:astStat.total},{label:"SIMs",val:sims.length},{label:"Apps",val:apps.length}].map(({label,val})=>(
              <div key={label} style={{background:"rgba(0,0,0,0.15)",borderRadius:8,padding:"6px 8px",textAlign:"center"}}>
                <div style={{fontSize:15,fontWeight:800,color:"#fff",fontFamily:"'DM Mono',monospace"}}>{val}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.55)",fontWeight:600,textTransform:"uppercase",letterSpacing:.3}}>{label}</div>
              </div>
            ))}
          </div>
          {/* User card */}
          {(()=>{
            const _initials=loggedInUser
              ?(loggedInUser.includes("@")
                ?loggedInUser.split("@")[0].split(/[._-]/).map(p=>p[0]?.toUpperCase()).filter(Boolean).slice(0,2).join("")
                :loggedInUser.split(" ").filter(Boolean).map(w=>w[0]?.toUpperCase()).filter(Boolean).slice(0,2).join(""))
              :"?";
            return(
              <>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:10,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)"}}>
                  <div style={{width:34,height:34,borderRadius:"50%",background:"rgba(255,255,255,0.18)",border:"1.5px solid rgba(255,255,255,0.32)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"#fff",flexShrink:0,letterSpacing:-.3}}>
                    {_initials}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:.4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{loggedInUser||"Guest"}</div>
                    <div style={{fontSize:10,color:"rgba(255,255,255,0.55)",fontWeight:500,textTransform:"capitalize",marginTop:1}}>{authState==="admin"?"Admin":authState==="editor"?"Editor":"Viewer"}</div>
                  </div>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><path d="M9 5l7 7-7 7"/></svg>
                </div>
                <button onClick={()=>{signOut(auth);setAuthState(null);setLoggedInUser(null);}}
                  style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 10px",marginTop:3,background:"none",border:"none",borderRadius:8,cursor:"pointer",color:"rgba(255,255,255,0.45)",fontSize:12,fontWeight:500,fontFamily:"inherit",transition:"all .15s"}}
                  onMouseOver={e=>{e.currentTarget.style.color="#fca5a5";e.currentTarget.style.background="rgba(239,68,68,0.15)";}}
                  onMouseOut={e=>{e.currentTarget.style.color="rgba(255,255,255,0.45)";e.currentTarget.style.background="none";}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
                  Sign out
                </button>
              </>
            );
          })()}
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main style={{flex:1,overflow:"auto",padding:"28px 32px",background:"#f8fafc"}}>

        {/* ── Reminder Banner ── */}
        {(()=>{
          const today = new Date().toISOString().slice(0,10);
          const upcoming = [
            ...sims.filter(s=>s.nextBillingDate&&s.payment!=="paid").map(s=>({label:`SIM – ${s.employee||s.carrier} (${s.carrier})`,date:s.nextBillingDate,amt:fmtAmt(s.amount,s.currency)})),
            ...apps.filter(a=>a.nextBillingDate&&a.payment!=="paid"&&a.payMode!=="autopay").map(a=>({label:`App – ${a.appName}`,date:a.nextBillingDate,amt:fmtAmt(a.amount,a.currency)})),
          ].filter(b=>{
            const diff=Math.round((new Date(b.date)-new Date(today))/(1000*60*60*24));
            return diff>=0&&diff<=3;
          }).sort((a,b)=>a.date.localeCompare(b.date));

          if(upcoming.length===0) return null;

          const mailBody = upcoming.map(b=>`• ${b.label} — due ${b.date} (${b.amt})`).join("\n");
          const mailHref = reminderEmail
            ? `mailto:${reminderEmail}?subject=VGI%3A%20Bills%20due%20in%203%20days&body=${encodeURIComponent("Hi,\n\nThe following bills are due within 3 days:\n\n"+mailBody+"\n\nRegards,\nVardhamanglobal IM")}`
            : null;

          return(
            <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:"14px 18px",marginBottom:24,display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
              <div>
                <div style={{fontWeight:700,color:"#dc2626",fontSize:13,marginBottom:8}}>{upcoming.length} bill{upcoming.length>1?"s":""} due within 3 days</div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {upcoming.map((b,i)=>(
                    <div key={i} style={{fontSize:12,color:"#78350f",display:"flex",gap:10}}>
                      <span style={{fontFamily:"'DM Mono',monospace",color:"#d97706",fontWeight:600,minWidth:80}}>{fmtDate(b.date)}</span>
                      <span>{b.label}</span>
                      <span style={{color:"#6366f1",fontWeight:600}}>{b.amt}</span>
                    </div>
                  ))}
                </div>
              </div>
              {ejsService&&ejsTemplate&&ejsKey&&reminderEmail
                ?<button onClick={()=>{
                    if(typeof emailjs==="undefined"){showToast("EmailJS not loaded",false);return;}
                    const lines2=upcoming.map(b=>`  • ${b.label} — due ${b.date} (${b.amt})`).join("\n");
                    const msg2=`Hi,\n\nBills due in 3 days:\n\n${lines2}\n\nRegards,\nVardhamanglobal IM`;
                    emailjs.init({publicKey:ejsKey});
                    emailjs.send(ejsService,ejsTemplate,{to_email:reminderEmail,subject:`VGI: ${upcoming.length} bill${upcoming.length>1?"s":""} due in 3 days`,message:msg2})
                      .then(()=>showToast(`Reminder sent to ${reminderEmail}`))
                      .catch(e=>showToast("Email failed: "+(e.text||String(e)),false));
                  }} style={{flexShrink:0,padding:"9px 16px",background:"#d1fae5",border:"1px solid #6ee7b7",borderRadius:10,color:"#059669",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                    Send Reminder
                  </button>
                :<a href={mailHref||"#"} style={{flexShrink:0,padding:"9px 16px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,color:"#d97706",fontSize:12,fontWeight:700,textDecoration:"none",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}>
                    Open Mail
                  </a>
              }
            </div>
          );
        })()}

        {/* ════ DASHBOARD TAB ════ */}
        {tab==="dashboard"&&<Dashboard sims={sims} apps={apps} assets={assets} canEdit={canEdit} displayCurrency={displayCurrency} onAssignSim={(id,employee,dept,branch)=>{const u=sims.map(s=>s.id===id?{...s,employee,dept,branch}:s);setSims(u);saveSims(u);showToast(`SIM assigned to ${employee}`);}} onAssignAsset={(id,assignedTo,dept,branch)=>{const u=assets.map(a=>a.id===id?{...a,assignedTo,dept,branch,status:"assigned"}:a);setAssets(u);saveAssets(u);showToast(`Asset assigned to ${assignedTo}`);}}/>}
        {/* ════ SIM TAB ════ */}
        {tab==="sims"&&(
          <>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24,gap:16,flexWrap:"wrap"}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:800,color:"#0f172a",letterSpacing:-.5,marginBottom:4}}>SIM Plans</h1>
                <p style={{fontSize:13,color:"#64748b"}}>Monthly billing · Multiple carriers · Per-employee</p>
              </div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                {canEdit&&<ImportBtn label="Import XLSX" color="#64748b" onFile={handleImportSims}/>}
                {canEdit&&<button onClick={addSim} style={{padding:"9px 18px",background:"#2563eb",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 8px rgba(37,99,235,.3)"}}>+ Add SIM Plan</button>}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
              <StatCard label="Total Monthly" val={fmtMulti(sStat.byCur)} accent="#6366f1"/>
              <StatCard label="Active SIMs" val={sStat.active} accent="#10b981"/>
              <StatCard label="Overdue" val={fmtMulti(sStat.overdueByCur)||"—"} accent={Object.keys(sStat.overdueByCur).length>0?"#f87171":"#10b981"}/>
              <StatCard label="Carriers" val={sStat.carriers} accent="#0284c7"/>
            </div>

            {/* Filter bar */}
            <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
              <input value={sSearch} onChange={e=>setSSearch(e.target.value)} placeholder="Search employee, number, plan…" style={{...INP,maxWidth:240,flex:"1 1 180px"}}/>
              <select value={sFStat} onChange={e=>setSFStat(e.target.value)} style={{...SEL,width:"auto",padding:"9px 13px"}}>
                <option value="all">All Status</option>
                {["active","suspended","inactive"].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              <select value={sFPay} onChange={e=>setSFPay(e.target.value)} style={{...SEL,width:"auto",padding:"9px 13px"}}>
                <option value="all">All Payments</option>
                {["paid","pending","overdue"].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              <select value={sFDept} onChange={e=>setSFDept(e.target.value)} style={{...SEL,width:"auto",padding:"9px 13px",borderColor:sFDept!=="all"?"rgba(99,102,241,.5)":"#e2e8f0",color:sFDept!=="all"?"#6366f1":"#1e293b"}}>
                <option value="all">All Departments</option>
                {depts.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
              <span style={{fontSize:12,color:"#94a3b8",marginLeft:"auto"}}>{visSims.length} of {sims.length}</span>
            </div>

            {/* Batch action bar */}
            {selectedSims.length>0&&(
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,marginBottom:14}}>
                <span style={{fontSize:13,fontWeight:700,color:"#1d4ed8"}}>{selectedSims.length} selected</span>
                <button onClick={()=>setSelectedSims([])} style={{padding:"4px 10px",background:"none",border:"1px solid #bfdbfe",borderRadius:7,fontSize:12,color:"#64748b",cursor:"pointer",fontFamily:"inherit"}}>Clear</button>
                <button onClick={()=>setSelectedSims(visSims.map(s=>s.id))} style={{padding:"4px 10px",background:"none",border:"1px solid #bfdbfe",borderRadius:7,fontSize:12,color:"#1d4ed8",cursor:"pointer",fontFamily:"inherit"}}>Select all ({visSims.length})</button>
                {canEdit&&<button onClick={paySelectedSims} style={{padding:"4px 12px",background:"rgba(52,211,153,.15)",border:"1px solid rgba(52,211,153,.4)",borderRadius:7,fontSize:12,fontWeight:700,color:"#059669",cursor:"pointer",fontFamily:"inherit"}}>✓ Pay selected</button>}
                {canEdit&&<ConfirmBtn label={`Delete ${selectedSims.length}`} color="#ef4444" onConfirm={delSelectedSims}/>}
              </div>
            )}

            {/* Carrier-grouped table */}
            {(()=>{
              const CARRIER_COLORS=["#6366f1","#0284c7","#10b981","#f59e0b","#ec4899","#8b5cf6","#14b8a6"];
              const grouped=visSims.reduce((acc,s)=>{if(!acc[s.carrier])acc[s.carrier]=[];acc[s.carrier].push(s);return acc;},{});
              const carriers=Object.keys(grouped);
              if(carriers.length===0) return <div style={{padding:60,textAlign:"center",color:"#94a3b8",fontSize:13,background:"#fff",borderRadius:14,border:"1px solid #e2e8f0"}}>No SIM plans match your filters.</div>;
              const thS={padding:"10px 14px",textAlign:"left",color:"#94a3b8",fontSize:10,fontWeight:700,letterSpacing:.6,textTransform:"uppercase",whiteSpace:"nowrap"};
              return(
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  {carriers.map((carrier,ci)=>{
                    const rows=grouped[carrier];
                    const collapsed=simCollapsed[carrier];
                    const unpaid=rows.filter(s=>s.payment!=="paid").length;
                    const allPaid=unpaid===0;
                    const spend=rows.reduce((acc,s)=>{acc[s.currency]=(acc[s.currency]||0)+s.amount;return acc;},{});
                    const accentColor=CARRIER_COLORS[ci%CARRIER_COLORS.length];
                    const allChecked=rows.length>0&&rows.every(s=>selectedSims.includes(s.id));
                    return(
                      <div key={carrier} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,.04)"}}>
                        {/* Group header */}
                        <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 18px",background:"#f8fafc",borderBottom:collapsed?"none":"1px solid #e2e8f0",cursor:"pointer"}}
                          onClick={()=>setSimCollapsed(c=>({...c,[carrier]:!c[carrier]}))}>
                          {/* Collapse chevron */}
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                            style={{transition:"transform .2s",transform:collapsed?"rotate(-90deg)":"rotate(0deg)",flexShrink:0}}>
                            <path d="M6 9l6 6 6-6"/>
                          </svg>
                          {/* Carrier accent dot + name */}
                          <div style={{width:8,height:8,borderRadius:"50%",background:accentColor,flexShrink:0}}/>
                          <span style={{fontWeight:700,color:"#0f172a",fontSize:14,flex:"0 0 auto"}}>{carrier}</span>
                          {/* Count badge */}
                          <span style={{background:accentColor+"18",color:accentColor,fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:20}}>{rows.length} SIM{rows.length>1?"s":""}</span>
                          {/* Payment status */}
                          <span style={{fontSize:12,color:allPaid?"#059669":"#d97706",fontWeight:600}}>
                            {allPaid?"✓ All paid":`${unpaid} unpaid`}
                          </span>
                          {/* Spend totals */}
                          <div style={{display:"flex",gap:10,marginLeft:4}}>
                            {Object.entries(spend).map(([cur,val])=>(
                              <span key={cur} style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:"#1e293b"}}>{fmtAmt(val,cur)}</span>
                            ))}
                          </div>
                          {/* Billing day */}
                          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
                            {canEdit&&(
                              <div style={{display:"flex",alignItems:"center",gap:6}} onClick={e=>e.stopPropagation()}>
                                <span style={{fontSize:11,color:"#94a3b8"}}>Billing day</span>
                                <input type="number" min="1" max="28"
                                  value={carrierBillingDays[carrier]||1}
                                  onChange={e=>{const v=Math.max(1,Math.min(28,parseInt(e.target.value)||1));const upd={...carrierBillingDays,[carrier]:v};setCarrierBillingDays(upd);saveCarrierBillingDays(upd);}}
                                  style={{width:44,padding:"4px 6px",borderRadius:7,border:"1px solid #e2e8f0",fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:12,color:"#1e293b",textAlign:"center",outline:"none"}}
                                />
                              </div>
                            )}
                            {canEdit&&(
                              <button onClick={e=>{e.stopPropagation();allPaid?unpayCarrier(carrier):payCarrier(carrier);}}
                                style={{padding:"5px 14px",background:allPaid?"#f1f5f9":"#d1fae5",border:`1px solid ${allPaid?"#e2e8f0":"#6ee7b7"}`,borderRadius:8,color:allPaid?"#94a3b8":"#059669",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                                {allPaid?"Mark unpaid":"✓ Pay all"}
                              </button>
                            )}
                          </div>
                        </div>
                        {/* Rows */}
                        {!collapsed&&(
                          <div style={{overflowX:"auto"}}>
                            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                              <thead>
                                <tr style={{borderBottom:"1px solid #f1f5f9"}}>
                                  {canEdit&&<th style={{...thS,width:36,paddingLeft:18}}>
                                    <input type="checkbox" checked={allChecked} onChange={e=>setSelectedSims(prev=>e.target.checked?[...new Set([...prev,...rows.map(s=>s.id)])]:prev.filter(id=>!rows.map(s=>s.id).includes(id)))} style={{cursor:"pointer",accentColor:accentColor}}/>
                                  </th>}
                                  {["Employee","Number","Plan","Amount","Next Billing","Status","Payment",...(canEdit?["Actions"]:[])].map((h,i)=>(
                                    <th key={i} style={thS}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((s,idx)=>{
                                  const today=new Date().toISOString().slice(0,10);
                                  const diff=s.nextBillingDate?Math.round((new Date(s.nextBillingDate)-new Date(today))/(86400000)):null;
                                  const billClr=diff===null?"#cbd5e1":diff<0?"#dc2626":diff<=3?"#d97706":"#374151";
                                  const billLbl=diff===null?"":diff<0?`${Math.abs(diff)}d overdue`:diff===0?"today":diff<=3?`${diff}d left`:"";
                                  const isChecked=selectedSims.includes(s.id);
                                  return(
                                    <tr key={s.id} style={{borderBottom:"1px solid #f8fafc",background:isChecked?"#eff6ff":idx%2===0?"#fff":"#fafbff",transition:"background .1s"}}
                                      onMouseOver={e=>{if(!isChecked)e.currentTarget.style.background="#f0f4ff";}}
                                      onMouseOut={e=>{if(!isChecked)e.currentTarget.style.background=idx%2===0?"#fff":"#fafbff";}}>
                                      {canEdit&&<td style={{padding:"11px 8px 11px 18px"}}>
                                        <input type="checkbox" checked={isChecked} onChange={e=>setSelectedSims(prev=>e.target.checked?[...prev,s.id]:prev.filter(x=>x!==s.id))} style={{cursor:"pointer",accentColor:accentColor}}/>
                                      </td>}
                                      <td style={{padding:"11px 14px"}}>
                                        <div style={{fontWeight:600,color:s.employee?"#0f172a":"#94a3b8",fontStyle:s.employee?"normal":"italic"}}>{s.employee||"Unassigned"}</div>
                                        {s.dept&&<div style={{fontSize:11,color:accentColor,fontWeight:600,marginTop:1}}>{s.dept}</div>}
                                      </td>
                                      <td style={{padding:"11px 14px",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,color:"#0f172a",letterSpacing:.4}}>{s.number}</td>
                                      <td style={{padding:"11px 14px",color:"#475569",fontSize:12}}>{s.planName}</td>
                                      <td style={{padding:"11px 14px"}}>
                                        <div style={{fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#0f172a",fontSize:13}}>{fmtAmt(s.amount,s.currency)}</div>
                                        <CTag currency={s.currency}/>
                                      </td>
                                      <td style={{padding:"11px 14px"}}>
                                        {s.nextBillingDate
                                          ?<><div style={{fontFamily:"'DM Mono',monospace",color:billClr,fontWeight:600,fontSize:12}}>{fmtDate(s.nextBillingDate)}</div>
                                            {billLbl&&<div style={{fontSize:10,color:billClr,fontWeight:700,marginTop:1}}>{billLbl}</div>}</>
                                          :<span style={{color:"#cbd5e1"}}>—</span>}
                                      </td>
                                      <td style={{padding:"11px 14px"}}><Pill text={s.status} color={STA_CLR[s.status]||"#94a3b8"}/></td>
                                      <td style={{padding:"11px 14px"}}><Pill text={s.payment} color={PAY_CLR[s.payment]||"#94a3b8"}/></td>
                                      {canEdit&&<td style={{padding:"11px 14px"}}>
                                        <div style={{display:"flex",gap:5}}>
                                          <Btn sm onClick={()=>editSim(s)} color="#6366f1">Edit</Btn>
                                          {s.payment!=="paid"&&<Btn sm onClick={()=>paySim(s.id)} color="#34d399">Pay</Btn>}
                                          {s.payment==="paid"&&<Btn sm onClick={()=>unpaySim(s.id)} color="#94a3b8">Unpay</Btn>}
                                          <Btn sm onClick={()=>setSimPayHist({id:s.id,label:s.employee||s.number})} color="#0284c7">History</Btn>
                                          <ConfirmBtn onConfirm={()=>delSim(s.id)}/>
                                        </div>
                                      </td>}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

          </>
        )}

        {/* ════ APP TAB ════ */}
        {tab==="apps"&&(
          <>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24,gap:16,flexWrap:"wrap"}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:800,color:"#0f172a",letterSpacing:-.5,marginBottom:4}}>App Subscriptions</h1>
                <p style={{fontSize:13,color:"#94a3b8"}}>Track which apps each employee needs · Monthly billing</p>
              </div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                {canEdit&&<ImportBtn label="Import XLSX" color="#64748b" onFile={handleImportApps}/>}
                {canEdit&&<button onClick={addApp} style={{padding:"9px 18px",background:"#2563eb",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 8px rgba(37,99,235,.3)"}}>+ Add App</button>}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
              <StatCard label="Total Monthly" val={fmtMulti(aStat.byCur)} accent="#6366f1" sub="Yearly plans ÷ 12"/>
              <StatCard label="Total Apps" val={aStat.total} accent="#0284c7"/>
              <StatCard label="Total Seats" val={aStat.seats} accent="#10b981"/>
              <StatCard label="Overdue" val={fmtMulti(aStat.overdueByCur)||"—"} accent={Object.keys(aStat.overdueByCur).length>0?"#f87171":"#10b981"}/>
            </div>

            <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"center"}}>
              <input value={aSearch} onChange={e=>setASearch(e.target.value)} placeholder="Search app or person…" style={{...INP,maxWidth:260}}/>
              <select value={aFCat} onChange={e=>setAFCat(e.target.value)} style={{...SEL,width:"auto",padding:"9px 13px"}}>
                <option value="all">All Categories</option>
                {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
              <select value={aFPay} onChange={e=>setAFPay(e.target.value)} style={{...SEL,width:"auto",padding:"9px 13px"}}>
                <option value="all">All Payments</option>
                {["paid","pending","overdue"].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              <span style={{fontSize:12,color:"#94a3b8"}}>{visApps.length}/{apps.length}</span>
            </div>
            <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,overflow:"hidden",boxShadow:"0 1px 6px rgba(0,0,0,.05)"}}>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:900}}>
                  <thead>
                    <tr style={{background:"#f8fafc",borderBottom:"1px solid #e8edf2"}}>
                      {["#","App","Category","Plan / Billing","Seats","Amount / mo","Next Billing","Payment","Status",...(canEdit?["Actions"]:[])].map((h,i)=>(
                        <th key={i} style={{padding:"11px 14px",textAlign:"left",color:"#94a3b8",fontSize:10,fontWeight:700,letterSpacing:.6,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visApps.map((a,idx)=>{
                      const assignedTo=Array.isArray(a.assignedTo)?a.assignedTo:[];
                      const seats=a.billingType==="flatInvoice"?1:assignedTo.length||1;
                      const total=(parseFloat(a.amount)||0)*seats;
                      return(
                        <tr key={a.id} style={{borderBottom:"1px solid #f8fafc"}}
                          onMouseOver={e=>e.currentTarget.style.background="#f8fafc"}
                          onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                          <td style={{padding:"12px 14px",color:"#94a3b8",fontSize:11,fontFamily:"'DM Mono',monospace"}}>{idx+1}</td>
                          <td style={{padding:"12px 14px"}}>
                            <div style={{fontWeight:700,color:"#0f172a",fontSize:13}}>{a.appName||"—"}</div>
                            {assignedTo.length>0&&<div style={{fontSize:11,color:"#64748b",marginTop:2}}>{assignedTo.slice(0,2).join(", ")}{assignedTo.length>2?` +${assignedTo.length-2} more`:""}</div>}
                          </td>
                          <td style={{padding:"12px 14px",fontSize:12,color:"#475569"}}>{a.category||<span style={{color:"#cbd5e1"}}>—</span>}</td>
                          <td style={{padding:"12px 14px"}}>
                            <div style={{fontSize:12,color:"#475569"}}>{a.planTier||"—"}</div>
                            <div style={{fontSize:11,color:"#94a3b8",marginTop:1,textTransform:"capitalize"}}>{a.billingCycle||""} · {a.billingType==="flatInvoice"?"Flat":"Per seat"}</div>
                          </td>
                          <td style={{padding:"12px 14px",fontSize:12,color:"#0f172a",fontWeight:600,fontFamily:"'DM Mono',monospace"}}>{seats}</td>
                          <td style={{padding:"12px 14px"}}>
                            <div style={{fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#0f172a",fontSize:13}}>{fmtAmt(total,a.currency)}</div>
                            <div style={{marginTop:3}}><CTag currency={a.currency}/></div>
                          </td>
                          <td style={{padding:"12px 14px",fontSize:12,fontFamily:"'DM Mono',monospace",color:"#374151"}}>{a.nextBillingDate?fmtDate(a.nextBillingDate):<span style={{color:"#cbd5e1"}}>—</span>}</td>
                          <td style={{padding:"12px 14px"}}><Pill text={a.payment||"pending"} color={PAY_CLR[a.payment]||"#94a3b8"}/></td>
                          <td style={{padding:"12px 14px"}}><Pill text={a.status||"active"} color={STA_CLR[a.status]||"#94a3b8"}/></td>
                          {canEdit&&<td style={{padding:"12px 14px"}}>
                            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                              <Btn sm onClick={()=>editApp(a)} color="#6366f1">Edit</Btn>
                              {a.payment!=="paid"&&<Btn sm onClick={()=>payApp(a.id)} color="#34d399">Pay</Btn>}
                              <Btn sm onClick={()=>setAppPayHist({id:a.id,label:a.appName})} color="#0284c7">History</Btn>
                              <ConfirmBtn onConfirm={()=>delApp(a.id)}/>
                            </div>
                          </td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {visApps.length===0&&<div style={{padding:40,textAlign:"center",color:"#94a3b8",fontSize:13}}>No app subscriptions match your filters.</div>}
            </div>

            {/* Spend by Person */}
            <div style={{marginTop:28}}>
              <h2 style={{fontSize:13,fontWeight:700,color:"#1e293b",marginBottom:14,textTransform:"uppercase",letterSpacing:.5}}>Spend by Person</h2>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
                {Object.entries(apps.reduce((acc,a)=>{
                  (Array.isArray(a.assignedTo)?a.assignedTo:[]).forEach(p=>{
                    if(!p)return;
                    if(!acc[p])acc[p]={};
                    acc[p][a.currency]=(acc[p][a.currency]||0)+(parseFloat(a.amount)||0);
                  });
                  return acc;
                },{})).sort((a,b)=>{
                  const sumA=Object.values(a[1]).reduce((s,v)=>s+v,0);
                  const sumB=Object.values(b[1]).reduce((s,v)=>s+v,0);
                  return sumB-sumA;
                }).map(([person,byCur])=>(
                  <div key={person} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:"13px 15px",boxShadow:"0 1px 4px rgba(0,0,0,.04)"}}>
                    <div style={{fontWeight:600,color:"#0f172a",fontSize:13,marginBottom:2}}>{person}</div>
                    <div style={{fontSize:11,color:"#94a3b8",marginBottom:8}}>{apps.filter(a=>(Array.isArray(a.assignedTo)?a.assignedTo:[]).includes(person)).length} apps</div>
                    {Object.entries(byCur).map(([cur,val])=>(
                      <div key={cur} style={{display:"flex",justifyContent:"space-between"}}>
                        <span style={{fontSize:10,color:"#94a3b8"}}>{cur}</span>
                        <span style={{fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#1e293b",fontSize:13}}>{fmtAmt(val,cur)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ════ ASSETS TAB ════ */}

        {qrAsset&&<AssetQRModal asset={qrAsset} onClose={()=>setQrAsset(null)}/>}
        {handoverLogId&&<HandoverLogModal assetId={handoverLogId} assetName={assets.find(a=>a.id===handoverLogId)?.name||handoverLogId} handovers={handovers} onClose={()=>setHandoverLogId(null)}/>}
        {tab==="assets"&&(
          <>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24,gap:16,flexWrap:"wrap"}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:800,color:"#0f172a",letterSpacing:-.5,marginBottom:4}}>Assets</h1>
                <p style={{fontSize:13,color:"#64748b"}}>Track hardware and equipment across your organisation</p>
              </div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                {canEdit&&<ImportBtn label="Import XLSX" color="#64748b" onFile={handleImportAssets}/>}
                {canEdit&&<button onClick={()=>setShowTypeEditor(v=>!v)} style={{padding:"10px 16px",background:showTypeEditor?"#eff6ff":"#f8fafc",border:showTypeEditor?"1px solid #bfdbfe":"1px solid #e2e8f0",borderRadius:10,color:showTypeEditor?"#2563eb":"#64748b",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>⚙ Manage Types</button>}
                {canEdit&&<button onClick={addAsset} style={{padding:"9px 18px",background:"#2563eb",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 8px rgba(37,99,235,.3)"}}>+ Add Asset</button>}
              </div>
            </div>
            {showTypeEditor&&(
              <div style={{marginBottom:24,padding:20,background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,boxShadow:"0 1px 6px rgba(0,0,0,.06)"}}>
                <div style={{fontSize:13,fontWeight:700,color:"#1e293b",marginBottom:14}}>Asset Type Manager</div>
                <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                  <input value={newTypeName} onChange={e=>setNewTypeName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addAssetType()} placeholder="New type name e.g. Projector" style={{...INP,maxWidth:260}}/>
                  <button onClick={addAssetType} style={{padding:"9px 16px",background:"#2563eb",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 1px 6px rgba(37,99,235,.3)"}}>Add Type</button>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {assetTypes.map(t=>(
                    <span key={t} style={{display:"inline-flex",alignItems:"center",gap:6,background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:8,padding:"5px 12px",fontSize:12,color:"#374151",fontWeight:500}}>
                      {t}<button onClick={()=>removeAssetType(t)} style={{background:"none",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:16,lineHeight:1,padding:0,fontFamily:"inherit"}}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:10,marginBottom:20,alignItems:"center",flexWrap:"wrap"}}>
              <StatCard label="Assigned" val={astStat.assigned} accent="#10b981"/>
              <StatCard label="Available" val={astStat.available} accent="#0284c7"/>
              <StatCard label="Total Purchase Value" val={fmtMulti(astStat.byCur)||"—"} accent="#6366f1" sub="Sum by original currency"/>
              <StatCard label={`≈ Total in ${displayCurrency}`} val={fmtAmt(assets.reduce((s,a)=>s+convertAmt(parseFloat(a.purchaseAmount)||0,a.currency,displayCurrency),0),displayCurrency)} accent="#4338ca" sub="Converted · approx rates"/>
              <div style={{marginLeft:"auto",padding:"8px 16px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,display:"flex",gap:6,alignItems:"center"}}>
                <span style={{fontSize:11,color:"#94a3b8",fontWeight:600}}>TOTAL</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:16,fontWeight:700,color:"#94a3b8"}}>{astStat.total}</span>
              </div>
            </div>

            {/* Assets by Type */}
            <div style={{marginBottom:24}}>
              <h2 style={{fontSize:13,fontWeight:700,color:"#1e293b",marginBottom:14,textTransform:"uppercase",letterSpacing:.5}}>Assets by Type</h2>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10}}>
                {Object.entries(assets.reduce((acc,a)=>{
                  acc[a.type]=(acc[a.type]||0)+1;
                  return acc;
                },{})).sort((a,b)=>b[1]-a[1]).map(([type,count])=>{

                  const assigned=assets.filter(a=>a.type===type&&a.assignedTo).length;
                  const available=count-assigned;
                  return(
                    <div key={type} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:12,padding:"14px 16px",display:"flex",flexDirection:"column",gap:6}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                        <div style={{fontWeight:700,color:"#0f172a",fontSize:13,lineHeight:1.2}}>{type}</div>
                      </div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:28,fontWeight:800,color:"#1e293b",letterSpacing:-1,lineHeight:1}}>{count}</div>
                      <div style={{display:"flex",gap:8,marginTop:2}}>
                        <span style={{fontSize:10,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:5,padding:"2px 7px",color:"#15803d",fontWeight:600}}>{assigned} assigned</span>
                        <span style={{fontSize:10,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:5,padding:"2px 7px",color:"#1d4ed8",fontWeight:600}}>{available} free</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"center"}}>
              <input value={astSearch} onChange={e=>setAstSearch(e.target.value)} placeholder="Search name, type, serial, person..." style={{...INP,maxWidth:280}}/>
              <select value={astFType} onChange={e=>setAstFType(e.target.value)} style={{...SEL,width:"auto",padding:"9px 13px"}}>
                <option value="all">All Types</option>
                {assetTypes.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
              <select value={astFStat} onChange={e=>setAstFStat(e.target.value)} style={{...SEL,width:"auto",padding:"9px 13px"}}>
                <option value="all">All Status</option>
                {ASSET_STATUS.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              <select value={astFAssign} onChange={e=>setAstFAssign(e.target.value)} style={{...SEL,width:"auto",padding:"9px 13px",borderColor:astFAssign!=="all"?"rgba(99,102,241,.5)":"#e2e8f0",color:astFAssign!=="all"?"#6366f1":"#1e293b"}}>
                <option value="all">All · Assigned &amp; Free</option>
                <option value="assigned">✓ Assigned only</option>
                <option value="unassigned">◆ Unassigned / Free</option>
              </select>
              <select value={astFDept} onChange={e=>setAstFDept(e.target.value)} style={{...SEL,width:"auto",padding:"9px 13px",borderColor:astFDept!=="all"?"rgba(99,102,241,.5)":"#e2e8f0",color:astFDept!=="all"?"#6366f1":"#1e293b"}}>
                <option value="all">All Departments</option>
                {depts.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
              <select value={astFBranch} onChange={e=>setAstFBranch(e.target.value)} style={{...SEL,width:"auto",padding:"9px 13px",borderColor:astFBranch!=="all"?"rgba(14,165,233,.5)":"#e2e8f0",color:astFBranch!=="all"?"#0284c7":"#1e293b"}}>
                <option value="all">All Branches</option>
                {branches.map(b=><option key={b} value={b}>{b}</option>)}
              </select>
              <span style={{fontSize:12,color:"#94a3b8"}}>{visAssets.length}/{assets.length}</span>
            </div>

            {/* Batch action bar */}
            {selectedAssets.length>0&&(
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,marginBottom:12}}>
                <span style={{fontSize:13,fontWeight:700,color:"#1d4ed8"}}>{selectedAssets.length} selected</span>
                <button onClick={()=>setSelectedAssets([])} style={{padding:"4px 10px",background:"none",border:"1px solid #bfdbfe",borderRadius:7,fontSize:12,color:"#64748b",cursor:"pointer",fontFamily:"inherit"}}>Clear</button>
                <button onClick={()=>setSelectedAssets(new Set(visAssets.map(a=>a.id)))} style={{padding:"4px 10px",background:"none",border:"1px solid #bfdbfe",borderRadius:7,fontSize:12,color:"#1d4ed8",cursor:"pointer",fontFamily:"inherit"}}>Select All ({visAssets.length})</button>
                {canEdit&&<ConfirmBtn label={`Delete ${selectedAssets.length}`} color="#ef4444" onConfirm={delSelectedAssets}/>}
              </div>
            )}
            <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,overflow:"hidden",boxShadow:"0 1px 6px rgba(0,0,0,.05)"}}>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,tableLayout:"fixed"}}>
                  <thead>
                    <tr style={{background:"#f8fafc",borderBottom:"1px solid #e8edf2"}}>
                      {canEdit&&<th style={{padding:"11px 8px 11px 13px",width:36,minWidth:36}}><input type="checkbox" checked={visAssets.length>0&&visAssets.every(a=>selectedAssets.includes(a.id))} onChange={e=>setSelectedAssets(e.target.checked?visAssets.map(a=>a.id):[])} style={{cursor:"pointer",accentColor:"#2563eb"}}/></th>}
                      {[
                        {h:"ID",w:80},
                        {h:"Asset Name / Specs",w:180},
                        {h:"Type",w:100},
                        {h:"Serial No / IMEI",w:130},
                        {h:"Purchase Price",w:120},
                        {h:`≈ ${CURRENCY_SYMBOLS[displayCurrency]||displayCurrency} (${displayCurrency})`,w:110},
                        {h:"Book Value",w:110},
                        {h:"Assigned To",w:140},
                        {h:"Branch",w:100},
                        {h:"Notes",w:160},
                        {h:"Status",w:90},
                        ...(canEdit?[{h:"Actions",w:120}]:[])
                      ].map(({h,w})=>(
                        <th key={h||"icon"} style={{padding:"11px 13px",textAlign:"left",color:"#94a3b8",fontSize:10,fontWeight:700,letterSpacing:.6,textTransform:"uppercase",borderBottom:"1px solid #f1f5f9",whiteSpace:"nowrap",minWidth:w,width:w}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visAssets.map(a=>{
                      const COND_CLR={new:"#059669",good:"#6366f1",fair:"#d97706",poor:"#dc2626"};
                      const STAT_CLR2={assigned:"#059669",available:"#2563eb","in repair":"#d97706",damaged:"#dc2626",retired:"#94a3b8"};

                      return(
                        <tr key={a.id} style={{borderBottom:"1px solid #f8fafc"}}>
                          {canEdit&&<td style={{padding:"10px 0 10px 13px",width:36,minWidth:36,verticalAlign:"middle"}}>
                            <input type="checkbox" checked={selectedAssets.includes(a.id)} onChange={e=>setSelectedAssets(e.target.checked?[...selectedAssets,a.id]:selectedAssets.filter(id=>id!==a.id))} style={{cursor:"pointer",accentColor:"#2563eb"}}/>
                          </td>}
                          <td style={{padding:"12px 13px",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#94a3b8",width:80,minWidth:80}}>
                            <div>{a.id}</div>
                            {(()=>{const _ap=Array.isArray(a.photos)?a.photos:typeof a.photos==='string'?a.photos.split('||').filter(Boolean):[];return _ap.length>0&&(
                              <span onClick={(e)=>{e.stopPropagation();setLightbox({photos:_ap,index:0});}} title={`View ${_ap.length} photo(s)`}
                                style={{fontSize:9,color:"#667eea",cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                                {_ap.length} photo{_ap.length>1?"s":""}
                              </span>
                            );})()}
                          </td>
                          <td style={{padding:"12px 13px",minWidth:160}}>
                              <div style={{fontWeight:600,color:"#0f172a",marginBottom:(a.specs&&a.specs.length>0)?4:0}}>{a.name}</div>
                              {(a.specs&&a.specs.length>0)&&<div style={{display:"flex",flexWrap:"wrap",gap:3}}>{a.specs.slice(0,3).map((s,i)=><span key={i} title={`${s.key}: ${s.val}`} style={{fontSize:10,background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:4,padding:"2px 7px",color:"#374151",fontWeight:500,whiteSpace:"nowrap"}}>{s.key}: <b>{s.val}</b></span>)}{a.specs.length>3&&<span style={{fontSize:10,color:"#94a3b8",padding:"2px 5px"}}>+{a.specs.length-3} more</span>}</div>}
                            </td>
                          <td style={{padding:"12px 13px",fontSize:12,color:"#475569"}}>{a.type||"—"}</td>
                          <td style={{padding:"12px 13px",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#64748b"}}>{a.serialNo||"—"}</td>
                          <td style={{padding:"12px 13px"}}>
                            {(() => {
                              const amt = parseFloat(a.purchaseAmount);
                              if(isNaN(amt)||amt<=0) return <span style={{color:"#cbd5e1",fontSize:12}}>—</span>;
                              const isSame = a.currency===displayCurrency;
                              const converted = convertAmt(amt, a.currency, displayCurrency);
                              return (
                                <div>
                                  <div style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:"#0f172a",fontSize:12}}>
                                    {fmtAmt(amt, a.currency)}
                                  </div>
                                  <div style={{marginTop:2}}><CTag currency={a.currency}/></div>
                                </div>
                              );
                            })()}
                          </td>
                          <td style={{padding:"12px 13px"}}>
                            {(() => {
                              const amt = parseFloat(a.purchaseAmount);
                              if(isNaN(amt)||amt<=0) return <span style={{color:"#cbd5e1",fontSize:12}}>—</span>;
                              if(a.currency===displayCurrency) return <span style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:"#0f172a",fontSize:12}}>{fmtAmt(amt,displayCurrency)}</span>;
                              const converted = convertAmt(amt, a.currency, displayCurrency);
                              return(
                                <div style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:"#374151",fontSize:12}}>
                                  {fmtAmt(converted, displayCurrency)}
                                  <div style={{fontSize:9,color:"#94a3b8",fontWeight:400,marginTop:1}}>approx</div>
                                </div>
                              );
                            })()}
                          </td>
                          <td style={{padding:"12px 13px"}}>
                            {(()=>{
                              const dep=calcDepreciation(a);
                              if(!dep) return <span style={{color:"#cbd5e1",fontSize:12}}>—</span>;
                              if(dep.fullyDepreciated) return <div><div style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:"#94a3b8",fontSize:12}}>{fmtAmt(0,a.currency)}</div><div style={{fontSize:10,color:"#dc2626",fontWeight:600}}>Fully depr.</div></div>;
                              return <div><div style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:"#059669",fontSize:12}}>{fmtAmt(dep.bookValue,a.currency)}</div><div style={{fontSize:10,color:"#64748b"}}>{dep.pct}% remaining</div></div>;
                            })()}
                          </td>
                          <td style={{padding:"12px 13px"}}>{a.assignedTo?<div><div style={{fontWeight:600,color:"#0f172a",fontSize:12}}>{a.assignedTo}</div><div style={{fontSize:11,color:"#6366f1",fontWeight:600}}>{a.dept}</div>{a.designation&&<div style={{fontSize:10,color:"#94a3b8"}}>{a.designation}</div>}</div>:<span style={{color:"#cbd5e1",fontSize:12}}>Unassigned</span>}</td>
                          <td style={{padding:"12px 13px",fontSize:12,color:"#64748b"}}>{a.branch||<span style={{color:"#cbd5e1"}}>—</span>}</td>
                          <td style={{padding:"12px 13px",maxWidth:220}}>
                            {a.notes
                              ?<div style={{fontSize:12,color:"#475569",lineHeight:1.5}}>{a.notes}</div>
                              :<span style={{fontSize:12,color:"#cbd5e1"}}>—</span>}
                          </td>
                          <td style={{padding:"12px 13px"}}><Pill text={a.status} color={STAT_CLR2[a.status]||"#94a3b8"}/></td>
                          <td style={{padding:"12px 13px"}}>
                              <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
                                {canEdit&&<><button onClick={()=>editAsset(a)} style={{padding:"4px 10px",background:"transparent",border:"1px solid #e2e8f0",borderRadius:6,color:"#374151",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}} onMouseOver={e=>{e.currentTarget.style.borderColor="#667eea";e.currentTarget.style.color="#667eea";}} onMouseOut={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#374151";}}>Edit</button><ConfirmBtn onConfirm={()=>delAsset(a.id)}/></>}
                                <button onClick={()=>setQrAsset(a)} style={{padding:"4px 10px",background:"transparent",border:"1px solid #e2e8f0",borderRadius:6,color:"#374151",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}} onMouseOver={e=>{e.currentTarget.style.borderColor="#667eea";e.currentTarget.style.color="#667eea";}} onMouseOut={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#374151";}}>QR</button>
                                <button onClick={()=>setAstHistoryId(a.id)} style={{padding:"4px 10px",background:"transparent",border:"1px solid #e2e8f0",borderRadius:6,color:"#374151",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}} onMouseOver={e=>{e.currentTarget.style.borderColor="#667eea";e.currentTarget.style.color="#667eea";}} onMouseOut={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#374151";}}>History</button>
                                <button onClick={()=>setHandoverLogId(a.id)} style={{padding:"4px 10px",background:"transparent",border:"1px solid #e2e8f0",borderRadius:6,color:"#374151",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}} onMouseOver={e=>{e.currentTarget.style.borderColor="#10b981";e.currentTarget.style.color="#10b981";}} onMouseOut={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#374151";}}>Log</button>
                              </div>
                              {(()=>{
                                // Show last edit info from audit log
                                const assetHistory = getAuditLog().filter(e=>e.entityType==="asset"&&e.entityId===a.id&&e.action==="update").slice(0,1);
                                const lastEntry = assetHistory[0];
                                if(!lastEntry && !a.lastEdited) return null;
                                const who = lastEntry ? (lastEntry.user||"unknown") : (a.lastEditedBy||"unknown");
                                const when = lastEntry ? lastEntry.ts : a.lastEdited;
                                const changedFields = lastEntry ? fmtChanges(lastEntry.changes).map(c=>c.field) : [];
                                const d = when ? new Date(when) : null;
                                const dateStr = d ? d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"2-digit"}) : "";
                                const timeStr = d ? d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:false}) : "";
                                return(
                                  <div title={`Last edited by ${who} on ${dateStr} ${timeStr}`}
                                    style={{marginTop:5,padding:"4px 7px",background:"#f8fafc",border:"1px solid #e8edf4",borderRadius:6,fontSize:9,color:"#64748b",lineHeight:1.4}}>
                                    <span style={{color:"#6366f1",fontWeight:700}}>{who}</span>
                                    <span style={{color:"#94a3b8",margin:"0 3px"}}>·</span>
                                    <span>{dateStr} {timeStr}</span>
                                    {changedFields.length>0&&<div style={{color:"#94a3b8",marginTop:1,fontSize:8}}>{changedFields.slice(0,3).join(", ")}{changedFields.length>3?` +${changedFields.length-3} more`:""}</div>}
                                  </div>
                                );
                              })()}
                            </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {visAssets.length===0&&<div style={{padding:40,textAlign:"center",color:"#94a3b8",fontSize:13}}>No assets match your filters.</div>}
            </div>
          </>
        )}
        {/* ════ USERS TAB ════ */}
        {tab==="users"&&isAdmin&&<UsersPanel appUsers={appUsers} setAppUsers={setAppUsers} saveAppUsers={saveAppUsers} showToast={showToast}/>}

        {/* ════ SETTINGS TAB ════ */}
        {tab==="settings"&&isAdmin&&<SettingsPage
          depts={depts} setDepts={setDepts} saveDepts={saveDepts}
          branches={branches} setBranches={setBranches} saveBranches={saveBranches}
          designations={designations} setDesignations={setDesignations} saveDesignations={saveDesignations}
          sims={sims} setSims={setSims} saveSims={saveSims}
          apps={apps} setApps={setApps} saveApps={saveApps}
          assets={assets} setAssets={setAssets} saveAssets={saveAssets}
          reminderEmail={reminderEmail} setReminderEmail={setReminderEmail}
          ejsService={ejsService} ejsTemplate={ejsTemplate} ejsKey={ejsKey}
          autoSentToday={autoSentToday} setAutoSentToday={setAutoSentToday}
          displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency}
          canEdit={canEdit} showToast={showToast}
        />}
      </main>

      {/* ════ ASSET MODAL ════ */}
      {canEdit&&astModal!==null&&(
        <Modal title={astModal==="add"?"Add Asset":"Edit Asset"} onClose={()=>setAstModal(null)} wide>
          {/* Assigned / Unassigned toggle */}
          <div style={{display:"flex",gap:0,marginBottom:18,background:"#f1f5f9",borderRadius:10,padding:2}}>
            {[{v:"assigned",label:"✓ Assigned to Employee"},{v:"available",label:"◆ Unassigned / Available"}].map(({v,label})=>(
              <button key={v} onClick={()=>setAstForm({...astForm,status:v,assignedTo:v==="assigned"?astForm.assignedTo:"",dept:v==="assigned"?astForm.dept:""})}
                style={{flex:1,padding:"8px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,transition:"all .15s",
                  background:astForm.status===v?"rgba(59,130,246,.12)":"transparent",
                  color:astForm.status===v?"#1d4ed8":"#94a3b8"}}>
                {label}
              </button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <FR label="Asset ID"><input value={astForm.id||""} onChange={e=>setAstForm({...astForm,id:e.target.value.toUpperCase().replace(/\s/g,"")})} placeholder="e.g. AST001" style={{...INP,fontFamily:"'DM Mono',monospace",letterSpacing:.5}}/></FR>
            <FR label="Asset Type"><select value={astForm.type} onChange={e=>setAstForm({...astForm,type:e.target.value})} style={SEL}>{assetTypes.map(t=><option key={t} value={t}>{t}</option>)}</select></FR>
            <FR label="Asset Name *"><input value={astForm.name} onChange={e=>setAstForm({...astForm,name:e.target.value})} placeholder="e.g. MacBook Pro 14" style={INP}/></FR>
            <FR label="Serial No / IMEI Number"><input value={astForm.serialNo} onChange={e=>setAstForm({...astForm,serialNo:e.target.value})} placeholder="SN-XXXX-001 or IMEI" style={INP}/></FR>
            <FR label="Purchase Date"><input type="date" value={astForm.purchaseDate||""} onChange={e=>setAstForm({...astForm,purchaseDate:e.target.value})} style={{...INP,colorScheme:"dark"}}/></FR>
            <FR label="Warranty Expiry Date"><input type="date" value={astForm.warrantyDate||""} onChange={e=>setAstForm({...astForm,warrantyDate:e.target.value})} style={{...INP,colorScheme:"dark"}}/></FR>
            <FR label="Purchase Price (Original)"><input type="number" value={astForm.purchaseAmount||""} onChange={e=>setAstForm({...astForm,purchaseAmount:e.target.value})} placeholder="0" style={INP}/></FR>
            <FR label="Currency"><select value={astForm.currency} onChange={e=>setAstForm({...astForm,currency:e.target.value})} style={SEL}>{ALL_CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</select></FR>
            {astForm.status==="assigned"&&<>
              <FR label="Assigned To *"><input value={astForm.assignedTo||""} onChange={e=>setAstForm({...astForm,assignedTo:e.target.value})} list="emp-list-ast" placeholder="Employee full name" style={{...INP,borderColor:"rgba(99,102,241,.4)"}} onBlur={e=>{const emp=employees.find(x=>x.name===e.target.value);if(emp){setAstForm(f=>({...f,assignedTo:emp.name,dept:f.dept||emp.dept||"",branch:f.branch||emp.branch||""}));}}} /><datalist id="emp-list-ast">{employees.map(e=><option key={e.id} value={e.name}/>)}</datalist></FR>
              <FR label="Department"><DeptSelect value={astForm.dept||""} onChange={v=>setAstForm({...astForm,dept:v})} depts={depts}/></FR>
              <FR label="Branch"><BranchSelect value={astForm.branch||""} onChange={v=>setAstForm({...astForm,branch:v})} branches={branches}/></FR>
              <FR label="Designation"><DesignationSelect value={astForm.designation||""} onChange={v=>setAstForm({...astForm,designation:v})} designations={designations}/></FR>
            </>}
            {astForm.status!=="assigned"&&<>
              <FR label="Status"><select value={astForm.status} onChange={e=>setAstForm({...astForm,status:e.target.value})} style={SEL}>{ASSET_STATUS.filter(s=>s!=="assigned").map(s=><option key={s} value={s}>{s}</option>)}</select></FR>
            </>}
            <FR label="Condition"><select value={astForm.condition} onChange={e=>setAstForm({...astForm,condition:e.target.value})} style={SEL}>{ASSET_CONDITION.map(c=><option key={c} value={c}>{c}</option>)}</select></FR>
            <div style={{gridColumn:"1/-1"}}><FR label="Notes"><input value={astForm.notes||""} onChange={e=>setAstForm({...astForm,notes:e.target.value})} placeholder="Any additional details..." style={INP}/></FR></div>
            {/* ── Specs ── */}
            <div style={{gridColumn:"1/-1",marginTop:4}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <label style={{...LBL,marginBottom:0}}>Specs</label>
                <div style={{display:"flex",gap:6}}>
                  {(SPEC_PRESETS[astForm.type]||[]).filter(p=>!(astForm.specs||[]).some(s=>s.key===p)).map(preset=>(
                    <button key={preset} type="button"
                      onClick={()=>setAstForm(f=>({...f,specs:[...(f.specs||[]),{key:preset,val:""}]}))}
                      style={{padding:"3px 10px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:6,fontSize:11,color:"#2563eb",fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>
              {(astForm.specs||[]).length>0?(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {(astForm.specs||[]).map((spec,idx)=>(
                    <div key={idx} style={{display:"flex",gap:6,alignItems:"center"}}>
                      <input value={spec.key} onChange={e=>{const s=[...(astForm.specs||[])];s[idx]={...s[idx],key:e.target.value};setAstForm(f=>({...f,specs:s}));}}
                        placeholder="Field (e.g. RAM)" style={{...INP,width:120,flexShrink:0,fontSize:12,padding:"7px 10px"}}/>
                      <input value={spec.val} onChange={e=>{const s=[...(astForm.specs||[])];s[idx]={...s[idx],val:e.target.value};setAstForm(f=>({...f,specs:s}));}}
                        placeholder="Value (e.g. 16 GB)" style={{...INP,flex:1,fontSize:12,padding:"7px 10px"}}/>
                      <button onClick={()=>setAstForm(f=>({...f,specs:(f.specs||[]).filter((_,i)=>i!==idx)}))}
                        style={{background:"none",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:16,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
                    </div>
                  ))}
                </div>
              ):(
                <div style={{border:"1px dashed #e2e8f0",borderRadius:10,padding:"16px",textAlign:"center",color:"#94a3b8",fontSize:12}}>
                  No specs added. Click preset fields above or add custom below.
                </div>
              )}
              <button type="button" onClick={()=>setAstForm(f=>({...f,specs:[...(f.specs||[]),{key:"",val:""}]}))}
                style={{marginTop:8,padding:"6px 14px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,color:"#64748b",fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                + Add Custom Field
              </button>
            </div>

            <div style={{gridColumn:"1/-1"}}>
              <label style={LBL}>Asset Photos <span style={{color:"#cbd5e1",fontWeight:400,textTransform:"none",letterSpacing:0}}>— up to 10 · hosted on ImgBB</span></label>
              {!IMGBB_KEY&&(
                <div style={{marginBottom:10,padding:"8px 12px",background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:8,fontSize:11,color:"#c2410c",fontWeight:600}}>
                  ⚠️ ImgBB API key not set in config.js — photos cannot be saved. Add your key at <span style={{textDecoration:"underline"}}>imgbb.com</span> → API.
                </div>
              )}
              {(()=>{const _prevPhotos=Array.isArray(astForm.photos)?astForm.photos:typeof astForm.photos==='string'?astForm.photos.split('||').filter(Boolean):[];return _prevPhotos.length>0&&(
                <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
                  {_prevPhotos.map((src,i)=>{
                    const isLocal=src.startsWith('data:');
                    return(
                    <div key={i} style={{position:"relative",width:72,height:72}}>
                      <img src={src} alt={`photo ${i+1}`}
                        onClick={()=>setLightbox({photos:_prevPhotos,index:i})}
                        style={{width:72,height:72,borderRadius:10,objectFit:"cover",border:`1px solid ${isLocal?"#fbbf24":"rgba(99,102,241,.4)"}`,cursor:"zoom-in"}}/>
                      {isLocal&&<div style={{position:"absolute",bottom:3,left:3,right:3,borderRadius:4,background:"rgba(180,83,9,.85)",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:8,color:"#fff",fontWeight:700,padding:"1px 3px"}}>local only</span></div>}
                      <button onClick={()=>setAstForm(f=>{const p=Array.isArray(f.photos)?f.photos:typeof f.photos==='string'?f.photos.split('||').filter(Boolean):[];return {...f,photos:p.filter((_,j)=>j!==i)};} )}
                        style={{position:"absolute",top:-6,right:-6,width:18,height:18,borderRadius:999,background:"#ef4444",border:"none",color:"#fff",cursor:"pointer",fontSize:12,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>×</button>
                      {i===0&&<span style={{position:"absolute",bottom:isLocal?16:3,left:3,background:"rgba(0,0,0,.6)",color:"#fff",fontSize:8,fontWeight:700,borderRadius:4,padding:"1px 4px"}}>MAIN</span>}
                    </div>
                    );
                  })}
                </div>
              );})()}
              {(()=>{const _photos=Array.isArray(astForm.photos)?astForm.photos:typeof astForm.photos==='string'?astForm.photos.split('||').filter(Boolean):[];const _plen=_photos.length;return(
              <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <label style={{display:"inline-flex",alignItems:"center",gap:8,padding:"9px 16px",
                  background:photoUploading||_plen>=10?"#f1f5f9":"rgba(99,102,241,.1)",
                  border:photoUploading||_plen>=10?"1px solid #e2e8f0":"1px solid rgba(99,102,241,.3)",
                  borderRadius:10,color:photoUploading||_plen>=10?"#cbd5e1":"#6366f1",fontSize:12,fontWeight:600,
                  cursor:photoUploading||_plen>=10?"not-allowed":"pointer"}}>
                  {photoUploading?<span style={{display:"inline-block",width:12,height:12,border:"2px solid #6366f1",borderTopColor:"transparent",borderRadius:999,animation:"spin .8s linear infinite"}}/>:
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
                  {photoUploading?"Uploading…":_plen>=10?"Limit reached":_plen>0?"Add More Photos":"Upload Photos"}
                  <input type="file" accept="image/*" multiple disabled={photoUploading||_plen>=10} style={{display:"none"}} onChange={e=>handlePhotoUpload(e.target.files)}/>
                </label>
                {_plen>0&&<button onClick={()=>setAstForm(f=>({...f,photos:[]}))} style={{background:"none",border:"none",color:"#f87171",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Clear All</button>}
                <span style={{fontSize:11,color:"#94a3b8"}}>{_plen}/10</span>
              </div>
              )})()}
            </div>
          </div>
          <button onClick={saveAsset} style={{width:"100%",marginTop:16,padding:"12px",background:"#2563eb",border:"none",borderRadius:12,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 8px rgba(37,99,235,.3)"}}>
            {astModal==="add"?"Add Asset":"Save Changes"}
          </button>
        </Modal>
      )}

      {/* ════ SIM MODAL ════ */}
      {canEdit&&sModal!==null&&(
        <Modal title={sModal==="add"?"Add SIM Plan":`Edit ${sModal.id||""}`} onClose={()=>setSModal(null)}>
          {/* Assigned / Unassigned toggle */}
          <div style={{display:"flex",gap:0,marginBottom:18,background:"#f1f5f9",borderRadius:10,padding:2}}>
            {[{v:true,label:"✓ Assigned to Employee"},{v:false,label:"◆ Unassigned / Pool"}].map(({v,label})=>(
              <button key={String(v)} onClick={()=>setSForm({...sForm,employee:v?sForm.employee:"",dept:v?sForm.dept:"",branch:v?sForm.branch:""})}
                style={{flex:1,padding:"8px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,transition:"all .15s",
                  background:(!!sForm.employee)===v?"rgba(99,102,241,.25)":"transparent",
                  color:(!!sForm.employee)===v?"#2563eb":"#94a3b8"}}>
                {label}
              </button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <FR label={sForm.employee||sModal!=="add"?"Assigned To (Employee)":"Assigned To (Employee) (optional)"}><input value={sForm.employee} onChange={e=>setSForm({...sForm,employee:e.target.value})} list="emp-list-sim" placeholder={sForm.employee?"Full name":"Leave blank for pool SIM"} style={{...INP,borderColor:sForm.employee?"#e2e8f0":"rgba(99,102,241,.35)"}} onBlur={e=>{const emp=employees.find(x=>x.name===e.target.value);if(emp){setSForm(f=>({...f,employee:emp.name,dept:f.dept||emp.dept||"",branch:f.branch||emp.branch||""}));}}} /><datalist id="emp-list-sim">{employees.map(e=><option key={e.id} value={e.name}/>)}</datalist></FR>
            <FR label="Name on Record"><input value={sForm.nameOnRecord||""} onChange={e=>setSForm({...sForm,nameOnRecord:e.target.value})} placeholder="Person in whose name SIM is registered" style={{...INP,borderColor:"rgba(251,191,36,.3)"}}/></FR>
            <FR label="Department"><DeptSelect value={sForm.dept} onChange={v=>setSForm({...sForm,dept:v})} depts={depts}/></FR>
            <FR label="Branch"><BranchSelect value={sForm.branch||""} onChange={v=>setSForm({...sForm,branch:v})} branches={branches}/></FR>
            <FR label="Designation"><DesignationSelect value={sForm.designation||""} onChange={v=>setSForm({...sForm,designation:v})} designations={designations}/></FR>
            <FR label="Phone Number"><input value={sForm.number} onChange={e=>setSForm({...sForm,number:e.target.value})} placeholder="+91 98100 00000" style={INP}/></FR>
            <FR label="Carrier"><select value={sForm.carrier} onChange={e=>setSForm({...sForm,carrier:e.target.value})} style={SEL}>{CARRIERS.map(c=><option key={c} value={c}>{c}</option>)}</select></FR>
            <FR label="Plan Name"><input value={sForm.planName} onChange={e=>setSForm({...sForm,planName:e.target.value})} placeholder="e.g. Airtel 599" style={INP}/></FR>
            <FR label="Next Billing Date"><input type="date" value={sForm.nextBillingDate||""} onChange={e=>setSForm({...sForm,nextBillingDate:e.target.value})} style={{...INP,colorScheme:"dark"}}/></FR>
            <FR label="Amount *"><input type="number" value={sForm.amount} onChange={e=>setSForm({...sForm,amount:e.target.value})} placeholder="0.00" style={INP}/></FR>
            <FR label="Currency"><select value={sForm.currency} onChange={e=>setSForm({...sForm,currency:e.target.value})} style={SEL}>{ALL_CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</select></FR>
            <FR label="Status"><select value={sForm.status} onChange={e=>setSForm({...sForm,status:e.target.value})} style={SEL}>{["active","suspended","inactive"].map(s=><option key={s} value={s}>{s}</option>)}</select></FR>
            <FR label="Payment"><select value={sForm.payment} onChange={e=>setSForm({...sForm,payment:e.target.value})} style={SEL}>{["paid","pending","overdue"].map(s=><option key={s} value={s}>{s}</option>)}</select></FR>
          </div>
          <button onClick={saveSim} style={{width:"100%",marginTop:8,padding:"12px",background:"#2563eb",border:"none",borderRadius:12,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 8px rgba(37,99,235,.3)"}}>
            {sModal==="add"?"Add SIM Plan":"Save Changes"}
          </button>
        </Modal>
      )}

      {/* ════ APP MODAL ════ */}
      {canEdit&&aModal!==null&&(
        <Modal title={aModal==="add"?"Add App Subscription":`Edit ${aModal.appName||""}`} onClose={()=>setAModal(null)} wide>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <FR label="App Name *"><input value={aForm.appName} onChange={e=>setAForm({...aForm,appName:e.target.value})} placeholder="e.g. Slack" style={INP}/></FR>
            <FR label="Plan Tier"><input value={aForm.planTier} onChange={e=>setAForm({...aForm,planTier:e.target.value})} placeholder="e.g. Pro, Team, Business" style={INP}/></FR>
            <FR label="Billing Type"><select value={aForm.billingType||"perUser"} onChange={e=>setAForm({...aForm,billingType:e.target.value})} style={SEL}><option value="perUser">Per User</option><option value="flatInvoice">Flat Invoice</option></select></FR>
            <FR label="Billing Cycle"><select value={aForm.billingCycle||"monthly"} onChange={e=>setAForm({...aForm,billingCycle:e.target.value})} style={SEL}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></FR>
            <FR label="Payment Mode">
              <div style={{display:"flex",gap:0,background:"#f1f5f9",borderRadius:10,padding:2}}>
                {[{v:"manual",label:"Manual Pay"},{v:"autopay",label:"Auto Pay"}].map(({v,label})=>(
                  <button key={v} onClick={()=>setAForm({...aForm,payMode:v})}
                    style={{flex:1,padding:"8px 10px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,transition:"all .15s",
                      background:aForm.payMode===v?(v==="autopay"?"rgba(52,211,153,.25)":"rgba(99,102,241,.25)"):"transparent",
                      color:aForm.payMode===v?(v==="autopay"?"#059669":"#6366f1"):"#94a3b8"}}>
                    {label}
                  </button>
                ))}
              </div>
              {aForm.payMode==="autopay"&&<div style={{fontSize:10,color:"#059669",marginTop:5,fontWeight:600}}>Autopay — billing reminders suppressed</div>}
            </FR>
            <FR label={aForm.billingType==="flatInvoice"?"Invoice Amount *":"Amount per seat *"}><input type="number" value={aForm.amount} onChange={e=>setAForm({...aForm,amount:e.target.value})} placeholder="0.00" style={INP}/></FR>
            <FR label="Currency"><select value={aForm.currency} onChange={e=>setAForm({...aForm,currency:e.target.value})} style={SEL}>{ALL_CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</select></FR>
            <FR label="Next Billing Date"><input type="date" value={aForm.nextBillingDate||""} onChange={e=>setAForm({...aForm,nextBillingDate:e.target.value})} style={{...INP,colorScheme:"dark"}}/></FR>
            <FR label="Category"><select value={aForm.category} onChange={e=>setAForm({...aForm,category:e.target.value})} style={SEL}>{CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></FR>
            <FR label="Payment Status"><select value={aForm.payment} onChange={e=>setAForm({...aForm,payment:e.target.value})} style={SEL}>{["paid","pending","overdue"].map(s=><option key={s} value={s}>{s}</option>)}</select></FR>
            <FR label="App Status"><select value={aForm.status||"active"} onChange={e=>setAForm({...aForm,status:e.target.value})} style={SEL}>{["active","inactive"].map(s=><option key={s} value={s}>{s}</option>)}</select></FR>
          </div>
          <div style={{marginTop:16,padding:16,background:"#f8fafc",borderRadius:12,border:"1px solid #e2e8f0"}}>
            <label style={LBL}>Assigned People</label>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <input value={aForm.newPerson} onChange={e=>setAForm({...aForm,newPerson:e.target.value})}
                onKeyDown={e=>e.key==="Enter"&&addPerson()} placeholder="Type name + Enter to add…" style={{...INP,flex:1}}/>
              <Btn onClick={addPerson} color="#6366f1">Add</Btn>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
              {(Array.isArray(aForm.assignedTo)?aForm.assignedTo:[]).map((p,i)=>(
                <span key={i} style={{display:"inline-flex",alignItems:"center",gap:6,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:999,padding:"4px 12px",fontSize:12,color:"#2563eb"}}>
                  {p}<button onClick={()=>remPerson(i)} style={{background:"none",border:"none",color:"#93c5fd",cursor:"pointer",fontSize:15,lineHeight:1,padding:0,fontFamily:"inherit"}}>×</button>
                </span>
              ))}
              {(Array.isArray(aForm.assignedTo)?aForm.assignedTo:[]).length===0&&<span style={{fontSize:12,color:"#94a3b8",fontStyle:"italic"}}>No people added yet</span>}
            </div>
          </div>
          <button onClick={saveApp} style={{width:"100%",marginTop:16,padding:"12px",background:"#2563eb",border:"none",borderRadius:12,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 8px rgba(37,99,235,.3)"}}>
            {aModal==="add"?"Add App Subscription":"Save Changes"}
          </button>
        </Modal>
      )}

      {simPayHist&&<PayHistoryModal entityType="sim" entityId={simPayHist.id} entityLabel={simPayHist.label} onClose={()=>setSimPayHist(null)}/>}
      {appPayHist&&<PayHistoryModal entityType="app" entityId={appPayHist.id} entityLabel={appPayHist.label} onClose={()=>setAppPayHist(null)}/>}
      {astHistoryId&&(()=>{const a=assets.find(x=>x.id===astHistoryId);return<AssetHistoryModal assetId={astHistoryId} assetName={a?a.name:astHistoryId} onClose={()=>setAstHistoryId(null)}/>;})()}
      {lightbox&&<PhotoLightbox photos={lightbox.photos} startIndex={lightbox.index} onClose={()=>setLightbox(null)}/>}
      <ImportToast msg={toast.msg} ok={toast.ok}/>
    </div>
  );
}

export default App;
