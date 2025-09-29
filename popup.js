  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ["content.js"]
    }, () => {
      // chrome.tabs.sendMessage(tabs[0].id, { action: "startAutomation" });
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

document.getElementById("toggle-scrapping").onclick = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "toggleScrapping" })
    .then((response) => {
      setRunningForButton(response?.status ?? false);
    });
  });
}

const setRunningForButton = (status) => {
  const thisButton = document.getElementById("toggle-scrapping");
  if(status) {
    thisButton.innerText = "Stop Automation";
    thisButton.classList.remove('info-btn');
    thisButton.classList.add('danger-btn');
  }
  else {
    thisButton.innerText = "Start Automation";
    thisButton.classList.remove('danger-btn');
    thisButton.classList.add('info-btn');
  }
}

chrome.runtime.onMessage.addListener((data) => {
  if(data?.action == "console.log") console.log("data", data?.data);
  if(data?.action == "isRunning") setRunningForButton(data?.status);
});

