let collectedData = [];
let progress = { page: 0, row: 0 };
let running = false;

const API_URL = 'https://campfire-insta-tiktok.gitwork.tech/api/v1';
// const API_URL = 'http://localhost:5050/api/v1';

// Map detail tabId -> { openerTabId, url }
const detailTabMap = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg.action === "saveState") {
		({ collectedData, progress, running } = msg.data);
		chrome.storage.local.set({ collectedData, progress, running });
	}

	if (msg.action === "sendLog") {
		if(msg.payload) {
			const collectedData = msg.payload || [];
			fetch(`${API_URL}/logs`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ log: collectedData, info: msg.data || {} }),
			}).then(response => {
				console.log("Logs sent successfully:", response);
			}).catch(error => {
				console.error("Error sending logs:", error);
			});
		}
		else{
			chrome.storage.local.get(["collectedData"], (result) => {
				const collectedData = result.collectedData || [];
				fetch(`${API_URL}/logs`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ log: collectedData, info: msg.data || {} }),
				}).then(response => {
					console.log("Logs sent successfully:", response);
				}).catch(error => {
					console.error("Error sending logs:", error);
				});
			});
		}
	}

	if (msg.action === "loadState") {
		chrome.storage.local.get(
			["collectedData", "progress", "running"],
			(result) => {
				sendResponse(result);
			}
		);
		return true; // async response
	}

	if (msg.action === "downloadData") {
		chrome.storage.local.get(["collectedData"], (result) => {
			const data = result.collectedData || [];
			const blob = new Blob([JSON.stringify(data, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			chrome.downloads.download({
				url,
				filename: "scraped-data.json",
				saveAs: true,
			});
		});
	}

	// ----- Handle opening detail tabs -----
	if (msg.action === "openTabAndScrape") {
		const openerTabId = sender?.tab?.id;
		const { url, requestId } = msg;
		let finalUrl = url;
		try {
			const parsed = new URL(url);
			if (parsed.hash) {
			  // If hash already exists, append (avoid duplicate tiscrape param)
			  if (!parsed.hash.includes("tiscrape=1")) {
				parsed.hash += (parsed.hash.includes("?") ? "&" : "&") + "tiscrape=1";
			  }
			} else {
			  parsed.hash = "#tiscrape=1";
			}
			finalUrl = parsed.toString();
		} catch (err) {
			// fallback: if invalid URL, append manually
			if (!url.includes("#tiscrape=1")) {
				finalUrl += (url.includes("#") ? "&" : "#") + "tiscrape=1";
			}
		}
		chrome.tabs.create({ url: finalUrl, active: true, windowId: sender?.tab?.windowId }, (detailTab) => {
		  if (detailTab?.id) {
			console.log("details tab created", detailTab);
			detailTabMap.set(detailTab.id, { openerTabId, requestId });
			sendResponse({ ok: true });
		  } else {
			sendResponse({ ok: false, error: "Failed to open tab" });
		  }
		});
	
		return true; // keeps sendResponse async
	}
	
	// ----- Handle completed scrapes -----
	if (msg.action === "scrapeComplete") {
		const detailTabId = sender?.tab?.id;
		const mapping = detailTabMap.get(detailTabId);
		const data = msg.data || {};
	
		if (mapping?.openerTabId) {
		  chrome.tabs.sendMessage(
			mapping.openerTabId,
			{ action: "detailScraped", data, requestId: mapping.requestId },
			() => {
			  if (detailTabId && detailTabMap.has(detailTabId)) {
				chrome.tabs.remove(detailTabId, () => {
				  detailTabMap.delete(detailTabId);
				});
			  }
			}
		  );
		}
	}
});

// Clean up mapping if a detail tab gets closed unexpectedly
chrome.tabs.onRemoved.addListener((tabId) => {
	if (detailTabMap.has(tabId)) {
		detailTabMap.delete(tabId);
	}
});
