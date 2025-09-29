let collectedData = [];
let progress = { page: 0, row: 0 };
let running = false;

// Map detail tabId -> { openerTabId, url }
const detailTabMap = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg.action === "saveState") {
		({ collectedData, progress, running } = msg.data);
		chrome.storage.local.set({ collectedData, progress, running });
	}

	if (msg.action === "sendLog") {
		chrome.storage.local.get(["collectedData"], (result) => {
			const collectedData = result.collectedData || [];
			fetch('http://localhost:8000/api/v1/logs', {
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

	// Open a detail page in a new background tab and map it back to the opener
	if (msg.action === "openTabAndScrape") {
		const openerTabId = sender?.tab?.id;
		const { url } = msg;
		if (!openerTabId || !url) {
			sendResponse({ ok: false, error: "Missing openerTabId or url" });
			return; // not async
		}

		// Tag the URL so the content script in the new tab knows to auto-scrape
		let targetUrl = url;
		if (url.includes('#')) {
			targetUrl = url + (url.endsWith('#') ? '' : '') + (url.includes('tiscrape=1') ? '' : '&tiscrape=1');
		} else {
			targetUrl = url + '#tiscrape=1';
		}

		chrome.tabs.create({ url: targetUrl, active: false }, (tab) => {
			if (chrome.runtime.lastError || !tab?.id) {
				sendResponse({ ok: false, error: chrome.runtime.lastError?.message || "Failed to create tab" });
				return;
			}
			detailTabMap.set(tab.id, { openerTabId, url: targetUrl });
			sendResponse({ ok: true, tabId: tab.id });
		});
		return true; // async response
	}

	// Receive scraped data from the detail tab's content script
	if (msg.action === "scrapeComplete") {
		const detailTabId = sender?.tab?.id;
		const mapping = detailTabId ? detailTabMap.get(detailTabId) : null;
		const data = msg.data || {};

		if (mapping && mapping.openerTabId) {
			// Relay to opener tab so its content script can update state and proceed
			chrome.tabs.sendMessage(mapping.openerTabId, { action: "detailScraped", data }, () => {
				// Close the detail tab after relaying (regardless of sendMessage success)
				if (detailTabId && detailTabMap.has(detailTabId)) {
					chrome.tabs.remove(detailTabId, () => {
						detailTabMap.delete(detailTabId);
					});
				}
			});
		} else {
			// Do not close tabs that aren't tracked as detail tabs
			console.warn("scrapeComplete from untracked tab; ignoring close");
		}
	}
});

// Clean up mapping if a detail tab gets closed unexpectedly
chrome.tabs.onRemoved.addListener((tabId) => {
	if (detailTabMap.has(tabId)) {
		detailTabMap.delete(tabId);
	}
});
