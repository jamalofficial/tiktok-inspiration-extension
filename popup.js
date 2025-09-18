  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ["content.js"]
    }, () => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "startAutomation" });
    });
  });
// ...existing code...

document.getElementById("download").onclick = () => {
  chrome.runtime.sendMessage({ action: "downloadData" });
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "log") {
    document.getElementById("log").innerText = msg.data;
  }
});

document.getElementById("stop").onclick = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "stopAutomation" });
  });
};
