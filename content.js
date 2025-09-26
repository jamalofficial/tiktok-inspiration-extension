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

// Detect if current page looks like a detail page
function isDetailPage() {
	// Only auto-scrape when the special hash tag is present
	if (!window.location.hash.includes('tiscrape=1')) return false;
	// Treat as detail page when list rows are absent
	const listRowNodes = document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']");
	return listRowNodes.length === 0;
}

// On a detail page, auto-scrape and report back via background, then let background close tab
async function runDetailAutoScrapeIfNeeded() {
	if (!isDetailPage()) return false;
	try {
		console.log("[detail] detected; waiting for key element...");
		// wait for a reliable element to ensure the page is rendered
		await waitFor("span.TUXText--weight-bold", 15000);
		await sleep(500); // small settle delay
		const data = await scrapePageData();
		console.log("[detail] scraped data", data);
		chrome.runtime.sendMessage({ action: "scrapeComplete", data });
		console.log("[detail] sent scrapeComplete");
		return true;
	} catch (e) {
		console.warn("[detail] scrape error", e);
		chrome.runtime.sendMessage({ action: "scrapeComplete", data: { error: e?.message || String(e), url: window.location.href } });
		return true;
	}
}

// Open a URL in a background tab via background and wait for the result
function openDetailAndWait(url) {
	return new Promise((resolve, reject) => {
		let timeoutId = setTimeout(() => {
			reject(new Error("Detail scrape timeout"));
		}, 120000);

		function onMessage(msg) {
			if (msg && msg.action === "detailScraped") {
				console.log("[list] received detailScraped");
				clearTimeout(timeoutId);
				chrome.runtime.onMessage.removeListener(onMessage);
				resolve(msg.data);
			}
		}

		chrome.runtime.onMessage.addListener(onMessage);
		console.log("[list] opening detail in background", url);
		chrome.runtime.sendMessage({ action: "openTabAndScrape", url }, (resp) => {
			if (!resp?.ok) {
				clearTimeout(timeoutId);
				chrome.runtime.onMessage.removeListener(onMessage);
				reject(new Error(resp?.error || "Failed to open detail tab"));
			}
		});
	});
}

async function processResults() {
	console.log("Starting automation...");
	let continueProcessing = true;
	let processedRows = 0; // limit to first 3 rows overall
	while (__collected_data.length < 100 && continueProcessing && processedRows < 3) {
		const rowLinkNodes = [...document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']")];
		console.log("rows", rowLinkNodes.map(r => r.innerText.trim()));

		for (let i = __progress.row; i < rowLinkNodes.length; i++) {
			// Re-select to avoid stale nodes after DOM updates
			const tempNodes = [...document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']")];
			const node = tempNodes[i];
			if (!node) break;

			// Derive detail URL: prefer anchor href if present, else simulate click to read location
			let detailUrl = node.closest('a')?.href;
			if (!detailUrl) {
				// If not a link, attempt to construct from location by a temporary click in same tab
				node.click();
				await sleep(3000);
				detailUrl = window.location.href;
				window.history.back();
				await sleep(3000);
			}

			try {
				const data = await openDetailAndWait(detailUrl);
				__collected_data.push(data);
				__progress.row = i + 1;
				saveState();
			} catch (e) {
				console.error("Detail scrape failed", e);
				__progress.row = i + 1; // skip and continue
				saveState();
			}

			processedRows += 1;
			if (processedRows >= 3 || __collected_data.length >= 100) break;
		}

		// Stop early after 3 rows, do not paginate
		break;
	}

	alert("Automation finished, you can download JSON now.");
	__running = false;
	saveState();
	sendLog();
}

// ---- auto resume after reload ----
(async () => {
	await loadState();

	// If we are on a detail page, auto-scrape and let background close this tab
	const handledDetail = await runDetailAutoScrapeIfNeeded();
	if (handledDetail) return;

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
