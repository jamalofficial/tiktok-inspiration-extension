// ---- SPA navigation observer for TikTok ----
let lastUrl = location.href;
let __scrapingInProgress = false;
let __waitingForNextPage = false;

// Helper: Wait for table rows or tbody node to change (after Next)
async function waitForTableChange(oldRows, timeout = 30000) {
  console.log('[LOG] waitForTableChange: Waiting for table to change...');
  // Wait for tbody to appear if not present
  let tbody = document.querySelector('[class*="--Tbody"]');
  const start = Date.now();
  while (!tbody && Date.now() - start < timeout) {
    await new Promise(res => setTimeout(res, 200));
    tbody = document.querySelector('[class*="--Tbody"]');
  }
  if (!tbody) {
    console.log('[LOG] waitForTableChange: No tbody found after waiting');
    throw 'No tbody found';
  }
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer;
    let observer;
    let parentObserver;
    let pollInterval;

    function cleanup() {
      if (observer) observer.disconnect();
      if (parentObserver) parentObserver.disconnect();
      if (pollInterval) clearInterval(pollInterval);
      if (timer) clearTimeout(timer);
    }

    timer = setTimeout(() => {
      finished = true;
      cleanup();
      console.log('[LOG] waitForTableChange: Timeout waiting for table change');
      reject('Timeout waiting for table change');
    }, timeout);

    // Helper to get row texts
    function getRowTexts() {
      return [...document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']")].map(r => r.innerText.trim());
    }

    let oldRowNodes = oldRows || [];
    let oldRowTexts = oldRowNodes.map(r => r.innerText.trim());
    console.log('[LOG] waitForTableChange: oldRowTexts:', oldRowTexts);

    function attachObserverToTbody(tbody) {
      if (observer) observer.disconnect();
      observer = new MutationObserver(() => {
        const newRows = [...document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']")];
        const newRowTexts = newRows.map(r => r.innerText.trim());
        console.log('[LOG] waitForTableChange: newRowTexts:', newRowTexts);
        if (
          newRowTexts.length !== oldRowTexts.length ||
          newRowTexts.join('|') !== oldRowTexts.join('|')
        ) {
          if (!finished) {
            finished = true;
            cleanup();
            console.log('[LOG] waitForTableChange: Table row texts changed, resuming.');
            resolve();
          }
        }
      });
      observer.observe(tbody, {childList: true, subtree: true, attributes: true});
    }

    let tbody = document.querySelector('[class*="--Tbody"]');
    if (tbody) attachObserverToTbody(tbody);

    // Also observe for tbody node being replaced
    const parent = tbody ? tbody.parentNode : null;
    if (parent) {
      parentObserver = new MutationObserver(() => {
        const newTbody = document.querySelector('[class*="--Tbody"]');
        if (newTbody !== tbody && newTbody) {
          console.log('[LOG] waitForTableChange: Tbody node replaced, re-attaching observer.');
          tbody = newTbody;
          attachObserverToTbody(tbody);
        }
      });
      parentObserver.observe(parent, {childList: true, subtree: false});
    }

    // Fallback: poll for row text changes every 500ms
    pollInterval = setInterval(() => {
      if (finished) return;
      const newRowTexts = getRowTexts();
      if (
        newRowTexts.length !== oldRowTexts.length ||
        newRowTexts.join('|') !== oldRowTexts.join('|')
      ) {
        finished = true;
        cleanup();
        console.log('[LOG] waitForTableChange: Table row texts changed (poll fallback), resuming.');
        resolve();
      }
    }, 500);
  });
}

// SPA navigation: Watch for URL or table changes
// 1. Watch for URL changes (for detail/search switch)
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    console.log('[LOG] MutationObserver: URL changed from', lastUrl, 'to', location.href);
    lastUrl = location.href;
    if (__running && !__scrapingInProgress) {
      console.log('[LOG] MutationObserver: Detected URL change, waiting for table change...');
      __waitingForNextPage = true;
      waitForTableChange().then(() => {
        __waitingForNextPage = false;
        console.log('[LOG] MutationObserver: Table change detected, calling processResults()');
        processResults();
      }).catch((err) => {
        __waitingForNextPage = false;
        console.log('[LOG] MutationObserver: Table change error:', err);
      });
    }
  }
}).observe(document, {subtree: true, childList: true});

// 2. Watch for table row changes (pagination) even if URL does not change
function observeTableForPagination() {
  let lastRowTexts = [];
  let tbody = document.querySelector('[class*="--Tbody"]');
  if (!tbody) return;
  const observer = new MutationObserver(() => {
    const rows = [...document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']")];
    const rowTexts = rows.map(r => r.innerText.trim());
    if (rowTexts.length && rowTexts.join('|') !== lastRowTexts.join('|')) {
      console.log('[LOG] Table MutationObserver: Table rows changed (pagination detected).');
      lastRowTexts = rowTexts;
      if (__running && !__scrapingInProgress && !__waitingForNextPage) {
        processResults();
      }
    }
  });
  observer.observe(tbody, {childList: true, subtree: true});
}

// Start observing table for pagination after DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observeTableForPagination);
} else {
  observeTableForPagination();
}

let __collected_data = [];
let __progress = { page: 0, row: 0 };
let __running = false;
let __finished = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(selector, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el) return el;
    await sleep(300);
  }
  throw new Error(`Timeout: ${selector} not found`);
}

// ---- messaging helpers ----
function saveState() {
  chrome.runtime.sendMessage({
    action: "saveState",
    data: {
      collectedData: __collected_data,
      progress: __progress,
      running: __running,
    },
  });
}

function sendLog() {
  console.log("Sending log to server...");

  // Get the current URL
  const url = new URL(window.location.href);
  // Get all query parameters
  const params = new URLSearchParams(url.search);
  // Example: Get a specific query parameter
  const keyword = params.get('keyword');
  
  chrome.runtime.sendMessage({
    action: "sendLog",
    data: {
      keyword: keyword || "",
    }
  });
}

function loadState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "loadState" }, resolve);
  }).then((result) => {
    __collected_data = result.collectedData || [];
    __progress = result.progress || { page: 0, row: 0 };
    __running = result.running || false;
  });
}

// ---- scraping logic ----
async function scrapePageData() {
  let data = {};

  // Topic title (top H1-like span)
  const titleEl = document.querySelector("span.TUXText--weight-bold");
  data.title = titleEl?.innerText.trim() || "";

  // Search popularity main number (e.g. 172K)
  const popularityEl = document.querySelector("span.TUXText--weight-bold[style*='32px']");
  data.searchPopularity = popularityEl?.innerText.trim() || "";

  // Search popularity % (64.1%)
  const trendPercentEl = document.querySelector("div[class*='DetailTrendDiv'] span");
  data.trendPercent = trendPercentEl?.innerText.trim() || "";

  // Related topics (bottom chart keyword divs)
  const relatedEls = document.querySelectorAll("div[class*='KeywordDiv'] span");
  data.relatedTopics = Array.from(relatedEls).map(el => el.innerText.trim());

  // locations data
  const locations = document.querySelectorAll("[class*='--BarChartContainer'] [class*='--BarItemContainer']");
  data.locations = Array.from(locations).map(locEl => {
    const loc_div = locEl.children[0];
    return { name: loc_div.children[0].innerText.trim(), value: loc_div.children[1].innerText.trim()};
  });

  // demographics data
  const demographics = document.querySelectorAll("[class*='--ExposureWrapper'] [class*='--LegendItemContainer']");
  data.demographics = Array.from(demographics).map(demoEl => {
    const demo_div = demoEl.children[0];
    return { name: demo_div.children[1].innerText.trim(), value: demoEl.children[1].innerText.trim()};
  });

  data.url = window.location.href;


  return data;
}


async function processResults() {
  if (__scrapingInProgress || __waitingForNextPage) {
    console.log('[LOG] processResults: Scraping already in progress or waiting for next page, skipping duplicate call.');
    return;
  }
  __scrapingInProgress = true;
  try {
    console.log('[LOG] processResults: Starting automation...');
    await loadState();
    // Wait for rows to appear (ensures next page is loaded)
    await waitFor("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']", 15000);
    let rows = [...document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']")];
    console.log('[LOG] processResults: rows', rows.map(r => r.innerText.trim()));

    // Only process 3 rows per page
    const maxRowsPerPage = 3;
    for (let i = __progress.row; i < Math.min(rows.length, maxRowsPerPage); i++) {
      const temp_rows = [...document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']")];
      console.log(`[LOG] processResults: Clicking row ${i}`);
      temp_rows[i].click();
      await sleep(10000);
      const data = await scrapePageData();
      console.log('[LOG] processResults: Scraped data', data);
      __collected_data.push(data);
      __progress.row = i + 1;
      saveState();
      window.history.back();
      await sleep(10000);
    }
    // If we processed 3 rows, reset row progress for next page
    if (__progress.row >= maxRowsPerPage) {
      __progress.row = 0;
    }

    // Try to go to next page if there is a next button
    const paginDiv = document.querySelector('[class*="--PaginationContainerDiv"]');
    let nextBtn = null;
    if (paginDiv) {
      // Find the button with aria-disabled="false" and not disabled
      nextBtn = Array.from(paginDiv.querySelectorAll('button')).find(
        btn => btn.getAttribute('aria-disabled') === 'false' && !btn.disabled
      );
    }
    if (nextBtn) {
      console.log('[LOG] processResults: Next button found, attempting to click:', nextBtn);
      // Save state before navigation
      __progress.page += 1;
      __progress.row = 0;
      saveState();
      let oldRows = rows;
      nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      __waitingForNextPage = true;
      waitForTableChange(oldRows).then(() => {
        __waitingForNextPage = false;
        console.log('[LOG] processResults: Table change detected after Next, calling processResults()');
        processResults();
      }).catch((err) => {
        __waitingForNextPage = false;
        console.log('[LOG] processResults: Table change error after Next:', err);
        // If timeout or table did not change, treat as end of pagination
        alert("Automation finished (no more pages or table did not update). You can download JSON now.");
        __running = false;
        saveState();
        sendLog();
      });
      return;
    } else {
      // If no more pages, finish
      alert("Automation finished, you can download JSON now.");
      __running = false;
      saveState();
      sendLog();
    }
  } finally {
    __scrapingInProgress = false;
  }
}

// ---- auto resume after reload ----
(async () => {
  await loadState();
  // Only auto-resume if not on the first page and not already scraping or waiting
  if (__running && __progress.page > 0 && !__scrapingInProgress && !__waitingForNextPage) {
    console.log('[LOG] auto-resume: Resuming automation...', __collected_data, 'records collected');
    processResults();
  }
})();

// ---- start/stop via popup or console ----
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "startAutomation") {
    __running = true;
    __collected_data = [];
    __progress = { page: 0, row: 0 };
    saveState();
    processResults();
  }

  if (msg.action === "stopAutomation") {
    __running = false;
    saveState();
    alert("Automation stopped.");
  }
});
