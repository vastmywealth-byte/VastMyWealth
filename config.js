/* ============================================================
   VastMyWealth — central configuration.
   Change a URL HERE and every page (customer, banker, partner,
   vehicle/education) picks it up. Never paste URLs into pages.
   ============================================================ */
window.VMW_CONFIG = {
  // Apps Script Web App (/exec) — the ONE backend for every page
  BACKEND_URL: "https://script.google.com/macros/s/AKfycbwGTSTzKTJYrhx2wP3UuBPG_64g-ZczNPhem3-PfcPPu8AYQaT0MvSgz1FsyRdoonVndg/exec",

  // The ONE live application page. Customers, bankers and partners all use it.
  APPLY_URL: "https://loan.vastmywealth.com/apply.html",
  VL_EL_URL: "https://loan.vastmywealth.com/vl-el-application.html",

  WHATSAPP_NUMBER: "919594592020",
  SUPPORT_MOBILE: "9594592020",
  PARTNER_TERMS_URL: "https://loan.vastmywealth.com/partner-terms.pdf"
};
