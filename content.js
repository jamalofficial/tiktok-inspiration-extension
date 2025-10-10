
let __collected_data = [];
let __progress = { page: 0, row: 0 };
let __running = false;
let continueProcessing = true;
const pendingRequests = {};

const RESULTS_LIMIT = 15;

// ---- runtime shim for MAIN world ----
(function setupRuntimeShimForMainWorld() {
	const isMainWorld = typeof chrome === "undefined" || !chrome?.runtime;
	if (!isMainWorld) return;

	const PAGE_TO_EXT = "__TIKTOK_PAGE_TO_EXT__";
	const EXT_TO_PAGE = "__TIKTOK_EXT_TO_PAGE__";

	const pending = new Map();
	const listeners = new Set();

	function genId() {
		return Math.random().toString(36).slice(2) + Date.now().toString(36);
	}

	window.addEventListener("message", (event) => {
		if (event.source !== window) return;
		const data = event.data;
		if (!data || data.type !== EXT_TO_PAGE) return;

		if (data.id && pending.has(data.id)) {
			const { resolve, reject, callback } = pending.get(data.id);
			pending.delete(data.id);
			if (data.error) {
				reject(new Error(data.error));
			} else {
				if (callback) callback(data.response);
				resolve(data.response);
			}
			return;
		}

		// Unsolicited message from background; dispatch to listeners
		for (const fn of listeners) {
			try { fn(data.response, {}, null); } catch (_) { /* ignore */ }
		}
	});

	function sendMessageShim(message, callback) {
		const id = genId();
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject, callback });
			window.postMessage({ type: PAGE_TO_EXT, id, payload: message }, "*");
		});
	}

	function addListenerShim(fn) { listeners.add(fn); }
	function removeListenerShim(fn) { listeners.delete(fn); }

	// Minimal chrome.runtime shim
	window.chrome = window.chrome || {};
	window.chrome.runtime = {
		sendMessage: (msg, callback) => sendMessageShim(msg, callback),
		onMessage: {
			addListener: addListenerShim,
			removeListener: removeListenerShim,
		},
	};
})();

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

function sendLog(payload = null) {
	console.log("Sending log to server...", payload);

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
		},
		payload
	});
}



async function loadState() {
	return await new Promise((resolve) => {
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
  try{
    const titleEl = document.querySelector("span.TUXText--weight-bold");
    data.title = titleEl?.innerText.trim() || "";
  }
  catch(_){
    data.title = "";
  }

	// Search popularity main number (e.g. 172K)
	try {
		const popularityEl = document.querySelector("span.TUXText--weight-bold[style*='32px']");
		data.searchPopularity = popularityEl?.innerText?.trim?.() || "";
	} catch (_) {
		data.searchPopularity = "";
	}

	// Search popularity % (64.1%)
	try {
		const trendPercentEl = document.querySelector("div[class*='DetailTrendDiv'] span");
		data.trendPercent = trendPercentEl?.innerText?.trim?.() || "";
	} catch (_) {
		data.trendPercent = "";
	}

	// Related topics (bottom chart keyword divs)
	try {
		const relatedEls = document.querySelectorAll("div[class*='KeywordDiv'] span");
		data.relatedTopics = Array.from(relatedEls).map(el => (el?.innerText || "").trim());
	} catch (_) {
		data.relatedTopics = [];
	}

	// locations data
	try {
		const locations = document.querySelectorAll("[class*='--BarChartContainer'] [class*='--BarItemContainer']");
		data.locations = Array.from(locations).map(locEl => {
			const loc_div = locEl?.children?.[0];
			const name = loc_div?.children?.[0]?.innerText || "";
			const value = loc_div?.children?.[1]?.innerText || "";
			return { name: name.trim(), value: value.trim() };
		});
	} catch (_) {
		data.locations = [];
	}

	// demographics data
	try {
		const demographics = document.querySelectorAll("[class*='--ExposureWrapper'] [class*='--LegendItemContainer']");
		data.demographics = Array.from(demographics).map(demoEl => {
			const demo_div = demoEl?.children?.[0];
			const name = demo_div?.children?.[1]?.innerText || "";
			const value = demoEl?.children?.[1]?.innerText || "";
			return { name: name.trim(), value: value.trim() };
		});
	} catch (_) {
		data.demographics = [];
	}

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
		// wait 7 seconds after opening the tab before starting to scrape
		await sleep(7000);
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

async function openDetailAndWait(url) {
  const requestId = crypto.randomUUID();
  console.log("[content] scraping detail:", url, requestId);

  return new Promise((resolve, reject) => {
    pendingRequests[requestId] = { resolve, reject };

    chrome.runtime.sendMessage(
      { action: "openTabAndScrape", url, requestId },
      (resp) => {
		console.log("response", resp);
        if (!resp?.ok) {
          delete pendingRequests[requestId];
          reject(new Error(resp?.error || "Failed to open detail tab"));
        }
      }
    );
  });
}

// Show a dialog on the main page to inform the user that the process is running

function showProgress(show = true) {
  if(show){
    // Avoid duplicate dialogs
    if (document.getElementById("__scraper_progress_dialog")) return;

    const dialog = document.createElement("div");
    dialog.id = "__scraper_progress_dialog";
    dialog.style.position = "fixed";
    dialog.style.top = "20px";
    dialog.style.right = "20px";
    dialog.style.zIndex = "99999";
    dialog.style.background = "rgba(74,144,226,0.97)";
    dialog.style.color = "#fff";
    dialog.style.padding = "18px 28px";
    dialog.style.borderRadius = "8px";
    dialog.style.boxShadow = "0 2px 16px rgba(0,0,0,0.18)";
    dialog.style.fontSize = "18px";
    dialog.style.fontWeight = "bold";
    dialog.style.fontFamily = "sans-serif";
    dialog.style.display = "flex";
    dialog.style.alignItems = "center";
    dialog.innerText = "⏳ Scraping in progress... Please do not close this tab.";

    document.body.appendChild(dialog);
  }
  else{
    document.getElementById("__scraper_progress_dialog").remove();
  }
}

// Remove the dialog when process is done
function hideProgress() {
	const dialog = document.getElementById("__scraper_progress_dialog");
	if (dialog) dialog.remove();
}


async function processResults() {
	showProgress();
	while (__collected_data.length < RESULTS_LIMIT && continueProcessing) {
		const rowLinkNodes = [...document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']")];
		// console.log("rows", rowLinkNodes.map(r => r.innerText.trim()));
    	let processedRows = 0;

		for (let i = __progress.row; i < rowLinkNodes.length; i++) {
			if(continueProcessing){
				// Re-select to avoid stale nodes after DOM updates
				const tempNodes = [...document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--QueryStringTuxTex']")];
				const popularities = [...document.querySelectorAll("[class*='--Tbody'] [class*='--TrRow'] [class*='--PopularityDiv']")];

				const node = tempNodes[i];
				if (!node) break;

				const popularity = popularities[i];
				const parent = node.closest("[class*='--CellContainerDiv']");
				const parentDescriptors = parent ? Object.getOwnPropertyDescriptors(parent) : {};
				const reactFiberKey = Object.keys(parentDescriptors).find((k) => k.startsWith("__reactFiber$"));
				const refKey = reactFiberKey ? parent[reactFiberKey]?.return?.key : undefined;

				let detailUrl = null; //node.closest('a')?.href;
				if (!detailUrl && refKey) {
					detailUrl = `https://www.tiktok.com/csi/detail/${refKey}`;
				}

				try {
					// const search_pop = popularity?.children[0]?.innerText || null
					// const trend = popularity?.children[2]?.querySelector("[class*='--TrendTuxText']")?.innerText || null
					const data = await openDetailAndWait(detailUrl);
					console.log("Page closed", detailUrl);
					// data?.searchPopularity = search_pop;
					// data?.trendPercent = trend;
					__collected_data.push(data);
					__progress.row = i + 1;
					saveState();
					sendLog([data]);
				} catch (e) {
					console.error("Detail scrape failed", e);
					__progress.row = i + 1; // skip and continue
					saveState();
				}

				processedRows += 1;
				// if (processedRows >= 3 || __collected_data.length >= 100) break;
				if (__collected_data.length >= RESULTS_LIMIT || !continueProcessing) break;
			}
		}

		if( __collected_data.length < RESULTS_LIMIT && continueProcessing){
			// navigate to next page and start scrapping again
			const pagination_div = document.querySelector("[class*='--PaginationContainerDiv']");
			const next_page = pagination_div.children[1];
			if(next_page && !next_page.disabled){
				next_page.click();
				await sleep(30000);
				continue;
			}
		}
		else{
		break;
		}
		// // do not continue processing if we got here
		// continueProcessing = false;
		// // Stop early after 3 rows, do not paginate
		// break;
	}

  if(continueProcessing){
    __running = false;
    saveState();
    // sendLog();
    // alert("Automation finished, you can download JSON now.");
    alert("Automation finished!");
  }
  showProgress(false);
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
	if (msg.action === "toggleAutomation") {
		__running = !__running;
		let action;
		if (__running) {
      continueProcessing = true;
			__collected_data = [];
			__progress = { page: 0, row: 0 };
			saveState();
			processResults();
			action = "started";
		} else {
      continueProcessing = false;
			saveState();
      showProgress(false);
			alert("Automation stopped.");
			action = "stopped";
		}
    chrome.runtime.sendMessage({ status: __running, action: `ti-${msg.action}` });
		return true; // indicate async response (even if not strictly needed)
	}
	if (msg?.action === "detailScraped") {
		console.log("detail scrapping completed", msg);
		if( msg?.requestId ){
			const pending = pendingRequests[msg.requestId];
			if (pending) {
				console.log("[content] resolved scrape", msg.requestId);
				pending.resolve(msg.data);
				delete pendingRequests[msg.requestId];
			}
		}
	}
});
