// Bridge between page (MAIN world) and extension (isolated world)
// Listens for window messages from the page, forwards to chrome.runtime,
// and relays responses back to the page.

(function initPageToExtensionBridge() {
	if (window.__tiktokBridgeInitialized) return;
	window.__tiktokBridgeInitialized = true;

	const PAGE_TO_EXT = "__TIKTOK_PAGE_TO_EXT__";
	const EXT_TO_PAGE = "__TIKTOK_EXT_TO_PAGE__";

	// If extension APIs are not available, do nothing.
	if (typeof chrome === "undefined" || !chrome.runtime) {
		return;
	}

	// Listen for messages posted to the window (from the page context)
	window.addEventListener("message", async (event) => {
		// Only handle messages sent from the same window (ignore iframes, etc.)
		if (event.source !== window) return;
		const data = event.data;
		if(data && data?.payload?.action == "ti-toggleAutomation") console.log("_data", data);
		// Only process messages with the expected type (PAGE_TO_EXT)
		if (!data || data.type !== PAGE_TO_EXT) return;

		try {
			// Forward the payload to the extension's background script via chrome.runtime.sendMessage
			const response = await chrome.runtime.sendMessage(data.payload);
			// Relay the response back to the page context, including the original message id for correlation
			window.postMessage({ type: EXT_TO_PAGE, id: data.id, response }, "*");
		} catch (error) {
			console.error("Got error", String(error));
			// If an error occurs, send the error message back to the page context
			window.postMessage({ type: EXT_TO_PAGE, id: data.id, error: String(error) }, "*");
		}
	});

	if (chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
		chrome.runtime.onMessage.addListener((msg) => {
		// Optional: relay unsolicited events from background to page
		window.postMessage({ type: EXT_TO_PAGE, id: null, response: msg }, "*");
		});
	}
})();


