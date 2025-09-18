let collectedData = [];
let progress = { page: 0, row: 0 };
let running = false;

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
});
