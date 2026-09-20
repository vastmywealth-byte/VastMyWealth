/* ============================================================
   VastMyWealth — central configuration.
   Change a value HERE and every page picks it up.

   IMPORTANT: application links (Follow Up, Start/Continue, personal
   referral link) are built from the address THIS page is served from.
   So a banker/partner page always opens the application page that sits
   next to it — never a copy hosted on another domain.
   ============================================================ */
(function () {
  // Leave empty to auto-detect. Only fill this if you ever want links to point
  // to a different public address, e.g. "https://your-site.com/" (keep the trailing /)
  var SITE_OVERRIDE = "";

  // folder this page is served from, e.g. "https://example.com/" or "https://user.github.io/repo/"
  var here = String(location.href).split('#')[0].split('?')[0];
  var base = SITE_OVERRIDE || here.replace(/[^\/]*$/, '');

  window.VMW_CONFIG = {
    // Apps Script Web App (/exec) — the ONE backend for every page
    BACKEND_URL: "https://script.google.com/macros/s/AKfycbwGTSTzKTJYrhx2wP3UuBPG_64g-ZczNPhem3-PfcPPu8AYQaT0MvSgz1FsyRdoonVndg/exec",

    SITE_URL: base,
    APPLY_URL: base + "apply.html",
    VL_EL_URL: base + "vl-el-application.html",

    WHATSAPP_NUMBER: "919594592020",
    SUPPORT_MOBILE: "9594592020",
    PARTNER_TERMS_URL: "https://loan.vastmywealth.com/partner-terms.pdf"
  };
})();
