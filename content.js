
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
