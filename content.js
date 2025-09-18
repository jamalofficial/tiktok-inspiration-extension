let __collected_data = [];
let __progress = { page: 0, row: 0 };
let __running = false;

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
    console.log("Starting automation...");
    let test = true;
    while (__collected_data.length < 100 && test) {
        const rows = [...document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']")];
        console.log("rows", rows.map(r => r.innerText.trim()));
        // break;

        for (let i = __progress.row; i < rows.length; i++) {
            const temp_rows = [...document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']")];

            temp_rows[i].click();
            await sleep(10000);

            const data = await scrapePageData();
            __collected_data.push(data);

            __progress.row = i + 1;
            saveState();

            window.history.back();
            await sleep(10000);

            if ( i == 3 ) break;
            if (__collected_data.length >= 100) break;
        }
        test = false;

        // move to next page
        // if (__collected_data.length < 100) {
        //     const nextBtn = document.querySelector("#next-list");
        //     if (!nextBtn) break;
        //     nextBtn.click();
        //     __progress.page += 1;
        //     __progress.row = 0;
        //     saveState();
        //     await sleep(5000);
        // }
    }

    alert("Automation finished, you can download JSON now.");
    __running = false;
    saveState();
    sendLog();
}

// ---- auto resume after reload ----
(async () => {
  await loadState();

  if (__running) {
    console.log(
      "Resuming automation...",
      __collected_data,
      "records collected"
    );
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
